/**
 * Who activates, when, and what it cost.
 *
 * The index is event → extensions, rebuilt whenever the activatable set
 * changes. Firing a trigger must not walk every installed extension
 * (architecture §9): with a hundred extensions installed, opening a file
 * would otherwise mean a hundred manifest scans per language change.
 *
 * Three rules shape everything here:
 *
 * - **One activation per extension and generation.** The host already
 *   shares the in-flight promise; this side additionally remembers the
 *   outcome, so a failed extension is not retried on every keystroke that
 *   happens to match its language.
 * - **A trigger never rejects.** `onLanguage` fires because the user opened
 *   a file; an extension failing to activate is *its* problem, reported and
 *   recorded, and the workbench carries on. Only the explicit path —
 *   activating for a command someone invoked — propagates the failure, and
 *   that one goes through `activate()`.
 * - **Failures are remembered, not swallowed.** `failures()` and
 *   `metrics()` are what the detail view will show in 3.6, and what makes
 *   "logs y reporte de activation failure" of the security gate real.
 */
import { RpcError } from '../domain/rpc-protocol';
import {
  matchesTrigger,
  parseActivationEvent,
} from '../domain/activation-events';
import type { ActivationEvent, ActivationTrigger } from '../domain/activation-events';
import type { ExtensionHost, ExtensionHostEvent } from './ports/extension-host';

/** What the service needs from an installed extension. */
export interface ActivatableExtensionRecord {
  id: string;
  activationEvents: string[];
}

export interface ActivationMetric {
  id: string;
  /** What woke it up, for the UI: `onCommand:x`, `onStartupFinished`, … */
  reason: string;
  durationMs: number;
  at: number;
}

export interface ActivationFailure {
  id: string;
  reason: string;
  code: string;
  message: string;
  at: number;
}

export interface ExtensionActivationServiceOptions {
  host: Pick<ExtensionHost, 'request' | 'state'>;
  /** Extensions this generation may activate, with their activation events. */
  activatable: () => ActivatableExtensionRecord[];
  /** Brings the host up when a trigger needs it. */
  ensureRunning?: () => Promise<unknown>;
  /** Files present in the workspace root, for `workspaceContains`. Injected:
   *  scanning is infrastructure, deciding is not. */
  workspaceContains?: (patterns: string[]) => Promise<string[]>;
  now?: () => number;
  log?: (message: string) => void;
  /** Fired when metrics or failures changed, so the UI can refresh. */
  onDidChange?: () => void;
}

type ActivationState = 'idle' | 'activating' | 'active' | 'failed';

export class ExtensionActivationService {
  private readonly options: ExtensionActivationServiceOptions;
  private readonly states = new Map<string, ActivationState>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly activationMetrics: ActivationMetric[] = [];
  private readonly activationFailures: ActivationFailure[] = [];
  /** Rebuilt lazily from `activatable()`; invalidated per generation. */
  private index: Map<string, ActivationEvent[]> | null = null;
  private generation = 0;

  constructor(options: ExtensionActivationServiceOptions) {
    this.options = options;
  }

  /** Drops per-generation state. A new host knows nothing of what the old
   *  one activated. */
  handleHostEvent(event: ExtensionHostEvent): void {
    if (event.type !== 'state') return;
    const { status, generation } = event.state;
    if (generation !== this.generation || status === 'stopped' || status === 'disabled') {
      this.generation = generation;
      this.states.clear();
      this.inFlight.clear();
      this.index = null;
    }
  }

  /** Call when the installed/enabled/trusted set changed. */
  invalidate(): void {
    this.index = null;
  }

  stateOf(id: string): ActivationState {
    return this.states.get(id) ?? 'idle';
  }

  metrics(): ActivationMetric[] {
    return [...this.activationMetrics];
  }

  failures(): ActivationFailure[] {
    return [...this.activationFailures];
  }

  /** Events an extension declares that Forge cannot dispatch. Feeds the
   *  compatibility report instead of failing silently at runtime. */
  unknownEventsOf(id: string): string[] {
    return this.eventsOf(id)
      .filter((event) => event.kind === 'unknown')
      .map((event) => (event as { raw: string }).raw);
  }

  /** Extensions whose declared events match `trigger`. */
  candidatesFor(trigger: ActivationTrigger): string[] {
    const candidates: string[] = [];
    for (const [id, events] of this.eventIndex()) {
      if (events.some((event) => matchesTrigger(event, trigger))) candidates.push(id);
    }
    return candidates;
  }

  /**
   * Fires a trigger: activates everything that declares it, concurrently,
   * and never rejects. Resolves with the ids it actually activated now.
   */
  async fire(trigger: ActivationTrigger): Promise<string[]> {
    const candidates = this.candidatesFor(trigger).filter(
      (id) => this.stateOf(id) === 'idle',
    );
    if (candidates.length === 0) return [];

    const reason = describeTrigger(trigger);
    const results = await Promise.all(candidates.map(async (id) => {
      try {
        await this.activate(id, reason);
        return id;
      } catch {
        // Already recorded in `activationFailures`; a trigger is not a
        // request anybody is waiting on.
        return null;
      }
    }));
    return results.filter((id): id is string => id !== null);
  }

  /**
   * Resolves `workspaceContains:` for the open workspace and activates what
   * matches. Separate from `fire` because it asks the filesystem instead of
   * matching an event, and it runs once per workspace, not per trigger.
   */
  async fireWorkspaceContains(): Promise<string[]> {
    const scan = this.options.workspaceContains;
    if (!scan) return [];

    const byPattern = new Map<string, string[]>();
    for (const [id, events] of this.eventIndex()) {
      if (this.stateOf(id) !== 'idle') continue;
      for (const event of events) {
        if (event.kind !== 'workspaceContains') continue;
        const owners = byPattern.get(event.pattern) ?? [];
        owners.push(id);
        byPattern.set(event.pattern, owners);
      }
    }
    if (byPattern.size === 0) return [];

    let matched: string[] = [];
    try {
      // One scan for every pattern: walking the workspace once per
      // extension is how a 20-extension profile turns a folder open into
      // seconds of I/O.
      matched = await scan([...byPattern.keys()]);
    } catch (err) {
      this.log(`workspaceContains falló: ${(err as Error).message}`);
      return [];
    }

    const activated: string[] = [];
    for (const pattern of matched) {
      for (const id of byPattern.get(pattern) ?? []) {
        if (this.stateOf(id) !== 'idle') continue;
        try {
          await this.activate(id, `workspaceContains:${pattern}`);
          activated.push(id);
        } catch {
          /* recorded in failures */
        }
      }
    }
    return activated;
  }

  /**
   * Activates one extension, sharing an in-flight activation and
   * remembering the outcome. Rejects with a typed error — this is the path
   * a command takes, and the caller there *is* waiting.
   */
  activate(id: string, reason: string): Promise<void> {
    const state = this.stateOf(id);
    if (state === 'active') return Promise.resolve();
    if (state === 'failed') {
      const failure = this.activationFailures.find((entry) => entry.id === id);
      return Promise.reject(new RpcError(
        'ACTIVATION_FAILED',
        failure?.message ?? `"${id}" falló al activarse en esta generación.`,
      ));
    }
    const pending = this.inFlight.get(id);
    if (pending) return pending;

    const promise = this.runActivation(id, reason).finally(() => {
      this.inFlight.delete(id);
    });
    this.inFlight.set(id, promise);
    return promise;
  }

  private async runActivation(id: string, reason: string): Promise<void> {
    this.states.set(id, 'activating');
    const startedAt = this.now();
    try {
      if (this.options.host.state.status !== 'running') {
        await this.options.ensureRunning?.();
      }
      const answer = await this.options.host.request(
        'lifecycle.activate',
        { id },
        { extensionId: id },
      ) as { durationMs?: unknown } | null;

      this.states.set(id, 'active');
      this.activationMetrics.push({
        id,
        reason,
        // The host measures the extension's own `activate()`; the round-trip
        // is Forge's cost, not the extension's, and blaming it for our IPC
        // would make the numbers useless for deciding what to disable.
        durationMs: typeof answer?.durationMs === 'number'
          ? answer.durationMs
          : this.now() - startedAt,
        at: this.now(),
      });
      this.options.onDidChange?.();
    } catch (err) {
      this.states.set(id, 'failed');
      const code = err instanceof RpcError ? err.code : 'ACTIVATION_FAILED';
      const message = (err as Error).message ?? String(err);
      this.activationFailures.push({ id, reason, code, message, at: this.now() });
      this.log(`activación fallida de "${id}" (${reason}): ${message}`);
      this.options.onDidChange?.();
      throw err instanceof RpcError ? err : new RpcError('ACTIVATION_FAILED', message);
    }
  }

  private eventsOf(id: string): ActivationEvent[] {
    return this.eventIndex().get(id) ?? [];
  }

  private eventIndex(): Map<string, ActivationEvent[]> {
    if (this.index) return this.index;
    const index = new Map<string, ActivationEvent[]>();
    for (const record of this.options.activatable()) {
      index.set(record.id, (record.activationEvents ?? []).map(parseActivationEvent));
    }
    this.index = index;
    return index;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

function describeTrigger(trigger: ActivationTrigger): string {
  switch (trigger.kind) {
    case 'startupFinished':
      return 'onStartupFinished';
    case 'command':
      return `onCommand:${trigger.command}`;
    case 'language':
      return `onLanguage:${trigger.language}`;
  }
}

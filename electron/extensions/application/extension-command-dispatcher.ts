/**
 * Main's half of `commands`: what the host has registered, and how a
 * command id becomes a run.
 *
 * Two responsibilities that belong together because they share the same
 * index:
 *
 * 1. **Registry.** The host announces `commands.register` /
 *    `commands.unregister` as notifications; main keeps the id → owner map
 *    so the workbench can tell, synchronously, whether a command will
 *    actually do something. That answer is what stops a keybinding from
 *    swallowing a keystroke it cannot honour.
 * 2. **On-demand activation.** A command with no handler is not
 *    necessarily missing: its extension may simply not be activated yet.
 *    The dispatcher asks the activation service who declares
 *    `onCommand:<id>`, has it activated and retries **once** (design §5).
 *    Retrying more would turn a misdeclared activation event into an
 *    infinite loop. The index and the per-extension activation state live
 *    in that service, not here: `onCommand` is one trigger among several
 *    and they must not disagree about who is active.
 *
 * The registry is per generation. A host restart drops it wholesale — a
 * registration is a fact about a process that no longer exists, and
 * carrying it over would advertise handlers nobody holds.
 */
import { RpcError } from '../domain/rpc-protocol';
import type { RpcEnvelope } from '../domain/rpc-protocol';
import type { ExtensionHost, ExtensionHostEvent } from './ports/extension-host';
import type { ExtensionActivationService } from './extension-activation-service';

export interface CommandRegistration {
  command: string;
  extensionId: string;
}

export interface ExtensionCommandDispatcherOptions {
  /** Only `request` is used here: the dispatcher does not own the host's
   *  lifecycle, it just talks to it. */
  host: Pick<ExtensionHost, 'request'>;
  /** Resolves who declares `onCommand:<id>` and activates it. */
  activation: Pick<ExtensionActivationService, 'candidatesFor' | 'activate'>;
  /** Called whenever the set of runnable commands changes, so the renderer
   *  can be told without polling. */
  onRegistryChanged?: (commands: CommandRegistration[]) => void;
  log?: (message: string) => void;
}

export class ExtensionCommandDispatcher {
  private readonly options: ExtensionCommandDispatcherOptions;
  /** command id → owning extension, for the live generation only. */
  private readonly registry = new Map<string, string>();
  private generation = 0;

  constructor(options: ExtensionCommandDispatcherOptions) {
    this.options = options;
  }

  /** Feeds the dispatcher from the host's event stream. */
  handleHostEvent(event: ExtensionHostEvent): void {
    if (event.type === 'state') {
      // A new generation, or one that stopped, invalidates every handler.
      if (event.state.generation !== this.generation || event.state.status === 'stopped'
        || event.state.status === 'disabled') {
        this.generation = event.state.generation;
        this.clear();
      }
      return;
    }
    if (event.type === 'notification') {
      if (event.generation !== this.generation) {
        // Late traffic from a dead generation: dropping it is the same rule
        // the broker applies to responses (design §1.3).
        this.log(`registro descartado de la generación ${event.generation}`);
        return;
      }
      this.handleNotification(event.envelope);
    }
  }

  /** Applies one `commands.register` / `commands.unregister` notification.
   *  Anything malformed is dropped with a note: an index built from guesses
   *  would claim handlers that do not exist. */
  private handleNotification(envelope: RpcEnvelope): void {
    if (envelope.method !== 'commands.register' && envelope.method !== 'commands.unregister') {
      return;
    }
    const payload = envelope.payload as { command?: unknown; extensionId?: unknown } | null;
    const command = payload && typeof payload === 'object' ? payload.command : undefined;
    const extensionId = payload && typeof payload === 'object' ? payload.extensionId : undefined;
    if (typeof command !== 'string' || !command
      || typeof extensionId !== 'string' || !extensionId) {
      this.log(`notificación de comando inválida: ${envelope.method}`);
      return;
    }

    if (envelope.method === 'commands.register') {
      this.registry.set(command, extensionId);
    } else if (this.registry.get(command) === extensionId) {
      // Only the owner can unregister: a stale unregister from an extension
      // that lost the id must not remove the current handler.
      this.registry.delete(command);
    } else {
      return;
    }
    this.publish();
  }

  hasCommand(command: string): boolean {
    return this.registry.has(command);
  }

  registered(): CommandRegistration[] {
    return [...this.registry].map(([command, extensionId]) => ({ command, extensionId }));
  }

  /** Extension that declares `onCommand:<id>`, or null. */
  ownerFor(command: string): string | null {
    const [owner] = this.options.activation.candidatesFor({ kind: 'command', command });
    return owner ?? null;
  }

  /**
   * Runs a command, activating its extension first if needed. Rejects with
   * a typed `RpcError`, never with a bare string: the renderer decides what
   * to show from the code, not by matching messages.
   */
  async execute(command: string, args: unknown[] = []): Promise<unknown> {
    if (typeof command !== 'string' || !command) {
      throw new RpcError('INVALID_PAYLOAD', 'Se requiere el id del comando.');
    }

    if (!this.registry.has(command)) {
      const owner = this.ownerFor(command);
      if (!owner) {
        throw new RpcError(
          'COMMAND_NOT_FOUND',
          `Ninguna extensión activa registra "${command}" ni declara `
          + `"onCommand:${command}".`,
        );
      }
      // Concurrent activations of the same id share one promise, so two
      // commands racing to wake the same extension is safe. Starting the
      // host if it is down is the activation service's business too.
      await this.options.activation.activate(owner, `onCommand:${command}`);

      if (!this.registry.has(command)) {
        throw new RpcError(
          'COMMAND_NOT_FOUND',
          `"${owner}" se activó pero no registró "${command}".`,
          { extensionId: owner },
        );
      }
    }

    const extensionId = this.registry.get(command) ?? undefined;
    const answer = await this.options.host.request(
      'commands.execute',
      { command, args },
      { extensionId },
    );
    return (answer as { result?: unknown } | null)?.result;
  }

  private clear(): void {
    if (this.registry.size === 0) return;
    this.registry.clear();
    this.publish();
  }

  private publish(): void {
    this.options.onRegistryChanged?.(this.registered());
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

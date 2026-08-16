import * as path from 'path';
import type { WorkspaceTrustStore } from './ports/workspace-trust-store';
import type { InstalledExtensionRecord } from '../domain/extension-manifest';
import {
  isRemoteWorkspaceUri,
  resolveExtensionTrust,
  type ExtensionTrustVerdict,
  type WorkspaceTrustDecision,
  type WorkspaceTrustState,
  type WorkspaceTrustStatus,
} from '../domain/workspace-trust';

export interface WorkspaceTrustServiceOptions {
  store: WorkspaceTrustStore;
  /** Open workspace: local absolute path, remote URI, or null for none. */
  workspace: () => string | null;
  /** Remote workspaces are out of scope for trust in this increment. */
  isRemote?: (workspace: string) => boolean;
  /** Decisions kept; the oldest are dropped past this bound. */
  maxDecisions?: number;
  /** Diagnostics sink; defaults to console.warn. */
  warn?: (message: string) => void;
}

/** Thrown when trust cannot be granted or revoked for the open workspace. */
export class WorkspaceTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceTrustError';
  }
}

/** Normalizes a local path for comparison; trailing separators are noise. */
function canonical(workspace: string): string {
  const resolved = path.resolve(workspace);
  return resolved.length > 1 && resolved.endsWith(path.sep)
    ? resolved.slice(0, -1)
    : resolved;
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

/**
 * Workspace Trust for Forge (security document §3). A workspace is
 * restricted until the user says otherwise: newly opened folders, remote
 * workspaces and anything the store cannot decode all resolve to
 * Restricted Mode, where only extensions declaring
 * `capabilities.untrustedWorkspaces` are activatable.
 *
 * Decision precedence, most specific first:
 *   1. an explicit decision for the workspace itself (trusted or not),
 *   2. the closest trusted ancestor folder — trusting a project root
 *      trusts its subfolders, as in VS Code,
 *   3. no decision → restricted.
 *
 * An explicit "not trusted" therefore always beats a trusted ancestor.
 */
export class WorkspaceTrustService {
  private readonly warn: (message: string) => void;
  private readonly isRemote: (workspace: string) => boolean;
  private readonly maxDecisions: number;
  private readonly listeners = new Set<(status: WorkspaceTrustStatus) => void>();

  constructor(private readonly options: WorkspaceTrustServiceOptions) {
    this.warn = options.warn ?? ((message) => console.warn('[forge:trust]', message));
    this.isRemote = options.isRemote ?? isRemoteWorkspaceUri;
    this.maxDecisions = options.maxDecisions ?? 200;
  }

  /** Notifies after every granted/revoked decision and on demand. Returns
   *  the unsubscribe. */
  onDidChange(listener: (status: WorkspaceTrustStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Trust of the open workspace, with why it is what it is. */
  status(): WorkspaceTrustStatus {
    const workspace = this.options.workspace();
    if (!workspace) {
      // With no folder open there is nothing a workspace could induce, but
      // the state stays restricted so the policy has a single default.
      return {
        workspace: null,
        state: 'restricted',
        decided: false,
        remote: false,
        canGrant: false,
      };
    }
    if (this.isRemote(workspace)) {
      return {
        workspace,
        state: 'restricted',
        decided: false,
        remote: true,
        canGrant: false,
      };
    }

    const match = this.findDecision(canonical(workspace));
    return {
      workspace,
      state: match?.decision.trusted ? 'trusted' : 'restricted',
      decided: Boolean(match?.exact),
      remote: false,
      canGrant: true,
    };
  }

  /** Convenience for callers that only need the boolean. */
  isTrusted(): boolean {
    return this.status().state === 'trusted';
  }

  /** Records that the user trusts the open workspace. */
  grant(): WorkspaceTrustStatus {
    return this.decide(true);
  }

  /** Returns the open workspace to Restricted Mode. */
  revoke(): WorkspaceTrustStatus {
    return this.decide(false);
  }

  /**
   * Trust verdict per installed extension under the current state. Disabled
   * extensions are included: the panel shows why they would be limited.
   */
  evaluate(records: InstalledExtensionRecord[]): ExtensionTrustVerdict[] {
    const state: WorkspaceTrustState = this.status().state;
    return records.map((record) => resolveExtensionTrust(record, state));
  }

  private decide(trusted: boolean): WorkspaceTrustStatus {
    const workspace = this.options.workspace();
    if (!workspace) {
      throw new WorkspaceTrustError('No hay ningún workspace abierto que marcar.');
    }
    if (this.isRemote(workspace)) {
      throw new WorkspaceTrustError(
        'Los workspaces remotos no pueden marcarse como confiables todavía.',
      );
    }

    const target = canonical(workspace);
    const decisions = this.read().filter((decision) => decision.workspace !== target);
    decisions.push({ workspace: target, trusted, decidedAt: new Date().toISOString() });
    // Oldest decisions go first when the list is bounded.
    decisions.sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : 0));
    try {
      this.options.store.write(decisions.slice(-this.maxDecisions));
    } catch (err) {
      throw new WorkspaceTrustError(
        `No se pudo guardar la decisión de confianza: ${(err as Error).message}`,
      );
    }

    const status = this.status();
    for (const listener of [...this.listeners]) {
      // A faulty subscriber must not undo a decision already persisted.
      try {
        listener(status);
      } catch (err) {
        this.warn(`trust listener failed: ${(err as Error).message}`);
      }
    }
    return status;
  }

  private read(): WorkspaceTrustDecision[] {
    try {
      return this.options.store.read();
    } catch (err) {
      this.warn(`no se pudieron leer las decisiones de confianza: ${(err as Error).message}`);
      return [];
    }
  }

  /** Exact decision if any, else the closest trusted ancestor. */
  private findDecision(
    target: string,
  ): { decision: WorkspaceTrustDecision; exact: boolean } | null {
    const decisions = this.read();
    const exact = decisions.find((decision) => canonical(decision.workspace) === target);
    if (exact) return { decision: exact, exact: true };

    // The closest ancestor decides, whichever way it went: an untrusted
    // folder shields its subtree from a trusted grandparent.
    let closest: WorkspaceTrustDecision | null = null;
    for (const decision of decisions) {
      const ancestor = canonical(decision.workspace);
      if (!isInside(target, ancestor)) continue;
      if (!closest || ancestor.length > canonical(closest.workspace).length) {
        closest = decision;
      }
    }
    return closest?.trusted ? { decision: closest, exact: false } : null;
  }
}

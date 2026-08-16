import type { WorkspaceTrustStore } from '../application/ports/workspace-trust-store';
import type { WorkspaceTrustDecision } from '../domain/workspace-trust';

export type ForgeConfig = Record<string, unknown>;

export interface ForgeWorkspaceTrustStoreOptions {
  readConfig: () => ForgeConfig;
  writeConfig: (config: ForgeConfig) => void;
}

const TRUST_KEY = 'workspaceTrust';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Trust decisions persisted next to the rest of Forge's configuration
 * (`forge-config.json`), under their own `workspaceTrust` key so they are
 * not entangled with the extension registry. Decoding is tolerant — an
 * entry Forge cannot understand is dropped, which downgrades to Restricted
 * Mode instead of inventing a decision — and writing inherits the atomic
 * tmp+rename the config facade already performs, like
 * `ForgeWorkspaceSettingsStore` does for workspace settings.
 */
export class ForgeWorkspaceTrustStore implements WorkspaceTrustStore {
  constructor(private readonly options: ForgeWorkspaceTrustStoreOptions) {}

  read(): WorkspaceTrustDecision[] {
    const raw = asRecord(this.options.readConfig()[TRUST_KEY]);
    const decisions = raw?.decisions;
    if (!Array.isArray(decisions)) return [];
    return decisions.flatMap((entry) => {
      const decision = asRecord(entry);
      if (!decision || typeof decision.workspace !== 'string' || !decision.workspace) return [];
      // Only an explicit `true` trusts: any other shape means "not trusted".
      return [{
        workspace: decision.workspace,
        trusted: decision.trusted === true,
        decidedAt: typeof decision.decidedAt === 'string' && decision.decidedAt
          ? decision.decidedAt
          : new Date(0).toISOString(),
      }];
    });
  }

  write(decisions: WorkspaceTrustDecision[]): void {
    const config = this.options.readConfig();
    config[TRUST_KEY] = { decisions };
    this.options.writeConfig(config);
  }
}

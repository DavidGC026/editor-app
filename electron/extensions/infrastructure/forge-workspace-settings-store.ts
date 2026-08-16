import * as fs from 'fs';
import * as path from 'path';
import type { ConfigurationScopeStore } from '../application/ports/user-configuration-store';

export interface ForgeWorkspaceSettingsStoreOptions {
  /** Root of the open local workspace. */
  workspaceDir: string;
  /** Diagnostics sink; defaults to console.warn. */
  warn?: (message: string) => void;
}

/**
 * Workspace-scope settings persisted in `<workspace>/.forge/settings.json`
 * (the same per-project folder the agent already uses). Reads tolerate a
 * missing or corrupt file — workspace settings must never block startup —
 * and writes are atomic (tmp + rename), matching forge-config.json.
 */
export class ForgeWorkspaceSettingsStore implements ConfigurationScopeStore {
  private readonly warn: (message: string) => void;

  constructor(private readonly options: ForgeWorkspaceSettingsStoreOptions) {
    this.warn = options.warn ?? ((message) => console.warn('[forge:config]', message));
  }

  private settingsPath(): string {
    return path.join(this.options.workspaceDir, '.forge', 'settings.json');
  }

  read(): Record<string, unknown> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath(), 'utf-8'));
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.warn(`no se pudo leer .forge/settings.json: ${(err as Error).message}`);
      }
      return {};
    }
  }

  write(values: Record<string, unknown>): void {
    const settingsPath = this.settingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const tmpPath = `${settingsPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(values, null, 2)}\n`, 'utf-8');
    fs.renameSync(tmpPath, settingsPath);
  }
}

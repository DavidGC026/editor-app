import type { ExtensionCatalog } from './ports/extension-catalog';
import type { ExtensionRegistry } from './ports/extension-registry';
import { isNewerExtensionVersion } from '../domain/extension-version';

export interface ExtensionUpdateInfo {
  id: string;
  installedVersion: string;
  latestVersion: string;
}

export interface CheckExtensionUpdatesOptions {
  catalog: ExtensionCatalog;
  registry: ExtensionRegistry;
  /** Diagnostics sink; defaults to console.warn. */
  warn?: (message: string) => void;
}

/**
 * Compares every installed extension against the catalog's latest version.
 * A per-extension catalog failure is reported as a warning, never as an
 * error: an offline marketplace must not break the installed list.
 */
export class CheckExtensionUpdates {
  private readonly warn: (message: string) => void;

  constructor(private readonly options: CheckExtensionUpdatesOptions) {
    this.warn = options.warn ?? ((message) => console.warn('[forge:ext]', message));
  }

  async check(): Promise<ExtensionUpdateInfo[]> {
    const updates: ExtensionUpdateInfo[] = [];
    for (const entry of this.options.registry.list()) {
      try {
        const meta = await this.options.catalog.latestMetadata(entry.id);
        if (isNewerExtensionVersion(meta.version, entry.version)) {
          updates.push({
            id: entry.id,
            installedVersion: entry.version,
            latestVersion: meta.version,
          });
        }
      } catch (err) {
        this.warn(`no se pudo comprobar updates de "${entry.id}": ${(err as Error).message}`);
      }
    }
    return updates;
  }
}

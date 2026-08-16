import type { InstalledExtensionRecord } from '../../domain/extension-manifest';

/** Persistence port for the installed extension inventory. */
export interface ExtensionRegistry {
  list(): InstalledExtensionRecord[];
  get(id: string): InstalledExtensionRecord | null;
  upsert(extension: InstalledExtensionRecord): void;
  remove(id: string): InstalledExtensionRecord | null;
}

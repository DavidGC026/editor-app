import type { ExtensionPackageStore } from './ports/extension-package-store';
import type { ExtensionRegistry } from './ports/extension-registry';
import type { ManifestReader } from './ports/manifest-reader';
import { ExtensionInstallError } from '../domain/extension-install-error';
import type { InstalledExtensionRecord } from '../domain/extension-manifest';

export interface RollbackExtensionOptions {
  packageStore: ExtensionPackageStore;
  registry: ExtensionRegistry;
  manifestReader: ManifestReader;
  /** Reads `<dir>/package.json`; injected so the use case stays fs-free. */
  readManifestSource: (dir: string) => string;
}

/**
 * Re-points the registry at the retained previous version. Both version
 * directories stay on disk, so a rollback can itself be rolled back (the
 * roles simply swap).
 */
export class RollbackExtension {
  constructor(private readonly options: RollbackExtensionOptions) {}

  rollback(extensionId: string): InstalledExtensionRecord {
    const current = this.options.registry.get(extensionId);
    if (!current) {
      throw new ExtensionInstallError(
        'rollback-unavailable',
        `"${extensionId}" no está instalada.`,
      );
    }
    const previous = current.previousVersion;
    const previousDir = previous
      ? this.options.packageStore.installedVersionDir(current.id, previous.version)
      : null;
    if (!previous || !previousDir) {
      throw new ExtensionInstallError(
        'rollback-unavailable',
        `"${extensionId}" no conserva una versión anterior a la que volver.`,
      );
    }

    const manifest = this.options.manifestReader.read(
      this.options.readManifestSource(previousDir),
    );
    const record: InstalledExtensionRecord = {
      ...manifest,
      dir: previousDir,
      ...(previous.sha256 ? { sha256: previous.sha256 } : {}),
      enabled: current.enabled,
      previousVersion: {
        version: current.version,
        ...(current.sha256 ? { sha256: current.sha256 } : {}),
      },
    };
    this.options.registry.upsert(record);
    return record;
  }
}

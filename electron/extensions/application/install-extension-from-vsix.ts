import type { ExtensionPackageStore } from './ports/extension-package-store';
import type { ExtensionRegistry } from './ports/extension-registry';
import { ExtensionInstallError } from '../domain/extension-install-error';
import type { InstalledExtensionRecord } from '../domain/extension-manifest';
import { checkVscodeEngine, FORGE_VSCODE_API_VERSION } from '../domain/vscode-engine';

export interface InstallExtensionFromVsixOptions {
  packageStore: ExtensionPackageStore;
  registry: ExtensionRegistry;
  /** Emulated VS Code API level checked against `engines.vscode`. */
  apiVersion?: string;
  /** Diagnostics sink; defaults to console.warn. */
  warn?: (message: string) => void;
}

/**
 * Transactional install pipeline: stage → engine policy → commit → registry.
 * Any failure before the registry update leaves the active version and its
 * registry entry untouched; staging leftovers are always discarded.
 */
export class InstallExtensionFromVsix {
  private readonly apiVersion: string;
  private readonly warn: (message: string) => void;

  constructor(private readonly options: InstallExtensionFromVsixOptions) {
    this.apiVersion = options.apiVersion ?? FORGE_VSCODE_API_VERSION;
    this.warn = options.warn ?? ((message) => console.warn('[forge:ext]', message));
  }

  install(vsixPath: string): InstalledExtensionRecord {
    const staged = this.options.packageStore.stage(vsixPath);
    try {
      const compatibility = checkVscodeEngine(staged.manifest.enginesVscode, this.apiVersion);
      if (compatibility === 'incompatible') {
        throw new ExtensionInstallError(
          'incompatible-engine',
          `"${staged.manifest.id}" requiere VS Code ${staged.manifest.enginesVscode} ` +
            `y Forge emula la API ${this.apiVersion}.`,
        );
      }
      if (compatibility === 'unknown' && staged.manifest.enginesVscode) {
        this.warn(
          `rango engines.vscode no reconocido "${staged.manifest.enginesVscode}" ` +
            `en ${staged.manifest.id}; se instala sin verificar compatibilidad.`,
        );
      }

      // An upgrade keeps the user's enabled/disabled choice for the extension.
      const previous = this.options.registry.get(staged.manifest.id);
      const dir = this.options.packageStore.commit(staged);
      const isVersionChange = Boolean(previous && previous.version !== staged.manifest.version);
      const record: InstalledExtensionRecord = {
        ...staged.manifest,
        dir,
        sha256: staged.sha256,
        enabled: previous ? previous.enabled : true,
        // Retain the replaced version (directory + provenance) for rollback.
        ...(isVersionChange && previous
          ? {
              previousVersion: {
                version: previous.version,
                ...(previous.sha256 ? { sha256: previous.sha256 } : {}),
              },
            }
          : {}),
      };
      this.options.registry.upsert(record);
      try {
        const keepDirs = [dir];
        if (isVersionChange && previous) keepDirs.push(previous.dir);
        this.options.packageStore.prune(record.id, keepDirs);
      } catch (err) {
        this.warn(`no se pudieron limpiar versiones antiguas de ${record.id}: ${
          (err as Error).message
        }`);
      }
      return record;
    } finally {
      // No-op after a successful commit (staging was renamed away); cleans
      // the extraction when any earlier stage rejected the package.
      this.options.packageStore.abort(staged);
    }
  }
}

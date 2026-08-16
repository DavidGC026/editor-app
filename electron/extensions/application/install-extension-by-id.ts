import type { CatalogExtensionMetadata, ExtensionCatalog } from './ports/extension-catalog';
import type { ExtensionRegistry } from './ports/extension-registry';
import type { InstallExtensionFromVsix } from './install-extension-from-vsix';
import { ExtensionInstallError } from '../domain/extension-install-error';
import type { InstalledExtensionRecord } from '../domain/extension-manifest';

export interface InstallExtensionByIdOptions {
  catalog: ExtensionCatalog;
  installer: InstallExtensionFromVsix;
  registry: ExtensionRegistry;
  /** Deletes a temp VSIX produced by the catalog; injected for tests. */
  deleteTempFile: (filePath: string) => void;
  /** Diagnostics sink; defaults to console.warn. */
  warn?: (message: string) => void;
  /** Safety bound for pathological dependency graphs. */
  maxExtensions?: number;
}

interface PlanStep {
  id: string;
  /** Required steps abort the whole install on failure; pack entries warn. */
  required: boolean;
}

/**
 * Marketplace install with up-front dependency resolution. The graph is
 * resolved from catalog metadata before anything downloads, ordered so
 * dependencies install before their dependents — a required dependency
 * that fails aborts *before* the requested extension is installed,
 * matching VS Code. `extensionPack` entries install best-effort. The
 * visited set makes dependency cycles terminate: every id is resolved at
 * most once per operation.
 */
export class InstallExtensionById {
  private readonly warn: (message: string) => void;
  private readonly maxExtensions: number;

  constructor(private readonly options: InstallExtensionByIdOptions) {
    this.warn = options.warn ?? ((message) => console.warn('[forge:ext]', message));
    this.maxExtensions = options.maxExtensions ?? 32;
  }

  async install(extensionId: string): Promise<InstalledExtensionRecord> {
    const rootId = extensionId.trim().toLowerCase();
    const visited = new Set<string>();
    const pending: PlanStep[] = [];
    await this.resolve(rootId, true, rootId, visited, pending);

    let rootRecord: InstalledExtensionRecord | null = null;
    while (pending.length > 0) {
      const step = pending.shift()!;
      const isRoot = step.id === rootId;
      // The root always (re)installs — that is also the update path.
      if (!isRoot && this.options.registry.get(step.id)) continue;

      let record: InstalledExtensionRecord;
      try {
        record = await this.downloadAndInstall(step.id);
      } catch (err) {
        if (isRoot) throw err;
        if (step.required) {
          throw new ExtensionInstallError(
            'dependency-failed',
            `"${rootId}" requiere "${step.id}", que no se pudo instalar: ${
              (err as Error).message
            }`,
          );
        }
        this.warn(`extensión del pack "${step.id}" omitida: ${(err as Error).message}`);
        continue;
      }
      if (isRoot) rootRecord = record;

      // Safety net: manifest dependencies the catalog metadata missed
      // resolve now and jump the queue so they install right away.
      const missing: PlanStep[] = [];
      for (const dependencyId of record.extensionDependencies) {
        if (visited.has(dependencyId) || this.options.registry.get(dependencyId)) continue;
        await this.resolve(dependencyId, true, rootId, visited, missing);
      }
      pending.unshift(...missing);
    }

    if (!rootRecord) {
      throw new ExtensionInstallError('not-found', `"${extensionId}" no se pudo instalar.`);
    }
    return rootRecord;
  }

  /** Depth-first post-order: a node's required deps precede it in `plan`. */
  private async resolve(
    id: string,
    required: boolean,
    rootId: string,
    visited: Set<string>,
    plan: PlanStep[],
  ): Promise<void> {
    if (visited.has(id)) return;
    visited.add(id);
    if (visited.size > this.maxExtensions) {
      throw new ExtensionInstallError(
        'dependency-failed',
        `La resolución de dependencias superó ${this.maxExtensions} extensiones.`,
      );
    }
    const isRoot = id === rootId;
    // Installed dependencies stay at their current version — no metadata
    // fetch, no implicit update.
    if (!isRoot && this.options.registry.get(id)) return;

    let meta: CatalogExtensionMetadata;
    try {
      meta = await this.options.catalog.latestMetadata(id);
    } catch (err) {
      if (isRoot) throw err;
      if (required) {
        throw new ExtensionInstallError(
          'dependency-failed',
          `"${rootId}" requiere "${id}", que no se pudo resolver: ${(err as Error).message}`,
        );
      }
      this.warn(`extensión del pack "${id}" omitida: ${(err as Error).message}`);
      return;
    }

    for (const dependencyId of meta.extensionDependencies) {
      await this.resolve(dependencyId, true, rootId, visited, plan);
    }
    plan.push({ id, required });
    for (const packId of meta.extensionPack) {
      await this.resolve(packId, false, rootId, visited, plan);
    }
  }

  private async downloadAndInstall(id: string): Promise<InstalledExtensionRecord> {
    const vsixPath = await this.options.catalog.downloadLatestVsix(id);
    try {
      const record = this.options.installer.install(vsixPath);
      if (record.id !== id) {
        // A download that installs under an identity other than the one
        // asked for is publisher confusion, not a naming quirk: the user
        // approved `id`, so anything else is rolled back immediately.
        this.rollbackMismatched(record);
        throw new ExtensionInstallError(
          'identity-mismatch',
          `Se pidió "${id}" pero el paquete descargado declara "${record.id}".`,
        );
      }
      return record;
    } finally {
      this.options.deleteTempFile(vsixPath);
    }
  }

  /** Best-effort undo of an install rejected after the registry write. */
  private rollbackMismatched(record: InstalledExtensionRecord): void {
    try {
      this.options.registry.remove(record.id);
    } catch (err) {
      this.warn(
        `no se pudo retirar del registro la extensión "${record.id}" con identidad `
          + `inesperada: ${(err as Error).message}`,
      );
    }
  }
}

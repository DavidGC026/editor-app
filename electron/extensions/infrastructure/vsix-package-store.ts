import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { readZipEntries, type ZipEntry } from '../../zip';
import type {
  ExtensionPackageStore,
  StagedExtensionPackage,
} from '../application/ports/extension-package-store';
import type { ManifestReader } from '../application/ports/manifest-reader';
import { ExtensionInstallError } from '../domain/extension-install-error';
import {
  describeManifestIssue,
  type InstalledExtensionRecord,
  type ManifestValidationIssue,
} from '../domain/extension-manifest';

const STAGING_DIR = '.staging';
const MANIFEST_ENTRY = 'extension/package.json';
const CONTENT_PREFIX = 'extension/';

export interface VsixPackageStoreOptions {
  /** Root of the extension store (e.g. `<userData>/extensions`). */
  rootDir: () => string;
  manifestReader: ManifestReader;
  /** Limits are configurable for tests; defaults fit real marketplace VSIX. */
  maxEntries?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

// A manifest without engines.vscode is still installable (common in
// hand-built VSIX); every other validation issue rejects the package now
// that staging makes rejection free of side effects.
function fatalIssues(issues: ManifestValidationIssue[]): ManifestValidationIssue[] {
  return issues.filter(
    (issue) => !(issue.code === 'missing-field' && issue.field === 'engines.vscode'),
  );
}

/** Filesystem adapter: staging + atomic promote into versioned directories. */
export class VsixPackageStore implements ExtensionPackageStore {
  private readonly maxEntries: number;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;

  constructor(private readonly options: VsixPackageStoreOptions) {
    this.maxEntries = options.maxEntries ?? 20_000;
    this.maxFileBytes = options.maxFileBytes ?? 128 * 1024 * 1024;
    this.maxTotalBytes = options.maxTotalBytes ?? 512 * 1024 * 1024;
  }

  stage(vsixPath: string): StagedExtensionPackage {
    const sha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(vsixPath))
      .digest('hex');
    const entries = readZipEntries(vsixPath).filter(
      (entry) => !entry.isDirectory && entry.name.startsWith(CONTENT_PREFIX),
    );

    const manifestEntry = entries.find((entry) => entry.name === MANIFEST_ENTRY);
    if (!manifestEntry) {
      throw new ExtensionInstallError(
        'missing-manifest',
        'El archivo no parece un VSIX válido (falta extension/package.json).',
      );
    }
    const result = this.options.manifestReader.readWithDiagnostics(
      manifestEntry.getData().toString('utf-8'),
    );
    const rejected = result.ok ? fatalIssues(result.issues) : result.issues;
    if (!result.ok || rejected.length > 0) {
      throw new ExtensionInstallError(
        'invalid-manifest',
        `El manifiesto de la extensión no es válido: ${
          rejected.map(describeManifestIssue).join('; ')
        }.`,
      );
    }

    if (entries.length > this.maxEntries) {
      throw new ExtensionInstallError(
        'entry-limit-exceeded',
        `El paquete contiene ${entries.length} archivos (límite ${this.maxEntries}).`,
      );
    }

    const stagingDir = path.join(
      this.options.rootDir(),
      STAGING_DIR,
      `${result.manifest.id}-${result.manifest.version}-${Date.now()}-${
        crypto.randomBytes(4).toString('hex')
      }`,
    );
    fs.mkdirSync(stagingDir, { recursive: true });

    try {
      this.extract(entries, stagingDir);
    } catch (err) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw err;
    }

    return { manifest: result.manifest, sha256, stagingDir };
  }

  commit(staged: StagedExtensionPackage): string {
    const targetDir = this.versionDir(staged.manifest.id, staged.manifest.version);
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });

    // Reinstalls of the same version park the old directory aside so the
    // promote step is a single rename; the parked copy restores on failure.
    const parkedDir = fs.existsSync(targetDir) ? `${targetDir}.replaced-${Date.now()}` : null;
    if (parkedDir) fs.renameSync(targetDir, parkedDir);
    try {
      fs.renameSync(staged.stagingDir, targetDir);
    } catch (err) {
      if (parkedDir) {
        fs.renameSync(parkedDir, targetDir);
      } else {
        // Fresh install: drop the per-extension directory we just created
        // if the failed promote left it empty (rmdirSync refuses otherwise).
        try { fs.rmdirSync(path.dirname(targetDir)); } catch { /* not empty */ }
      }
      throw new ExtensionInstallError(
        'commit-failed',
        `No se pudo promover el paquete al almacén: ${(err as Error).message}`,
      );
    }
    if (parkedDir) fs.rmSync(parkedDir, { recursive: true, force: true });
    return targetDir;
  }

  abort(staged: StagedExtensionPackage): void {
    fs.rmSync(staged.stagingDir, { recursive: true, force: true });
  }

  prune(extensionId: string, keepDirs: string[]): void {
    const extensionRoot = path.join(this.options.rootDir(), extensionId.toLowerCase());
    let versions: string[];
    try {
      versions = fs.readdirSync(extensionRoot);
    } catch {
      return;
    }
    const keep = new Set(keepDirs.map((dir) => path.resolve(dir)));
    for (const version of versions) {
      const dir = path.resolve(extensionRoot, version);
      if (!keep.has(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  installedVersionDir(extensionId: string, version: string): string | null {
    try {
      const dir = this.versionDir(extensionId, version);
      return fs.existsSync(path.join(dir, 'package.json')) ? dir : null;
    } catch {
      return null;
    }
  }

  sweep(records: InstalledExtensionRecord[]): string[] {
    const root = path.resolve(this.options.rootDir());
    let topLevel: fs.Dirent[];
    try {
      topLevel = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return [];
    }

    // Directories a record still references: the active version and, when
    // retained, the previous one. Keyed by top-level id segment. Legacy flat
    // installs reference the id directory itself.
    const referenced = new Map<string, Set<string>>();
    for (const record of records) {
      const dir = path.resolve(record.dir);
      if (!dir.startsWith(root + path.sep)) continue;
      const idSegment = path.relative(root, dir).split(path.sep)[0];
      const keep = referenced.get(idSegment) ?? new Set<string>();
      keep.add(dir);
      if (record.previousVersion) {
        const previousDir = this.installedVersionDir(record.id, record.previousVersion.version);
        if (previousDir) keep.add(path.resolve(previousDir));
      }
      referenced.set(idSegment, keep);
    }

    const removed: string[] = [];
    const remove = (target: string) => {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(target);
    };

    for (const dirent of topLevel) {
      if (!dirent.isDirectory()) continue;
      const dir = path.join(root, dirent.name);

      // The sweep runs at startup, when no install is in flight: any staging
      // directory left behind is abandoned.
      if (dirent.name === STAGING_DIR) {
        for (const stale of fs.readdirSync(dir)) remove(path.join(dir, stale));
        continue;
      }

      const keep = referenced.get(dirent.name);
      if (!keep) {
        remove(dir);
        continue;
      }
      // Legacy flat install: the record owns the whole id directory.
      if (keep.has(path.resolve(dir))) continue;
      for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const subDir = path.join(dir, sub.name);
        if (!keep.has(path.resolve(subDir))) remove(subDir);
      }
    }
    return removed;
  }

  private versionDir(id: string, version: string): string {
    // The version becomes a path segment; refuse separators outright.
    if (!/^[\w.-]+$/.test(version)) {
      throw new ExtensionInstallError(
        'unsafe-path',
        `La versión "${version}" no puede usarse como directorio.`,
      );
    }
    return path.join(this.options.rootDir(), id.toLowerCase(), version);
  }

  private extract(entries: ZipEntry[], stagingDir: string): void {
    let totalBytes = 0;
    for (const entry of entries) {
      const rel = entry.name.slice(CONTENT_PREFIX.length);
      const target = path.resolve(stagingDir, rel);
      if (target !== stagingDir && !target.startsWith(stagingDir + path.sep)) {
        throw new ExtensionInstallError(
          'unsafe-path',
          `La entrada "${entry.name}" escapa del directorio del paquete.`,
        );
      }
      const data = entry.getData();
      if (data.length > this.maxFileBytes) {
        throw new ExtensionInstallError(
          'file-too-large',
          `"${entry.name}" pesa ${data.length} bytes (límite ${this.maxFileBytes}).`,
        );
      }
      totalBytes += data.length;
      if (totalBytes > this.maxTotalBytes) {
        throw new ExtensionInstallError(
          'package-too-large',
          `El paquete supera el límite de ${this.maxTotalBytes} bytes.`,
        );
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
  }
}

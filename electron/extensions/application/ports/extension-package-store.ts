import type {
  InstalledExtensionRecord,
  NormalizedExtensionManifest,
} from '../../domain/extension-manifest';

/** A package extracted and validated in staging, not yet visible to Forge. */
export interface StagedExtensionPackage {
  manifest: NormalizedExtensionManifest;
  /** sha256 (hex) of the original VSIX. */
  sha256: string;
  /** Directory holding the validated extraction, outside the active store. */
  stagingDir: string;
}

/**
 * Transactional storage for extension packages. `stage` never touches the
 * active version; only `commit` promotes the staging directory into the
 * versioned store, so a failure at any earlier step leaves the current
 * installation intact.
 */
export interface ExtensionPackageStore {
  /** Extracts and validates a VSIX into staging. Throws `ExtensionInstallError`. */
  stage(vsixPath: string): StagedExtensionPackage;
  /** Promotes staging into `<root>/<id>/<version>` and returns that directory. */
  commit(staged: StagedExtensionPackage): string;
  /** Discards a staged package. Safe to call after a successful commit. */
  abort(staged: StagedExtensionPackage): void;
  /** Removes installed versions of `extensionId` not listed in `keepDirs`. */
  prune(extensionId: string, keepDirs: string[]): void;
  /** Directory of an installed version, or null when it is not on disk. */
  installedVersionDir(extensionId: string, version: string): string | null;
  /**
   * Startup inventory: removes store directories no record references —
   * abandoned staging, ids without a registry entry (a post-commit failure
   * can leave them behind) and version directories that are neither the
   * active one nor the retained previous one. Returns the removed paths.
   */
  sweep(records: InstalledExtensionRecord[]): string[];
}

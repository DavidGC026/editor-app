/** Catalog metadata for the latest published version of an extension. */
export interface CatalogExtensionMetadata {
  /** Normalized `publisher.name`. */
  id: string;
  version: string;
  /** Required dependency ids declared by the published manifest. */
  extensionDependencies: string[];
  /** Best-effort extension-pack ids declared by the published manifest. */
  extensionPack: string[];
}

/** Source of installable packages (Open VSX today). */
export interface ExtensionCatalog {
  /**
   * Resolves the latest published version and its dependency metadata
   * without downloading the package. Throws `ExtensionInstallError` with
   * `not-found` / `download-failed`.
   */
  latestMetadata(extensionId: string): Promise<CatalogExtensionMetadata>;

  /**
   * Downloads the latest VSIX for `extensionId` (`publisher.name`) and
   * returns the path of a temporary file owned by the caller, who must
   * delete it after installing. Throws `ExtensionInstallError` with
   * `not-found` / `download-failed`.
   */
  downloadLatestVsix(extensionId: string): Promise<string>;
}

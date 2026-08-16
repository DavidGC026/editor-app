import type {
  ManifestReadResult,
  NormalizedExtensionManifest,
} from '../../domain/extension-manifest';

/** Port for turning an untrusted manifest document into domain data. */
export interface ManifestReader {
  /** Legacy mode: throws on unparseable input and silently applies
   *  `unknown.unknown` defaults. Kept until Milestone 1's transactional
   *  package manager replaces every caller. */
  read(source: string): NormalizedExtensionManifest;
  /** Validating mode: never throws; reports discriminated issues alongside
   *  the manifest when the document is recoverable. */
  readWithDiagnostics(source: string): ManifestReadResult;
}

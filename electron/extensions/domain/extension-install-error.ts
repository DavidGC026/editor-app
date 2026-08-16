/** Discriminated failures raised by the transactional install pipeline. A
 *  code always identifies the stage that rejected the package, so callers and
 *  telemetry never need to parse human-readable messages. */
export type ExtensionInstallErrorCode =
  | 'missing-manifest'
  | 'invalid-manifest'
  | 'unsafe-path'
  | 'entry-limit-exceeded'
  | 'file-too-large'
  | 'package-too-large'
  | 'incompatible-engine'
  | 'commit-failed'
  | 'rollback-unavailable'
  | 'not-found'
  | 'download-failed'
  | 'dependency-failed';

export class ExtensionInstallError extends Error {
  constructor(
    readonly code: ExtensionInstallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionInstallError';
  }
}

// ── ContributionRegistry ────────────────────────────────────────────────
//
// Ownership and cleanup for extension contributions. Every applied
// contribution belongs to the extension that declared it; when that
// extension leaves the active set (disabled, uninstalled) or changes
// (update, rollback), its contributions are retired via the disposables
// its applier returned — nothing else is touched.
//
// The registry is host-agnostic and dependency-free on purpose: the
// renderer instantiates it over Monaco, tests over a fake host, and new
// contribution families plug in as appliers without modifying this file
// (open/closed).

export interface Disposable {
  dispose(): void;
}

/** Minimum shape the registry needs from an extension payload. */
export interface ContributionSource {
  id: string;
  /** Contributions re-apply when this changes (updates, rollbacks). */
  version: string;
}

/**
 * Applies one family of contributions (themes, snippets, …) for a single
 * extension. Returns the cleanups that retire them; families the host
 * cannot retire (e.g. Monaco themes, which have no `undefineTheme`) return
 * an empty list and stay inert until the next full reload.
 */
export interface ContributionApplier<Host, Ext extends ContributionSource> {
  readonly family: string;
  apply(host: Host, extension: Ext): Disposable[];
}

export interface ContributionSyncResult {
  /** Extension ids applied in this pass (new or re-applied). */
  applied: string[];
  /** Extension ids whose contributions were retired in this pass. */
  retired: string[];
}

interface AppliedExtension {
  fingerprint: string;
  disposables: Disposable[];
}

// Note: no TS parameter properties here — this module also runs unbundled
// under Node's strip-only type erasure in the test suite.
export class ContributionRegistry<Host, Ext extends ContributionSource> {
  private readonly applied = new Map<string, AppliedExtension>();
  private readonly appliers: ContributionApplier<Host, Ext>[];
  private readonly warn: (message: string) => void;

  constructor(
    appliers: ContributionApplier<Host, Ext>[],
    warn?: (message: string) => void,
  ) {
    this.appliers = appliers;
    this.warn = warn ?? ((message) => console.warn('[forge:ext]', message));
  }

  /**
   * Reconciles the applied state with `extensions` (the active set):
   * missing extensions are retired, new ones applied, and changed ones
   * (different fingerprint) retired then re-applied. Unchanged extensions
   * are not touched, so toggling one extension never re-registers the rest.
   */
  sync(host: Host, extensions: Ext[]): ContributionSyncResult {
    const result: ContributionSyncResult = { applied: [], retired: [] };

    for (const [id, entry] of [...this.applied]) {
      const next = extensions.find((ext) => ext.id === id);
      if (next && this.fingerprint(next) === entry.fingerprint) continue;
      this.retire(id, entry);
      result.retired.push(id);
    }

    for (const ext of extensions) {
      if (this.applied.has(ext.id)) continue;
      this.applied.set(ext.id, {
        fingerprint: this.fingerprint(ext),
        disposables: this.applyOne(host, ext),
      });
      result.applied.push(ext.id);
    }
    return result;
  }

  /** Retires everything, e.g. before re-attaching to a fresh host. */
  reset(): void {
    for (const [id, entry] of [...this.applied]) this.retire(id, entry);
  }

  private fingerprint(ext: Ext): string {
    return ext.version;
  }

  private applyOne(host: Host, ext: Ext): Disposable[] {
    const disposables: Disposable[] = [];
    for (const applier of this.appliers) {
      // One faulty family (or one faulty extension) must not block the rest.
      try {
        disposables.push(...applier.apply(host, ext));
      } catch (err) {
        this.warn(`applying ${applier.family} of "${ext.id}" failed: ${(err as Error).message}`);
      }
    }
    return disposables;
  }

  private retire(id: string, entry: AppliedExtension): void {
    for (const disposable of entry.disposables) {
      try {
        disposable.dispose();
      } catch (err) {
        this.warn(`retiring a contribution of "${id}" failed: ${(err as Error).message}`);
      }
    }
    this.applied.delete(id);
  }
}

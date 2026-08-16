// ── ContextKeyService ───────────────────────────────────────────────────
//
// Renderer-side registry of context keys (`workspaceOpen`, `panelVisible`,
// …) that when-clauses from extension contributions evaluate against.
// Unknown keys read as `undefined` (falsy), so a clause that names a key
// Forge does not publish yet simply never matches — the safe default.
//
// Erasable TypeScript on purpose: the test suite runs it unbundled under
// Node's type stripping.

// Explicit .ts extension: this module also runs unbundled under Node's
// type stripping in the test suite, where extensionless imports fail.
import { parseWhenClause, type WhenClause } from './whenClause.ts';

export class ContextKeyService {
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Set<() => void>();
  /** Parse cache; `null` marks clauses already reported as malformed. */
  private readonly parsed = new Map<string, WhenClause | null>();
  private readonly warn: (message: string) => void;

  constructor(warn?: (message: string) => void) {
    this.warn = warn ?? ((message) => console.warn('[forge:ext]', message));
  }

  /** Sets a context key; `undefined` removes it. No-op when unchanged. */
  set(key: string, value: unknown): void {
    if (value === undefined) {
      if (!this.values.delete(key)) return;
    } else {
      if (this.values.has(key) && this.values.get(key) === value) return;
      this.values.set(key, value);
    }
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (err) {
        this.warn(`context-key listener failed: ${(err as Error).message}`);
      }
    }
  }

  get(key: string): unknown {
    return this.values.get(key);
  }

  /** Notifies after any key changes. Returns the unsubscribe function. */
  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Evaluates a when-clause against the current keys. A null/empty clause
   *  always matches; a malformed one warns once and never matches.
   *  `extras` overlays transient keys (e.g. `resourceExtname` while a
   *  context menu is open) without mutating the shared state. */
  match(expression: string | null | undefined, extras?: Record<string, unknown>): boolean {
    if (expression === null || expression === undefined || !expression.trim()) return true;
    let clause = this.parsed.get(expression);
    if (clause === undefined) {
      clause = parseWhenClause(expression);
      this.parsed.set(expression, clause);
      if (clause === null) this.warn(`malformed when-clause ignored: "${expression}"`);
    }
    return clause !== null && clause.evaluate((key) => (
      extras !== undefined && key in extras ? extras[key] : this.values.get(key)
    ));
  }
}

/** Shared instance the workbench publishes its keys into. */
export const contextKeys = new ContextKeyService();

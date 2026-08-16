// ── TextMate grammar service (renderer) ─────────────────────────────────
//
// Real syntax highlighting from `contributes.grammars`: raw grammar
// sources (JSON or plist) arrive in the extension payload, vscode-textmate
// compiles them with the Oniguruma regex engine (WASM), and the service
// exposes Monaco-compatible tokens providers per language id.
//
// The Oniguruma engine is injected (`createOnigLib`) instead of imported:
// the app wires the vite-bundled WASM, the test suite wires the bytes from
// node_modules, and this module stays free of bundler-specific imports.

import * as vsctmNamespace from 'vscode-textmate';
import type {
  IGrammar,
  IOnigLib,
  Registry as TextmateRegistry,
  StateStack,
} from 'vscode-textmate';
import type { Disposable } from './contributionRegistry';

// vscode-textmate ships a CJS bundle whose named exports Node's ESM lexer
// cannot detect; under unbundled Node (test suite) they live on `default`.
const vsctm = (vsctmNamespace as unknown as { default?: typeof vsctmNamespace }).default
  ?? vsctmNamespace;
const { INITIAL, Registry, parseRawGrammar } = vsctm;

/** One grammar as shipped in the extension payload. */
export interface GrammarSource {
  language: string | null;
  scopeName: string;
  path: string;
  content: string;
  embeddedLanguages: Record<string, string>;
  injectTo: string[];
}

// Structural mirror of monaco.languages.TokensProvider (coarse mode), so
// this module needs no Monaco types.
export interface TokensProviderLike {
  getInitialState(): TokenizerStateLike;
  tokenize(line: string, state: TokenizerStateLike): {
    tokens: { startIndex: number; scopes: string }[];
    endState: TokenizerStateLike;
  };
}

export interface TokenizerStateLike {
  clone(): TokenizerStateLike;
  equals(other: TokenizerStateLike): boolean;
}

class TmTokenizerState implements TokenizerStateLike {
  readonly ruleStack: StateStack;

  constructor(ruleStack: StateStack) {
    this.ruleStack = ruleStack;
  }

  clone(): TokenizerStateLike {
    return new TmTokenizerState(this.ruleStack);
  }

  equals(other: TokenizerStateLike): boolean {
    return other instanceof TmTokenizerState && this.ruleStack.equals(other.ruleStack);
  }
}

/** Monaco theme rules match token scopes by dotted prefix, so the deepest
 *  TextMate scope of each token carries the most specific color. */
function tokensProviderFor(grammar: IGrammar): TokensProviderLike {
  return {
    getInitialState: () => new TmTokenizerState(INITIAL),
    tokenize: (line, state) => {
      const result = grammar.tokenizeLine(line, (state as TmTokenizerState).ruleStack);
      return {
        tokens: result.tokens.map((token) => ({
          startIndex: token.startIndex,
          scopes: token.scopes[token.scopes.length - 1] ?? '',
        })),
        endState: new TmTokenizerState(result.ruleStack),
      };
    },
  };
}

export interface TextmateGrammarServiceOptions {
  /** Loads the Oniguruma engine; called once, on first tokenizer demand. */
  createOnigLib: () => Promise<IOnigLib>;
  warn?: (message: string) => void;
}

export class TextmateGrammarService {
  /** scopeName → source; first declaration of a scope wins. */
  private readonly sources = new Map<string, GrammarSource>();
  /** language id → scopeName; first declaration wins. */
  private readonly byLanguage = new Map<string, string>();
  private registry: TextmateRegistry | null = null;
  private readonly createOnigLib: () => Promise<IOnigLib>;
  private readonly warn: (message: string) => void;

  constructor(options: TextmateGrammarServiceOptions) {
    this.createOnigLib = options.createOnigLib;
    this.warn = options.warn ?? ((message) => console.warn('[forge:ext]', message));
  }

  /** Registers one grammar source. Disposing forgets it and drops the
   *  compiled registry so stale grammars cannot be served afterwards. */
  register(grammar: GrammarSource): Disposable {
    const ownsScope = !this.sources.has(grammar.scopeName);
    if (ownsScope) this.sources.set(grammar.scopeName, grammar);
    const ownsLanguage = grammar.language !== null && !this.byLanguage.has(grammar.language);
    if (ownsLanguage) this.byLanguage.set(grammar.language as string, grammar.scopeName);

    return {
      dispose: () => {
        if (ownsScope && this.sources.get(grammar.scopeName) === grammar) {
          this.sources.delete(grammar.scopeName);
          this.invalidateRegistry();
        }
        if (ownsLanguage && this.byLanguage.get(grammar.language as string) === grammar.scopeName) {
          this.byLanguage.delete(grammar.language as string);
        }
      },
    };
  }

  scopeForLanguage(languageId: string): string | null {
    return this.byLanguage.get(languageId) ?? null;
  }

  /** Compiles the grammar mapped to `languageId` into a tokens provider;
   *  null when no grammar covers the language or compilation failed. */
  async createTokensProvider(languageId: string): Promise<TokensProviderLike | null> {
    const scopeName = this.byLanguage.get(languageId);
    if (!scopeName) return null;
    try {
      const grammar = await this.ensureRegistry().loadGrammar(scopeName);
      return grammar ? tokensProviderFor(grammar) : null;
    } catch (err) {
      this.warn(`compiling grammar "${scopeName}" failed: ${(err as Error).message}`);
      return null;
    }
  }

  private ensureRegistry(): TextmateRegistry {
    if (!this.registry) {
      this.registry = new Registry({
        onigLib: this.createOnigLib(),
        loadGrammar: async (scopeName) => {
          const source = this.sources.get(scopeName);
          if (!source) return null;
          try {
            // parseRawGrammar picks JSON vs plist from the filename hint.
            return parseRawGrammar(source.content, source.path);
          } catch (err) {
            this.warn(`parsing grammar "${scopeName}" failed: ${(err as Error).message}`);
            return null;
          }
        },
        getInjections: (scopeName) =>
          [...this.sources.values()]
            .filter((source) => source.injectTo.includes(scopeName))
            .map((source) => source.scopeName),
      });
    }
    return this.registry;
  }

  // The Registry caches compiled grammars by scope; after a source is
  // retired (uninstall, disable, update) the cache must not outlive it.
  private invalidateRegistry(): void {
    this.registry?.dispose();
    this.registry = null;
  }
}

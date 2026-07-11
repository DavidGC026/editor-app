// ─────────────────────────────────────────────────────────────────────────
// Renderer-side LSP client.
//
// Responsibilities:
//   • Track which file paths are "open" (LSP-wise) and their versions.
//   • Push textDocument/didOpen, didChange, didClose to the language server
//     (didChange is debounced).
//   • Register Monaco completion + hover providers that round-trip through
//     the language server.
//   • Listen for textDocument/publishDiagnostics and translate them into
//     Monaco markers on the matching model.
//
// The actual JSON-RPC + child process lives in the Electron main process
// (electron/lsp-manager.ts). This module just talks to it via the bridge
// exposed in preload.ts (window.electronAPI.lsp).
// ─────────────────────────────────────────────────────────────────────────
import type * as MonacoNS from 'monaco-editor';
import type { LspDiagnostic, LspPublishDiagnosticsParams, Problem } from '../types';

type Monaco = typeof MonacoNS;
type ProblemsHandler = (filePath: string, problems: Problem[]) => void;

// ── Path / URI helpers ───────────────────────────────────────────────────

/** Convert an absolute filesystem path to a file:// URI.
 *
 *  Handles Windows drive letters (C:\foo → file:///C:/foo) and forward
 *  slashes consistently. Each segment is URI-encoded so spaces and unicode
 *  characters survive the round-trip.
 */
export function pathToFileUri(p: string): string {
  if (!p) return '';
  let s = p.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(s)) {
    s = '/' + s;
  }
  return (
    'file://' +
    s
      .split('/')
      .map((seg) => encodeURIComponent(seg).replace(/%3A/g, ':'))
      .join('/')
  );
}

function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  try {
    const url = new URL(uri);
    let p = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1);
    return p;
  } catch {
    return decodeURIComponent(uri.replace(/^file:\/\//, ''));
  }
}

/** Map a file path to the LSP `languageId`. Returns null for paths the
 *  TypeScript language server doesn't care about — callers should skip
 *  LSP traffic for those. */
export function getLspLanguageId(
  filePath: string
): 'typescript' | 'typescriptreact' | 'javascript' | 'javascriptreact' | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tsx')) return 'typescriptreact';
  if (lower.endsWith('.ts') && !lower.endsWith('.d.ts')) return 'typescript';
  if (lower.endsWith('.d.ts')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'javascriptreact';
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  )
    return 'javascript';
  return null;
}

// ── Document symbols (Outline) ───────────────────────────────────────────

export interface OutlineSymbol {
  name: string;
  kind: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  depth: number;
}

function flattenDocumentSymbols(
  symbols: any[],
  depth = 0,
  out: OutlineSymbol[] = [],
): OutlineSymbol[] {
  for (const sym of symbols) {
    if (!sym?.name || !sym?.range?.start) continue;
    out.push({
      name: sym.name,
      kind: typeof sym.kind === 'number' ? sym.kind : 0,
      startLine: sym.range.start.line + 1,
      startColumn: sym.range.start.character + 1,
      endLine: (sym.range.end?.line ?? sym.range.start.line) + 1,
      depth,
    });
    if (Array.isArray(sym.children) && sym.children.length > 0) {
      flattenDocumentSymbols(sym.children, depth + 1, out);
    }
  }
  return out;
}

// ── LSP → Monaco conversions ─────────────────────────────────────────────

function convertSeverity(
  monaco: Monaco,
  severity?: number
): MonacoNS.MarkerSeverity {
  // LSP: 1=Error, 2=Warning, 3=Info, 4=Hint
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Error;
  }
}

function diagnosticsToMarkers(
  monaco: Monaco,
  diags: LspDiagnostic[]
): MonacoNS.editor.IMarkerData[] {
  return diags.map((d) => ({
    severity: convertSeverity(monaco, d.severity),
    startLineNumber: (d.range?.start?.line ?? 0) + 1,
    startColumn: (d.range?.start?.character ?? 0) + 1,
    endLineNumber: (d.range?.end?.line ?? 0) + 1,
    endColumn: (d.range?.end?.character ?? 0) + 1,
    message: d.message || '',
    source: d.source || 'typescript',
    code:
      typeof d.code === 'number' || typeof d.code === 'string'
        ? String(d.code)
        : undefined,
  }));
}

// LSP CompletionItemKind → Monaco CompletionItemKind
function convertCompletionKind(
  monaco: Monaco,
  kind?: number
): MonacoNS.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 1: return K.Text;
    case 2: return K.Method;
    case 3: return K.Function;
    case 4: return K.Constructor;
    case 5: return K.Field;
    case 6: return K.Variable;
    case 7: return K.Class;
    case 8: return K.Interface;
    case 9: return K.Module;
    case 10: return K.Property;
    case 11: return K.Unit;
    case 12: return K.Value;
    case 13: return K.Enum;
    case 14: return K.Keyword;
    case 15: return K.Snippet;
    case 16: return K.Color;
    case 17: return K.File;
    case 18: return K.Reference;
    case 19: return K.Folder;
    case 20: return K.EnumMember;
    case 21: return K.Constant;
    case 22: return K.Struct;
    case 23: return K.Event;
    case 24: return K.Operator;
    case 25: return K.TypeParameter;
    default: return K.Text;
  }
}

function convertCompletionItem(
  monaco: Monaco,
  item: any,
  defaultRange: MonacoNS.IRange
): MonacoNS.languages.CompletionItem {
  const insertText =
    typeof item.insertText === 'string' ? item.insertText : item.label;
  const isSnippet = item.insertTextFormat === 2; // 1=PlainText, 2=Snippet

  // Range: prefer textEdit.range, fall back to defaultRange.
  let range: MonacoNS.IRange = defaultRange;
  const te = item.textEdit;
  if (te && te.range) {
    range = {
      startLineNumber: te.range.start.line + 1,
      startColumn: te.range.start.character + 1,
      endLineNumber: te.range.end.line + 1,
      endColumn: te.range.end.character + 1,
    };
  }

  // Documentation: LSP allows string OR { kind, value }.
  let documentation: string | MonacoNS.IMarkdownString | undefined;
  if (typeof item.documentation === 'string') {
    documentation = item.documentation;
  } else if (item.documentation && typeof item.documentation === 'object') {
    documentation = {
      value: item.documentation.value || '',
      isTrusted: false,
    };
  }

  return {
    label:
      typeof item.label === 'string'
        ? item.label
        : item.label?.label || String(item.label || ''),
    kind: convertCompletionKind(monaco, item.kind),
    detail: item.detail,
    documentation,
    insertText: te?.newText ?? insertText,
    insertTextRules: isSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: !!item.preselect,
    range,
    tags: Array.isArray(item.tags) ? item.tags : undefined,
    // Carry the original LSP item so resolve() can use it later if needed.
    _lsp: item,
  } as unknown as MonacoNS.languages.CompletionItem;
}

// LSP hover (string | MarkupContent | (string|MarkedString)[]) → Monaco contents
function convertHoverContents(
  contents: any
): MonacoNS.IMarkdownString[] {
  if (!contents) return [];
  const out: MonacoNS.IMarkdownString[] = [];
  const push = (c: any) => {
    if (!c) return;
    if (typeof c === 'string') {
      out.push({ value: c });
    } else if (typeof c === 'object') {
      if (typeof c.value === 'string') {
        // MarkupContent or MarkedString { language, value }
        if (c.language) {
          out.push({ value: '```' + c.language + '\n' + c.value + '\n```' });
        } else {
          out.push({ value: c.value });
        }
      }
    }
  };
  if (Array.isArray(contents)) contents.forEach(push);
  else push(contents);
  return out;
}

// ── Client implementation ────────────────────────────────────────────────

type OpenDoc = {
  uri: string;
  version: number;
  languageId: string;
  /** Pending change-debounce timer. */
  pendingTimer: number | null;
  /** Most recent text we've been asked to send. */
  pendingText: string | null;
};

class LspClient {
  private monaco: Monaco | null = null;
  private attached = false;
  private workspaceStarted = false;
  private openDocs = new Map<string, OpenDoc>(); // key = uri
  private diagnosticsDispose: { dispose: () => void } | null = null;
  // Tracks which models have markers from us so we can clear them all
  // wholesale on workspace stop.
  private markedUris = new Set<string>();
  private problemsHandler: ProblemsHandler | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Wire Monaco up: register providers + start listening for diagnostics.
   *  Idempotent. */
  attachMonaco(monaco: Monaco): void {
    if (this.attached && this.monaco === monaco) return;
    this.monaco = monaco;
    this.attached = true;

    // Completion provider — register for both 'typescript' and 'javascript'
    // Monaco language ids. Monaco maps .tsx → typescript and .jsx → javascript,
    // so this covers all four real-world extensions.
    const completionProvider: MonacoNS.languages.CompletionItemProvider = {
      triggerCharacters: ['.', '"', "'", '`', '/', '@', '<', '#', ' '],
      provideCompletionItems: async (model, position) => {
        return this.provideCompletions(model, position);
      },
    };
    const hoverProvider: MonacoNS.languages.HoverProvider = {
      provideHover: async (model, position) => {
        return this.provideHover(model, position);
      },
    };

    monaco.languages.registerCompletionItemProvider('typescript', completionProvider);
    monaco.languages.registerCompletionItemProvider('javascript', completionProvider);
    monaco.languages.registerHoverProvider('typescript', hoverProvider);
    monaco.languages.registerHoverProvider('javascript', hoverProvider);

    // Listen for diagnostics.
    if (this.diagnosticsDispose) {
      try {
        this.diagnosticsDispose.dispose();
      } catch {
        /* noop */
      }
    }
    this.diagnosticsDispose = window.electronAPI.lsp.onDiagnostics(
      (params: LspPublishDiagnosticsParams) => this.applyDiagnostics(params)
    );
  }

  /** Tell the main process to spawn the language server for `workspacePath`.
   *  Resets all per-document tracking. */
  async startWorkspace(workspacePath: string): Promise<void> {
    if (!workspacePath) return;
    // Reset doc state — server is fresh, any "open" we tracked before is stale.
    this.resetDocState();
    try {
      await window.electronAPI.lsp.start(workspacePath);
      this.workspaceStarted = true;
    } catch (err) {
      console.warn('[forge:lsp] start failed:', (err as Error)?.message);
      this.workspaceStarted = false;
    }
  }

  /** Stop the language server and clear all markers / doc state. */
  async stopWorkspace(): Promise<void> {
    this.workspaceStarted = false;
    this.resetDocState();
    this.clearAllMarkers();
    try {
      await window.electronAPI.lsp.stop();
    } catch (err) {
      console.debug('[forge:lsp] stop failed:', (err as Error)?.message);
    }
  }

  setProblemsHandler(handler: ProblemsHandler | null): void {
    this.problemsHandler = handler;
  }

  // ── Document lifecycle ─────────────────────────────────────────────────

  /** Send textDocument/didOpen for a file. No-op for non-TS/JS paths. */
  openDocument(filePath: string, text: string): void {
    if (!this.workspaceStarted) return;
    const languageId = getLspLanguageId(filePath);
    if (!languageId) return;
    const uri = pathToFileUri(filePath);

    const existing = this.openDocs.get(uri);
    if (existing) {
      // Already open — treat as a re-sync via didChange.
      this.changeDocumentImmediate(filePath, text);
      return;
    }

    const doc: OpenDoc = {
      uri,
      version: 1,
      languageId,
      pendingTimer: null,
      pendingText: null,
    };
    this.openDocs.set(uri, doc);
    window.electronAPI.lsp.notification('textDocument/didOpen', {
      textDocument: { uri, languageId, version: doc.version, text },
    });
  }

  /** Debounced textDocument/didChange. */
  changeDocument(filePath: string, text: string): void {
    if (!this.workspaceStarted) return;
    if (!getLspLanguageId(filePath)) return;
    const uri = pathToFileUri(filePath);
    const doc = this.openDocs.get(uri);
    if (!doc) {
      // Not opened yet — auto-open with the current text instead.
      this.openDocument(filePath, text);
      return;
    }
    doc.pendingText = text;
    if (doc.pendingTimer !== null) {
      window.clearTimeout(doc.pendingTimer);
    }
    doc.pendingTimer = window.setTimeout(() => {
      doc.pendingTimer = null;
      if (doc.pendingText === null) return;
      const t = doc.pendingText;
      doc.pendingText = null;
      doc.version += 1;
      window.electronAPI.lsp.notification('textDocument/didChange', {
        textDocument: { uri: doc.uri, version: doc.version },
        contentChanges: [{ text: t }],
      });
    }, 150);
  }

  /** Immediate (non-debounced) didChange. Useful for "flush before request". */
  private changeDocumentImmediate(filePath: string, text: string): void {
    if (!this.workspaceStarted) return;
    if (!getLspLanguageId(filePath)) return;
    const uri = pathToFileUri(filePath);
    const doc = this.openDocs.get(uri);
    if (!doc) {
      this.openDocument(filePath, text);
      return;
    }
    if (doc.pendingTimer !== null) {
      window.clearTimeout(doc.pendingTimer);
      doc.pendingTimer = null;
    }
    doc.pendingText = null;
    doc.version += 1;
    window.electronAPI.lsp.notification('textDocument/didChange', {
      textDocument: { uri: doc.uri, version: doc.version },
      contentChanges: [{ text }],
    });
  }

  /** Send textDocument/didClose. */
  closeDocument(filePath: string): void {
    if (!this.workspaceStarted) return;
    const uri = pathToFileUri(filePath);
    const doc = this.openDocs.get(uri);
    if (!doc) return;
    if (doc.pendingTimer !== null) {
      window.clearTimeout(doc.pendingTimer);
    }
    this.openDocs.delete(uri);
    window.electronAPI.lsp.notification('textDocument/didClose', {
      textDocument: { uri },
    });
    // Clear any markers left over for this file.
    this.clearMarkersForUri(uri);
  }

  // ── Providers ──────────────────────────────────────────────────────────

  private modelToFileUri(model: MonacoNS.editor.ITextModel): string | null {
    // We pass `path={tab.path}` to <Editor>, so model.uri.path is the OS path
    // (URL-decoded by Monaco). Convert it back to a proper file:// URI.
    // model.uri can also be of scheme 'file' already if Monaco picks that up.
    const u = model.uri;
    if (!u) return null;
    // If Monaco produced something like `inmemory://` (default), bail.
    if (u.scheme && u.scheme !== 'file' && u.path && u.path.startsWith('/')) {
      // Treat path-only URIs as filesystem paths.
      return pathToFileUri(u.path);
    }
    if (u.scheme === 'file') {
      return u.toString();
    }
    if (u.path) {
      return pathToFileUri(u.path);
    }
    return null;
  }

  private async provideCompletions(
    model: MonacoNS.editor.ITextModel,
    position: MonacoNS.Position
  ): Promise<MonacoNS.languages.CompletionList | undefined> {
    if (!this.workspaceStarted || !this.monaco) return undefined;
    const uri = this.modelToFileUri(model);
    if (!uri) return undefined;
    if (!this.openDocs.has(uri)) return undefined; // didOpen hasn't happened yet

    // Flush any pending didChange so the LSP sees the latest text before we ask.
    await this.flushPendingForUri(uri);

    let result: any;
    try {
      result = await window.electronAPI.lsp.request('textDocument/completion', {
        textDocument: { uri },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
        context: { triggerKind: 1 }, // Invoked
      });
    } catch (err) {
      console.debug('[forge:lsp] completion request failed:', (err as Error)?.message);
      return undefined;
    }
    if (!result) return undefined;

    const items: any[] = Array.isArray(result) ? result : result.items || [];
    const isIncomplete = !Array.isArray(result) && !!result.isIncomplete;

    // Default range = current word at cursor.
    const word = model.getWordUntilPosition(position);
    const defaultRange: MonacoNS.IRange = {
      startLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endLineNumber: position.lineNumber,
      endColumn: word.endColumn,
    };
    const monaco = this.monaco;
    return {
      suggestions: items.map((it) => convertCompletionItem(monaco, it, defaultRange)),
      incomplete: isIncomplete,
    };
  }

  private async provideHover(
    model: MonacoNS.editor.ITextModel,
    position: MonacoNS.Position
  ): Promise<MonacoNS.languages.Hover | undefined> {
    if (!this.workspaceStarted) return undefined;
    const uri = this.modelToFileUri(model);
    if (!uri) return undefined;
    if (!this.openDocs.has(uri)) return undefined;

    await this.flushPendingForUri(uri);

    let result: any;
    try {
      result = await window.electronAPI.lsp.request('textDocument/hover', {
        textDocument: { uri },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
      });
    } catch (err) {
      console.debug('[forge:lsp] hover request failed:', (err as Error)?.message);
      return undefined;
    }
    if (!result || !result.contents) return undefined;

    const contents = convertHoverContents(result.contents);
    if (contents.length === 0) return undefined;

    let range: MonacoNS.IRange | undefined;
    if (result.range) {
      range = {
        startLineNumber: result.range.start.line + 1,
        startColumn: result.range.start.character + 1,
        endLineNumber: result.range.end.line + 1,
        endColumn: result.range.end.character + 1,
      };
    }
    return { contents, range };
  }

  // ── Diagnostics ────────────────────────────────────────────────────────

  private applyDiagnostics(params: LspPublishDiagnosticsParams): void {
    const filePath = fileUriToPath(params.uri);
    const problems: Problem[] = (params.diagnostics || []).map((d) => ({
      filePath,
      message: d.message || '',
      severity: d.severity || 1,
      source: d.source || 'typescript',
      code:
        typeof d.code === 'number' || typeof d.code === 'string'
          ? String(d.code)
          : undefined,
      startLine: (d.range?.start?.line ?? 0) + 1,
      startColumn: (d.range?.start?.character ?? 0) + 1,
      endLine: (d.range?.end?.line ?? 0) + 1,
      endColumn: (d.range?.end?.character ?? 0) + 1,
    }));
    this.problemsHandler?.(filePath, problems);

    if (!this.monaco) return;
    const monaco = this.monaco;
    const uri = params.uri;
    const model = this.findModelForUri(uri);
    if (!model) {
      // No editor is showing this file right now — nothing to mark. We could
      // queue these, but Monaco re-asks the provider when the model mounts
      // and TS-LS will re-publish diagnostics on didOpen, so dropping is OK.
      return;
    }
    const markers = diagnosticsToMarkers(monaco, params.diagnostics || []);
    monaco.editor.setModelMarkers(model, 'lsp', markers);
    if (markers.length > 0) this.markedUris.add(uri);
    else this.markedUris.delete(uri);
  }

  private findModelForUri(uri: string): MonacoNS.editor.ITextModel | null {
    if (!this.monaco) return null;
    const models = this.monaco.editor.getModels();
    for (const m of models) {
      const mu = this.modelToFileUri(m);
      if (mu === uri) return m;
    }
    return null;
  }

  private clearMarkersForUri(uri: string): void {
    if (!this.monaco) return;
    const model = this.findModelForUri(uri);
    if (model) this.monaco.editor.setModelMarkers(model, 'lsp', []);
    this.markedUris.delete(uri);
  }

  private clearAllMarkers(): void {
    if (!this.monaco) return;
    for (const uri of Array.from(this.markedUris)) {
      const model = this.findModelForUri(uri);
      if (model) this.monaco.editor.setModelMarkers(model, 'lsp', []);
    }
    this.markedUris.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async flushPendingForUri(uri: string): Promise<void> {
    const doc = this.openDocs.get(uri);
    if (!doc || doc.pendingTimer === null || doc.pendingText === null) return;
    window.clearTimeout(doc.pendingTimer);
    doc.pendingTimer = null;
    const t = doc.pendingText;
    doc.pendingText = null;
    doc.version += 1;
    window.electronAPI.lsp.notification('textDocument/didChange', {
      textDocument: { uri: doc.uri, version: doc.version },
      contentChanges: [{ text: t }],
    });
    // Give the server a tick to ingest the change before we follow up with a
    // completion/hover request.
    await new Promise((r) => setTimeout(r, 0));
  }

  /** Fetch document symbols for outline navigation. Returns [] on failure. */
  async fetchDocumentSymbols(filePath: string): Promise<OutlineSymbol[]> {
    if (!getLspLanguageId(filePath) || !window.electronAPI?.lsp) return [];
    const uri = pathToFileUri(filePath);
    try {
      const result = await window.electronAPI.lsp.request('textDocument/documentSymbol', {
        textDocument: { uri },
      });
      return flattenDocumentSymbols(Array.isArray(result) ? result : []);
    } catch {
      return [];
    }
  }

  private resetDocState(): void {
    for (const doc of this.openDocs.values()) {
      if (doc.pendingTimer !== null) {
        try {
          window.clearTimeout(doc.pendingTimer);
        } catch {
          /* noop */
        }
      }
    }
    this.openDocs.clear();
  }
}

export const lspClient = new LspClient();

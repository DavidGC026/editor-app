/**
 * AssistantStreamRouter — a streaming parser that splits the model's raw
 * output into:
 *
 *   1. Visible narration (everything OUTSIDE `<tool>…</tool>` blocks)
 *   2. Real-time file content for `escribir_archivo` tool calls,
 *      JSON-unescaped on the fly so it can be piped character-by-character
 *      into the Monaco editor.
 *
 * The parser is fed `push(chunk)` as deltas arrive. It emits events through
 * the four callbacks below. When the stream finally completes, call
 * `finish()` to flush any pending visible buffer.
 *
 * Design note: we keep a tiny look-behind buffer (up to `<tool>`.length-1
 * chars) so that partial `<tool>` markers split across chunks are detected
 * correctly without leaking into the visible-text stream.
 */

const TOOL_OPEN = '<tool>';
const TOOL_CLOSE = '</tool>';

type RouterState = 'TEXT' | 'TOOL_JSON' | 'CONTENT_STR' | 'AFTER_CONTENT';

export interface StreamRouterCallbacks {
  /** Plain narration text (already with `<tool>…</tool>` removed). */
  onVisibleText: (text: string) => void;
  /** Emitted once when an `escribir_archivo` tool is detected and we have
   *  its `ruta`. Streaming of file content starts after this call. */
  onWriteStart: (ruta: string) => void;
  /** A decoded chunk of file content. May be 1 or N characters. */
  onWriteChunk: (ruta: string, chunk: string) => void;
  /** The closing `"` of the `contenido` string was reached. */
  onWriteEnd: (ruta: string) => void;
}

export class AssistantStreamRouter {
  private state: RouterState = 'TEXT';

  /** Holds recent un-emitted chars in TEXT state (so we can detect a
   *  `<tool>` marker that straddles chunk boundaries). */
  private textPending = '';

  /** Raw JSON accumulated since we entered TOOL_JSON. Reset on tool exit. */
  private toolJson = '';
  private toolName: string | null = null;
  private toolRuta: string | null = null;
  /** True once `onWriteStart` has been emitted for the current tool. */
  private writeStarted = false;

  /** In CONTENT_STR state: did the previous char start an escape sequence? */
  private inEscape = false;

  /** Buffer used in AFTER_CONTENT to scan for `</tool>`. */
  private postContent = '';

  constructor(private cb: StreamRouterCallbacks) {}

  push(chunk: string): void {
    for (const c of chunk) {
      this.feed(c);
    }
  }

  /** Flush any pending visible text. Must be called once the stream ends. */
  finish(): void {
    if (this.textPending.length > 0) {
      this.cb.onVisibleText(this.textPending);
      this.textPending = '';
    }
  }

  // ── Internal ──────────────────────────────────────────────────────

  private feed(c: string): void {
    switch (this.state) {
      case 'TEXT':
        this.feedText(c);
        return;
      case 'TOOL_JSON':
        this.feedToolJson(c);
        return;
      case 'CONTENT_STR':
        this.feedContent(c);
        return;
      case 'AFTER_CONTENT':
        this.feedAfterContent(c);
        return;
    }
  }

  private feedText(c: string): void {
    this.textPending += c;
    // Full `<tool>` marker reached?
    if (this.textPending.endsWith(TOOL_OPEN)) {
      const visible = this.textPending.slice(0, -TOOL_OPEN.length);
      if (visible.length > 0) this.cb.onVisibleText(visible);
      this.textPending = '';
      this.state = 'TOOL_JSON';
      this.toolJson = '';
      this.toolName = null;
      this.toolRuta = null;
      this.writeStarted = false;
      this.inEscape = false;
      return;
    }
    // Emit anything that could not be the start of `<tool>` anymore.
    // We retain the trailing (TOOL_OPEN.length - 1) chars in case the
    // marker is still being formed.
    const keep = TOOL_OPEN.length - 1;
    if (this.textPending.length > keep) {
      const emitLen = this.textPending.length - keep;
      this.cb.onVisibleText(this.textPending.slice(0, emitLen));
      this.textPending = this.textPending.slice(emitLen);
    }
  }

  private feedToolJson(c: string): void {
    this.toolJson += c;

    // Lazy-extract `name` and `ruta` once enough JSON has accumulated.
    if (this.toolName === null) {
      const m = this.toolJson.match(/"name"\s*:\s*"([a-zA-Z_][\w-]*)"/);
      if (m) this.toolName = m[1];
    }
    if (this.toolRuta === null) {
      const m = this.toolJson.match(/"ruta"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (m) this.toolRuta = decodeJsonString(m[1]);
    }

    // Have we hit the start of the `contenido` string value?
    if (!this.writeStarted && this.toolName === 'escribir_archivo' && this.toolRuta) {
      const contentRe = /"contenido"\s*:\s*"/;
      const match = this.toolJson.match(contentRe);
      if (match) {
        const afterOpenQuote = match.index! + match[0].length;
        // Switch state and replay any chars that arrived after the opening quote.
        this.writeStarted = true;
        this.state = 'CONTENT_STR';
        this.inEscape = false;
        this.cb.onWriteStart(this.toolRuta);
        if (this.toolJson.length > afterOpenQuote) {
          const replay = this.toolJson.slice(afterOpenQuote);
          for (const cc of replay) {
            // Dispatch through the central `feed()` so chars use whatever
            // state the previous one left us in (CONTENT_STR → AFTER_CONTENT
            // → TEXT, all possible during a single replay).
            this.feed(cc);
            if ((this.state as RouterState) === 'TEXT') {
              // Fully exited the tool block during replay; stop here (any
              // remaining chars after `</tool>` will be re-fed when the
              // outer push() loop continues with the next pushed chunk).
              break;
            }
          }
        }
        return;
      }
    }

    // For non-escribir_archivo tools, just look for the closing `</tool>`
    // marker and exit. The raw text is still preserved on the caller side
    // for `parseAssistantTurn` to handle later.
    if (this.toolJson.endsWith(TOOL_CLOSE)) {
      this.exitToolBlock();
    }
  }

  private feedContent(c: string): void {
    if (!this.toolRuta) return; // shouldn't happen

    if (this.inEscape) {
      this.cb.onWriteChunk(this.toolRuta, decodeEscape(c));
      this.inEscape = false;
      return;
    }
    if (c === '\\') {
      this.inEscape = true;
      return;
    }
    if (c === '"') {
      // End of contenido JSON string.
      this.cb.onWriteEnd(this.toolRuta);
      this.state = 'AFTER_CONTENT';
      this.postContent = '';
      return;
    }
    this.cb.onWriteChunk(this.toolRuta, c);
  }

  private feedAfterContent(c: string): void {
    this.postContent += c;
    if (this.postContent.endsWith(TOOL_CLOSE)) {
      this.exitToolBlock();
    }
  }

  private exitToolBlock(): void {
    this.state = 'TEXT';
    this.toolJson = '';
    this.toolName = null;
    this.toolRuta = null;
    this.writeStarted = false;
    this.inEscape = false;
    this.postContent = '';
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** JSON-string escape handling for the single char following a backslash. */
function decodeEscape(c: string): string {
  switch (c) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'r':
      return '\r';
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    case '"':
      return '"';
    case '\\':
      return '\\';
    case '/':
      return '/';
    default:
      // `\u` unicode escapes and other unknown sequences fall through
      // as-is. They are rare for source code in practice.
      return c;
  }
}

/** Decode a JSON string body (the contents between the outer quotes). */
function decodeJsonString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      out += decodeEscape(s[i + 1]);
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

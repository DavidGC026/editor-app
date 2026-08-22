/**
 * Value types of the `vscode` API that carry no workbench behaviour:
 * `Disposable`, `EventEmitter`, `Uri` and cancellation. They are pure data
 * and plain callbacks, so they live entirely inside the host — no RPC, no
 * main-side state — and every extension gets the same implementations
 * (design §4: what is per-extension is the *facade*, not these classes).
 */

export interface DisposableLike {
  dispose(): unknown;
}

/** Same shape VS Code exposes: a class, a `from` combinator and a no-op. */
export class Disposable implements DisposableLike {
  private callOnDispose: (() => unknown) | undefined;

  constructor(callOnDispose: () => unknown) {
    this.callOnDispose = callOnDispose;
  }

  static from(...disposables: DisposableLike[]): Disposable {
    const items = disposables.slice();
    return new Disposable(() => {
      // One failing disposable must not strand the rest: extensions routinely
      // push half-initialised objects into `context.subscriptions`.
      const errors: unknown[] = [];
      for (const item of items) {
        try {
          item?.dispose();
        } catch (err) {
          errors.push(err);
        }
      }
      if (errors.length > 0) throw errors[0];
    });
  }

  /** VS Code's `Disposable.None`: safe to dispose repeatedly. Not frozen —
   *  `dispose()` clears its own callback, and freezing would make that throw. */
  static readonly None: Disposable = new Disposable(() => undefined);

  dispose(): void {
    const callback = this.callOnDispose;
    // Idempotent by construction: a second dispose must be a no-op, not a
    // second `unregister` on the other side of the wire.
    this.callOnDispose = undefined;
    if (callback) callback();
  }
}

export type Event<T> = (
  listener: (value: T) => unknown,
  thisArgs?: unknown,
  disposables?: DisposableLike[],
) => Disposable;

/**
 * `vscode.EventEmitter`. Listener exceptions are reported and swallowed:
 * an extension listening to its own event must not be able to break the
 * emitter for the others, and there is nobody above to catch it.
 */
export class EventEmitter<T> {
  private listeners: { callback: (value: T) => unknown; thisArgs: unknown }[] = [];
  private disposed = false;
  private readonly onError: (err: unknown) => void;

  constructor(onError?: (err: unknown) => void) {
    this.onError = onError ?? (() => undefined);
  }

  get event(): Event<T> {
    return (listener, thisArgs, disposables) => {
      if (this.disposed) return Disposable.None;
      const entry = { callback: listener, thisArgs };
      this.listeners.push(entry);
      const subscription = new Disposable(() => {
        const index = this.listeners.indexOf(entry);
        if (index !== -1) this.listeners.splice(index, 1);
      });
      if (disposables) disposables.push(subscription);
      return subscription;
    };
  }

  fire(value: T): void {
    if (this.disposed) return;
    // Snapshot: a listener that unsubscribes while firing must not shift the
    // array under the loop.
    for (const entry of this.listeners.slice()) {
      try {
        entry.callback.call(entry.thisArgs, value);
      } catch (err) {
        this.onError(err);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners = [];
  }
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: Event<unknown>;
}

export class CancellationError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'Canceled';
  }
}

export class CancellationTokenSource {
  readonly token: CancellationToken;
  private readonly emitter = new EventEmitter<unknown>();
  private cancelled = false;

  constructor() {
    const source = this;
    // Built here, over closures: the token travels into extension code on its
    // own, so it must not depend on how it is called.
    this.token = {
      // Getter, not a snapshot: extensions capture the token and read it later.
      get isCancellationRequested() {
        return source.cancelled;
      },
      onCancellationRequested: (listener, thisArgs, disposables) =>
        source.emitter.event(listener, thisArgs, disposables),
    };
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.emitter.fire(undefined);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

// ── Uri ─────────────────────────────────────────────────────────────────
// A minimal but faithful `vscode.Uri`: extensions compare, join and stringify
// them constantly, and a wrong `fsPath` on Windows silently breaks path math.

const EMPTY = '';
const SLASH = '/';
const WINDOWS_DRIVE = /^\/?[a-zA-Z]:/;

export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  private constructor(
    scheme: string,
    authority: string,
    uriPath: string,
    query: string,
    fragment: string,
  ) {
    this.scheme = scheme || 'file';
    this.authority = authority;
    this.path = uriPath;
    this.query = query;
    this.fragment = fragment;
    Object.freeze(this);
  }

  static file(fsPath: string): Uri {
    let normalized = fsPath.replace(/\\/g, SLASH);
    if (normalized.startsWith('//')) {
      // UNC path: `\\server\share` → authority `server`, path `/share`.
      const separator = normalized.indexOf(SLASH, 2);
      if (separator === -1) return new Uri('file', normalized.slice(2), SLASH, EMPTY, EMPTY);
      return new Uri(
        'file',
        normalized.slice(2, separator),
        normalized.slice(separator) || SLASH,
        EMPTY,
        EMPTY,
      );
    }
    if (WINDOWS_DRIVE.test(normalized)) {
      // Drive letters are lowercased so two spellings of the same file
      // compare equal, exactly as VS Code does.
      const withSlash = normalized.startsWith(SLASH) ? normalized : SLASH + normalized;
      normalized = withSlash[1].toLowerCase() + withSlash.slice(2);
      return new Uri('file', EMPTY, SLASH + normalized, EMPTY, EMPTY);
    }
    return new Uri('file', EMPTY, normalized.startsWith(SLASH) ? normalized : SLASH + normalized, EMPTY, EMPTY);
  }

  static parse(value: string): Uri {
    const match = /^(?:([a-zA-Z][a-zA-Z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/
      .exec(value);
    if (!match) return Uri.file(value);
    const [, scheme, authority, uriPath, query, fragment] = match;
    if (!scheme) return Uri.file(value);
    return new Uri(
      scheme,
      decodeURIComponent(authority ?? EMPTY),
      decodeURIComponent(uriPath ?? EMPTY),
      query ?? EMPTY,
      fragment ?? EMPTY,
    );
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    const parts = [base.path, ...segments.map((segment) => segment.replace(/\\/g, SLASH))];
    const joined = normalizePath(parts.join(SLASH));
    return base.with({ path: joined });
  }

  static from(components: {
    scheme: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      components.scheme,
      components.authority ?? EMPTY,
      components.path ?? EMPTY,
      components.query ?? EMPTY,
      components.fragment ?? EMPTY,
    );
  }

  get fsPath(): string {
    if (this.authority && this.scheme === 'file') return `//${this.authority}${this.path}`;
    if (WINDOWS_DRIVE.test(this.path)) return this.path.slice(1);
    return this.path;
  }

  with(change: {
    scheme?: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  toString(skipEncoding = false): string {
    const encode = skipEncoding ? (part: string) => part : encodeUriComponentMinimal;
    let result = `${this.scheme}:`;
    if (this.authority || this.scheme === 'file') result += `//${encode(this.authority)}`;
    result += encode(this.path);
    if (this.query) result += `?${encode(this.query)}`;
    if (this.fragment) result += `#${encode(this.fragment)}`;
    return result;
  }

  /** Structured clone drops the prototype, so JSON keeps the shape usable. */
  toJSON(): Record<string, unknown> {
    return {
      $mid: 1,
      scheme: this.scheme,
      authority: this.authority || undefined,
      path: this.path,
      query: this.query || undefined,
      fragment: this.fragment || undefined,
      fsPath: this.fsPath,
      external: this.toString(),
    };
  }
}

/** Collapses `.`/`..` and duplicate separators without touching the disk. */
function normalizePath(value: string): string {
  const absolute = value.startsWith(SLASH);
  const out: string[] = [];
  for (const segment of value.split(SLASH)) {
    if (segment === EMPTY || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(segment);
  }
  const joined = out.join(SLASH);
  return absolute ? SLASH + joined : joined;
}

/** Encodes only what breaks a URI; leaves `/`, `:` and friends readable. */
function encodeUriComponentMinimal(value: string): string {
  return value.replace(/[#?\s]/g, (char) => encodeURIComponent(char));
}

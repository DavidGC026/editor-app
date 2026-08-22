/**
 * `vscode.ExtensionContext` and its `Memento` storage.
 *
 * Storage is per extension and lives under a directory main decided and
 * sanitised (design §7: "nunca la ruta del publisher tal cual"); the host
 * only ever writes inside the path it was handed. Reads are eager at
 * activation and writes go through an injected `MementoStore`, so the whole
 * thing is testable with an in-memory double and the fs adapter stays a
 * single small module.
 */
import { Disposable, Uri } from './vscode-api/primitives';
import type { DisposableLike } from './vscode-api/primitives';
import { ExtensionMode } from './vscode-api/enums';
import type { ExtensionModeValue } from './vscode-api/enums';
import type { ExtensionHostDescriptor } from '../extensions/domain/rpc-protocol';

export type MementoState = Record<string, unknown>;

/** Persistence seam for the two mementos. Implemented by the fs adapter in
 *  production and by a plain object in tests. Takes the whole descriptor
 *  because *where* the state goes is main's decision, not the host's. */
export interface MementoStore {
  read(scope: 'global' | 'workspace', descriptor: ExtensionHostDescriptor): MementoState;
  write(
    scope: 'global' | 'workspace',
    descriptor: ExtensionHostDescriptor,
    state: MementoState,
  ): void;
}

export interface Memento {
  keys(): readonly string[];
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Promise<void>;
  /** Only on `globalState`, as in VS Code. */
  setKeysForSync?(keys: readonly string[]): void;
}

class StoredMemento implements Memento {
  private readonly state: MementoState;

  constructor(
    private readonly scope: 'global' | 'workspace',
    private readonly descriptor: ExtensionHostDescriptor,
    private readonly store: MementoStore,
    private readonly onError: (err: unknown) => void,
  ) {
    let loaded: MementoState = {};
    try {
      loaded = store.read(scope, descriptor) ?? {};
    } catch (err) {
      // Corrupt storage must not block activation: an extension losing its
      // state is recoverable, an extension that cannot start is not.
      this.onErrorSafe(err);
    }
    this.state = { ...loaded };
  }

  private onErrorSafe(err: unknown): void {
    try {
      this.onError(err);
    } catch {
      /* reporting must never be the thing that throws */
    }
  }

  keys(): readonly string[] {
    return Object.keys(this.state);
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.state[key];
    return value === undefined ? defaultValue : (value as T);
  }

  async update(key: string, value: unknown): Promise<void> {
    // `undefined` removes the key, which is how VS Code documents it.
    if (value === undefined) delete this.state[key];
    else this.state[key] = value;
    try {
      this.store.write(this.scope, this.descriptor, this.state);
    } catch (err) {
      this.onErrorSafe(err);
      throw err;
    }
  }

  setKeysForSync(): void {
    // Settings Sync does not exist in Forge. Accepting the call is honest:
    // nothing is lost, the keys simply are not synchronised anywhere.
  }
}

export interface ExtensionContext {
  subscriptions: DisposableLike[];
  extensionPath: string;
  extensionUri: Uri;
  extensionMode: ExtensionModeValue;
  globalState: Memento;
  workspaceState: Memento;
  globalStorageUri: Uri;
  storageUri: Uri | null;
  globalStoragePath: string;
  storagePath: string | undefined;
  logUri: Uri;
  logPath: string;
  asAbsolutePath(relativePath: string): string;
  /** Present so `context.extension.id` works; the full `Extension<T>` API
   *  (exports, `isActive`) belongs to the activation service of 3.4. */
  extension: { id: string; extensionPath: string; extensionUri: Uri; packageJSON: unknown };
}

const MODES: Record<ExtensionHostDescriptor['extensionMode'], ExtensionModeValue> = {
  production: ExtensionMode.Production,
  development: ExtensionMode.Development,
  test: ExtensionMode.Test,
};

export interface ExtensionContextOptions {
  descriptor: ExtensionHostDescriptor;
  store: MementoStore;
  /** Joins path segments; injected so the context has no direct `path` import
   *  and tests can assert POSIX behaviour on any platform. */
  joinPath: (...segments: string[]) => string;
  packageJSON?: unknown;
  onError?: (err: unknown) => void;
}

export function createExtensionContext(options: ExtensionContextOptions): ExtensionContext {
  const { descriptor, store, joinPath } = options;
  const onError = options.onError ?? (() => undefined);
  const extensionUri = Uri.file(descriptor.dir);
  const logPath = joinPath(descriptor.globalStoragePath, 'logs');

  return {
    subscriptions: [],
    extensionPath: descriptor.dir,
    extensionUri,
    extensionMode: MODES[descriptor.extensionMode] ?? ExtensionMode.Production,
    globalState: new StoredMemento('global', descriptor, store, onError),
    workspaceState: new StoredMemento('workspace', descriptor, store, onError),
    globalStorageUri: Uri.file(descriptor.globalStoragePath),
    storageUri: descriptor.workspaceStoragePath
      ? Uri.file(descriptor.workspaceStoragePath)
      : null,
    globalStoragePath: descriptor.globalStoragePath,
    // `undefined` (not null) when there is no workspace, as VS Code does:
    // extensions branch on it to decide whether workspace state is usable.
    storagePath: descriptor.workspaceStoragePath ?? undefined,
    logUri: Uri.file(logPath),
    logPath,
    asAbsolutePath: (relativePath: string) => joinPath(descriptor.dir, relativePath),
    extension: {
      id: descriptor.id,
      extensionPath: descriptor.dir,
      extensionUri,
      packageJSON: options.packageJSON ?? { name: descriptor.id, version: descriptor.version },
    },
  };
}

/** Disposes `context.subscriptions` in reverse order, collecting failures
 *  instead of stopping at the first one: teardown must be all-or-nothing on
 *  effort, never on outcome. */
export function disposeSubscriptions(
  context: ExtensionContext,
  onError: (err: unknown) => void,
): void {
  const items = context.subscriptions.splice(0, context.subscriptions.length);
  for (const item of items.reverse()) {
    try {
      item?.dispose();
    } catch (err) {
      onError(err);
    }
  }
}

export { Disposable };

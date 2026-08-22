'use strict';

// Primitives, enums, the unsupported-API mechanism and `ExtensionContext`:
// everything an extension can touch that does not need the workbench.

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const {
  CancellationTokenSource,
  Disposable,
  EventEmitter,
  Uri,
} = require('../../dist-electron/extension-host/vscode-api/primitives.js');
const {
  ExtensionMode,
  VSCODE_ENUMS,
} = require('../../dist-electron/extension-host/vscode-api/enums.js');
const {
  UnsupportedApiError,
  createUnsupportedNamespace,
} = require('../../dist-electron/extension-host/vscode-api/unsupported.js');
const {
  createVscodeApi,
} = require('../../dist-electron/extension-host/vscode-api/facade.js');
const {
  createExtensionContext,
  disposeSubscriptions,
} = require('../../dist-electron/extension-host/extension-context.js');

const descriptor = (overrides = {}) => ({
  id: 'forge-tests.demo',
  version: '1.0.0',
  dir: '/store/forge-tests.demo/1.0.0',
  main: './out/extension.js',
  globalStoragePath: '/storage/global/forge-tests.demo',
  workspaceStoragePath: '/storage/workspace/proj/forge-tests.demo',
  extensionMode: 'production',
  ...overrides,
});

// ── Disposable ──────────────────────────────────────────────────────────

test('a disposable runs once and is safe to dispose again', () => {
  let calls = 0;
  const disposable = new Disposable(() => { calls += 1; });

  disposable.dispose();
  disposable.dispose();

  assert.equal(calls, 1, 'a second dispose must not repeat the side effect');
  Disposable.None.dispose();
  Disposable.None.dispose();
});

test('Disposable.from releases every child even when one throws', () => {
  const released = [];
  const combined = Disposable.from(
    { dispose: () => released.push('a') },
    { dispose: () => { throw new Error('boom'); } },
    { dispose: () => released.push('c') },
  );

  assert.throws(() => combined.dispose(), /boom/);
  assert.deepEqual(released, ['a', 'c'], 'a failing disposable does not strand the rest');
});

// ── EventEmitter ────────────────────────────────────────────────────────

test('listeners receive events, unsubscribe and survive a throwing peer', () => {
  const errors = [];
  const emitter = new EventEmitter((err) => errors.push(err.message));
  const seen = [];

  emitter.event(() => { throw new Error('listener roto'); });
  const subscription = emitter.event((value) => seen.push(value));

  emitter.fire('one');
  subscription.dispose();
  emitter.fire('two');

  assert.deepEqual(seen, ['one'], 'a disposed listener stops receiving');
  assert.deepEqual(
    errors,
    ['listener roto', 'listener roto'],
    'the throw is reported on each fire and never propagated to the emitter',
  );
});

test('a listener unsubscribing mid-fire does not skip its peers', () => {
  const emitter = new EventEmitter();
  const seen = [];
  const first = emitter.event(() => {
    seen.push('first');
    first.dispose();
  });
  emitter.event(() => seen.push('second'));

  emitter.fire(undefined);

  assert.deepEqual(seen, ['first', 'second']);
});

test('a disposed emitter fires nothing and hands out inert subscriptions', () => {
  const emitter = new EventEmitter();
  const seen = [];
  emitter.event(() => seen.push('before'));
  emitter.dispose();

  emitter.event(() => seen.push('after'));
  emitter.fire(undefined);

  assert.deepEqual(seen, []);
});

test('subscriptions can be collected into an array, as extensions do', () => {
  const emitter = new EventEmitter();
  const bag = [];
  emitter.event(() => undefined, undefined, bag);

  assert.equal(bag.length, 1);
  assert.equal(typeof bag[0].dispose, 'function');
});

// ── Cancellation ────────────────────────────────────────────────────────

test('a cancellation token reports state and notifies once', () => {
  const source = new CancellationTokenSource();
  const { token } = source;
  let notifications = 0;
  token.onCancellationRequested(() => { notifications += 1; });

  assert.equal(token.isCancellationRequested, false);
  source.cancel();
  source.cancel();

  assert.equal(token.isCancellationRequested, true, 'the token reads live state');
  assert.equal(notifications, 1, 'cancelling twice notifies once');
});

test('the token works detached from its source, as extensions pass it around', () => {
  const source = new CancellationTokenSource();
  const { isCancellationRequested: _ignored, ...rest } = source.token;
  const detached = source.token;

  source.cancel();

  assert.equal(detached.isCancellationRequested, true);
  assert.equal(typeof rest.onCancellationRequested, 'function');
});

// ── Uri ─────────────────────────────────────────────────────────────────

test('Uri.file keeps posix paths and lowercases windows drive letters', () => {
  const posix = Uri.file('/home/dev/project/file.ts');
  assert.equal(posix.scheme, 'file');
  assert.equal(posix.path, '/home/dev/project/file.ts');
  assert.equal(posix.fsPath, '/home/dev/project/file.ts');

  const windows = Uri.file('C:\\Users\\dev\\file.ts');
  assert.equal(windows.path, '/c:/Users/dev/file.ts');
  assert.equal(windows.fsPath, 'c:/Users/dev/file.ts', 'two spellings must compare equal');
});

test('Uri.parse round-trips a non-file scheme and Uri.file falls back for bare paths', () => {
  const parsed = Uri.parse('https://open-vsx.org/api/search?query=forge#top');
  assert.equal(parsed.scheme, 'https');
  assert.equal(parsed.authority, 'open-vsx.org');
  assert.equal(parsed.path, '/api/search');
  assert.equal(parsed.query, 'query=forge');
  assert.equal(parsed.fragment, 'top');
  assert.equal(parsed.toString(), 'https://open-vsx.org/api/search?query=forge#top');

  assert.equal(Uri.parse('/plain/path').scheme, 'file', 'no scheme means a file path');
});

test('Uri.joinPath normalises segments and cannot be tricked into a mutation', () => {
  const base = Uri.file('/store/ext/1.0.0');
  assert.equal(Uri.joinPath(base, 'out', 'extension.js').path, '/store/ext/1.0.0/out/extension.js');
  assert.equal(Uri.joinPath(base, 'out/../media', './logo.svg').path, '/store/ext/1.0.0/media/logo.svg');
  assert.equal(base.path, '/store/ext/1.0.0', 'the base is immutable');
});

test('a uri survives structured clone as data, which is how it crosses the wire', () => {
  const uri = Uri.file('/tmp/demo.txt');
  const cloned = JSON.parse(JSON.stringify(uri));
  assert.equal(cloned.fsPath, '/tmp/demo.txt');
  assert.equal(cloned.scheme, 'file');
});

// ── Unsupported API ─────────────────────────────────────────────────────

test('an unimplemented member throws and reports itself instead of returning undefined', () => {
  const reported = [];
  const commands = createUnsupportedNamespace(
    'commands',
    'forge-tests.demo',
    (api, owner) => reported.push(`${api}|${owner}`),
  );

  assert.equal(typeof commands.registerCommand, 'function', 'feature detection still works');
  assert.deepEqual(reported, [], 'merely looking is not usage');

  assert.throws(() => commands.registerCommand('x'), (err) => {
    assert.ok(err instanceof UnsupportedApiError);
    assert.equal(err.api, 'commands.registerCommand');
    assert.equal(err.extensionId, 'forge-tests.demo');
    return true;
  });
  assert.deepEqual(reported, ['commands.registerCommand|forge-tests.demo']);
});

test('implemented members shadow the throwing default and inspection stays quiet', () => {
  const reported = [];
  const commands = createUnsupportedNamespace(
    'commands',
    'forge-tests.demo',
    (api) => reported.push(api),
    { executeCommand: () => 'real' },
  );

  assert.equal(commands.executeCommand(), 'real');
  // `await`-ing an object reads `then`; answering undefined keeps that from
  // being reported as an unsupported API call.
  assert.equal(commands.then, undefined);
  assert.deepEqual(reported, []);
});

// ── Facade ──────────────────────────────────────────────────────────────

test('the facade exposes primitives, enums and version, and refuses the workbench', () => {
  const reported = [];
  const api = createVscodeApi({
    extensionId: 'forge-tests.demo',
    apiVersion: '1.90.0',
    reportUnsupported: (name) => reported.push(name),
  });

  assert.equal(api.version, '1.90.0');
  assert.equal(api.Uri, Uri);
  assert.equal(api.ExtensionMode.Production, 1);
  assert.equal(api.env.appName, 'Forge');
  assert.throws(() => api.window.showInformationMessage('hi'), UnsupportedApiError);
  assert.deepEqual(reported, ['window.showInformationMessage']);
  assert.equal(api.comands, undefined, 'a typo stays undefined, not a fake namespace');
});

test('every enum is frozen so one extension cannot rewrite them for the next', () => {
  for (const [name, values] of Object.entries(VSCODE_ENUMS)) {
    assert.ok(Object.isFrozen(values), `${name} debería estar congelado`);
  }
  assert.throws(() => { ExtensionMode.Production = 99; }, TypeError);
});

// ── ExtensionContext ────────────────────────────────────────────────────

function createMemoryStore(seed = {}) {
  const state = { ...seed };
  return {
    state,
    store: {
      read: (scope, descriptor) => ({ ...(state[`${scope}:${descriptor.id}`] ?? {}) }),
      write: (scope, descriptor, value) => { state[`${scope}:${descriptor.id}`] = { ...value }; },
    },
  };
}

test('the context reflects the descriptor and resolves paths inside the extension', () => {
  const { store } = createMemoryStore();
  const context = createExtensionContext({
    descriptor: descriptor(),
    store,
    joinPath: (...segments) => path.posix.join(...segments),
  });

  assert.equal(context.extensionPath, '/store/forge-tests.demo/1.0.0');
  assert.equal(context.extensionUri.fsPath, '/store/forge-tests.demo/1.0.0');
  assert.equal(context.extensionMode, ExtensionMode.Production);
  assert.equal(context.asAbsolutePath('media/logo.svg'), '/store/forge-tests.demo/1.0.0/media/logo.svg');
  assert.equal(context.extension.id, 'forge-tests.demo');
  assert.deepEqual(context.subscriptions, []);
});

test('without a workspace there is no workspace storage, and it is undefined not null', () => {
  const { store } = createMemoryStore();
  const context = createExtensionContext({
    descriptor: descriptor({ workspaceStoragePath: null }),
    store,
    joinPath: (...segments) => path.posix.join(...segments),
  });

  assert.equal(context.storageUri, null);
  assert.equal(context.storagePath, undefined, 'extensions branch on `undefined`, as in VS Code');
});

test('mementos load persisted state, update it and delete on undefined', async () => {
  const { state, store } = createMemoryStore({
    'global:forge-tests.demo': { runs: 3 },
  });
  const context = createExtensionContext({
    descriptor: descriptor(),
    store,
    joinPath: (...segments) => path.posix.join(...segments),
  });

  assert.equal(context.globalState.get('runs'), 3);
  assert.equal(context.globalState.get('missing', 'fallback'), 'fallback');
  assert.deepEqual(context.workspaceState.keys(), [], 'scopes do not bleed into each other');

  await context.globalState.update('runs', 4);
  assert.deepEqual(state['global:forge-tests.demo'], { runs: 4 });

  await context.globalState.update('runs', undefined);
  assert.deepEqual(context.globalState.keys(), []);
  assert.deepEqual(state['global:forge-tests.demo'], {});
});

test('unreadable storage degrades to empty instead of blocking activation', () => {
  const errors = [];
  const context = createExtensionContext({
    descriptor: descriptor(),
    store: {
      read: () => { throw new Error('json corrupto'); },
      write: () => undefined,
    },
    joinPath: (...segments) => path.posix.join(...segments),
    onError: (err) => errors.push(err.message),
  });

  assert.deepEqual(context.globalState.keys(), []);
  assert.deepEqual(errors, ['json corrupto', 'json corrupto'], 'both scopes report');
});

test('subscriptions are disposed in reverse order and failures do not stop teardown', () => {
  const { store } = createMemoryStore();
  const context = createExtensionContext({
    descriptor: descriptor(),
    store,
    joinPath: (...segments) => path.posix.join(...segments),
  });
  const order = [];
  const errors = [];
  context.subscriptions.push({ dispose: () => order.push('first') });
  context.subscriptions.push({ dispose: () => { throw new Error('rota'); } });
  context.subscriptions.push({ dispose: () => order.push('third') });

  disposeSubscriptions(context, (err) => errors.push(err.message));

  assert.deepEqual(order, ['third', 'first'], 'LIFO, like VS Code');
  assert.deepEqual(errors, ['rota']);
  assert.deepEqual(context.subscriptions, [], 'the array is drained, not reused');
});


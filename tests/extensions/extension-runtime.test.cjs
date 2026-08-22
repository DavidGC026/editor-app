'use strict';

// Loading and activation of real extension code: entry point resolution,
// `require('vscode')` interception and the activation lifecycle, exercised
// against the fixtures in `tests/fixtures/extensions/host`.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createOwnerIndex,
  installVscodeModuleHook,
  resolveEntryPoint,
} = require('../../dist-electron/extension-host/module-loader.js');
const {
  ExtensionRuntime,
} = require('../../dist-electron/extension-host/extension-runtime.js');
const {
  UnsupportedApiError,
} = require('../../dist-electron/extension-host/vscode-api/unsupported.js');
const {
  createFsMementoStore,
} = require('../../dist-electron/extension-host/fs-memento-store.js');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'extensions', 'host');

const descriptorFor = (name, overrides = {}) => ({
  id: `forge-tests.${name}`,
  version: '1.0.0',
  dir: path.join(FIXTURES, name),
  main: readMain(name),
  globalStoragePath: path.join(os.tmpdir(), 'forge-host-tests', 'global', name),
  workspaceStoragePath: null,
  extensionMode: 'test',
  ...overrides,
});

function readMain(name) {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'package.json'), 'utf8'));
  return manifest.main ?? null;
}

const realEntryPointDeps = {
  realpath: (target) => {
    try {
      return fs.realpathSync(target);
    } catch {
      return path.resolve(target);
    }
  },
  isFile: (target) => {
    try {
      return fs.statSync(target).isFile();
    } catch {
      return false;
    }
  },
};

/**
 * Runtime wired to the real module system and the real fixtures, with an
 * in-memory memento store and a fresh `require` cache per activation so one
 * test cannot observe another's module state.
 */
function createRuntime(overrides = {}) {
  const logs = [];
  const unsupported = [];
  const stored = new Map();
  let clock = 1_000;

  const runtime = new ExtensionRuntime({
    apiVersion: '1.90.0',
    workspacePath: '/w',
    moduleSystem: require('node:module'),
    loadModule: (entryPoint) => {
      delete require.cache[require.resolve(entryPoint)];
      return require(entryPoint);
    },
    entryPointDeps: realEntryPointDeps,
    mementoStore: {
      read: (scope, descriptor) => ({ ...(stored.get(`${scope}:${descriptor.id}`) ?? {}) }),
      write: (scope, descriptor, state) => stored.set(`${scope}:${descriptor.id}`, { ...state }),
    },
    joinPath: (...segments) => path.join(...segments),
    now: () => (clock += 5),
    log: (level, message, extensionId) => logs.push({ level, message, extensionId }),
    reportUnsupportedApi: (api, extensionId) => unsupported.push({ api, extensionId }),
    ...overrides,
  });

  return { runtime, logs, unsupported, stored };
}

// ── Entry point resolution ──────────────────────────────────────────────

test('a declared entry point inside the extension resolves to its file', () => {
  const resolution = resolveEntryPoint(descriptorFor('healthy'), realEntryPointDeps);

  assert.equal(resolution.ok, true);
  assert.equal(resolution.entryPoint, path.join(FIXTURES, 'healthy', 'out', 'extension.js'));
});

test('an entry point escaping the install directory is rejected, not loaded', () => {
  const resolution = resolveEntryPoint(descriptorFor('escaping'), realEntryPointDeps);

  assert.equal(resolution.ok, false);
  assert.equal(resolution.failure.code, 'outside-extension');
});

test('an absolute `main` is still resolved against the extension directory', () => {
  const resolution = resolveEntryPoint(
    descriptorFor('healthy', { main: '/etc/passwd' }),
    realEntryPointDeps,
  );

  assert.equal(resolution.ok, false);
  assert.equal(resolution.failure.code, 'outside-extension');
});

test('a symlink pointing out of the extension is caught on the real path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-symlink-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outside = path.join(root, 'outside.js');
  const dir = path.join(root, 'ext');
  fs.mkdirSync(dir);
  fs.writeFileSync(outside, 'module.exports = {};');
  fs.symlinkSync(outside, path.join(dir, 'extension.js'));

  const resolution = resolveEntryPoint(
    { ...descriptorFor('healthy'), dir, main: './extension.js' },
    realEntryPointDeps,
  );

  assert.equal(resolution.ok, false);
  assert.equal(resolution.failure.code, 'outside-extension', 'containment is checked after realpath');
});

test('a missing entry point reports not-found, distinct from escaping', () => {
  const resolution = resolveEntryPoint(
    descriptorFor('healthy', { main: './out/missing.js' }),
    realEntryPointDeps,
  );

  assert.equal(resolution.ok, false);
  assert.equal(resolution.failure.code, 'not-found');
});

test('an extension without `main` says so instead of guessing a file', () => {
  const resolution = resolveEntryPoint(descriptorFor('healthy', { main: null }), realEntryPointDeps);

  assert.equal(resolution.ok, false);
  assert.equal(resolution.failure.code, 'no-main');
});

test('an extensionless `main` resolves through .js and index.js like node does', () => {
  const extensionless = resolveEntryPoint(
    descriptorFor('healthy', { main: './out/extension' }),
    realEntryPointDeps,
  );
  assert.equal(extensionless.ok, true);

  const directory = resolveEntryPoint(
    descriptorFor('silent', { main: './out' }),
    realEntryPointDeps,
  );
  assert.equal(directory.ok, false, 'out/ has no index.js, so nothing is invented');
});

// ── require('vscode') ───────────────────────────────────────────────────

test('the owner index attributes a file to its extension, longest root first', () => {
  const index = createOwnerIndex([
    { ...descriptorFor('healthy'), dir: '/store/outer' },
    { ...descriptorFor('silent'), id: 'forge-tests.inner', dir: '/store/outer/nested' },
  ]);

  assert.equal(index.ownerOf('/store/outer/out/extension.js'), 'forge-tests.healthy');
  assert.equal(
    index.ownerOf('/store/outer/nested/out/extension.js'),
    'forge-tests.inner',
    'a nested install is not swallowed by its parent',
  );
  assert.equal(index.ownerOf('/elsewhere/file.js'), null);
  assert.equal(index.ownerOf(null), null);
});

test('the hook only intercepts vscode and restores the module system on uninstall', () => {
  const calls = [];
  const moduleSystem = {
    _load(request) {
      calls.push(request);
      return `real:${request}`;
    },
  };
  const uninstall = installVscodeModuleHook({
    moduleSystem,
    ownerIndex: createOwnerIndex([{ ...descriptorFor('healthy'), dir: '/store/ext' }]),
    apiFor: (id) => ({ id }),
  });

  assert.deepEqual(
    moduleSystem._load('vscode', { filename: '/store/ext/out/extension.js' }, false),
    { id: 'forge-tests.healthy' },
  );
  assert.equal(moduleSystem._load('fs', { filename: '/store/ext/out/extension.js' }, false), 'real:fs');
  assert.deepEqual(calls, ['fs'], 'only non-vscode requests reach the original loader');

  uninstall();
  assert.equal(moduleSystem._load('vscode', { filename: '/store/ext/x.js' }, false), 'real:vscode');
});

test('require("vscode") from unowned code is refused rather than misattributed', () => {
  const orphans = [];
  const moduleSystem = { _load: () => 'real' };
  installVscodeModuleHook({
    moduleSystem,
    ownerIndex: createOwnerIndex([]),
    apiFor: () => ({}),
    onOrphanRequire: (filename) => orphans.push(filename),
  });

  assert.throws(
    () => moduleSystem._load('vscode', { filename: '/somewhere/else.js' }, false),
    /no pertenece a ninguna extensión/,
  );
  assert.deepEqual(orphans, ['/somewhere/else.js']);
});

// ── Activation ──────────────────────────────────────────────────────────

test('a healthy fixture loads, gets its own vscode facade and activates', async (t) => {
  const { runtime, stored } = createRuntime();
  runtime.setExtensions([descriptorFor('healthy')]);
  t.after(() => runtime.deactivateAll());

  const result = await runtime.activate('forge-tests.healthy');

  assert.equal(result.id, 'forge-tests.healthy');
  assert.equal(result.status, 'active');
  assert.ok(result.durationMs >= 0);
  assert.deepEqual(result.exports.sort(), ['mode', 'trace', 'uri', 'version']);
  assert.equal(runtime.statusOf('forge-tests.healthy'), 'active');

  // The fixture recorded what it saw through the facade it was handed.
  const loaded = require(path.join(FIXTURES, 'healthy', 'out', 'extension.js'));
  assert.deepEqual(loaded.trace, ['activate', 'event:ping']);
  assert.deepEqual(
    stored.get('global:forge-tests.healthy'),
    { runs: 1 },
    'globalState.update persisted through the injected store',
  );
});

test('activation runs once per generation and concurrent requests share it', async (t) => {
  const { runtime } = createRuntime();
  runtime.setExtensions([descriptorFor('healthy')]);
  t.after(() => runtime.deactivateAll());

  const [first, second] = await Promise.all([
    runtime.activate('forge-tests.healthy'),
    runtime.activate('forge-tests.healthy'),
  ]);
  const third = await runtime.activate('forge-tests.healthy');

  assert.equal(first.status, 'active');
  assert.equal(second.status, 'active');
  assert.equal(third.status, 'active');
  const loaded = require(path.join(FIXTURES, 'healthy', 'out', 'extension.js'));
  assert.equal(
    loaded.trace.filter((entry) => entry === 'activate').length,
    1,
    'activate() ran exactly once',
  );
});

test('an extension that throws fails alone and releases what it registered', async (t) => {
  const { runtime, logs } = createRuntime();
  runtime.setExtensions([descriptorFor('throwing'), descriptorFor('healthy')]);
  t.after(() => runtime.deactivateAll());

  await assert.rejects(runtime.activate('forge-tests.throwing'), (err) => {
    assert.equal(err.code, 'ACTIVATION_FAILED');
    assert.match(err.message, /revienta a propósito/);
    return true;
  });

  assert.equal(runtime.statusOf('forge-tests.throwing'), 'failed');
  const throwing = require(path.join(FIXTURES, 'throwing', 'out', 'extension.js'));
  assert.deepEqual(throwing.released, ['released'], 'its disposables were released');
  assert.ok(logs.some((entry) => entry.level === 'error'), 'the failure is logged');

  // The rest of the generation is untouched.
  const healthy = await runtime.activate('forge-tests.healthy');
  assert.equal(healthy.status, 'active');
});

test('a failed extension stays failed for the generation instead of retrying blindly', async (t) => {
  const { runtime } = createRuntime();
  runtime.setExtensions([descriptorFor('throwing')]);
  t.after(() => runtime.deactivateAll());

  await assert.rejects(runtime.activate('forge-tests.throwing'));
  await assert.rejects(runtime.activate('forge-tests.throwing'), (err) => {
    assert.equal(err.code, 'ACTIVATION_FAILED');
    return true;
  });

  const throwing = require(path.join(FIXTURES, 'throwing', 'out', 'extension.js'));
  assert.equal(throwing.released.length, 1, 'activate() was not attempted twice');
});

test('an unsupported API surfaces as a typed error and is reported for compatibility', async (t) => {
  const { runtime, unsupported } = createRuntime();
  runtime.setExtensions([descriptorFor('unsupported')]);
  t.after(() => runtime.deactivateAll());

  await assert.rejects(runtime.activate('forge-tests.unsupported'), (err) => {
    assert.equal(err.code, 'ACTIVATION_FAILED');
    assert.match(err.message, /vscode\.window\.createStatusBarItem/);
    return true;
  });
  assert.deepEqual(unsupported, [
    { api: 'window.createStatusBarItem', extensionId: 'forge-tests.unsupported' },
  ]);
});

test('a main without activate() counts as active without running anything', async (t) => {
  const { runtime, logs } = createRuntime();
  runtime.setExtensions([descriptorFor('silent')]);
  t.after(() => runtime.deactivateAll());

  const result = await runtime.activate('forge-tests.silent');

  assert.equal(result.status, 'active');
  assert.deepEqual(result.exports, [], 'nothing was returned, so nothing is published');
  assert.ok(logs.some((entry) => entry.level === 'debug'));
});

test('an entry point that escapes fails activation with the reason, not a load', async (t) => {
  const { runtime } = createRuntime();
  runtime.setExtensions([descriptorFor('escaping')]);
  t.after(() => runtime.deactivateAll());

  await assert.rejects(runtime.activate('forge-tests.escaping'), (err) => {
    assert.equal(err.code, 'ACTIVATION_FAILED');
    assert.match(err.message, /resuelve fuera de su directorio/);
    return true;
  });
});

test('an id outside this generation is refused instead of looked up on disk', async () => {
  const { runtime } = createRuntime();
  runtime.setExtensions([descriptorFor('healthy')]);

  await assert.rejects(runtime.activate('forge-tests.unknown'), (err) => {
    assert.equal(err.code, 'INVALID_PAYLOAD');
    assert.match(err.message, /no forma parte de esta generación/);
    return true;
  });
});

test('deactivate runs the extension hook and disposes its subscriptions', async () => {
  const { runtime } = createRuntime();
  runtime.setExtensions([descriptorFor('healthy')]);

  await runtime.activate('forge-tests.healthy');
  await runtime.deactivate('forge-tests.healthy');

  const loaded = require(path.join(FIXTURES, 'healthy', 'out', 'extension.js'));
  assert.deepEqual(loaded.trace, ['activate', 'event:ping', 'deactivate', 'disposed']);
  assert.equal(runtime.statusOf('forge-tests.healthy'), 'inactive');

  // Idempotent: deactivating twice must not re-run anything.
  await runtime.deactivate('forge-tests.healthy');
  assert.equal(loaded.trace.filter((entry) => entry === 'deactivate').length, 1);
});

test('deactivateAll unhooks require("vscode") so the module system is left clean', async () => {
  const moduleSystem = { _load: (request) => `real:${request}` };
  const { runtime } = createRuntime({ moduleSystem });
  runtime.setExtensions([descriptorFor('healthy')]);
  assert.notEqual(
    moduleSystem._load('vscode', { filename: path.join(FIXTURES, 'healthy', 'out', 'extension.js') }, false),
    'real:vscode',
  );

  await runtime.deactivateAll();

  assert.equal(moduleSystem._load('vscode', { filename: 'x' }, false), 'real:vscode');
});

// ── Storage adapter ─────────────────────────────────────────────────────

test('the fs memento store writes inside the directory main assigned', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-memento-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createFsMementoStore();
  const descriptor = {
    ...descriptorFor('healthy'),
    globalStoragePath: path.join(root, 'global', 'forge-tests.healthy'),
  };

  store.write('global', descriptor, { runs: 2 });

  assert.deepEqual(store.read('global', descriptor), { runs: 2 });
  assert.deepEqual(
    fs.readdirSync(descriptor.globalStoragePath),
    ['state.json'],
    'the host never derives a path of its own',
  );

  fs.writeFileSync(path.join(descriptor.globalStoragePath, 'state.json'), '{ not json');
  assert.deepEqual(store.read('global', descriptor), {}, 'corrupt storage reads empty');
});

test('without a workspace, workspace state stays in memory instead of leaking to disk', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-memento-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createFsMementoStore();
  const descriptor = {
    ...descriptorFor('healthy'),
    globalStoragePath: path.join(root, 'global'),
    workspaceStoragePath: null,
  };

  store.write('workspace', descriptor, { open: true });

  assert.deepEqual(store.read('workspace', descriptor), { open: true });
  assert.equal(fs.existsSync(root) && fs.readdirSync(root).length, 0, 'nothing was written');
});

test('the unsupported error names the API and its extension for the report', () => {
  const error = new UnsupportedApiError('window.createTreeView', 'forge-tests.demo');
  assert.match(error.message, /vscode\.window\.createTreeView/);
  assert.match(error.message, /forge-tests\.demo/);
});

// ── Commands (increment 3.3) ────────────────────────────────────────────

test('registered commands are announced to main and run with their args', async (t) => {
  const bridge = [];
  const { runtime } = createRuntime({
    commandBridge: {
      register: (command, extensionId) => bridge.push(['register', command, extensionId]),
      unregister: (command, extensionId) => bridge.push(['unregister', command, extensionId]),
    },
  });
  runtime.setExtensions([descriptorFor('commanding')]);
  t.after(() => runtime.deactivateAll());

  await runtime.activate('forge-tests.commanding');

  assert.deepEqual(bridge, [
    ['register', 'fixture.greet', 'forge-tests.commanding'],
    ['register', 'fixture.explode', 'forge-tests.commanding'],
    ['register', 'fixture.leaked', 'forge-tests.commanding'],
  ], 'main learns the ids, never the handlers');

  assert.equal(await runtime.executeCommand('fixture.greet', ['Forge']), 'hola, Forge');
  assert.deepEqual(runtime.registeredCommands().sort(), [
    'fixture.explode',
    'fixture.greet',
    'fixture.leaked',
  ]);
});

test('a command that throws surfaces its error without unregistering itself', async (t) => {
  const { runtime } = createRuntime();
  runtime.setExtensions([descriptorFor('commanding')]);
  t.after(() => runtime.deactivateAll());
  await runtime.activate('forge-tests.commanding');

  await assert.rejects(runtime.executeCommand('fixture.explode'), /el comando revienta/);

  assert.equal(
    await runtime.executeCommand('fixture.greet'),
    'hola, mundo',
    'the extension stays usable after one command failed',
  );
});

test('an unknown command is COMMAND_NOT_FOUND, not a silent undefined', async (t) => {
  const { runtime } = createRuntime();
  runtime.setExtensions([descriptorFor('commanding')]);
  t.after(() => runtime.deactivateAll());
  await runtime.activate('forge-tests.commanding');

  await assert.rejects(runtime.executeCommand('fixture.nope'), (err) => {
    assert.equal(err.code, 'COMMAND_NOT_FOUND');
    return true;
  });
});

test('deactivate unregisters every command, including what the extension forgot', async () => {
  const bridge = [];
  const { runtime } = createRuntime({
    commandBridge: {
      register: () => undefined,
      unregister: (command) => bridge.push(command),
    },
  });
  runtime.setExtensions([descriptorFor('commanding')]);
  await runtime.activate('forge-tests.commanding');

  await runtime.deactivate('forge-tests.commanding');

  assert.deepEqual(bridge.sort(), ['fixture.explode', 'fixture.greet', 'fixture.leaked']);
  assert.deepEqual(runtime.registeredCommands(), []);
});

test('a failed activation takes its half-registered commands with it', async (t) => {
  const { runtime } = createRuntime({
    loadModule: () => ({
      activate: (context) => {
        const vscode = require('node:module')._load('vscode', { filename: path.join(FIXTURES, 'commanding', 'out', 'extension.js') }, false);
        context.subscriptions.push(vscode.commands.registerCommand('half.done', () => 'x'));
        throw new Error('a medias');
      },
    }),
  });
  runtime.setExtensions([descriptorFor('commanding')]);
  t.after(() => runtime.deactivateAll());

  await assert.rejects(runtime.activate('forge-tests.commanding'));

  assert.deepEqual(
    runtime.registeredCommands(),
    [],
    'a command pointing at an extension that never finished loading is worse than none',
  );
});

test('a duplicate command id is refused instead of hijacking the first', async (t) => {
  const { runtime } = createRuntime({
    loadModule: () => ({
      activate: (context) => {
        const moduleSystem = require('node:module');
        const vscode = moduleSystem._load('vscode', { filename: path.join(FIXTURES, 'commanding', 'out', 'extension.js') }, false);
        context.subscriptions.push(vscode.commands.registerCommand('dup.id', () => 'first'));
        vscode.commands.registerCommand('dup.id', () => 'second');
      },
    }),
  });
  runtime.setExtensions([descriptorFor('commanding')]);
  t.after(() => runtime.deactivateAll());

  await assert.rejects(runtime.activate('forge-tests.commanding'), /ya está registrado/);
});

test('executeCommand reaches the host own commands and refuses workbench ones', async (t) => {
  const { runtime, unsupported } = createRuntime();
  runtime.setExtensions([descriptorFor('commanding')]);
  t.after(() => runtime.deactivateAll());
  await runtime.activate('forge-tests.commanding');

  const api = require('node:module')._load(
    'vscode',
    { filename: path.join(FIXTURES, 'commanding', 'out', 'extension.js') },
    false,
  );

  assert.equal(await api.commands.executeCommand('fixture.greet', 'API'), 'hola, API');
  assert.deepEqual((await api.commands.getCommands()).sort(), [
    'fixture.explode',
    'fixture.greet',
    'fixture.leaked',
  ]);

  await assert.rejects(api.commands.executeCommand('workbench.action.files.save'), (err) => {
    assert.equal(err.code, 'COMMAND_NOT_FOUND');
    return true;
  });
  assert.deepEqual(unsupported, [
    { api: 'commands.executeCommand', extensionId: 'forge-tests.commanding' },
  ]);
});

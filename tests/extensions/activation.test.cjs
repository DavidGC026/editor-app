'use strict';

// Activation events: parsing, matching, the service that fires them and the
// bounded workspace scan behind `workspaceContains:`.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  matchesTrigger,
  matchesWorkspacePattern,
  parseActivationEvent,
} = require('../../dist-electron/extensions/domain/activation-events.js');
const {
  ExtensionActivationService,
} = require('../../dist-electron/extensions/application/extension-activation-service.js');
const {
  scanWorkspaceForPatterns,
} = require('../../dist-electron/extensions/infrastructure/workspace-scanner.js');

// ── Parsing ─────────────────────────────────────────────────────────────

test('the activation events Forge dispatches are parsed; the rest stay unknown', () => {
  assert.deepEqual(parseActivationEvent('*'), { kind: 'star' });
  assert.deepEqual(parseActivationEvent('onStartupFinished'), { kind: 'startupFinished' });
  assert.deepEqual(parseActivationEvent('onCommand:demo.run'), {
    kind: 'command',
    command: 'demo.run',
  });
  assert.deepEqual(parseActivationEvent('onLanguage:python'), {
    kind: 'language',
    language: 'python',
  });
  assert.deepEqual(parseActivationEvent('workspaceContains:**/package.json'), {
    kind: 'workspaceContains',
    pattern: '**/package.json',
  });

  // Recognised as unknown, not silently ignored: that is what lets the
  // compatibility report name what an extension needs.
  assert.deepEqual(parseActivationEvent('onDebug'), { kind: 'unknown', raw: 'onDebug' });
  assert.deepEqual(parseActivationEvent('onCommand:'), { kind: 'unknown', raw: 'onCommand:' });
  assert.deepEqual(parseActivationEvent(''), { kind: 'unknown', raw: '' });
});

test('a trigger matches only its own event kind, and `*` means startup', () => {
  const startup = { kind: 'startupFinished' };
  const python = { kind: 'language', language: 'python' };

  assert.equal(matchesTrigger({ kind: 'star' }, startup), true);
  assert.equal(
    matchesTrigger({ kind: 'star' }, python),
    false,
    '`*` must not re-activate on every language',
  );
  assert.equal(matchesTrigger({ kind: 'language', language: 'python' }, python), true);
  assert.equal(matchesTrigger({ kind: 'language', language: 'go' }, python), false);
  assert.equal(
    matchesTrigger({ kind: 'command', command: 'demo.run' }, { kind: 'command', command: 'demo.run' }),
    true,
  );
  assert.equal(matchesTrigger({ kind: 'unknown', raw: 'onDebug' }, startup), false);
});

// ── Glob subset ─────────────────────────────────────────────────────────

test('workspaceContains globs match the way VS Code manifests expect', () => {
  assert.equal(matchesWorkspacePattern('package.json', 'package.json'), true);
  assert.equal(matchesWorkspacePattern('package.json', 'sub/package.json'), false);

  // `**/` matches zero segments too, which is what makes the common
  // `**/package.json` find the root file.
  assert.equal(matchesWorkspacePattern('**/package.json', 'package.json'), true);
  assert.equal(matchesWorkspacePattern('**/package.json', 'a/b/package.json'), true);

  assert.equal(matchesWorkspacePattern('*.csproj', 'app.csproj'), true);
  assert.equal(matchesWorkspacePattern('*.csproj', 'src/app.csproj'), false, '* stops at /');
  assert.equal(matchesWorkspacePattern('{pom.xml,build.gradle}', 'build.gradle'), true);
  assert.equal(matchesWorkspacePattern('{pom.xml,build.gradle}', 'other'), false);
  assert.equal(matchesWorkspacePattern('file?.txt', 'file1.txt'), true);

  // A pattern is data from a manifest: dots are literal, not "any char".
  assert.equal(matchesWorkspacePattern('a.json', 'axjson'), false);
});

// ── Service ─────────────────────────────────────────────────────────────

function createService({ activatable = [], onActivate, status = 'running' } = {}) {
  const requests = [];
  const state = { status, generation: 1, restartsInWindow: 0, lastError: null };
  let clock = 0;

  const service = new ExtensionActivationService({
    host: {
      get state() {
        return state;
      },
      request: async (method, payload) => {
        requests.push({ method, payload });
        const result = await onActivate?.(payload.id);
        return result ?? { id: payload.id, status: 'active', durationMs: 7, exports: [] };
      },
    },
    activatable: () => activatable,
    ensureRunning: async () => {
      state.status = 'running';
      requests.push({ method: 'ensureRunning' });
    },
    workspaceContains: async (patterns) => patterns.filter((pattern) => pattern === 'pom.xml'),
    now: () => (clock += 1),
    log: () => {},
  });
  service.handleHostEvent({ type: 'state', state });

  return { service, requests, state };
}

test('a startup trigger activates everything declaring it, once', async () => {
  const s = createService({
    activatable: [
      { id: 'a.one', activationEvents: ['onStartupFinished'] },
      { id: 'a.two', activationEvents: ['*'] },
      { id: 'a.three', activationEvents: ['onLanguage:python'] },
    ],
  });

  const first = await s.service.fire({ kind: 'startupFinished' });
  const second = await s.service.fire({ kind: 'startupFinished' });

  assert.deepEqual(first.sort(), ['a.one', 'a.two']);
  assert.deepEqual(second, [], 'already active extensions are not re-activated');
  assert.equal(s.service.stateOf('a.three'), 'idle');
});

test('a language trigger wakes only its declarers and records the reason', async () => {
  const s = createService({
    activatable: [
      { id: 'a.py', activationEvents: ['onLanguage:python'] },
      { id: 'a.go', activationEvents: ['onLanguage:go'] },
    ],
  });

  await s.service.fire({ kind: 'language', language: 'python' });

  assert.equal(s.service.stateOf('a.py'), 'active');
  assert.equal(s.service.stateOf('a.go'), 'idle');
  assert.deepEqual(s.service.metrics().map((entry) => [entry.id, entry.reason, entry.durationMs]), [
    ['a.py', 'onLanguage:python', 7],
  ]);
});

test('a trigger never rejects: a failing extension is recorded and the rest proceed', async () => {
  const s = createService({
    activatable: [
      { id: 'a.bad', activationEvents: ['onStartupFinished'] },
      { id: 'a.good', activationEvents: ['onStartupFinished'] },
    ],
    onActivate: (id) => {
      if (id === 'a.bad') throw Object.assign(new Error('revienta'), { code: 'ACTIVATION_FAILED' });
      return undefined;
    },
  });

  const activated = await s.service.fire({ kind: 'startupFinished' });

  assert.deepEqual(activated, ['a.good']);
  assert.equal(s.service.stateOf('a.bad'), 'failed');
  assert.deepEqual(s.service.failures().map((entry) => [entry.id, entry.code, entry.reason]), [
    ['a.bad', 'ACTIVATION_FAILED', 'onStartupFinished'],
  ]);
});

test('a failed extension is not retried on every later trigger', async () => {
  const s = createService({
    activatable: [{ id: 'a.bad', activationEvents: ['onLanguage:python', 'onStartupFinished'] }],
    onActivate: () => {
      throw new Error('revienta');
    },
  });

  await s.service.fire({ kind: 'language', language: 'python' });
  await s.service.fire({ kind: 'startupFinished' });
  await assert.rejects(s.service.activate('a.bad', 'onCommand:x'), (err) => {
    assert.equal(err.code, 'ACTIVATION_FAILED');
    return true;
  });

  assert.equal(
    s.requests.filter((entry) => entry.method === 'lifecycle.activate').length,
    1,
    'one attempt per generation, not one per keystroke',
  );
});

test('concurrent activations of the same id share one request', async () => {
  let release;
  const s = createService({
    activatable: [{ id: 'a.one', activationEvents: ['onStartupFinished'] }],
    onActivate: () => new Promise((resolve) => { release = resolve; }),
  });

  const both = Promise.all([
    s.service.activate('a.one', 'onCommand:x'),
    s.service.activate('a.one', 'onStartupFinished'),
  ]);
  release({ id: 'a.one', status: 'active', durationMs: 3, exports: [] });
  await both;

  assert.equal(s.requests.filter((entry) => entry.method === 'lifecycle.activate').length, 1);
  assert.equal(s.service.metrics().length, 1, 'one activation, one metric');
});

test('a stopped host is started before the activation it needs', async () => {
  const s = createService({
    activatable: [{ id: 'a.one', activationEvents: ['onStartupFinished'] }],
    status: 'stopped',
  });

  await s.service.activate('a.one', 'onStartupFinished');

  assert.deepEqual(s.requests.map((entry) => entry.method), ['ensureRunning', 'lifecycle.activate']);
});

test('a new generation forgets what the old one activated', async () => {
  const s = createService({
    activatable: [{ id: 'a.one', activationEvents: ['onStartupFinished'] }],
  });
  await s.service.fire({ kind: 'startupFinished' });
  assert.equal(s.service.stateOf('a.one'), 'active');

  s.service.handleHostEvent({
    type: 'state',
    state: { status: 'running', generation: 2, restartsInWindow: 0, lastError: null },
  });

  assert.equal(s.service.stateOf('a.one'), 'idle');
  const activated = await s.service.fire({ kind: 'startupFinished' });
  assert.deepEqual(activated, ['a.one'], 'the new generation activates it again');
});

test('workspaceContains activates only the patterns that matched', async () => {
  const s = createService({
    activatable: [
      { id: 'a.maven', activationEvents: ['workspaceContains:pom.xml'] },
      { id: 'a.gradle', activationEvents: ['workspaceContains:build.gradle'] },
    ],
  });

  const activated = await s.service.fireWorkspaceContains();

  assert.deepEqual(activated, ['a.maven']);
  assert.equal(s.service.stateOf('a.gradle'), 'idle');
  assert.equal(s.service.metrics()[0].reason, 'workspaceContains:pom.xml');
});

test('unknown activation events are reported instead of failing silently', () => {
  const s = createService({
    activatable: [{ id: 'a.one', activationEvents: ['onDebug', 'onCommand:x'] }],
  });

  assert.deepEqual(s.service.unknownEventsOf('a.one'), ['onDebug']);
  assert.deepEqual(s.service.candidatesFor({ kind: 'command', command: 'x' }), ['a.one']);
});

test('invalidate picks up an extension installed after the index was built', () => {
  const activatable = [];
  const s = createService({ activatable });

  assert.deepEqual(s.service.candidatesFor({ kind: 'startupFinished' }), []);
  activatable.push({ id: 'a.new', activationEvents: ['onStartupFinished'] });
  assert.deepEqual(
    s.service.candidatesFor({ kind: 'startupFinished' }),
    [],
    'the index is cached, as it must be for the hot path',
  );

  s.service.invalidate();
  assert.deepEqual(s.service.candidatesFor({ kind: 'startupFinished' }), ['a.new']);
});

// ── Workspace scan ──────────────────────────────────────────────────────

function createWorkspace(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of files) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, '');
  }
  return root;
}

test('the scan finds a root file and a nested one, and reports only matches', async (t) => {
  const root = createWorkspace(t, ['package.json', 'src/app/module.csproj']);

  assert.deepEqual(
    (await scanWorkspaceForPatterns(root, ['package.json', '**/*.csproj', 'pom.xml'])).sort(),
    ['**/*.csproj', 'package.json'],
  );
});

test('the scan skips node_modules and respects its budget', async (t) => {
  const root = createWorkspace(t, ['node_modules/pkg/pom.xml', 'src/a.txt']);

  assert.deepEqual(
    await scanWorkspaceForPatterns(root, ['**/pom.xml']),
    [],
    'a dependency tree is never what a manifest means',
  );

  const deep = createWorkspace(t, ['a/b/c/d/e/f/g/deep.txt']);
  assert.deepEqual(
    await scanWorkspaceForPatterns(deep, ['**/deep.txt'], { maxDepth: 2 }),
    [],
    'depth is bounded',
  );
});

test('no workspace, no patterns and an unreadable directory all answer empty', async (t) => {
  const root = createWorkspace(t, ['package.json']);

  assert.deepEqual(await scanWorkspaceForPatterns(null, ['package.json']), []);
  assert.deepEqual(await scanWorkspaceForPatterns(root, []), []);
  assert.deepEqual(await scanWorkspaceForPatterns(path.join(root, 'nope'), ['package.json']), []);
});

const assert = require('node:assert/strict');
const test = require('node:test');

const { VscodeManifestReader } = require(
  '../../dist-electron/extensions/infrastructure/vscode-manifest-reader.js'
);
const { decodeInstalledExtensionRecord } = require(
  '../../dist-electron/extensions/infrastructure/json-extension-registry.js'
);
// Renderer modules, imported unbundled via Node's TS type stripping.
const { parseWhenClause } = require('../../src/extensions/whenClause.ts');
const { ContextKeyService } = require('../../src/extensions/contextKeys.ts');
const {
  ExtensionCommandService,
  KeybindingService,
  parseChord,
  chordForPlatform,
} = require('../../src/extensions/commands.ts');

// ── Manifest normalization ──────────────────────────────────────────────

function readManifest(contributes) {
  return new VscodeManifestReader().read(JSON.stringify({
    name: 'cmd',
    publisher: 'forge-tests',
    version: '1.0.0',
    engines: { vscode: '*' },
    contributes,
  }));
}

test('reader normalizes commands: titles, nls objects, duplicates, enablement', () => {
  const manifest = readManifest({
    commands: [
      { command: 'demo.hello', title: 'Say Hello', category: 'Demo' },
      { command: 'demo.nls', title: { value: 'Localized' } },
      { command: 'demo.bare' }, // no title: falls back to the id
      { command: 'demo.hello', title: 'Duplicate' }, // first wins
      { command: '   ' }, // blank id: dropped
      { command: 'demo.gated', title: 'Gated', enablement: 'workspaceOpen' },
    ],
  });

  assert.deepEqual(manifest.commands.map((c) => c.command), [
    'demo.hello', 'demo.nls', 'demo.bare', 'demo.gated',
  ]);
  const byId = Object.fromEntries(manifest.commands.map((c) => [c.command, c]));
  assert.equal(byId['demo.hello'].title, 'Say Hello');
  assert.equal(byId['demo.hello'].category, 'Demo');
  assert.equal(byId['demo.nls'].title, 'Localized');
  assert.equal(byId['demo.bare'].title, 'demo.bare');
  assert.equal(byId['demo.bare'].category, null);
  assert.equal(byId['demo.gated'].enablement, 'workspaceOpen');
});

test('reader normalizes keybindings: single object, removals, platform chords', () => {
  const arrayForm = readManifest({
    keybindings: [
      { command: 'demo.hello', key: 'ctrl+f1', mac: 'cmd+f1', when: 'editorIsOpen' },
      { command: '-workbench.action.something', key: 'ctrl+k' }, // removal: skipped
      { command: 'demo.nokey' }, // missing key: skipped
      { key: 'ctrl+x' }, // missing command: skipped
    ],
  });
  assert.equal(arrayForm.keybindings.length, 1);
  assert.deepEqual(arrayForm.keybindings[0], {
    command: 'demo.hello',
    key: 'ctrl+f1',
    mac: 'cmd+f1',
    linux: null,
    win: null,
    when: 'editorIsOpen',
  });

  const objectForm = readManifest({
    keybindings: { command: 'demo.solo', key: 'alt+z' },
  });
  assert.equal(objectForm.keybindings.length, 1);
  assert.equal(objectForm.keybindings[0].command, 'demo.solo');
});

test('registry decoder round-trips commands/keybindings and tolerates legacy records', () => {
  const manifest = readManifest({
    commands: [{ command: 'demo.hello', title: 'Say Hello' }],
    keybindings: [{ command: 'demo.hello', key: 'ctrl+f1' }],
  });
  const record = { ...manifest, dir: '/tmp/somewhere', enabled: true };
  const decoded = decodeInstalledExtensionRecord(record.id, JSON.parse(JSON.stringify(record)));
  assert.deepEqual(decoded.commands, manifest.commands);
  assert.deepEqual(decoded.keybindings, manifest.keybindings);

  const legacy = decodeInstalledExtensionRecord('a.b', { dir: '/tmp/x' });
  assert.deepEqual(legacy.commands, []);
  assert.deepEqual(legacy.keybindings, []);
});

// ── When-clause parser ──────────────────────────────────────────────────

function evaluate(expression, context) {
  const clause = parseWhenClause(expression);
  assert.notEqual(clause, null, `expected "${expression}" to parse`);
  return clause.evaluate((key) => context[key]);
}

test('when-clauses: keys, negation, precedence, parentheses', () => {
  assert.equal(evaluate('editorIsOpen', { editorIsOpen: true }), true);
  assert.equal(evaluate('editorIsOpen', {}), false, 'unknown keys are falsy');
  assert.equal(evaluate('!editorIsOpen', {}), true);

  // ! > == > && > ||
  assert.equal(evaluate('a && b || c', { a: false, c: true }), true);
  assert.equal(evaluate('a && (b || c)', { a: false, c: true }), false);
  assert.equal(evaluate('!a && b', { a: false, b: true }), true);

  assert.equal(
    evaluate("editorLangId == 'python' && workspaceOpen", {
      editorLangId: 'python',
      workspaceOpen: true,
    }),
    true,
  );
});

test('when-clauses: equality is tolerant across strings, numbers and booleans', () => {
  assert.equal(evaluate("mode == 'fast'", { mode: 'fast' }), true);
  assert.equal(evaluate('mode != "fast"', { mode: 'safe' }), true);
  assert.equal(evaluate('count == 3', { count: 3 }), true);
  assert.equal(evaluate("count == '3'", { count: 3 }), true, 'string form matches');
  assert.equal(evaluate('flag == true', { flag: true }), true);
  assert.equal(evaluate('missing == false', {}), false, 'unset keys equal nothing');
});

test('malformed when-clauses parse to null instead of throwing', () => {
  for (const expression of ['a &&', '(a', "x == 'unterminated", 'a ~ b', '']) {
    assert.equal(parseWhenClause(expression), null, `"${expression}" should not parse`);
  }
});

test('ContextKeyService: match caching, change notification, malformed warning', () => {
  const warnings = [];
  const service = new ContextKeyService((message) => warnings.push(message));

  assert.equal(service.match(null), true, 'null clause always matches');
  assert.equal(service.match('workspaceOpen'), false);
  service.set('workspaceOpen', true);
  assert.equal(service.match('workspaceOpen'), true);

  let notifications = 0;
  const unsubscribe = service.onDidChange(() => { notifications += 1; });
  service.set('workspaceOpen', true); // unchanged: no notification
  service.set('workspaceOpen', false);
  service.set('workspaceOpen', undefined); // delete
  service.set('workspaceOpen', undefined); // already gone: no notification
  assert.equal(notifications, 2);
  unsubscribe();
  service.set('workspaceOpen', 1);
  assert.equal(notifications, 2);

  service.match('a &&');
  service.match('a &&'); // cached: warns only once
  assert.equal(warnings.filter((w) => w.includes('malformed')).length, 1);
});

// ── Command service ─────────────────────────────────────────────────────

test('commands without a handler warn and report false; handlers run and can fail', () => {
  const warnings = [];
  const service = new ExtensionCommandService((message) => warnings.push(message));

  assert.equal(service.execute('demo.none'), false);
  assert.match(warnings[0], /demo\.none/);

  const calls = [];
  const registration = service.registerHandler('demo.hello', (...args) => calls.push(args));
  assert.equal(service.execute('demo.hello', 1, 'two'), true);
  assert.deepEqual(calls, [[1, 'two']]);

  registration.dispose();
  assert.equal(service.hasHandler('demo.hello'), false);

  service.registerHandler('demo.boom', () => { throw new Error('kaputt'); });
  assert.equal(service.execute('demo.boom'), false);
  assert.match(warnings.at(-1), /kaputt/);
});

// ── Keybinding service ──────────────────────────────────────────────────

const stroke = (key, mods = {}) => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

test('chord parsing: modifiers, named keys, unsupported shapes', () => {
  assert.deepEqual(parseChord('ctrl+shift+p'), {
    ctrl: true, shift: true, alt: false, meta: false, key: 'p',
  });
  assert.deepEqual(parseChord('cmd+Up'), {
    ctrl: false, shift: false, alt: false, meta: true, key: 'arrowup',
  });
  assert.equal(parseChord('ctrl+k ctrl+s'), null, 'multi-stroke chords unsupported');
  assert.equal(parseChord('ctrl+'), null);
  assert.equal(parseChord('ctrl+a+b'), null, 'two non-modifier parts');
});

test('platform chord selection falls back to the default key', () => {
  const binding = { command: 'x', key: 'ctrl+f1', mac: 'cmd+f1', linux: null, win: null, when: null };
  assert.equal(chordForPlatform(binding, 'mac'), 'cmd+f1');
  assert.equal(chordForPlatform(binding, 'linux'), 'ctrl+f1');
  assert.equal(chordForPlatform(binding, 'win'), 'ctrl+f1');
});

function createKeybindingHarness(context = {}) {
  const contextService = new ContextKeyService(() => {});
  for (const [key, value] of Object.entries(context)) contextService.set(key, value);
  const executed = [];
  const handlers = new Set();
  const warnings = [];
  const service = new KeybindingService({
    matchWhen: (expression) => contextService.match(expression),
    execute: (command) => {
      executed.push(command);
      return handlers.has(command);
    },
    platform: 'linux',
    warn: (message) => warnings.push(message),
  });
  return { service, contextService, executed, handlers, warnings };
}

test('dispatch: chord + when gating, handler required to consume, dispose cleans up', () => {
  const h = createKeybindingHarness({ editorIsOpen: true });
  h.handlers.add('demo.hello');

  const registration = h.service.register({
    command: 'demo.hello', key: 'ctrl+f1', mac: null, linux: null, win: null,
    when: 'editorIsOpen',
  });
  h.service.register({
    command: 'demo.unhandled', key: 'ctrl+f2', mac: null, linux: null, win: null, when: null,
  });

  assert.equal(h.service.dispatch(stroke('f1', { ctrlKey: true })), true);
  assert.deepEqual(h.executed, ['demo.hello']);
  assert.equal(
    h.service.dispatch(stroke('f1', { ctrlKey: true, shiftKey: true })),
    false,
    'extra modifiers do not match',
  );

  // A binding whose command has no handler must not consume the stroke.
  assert.equal(h.service.dispatch(stroke('f2', { ctrlKey: true })), false);
  assert.deepEqual(h.executed, ['demo.hello', 'demo.unhandled']);

  // When-clause turning false stops dispatch entirely.
  h.contextService.set('editorIsOpen', false);
  assert.equal(h.service.dispatch(stroke('f1', { ctrlKey: true })), false);
  assert.equal(h.executed.length, 2);

  h.contextService.set('editorIsOpen', true);
  registration.dispose();
  assert.equal(h.service.dispatch(stroke('f1', { ctrlKey: true })), false);
  assert.equal(h.executed.length, 2, 'disposed bindings never dispatch');
});

test('the most recently registered matching binding wins', () => {
  const h = createKeybindingHarness();
  h.handlers.add('first');
  h.handlers.add('second');
  h.service.register({ command: 'first', key: 'ctrl+f9', mac: null, linux: null, win: null, when: null });
  h.service.register({ command: 'second', key: 'ctrl+f9', mac: null, linux: null, win: null, when: null });

  assert.equal(h.service.dispatch(stroke('f9', { ctrlKey: true })), true);
  assert.deepEqual(h.executed, ['second']);
});

test('unsupported chords warn and register nothing', () => {
  const h = createKeybindingHarness();
  const registration = h.service.register({
    command: 'demo.chord', key: 'ctrl+k ctrl+s', mac: null, linux: null, win: null, when: null,
  });
  assert.equal(h.warnings.length, 1);
  registration.dispose(); // inert disposable must not throw
  assert.equal(h.service.dispatch(stroke('k', { ctrlKey: true })), false);
});

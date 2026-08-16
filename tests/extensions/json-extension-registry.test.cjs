const assert = require('node:assert/strict');
const test = require('node:test');

const {
  JsonExtensionRegistry,
  decodeInstalledExtensionRecord,
} = require('../../dist-electron/extensions/infrastructure/json-extension-registry.js');

function createHarness(initialConfig = {}) {
  let config = structuredClone(initialConfig);
  let writes = 0;
  const registry = new JsonExtensionRegistry({
    readConfig: () => structuredClone(config),
    writeConfig: (nextConfig) => {
      config = structuredClone(nextConfig);
      writes += 1;
    },
  });
  return {
    registry,
    config: () => structuredClone(config),
    writes: () => writes,
  };
}

function installedRecord(overrides = {}) {
  return {
    id: 'forge-tests.fixture',
    name: 'fixture',
    displayName: 'Fixture',
    publisher: 'forge-tests',
    version: '1.0.0',
    description: '',
    categories: [],
    activationEvents: [],
    extensionKind: [],
    main: null,
    browser: null,
    contributes: [],
    themes: [],
    snippets: [],
    iconThemes: [],
    languages: [],
    dir: '/extensions/forge-tests.fixture',
    ...overrides,
  };
}

test('upsert and remove preserve unrelated Forge configuration', () => {
  const harness = createHarness({ activeTheme: 'forge-dark', remote: { host: 'example' } });
  harness.registry.upsert(installedRecord());

  assert.equal(harness.registry.get('FORGE-TESTS.FIXTURE').version, '1.0.0');
  assert.equal(harness.config().activeTheme, 'forge-dark');
  assert.deepEqual(harness.config().remote, { host: 'example' });
  assert.equal(harness.writes(), 1);

  const removed = harness.registry.remove('forge-tests.fixture');
  assert.equal(removed.id, 'forge-tests.fixture');
  assert.deepEqual(harness.registry.list(), []);
  assert.equal(harness.config().activeTheme, 'forge-dark');
  assert.equal(harness.writes(), 2);
});

test('upsert replaces one extension without dropping other registry entries', () => {
  const first = installedRecord();
  const second = installedRecord({
    id: 'forge-tests.second',
    name: 'second',
    dir: '/extensions/forge-tests.second',
  });
  const harness = createHarness({ extensions: { [first.id]: first } });

  harness.registry.upsert(second);
  assert.deepEqual(
    harness.registry.list().map((extension) => extension.id).sort(),
    ['forge-tests.fixture', 'forge-tests.second'],
  );
});

test('decodes legacy entries that predate the normalized name field', () => {
  const decoded = decodeInstalledExtensionRecord('legacy-publisher.legacy-name', {
    id: 'legacy-publisher.legacy-name',
    displayName: 'Legacy Extension',
    publisher: 'legacy-publisher',
    version: '0.5.0',
    extensionKind: 'workspace',
    contributes: ['themes'],
    themes: [{ label: 'Legacy', uiTheme: 'vs-dark', path: 'theme.json' }],
    dir: '/extensions/legacy-publisher.legacy-name',
  });

  assert.ok(decoded);
  assert.equal(decoded.name, 'legacy-name');
  assert.deepEqual(decoded.extensionKind, ['workspace']);
  assert.deepEqual(decoded.themes, [{
    label: 'Legacy', uiTheme: 'vs-dark', path: 'theme.json',
  }]);
});

test('ignores malformed registry entries instead of leaking invalid domain objects', () => {
  const harness = createHarness({
    extensions: {
      valid: installedRecord(),
      missingDirectory: { id: 'broken.extension' },
      primitive: 'invalid',
    },
  });

  assert.deepEqual(harness.registry.list().map((extension) => extension.id), [
    'forge-tests.fixture',
  ]);
  assert.equal(harness.registry.remove('does.not-exist'), null);
  assert.equal(harness.writes(), 0);
});

test('normalizes legacy mixed-case keys on update and removal', () => {
  const existing = installedRecord({ id: 'forge-tests.fixture' });
  const harness = createHarness({
    extensions: { 'FORGE-TESTS.FIXTURE': existing },
  });

  harness.registry.upsert(installedRecord({ version: '2.0.0' }));
  assert.deepEqual(Object.keys(harness.config().extensions), ['forge-tests.fixture']);
  assert.equal(harness.registry.get('forge-tests.fixture').version, '2.0.0');
  assert.ok(harness.registry.remove('FORGE-TESTS.FIXTURE'));
  assert.deepEqual(harness.config().extensions, {});
});

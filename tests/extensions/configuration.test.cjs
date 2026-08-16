const assert = require('node:assert/strict');
const test = require('node:test');

const { ConfigurationService, ConfigurationValueError } = require(
  '../../dist-electron/extensions/application/configuration-service.js'
);
const { decodeInstalledExtensionRecord } = require(
  '../../dist-electron/extensions/infrastructure/json-extension-registry.js'
);
const { VscodeManifestReader } = require(
  '../../dist-electron/extensions/infrastructure/vscode-manifest-reader.js'
);

// ── Manifest normalization ──────────────────────────────────────────────

function readManifest(contributes) {
  return new VscodeManifestReader().read(JSON.stringify({
    name: 'cfg',
    publisher: 'forge-tests',
    version: '1.0.0',
    engines: { vscode: '*' },
    contributes,
  }));
}

test('reader flattens configuration sections and understands schema shapes', () => {
  const manifest = readManifest({
    configuration: [
      {
        title: 'General',
        properties: {
          'cfg.enable': { type: 'boolean', default: true, description: 'Turn it on' },
          'cfg.mode': { type: 'string', enum: ['fast', 'safe'], default: 'safe' },
        },
      },
      {
        title: 'Advanced',
        properties: {
          'cfg.retries': { type: ['integer', 'null'], default: 3 },
          'cfg.enable': { type: 'boolean', default: false }, // duplicate: first wins
          'cfg.untyped': { markdownDescription: 'Anything goes' },
        },
      },
    ],
    configurationDefaults: { 'editor.fontSize': 13 },
  });

  assert.deepEqual(manifest.configuration.map((s) => s.key), [
    'cfg.enable', 'cfg.mode', 'cfg.retries', 'cfg.untyped',
  ]);
  const byKey = Object.fromEntries(manifest.configuration.map((s) => [s.key, s]));
  assert.equal(byKey['cfg.enable'].default, true, 'first declaration wins');
  assert.deepEqual(byKey['cfg.mode'].enum, ['fast', 'safe']);
  assert.equal(byKey['cfg.retries'].type, 'integer', 'type lists use the first entry');
  assert.equal(byKey['cfg.untyped'].type, null);
  assert.equal(byKey['cfg.untyped'].description, 'Anything goes');
  assert.deepEqual(manifest.configurationDefaults, { 'editor.fontSize': 13 });
});

test('a single configuration object (no array) also normalizes', () => {
  const manifest = readManifest({
    configuration: { properties: { 'cfg.solo': { type: 'string', default: 'x' } } },
  });
  assert.equal(manifest.configuration.length, 1);
  assert.equal(manifest.configuration[0].key, 'cfg.solo');
});

test('registry decoder round-trips configuration fields', () => {
  const manifest = readManifest({
    configuration: { properties: { 'cfg.enable': { type: 'boolean', default: true } } },
    configurationDefaults: { 'other.key': 'value' },
  });
  const record = { ...manifest, dir: '/tmp/somewhere', enabled: true };
  const decoded = decodeInstalledExtensionRecord(record.id, JSON.parse(JSON.stringify(record)));

  assert.deepEqual(decoded.configuration, manifest.configuration);
  assert.deepEqual(decoded.configurationDefaults, { 'other.key': 'value' });
});

test('registry decoder tolerates legacy records without configuration', () => {
  const decoded = decodeInstalledExtensionRecord('a.b', { dir: '/tmp/x' });
  assert.deepEqual(decoded.configuration, []);
  assert.deepEqual(decoded.configurationDefaults, {});
});

// ── ConfigurationService ────────────────────────────────────────────────

function record(id, configuration = [], configurationDefaults = {}, enabled = true) {
  return {
    ...readManifest({}),
    id,
    configuration,
    configurationDefaults,
    dir: `/tmp/${id}`,
    enabled,
  };
}

function createService(records, initialValues = {}, workspace = null) {
  let stored = { ...initialValues };
  let workspaceStored = workspace ? { ...workspace } : null;
  const warnings = [];
  const changes = [];
  const service = new ConfigurationService({
    records: () => records,
    userStore: {
      read: () => ({ ...stored }),
      write: (values) => { stored = values; },
    },
    workspaceStore: () => workspaceStored === null ? null : {
      read: () => ({ ...workspaceStored }),
      write: (values) => { workspaceStored = values; },
    },
    warn: (message) => warnings.push(message),
  });
  service.onDidChange((key) => changes.push(key));
  return {
    service,
    warnings,
    changes,
    stored: () => stored,
    workspaceStored: () => workspaceStored,
    closeWorkspace: () => { workspaceStored = null; },
  };
}

const enableSetting = { key: 'cfg.enable', type: 'boolean', default: true, description: '', enum: null };
const modeSetting = { key: 'cfg.mode', type: 'string', default: 'safe', description: '', enum: ['fast', 'safe'] };

test('scope precedence: default < extension override < user value', () => {
  const owner = record('forge-tests.owner', [enableSetting]);
  const overrider = record('forge-tests.overrider', [], { 'cfg.enable': false });
  const { service } = createService([owner, overrider], { 'cfg.enable': true });

  let inspected = service.inspectAll().find((s) => s.key === 'cfg.enable');
  assert.equal(inspected.effectiveValue, true);
  assert.equal(inspected.effectiveSource, 'user');

  // Without a user value the override wins over the declared default.
  service.setUserValue('cfg.enable', undefined);
  inspected = service.inspectAll().find((s) => s.key === 'cfg.enable');
  assert.equal(inspected.effectiveValue, false);
  assert.equal(inspected.effectiveSource, 'extension-override');

  // Without the overrider, the declared default surfaces.
  const alone = createService([owner]).service.inspectAll()[0];
  assert.equal(alone.effectiveValue, true);
  assert.equal(alone.effectiveSource, 'default');
});

test('disabled extensions contribute neither settings nor overrides', () => {
  const owner = record('forge-tests.owner', [enableSetting], {}, false);
  const overrider = record('forge-tests.overrider', [], { 'cfg.enable': false }, false);
  const { service } = createService([owner, overrider]);
  assert.deepEqual(service.inspectAll(), []);
});

test('writing validates type and enum against the declared schema', () => {
  const { service, stored } = createService([
    record('forge-tests.owner', [enableSetting, modeSetting]),
  ]);

  assert.throws(() => service.setUserValue('cfg.enable', 'yes'), ConfigurationValueError);
  assert.throws(() => service.setUserValue('cfg.mode', 'turbo'), ConfigurationValueError);

  service.setUserValue('cfg.enable', false);
  service.setUserValue('cfg.mode', 'fast');
  assert.deepEqual(stored(), { 'cfg.enable': false, 'cfg.mode': 'fast' });
  assert.equal(service.get('cfg.mode'), 'fast');

  // Clearing removes the key entirely instead of storing undefined.
  service.setUserValue('cfg.mode', undefined);
  assert.deepEqual(stored(), { 'cfg.enable': false });
});

test('workspace values outrank user values and follow the open workspace', () => {
  const owner = record('forge-tests.owner', [enableSetting]);
  const h = createService([owner], { 'cfg.enable': true }, { 'cfg.enable': false });

  let inspected = h.service.inspectAll()[0];
  assert.equal(inspected.effectiveValue, false);
  assert.equal(inspected.effectiveSource, 'workspace');
  assert.equal(inspected.userValue, true, 'the user value is still reported');

  // Closing the workspace surfaces the user value again — nothing is lost.
  h.closeWorkspace();
  inspected = h.service.inspectAll()[0];
  assert.equal(inspected.effectiveValue, true);
  assert.equal(inspected.effectiveSource, 'user');
});

test('workspace writes validate, persist separately and require a workspace', () => {
  const owner = record('forge-tests.owner', [enableSetting, modeSetting]);
  const h = createService([owner], {}, {});

  h.service.setValue('cfg.mode', 'fast', 'workspace');
  assert.deepEqual(h.workspaceStored(), { 'cfg.mode': 'fast' });
  assert.deepEqual(h.stored(), {}, 'the user scope is untouched');
  assert.throws(
    () => h.service.setValue('cfg.mode', 'turbo', 'workspace'),
    ConfigurationValueError,
    'schema validation applies to every scope',
  );

  h.service.setValue('cfg.mode', undefined, 'workspace');
  assert.deepEqual(h.workspaceStored(), {});

  h.closeWorkspace();
  assert.throws(
    () => h.service.setValue('cfg.mode', 'fast', 'workspace'),
    ConfigurationValueError,
    'workspace writes need an open local workspace',
  );
});

test('every successful write notifies subscribers; unsubscribe stops them', () => {
  const owner = record('forge-tests.owner', [enableSetting]);
  const h = createService([owner], {}, {});

  h.service.setUserValue('cfg.enable', false);
  h.service.setValue('cfg.enable', true, 'workspace');
  assert.deepEqual(h.changes, ['cfg.enable', 'cfg.enable']);

  assert.throws(() => h.service.setUserValue('cfg.enable', 'bad'));
  assert.equal(h.changes.length, 2, 'failed writes do not notify');

  const seen = [];
  const unsubscribe = h.service.onDidChange((key) => seen.push(key));
  unsubscribe();
  h.service.setUserValue('cfg.enable', true);
  assert.deepEqual(seen, []);
});

test('workspace settings adapter reads tolerantly and writes atomically', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { ForgeWorkspaceSettingsStore } = require(
    '../../dist-electron/extensions/infrastructure/forge-workspace-settings-store.js'
  );

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-ws-settings-'));
  t.after(() => fs.rmSync(workspaceDir, { recursive: true, force: true }));
  const warnings = [];
  const store = new ForgeWorkspaceSettingsStore({
    workspaceDir,
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(store.read(), {}, 'missing file reads as empty, no warning');
  assert.equal(warnings.length, 0);

  store.write({ 'cfg.enable': true });
  const settingsPath = path.join(workspaceDir, '.forge', 'settings.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), { 'cfg.enable': true });
  assert.deepEqual(store.read(), { 'cfg.enable': true });

  fs.writeFileSync(settingsPath, '{ corrupted');
  assert.deepEqual(store.read(), {}, 'corrupt file reads as empty');
  assert.equal(warnings.length, 1);

  fs.writeFileSync(settingsPath, '[1,2,3]');
  assert.deepEqual(store.read(), {}, 'non-object root reads as empty');
});

test('unknown keys store as-is and re-declaring a key keeps the first owner', () => {
  const a = record('forge-tests.a', [enableSetting]);
  const b = record('forge-tests.b', [{ ...enableSetting, default: false }]);
  const { service, warnings, stored } = createService([a, b]);

  const inspected = service.inspectAll().find((s) => s.key === 'cfg.enable');
  assert.equal(inspected.ownerId, 'forge-tests.a');
  assert.equal(inspected.defaultValue, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /forge-tests\.b/);

  // Settings for not-yet-installed extensions persist without validation.
  service.setUserValue('future.setting', 42);
  assert.deepEqual(stored(), { 'future.setting': 42 });
});

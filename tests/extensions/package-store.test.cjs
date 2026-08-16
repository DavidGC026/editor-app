const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createStoredZip } = require('./helpers/stored-zip.cjs');
const { InstallExtensionFromVsix } = require(
  '../../dist-electron/extensions/application/install-extension-from-vsix.js'
);
const { checkVscodeEngine } = require('../../dist-electron/extensions/domain/vscode-engine.js');
const { JsonExtensionRegistry } = require(
  '../../dist-electron/extensions/infrastructure/json-extension-registry.js'
);
const { VscodeManifestReader } = require(
  '../../dist-electron/extensions/infrastructure/vscode-manifest-reader.js'
);
const { VsixPackageStore } = require(
  '../../dist-electron/extensions/infrastructure/vsix-package-store.js'
);

function manifestSource(overrides = {}) {
  return JSON.stringify({
    name: 'fixture-transactional',
    publisher: 'forge-tests',
    version: '1.0.0',
    engines: { vscode: '^1.80.0' },
    contributes: { themes: [{ label: 'T', uiTheme: 'vs-dark', path: './theme.json' }] },
    ...overrides,
  });
}

function writeVsix(dir, entries) {
  const vsixPath = path.join(dir, `pkg-${Date.now()}-${Math.random().toString(16).slice(2)}.vsix`);
  fs.writeFileSync(vsixPath, createStoredZip(entries));
  return vsixPath;
}

function createHarness(storeOptions = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-pkg-store-'));
  const rootDir = path.join(tempRoot, 'extensions');
  let config = {};
  const registry = new JsonExtensionRegistry({
    readConfig: () => JSON.parse(JSON.stringify(config)),
    writeConfig: (next) => { config = next; },
  });
  const packageStore = new VsixPackageStore({
    rootDir: () => rootDir,
    manifestReader: new VscodeManifestReader(),
    ...storeOptions,
  });
  const warnings = [];
  const useCase = new InstallExtensionFromVsix({
    packageStore,
    registry,
    warn: (message) => warnings.push(message),
  });
  return {
    tempRoot,
    rootDir,
    registry,
    packageStore,
    useCase,
    warnings,
    getConfig: () => config,
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
  };
}

function stagingLeftovers(rootDir) {
  try {
    return fs.readdirSync(path.join(rootDir, '.staging'));
  } catch {
    return [];
  }
}

test('installs a VSIX into a versioned directory and records provenance', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const vsixPath = writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
    { name: 'extension/theme.json', data: '{"colors":{}}' },
  ]);
  const record = h.useCase.install(vsixPath);

  assert.equal(record.id, 'forge-tests.fixture-transactional');
  assert.equal(
    record.dir,
    path.join(h.rootDir, 'forge-tests.fixture-transactional', '1.0.0'),
  );
  assert.ok(fs.existsSync(path.join(record.dir, 'theme.json')));
  assert.match(record.sha256, /^[0-9a-f]{64}$/);
  assert.equal(h.registry.get(record.id).dir, record.dir);
  assert.deepEqual(stagingLeftovers(h.rootDir), []);
});

test('upgrading retains exactly the previous version for rollback', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const v1 = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
  ]));
  const v2 = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource({ version: '2.0.0' }) },
  ]));

  assert.equal(v2.dir, path.join(h.rootDir, v2.id, '2.0.0'));
  assert.equal(h.registry.get(v2.id).version, '2.0.0');
  assert.deepEqual(h.registry.get(v2.id).previousVersion, {
    version: '1.0.0',
    sha256: v1.sha256,
  });
  assert.ok(fs.existsSync(v1.dir), 'previous version stays on disk for rollback');
  assert.ok(fs.existsSync(v2.dir));

  // A third install keeps current + its previous and drops the oldest.
  const v3 = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource({ version: '3.0.0' }) },
  ]));
  assert.equal(h.registry.get(v3.id).previousVersion.version, '2.0.0');
  assert.ok(!fs.existsSync(v1.dir), 'oldest version is pruned');
  assert.ok(fs.existsSync(v2.dir));
  assert.ok(fs.existsSync(v3.dir));
});

test('a rejected package leaves the active version and registry intact', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const good = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
  ]));

  // Same extension, newer version, but the manifest lost its publisher.
  const badVsix = writeVsix(h.tempRoot, [
    {
      name: 'extension/package.json',
      data: manifestSource({ version: '2.0.0', publisher: undefined }),
    },
  ]);
  assert.throws(
    () => h.useCase.install(badVsix),
    (err) => err.name === 'ExtensionInstallError' && err.code === 'invalid-manifest',
  );

  assert.equal(h.registry.get(good.id).version, '1.0.0');
  assert.ok(fs.existsSync(good.dir), 'active version must survive the failed install');
  assert.deepEqual(stagingLeftovers(h.rootDir), []);
});

test('rejects packages whose entries escape the staging directory', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const vsixPath = writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
    { name: 'extension/../evil.txt', data: 'outside' },
  ]);
  assert.throws(
    () => h.useCase.install(vsixPath),
    (err) => err.name === 'ExtensionInstallError' && err.code === 'unsafe-path',
  );
  assert.ok(!fs.existsSync(path.join(h.rootDir, 'evil.txt')));
  assert.deepEqual(stagingLeftovers(h.rootDir), []);
});

test('enforces per-file and total size limits during staging', (t) => {
  const h = createHarness({ maxFileBytes: 300, maxTotalBytes: 500 });
  t.after(h.cleanup);

  const tooLargeFile = writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
    { name: 'extension/blob.bin', data: 'x'.repeat(301) },
  ]);
  assert.throws(
    () => h.useCase.install(tooLargeFile),
    (err) => err.code === 'file-too-large',
  );

  const tooLargeTotal = writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
    { name: 'extension/a.bin', data: 'x'.repeat(250) },
    { name: 'extension/b.bin', data: 'x'.repeat(250) },
  ]);
  assert.throws(
    () => h.useCase.install(tooLargeTotal),
    (err) => err.code === 'package-too-large',
  );
  assert.deepEqual(stagingLeftovers(h.rootDir), []);
});

test('rejects extensions requiring a newer VS Code API', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const vsixPath = writeVsix(h.tempRoot, [
    {
      name: 'extension/package.json',
      data: manifestSource({ engines: { vscode: '>=99.0.0' } }),
    },
  ]);
  assert.throws(
    () => h.useCase.install(vsixPath),
    (err) => err.code === 'incompatible-engine',
  );
  assert.equal(h.registry.get('forge-tests.fixture-transactional'), null);
  assert.deepEqual(stagingLeftovers(h.rootDir), []);
});

test('installs with a warning when the engine range is not understood', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const record = h.useCase.install(writeVsix(h.tempRoot, [
    {
      name: 'extension/package.json',
      data: manifestSource({ engines: { vscode: '>=1.2.3 <2.0.0 || ^3.1.0' } }),
    },
  ]));
  assert.ok(fs.existsSync(record.dir));
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0], /engines\.vscode/);
});

test('a manifest without engines.vscode still installs (legacy tolerance)', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const record = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource({ engines: undefined }) },
  ]));
  assert.equal(record.enginesVscode, null);
  assert.ok(fs.existsSync(record.dir));
});

test('installs are enabled by default and upgrades preserve a disabled state', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const v1 = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
  ]));
  assert.equal(v1.enabled, true);

  h.registry.upsert({ ...v1, enabled: false });
  const v2 = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource({ version: '2.0.0' }) },
  ]));
  assert.equal(v2.enabled, false, 'upgrade must keep the user choice');
  assert.equal(h.registry.get(v2.id).enabled, false);
});

test('registry decoder treats legacy records without the flag as enabled', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const record = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
  ]));
  // Simulate a pre-1.1 registry entry: strip the flag from persisted data.
  const config = h.getConfig();
  delete config.extensions[record.id].enabled;
  h.registry.upsert({ ...h.registry.get(record.id) }); // decode → re-encode
  assert.equal(h.registry.get(record.id).enabled, true);
});

test('a crash during the promote rename restores the previous same-version install', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const first = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
    { name: 'extension/marker.txt', data: 'first-install' },
  ]));

  const realRename = fs.renameSync;
  fs.renameSync = (src, dest) => {
    // Fail only on the staging → target promote; the parking rename works.
    if (String(src).includes('.staging')) {
      throw new Error('simulated crash at promote');
    }
    return realRename(src, dest);
  };
  t.after(() => { fs.renameSync = realRename; });

  const retryVsix = writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
    { name: 'extension/marker.txt', data: 'second-install' },
  ]);
  assert.throws(
    () => h.useCase.install(retryVsix),
    (err) => err.name === 'ExtensionInstallError' && err.code === 'commit-failed',
  );
  fs.renameSync = realRename;

  // The parked directory was restored: same path, original contents.
  assert.equal(
    fs.readFileSync(path.join(first.dir, 'marker.txt'), 'utf8'),
    'first-install',
  );
  assert.equal(h.registry.get(first.id).version, '1.0.0');
  assert.deepEqual(stagingLeftovers(h.rootDir), []);
});

test('a crash during a fresh commit leaves no partial version directory', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const realRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated crash at promote'); };
  t.after(() => { fs.renameSync = realRename; });

  const vsixPath = writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
  ]);
  assert.throws(
    () => h.useCase.install(vsixPath),
    (err) => err.code === 'commit-failed',
  );
  fs.renameSync = realRename;

  assert.equal(h.registry.get('forge-tests.fixture-transactional'), null);
  assert.ok(
    !fs.existsSync(path.join(h.rootDir, 'forge-tests.fixture-transactional')),
    'no version directory should exist after the failed fresh commit',
  );
  assert.deepEqual(stagingLeftovers(h.rootDir), []);
});

test('rollback swaps to the retained version and can be undone', (t) => {
  const h = createHarness();
  t.after(h.cleanup);
  const { RollbackExtension } = require(
    '../../dist-electron/extensions/application/rollback-extension.js'
  );
  const rollback = new RollbackExtension({
    packageStore: h.packageStore,
    registry: h.registry,
    manifestReader: new VscodeManifestReader(),
    readManifestSource: (dir) => fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
  });

  const v1 = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
  ]));
  h.registry.upsert({ ...h.registry.get(v1.id), enabled: false });
  const v2 = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource({ version: '2.0.0' }) },
  ]));

  const rolledBack = rollback.rollback(v2.id);
  assert.equal(rolledBack.version, '1.0.0');
  assert.equal(rolledBack.dir, v1.dir);
  assert.equal(rolledBack.sha256, v1.sha256);
  assert.equal(rolledBack.enabled, false, 'user choice survives the rollback');
  assert.equal(rolledBack.previousVersion.version, '2.0.0');
  assert.ok(fs.existsSync(v2.dir), 'the rolled-back-from version stays on disk');

  // Rolling back again returns to v2 — the roles swap.
  const restored = rollback.rollback(v2.id);
  assert.equal(restored.version, '2.0.0');
  assert.equal(restored.previousVersion.version, '1.0.0');

  // Without a retained version the rollback is a discriminated error.
  h.registry.upsert({ ...h.registry.get(v2.id), previousVersion: undefined });
  assert.throws(
    () => rollback.rollback(v2.id),
    (err) => err.name === 'ExtensionInstallError' && err.code === 'rollback-unavailable',
  );
});

function createCatalogHarness(packages) {
  const h = createHarness();
  const downloads = [];
  const deletedTemp = [];
  const notFound = (id) => {
    const { ExtensionInstallError } = require(
      '../../dist-electron/extensions/domain/extension-install-error.js'
    );
    return new ExtensionInstallError('not-found', `"${id}" no existe en el catálogo fake.`);
  };
  const catalog = {
    async latestMetadata(id) {
      const source = packages[id];
      if (!source) throw notFound(id);
      const manifest = JSON.parse(source);
      return {
        id,
        version: manifest.version,
        extensionDependencies: manifest.extensionDependencies || [],
        extensionPack: manifest.extensionPack || [],
      };
    },
    async downloadLatestVsix(id) {
      downloads.push(id);
      const source = packages[id];
      if (!source) throw notFound(id);
      return writeVsix(h.tempRoot, [{ name: 'extension/package.json', data: source }]);
    },
  };
  const { InstallExtensionById } = require(
    '../../dist-electron/extensions/application/install-extension-by-id.js'
  );
  const byId = new InstallExtensionById({
    catalog,
    installer: h.useCase,
    registry: h.registry,
    deleteTempFile: (filePath) => {
      deletedTemp.push(filePath);
      fs.rmSync(filePath, { force: true });
    },
    warn: (message) => h.warnings.push(message),
  });
  return { ...h, byId, downloads, deletedTemp };
}

function catalogManifest(name, extra = {}) {
  return JSON.stringify({
    name,
    publisher: 'forge-tests',
    version: '1.0.0',
    engines: { vscode: '*' },
    ...extra,
  });
}

test('marketplace install resolves required dependencies once each', async (t) => {
  const h = createCatalogHarness({
    'forge-tests.a': catalogManifest('a', {
      extensionDependencies: ['forge-tests.b', 'forge-tests.c'],
    }),
    'forge-tests.b': catalogManifest('b', { extensionDependencies: ['forge-tests.c'] }),
    'forge-tests.c': catalogManifest('c'),
  });
  t.after(h.cleanup);

  const record = await h.byId.install('forge-tests.a');
  assert.equal(record.id, 'forge-tests.a');
  assert.ok(h.registry.get('forge-tests.b'));
  assert.ok(h.registry.get('forge-tests.c'));
  // The plan resolves up front: dependencies download before their
  // dependents (VS Code order), and c — needed by both a and b — only once.
  assert.deepEqual(h.downloads, ['forge-tests.c', 'forge-tests.b', 'forge-tests.a']);
  assert.equal(h.deletedTemp.length, 3, 'every temp VSIX is cleaned up');
});

test('dependency cycles terminate instead of looping', async (t) => {
  const h = createCatalogHarness({
    'forge-tests.a': catalogManifest('a', { extensionDependencies: ['forge-tests.b'] }),
    'forge-tests.b': catalogManifest('b', { extensionDependencies: ['forge-tests.a'] }),
  });
  t.after(h.cleanup);

  await h.byId.install('forge-tests.a');
  assert.ok(h.registry.get('forge-tests.a'));
  assert.ok(h.registry.get('forge-tests.b'));
  assert.equal(h.downloads.length, 2, 'each id downloads at most once');
});

test('a missing required dependency aborts; a missing pack entry only warns', async (t) => {
  const failing = createCatalogHarness({
    'forge-tests.a': catalogManifest('a', { extensionDependencies: ['forge-tests.gone'] }),
  });
  t.after(failing.cleanup);
  await assert.rejects(
    () => failing.byId.install('forge-tests.a'),
    (err) => err.code === 'dependency-failed',
  );
  assert.ok(
    !failing.registry.get('forge-tests.a'),
    'the requested extension is NOT installed when a required dependency fails',
  );
  assert.equal(failing.downloads.length, 0, 'the failure aborts before any download');

  const tolerant = createCatalogHarness({
    'forge-tests.a': catalogManifest('a', { extensionPack: ['forge-tests.gone'] }),
  });
  t.after(tolerant.cleanup);
  const record = await tolerant.byId.install('forge-tests.a');
  assert.equal(record.id, 'forge-tests.a');
  assert.equal(tolerant.warnings.length, 1);
  assert.match(tolerant.warnings[0], /forge-tests\.gone/);
});

test('store sweep removes orphans and keeps active, previous and legacy dirs', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const v1 = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
  ]));
  const v2 = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource({ version: '2.0.0' }) },
  ]));

  // Orphans a post-commit failure could leave behind:
  const orphanId = path.join(h.rootDir, 'forge-tests.orphan');
  fs.mkdirSync(path.join(orphanId, '1.0.0'), { recursive: true });
  const orphanVersion = path.join(h.rootDir, v2.id, '9.9.9');
  fs.mkdirSync(orphanVersion, { recursive: true });
  const staleStaging = path.join(h.rootDir, '.staging', 'abandoned-123');
  fs.mkdirSync(staleStaging, { recursive: true });

  // A legacy flat install owns its whole id directory.
  const legacyDir = path.join(h.rootDir, 'forge-tests.legacy');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'package.json'), '{}');
  h.registry.upsert({ ...v1, id: 'forge-tests.legacy', dir: legacyDir, previousVersion: undefined });

  const removed = h.packageStore.sweep(h.registry.list());

  assert.deepEqual(
    removed.sort(),
    [staleStaging, orphanId, orphanVersion].sort(),
  );
  assert.ok(fs.existsSync(v2.dir), 'active version survives');
  assert.ok(fs.existsSync(v1.dir), 'retained previous version survives');
  assert.ok(fs.existsSync(path.join(legacyDir, 'package.json')), 'legacy install survives');
  assert.ok(!fs.existsSync(orphanId));
  assert.ok(!fs.existsSync(orphanVersion));
  assert.deepEqual(stagingLeftovers(h.rootDir), []);
});

test('update check reports only extensions with a newer catalog version', async (t) => {
  const { CheckExtensionUpdates } = require(
    '../../dist-electron/extensions/application/check-extension-updates.js'
  );
  const h = createHarness();
  t.after(h.cleanup);

  const record = h.useCase.install(writeVsix(h.tempRoot, [
    { name: 'extension/package.json', data: manifestSource() },
  ]));

  const checker = (latest) => new CheckExtensionUpdates({
    registry: h.registry,
    warn: (message) => h.warnings.push(message),
    catalog: {
      async latestMetadata(id) {
        if (latest === null) throw new Error('catálogo caído');
        return { id, version: latest, extensionDependencies: [], extensionPack: [] };
      },
      async downloadLatestVsix() { throw new Error('unused'); },
    },
  });

  assert.deepEqual(await checker('1.1.0').check(), [
    { id: record.id, installedVersion: '1.0.0', latestVersion: '1.1.0' },
  ]);
  assert.deepEqual(await checker('1.0.0').check(), [], 'same version is not an update');
  assert.deepEqual(await checker('0.9.0').check(), [], 'older catalog version is not an update');

  // A broken catalog warns instead of failing the whole check.
  assert.deepEqual(await checker(null).check(), []);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0], /catálogo caído/);
});

test('extension version ordering handles prereleases and odd shapes', () => {
  const { isNewerExtensionVersion } = require(
    '../../dist-electron/extensions/domain/extension-version.js'
  );
  assert.equal(isNewerExtensionVersion('1.1.0', '1.0.0'), true);
  assert.equal(isNewerExtensionVersion('1.0.0', '1.1.0'), false);
  assert.equal(isNewerExtensionVersion('1.10.0', '1.9.0'), true, 'numeric, not lexicographic');
  assert.equal(isNewerExtensionVersion('1.0.0', '1.0.0'), false);
  assert.equal(isNewerExtensionVersion('1.0.0', '1.0.0-beta.1'), true, 'release beats prerelease');
  assert.equal(isNewerExtensionVersion('1.0.0-beta.1', '1.0.0'), false);
  assert.equal(isNewerExtensionVersion('1.0', '1.0.0'), false, 'missing segments are zero');
});

test('vscode engine policy understands the common range shapes', () => {
  assert.equal(checkVscodeEngine('*', '1.85.0'), 'compatible');
  assert.equal(checkVscodeEngine('^1.80.0', '1.85.0'), 'compatible');
  assert.equal(checkVscodeEngine('^1.90.0', '1.85.0'), 'incompatible');
  assert.equal(checkVscodeEngine('>=1.85.0', '1.85.0'), 'compatible');
  assert.equal(checkVscodeEngine('>=1.86.0', '1.85.0'), 'incompatible');
  assert.equal(checkVscodeEngine('1.80.x', '1.85.0'), 'compatible');
  assert.equal(checkVscodeEngine('^2.0.0', '1.85.0'), 'incompatible');
  assert.equal(checkVscodeEngine(null, '1.85.0'), 'unknown');
  assert.equal(checkVscodeEngine('what-is-this', '1.85.0'), 'unknown');
});

// Minimal malicious-package corpus required by the security gate
// (extensions-security-and-testing.md §9). Every package is built here from
// tests/fixtures/extensions/malicious/packages.json — pinned versions, no
// network, no archiver dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createStoredZip } = require('./helpers/stored-zip.cjs');
const { InstallExtensionFromVsix } = require(
  '../../dist-electron/extensions/application/install-extension-from-vsix.js'
);
const { JsonExtensionRegistry } = require(
  '../../dist-electron/extensions/infrastructure/json-extension-registry.js'
);
const { VscodeManifestReader } = require(
  '../../dist-electron/extensions/infrastructure/vscode-manifest-reader.js'
);
const { VsixPackageStore } = require(
  '../../dist-electron/extensions/infrastructure/vsix-package-store.js'
);

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../fixtures/extensions/malicious/packages.json'),
    'utf8',
  ),
);

function packageFixture(id) {
  const found = fixture.packages.find((entry) => entry.id === id);
  assert.ok(found, `falta la fixture maliciosa "${id}"`);
  return found;
}

function createHarness() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-malicious-'));
  const rootDir = path.join(tempRoot, 'extensions');
  let config = {};
  const registry = new JsonExtensionRegistry({
    readConfig: () => JSON.parse(JSON.stringify(config)),
    writeConfig: (next) => { config = next; },
  });
  const packageStore = new VsixPackageStore({
    rootDir: () => rootDir,
    manifestReader: new VscodeManifestReader(),
  });
  const useCase = new InstallExtensionFromVsix({
    packageStore,
    registry,
    warn: () => {},
  });
  return {
    tempRoot,
    rootDir,
    registry,
    useCase,
    getConfig: () => config,
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
  };
}

function writeMaliciousVsix(dir, id) {
  const { entries } = packageFixture(id);
  const vsixPath = path.join(dir, `${id}.vsix`);
  fs.writeFileSync(
    vsixPath,
    createStoredZip(
      entries.map((entry) => ({
        name: entry.name,
        data: entry.manifest ? JSON.stringify(entry.manifest) : entry.data,
        ...(entry.symlink ? { symlink: true } : {}),
      })),
    ),
  );
  return vsixPath;
}

function assertRejected(h, id) {
  const expected = packageFixture(id).expectedErrorCode;
  const vsixPath = writeMaliciousVsix(h.tempRoot, id);
  assert.throws(
    () => h.useCase.install(vsixPath),
    (err) => err.name === 'ExtensionInstallError' && err.code === expected,
    `la fixture "${id}" debería rechazarse con ${expected}`,
  );
  // Rejection is only worth something if it leaves nothing behind.
  assert.deepEqual(h.registry.list(), []);
  const staging = path.join(h.rootDir, '.staging');
  assert.deepEqual(fs.existsSync(staging) ? fs.readdirSync(staging) : [], []);
}

test('zip-slip: an entry escaping the package aborts the install', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  assertRejected(h, 'zip-slip');
  assert.ok(!fs.existsSync(path.join(h.tempRoot, 'pwned.txt')));
  assert.ok(!fs.existsSync(path.join(h.rootDir, 'pwned.txt')));
});

test('symlink entries pointing outside the package are refused', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  assertRejected(h, 'symlink-escape');
  // Nothing was materialized: neither a link nor a regular file with the
  // link target as contents.
  assert.ok(!fs.existsSync(path.join(h.rootDir, 'forge-tests.fixture-symlink')));
});

test('a manifest whose identity cannot be a path segment is rejected', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  assertRejected(h, 'inconsistent-identity');
  // The escaped id would have landed here had the manifest been accepted.
  assert.ok(!fs.existsSync(path.join(h.tempRoot, 'evil.fixture-identity')));
  assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'evil.fixture-identity')));
});

test('contradictory trust capabilities are rejected instead of guessed', (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  assertRejected(h, 'contradictory-capabilities');
});

test('the manifest reader reports why each identity/capability fixture fails', () => {
  const reader = new VscodeManifestReader();

  const identity = reader.readWithDiagnostics(
    JSON.stringify(packageFixture('inconsistent-identity').entries[0].manifest),
  );
  assert.equal(identity.ok, true); // readable, but not installable
  assert.deepEqual(
    identity.issues.filter((issue) => issue.code === 'invalid-field-format'),
    [{ code: 'invalid-field-format', field: 'publisher', value: '../../../tmp/evil' }],
  );

  const capabilities = reader.readWithDiagnostics(
    JSON.stringify(packageFixture('contradictory-capabilities').entries[0].manifest),
  );
  assert.equal(capabilities.ok, true);
  assert.equal(
    capabilities.issues.some((issue) => issue.code === 'contradictory-capabilities'),
    true,
  );
});

test('a marketplace download declaring another identity is rolled back', async (t) => {
  const h = createHarness();
  t.after(h.cleanup);

  const { InstallExtensionById } = require(
    '../../dist-electron/extensions/application/install-extension-by-id.js'
  );
  const vsixPath = path.join(h.tempRoot, 'impostor.vsix');
  fs.writeFileSync(vsixPath, createStoredZip([{
    name: 'extension/package.json',
    data: JSON.stringify({
      name: 'impostor',
      publisher: 'someone-else',
      version: '1.0.0',
      engines: { vscode: '^1.80.0' },
    }),
  }]));

  const installById = new InstallExtensionById({
    catalog: {
      latestMetadata: async () => ({
        id: 'forge-tests.wanted',
        version: '1.0.0',
        extensionDependencies: [],
        extensionPack: [],
      }),
      downloadLatestVsix: async () => vsixPath,
    },
    installer: h.useCase,
    registry: h.registry,
    deleteTempFile: () => {},
    warn: () => {},
  });

  await assert.rejects(
    () => installById.install('forge-tests.wanted'),
    (err) => err.name === 'ExtensionInstallError' && err.code === 'identity-mismatch',
  );
  assert.deepEqual(h.registry.list(), []);
});

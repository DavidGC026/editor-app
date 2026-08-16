const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { VscodeManifestReader } = require('../../dist-electron/extensions/infrastructure/vscode-manifest-reader.js');
const { parseJsonc } = require('../../dist-electron/extensions/infrastructure/jsonc.js');
const { readZipEntries } = require('../../dist-electron/zip.js');

const fixturesRoot = path.resolve(__dirname, '../fixtures/extensions');

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesRoot, name), 'utf8');
}

const { createStoredZip } = require('./helpers/stored-zip.cjs');

test('JSONC parser preserves comment-like and trailing-comma-like string content', () => {
  const parsed = parseJsonc('{ "url": "https://example.test/a//b", "token": ",}", }');
  assert.deepEqual(parsed, {
    url: 'https://example.test/a//b',
    token: ',}',
  });
});

test('normalizes supported declarative contribution metadata', () => {
  const manifest = new VscodeManifestReader().read(
    readFixture('declarative/package.jsonc'),
  );

  assert.equal(manifest.id, 'forge-tests.fixture-declarative');
  assert.equal(manifest.displayName, 'Fixture Declarative');
  assert.equal(manifest.description, 'Text containing // and a trailing-looking token ,}');
  assert.deepEqual(manifest.categories, ['Themes', 'Programming Languages']);
  assert.deepEqual(manifest.contributes, ['iconThemes', 'languages', 'snippets', 'themes']);
  assert.deepEqual(manifest.themes, [{
    label: 'Fixture Dark', uiTheme: 'vs-dark', path: 'themes/dark.json',
  }]);
  assert.deepEqual(manifest.snippets, [{
    language: 'fixture', path: 'snippets/fixture.json',
  }]);
  assert.deepEqual(manifest.languages, [{
    id: 'fixture',
    aliases: ['Fixture'],
    extensions: ['.fixture'],
    filenames: ['Fixturefile'],
    firstLine: '^#!.*fixture',
    configPath: 'language-configuration.json',
  }]);
  assert.deepEqual(manifest.iconThemes, [{
    id: 'fixture-icons', label: 'Fixture Icons', path: 'icons/theme.json',
  }]);
});

test('normalizes runtime entrypoints and legacy string extensionKind', () => {
  const manifest = new VscodeManifestReader().read(readFixture('runtime/package.json'));

  assert.equal(manifest.id, 'forge-tests.fixture-runtime');
  assert.equal(manifest.main, './out/extension.js');
  assert.equal(manifest.browser, './dist/web.js');
  assert.deepEqual(manifest.extensionKind, ['workspace']);
  assert.deepEqual(manifest.activationEvents, ['onCommand:fixture.run']);
  assert.deepEqual(manifest.contributes, ['commands']);
});

test('keeps legacy defaults for incomplete manifests during facade migration', () => {
  const manifest = new VscodeManifestReader().read('{}');

  assert.equal(manifest.id, 'unknown.unknown');
  assert.equal(manifest.name, 'unknown');
  assert.equal(manifest.publisher, 'unknown');
  assert.equal(manifest.version, '0.0.0');
  assert.deepEqual(manifest.contributes, []);
});

test('rejects malformed JSONC', () => {
  assert.throws(() => new VscodeManifestReader().read('{ invalid }'), SyntaxError);
});

test('validating mode reports malformed documents as discriminated issues', () => {
  const malformed = new VscodeManifestReader().readWithDiagnostics('{ invalid }');
  assert.equal(malformed.ok, false);
  assert.equal(malformed.issues.length, 1);
  assert.equal(malformed.issues[0].code, 'invalid-json');

  const nonObject = new VscodeManifestReader().readWithDiagnostics('[1, 2, 3]');
  assert.equal(nonObject.ok, false);
  assert.deepEqual(nonObject.issues, [{ code: 'not-an-object' }]);
});

test('validating mode flags recoverable defects while keeping legacy defaults', () => {
  const result = new VscodeManifestReader().readWithDiagnostics('{"contributes": []}');

  assert.equal(result.ok, true);
  assert.equal(result.manifest.id, 'unknown.unknown');
  const codes = result.issues.map((issue) => `${issue.code}:${issue.field ?? ''}`).sort();
  assert.deepEqual(codes, [
    'invalid-field-type:contributes',
    'missing-field:engines.vscode',
    'missing-field:name',
    'missing-field:publisher',
    'missing-field:version',
  ]);
});

test('validating mode returns no issues for a complete manifest', () => {
  const result = new VscodeManifestReader().readWithDiagnostics(
    readFixture('declarative/package.jsonc'),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.manifest.id, 'forge-tests.fixture-declarative');
});

test('reads a minimal VSIX container and locates its extension manifest', () => {
  const tempRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'forge-vsix-fixture-'));
  const vsixPath = path.join(tempRoot, 'fixture.vsix');
  const manifestSource = readFixture('runtime/package.json');
  fs.writeFileSync(vsixPath, createStoredZip([
    { name: 'extension/package.json', data: manifestSource },
    { name: 'extension/out/extension.js', data: 'exports.activate = () => undefined;' },
  ]));

  try {
    const entries = readZipEntries(vsixPath);
    const manifestEntry = entries.find((entry) => entry.name === 'extension/package.json');
    assert.ok(manifestEntry);
    const manifest = new VscodeManifestReader().read(manifestEntry.getData().toString('utf8'));
    assert.equal(manifest.id, 'forge-tests.fixture-runtime');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

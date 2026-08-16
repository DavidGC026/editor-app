const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { DeclarativeCompatibilityAnalyzer, toLegacySupported } = require(
  '../../dist-electron/extensions/application/declarative-compatibility-analyzer.js'
);
const { resolveExtensionPath } = require(
  '../../dist-electron/extensions/infrastructure/extension-path.js'
);
const { FileIconThemeContributionReader } = require(
  '../../dist-electron/extensions/infrastructure/icon-theme-contribution-reader.js'
);
const { FileLanguageContributionReader } = require(
  '../../dist-electron/extensions/infrastructure/language-contribution-reader.js'
);
const { FileSnippetContributionReader } = require(
  '../../dist-electron/extensions/infrastructure/snippet-contribution-reader.js'
);
const { FileThemeContributionReader } = require(
  '../../dist-electron/extensions/infrastructure/theme-contribution-reader.js'
);
const { VscodeManifestReader } = require(
  '../../dist-electron/extensions/infrastructure/vscode-manifest-reader.js'
);
const fs = require('node:fs');

const fixtureDir = path.resolve(__dirname, '../fixtures/extensions/declarative');
const manifest = new VscodeManifestReader().read(
  fs.readFileSync(path.join(fixtureDir, 'package.jsonc'), 'utf8'),
);
const extension = { ...manifest, dir: fixtureDir };

test('theme reader resolves include chains and merges parent data', () => {
  const [theme] = new FileThemeContributionReader().read(extension);

  assert.equal(theme.id, 'forge-tests-fixture-declarative-fixture-dark');
  assert.deepEqual(theme.data.colors, {
    'editor.background': '#202020',
    'editor.foreground': '#eeeeee',
  });
  assert.equal(theme.data.tokenColors.length, 2);
});

test('snippet reader validates definitions at the filesystem boundary', () => {
  const [payload] = new FileSnippetContributionReader().read(extension);

  assert.equal(payload.language, 'fixture');
  assert.deepEqual(Object.keys(payload.snippets), ['Print value']);
  assert.deepEqual(payload.snippets['Print value'].prefix, ['print', 'fixture-print']);
  assert.deepEqual(payload.snippets['Print value'].body, ['console.log(${1:value});', '$0']);
});

test('language reader normalizes the supported language configuration', () => {
  const [language] = new FileLanguageContributionReader().read(extension);

  assert.equal(language.id, 'fixture');
  assert.deepEqual(language.configuration.comments, {
    lineComment: '//', blockComment: ['/*', '*/'],
  });
  assert.deepEqual(language.configuration.brackets, [['{', '}'], ['[', ']']]);
  assert.equal(language.configuration.autoClosingPairs.length, 2);
  assert.deepEqual(language.configuration.folding.markers, {
    start: '^\\s*// region', end: '^\\s*// endregion',
  });
});

test('icon theme reader loads bounded icon resources as data URLs', () => {
  const [theme] = new FileIconThemeContributionReader().read(extension);

  assert.equal(theme.id, 'fixture-icons');
  assert.match(theme.definitions._file, /^data:image\/svg\+xml;utf8,/);
  assert.match(theme.definitions._folder, /^data:image\/svg\+xml;utf8,/);
  assert.deepEqual(theme.fileExtensions, { fixture: '_file' });
});

test('extension path resolver rejects contribution traversal', () => {
  assert.throws(
    () => resolveExtensionPath(fixtureDir, '../runtime/package.json'),
    /escapes package root/,
  );
});

test('compatibility analyzer reports only successfully loaded active contributions', () => {
  const report = new DeclarativeCompatibilityAnalyzer().analyze(extension, {
    themes: 1,
    snippets: 1,
    languages: 1,
    iconThemes: 1,
  });

  assert.equal(report.level, 'full');
  assert.deepEqual(
    [...report.supportedContributions].sort(),
    ['iconThemes', 'languages', 'snippets', 'themes'],
  );
  assert.deepEqual(report.pendingContributions, []);
  assert.deepEqual(report.blockers, []);

  const legacy = toLegacySupported(report);
  assert.deepEqual(
    [...legacy.declarative].sort(),
    ['iconThemes', 'languages', 'snippets', 'themes'],
  );
  assert.equal(legacy.requiresExtensionHost, false);
});

test('compatibility analyzer surfaces load failures as blockers', () => {
  const report = new DeclarativeCompatibilityAnalyzer().analyze(extension, {
    themes: 0,
    snippets: 0,
    languages: 0,
    iconThemes: 1,
  });

  assert.equal(report.level, 'partial');
  assert.deepEqual(report.supportedContributions, ['iconThemes']);
  const failed = report.blockers
    .filter((b) => b.kind === 'contribution-load-failed')
    .map((b) => b.contribution)
    .sort();
  assert.deepEqual(failed, ['languages', 'snippets', 'themes']);
});

test('compatibility analyzer distinguishes runtime and declarative-only packages', () => {
  const runtimeExtension = { ...extension, main: './out/extension.js' };
  const report = new DeclarativeCompatibilityAnalyzer().analyze(runtimeExtension, {
    themes: 1, snippets: 1, languages: 1, iconThemes: 1,
  });

  assert.equal(report.level, 'partial');
  assert.deepEqual(
    report.blockers.filter((b) => b.kind === 'requires-extension-host'),
    [{ kind: 'requires-extension-host', entryPoints: ['./out/extension.js'] }],
  );
  assert.equal(toLegacySupported(report).requiresExtensionHost, true);

  // A pure declarative extension with everything loaded and consumed is full.
  const declarativeOnly = {
    ...extension,
    contributes: ['snippets', 'themes'],
    iconThemes: [],
    languages: [],
  };
  const fullReport = new DeclarativeCompatibilityAnalyzer().analyze(declarativeOnly, {
    themes: 1, snippets: 1, languages: 0, iconThemes: 0,
  });
  assert.equal(fullReport.level, 'full');
  assert.deepEqual(fullReport.pendingContributions, []);
  assert.deepEqual(fullReport.blockers, []);
});

test('compatibility analyzer flags contribution points without declarative support', () => {
  // `debuggers` has no declarative engine yet (menus/commands/keybindings/
  // grammars all moved to supported families during Milestone 2).
  const debuggerExtension = {
    ...extension,
    contributes: [...extension.contributes, 'debuggers'].sort(),
  };
  const report = new DeclarativeCompatibilityAnalyzer().analyze(debuggerExtension, {
    themes: 1, snippets: 1, languages: 1, iconThemes: 1,
  });

  assert.equal(report.level, 'partial');
  assert.ok(report.pendingContributions.includes('debuggers'));
  assert.deepEqual(
    report.blockers.filter((b) => b.kind === 'unsupported-contribution'),
    [{ kind: 'unsupported-contribution', contribution: 'debuggers' }],
  );
});

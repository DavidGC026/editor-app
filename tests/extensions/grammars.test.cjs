const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { VscodeManifestReader } = require(
  '../../dist-electron/extensions/infrastructure/vscode-manifest-reader.js'
);
const { decodeInstalledExtensionRecord } = require(
  '../../dist-electron/extensions/infrastructure/json-extension-registry.js'
);
const { FileGrammarContributionReader } = require(
  '../../dist-electron/extensions/infrastructure/grammar-contribution-reader.js'
);
// Renderer service, imported unbundled via Node's TS type stripping.
const { TextmateGrammarService } = require('../../src/extensions/textmate.ts');

// ── Manifest normalization ──────────────────────────────────────────────

function readManifest(contributes) {
  return new VscodeManifestReader().read(JSON.stringify({
    name: 'grm',
    publisher: 'forge-tests',
    version: '1.0.0',
    engines: { vscode: '*' },
    contributes,
  }));
}

test('reader normalizes grammars: paths, optional language, embedded, injections', () => {
  const manifest = readManifest({
    grammars: [
      {
        language: 'foolang',
        scopeName: 'source.foo',
        path: './syntaxes/foo.tmLanguage.json',
        embeddedLanguages: { 'meta.embedded.block.js': 'javascript', bad: 42 },
      },
      { scopeName: 'markup.injection', path: 'syntaxes/inject.json', injectTo: ['source.foo'] },
      { scopeName: 'source.nopath' }, // missing path: dropped
      { path: 'syntaxes/anon.json' }, // missing scopeName: dropped
    ],
  });

  assert.equal(manifest.grammars.length, 2);
  assert.deepEqual(manifest.grammars[0], {
    language: 'foolang',
    scopeName: 'source.foo',
    path: 'syntaxes/foo.tmLanguage.json',
    embeddedLanguages: { 'meta.embedded.block.js': 'javascript' },
    injectTo: [],
  });
  assert.equal(manifest.grammars[1].language, null);
  assert.deepEqual(manifest.grammars[1].injectTo, ['source.foo']);
});

test('registry decoder round-trips grammars and tolerates legacy records', () => {
  const manifest = readManifest({
    grammars: [{ language: 'foolang', scopeName: 'source.foo', path: 'syntaxes/foo.json' }],
  });
  const record = { ...manifest, dir: '/tmp/somewhere', enabled: true };
  const decoded = decodeInstalledExtensionRecord(record.id, JSON.parse(JSON.stringify(record)));
  assert.deepEqual(decoded.grammars, manifest.grammars);

  const legacy = decodeInstalledExtensionRecord('a.b', { dir: '/tmp/x' });
  assert.deepEqual(legacy.grammars, []);
});

test('grammar file reader ships raw sources and skips unreadable files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-grammar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'syntaxes'));
  fs.writeFileSync(path.join(dir, 'syntaxes', 'foo.json'), '{"scopeName":"source.foo"}');

  const extension = {
    grammars: [
      {
        language: 'foolang', scopeName: 'source.foo', path: 'syntaxes/foo.json',
        embeddedLanguages: {}, injectTo: [],
      },
      {
        language: null, scopeName: 'source.gone', path: 'syntaxes/missing.json',
        embeddedLanguages: {}, injectTo: [],
      },
    ],
    dir,
  };
  const payloads = new FileGrammarContributionReader().read(extension);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].scopeName, 'source.foo');
  assert.equal(payloads[0].content, '{"scopeName":"source.foo"}');
});

// ── Tokenization with the real engine ───────────────────────────────────

// vscode-oniguruma's WASM may only initialize once per process.
let onigLibPromise = null;
function createOnigLib() {
  if (!onigLibPromise) {
    const oniguruma = require('vscode-oniguruma');
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    onigLibPromise = oniguruma
      .loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength))
      .then(() => ({
        createOnigScanner: (patterns) => oniguruma.createOnigScanner(patterns),
        createOnigString: (value) => oniguruma.createOnigString(value),
      }));
  }
  return onigLibPromise;
}

function jsonGrammar(language, keyword) {
  return {
    language,
    scopeName: `source.${language}`,
    path: `syntaxes/${language}.tmLanguage.json`,
    content: JSON.stringify({
      scopeName: `source.${language}`,
      patterns: [
        { match: `\\b${keyword}\\b`, name: `keyword.control.${language}` },
        { match: '"[^"]*"', name: `string.quoted.double.${language}` },
      ],
    }),
    embeddedLanguages: {},
    injectTo: [],
  };
}

function tokenizeLine(provider, line) {
  return provider.tokenize(line, provider.getInitialState()).tokens;
}

test('five fixture languages tokenize with their own scopes', async () => {
  const service = new TextmateGrammarService({ createOnigLib, warn: () => {} });
  const fixtures = [
    ['alpha', 'let'], ['bravo', 'def'], ['charlie', 'fn'],
    ['delta', 'proc'], ['echo', 'begin'],
  ];
  for (const [language, keyword] of fixtures) {
    service.register(jsonGrammar(language, keyword));
  }

  for (const [language, keyword] of fixtures) {
    const provider = await service.createTokensProvider(language);
    assert.notEqual(provider, null, `expected a provider for ${language}`);
    const tokens = tokenizeLine(provider, `${keyword} x = "hi"`);
    const scopes = tokens.map((t) => t.scopes);
    assert.ok(
      scopes.includes(`keyword.control.${language}`),
      `${language}: keyword scope in ${scopes.join(', ')}`,
    );
    assert.ok(
      scopes.includes(`string.quoted.double.${language}`),
      `${language}: string scope in ${scopes.join(', ')}`,
    );
  }
});

test('plist grammars parse too (parseRawGrammar picks the format by filename)', async () => {
  const service = new TextmateGrammarService({ createOnigLib, warn: () => {} });
  service.register({
    language: 'plistlang',
    scopeName: 'source.plistlang',
    path: 'syntaxes/plistlang.tmLanguage',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>scopeName</key><string>source.plistlang</string>
  <key>patterns</key>
  <array>
    <dict>
      <key>match</key><string>\\bmagic\\b</string>
      <key>name</key><string>keyword.other.plistlang</string>
    </dict>
  </array>
</dict>
</plist>`,
    embeddedLanguages: {},
    injectTo: [],
  });

  const provider = await service.createTokensProvider('plistlang');
  assert.notEqual(provider, null);
  const scopes = tokenizeLine(provider, 'say magic word').map((t) => t.scopes);
  assert.ok(scopes.includes('keyword.other.plistlang'), scopes.join(', '));
});

test('tokenizer state carries across lines (multi-line constructs)', async () => {
  const service = new TextmateGrammarService({ createOnigLib, warn: () => {} });
  service.register({
    language: 'blocklang',
    scopeName: 'source.blocklang',
    path: 'syntaxes/blocklang.tmLanguage.json',
    content: JSON.stringify({
      scopeName: 'source.blocklang',
      patterns: [{
        begin: '/\\*', end: '\\*/', name: 'comment.block.blocklang',
      }],
    }),
    embeddedLanguages: {},
    injectTo: [],
  });

  const provider = await service.createTokensProvider('blocklang');
  const first = provider.tokenize('/* open', provider.getInitialState());
  assert.ok(first.tokens.some((t) => t.scopes === 'comment.block.blocklang'));

  const second = provider.tokenize('still inside */', first.endState);
  assert.ok(
    second.tokens.some((t) => t.scopes === 'comment.block.blocklang'),
    'the comment continues on the next line',
  );
  assert.equal(
    first.endState.equals(provider.getInitialState()),
    false,
    'the open block is part of the state',
  );
  // After the block closes, subsequent lines are plain source again.
  const third = provider.tokenize('code after', second.endState);
  assert.deepEqual(
    third.tokens.map((t) => t.scopes),
    ['source.blocklang'],
    'the comment does not leak past its close',
  );
});

test('ownership: first scope declaration wins and dispose retires exactly it', async () => {
  const service = new TextmateGrammarService({ createOnigLib, warn: () => {} });
  const first = jsonGrammar('foxtrot', 'first');
  const second = { ...jsonGrammar('foxtrot', 'second'), content: jsonGrammar('foxtrot', 'second').content };

  const firstRegistration = service.register(first);
  const secondRegistration = service.register(second); // duplicate: inert

  let provider = await service.createTokensProvider('foxtrot');
  let scopes = tokenizeLine(provider, 'first second').map((t) => t.scopes);
  assert.ok(scopes.includes('keyword.control.foxtrot'));
  assert.deepEqual(
    tokenizeLine(provider, 'second').map((t) => t.scopes),
    ['source.foxtrot'],
    'the duplicate grammar never took over',
  );

  secondRegistration.dispose(); // disposing the loser changes nothing
  assert.equal(service.scopeForLanguage('foxtrot'), 'source.foxtrot');

  firstRegistration.dispose();
  assert.equal(service.scopeForLanguage('foxtrot'), null);
  provider = await service.createTokensProvider('foxtrot');
  assert.equal(provider, null, 'a retired grammar is not served again');
});

test('injected grammars extend the target scope', async () => {
  const service = new TextmateGrammarService({ createOnigLib, warn: () => {} });
  service.register(jsonGrammar('golf', 'let'));
  service.register({
    language: null,
    scopeName: 'todo.injection',
    path: 'syntaxes/todo.tmLanguage.json',
    content: JSON.stringify({
      scopeName: 'todo.injection',
      injectionSelector: 'L:source.golf',
      patterns: [{ match: '\\bTODO\\b', name: 'keyword.todo.injected' }],
    }),
    embeddedLanguages: {},
    injectTo: ['source.golf'],
  });

  const provider = await service.createTokensProvider('golf');
  const scopes = tokenizeLine(provider, 'let TODO').map((t) => t.scopes);
  assert.ok(scopes.includes('keyword.todo.injected'), scopes.join(', '));
});

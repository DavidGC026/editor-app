const assert = require('node:assert/strict');
const test = require('node:test');

const { VscodeManifestReader } = require(
  '../../dist-electron/extensions/infrastructure/vscode-manifest-reader.js'
);
const { decodeInstalledExtensionRecord } = require(
  '../../dist-electron/extensions/infrastructure/json-extension-registry.js'
);
// Renderer modules, imported unbundled via Node's TS type stripping.
const {
  buildMenuItems,
  filterMenuItems,
  explorerResourceContext,
} = require('../../src/extensions/menus.ts');
const { ContextKeyService } = require('../../src/extensions/contextKeys.ts');

// ── Manifest normalization ──────────────────────────────────────────────

function readManifest(contributes) {
  return new VscodeManifestReader().read(JSON.stringify({
    name: 'mnu',
    publisher: 'forge-tests',
    version: '1.0.0',
    engines: { vscode: '*' },
    contributes,
  }));
}

test('reader flattens contributes.menus and skips submenu-only entries', () => {
  const manifest = readManifest({
    menus: {
      'explorer/context': [
        { command: 'demo.open', when: '!explorerResourceIsFolder', group: 'navigation' },
        { command: 'demo.pack', group: '2_workspace@1' },
        { submenu: 'demo.sub' }, // no command: skipped until submenus land
      ],
      'editor/context': [{ command: 'demo.open' }],
      '': [{ command: 'demo.ignored' }], // blank menu id: dropped
    },
  });

  assert.equal(manifest.menus.length, 3);
  assert.deepEqual(manifest.menus[0], {
    menu: 'explorer/context',
    command: 'demo.open',
    when: '!explorerResourceIsFolder',
    group: 'navigation',
  });
  assert.deepEqual(
    manifest.menus.map((m) => m.menu),
    ['explorer/context', 'explorer/context', 'editor/context'],
  );
});

test('registry decoder round-trips menus and tolerates legacy records', () => {
  const manifest = readManifest({
    menus: { 'explorer/context': [{ command: 'demo.open', when: 'x', group: 'g' }] },
  });
  const record = { ...manifest, dir: '/tmp/somewhere', enabled: true };
  const decoded = decodeInstalledExtensionRecord(record.id, JSON.parse(JSON.stringify(record)));
  assert.deepEqual(decoded.menus, manifest.menus);

  const legacy = decodeInstalledExtensionRecord('a.b', { dir: '/tmp/x' });
  assert.deepEqual(legacy.menus, []);
});

// ── Renderer helpers ────────────────────────────────────────────────────

function source(id, { enabled = true, commands = [], menus = [] } = {}) {
  return { id, enabled, displayName: id, commands, menus };
}

test('buildMenuItems resolves titles across extensions and orders by group', () => {
  const provider = source('a.commands', {
    commands: [
      { command: 'demo.open', title: 'Open Preview', category: 'Demo' },
      { command: 'demo.pack', title: 'Pack', category: null },
    ],
  });
  const contributor = source('b.menus', {
    menus: [
      { menu: 'explorer/context', command: 'demo.pack', when: null, group: '2_workspace@2' },
      { menu: 'explorer/context', command: 'demo.unknown', when: null, group: '2_workspace@1' },
      { menu: 'explorer/context', command: 'demo.open', when: null, group: 'navigation' },
      { menu: 'editor/context', command: 'demo.open', when: null, group: null },
    ],
  });

  const items = buildMenuItems([provider, contributor], 'explorer/context');
  assert.deepEqual(items.map((i) => i.command), [
    'demo.open', // navigation first
    'demo.unknown', // 2_workspace@1
    'demo.pack', // 2_workspace@2
  ]);
  assert.equal(items[0].title, 'Demo: Open Preview', 'title resolved from another extension');
  assert.equal(items[1].title, 'demo.unknown', 'unknown commands fall back to the id');
  assert.equal(items[2].title, 'Pack');
  assert.equal(items[0].ownerId, 'b.menus');
});

test('disabled extensions contribute neither items nor titles', () => {
  const disabled = source('a.off', {
    enabled: false,
    commands: [{ command: 'demo.open', title: 'Nope', category: null }],
    menus: [{ menu: 'explorer/context', command: 'demo.open', when: null, group: null }],
  });
  const active = source('b.on', {
    menus: [{ menu: 'explorer/context', command: 'demo.open', when: null, group: null }],
  });

  const items = buildMenuItems([disabled, active], 'explorer/context');
  assert.equal(items.length, 1);
  assert.equal(items[0].ownerId, 'b.on');
  assert.equal(items[0].title, 'demo.open', 'the disabled title does not leak');
});

test('filterMenuItems + resource context gate visibility per node', () => {
  const contextService = new ContextKeyService(() => {});
  const items = buildMenuItems([
    source('a.ext', {
      menus: [
        { menu: 'explorer/context', command: 'html.preview', when: "resourceExtname == '.html'", group: null },
        { menu: 'explorer/context', command: 'folder.zip', when: 'explorerResourceIsFolder', group: null },
        { menu: 'explorer/context', command: 'always.there', when: null, group: null },
      ],
    }),
  ], 'explorer/context');

  const onHtml = filterMenuItems(items, (when) =>
    contextService.match(when, explorerResourceContext({
      path: '/w/index.html', name: 'index.html', type: 'file',
    })),
  );
  assert.deepEqual(onHtml.map((i) => i.command), ['html.preview', 'always.there']);

  const onFolder = filterMenuItems(items, (when) =>
    contextService.match(when, explorerResourceContext({
      path: '/w/src', name: 'src', type: 'directory',
    })),
  );
  assert.deepEqual(onFolder.map((i) => i.command), ['folder.zip', 'always.there']);
});

test('explorerResourceContext mirrors the VS Code resource keys', () => {
  assert.deepEqual(
    explorerResourceContext({ path: '/w/a.test.ts', name: 'a.test.ts', type: 'file' }),
    {
      resourceScheme: 'file',
      resourcePath: '/w/a.test.ts',
      resourceFilename: 'a.test.ts',
      resourceExtname: '.ts',
      explorerResourceIsFolder: false,
    },
  );
  const folder = explorerResourceContext({ path: '/w/src', name: 'src', type: 'directory' });
  assert.equal(folder.resourceExtname, '');
  assert.equal(folder.explorerResourceIsFolder, true);

  const dotfile = explorerResourceContext({ path: '/w/.gitignore', name: '.gitignore', type: 'file' });
  assert.equal(dotfile.resourceExtname, '', 'a leading dot is not an extension');
});

test('overlay extras do not leak into the shared context state', () => {
  const contextService = new ContextKeyService(() => {});
  contextService.set('resourceExtname', '.md');
  assert.equal(
    contextService.match("resourceExtname == '.html'", { resourceExtname: '.html' }),
    true,
    'the overlay wins while present',
  );
  assert.equal(
    contextService.match("resourceExtname == '.md'"),
    true,
    'the stored value is untouched afterwards',
  );
});

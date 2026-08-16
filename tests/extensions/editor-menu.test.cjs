const assert = require('node:assert/strict');
const test = require('node:test');

// Renderer modules, imported unbundled via Node's TS type stripping.
const {
  EditorMenuService,
  editorActionId,
  toEditorActionDescriptor,
} = require('../../src/extensions/editorMenu.ts');
const { editorResourceContext } = require('../../src/extensions/menus.ts');
const { ContextKeyService } = require('../../src/extensions/contextKeys.ts');

// ── Fakes ───────────────────────────────────────────────────────────────

/** Stands in for monaco.editor: records every registration and disposal. */
function fakeHost() {
  const actions = new Map();
  const log = [];
  return {
    actions,
    log,
    addEditorAction(descriptor) {
      if (actions.has(descriptor.id)) throw new Error(`duplicate action ${descriptor.id}`);
      actions.set(descriptor.id, descriptor);
      log.push(`+${descriptor.id}`);
      return {
        dispose: () => {
          actions.delete(descriptor.id);
          log.push(`-${descriptor.id}`);
        },
      };
    },
  };
}

function source(id, { enabled = true, commands = [], menus = [] } = {}) {
  return { id, enabled, displayName: id, commands, menus };
}

function editorItem(command, { when = null, group = null } = {}) {
  return { menu: 'editor/context', command, when, group };
}

function serviceWith(keys, executed, options = {}) {
  return new EditorMenuService({
    matchWhen: (expression) => keys.match(expression),
    execute: (command, ...args) => {
      executed.push([command, ...args]);
      return true;
    },
    activeResource: () => {
      const path = keys.get('resourcePath');
      return typeof path === 'string' ? path : null;
    },
    warn: () => {},
    ...options,
  });
}

// ── Descriptor mapping ──────────────────────────────────────────────────

test('menu items map onto Monaco action descriptors', () => {
  const item = {
    command: 'demo.format',
    title: 'Demo: Format',
    ownerId: 'pub.demo',
    when: null,
    group: '1_modification@3',
  };
  const descriptor = toEditorActionDescriptor(item, () => {});
  assert.equal(descriptor.id, 'forge.extension.pub.demo.demo.format');
  assert.equal(descriptor.label, 'Demo: Format');
  assert.equal(descriptor.contextMenuGroupId, '1_modification');
  assert.equal(descriptor.contextMenuOrder, 3);

  // A group-less item still lands in a stable, last-sorting group.
  const bare = toEditorActionDescriptor({ ...item, group: null }, () => {});
  assert.equal(bare.contextMenuGroupId, '9_zzz_default');
  assert.equal(bare.contextMenuOrder, 0);
});

test('action ids are namespaced per owner so two extensions never collide', () => {
  const base = { command: 'demo.run', title: 'Run', when: null, group: null };
  assert.notEqual(
    editorActionId({ ...base, ownerId: 'a.one' }),
    editorActionId({ ...base, ownerId: 'b.two' }),
  );
});

// ── Registration lifecycle ──────────────────────────────────────────────

test('only items whose when-clause holds are registered with Monaco', () => {
  const keys = new ContextKeyService(() => {});
  keys.set('editorLangId', 'markdown');
  const service = serviceWith(keys, []);
  const host = fakeHost();
  service.attach(host);

  service.sync([
    source('pub.demo', {
      commands: [
        { command: 'demo.preview', title: 'Preview', category: 'Demo' },
        { command: 'demo.lint', title: 'Lint', category: null },
      ],
      menus: [
        editorItem('demo.preview', { when: "editorLangId == 'markdown'" }),
        editorItem('demo.lint', { when: "editorLangId == 'python'" }),
      ],
    }),
  ]);

  assert.deepEqual(service.registeredIds(), ['forge.extension.pub.demo.demo.preview']);
  assert.equal(host.actions.get('forge.extension.pub.demo.demo.preview').label, 'Demo: Preview');
});

test('a context-key change registers and retires without touching the rest', () => {
  const keys = new ContextKeyService(() => {});
  keys.set('editorLangId', 'markdown');
  const service = serviceWith(keys, []);
  const host = fakeHost();
  service.attach(host);
  service.sync([
    source('pub.demo', {
      commands: [
        { command: 'demo.always', title: 'Always', category: null },
        { command: 'demo.md', title: 'Markdown only', category: null },
        { command: 'demo.py', title: 'Python only', category: null },
      ],
      menus: [
        editorItem('demo.always'),
        editorItem('demo.md', { when: "editorLangId == 'markdown'" }),
        editorItem('demo.py', { when: "editorLangId == 'python'" }),
      ],
    }),
  ]);
  assert.deepEqual(host.log, [
    '+forge.extension.pub.demo.demo.always',
    '+forge.extension.pub.demo.demo.md',
  ]);

  keys.set('editorLangId', 'python');
  service.refresh();

  // The unconditional item was left alone; only the two gated ones moved.
  assert.deepEqual(host.log.slice(2), [
    '-forge.extension.pub.demo.demo.md',
    '+forge.extension.pub.demo.demo.py',
  ]);
  assert.deepEqual(
    [...host.actions.keys()].sort(),
    ['forge.extension.pub.demo.demo.always', 'forge.extension.pub.demo.demo.py'],
  );
});

test('a disabled or uninstalled extension takes its actions with it', () => {
  const keys = new ContextKeyService(() => {});
  const service = serviceWith(keys, []);
  const host = fakeHost();
  service.attach(host);

  const extension = source('pub.demo', {
    commands: [{ command: 'demo.run', title: 'Run', category: null }],
    menus: [editorItem('demo.run')],
  });
  service.sync([extension]);
  assert.equal(host.actions.size, 1);

  service.sync([{ ...extension, enabled: false }]);
  assert.equal(host.actions.size, 0);

  service.sync([extension]);
  service.sync([]); // uninstalled
  assert.equal(host.actions.size, 0);
});

test('an updated label re-registers the action; an unchanged one does not', () => {
  const keys = new ContextKeyService(() => {});
  const service = serviceWith(keys, []);
  const host = fakeHost();
  service.attach(host);

  const withTitle = (title) =>
    source('pub.demo', {
      commands: [{ command: 'demo.run', title, category: null }],
      menus: [editorItem('demo.run')],
    });

  service.sync([withTitle('Run')]);
  service.sync([withTitle('Run')]);
  assert.deepEqual(host.log, ['+forge.extension.pub.demo.demo.run']);

  service.sync([withTitle('Run Task')]);
  assert.deepEqual(host.log.slice(1), [
    '-forge.extension.pub.demo.demo.run',
    '+forge.extension.pub.demo.demo.run',
  ]);
  assert.equal(host.actions.get('forge.extension.pub.demo.demo.run').label, 'Run Task');
});

test('attaching a fresh Monaco rebuilds the set instead of leaking the old one', () => {
  const keys = new ContextKeyService(() => {});
  const service = serviceWith(keys, []);
  const first = fakeHost();
  service.attach(first);
  service.sync([
    source('pub.demo', {
      commands: [{ command: 'demo.run', title: 'Run', category: null }],
      menus: [editorItem('demo.run')],
    }),
  ]);
  assert.equal(first.actions.size, 1);

  const second = fakeHost();
  service.attach(second);
  assert.equal(first.actions.size, 0);
  assert.equal(second.actions.size, 1);
});

test('items contributed before Monaco attaches are applied on attach', () => {
  const keys = new ContextKeyService(() => {});
  const service = serviceWith(keys, []);
  service.sync([
    source('pub.demo', {
      commands: [{ command: 'demo.run', title: 'Run', category: null }],
      menus: [editorItem('demo.run')],
    }),
  ]);
  assert.deepEqual(service.registeredIds(), []);

  const host = fakeHost();
  service.attach(host);
  assert.equal(host.actions.size, 1);
});

test('a host that rejects a registration does not break the others', () => {
  const keys = new ContextKeyService(() => {});
  const service = serviceWith(keys, []);
  const host = fakeHost();
  const inner = host.addEditorAction.bind(host);
  host.addEditorAction = (descriptor) => {
    if (descriptor.label === 'Bad') throw new Error('nope');
    return inner(descriptor);
  };
  service.attach(host);
  service.sync([
    source('pub.demo', {
      commands: [
        { command: 'demo.bad', title: 'Bad', category: null },
        { command: 'demo.good', title: 'Good', category: null },
      ],
      menus: [editorItem('demo.bad'), editorItem('demo.good')],
    }),
  ]);

  assert.deepEqual(service.registeredIds(), ['forge.extension.pub.demo.demo.good']);
});

// ── Execution ───────────────────────────────────────────────────────────

test('running an action executes the command with the active resource', () => {
  const keys = new ContextKeyService(() => {});
  keys.set('resourcePath', '/w/readme.md');
  const executed = [];
  const service = serviceWith(keys, executed);
  const host = fakeHost();
  service.attach(host);
  service.sync([
    source('pub.demo', {
      commands: [{ command: 'demo.preview', title: 'Preview', category: null }],
      menus: [editorItem('demo.preview')],
    }),
  ]);

  host.actions.get('forge.extension.pub.demo.demo.preview').run();
  assert.deepEqual(executed, [['demo.preview', '/w/readme.md']]);
});

// ── Editor resource keys ────────────────────────────────────────────────

test('editorResourceContext mirrors the VS Code resource keys', () => {
  assert.deepEqual(
    editorResourceContext({ path: '/w/src/app.tsx', name: 'app.tsx', language: 'typescript' }),
    {
      resourceScheme: 'file',
      resourcePath: '/w/src/app.tsx',
      resourceFilename: 'app.tsx',
      resourceExtname: '.tsx',
      resourceLangId: 'typescript',
    },
  );

  // A dotfile has no extension.
  assert.equal(
    editorResourceContext({ path: '/w/.gitignore', name: '.gitignore' }).resourceExtname,
    '',
  );

  // No editor open: every key clears.
  assert.deepEqual(Object.values(editorResourceContext(null)), [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

test('clearing the resource keys hides items gated on them', () => {
  const keys = new ContextKeyService(() => {});
  const service = serviceWith(keys, []);
  const host = fakeHost();
  service.attach(host);
  service.sync([
    source('pub.demo', {
      commands: [{ command: 'demo.preview', title: 'Preview', category: null }],
      menus: [editorItem('demo.preview', { when: "resourceExtname == '.md'" })],
    }),
  ]);
  assert.equal(host.actions.size, 0);

  const publish = (tab) => {
    for (const [key, value] of Object.entries(editorResourceContext(tab))) keys.set(key, value);
    service.refresh();
  };

  publish({ path: '/w/readme.md', name: 'readme.md', language: 'markdown' });
  assert.equal(host.actions.size, 1);

  publish(null);
  assert.equal(host.actions.size, 0);
});

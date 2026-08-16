// Workspace Trust + Restricted Mode (Milestone 3.0).
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  WorkspaceTrustService,
  WorkspaceTrustError,
} = require('../../dist-electron/extensions/application/workspace-trust-service.js');
const {
  ForgeWorkspaceTrustStore,
} = require('../../dist-electron/extensions/infrastructure/forge-workspace-trust-store.js');
const {
  isActivatableUnderTrust,
  resolveExtensionTrust,
} = require('../../dist-electron/extensions/domain/workspace-trust.js');
const {
  defaultExtensionCapabilities,
} = require('../../dist-electron/extensions/domain/extension-manifest.js');
const { VscodeManifestReader } = require(
  '../../dist-electron/extensions/infrastructure/vscode-manifest-reader.js'
);
const {
  decodeInstalledExtensionRecord,
} = require('../../dist-electron/extensions/infrastructure/json-extension-registry.js');

const projects = path.join(os.tmpdir(), 'forge-trust-fixture');
const project = path.join(projects, 'project');
const nested = path.join(project, 'packages', 'app');

function createHarness(initialConfig = {}) {
  let config = JSON.parse(JSON.stringify(initialConfig));
  let workspace = project;
  const warnings = [];
  const store = new ForgeWorkspaceTrustStore({
    readConfig: () => JSON.parse(JSON.stringify(config)),
    writeConfig: (next) => { config = next; },
  });
  const service = new WorkspaceTrustService({
    store,
    workspace: () => workspace,
    warn: (message) => warnings.push(message),
  });
  return {
    service,
    store,
    warnings,
    getConfig: () => config,
    setWorkspace: (next) => { workspace = next; },
  };
}

function extensionWith(untrustedWorkspaces) {
  const capabilities = defaultExtensionCapabilities();
  return {
    id: 'forge-tests.fixture',
    capabilities: {
      ...capabilities,
      untrustedWorkspaces: { ...capabilities.untrustedWorkspaces, ...untrustedWorkspaces },
    },
  };
}

// ── Estado y persistencia ──────────────────────────────────────────────

test('a workspace starts restricted and undecided', () => {
  const h = createHarness();
  assert.deepEqual(h.service.status(), {
    workspace: project,
    state: 'restricted',
    decided: false,
    remote: false,
    canGrant: true,
  });
  assert.equal(h.service.isTrusted(), false);
});

test('granting trust persists the decision and survives a new service', () => {
  const h = createHarness();
  const status = h.service.grant();
  assert.equal(status.state, 'trusted');
  assert.equal(status.decided, true);

  const decisions = h.getConfig().workspaceTrust.decisions;
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].workspace, path.resolve(project));
  assert.equal(decisions[0].trusted, true);
  assert.equal(typeof decisions[0].decidedAt, 'string');

  const reopened = new WorkspaceTrustService({
    store: h.store,
    workspace: () => project,
  });
  assert.equal(reopened.isTrusted(), true);
});

test('revoking returns the workspace to Restricted Mode without losing the decision', () => {
  const h = createHarness();
  h.service.grant();
  const status = h.service.revoke();
  assert.equal(status.state, 'restricted');
  assert.equal(status.decided, true);
  assert.equal(h.getConfig().workspaceTrust.decisions.length, 1);
});

test('trust decisions do not disturb unrelated configuration keys', () => {
  const h = createHarness({ activeTheme: 'forge-dark', extensions: { 'a.b': { dir: '/x' } } });
  h.service.grant();
  assert.equal(h.getConfig().activeTheme, 'forge-dark');
  assert.deepEqual(h.getConfig().extensions, { 'a.b': { dir: '/x' } });
});

test('every trust decision notifies subscribers with the resulting status', () => {
  const h = createHarness();
  const seen = [];
  const unsubscribe = h.service.onDidChange((status) => seen.push(status.state));
  h.service.grant();
  h.service.revoke();
  unsubscribe();
  h.service.grant();
  assert.deepEqual(seen, ['trusted', 'restricted']);
});

// ── Precedencia ────────────────────────────────────────────────────────

test('a trusted parent folder trusts its subfolders, but not siblings', () => {
  const h = createHarness();
  h.service.grant();

  h.setWorkspace(nested);
  const inherited = h.service.status();
  assert.equal(inherited.state, 'trusted');
  // Inherited, not decided: the user never answered for this folder.
  assert.equal(inherited.decided, false);

  h.setWorkspace(path.join(projects, 'other-project'));
  assert.equal(h.service.status().state, 'restricted');
});

test('an explicit decision on the subfolder beats the trusted parent', () => {
  const h = createHarness();
  h.service.grant();
  h.setWorkspace(nested);
  h.service.revoke();

  assert.deepEqual(h.service.status(), {
    workspace: nested,
    state: 'restricted',
    decided: true,
    remote: false,
    canGrant: true,
  });
  h.setWorkspace(project);
  assert.equal(h.service.status().state, 'trusted');
});

test('the closest trusted ancestor wins over a farther one', () => {
  const h = createHarness();
  const middle = path.join(project, 'packages');
  h.service.grant();
  h.setWorkspace(middle);
  h.service.revoke();
  h.setWorkspace(nested);
  // `middle` is explicitly untrusted and closer than the trusted root, so
  // nothing is inherited through it.
  assert.equal(h.service.status().state, 'restricted');
});

test('a path that only shares a prefix is not inside the trusted folder', () => {
  const h = createHarness();
  h.service.grant();
  h.setWorkspace(`${project}-evil`);
  assert.equal(h.service.status().state, 'restricted');
});

// ── Remoto, sin workspace y lecturas corruptas ─────────────────────────

test('remote workspaces stay restricted and cannot be granted trust', () => {
  const h = createHarness();
  h.setWorkspace('ssh://user@host/srv/app');
  assert.deepEqual(h.service.status(), {
    workspace: 'ssh://user@host/srv/app',
    state: 'restricted',
    decided: false,
    remote: true,
    canGrant: false,
  });
  assert.throws(() => h.service.grant(), WorkspaceTrustError);
});

test('with no workspace open nothing can be trusted', () => {
  const h = createHarness();
  h.setWorkspace(null);
  const status = h.service.status();
  assert.equal(status.workspace, null);
  assert.equal(status.state, 'restricted');
  assert.equal(status.canGrant, false);
  assert.throws(() => h.service.grant(), WorkspaceTrustError);
});

test('a corrupt trust document degrades to Restricted Mode instead of throwing', () => {
  const corrupt = createHarness({ workspaceTrust: 'not-an-object' });
  assert.equal(corrupt.service.isTrusted(), false);

  const partial = createHarness({
    workspaceTrust: {
      decisions: [
        null,
        { trusted: true },
        { workspace: path.resolve(project), trusted: 'yes' },
        { workspace: path.resolve(project, 'other'), trusted: true },
      ],
    },
  });
  // `trusted: 'yes'` is not `true`, so the decision reads as "not trusted".
  assert.equal(partial.service.isTrusted(), false);
  // `null` and the entry without `workspace` are unusable and dropped.
  assert.equal(partial.store.read().length, 2);
});

test('a store that throws on read is reported and treated as undecided', () => {
  const warnings = [];
  const service = new WorkspaceTrustService({
    store: {
      read: () => { throw new Error('disco ilegible'); },
      write: () => {},
    },
    workspace: () => project,
    warn: (message) => warnings.push(message),
  });
  assert.equal(service.isTrusted(), false);
  assert.equal(warnings.length > 0, true);
});

// ── Política de activación en Restricted Mode ──────────────────────────

test('Restricted Mode only activates extensions declaring untrustedWorkspaces', () => {
  const undeclared = extensionWith({});
  const declared = extensionWith({ supported: 'supported' });
  const limited = extensionWith({
    supported: 'limited',
    restrictedConfigurations: ['fixture.path'],
  });
  const refused = extensionWith({ supported: 'unsupported' });

  assert.equal(resolveExtensionTrust(undeclared, 'restricted').activation, 'blocked');
  assert.equal(resolveExtensionTrust(refused, 'restricted').activation, 'blocked');
  assert.equal(resolveExtensionTrust(declared, 'restricted').activation, 'allowed');

  const limitedVerdict = resolveExtensionTrust(limited, 'restricted');
  assert.equal(limitedVerdict.activation, 'limited');
  assert.deepEqual(limitedVerdict.restrictedConfigurations, ['fixture.path']);

  for (const extension of [undeclared, declared, limited, refused]) {
    const verdict = resolveExtensionTrust(extension, 'trusted');
    assert.equal(verdict.activation, 'allowed');
    // A trusted workspace honours every setting.
    assert.deepEqual(verdict.restrictedConfigurations, []);
  }
  assert.equal(isActivatableUnderTrust(undeclared, 'restricted'), false);
  assert.equal(isActivatableUnderTrust(limited, 'restricted'), true);
});

test('the service evaluates installed records against the current state', () => {
  const h = createHarness();
  const records = [
    { ...extensionWith({}), id: 'forge-tests.blocked' },
    { ...extensionWith({ supported: 'supported' }), id: 'forge-tests.allowed' },
  ];

  assert.deepEqual(
    h.service.evaluate(records).map((verdict) => [verdict.id, verdict.activation]),
    [['forge-tests.blocked', 'blocked'], ['forge-tests.allowed', 'allowed']],
  );

  h.service.grant();
  assert.deepEqual(
    h.service.evaluate(records).map((verdict) => verdict.activation),
    ['allowed', 'allowed'],
  );
});

// ── Normalización y round-trip de `capabilities` ───────────────────────

function readManifest(manifest) {
  return new VscodeManifestReader().read(JSON.stringify({
    name: 'fixture',
    publisher: 'forge-tests',
    version: '1.0.0',
    engines: { vscode: '^1.80.0' },
    ...manifest,
  }));
}

test('a manifest without capabilities fails closed for untrusted workspaces', () => {
  assert.deepEqual(readManifest({}).capabilities, {
    untrustedWorkspaces: {
      supported: 'unsupported',
      description: null,
      restrictedConfigurations: [],
    },
    virtualWorkspaces: { supported: 'supported', description: null },
  });
});

test('capabilities normalize booleans, "limited" and the object form', () => {
  const manifest = readManifest({
    capabilities: {
      untrustedWorkspaces: {
        supported: 'limited',
        description: 'Sólo lectura',
        restrictedConfigurations: ['fixture.a', 'fixture.a', 'fixture.b', 7],
      },
      virtualWorkspaces: false,
    },
  });
  assert.deepEqual(manifest.capabilities, {
    untrustedWorkspaces: {
      supported: 'limited',
      description: 'Sólo lectura',
      restrictedConfigurations: ['fixture.a', 'fixture.b'],
    },
    virtualWorkspaces: { supported: 'unsupported', description: null },
  });

  const shorthand = readManifest({ capabilities: { untrustedWorkspaces: true } });
  assert.equal(shorthand.capabilities.untrustedWorkspaces.supported, 'supported');
});

test('unknown capability values fall back to the safe default', () => {
  const manifest = readManifest({
    capabilities: {
      untrustedWorkspaces: { supported: 'maybe' },
      virtualWorkspaces: { supported: 42 },
    },
  });
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, 'unsupported');
  assert.equal(manifest.capabilities.virtualWorkspaces.supported, 'supported');
});

test('capabilities round-trip through the registry decoder', () => {
  const manifest = readManifest({
    capabilities: {
      untrustedWorkspaces: {
        supported: 'limited',
        description: 'Parcial',
        restrictedConfigurations: ['fixture.a'],
      },
      virtualWorkspaces: { supported: 'limited', description: 'Sin FS' },
    },
  });
  const decoded = decodeInstalledExtensionRecord('forge-tests.fixture', {
    ...manifest,
    dir: '/tmp/forge/ext',
  });
  assert.deepEqual(decoded.capabilities, manifest.capabilities);
});

test('legacy records without capabilities decode to the safe defaults', () => {
  const decoded = decodeInstalledExtensionRecord('forge-tests.legacy', {
    dir: '/tmp/forge/legacy',
  });
  assert.deepEqual(decoded.capabilities, defaultExtensionCapabilities());
  assert.equal(isActivatableUnderTrust(decoded, 'restricted'), false);
});

test('a corrupt capabilities block decodes to the safe defaults', () => {
  const decoded = decodeInstalledExtensionRecord('forge-tests.corrupt', {
    dir: '/tmp/forge/corrupt',
    capabilities: {
      untrustedWorkspaces: { supported: 'sure', restrictedConfigurations: 'nope' },
      virtualWorkspaces: [],
    },
  });
  assert.deepEqual(decoded.capabilities, defaultExtensionCapabilities());
});

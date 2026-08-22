'use strict';

// Main's command registry and on-demand activation: what the workbench can
// run, and what happens when it asks for something nobody has registered yet.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ExtensionCommandDispatcher,
} = require('../../dist-electron/extensions/application/extension-command-dispatcher.js');

const stateEvent = (overrides = {}) => ({
  type: 'state',
  state: {
    status: 'running',
    generation: 1,
    restartsInWindow: 0,
    lastError: null,
    ...overrides,
  },
});

const registerEvent = (command, extensionId, { generation = 1, method = 'commands.register' } = {}) => ({
  type: 'notification',
  generation,
  envelope: {
    v: 1,
    gen: generation,
    id: 0,
    kind: 'event',
    method,
    extensionId,
    payload: { command, extensionId },
  },
});

/**
 * Dispatcher over a scripted host: `requests` records what was asked, and
 * `onActivate` lets a test decide what the activation does to the registry
 * — which is the only way to reproduce "the extension woke up and
 * registered" without a process.
 */
function createDispatcher({ activatable = [], onActivate, executeResult = 'ok' } = {}) {
  const requests = [];
  const published = [];
  const logs = [];
  const state = { status: 'running', generation: 1, restartsInWindow: 0, lastError: null };

  const host = {
    get state() {
      return state;
    },
    request: async (method, payload, options) => {
      requests.push({ method, payload, options });
      if (method === 'lifecycle.activate') {
        await onActivate?.(payload.id);
        return { id: payload.id, status: 'active', durationMs: 1, exports: [] };
      }
      if (method === 'commands.execute') {
        return { command: payload.command, result: executeResult };
      }
      return null;
    },
  };

  const dispatcher = new ExtensionCommandDispatcher({
    host,
    activatable: () => activatable,
    onRegistryChanged: (commands) => published.push(commands),
    ensureRunning: async () => {
      state.status = 'running';
      requests.push({ method: 'ensureRunning' });
    },
    log: (message) => logs.push(message),
  });
  dispatcher.handleHostEvent(stateEvent());

  return { dispatcher, requests, published, logs, state };
}

// ── Registry ────────────────────────────────────────────────────────────

test('registrations from the live generation build the registry and are published', () => {
  const d = createDispatcher();

  d.dispatcher.handleHostEvent(registerEvent('demo.run', 'acme.demo'));

  assert.equal(d.dispatcher.hasCommand('demo.run'), true);
  assert.deepEqual(d.dispatcher.registered(), [{ command: 'demo.run', extensionId: 'acme.demo' }]);
  assert.deepEqual(d.published.at(-1), [{ command: 'demo.run', extensionId: 'acme.demo' }]);
});

test('an unregister from the owner removes it; from anyone else it does not', () => {
  const d = createDispatcher();
  d.dispatcher.handleHostEvent(registerEvent('demo.run', 'acme.demo'));

  d.dispatcher.handleHostEvent(
    registerEvent('demo.run', 'other.ext', { method: 'commands.unregister' }),
  );
  assert.equal(d.dispatcher.hasCommand('demo.run'), true, 'only the owner can unregister');

  d.dispatcher.handleHostEvent(
    registerEvent('demo.run', 'acme.demo', { method: 'commands.unregister' }),
  );
  assert.equal(d.dispatcher.hasCommand('demo.run'), false);
});

test('traffic from a stale generation is dropped with a note', () => {
  const d = createDispatcher();

  d.dispatcher.handleHostEvent(registerEvent('demo.run', 'acme.demo', { generation: 0 }));

  assert.equal(d.dispatcher.hasCommand('demo.run'), false);
  assert.match(d.logs.at(-1), /generación 0/);
});

test('a malformed notification is dropped instead of indexing a guess', () => {
  const d = createDispatcher();

  d.dispatcher.handleHostEvent({
    type: 'notification',
    generation: 1,
    envelope: { v: 1, gen: 1, id: 0, kind: 'event', method: 'commands.register', payload: { command: 42 } },
  });

  assert.deepEqual(d.dispatcher.registered(), []);
  assert.match(d.logs.at(-1), /inválida/);
});

test('other notifications are ignored, not mistaken for registrations', () => {
  const d = createDispatcher();

  d.dispatcher.handleHostEvent({
    type: 'notification',
    generation: 1,
    envelope: {
      v: 1, gen: 1, id: 0, kind: 'event', method: 'diagnostics.unsupportedApi', payload: {},
    },
  });

  assert.deepEqual(d.dispatcher.registered(), []);
  assert.deepEqual(d.logs, []);
});

test('a new generation drops the registry: those handlers no longer exist', () => {
  const d = createDispatcher();
  d.dispatcher.handleHostEvent(registerEvent('demo.run', 'acme.demo'));

  d.dispatcher.handleHostEvent(stateEvent({ generation: 2, status: 'running' }));

  assert.deepEqual(d.dispatcher.registered(), []);
  assert.deepEqual(d.published.at(-1), [], 'the renderer is told the set is empty');
});

test('a stopped host drops the registry too', () => {
  const d = createDispatcher();
  d.dispatcher.handleHostEvent(registerEvent('demo.run', 'acme.demo'));

  d.dispatcher.handleHostEvent(stateEvent({ status: 'stopped' }));

  assert.equal(d.dispatcher.hasCommand('demo.run'), false);
});

// ── Execution ───────────────────────────────────────────────────────────

test('a registered command executes in the host with its args and owner', async () => {
  const d = createDispatcher({ executeResult: 'hola' });
  d.dispatcher.handleHostEvent(registerEvent('demo.run', 'acme.demo'));

  const result = await d.dispatcher.execute('demo.run', ['Forge']);

  assert.equal(result, 'hola');
  assert.deepEqual(d.requests, [{
    method: 'commands.execute',
    payload: { command: 'demo.run', args: ['Forge'] },
    options: { extensionId: 'acme.demo' },
  }]);
});

test('an unregistered command activates its onCommand owner and retries once', async () => {
  let dispatcher;
  const d = createDispatcher({
    activatable: [{ id: 'acme.demo', activationEvents: ['onCommand:demo.run'] }],
    // Activation is what makes the command appear, exactly as in the host.
    onActivate: () => dispatcher.handleHostEvent(registerEvent('demo.run', 'acme.demo')),
  });
  dispatcher = d.dispatcher;

  const result = await d.dispatcher.execute('demo.run');

  assert.deepEqual(d.requests.map((entry) => entry.method), [
    'lifecycle.activate',
    'commands.execute',
  ]);
  assert.equal(d.requests[0].payload.id, 'acme.demo');
  assert.equal(result, 'ok');
});

test('nobody declaring the command fails fast, without waking anything', async () => {
  const d = createDispatcher({
    activatable: [{ id: 'acme.demo', activationEvents: ['onLanguage:python'] }],
  });

  await assert.rejects(d.dispatcher.execute('demo.run'), (err) => {
    assert.equal(err.code, 'COMMAND_NOT_FOUND');
    assert.match(err.message, /onCommand:demo\.run/);
    return true;
  });
  assert.deepEqual(d.requests, [], 'no activation was attempted');
});

test('an extension that activates but never registers is reported, not retried forever', async () => {
  const d = createDispatcher({
    activatable: [{ id: 'acme.demo', activationEvents: ['onCommand:demo.run'] }],
  });

  await assert.rejects(d.dispatcher.execute('demo.run'), (err) => {
    assert.equal(err.code, 'COMMAND_NOT_FOUND');
    assert.match(err.message, /se activó pero no registró/);
    return true;
  });
  assert.equal(
    d.requests.filter((entry) => entry.method === 'lifecycle.activate').length,
    1,
    'one activation attempt, never a loop',
  );
});

test('a failing activation surfaces its error instead of a missing command', async () => {
  const d = createDispatcher({
    activatable: [{ id: 'acme.demo', activationEvents: ['onCommand:demo.run'] }],
    onActivate: () => {
      throw Object.assign(new Error('activate reventó'), { code: 'ACTIVATION_FAILED' });
    },
  });

  await assert.rejects(d.dispatcher.execute('demo.run'), (err) => {
    assert.equal(err.code, 'ACTIVATION_FAILED');
    return true;
  });
});

test('a stopped host is started before the command that needs it', async () => {
  let dispatcher;
  const d = createDispatcher({
    activatable: [{ id: 'acme.demo', activationEvents: ['onCommand:demo.run'] }],
    onActivate: () => dispatcher.handleHostEvent(registerEvent('demo.run', 'acme.demo')),
  });
  dispatcher = d.dispatcher;
  d.state.status = 'stopped';
  // A stopped host cleared the registry, which is the state a first command
  // of the session finds.
  d.dispatcher.handleHostEvent(stateEvent({ status: 'stopped' }));

  await d.dispatcher.execute('demo.run');

  assert.deepEqual(d.requests.map((entry) => entry.method), [
    'ensureRunning',
    'lifecycle.activate',
    'commands.execute',
  ]);
});

test('an empty command id is refused at the edge', async () => {
  const d = createDispatcher();

  await assert.rejects(d.dispatcher.execute(''), (err) => {
    assert.equal(err.code, 'INVALID_PAYLOAD');
    return true;
  });
});

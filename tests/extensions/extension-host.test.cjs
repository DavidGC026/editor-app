const assert = require('node:assert/strict');
const test = require('node:test');

const {
  UtilityProcessExtensionHost,
} = require('../../dist-electron/extensions/infrastructure/hosts/utility-process-host.js');
const {
  createBootstrapResponder,
} = require('../../dist-electron/extension-host/bootstrap.js');

const { flush, createFakeTimers, createFakeLauncher } = require('./helpers/rpc-harness.cjs');

/** A descriptor with no `main`: the kernel tests care about the protocol,
 *  not about loading code — that is `extension-runtime.test.cjs`. */
const DEMO_DESCRIPTOR = {
  id: 'acme.demo',
  version: '1.0.0',
  dir: '/store/acme.demo/1.0.0',
  main: null,
  globalStoragePath: '/storage/global/acme.demo',
  workspaceStoragePath: null,
  extensionMode: 'test',
};

function createHost({ launcher: launcherOptions, ...hostOptions } = {}) {
  const timers = createFakeTimers();
  const launcher = createFakeLauncher(timers, launcherOptions);
  const events = [];
  const warnings = [];
  const host = new UtilityProcessExtensionHost({
    launcher,
    timers,
    initialize: () => ({
      apiVersion: '1.90.0',
      extensions: [DEMO_DESCRIPTOR],
      workspace: '/w',
      trust: true,
    }),
    warn: (message) => warnings.push(message),
    ...hostOptions,
  });
  host.onEvent((event) => events.push(event));
  return { host, timers, launcher, events, warnings };
}

const statuses = (events) =>
  events.filter((event) => event.type === 'state').map((event) => event.state.status);

const methodsSent = (child) => child.sent.map((envelope) => envelope.method);

// ── Handshake (design §3.2) ─────────────────────────────────────────────

test('start forks a generation, completes the handshake and reports running', async () => {
  const h = createHost();
  const state = await h.host.start();

  assert.deepEqual(state, {
    status: 'running',
    generation: 1,
    restartsInWindow: 0,
    lastError: null,
  });
  assert.equal(h.launcher.generations.length, 1);

  const [handshake] = h.launcher.latest().sent;
  assert.equal(handshake.method, 'lifecycle.initialize');
  assert.equal(handshake.gen, 1, 'the envelope carries the generation it belongs to');
  assert.deepEqual(handshake.payload, {
    protocol: 1,
    apiVersion: '1.90.0',
    extensions: [DEMO_DESCRIPTOR],
    workspace: '/w',
    trust: true,
  });
  assert.deepEqual(statuses(h.events), ['starting', 'running']);
});

test('a protocol mismatch aborts the start instead of degrading silently', async () => {
  const h = createHost({
    launcher: {
      respond: (envelope) => (envelope.method === 'lifecycle.initialize'
        ? { v: 1, gen: envelope.gen, id: envelope.id, kind: 'response', method: envelope.method, payload: { protocol: 2, nodeVersion: '20.0.0', ready: true } }
        : undefined),
    },
  });

  await assert.rejects(h.host.start(), (err) => {
    assert.equal(err.code, 'HOST_UNAVAILABLE');
    assert.match(err.message, /Protocolo incompatible/);
    return true;
  });
  assert.equal(h.host.state.status, 'stopped');
  assert.equal(h.host.state.lastError.code, 'HOST_UNAVAILABLE');
  assert.equal(h.launcher.latest().killed, true, 'the incompatible process is not left running');
  assert.equal(h.timers.pendingTimers(), 0, 'a deterministic failure schedules no restart');
});

test('a host that never answers the handshake times out and stays stopped', async () => {
  const h = createHost({ launcher: { respond: () => null }, handshakeTimeoutMs: 500 });
  const start = h.host.start();
  const rejected = assert.rejects(start, (err) => err.code === 'TIMEOUT');

  await h.timers.advance(500);
  await rejected;
  assert.equal(h.host.state.status, 'stopped');
});

test('requests are refused unless the host is running', async () => {
  const h = createHost();
  await assert.rejects(
    h.host.request('commands.execute', {}),
    (err) => err.code === 'HOST_UNAVAILABLE',
  );

  await h.host.start();
  assert.deepEqual(await h.host.request('lifecycle.heartbeat', {}), {
    ok: true,
    uptimeMs: 0,
  });

  await h.host.stop();
  await assert.rejects(
    h.host.request('commands.execute', {}),
    (err) => err.code === 'HOST_UNAVAILABLE',
  );
});

test('an unimplemented method answers UNSUPPORTED_API, not a silent stub', async () => {
  const h = createHost();
  await h.host.start();

  await assert.rejects(h.host.request('workspace.findFiles', {}), (err) => {
    assert.equal(err.code, 'UNSUPPORTED_API');
    assert.match(err.message, /workspace\.findFiles/);
    return true;
  });
  assert.equal(h.host.state.status, 'running', 'an unsupported call does not hurt the host');
});

// ── Heartbeat policy (design §6) ────────────────────────────────────────

test('the host beats every two seconds while it answers', async () => {
  const h = createHost();
  await h.host.start();

  await h.timers.advance(2_000);
  assert.deepEqual(methodsSent(h.launcher.latest()), ['lifecycle.initialize', 'lifecycle.heartbeat']);

  await h.timers.advance(2_000);
  assert.equal(
    methodsSent(h.launcher.latest()).filter((method) => method === 'lifecycle.heartbeat').length,
    2,
  );
  assert.equal(h.host.state.status, 'running');
  assert.equal(h.launcher.generations.length, 1, 'a healthy host is never respawned');
});

test('two missed beats are tolerated; the third kills and respawns the host', async () => {
  const h = createHost();
  await h.host.start();
  h.launcher.latest().hung = true;

  // Each beat waits its 2 s budget before counting as a failure.
  await h.timers.advance(8_000);
  assert.equal(h.host.state.status, 'running', 'two failures do not justify a kill');
  assert.equal(h.launcher.generations.length, 1);

  await h.timers.advance(4_000);
  assert.equal(h.launcher.generations[0].killed, true, 'the hung process is killed');
  assert.equal(h.host.state.status, 'restarting');

  await h.timers.advance(500);
  assert.equal(h.host.state.status, 'running');
  assert.equal(h.host.state.generation, 2, 'the restart opens a new generation');
  assert.equal(h.launcher.generations.length, 2);
});

test('an answered beat resets the failure counter', async () => {
  const h = createHost();
  await h.host.start();
  const child = h.launcher.latest();

  child.hung = true;
  await h.timers.advance(8_000); // two failures
  child.hung = false;
  await h.timers.advance(2_000); // one success
  child.hung = true;
  await h.timers.advance(8_000); // two more failures

  assert.equal(h.host.state.status, 'running', 'failures must be consecutive to kill');
  assert.equal(h.launcher.generations.length, 1);
});

// ── Restart and backoff ─────────────────────────────────────────────────

test('an unexpected exit restarts the host with growing backoff', async () => {
  const h = createHost();
  await h.host.start();

  h.launcher.latest().exit(1);
  await flush();
  assert.equal(h.host.state.status, 'restarting');
  assert.equal(h.host.state.restartsInWindow, 1);
  assert.match(h.host.state.lastError.message, /terminó \(código 1\)/);

  await h.timers.advance(499);
  assert.equal(h.launcher.generations.length, 1, 'the backoff is respected');
  await h.timers.advance(1);
  assert.equal(h.host.state.status, 'running');
  assert.equal(h.host.state.generation, 2);

  h.launcher.latest().exit(1);
  await flush();
  await h.timers.advance(999);
  assert.equal(h.launcher.generations.length, 2, 'the second wait doubles');
  await h.timers.advance(1);
  assert.equal(h.host.state.generation, 3);
  assert.equal(h.host.state.restartsInWindow, 2);
});

test('the restarted generation is the only one that receives traffic', async () => {
  const h = createHost();
  await h.host.start();
  const dead = h.launcher.latest();
  dead.exit(1);
  await h.timers.advance(500);

  await h.host.request('commands.execute', { command: 'demo' }).catch(() => {});
  assert.equal(methodsSent(dead).includes('commands.execute'), false);
  assert.equal(methodsSent(h.launcher.latest()).includes('commands.execute'), true);
  assert.equal(h.launcher.latest().sent[0].gen, 2, 'envelopes carry the new generation');
});

// ── Crash-loop circuit breaker ──────────────────────────────────────────

test('a crash loop trips the breaker and leaves the host observably disabled', async () => {
  const h = createHost();
  await h.host.start();

  // Three restarts inside the window are allowed; the next crash disables.
  for (let i = 0; i < 3; i += 1) {
    h.launcher.latest().exit(1);
    await flush();
    await h.timers.advance(8_000);
  }
  assert.equal(h.host.state.status, 'running');
  assert.equal(h.host.state.restartsInWindow, 3);
  assert.equal(h.launcher.generations.length, 4);

  h.launcher.latest().exit(1);
  await flush();
  assert.equal(h.host.state.status, 'disabled');
  assert.match(h.host.state.lastError.message, /3 reinicios en 60 s/);

  await h.timers.advance(60_000);
  assert.equal(h.launcher.generations.length, 4, 'a disabled host never respawns on its own');
  await assert.rejects(h.host.start(), (err) => {
    assert.equal(err.code, 'HOST_UNAVAILABLE');
    assert.match(err.message, /deshabilitado/);
    return true;
  });
});

test('crashes spaced beyond the window do not accumulate', async () => {
  const h = createHost();
  await h.host.start();

  for (let i = 0; i < 5; i += 1) {
    h.launcher.latest().exit(1);
    await flush();
    await h.timers.advance(500);
    assert.equal(h.host.state.status, 'running', `crash ${i + 1} restarted`);
    await h.timers.advance(60_001);
  }
  assert.equal(h.host.state.restartsInWindow, 1, 'the window slides with the clock');
  assert.equal(h.launcher.generations.length, 6);
});

test('an explicit restart clears the breaker and opens a new generation', async () => {
  const h = createHost();
  await h.host.start();
  for (let i = 0; i < 4; i += 1) {
    h.launcher.latest().exit(1);
    await flush();
    await h.timers.advance(8_000);
  }
  assert.equal(h.host.state.status, 'disabled');

  const state = await h.host.restart('el usuario pidió reiniciar');
  assert.equal(state.status, 'running');
  assert.equal(state.restartsInWindow, 0, 'explicit intent is not another symptom of the loop');
  assert.equal(state.generation, 5);
});

// ── Stop ────────────────────────────────────────────────────────────────

test('stop asks for shutdown, kills the process and schedules nothing', async () => {
  const h = createHost();
  await h.host.start();
  const child = h.launcher.latest();

  await h.host.stop('cerrando Forge');
  assert.equal(methodsSent(child).includes('lifecycle.shutdown'), true);
  assert.equal(child.alive, false);
  assert.equal(h.host.state.status, 'stopped');
  assert.equal(h.timers.pendingTimers(), 0, 'no heartbeat or restart timer survives');

  await h.timers.advance(60_000);
  assert.equal(h.launcher.generations.length, 1);
});

test('a host that ignores shutdown is stopped anyway', async () => {
  const h = createHost();
  await h.host.start();
  h.launcher.latest().hung = true;

  const stopped = h.host.stop();
  await h.timers.advance(3_000); // the lifecycle.shutdown budget expires
  await stopped;

  assert.equal(h.host.state.status, 'stopped');
  assert.equal(h.launcher.latest().killed, true);
  assert.equal(h.warnings.some((message) => message.includes('shutdown no confirmado')), true);
});

// ── Observability ───────────────────────────────────────────────────────

test('host logs reach the subscriber batched and tagged with their generation', async () => {
  const h = createHost();
  await h.host.start();

  h.launcher.latest().deliver({
    v: 1,
    gen: 1,
    id: 0,
    kind: 'event',
    method: 'diagnostics.log',
    extensionId: 'acme.demo',
    payload: { level: 'warn', message: 'algo pasó' },
  });
  await h.timers.advance(100);

  const [logs] = h.events.filter((event) => event.type === 'logs');
  assert.equal(logs.generation, 1);
  assert.deepEqual(logs.entries.map((entry) => [entry.extensionId, entry.level, entry.message]), [
    ['acme.demo', 'warn', 'algo pasó'],
  ]);
});

test('a stale generation cannot report anything to the live one', async () => {
  const h = createHost();
  await h.host.start();
  const dead = h.launcher.latest();
  dead.exit(1);
  await h.timers.advance(500);

  // The dead generation's transport is gone, so its traffic reaches nobody.
  dead.deliver({ v: 1, gen: 1, id: 0, kind: 'event', method: 'window.showMessage', payload: {} });
  await flush();
  assert.deepEqual(h.events.filter((event) => event.type === 'notification'), []);
});

test('a subscriber that throws does not break the state machine', async () => {
  const h = createHost();
  h.host.onEvent(() => {
    throw new Error('suscriptor roto');
  });

  await h.host.start();
  assert.equal(h.host.state.status, 'running');
  assert.equal(h.warnings.some((message) => message.includes('suscriptor del host falló')), true);
});

// ── Bootstrap responder (in-process contract) ───────────────────────────

test('the bootstrap responder answers lifecycle and refuses the rest', async () => {
  const exits = [];
  let clock = 0;
  const respond = createBootstrapResponder({
    now: () => clock,
    nodeVersion: '20.11.0',
    exit: (code) => exits.push(code),
    warn: () => {},
  });
  const request = (method, payload, id = 1) =>
    respond({ v: 1, gen: 4, id, kind: 'request', method, payload });

  const early = await request('lifecycle.heartbeat', {});
  assert.equal(early.kind, 'error');
  assert.equal(early.payload.code, 'HOST_UNAVAILABLE', 'no beats before the handshake');

  const handshake = await request('lifecycle.initialize', { protocol: 1 });
  assert.deepEqual(handshake.payload, {
    protocol: 1,
    nodeVersion: '20.11.0',
    ready: true,
    loadable: [],
  });
  assert.equal(handshake.gen, 4, 'the generation is echoed, never invented');
  assert.equal(handshake.id, 1, 'the response repeats the request id');

  clock = 250;
  assert.deepEqual((await request('lifecycle.heartbeat', {}, 2)).payload, {
    ok: true,
    uptimeMs: 250,
  });

  const unsupported = await request('workspace.findFiles', {}, 3);
  assert.equal(unsupported.payload.code, 'UNSUPPORTED_API');

  const mismatch = await request('lifecycle.initialize', { protocol: 2 }, 4);
  assert.equal(mismatch.payload.code, 'HOST_UNAVAILABLE');

  assert.equal(await respond({ nonsense: true }), null, 'garbage is ignored, not answered');
  assert.equal(
    await respond({ v: 1, gen: 4, id: 0, kind: 'event', method: 'lifecycle.heartbeat', payload: {} }),
    null,
    'notifications get no answer',
  );

  const shutdown = await request('lifecycle.shutdown', {}, 5);
  assert.deepEqual(shutdown.payload, { ok: true });
  assert.deepEqual(exits, [0], 'the process exits after answering, not before');
});

// ── Bootstrap with real extensions (increment 3.2) ──────────────────────

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ExtensionRuntime,
} = require('../../dist-electron/extension-host/extension-runtime.js');

const HOST_FIXTURES = path.join(__dirname, '..', 'fixtures', 'extensions', 'host');

function hostDescriptor(name) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(HOST_FIXTURES, name, 'package.json'), 'utf8'),
  );
  return {
    id: `forge-tests.${name}`,
    version: '1.0.0',
    dir: path.join(HOST_FIXTURES, name),
    main: manifest.main ?? null,
    globalStoragePath: path.join(os.tmpdir(), 'forge-host-protocol', name),
    workspaceStoragePath: null,
    extensionMode: 'test',
  };
}

/** Responder wired to a runtime that loads the fixtures for real, with a
 *  fresh `require` cache so protocol tests do not see runtime tests' state. */
function createLoadingResponder() {
  const notifications = [];
  const warnings = [];
  let clock = 0;
  const respond = createBootstrapResponder({
    now: () => (clock += 1),
    nodeVersion: '20.11.0',
    exit: () => {},
    warn: (message) => warnings.push(message),
    notify: (envelope) => notifications.push(envelope),
    createRuntime: (input) => new ExtensionRuntime({
      apiVersion: input.apiVersion,
      workspacePath: input.workspacePath,
      moduleSystem: require('node:module'),
      loadModule: (entryPoint) => {
        delete require.cache[require.resolve(entryPoint)];
        return require(entryPoint);
      },
      entryPointDeps: {
        realpath: (target) => {
          try {
            return fs.realpathSync(target);
          } catch {
            return path.resolve(target);
          }
        },
        isFile: (target) => {
          try {
            return fs.statSync(target).isFile();
          } catch {
            return false;
          }
        },
      },
      mementoStore: { read: () => ({}), write: () => undefined },
      joinPath: (...segments) => path.join(...segments),
      now: input.now,
      log: input.log,
      reportUnsupportedApi: input.reportUnsupportedApi,
    }),
  });

  let nextId = 1;
  return {
    notifications,
    warnings,
    request: (method, payload) => respond({
      v: 1,
      gen: 7,
      id: nextId++,
      kind: 'request',
      method,
      payload,
    }),
  };
}

test('the handshake carries descriptors and activate loads real extension code', async () => {
  const host = createLoadingResponder();

  const handshake = await host.request('lifecycle.initialize', {
    protocol: 1,
    apiVersion: '1.90.0',
    extensions: [hostDescriptor('healthy'), 'acme.legacy-string'],
    workspace: '/w',
  });

  assert.deepEqual(
    handshake.payload.loadable,
    ['forge-tests.healthy'],
    'an invalid descriptor is dropped at the edge, never guessed at',
  );
  assert.equal(
    host.warnings.some((message) => message.includes('descriptor de extensión inválido')),
    true,
  );

  const activated = await host.request('lifecycle.activate', { id: 'forge-tests.healthy' });
  assert.equal(activated.kind, 'response');
  assert.equal(activated.payload.status, 'active');
  assert.equal(activated.gen, 7, 'the generation is echoed on async answers too');

  const deactivated = await host.request('lifecycle.deactivate', { id: 'forge-tests.healthy' });
  assert.deepEqual(deactivated.payload, { id: 'forge-tests.healthy', status: 'inactive' });
});

test('a failing activation answers a typed error and logs it as a notification', async () => {
  const host = createLoadingResponder();
  await host.request('lifecycle.initialize', {
    protocol: 1,
    apiVersion: '1.90.0',
    extensions: [hostDescriptor('throwing'), hostDescriptor('unsupported')],
    workspace: null,
  });

  const failed = await host.request('lifecycle.activate', { id: 'forge-tests.throwing' });
  assert.equal(failed.kind, 'error');
  assert.equal(failed.payload.code, 'ACTIVATION_FAILED');
  assert.equal(failed.payload.stack, undefined, 'the stack never crosses the wire');
  assert.equal(
    host.notifications.some(
      (envelope) => envelope.method === 'diagnostics.log' && envelope.payload.level === 'error',
    ),
    true,
  );

  await host.request('lifecycle.activate', { id: 'forge-tests.unsupported' });
  const reported = host.notifications.find(
    (envelope) => envelope.method === 'diagnostics.unsupportedApi',
  );
  assert.deepEqual(reported.payload, {
    api: 'window.createStatusBarItem',
    extensionId: 'forge-tests.unsupported',
  });
  assert.equal(reported.id, 0, 'notifications carry no correlation id');
});

test('activate before the handshake, or with a bad payload, is refused typed', async () => {
  const host = createLoadingResponder();

  const early = await host.request('lifecycle.activate', { id: 'forge-tests.healthy' });
  assert.equal(early.payload.code, 'HOST_UNAVAILABLE');

  await host.request('lifecycle.initialize', {
    protocol: 1,
    apiVersion: '1.90.0',
    extensions: [hostDescriptor('healthy')],
    workspace: null,
  });

  const malformed = await host.request('lifecycle.activate', { name: 'healthy' });
  assert.equal(malformed.payload.code, 'INVALID_PAYLOAD');

  const unknown = await host.request('lifecycle.activate', { id: 'acme.nope' });
  assert.equal(unknown.payload.code, 'INVALID_PAYLOAD');
  assert.match(unknown.payload.message, /no forma parte de esta generación/);
});

test('shutdown deactivates what is active before answering', async () => {
  const host = createLoadingResponder();
  await host.request('lifecycle.initialize', {
    protocol: 1,
    apiVersion: '1.90.0',
    extensions: [hostDescriptor('healthy')],
    workspace: null,
  });
  await host.request('lifecycle.activate', { id: 'forge-tests.healthy' });

  const shutdown = await host.request('lifecycle.shutdown', {});

  assert.deepEqual(shutdown.payload, { ok: true });
  const loaded = require(path.join(HOST_FIXTURES, 'healthy', 'out', 'extension.js'));
  assert.equal(loaded.trace.includes('deactivate'), true, 'the extension got its deactivate()');
});

// ── Commands end to end (increment 3.3) ─────────────────────────────────
// The full path with nothing stubbed between the two ends: a fixture
// extension registers a command inside the host, the notification travels
// through the broker, main's dispatcher indexes it and runs it.

const {
  ExtensionCommandDispatcher,
} = require('../../dist-electron/extensions/application/extension-command-dispatcher.js');

test('a fixture command registers through the broker and runs from main', async () => {
  const descriptor = hostDescriptor('commanding');
  const timers = createFakeTimers();
  const launcher = createFakeLauncher(timers);
  const host = new UtilityProcessExtensionHost({
    launcher,
    timers,
    initialize: () => ({
      apiVersion: '1.90.0',
      extensions: [descriptor],
      workspace: null,
      trust: true,
    }),
    warn: () => {},
  });

  const dispatcher = new ExtensionCommandDispatcher({
    host,
    activatable: () => [{ id: descriptor.id, activationEvents: ['onCommand:fixture.greet'] }],
    ensureRunning: () => host.start(),
  });
  host.onEvent((event) => dispatcher.handleHostEvent(event));

  await host.start();
  assert.equal(dispatcher.hasCommand('fixture.greet'), false, 'nothing is active yet');

  const result = await dispatcher.execute('fixture.greet', ['Forge']);

  assert.equal(result, 'hola, Forge');
  assert.deepEqual(
    dispatcher.registered().map((entry) => entry.command).sort(),
    ['fixture.explode', 'fixture.greet', 'fixture.leaked'],
    'every registration crossed as a notification',
  );

  // A command that throws inside the extension comes back as a typed error
  // and leaves the host running.
  await assert.rejects(dispatcher.execute('fixture.explode'), (err) => {
    assert.match(err.message, /el comando revienta/);
    return true;
  });
  assert.equal(host.state.status, 'running');

  await host.stop();
  assert.deepEqual(dispatcher.registered(), [], 'stopping the host clears the registry');
});

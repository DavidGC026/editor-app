const assert = require('node:assert/strict');
const test = require('node:test');

const {
  RpcBroker,
  RpcError,
  isRpcEnvelope,
  methodFamily,
  resolveTimeoutMs,
  RPC_PROTOCOL_VERSION,
} = require('../../dist-electron/extensions/infrastructure/hosts/rpc-broker.js');

const {
  flush,
  createFakeTimers,
  createFakeTransport,
  responseTo,
  errorTo,
  eventEnvelope,
} = require('./helpers/rpc-harness.cjs');

function createBroker(options = {}) {
  const timers = createFakeTimers();
  const pipe = createFakeTransport();
  const events = [];
  const warnings = [];
  const broker = new RpcBroker({
    transport: pipe.transport,
    generation: options.generation ?? 1,
    timers,
    onEvent: (event) => events.push(event),
    warn: (message) => warnings.push(message),
    ...options,
  });
  return { broker, timers, pipe, events, warnings };
}

const eventsOfType = (events, type) => events.filter((event) => event.type === type);

// ── Envelope and correlation ────────────────────────────────────────────

test('a request travels as a versioned envelope carrying its generation', async () => {
  const h = createBroker({ generation: 7 });
  h.broker.request('commands.execute', { command: 'demo.hello' }, { extensionId: 'acme.demo' });

  assert.deepEqual(h.pipe.lastSent(), {
    v: RPC_PROTOCOL_VERSION,
    gen: 7,
    id: 1,
    kind: 'request',
    method: 'commands.execute',
    payload: { command: 'demo.hello' },
    extensionId: 'acme.demo',
  });
});

test('concurrent requests correlate by id and settle independently', async () => {
  const h = createBroker();
  const first = h.broker.request('commands.execute', { command: 'a' });
  const second = h.broker.request('commands.execute', { command: 'b' });
  const [outFirst, outSecond] = h.pipe.sent;

  assert.equal(outFirst.id, 1);
  assert.equal(outSecond.id, 2, 'ids are monotonic per sender');
  assert.equal(h.broker.pendingCount, 2);

  // Answered out of order: correlation must not depend on arrival order.
  h.pipe.deliver(responseTo(outSecond, 'second'));
  h.pipe.deliver(responseTo(outFirst, 'first'));

  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  assert.equal(h.broker.pendingCount, 0);
  assert.equal(h.timers.pendingTimers(), 0, 'settling clears the timeout timer');
});

test('notifications go out with id 0 and expect no answer', () => {
  const h = createBroker();
  h.broker.notify('diagnostics.activationMetrics', { ms: 12 }, 'acme.demo');

  assert.equal(h.pipe.lastSent().id, 0);
  assert.equal(h.pipe.lastSent().kind, 'event');
  assert.equal(h.broker.pendingCount, 0);
});

test('the envelope guard rejects the shapes the protocol forbids', () => {
  const valid = { v: 1, gen: 1, id: 1, kind: 'request', method: 'lifecycle.heartbeat', payload: null };
  assert.equal(isRpcEnvelope(valid), true);
  assert.equal(isRpcEnvelope({ ...valid, v: 2 }), false, 'other protocol versions');
  assert.equal(isRpcEnvelope({ ...valid, kind: 'shout' }), false, 'unknown kinds');
  assert.equal(isRpcEnvelope({ ...valid, method: '' }), false, 'empty methods');
  assert.equal(isRpcEnvelope({ ...valid, gen: -1 }), false, 'negative generations');
  assert.equal(isRpcEnvelope({ ...valid, id: 0 }), false, 'requests need a correlation id');
  assert.equal(isRpcEnvelope({ ...valid, kind: 'event', id: 3 }), false, 'events are id 0');
  assert.equal(isRpcEnvelope({ ...valid, extensionId: 5 }), false, 'extensionId is a string');
  assert.equal(isRpcEnvelope(null), false);
  assert.equal(methodFamily('lifecycle.activate'), 'lifecycle');
  assert.equal(methodFamily('heartbeat'), 'heartbeat');
});

// ── Timeouts per family ─────────────────────────────────────────────────

test('timeouts resolve by method, then family, then global default', () => {
  assert.equal(resolveTimeoutMs('lifecycle.activate'), 10_000);
  assert.equal(resolveTimeoutMs('commands.execute'), 5_000);
  assert.equal(resolveTimeoutMs('lifecycle.deactivate'), 3_000);
  assert.equal(resolveTimeoutMs('lifecycle.initialize'), 10_000, 'falls back to the family');
  assert.equal(resolveTimeoutMs('configuration.get'), 2_000);
  assert.equal(resolveTimeoutMs('unknown.method'), 5_000, 'global default');
  assert.equal(resolveTimeoutMs('commands.execute', { 'commands.execute': 250 }), 250);
  assert.equal(resolveTimeoutMs('commands.register', { commands: 750 }), 750, 'family override');
});

test('an expired request rejects with TIMEOUT and stops waiting', async () => {
  const h = createBroker();
  const pending = h.broker.request('commands.execute', { command: 'slow' }, { extensionId: 'acme.demo' });
  // The rejection handler is attached before the clock moves, so the failure
  // is observed by the assertion and not by the unhandled-rejection guard.
  const rejected = assert.rejects(pending, (err) => {
    assert.ok(err instanceof RpcError);
    assert.equal(err.code, 'TIMEOUT');
    assert.match(err.message, /commands\.execute/);
    return true;
  });

  await h.timers.advance(4_999);
  assert.equal(h.broker.pendingCount, 1, 'still waiting one millisecond before the budget');

  await h.timers.advance(1);
  await rejected;
  assert.equal(h.broker.pendingCount, 0);

  const [timeout] = eventsOfType(h.events, 'request-timeout');
  assert.deepEqual(
    { method: timeout.method, extensionId: timeout.extensionId },
    { method: 'commands.execute', extensionId: 'acme.demo' },
    'the owner is reported so it can be marked unresponsive',
  );
});

test('a late response for an already expired request is discarded', async () => {
  const h = createBroker();
  const pending = h.broker.request('commands.execute', {});
  const sent = h.pipe.lastSent();
  const rejected = assert.rejects(pending);
  await h.timers.advance(5_000);
  await rejected;

  h.pipe.deliver(responseTo(sent, 'too late'));
  assert.deepEqual(
    eventsOfType(h.events, 'dropped').map((event) => event.reason),
    ['unknown-response'],
  );
});

test('a per-request timeout overrides the family budget', async () => {
  const h = createBroker();
  const pending = h.broker.request('lifecycle.activate', {}, { timeoutMs: 40 });
  const rejected = assert.rejects(pending, (err) => err.code === 'TIMEOUT');
  await h.timers.advance(40);
  await rejected;
});

// ── Typed errors ────────────────────────────────────────────────────────

test('error envelopes reject with the design codes', async () => {
  for (const code of [
    'UNSUPPORTED_API',
    'ACTIVATION_FAILED',
    'CANCELLED',
    'HOST_UNAVAILABLE',
    'INVALID_PAYLOAD',
  ]) {
    const h = createBroker();
    const pending = h.broker.request('commands.execute', {});
    h.pipe.deliver(errorTo(h.pipe.lastSent(), code, `falló con ${code}`));
    await assert.rejects(pending, (err) => {
      assert.ok(err instanceof RpcError);
      assert.equal(err.code, code);
      assert.equal(err.message, `falló con ${code}`);
      return true;
    });
  }
});

test('an unrecognised error code degrades to INVALID_PAYLOAD instead of leaking', async () => {
  const h = createBroker();
  const pending = h.broker.request('commands.execute', {});
  h.pipe.deliver(errorTo(h.pipe.lastSent(), 'KABOOM', ''));
  await assert.rejects(pending, (err) => err.code === 'INVALID_PAYLOAD');
});

test('serialized errors never carry the stack', () => {
  const payload = new RpcError('ACTIVATION_FAILED', 'activate lanzó', { extensionId: 'a.b' }).toPayload();
  assert.deepEqual(payload, {
    code: 'ACTIVATION_FAILED',
    message: 'activate lanzó',
    data: { extensionId: 'a.b' },
  });
  assert.equal('stack' in payload, false);
});

test('cancelling settles locally and tells the peer', async () => {
  const h = createBroker();
  const pending = h.broker.request('commands.execute', {});
  const sent = h.pipe.lastSent();

  h.broker.cancel(sent.id, 'el usuario canceló');
  await assert.rejects(pending, (err) => err.code === 'CANCELLED');

  const cancellation = h.pipe.lastSent();
  assert.equal(cancellation.kind, 'error');
  assert.equal(cancellation.id, sent.id);
  assert.equal(cancellation.payload.code, 'CANCELLED');
  assert.equal(h.broker.pendingCount, 0);
});

test('a transport that cannot send fails the request instead of hanging', async () => {
  const h = createBroker();
  h.pipe.state.failSend = 'canal cerrado';
  await assert.rejects(
    h.broker.request('commands.execute', {}),
    (err) => err.code === 'HOST_UNAVAILABLE',
  );
  assert.equal(h.broker.pendingCount, 0);
});

// ── Generations ─────────────────────────────────────────────────────────

test('envelopes from a stale generation are discarded, never routed', async () => {
  const handled = [];
  const h = createBroker({ generation: 3, onRequest: (envelope) => handled.push(envelope.method) });
  const pending = h.broker.request('lifecycle.activate', {});
  const sent = h.pipe.lastSent();

  // A dying generation answering late must not settle the new one's request.
  h.pipe.deliver({ ...responseTo(sent, 'from the past'), gen: 2 });
  h.pipe.deliver({ ...eventEnvelope('window.showMessage', {}), gen: 2 });
  h.pipe.deliver({ v: 1, gen: 2, id: 9, kind: 'request', method: 'commands.register', payload: {} });
  await flush();

  assert.equal(h.broker.pendingCount, 1, 'the request is still in flight');
  assert.deepEqual(handled, [], 'stale requests never reach the handler');
  assert.deepEqual(
    eventsOfType(h.events, 'dropped').map((event) => event.reason),
    ['stale-generation', 'stale-generation', 'stale-generation'],
  );

  h.pipe.deliver(responseTo(sent, 'from the present'));
  assert.equal(await pending, 'from the present');
});

// ── Validation at the edge ──────────────────────────────────────────────

test('a malformed envelope is answered INVALID_PAYLOAD and never routed', async () => {
  const handled = [];
  const h = createBroker({ onRequest: (envelope) => handled.push(envelope.method) });

  h.pipe.deliver({ v: 1, gen: 1, id: 4, kind: 'request', method: 'commands.register', payload: {} });
  h.pipe.deliver({ v: 99, gen: 1, id: 5, kind: 'request', method: 'commands.register', payload: {} });
  await flush();

  assert.deepEqual(handled, ['commands.register'], 'only the valid one is routed');
  const answer = h.pipe.sent.find((envelope) => envelope.id === 5);
  assert.equal(answer.kind, 'error', 'the invalid one is refused at the edge');
  assert.equal(answer.payload.code, 'INVALID_PAYLOAD');
  assert.equal(h.pipe.sent.find((envelope) => envelope.id === 4).kind, 'response');
  assert.equal(h.warnings.length, 1);
});

test('garbage without a correlation id is dropped silently, with a diagnostic', async () => {
  const h = createBroker();
  h.pipe.deliver('not an envelope');
  h.pipe.deliver(null);
  await flush();

  assert.equal(h.pipe.sent.length, 0, 'nothing to answer to');
  assert.deepEqual(
    eventsOfType(h.events, 'dropped').map((event) => event.reason),
    ['malformed', 'malformed'],
  );
});

// ── Host → main requests ────────────────────────────────────────────────

test('without a handler every host request answers UNSUPPORTED_API', async () => {
  const h = createBroker();
  h.pipe.deliver({ v: 1, gen: 1, id: 8, kind: 'request', method: 'workspace.findFiles', payload: {} });
  await flush();

  const answer = h.pipe.lastSent();
  assert.equal(answer.kind, 'error');
  assert.equal(answer.payload.code, 'UNSUPPORTED_API');
  assert.match(answer.payload.message, /workspace\.findFiles/);
});

test('the handler result travels back as a response and a throw as a typed error', async () => {
  const h = createBroker({
    onRequest: async (envelope) => {
      if (envelope.method === 'configuration.get') return { value: 42 };
      throw new RpcError('ACTIVATION_FAILED', 'no activada');
    },
  });

  h.pipe.deliver({ v: 1, gen: 1, id: 1, kind: 'request', method: 'configuration.get', payload: { key: 'a' }, extensionId: 'acme.demo' });
  await flush();
  const ok = h.pipe.lastSent();
  assert.equal(ok.kind, 'response');
  assert.deepEqual(ok.payload, { value: 42 });
  assert.equal(ok.extensionId, 'acme.demo', 'the owner survives the round trip');

  h.pipe.deliver({ v: 1, gen: 1, id: 2, kind: 'request', method: 'commands.register', payload: {} });
  await flush();
  const failed = h.pipe.lastSent();
  assert.equal(failed.kind, 'error');
  assert.equal(failed.payload.code, 'ACTIVATION_FAILED');
});

// ── Log backpressure ────────────────────────────────────────────────────

const logEvent = (message, extensionId, level = 'info') =>
  eventEnvelope('diagnostics.log', { level, message }, { extensionId });

test('diagnostics logs are aggregated into one batch per window', async () => {
  const h = createBroker({ logFlushIntervalMs: 100 });
  h.pipe.deliver(logEvent('one', 'acme.demo'));
  h.pipe.deliver(logEvent('two', 'acme.demo'));

  await h.timers.advance(99);
  assert.equal(eventsOfType(h.events, 'logs').length, 0, 'nothing before the window closes');

  await h.timers.advance(1);
  const [batch] = eventsOfType(h.events, 'logs');
  assert.deepEqual(batch.entries.map((entry) => entry.message), ['one', 'two']);
  assert.deepEqual(batch.entries.map((entry) => entry.extensionId), ['acme.demo', 'acme.demo']);

  h.pipe.deliver(logEvent('three', 'acme.demo'));
  await h.timers.advance(100);
  assert.equal(eventsOfType(h.events, 'logs').length, 2, 'a new window opens on demand');
});

test('a log storm is trimmed per extension with a single rate-exceeded line', async () => {
  const h = createBroker({ logFlushIntervalMs: 100, logRateLimitPerSecond: 3 });
  for (let i = 0; i < 20; i += 1) h.pipe.deliver(logEvent(`spam ${i}`, 'noisy.ext'));
  h.pipe.deliver(logEvent('quiet', 'polite.ext'));

  await h.timers.advance(100);
  const [batch] = eventsOfType(h.events, 'logs');
  const noisy = batch.entries.filter((entry) => entry.extensionId === 'noisy.ext');

  assert.deepEqual(noisy.map((entry) => entry.message), [
    'spam 0', 'spam 1', 'spam 2', 'log rate exceeded (3 líneas/s)',
  ]);
  assert.equal(noisy[3].level, 'warn');
  assert.deepEqual(
    batch.entries.filter((entry) => entry.extensionId === 'polite.ext').map((e) => e.message),
    ['quiet'],
    'the budget is per extension: a noisy one cannot silence the rest',
  );
  assert.equal(eventsOfType(h.events, 'dropped').length, 16, 'the rest is dropped, not queued');
});

test('the rate window slides: a second later the extension logs again', async () => {
  const h = createBroker({ logFlushIntervalMs: 100, logRateLimitPerSecond: 2 });
  for (let i = 0; i < 5; i += 1) h.pipe.deliver(logEvent(`burst ${i}`, 'noisy.ext'));
  await h.timers.advance(1_000);

  h.pipe.deliver(logEvent('after the window', 'noisy.ext'));
  await h.timers.advance(100);

  const messages = eventsOfType(h.events, 'logs').flatMap((event) =>
    event.entries.map((entry) => entry.message));
  assert.deepEqual(messages, [
    'burst 0', 'burst 1', 'log rate exceeded (2 líneas/s)', 'after the window',
  ]);
});

test('malformed log payloads still produce an entry instead of breaking the pump', async () => {
  const h = createBroker({ logFlushIntervalMs: 100 });
  h.pipe.deliver(eventEnvelope('diagnostics.log', { level: 'shout', message: 'raro' }));
  h.pipe.deliver(eventEnvelope('diagnostics.log', 'texto plano'));
  await h.timers.advance(100);

  const [batch] = eventsOfType(h.events, 'logs');
  assert.deepEqual(batch.entries.map((entry) => [entry.level, entry.message, entry.extensionId]), [
    ['info', 'raro', null],
    ['info', 'texto plano', null],
  ]);
});

test('non-log events reach the subscriber untouched', async () => {
  const h = createBroker();
  h.pipe.deliver(eventEnvelope('window.showMessage', { text: 'hola' }, { extensionId: 'acme.demo' }));
  await flush();

  const [notification] = eventsOfType(h.events, 'notification');
  assert.equal(notification.envelope.method, 'window.showMessage');
  assert.deepEqual(notification.envelope.payload, { text: 'hola' });
});

// ── Disposal ────────────────────────────────────────────────────────────

test('dispose rejects everything in flight with HOST_UNAVAILABLE and closes the transport', async () => {
  const h = createBroker({ logFlushIntervalMs: 100 });
  const first = h.broker.request('lifecycle.activate', {});
  const second = h.broker.request('commands.execute', {});
  h.pipe.deliver(logEvent('pendiente de vaciar', 'acme.demo'));

  h.broker.dispose();

  await assert.rejects(first, (err) => err.code === 'HOST_UNAVAILABLE');
  await assert.rejects(second, (err) => err.code === 'HOST_UNAVAILABLE');
  assert.equal(h.pipe.state.closed, true);
  assert.equal(h.timers.pendingTimers(), 0, 'no timer outlives the broker');
  assert.deepEqual(
    eventsOfType(h.events, 'logs')[0].entries.map((entry) => entry.message),
    ['pendiente de vaciar'],
    'buffered logs are flushed instead of lost',
  );

  await assert.rejects(
    h.broker.request('commands.execute', {}),
    (err) => err.code === 'HOST_UNAVAILABLE',
    'a disposed broker accepts nothing new',
  );
});

import {
  RPC_PROTOCOL_VERSION,
  RpcError,
  isRpcEnvelope,
  methodFamily,
} from '../../domain/rpc-protocol';
import type {
  RpcEnvelope,
  RpcErrorCode,
  RpcLogEntry,
  RpcLogLevel,
} from '../../domain/rpc-protocol';

export {
  RPC_PROTOCOL_VERSION,
  RpcError,
  isRpcEnvelope,
  methodFamily,
};
export type {
  RpcEnvelope,
  RpcErrorCode,
  RpcLogEntry,
  RpcLogLevel,
};

/**
 * Byte pipe the broker talks through. Deliberately not `MessagePortMain`:
 * the broker must be testable with a fake transport and reusable by a remote
 * host, so Electron only appears in the adapter that builds one of these.
 */
export interface RpcTransport {
  send(envelope: RpcEnvelope): void;
  /** Subscribes to raw incoming messages. Returns the unsubscribe. */
  onMessage(listener: (message: unknown) => void): () => void;
  close(): void;
}

/** Injected clock and timers so tests never wait in real time. */
export interface RpcTimers {
  now(): number;
  setTimer(handler: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export const systemTimers: RpcTimers = {
  now: () => Date.now(),
  setTimer: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Fallback when neither the method nor its family declares a timeout. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

/** Per-family budgets (design §3.4). */
export const FAMILY_TIMEOUTS_MS: Readonly<Record<string, number>> = {
  lifecycle: 10_000,
  commands: 5_000,
  configuration: 2_000,
  window: 5_000,
  diagnostics: 1_000,
};

/** Method budgets that differ from their family's. */
export const METHOD_TIMEOUTS_MS: Readonly<Record<string, number>> = {
  'lifecycle.activate': 10_000,
  'lifecycle.deactivate': 3_000,
  'lifecycle.shutdown': 3_000,
  // Must expire well inside the heartbeat interval, or a hung host would be
  // detected several beats late.
  'lifecycle.heartbeat': 2_000,
  'commands.execute': 5_000,
};

/** Method override > family budget > global default. */
export function resolveTimeoutMs(
  method: string,
  overrides?: Readonly<Record<string, number>>,
): number {
  const override = overrides?.[method] ?? overrides?.[methodFamily(method)];
  if (typeof override === 'number' && override > 0) return override;
  const declared = METHOD_TIMEOUTS_MS[method] ?? FAMILY_TIMEOUTS_MS[methodFamily(method)];
  return typeof declared === 'number' ? declared : DEFAULT_REQUEST_TIMEOUT_MS;
}

export type RpcDropReason =
  /** Structurally invalid message. */
  | 'malformed'
  /** Belongs to a previous host generation (design §1.3). */
  | 'stale-generation'
  /** Response whose request is no longer pending (timed out, cancelled). */
  | 'unknown-response'
  /** Log line over the per-extension rate limit (design §3.4). */
  | 'log-rate-exceeded';

export type RpcBrokerEvent =
  | { type: 'notification'; envelope: RpcEnvelope }
  | { type: 'logs'; entries: RpcLogEntry[] }
  | { type: 'request-timeout'; method: string; extensionId: string | null }
  | { type: 'dropped'; reason: RpcDropReason; method: string };

/** Handles host → main requests. Returning nothing answers with `null`. */
export type RpcRequestHandler = (envelope: RpcEnvelope) => Promise<unknown> | unknown;

export interface RpcBrokerOptions {
  transport: RpcTransport;
  /** Generation this broker speaks for; other generations are discarded. */
  generation: number;
  timers?: RpcTimers;
  /** Per-method or per-family timeout overrides. */
  timeouts?: Readonly<Record<string, number>>;
  onRequest?: RpcRequestHandler;
  onEvent?: (event: RpcBrokerEvent) => void;
  /** Aggregation window for `diagnostics.log`. */
  logFlushIntervalMs?: number;
  /** Lines per extension and second before the batch is trimmed. */
  logRateLimitPerSecond?: number;
  warn?: (message: string) => void;
}

interface PendingRequest {
  method: string;
  extensionId: string | null;
  timer: unknown;
  resolve: (value: unknown) => void;
  reject: (error: RpcError) => void;
}

interface LogBudget {
  windowStart: number;
  count: number;
  /** True once the "rate exceeded" line was emitted for this window. */
  reported: boolean;
}

const LOG_LEVELS: readonly RpcLogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * Correlates requests, enforces per-family timeouts, discards envelopes from
 * stale generations and aggregates the log firehose. It owns no process: the
 * transport is a collaborator, so the same broker serves the `utilityProcess`
 * host, an in-process double and (later) a remote host.
 */
export class RpcBroker {
  private readonly options: RpcBrokerOptions;
  private readonly timers: RpcTimers;
  private readonly warn: (message: string) => void;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly logBudgets = new Map<string, LogBudget>();
  private readonly unsubscribe: () => void;
  private logBuffer: RpcLogEntry[] = [];
  private logFlushTimer: unknown = null;
  private nextId = 1;
  private disposed = false;

  constructor(options: RpcBrokerOptions) {
    this.options = options;
    this.timers = options.timers ?? systemTimers;
    this.warn = options.warn ?? ((message) => console.warn('[forge:ext-host]', message));
    this.unsubscribe = options.transport.onMessage((message) => this.handleMessage(message));
  }

  get generation(): number {
    return this.options.generation;
  }

  /** Requests still waiting for a response; used by the host and by tests. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Sends a request and resolves with its payload. Always settles: either the
   * peer answers or the family timeout rejects with `TIMEOUT` — the hard
   * guarantee the design leans on, since cancellation can be ignored.
   */
  request(
    method: string,
    payload?: unknown,
    options?: { extensionId?: string; timeoutMs?: number },
  ): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(
        new RpcError('HOST_UNAVAILABLE', `El host no está disponible para "${method}".`),
      );
    }
    const id = this.nextId++;
    const extensionId = options?.extensionId ?? null;
    const timeoutMs = options?.timeoutMs && options.timeoutMs > 0
      ? options.timeoutMs
      : resolveTimeoutMs(method, this.options.timeouts);

    return new Promise<unknown>((resolve, reject) => {
      const timer = this.timers.setTimer(() => {
        this.pending.delete(id);
        this.emit({ type: 'request-timeout', method, extensionId });
        reject(new RpcError('TIMEOUT', `"${method}" no respondió en ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(id, { method, extensionId, timer, resolve, reject });

      try {
        this.options.transport.send(this.envelope('request', id, method, payload, extensionId));
      } catch (err) {
        this.settleFailure(
          id,
          new RpcError('HOST_UNAVAILABLE', `No se pudo enviar "${method}": ${describe(err)}`),
        );
      }
    });
  }

  /** Fire-and-forget notification (`id: 0`). */
  notify(method: string, payload?: unknown, extensionId?: string): void {
    if (this.disposed) return;
    try {
      this.options.transport.send(
        this.envelope('event', 0, method, payload, extensionId ?? null),
      );
    } catch (err) {
      this.warn(`no se pudo notificar "${method}": ${describe(err)}`);
    }
  }

  /**
   * Stops waiting for a request and tells the peer. The peer may ignore it;
   * the request is settled locally regardless.
   */
  cancel(id: number, reason = 'Cancelado por Forge.'): void {
    const request = this.pending.get(id);
    if (!request) return;
    try {
      this.options.transport.send(
        this.envelope(
          'error',
          id,
          request.method,
          new RpcError('CANCELLED', reason).toPayload(),
          request.extensionId,
        ),
      );
    } catch (err) {
      this.warn(`no se pudo cancelar "${request.method}": ${describe(err)}`);
    }
    this.settleFailure(id, new RpcError('CANCELLED', reason));
  }

  /**
   * Rejects everything in flight and releases the transport. Called on every
   * generation change so a dead host never leaves a promise hanging.
   */
  dispose(error?: RpcError): void {
    if (this.disposed) return;
    this.disposed = true;
    const failure = error ?? new RpcError('HOST_UNAVAILABLE', 'El Extension Host se detuvo.');
    for (const id of [...this.pending.keys()]) this.settleFailure(id, failure);
    this.flushLogs();
    this.unsubscribe();
    try {
      this.options.transport.close();
    } catch (err) {
      this.warn(`cierre del transporte fallido: ${describe(err)}`);
    }
  }

  // ── Incoming traffic ──────────────────────────────────────────────────

  private handleMessage(message: unknown): void {
    if (this.disposed) return;
    if (!isRpcEnvelope(message)) {
      this.rejectMalformed(message);
      return;
    }
    // A late `activate` from a killed host must never reach the new one.
    if (message.gen !== this.options.generation) {
      this.emit({ type: 'dropped', reason: 'stale-generation', method: message.method });
      return;
    }
    switch (message.kind) {
      case 'response':
        this.settleResponse(message);
        return;
      case 'error':
        this.settleError(message);
        return;
      case 'request':
        void this.serveRequest(message);
        return;
      case 'event':
        this.receiveEvent(message);
        return;
      default:
        this.emit({ type: 'dropped', reason: 'malformed', method: message.method });
    }
  }

  private rejectMalformed(message: unknown): void {
    const method = readString(message, 'method') ?? '<unknown>';
    this.emit({ type: 'dropped', reason: 'malformed', method });
    this.warn(`envelope inválido descartado (method="${method}")`);

    // Best effort: an unparseable request still deserves an answer when its
    // correlation id survived, so the caller fails fast instead of timing out.
    const id = readNumber(message, 'id');
    if (readString(message, 'kind') === 'request' && id !== null && id > 0) {
      this.sendError(id, method, null, new RpcError('INVALID_PAYLOAD', 'Envelope inválido.'));
    }
  }

  private settleResponse(envelope: RpcEnvelope): void {
    const request = this.pending.get(envelope.id);
    if (!request) {
      this.emit({ type: 'dropped', reason: 'unknown-response', method: envelope.method });
      return;
    }
    this.pending.delete(envelope.id);
    this.timers.clearTimer(request.timer);
    request.resolve(envelope.payload);
  }

  private settleError(envelope: RpcEnvelope): void {
    const error = RpcError.fromPayload(envelope.payload);
    if (envelope.id === 0) {
      this.emit({ type: 'notification', envelope });
      return;
    }
    const request = this.pending.get(envelope.id);
    if (!request) {
      this.emit({ type: 'dropped', reason: 'unknown-response', method: envelope.method });
      return;
    }
    this.settleFailure(envelope.id, error);
  }

  private async serveRequest(envelope: RpcEnvelope): Promise<void> {
    const handler = this.options.onRequest;
    if (!handler) {
      this.sendError(
        envelope.id,
        envelope.method,
        envelope.extensionId ?? null,
        new RpcError('UNSUPPORTED_API', `"${envelope.method}" no está soportado todavía.`),
      );
      return;
    }
    try {
      const result = await handler(envelope);
      if (this.disposed) return;
      this.options.transport.send(
        this.envelope(
          'response',
          envelope.id,
          envelope.method,
          result === undefined ? null : result,
          envelope.extensionId ?? null,
        ),
      );
    } catch (err) {
      if (this.disposed) return;
      this.sendError(envelope.id, envelope.method, envelope.extensionId ?? null, toRpcError(err));
    }
  }

  private receiveEvent(envelope: RpcEnvelope): void {
    if (envelope.method === 'diagnostics.log') {
      this.bufferLog(envelope);
      return;
    }
    this.emit({ type: 'notification', envelope });
  }

  // ── Log backpressure (design §3.4) ────────────────────────────────────

  private bufferLog(envelope: RpcEnvelope): void {
    const extensionId = envelope.extensionId ?? null;
    const budget = this.consumeLogBudget(extensionId);
    if (budget === 'exceeded') {
      this.emit({ type: 'dropped', reason: 'log-rate-exceeded', method: envelope.method });
      return;
    }
    const now = this.timers.now();
    const entry: RpcLogEntry = budget === 'first-over-limit'
      ? {
        extensionId,
        level: 'warn',
        message: `log rate exceeded (${this.logRateLimit()} líneas/s)`,
        at: now,
      }
      : { extensionId, level: readLevel(envelope.payload), message: readMessage(envelope.payload), at: now };

    this.logBuffer.push(entry);
    if (this.logFlushTimer === null) {
      this.logFlushTimer = this.timers.setTimer(
        () => this.flushLogs(),
        this.options.logFlushIntervalMs ?? 100,
      );
    }
  }

  private logRateLimit(): number {
    return this.options.logRateLimitPerSecond ?? 200;
  }

  /**
   * Rolling one-second window per extension. The line that crosses the limit
   * becomes the single "rate exceeded" notice; the rest of the window is
   * dropped, so a `console.log` loop cannot flood broker, UI and disk.
   */
  private consumeLogBudget(extensionId: string | null): 'ok' | 'first-over-limit' | 'exceeded' {
    const key = extensionId ?? '';
    const now = this.timers.now();
    const budget = this.logBudgets.get(key);
    if (!budget || now - budget.windowStart >= 1_000) {
      this.logBudgets.set(key, { windowStart: now, count: 1, reported: false });
      return 'ok';
    }
    budget.count += 1;
    if (budget.count <= this.logRateLimit()) return 'ok';
    if (budget.reported) return 'exceeded';
    budget.reported = true;
    return 'first-over-limit';
  }

  private flushLogs(): void {
    if (this.logFlushTimer !== null) {
      this.timers.clearTimer(this.logFlushTimer);
      this.logFlushTimer = null;
    }
    if (this.logBuffer.length === 0) return;
    const entries = this.logBuffer;
    this.logBuffer = [];
    this.emit({ type: 'logs', entries });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private settleFailure(id: number, error: RpcError): void {
    const request = this.pending.get(id);
    if (!request) return;
    this.pending.delete(id);
    this.timers.clearTimer(request.timer);
    request.reject(error);
  }

  private sendError(
    id: number,
    method: string,
    extensionId: string | null,
    error: RpcError,
  ): void {
    try {
      this.options.transport.send(
        this.envelope('error', id, method, error.toPayload(), extensionId),
      );
    } catch (err) {
      this.warn(`no se pudo responder a "${method}": ${describe(err)}`);
    }
  }

  private envelope(
    kind: RpcEnvelope['kind'],
    id: number,
    method: string,
    payload: unknown,
    extensionId: string | null,
  ): RpcEnvelope {
    const envelope: RpcEnvelope = {
      v: RPC_PROTOCOL_VERSION,
      gen: this.options.generation,
      id,
      kind,
      method,
      payload: payload === undefined ? null : payload,
    };
    if (extensionId) envelope.extensionId = extensionId;
    return envelope;
  }

  private emit(event: RpcBrokerEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch (err) {
      // A faulty subscriber must not break the message pump.
      this.warn(`suscriptor del broker falló: ${describe(err)}`);
    }
  }
}

function readString(value: unknown, key: string): string | null {
  if (value === null || typeof value !== 'object') return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : null;
}

function readNumber(value: unknown, key: string): number | null {
  if (value === null || typeof value !== 'object') return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'number' && Number.isFinite(found) ? found : null;
}

function readLevel(payload: unknown): RpcLogLevel {
  const level = readString(payload, 'level');
  return LOG_LEVELS.includes(level as RpcLogLevel) ? (level as RpcLogLevel) : 'info';
}

function readMessage(payload: unknown): string {
  const message = readString(payload, 'message');
  if (message !== null) return message;
  return typeof payload === 'string' ? payload : '';
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Anything thrown by a handler becomes a typed error before it crosses. */
export function toRpcError(err: unknown): RpcError {
  if (err instanceof RpcError) return err;
  return new RpcError('INVALID_PAYLOAD', describe(err));
}

/**
 * Wire vocabulary shared by both ends of the Extension Host channel: the
 * envelope, its error codes and the guards that validate anything arriving
 * from the other side. It lives in the domain because the application port
 * and the infrastructure broker must agree on it without either depending
 * on the other (architecture §4, "inversión de dependencias").
 */

/** Protocol version negotiated in the handshake (design §3.2). */
export const RPC_PROTOCOL_VERSION = 1;

export type RpcMessageKind = 'request' | 'response' | 'event' | 'error';

/** Single versioned envelope for both directions (design §3.1). */
export interface RpcEnvelope {
  v: typeof RPC_PROTOCOL_VERSION;
  /** Host generation; envelopes from an older one are discarded. */
  gen: number;
  /** Correlation id, monotonic per sender; 0 in notifications. */
  id: number;
  kind: RpcMessageKind;
  /** `lifecycle.activate`, `commands.execute`, … */
  method: string;
  /** Owning extension, when the method has one. */
  extensionId?: string;
  payload: unknown;
}

export type RpcErrorCode =
  | 'UNSUPPORTED_API'
  | 'ACTIVATION_FAILED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'HOST_UNAVAILABLE'
  | 'INVALID_PAYLOAD';

/** Serializable error body carried by `kind: 'error'` envelopes. */
export interface RpcErrorPayload {
  code: RpcErrorCode;
  message: string;
  data?: unknown;
}

const ERROR_CODES: readonly RpcErrorCode[] = [
  'UNSUPPORTED_API',
  'ACTIVATION_FAILED',
  'TIMEOUT',
  'CANCELLED',
  'HOST_UNAVAILABLE',
  'INVALID_PAYLOAD',
];

const MESSAGE_KINDS: readonly RpcMessageKind[] = ['request', 'response', 'event', 'error'];

/**
 * Typed RPC failure. `toPayload()` is the only thing that crosses the wire:
 * the stack stays in the local log and never reaches the UI (architecture §10).
 */
export class RpcError extends Error {
  readonly code: RpcErrorCode;
  readonly data: unknown;

  constructor(code: RpcErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }

  toPayload(): RpcErrorPayload {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }

  /** Rebuilds an error received from the other side; unknown shapes degrade
   *  to `INVALID_PAYLOAD` instead of throwing inside the message pump. */
  static fromPayload(payload: unknown): RpcError {
    if (payload === null || typeof payload !== 'object') {
      return new RpcError('INVALID_PAYLOAD', 'Error sin cuerpo serializable.');
    }
    const body = payload as Partial<RpcErrorPayload>;
    const code = ERROR_CODES.includes(body.code as RpcErrorCode)
      ? (body.code as RpcErrorCode)
      : 'INVALID_PAYLOAD';
    const message = typeof body.message === 'string' && body.message
      ? body.message
      : `RPC error ${code}`;
    return new RpcError(code, message, body.data);
  }
}

export function isRpcErrorCode(value: unknown): value is RpcErrorCode {
  return typeof value === 'string' && ERROR_CODES.includes(value as RpcErrorCode);
}

/**
 * Structural validation of an incoming message. Everything that fails here
 * is answered with `INVALID_PAYLOAD` and never routed further (design §3.1,
 * "validación en el borde").
 */
export function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const envelope = value as Partial<RpcEnvelope>;
  if (envelope.v !== RPC_PROTOCOL_VERSION) return false;
  if (!Number.isInteger(envelope.gen) || (envelope.gen as number) < 0) return false;
  if (!Number.isInteger(envelope.id) || (envelope.id as number) < 0) return false;
  if (!MESSAGE_KINDS.includes(envelope.kind as RpcMessageKind)) return false;
  if (typeof envelope.method !== 'string' || !envelope.method) return false;
  if (envelope.extensionId !== undefined && typeof envelope.extensionId !== 'string') return false;
  // Requests and responses correlate by a non-zero id; notifications use 0.
  if (envelope.kind === 'event' && envelope.id !== 0) return false;
  if ((envelope.kind === 'request' || envelope.kind === 'response') && envelope.id === 0) {
    return false;
  }
  return true;
}

/** `lifecycle.activate` → `lifecycle`. Timeouts are configured per family. */
export function methodFamily(method: string): string {
  const separator = method.indexOf('.');
  return separator === -1 ? method : method.slice(0, separator);
}

export type RpcLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One aggregated `diagnostics.log` line (design §3.4). */
export interface RpcLogEntry {
  extensionId: string | null;
  level: RpcLogLevel;
  message: string;
  /** Broker clock at reception, not the host's. */
  at: number;
}

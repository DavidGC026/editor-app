/**
 * Entry point of the Extension Host `utilityProcess`.
 *
 * Milestone 3.1 deliberately does nothing but speak the protocol: it answers
 * the handshake, the heartbeat and `shutdown`, and reports every other method
 * as `UNSUPPORTED_API`. Loading extensions and `require('vscode')` arrive in
 * 3.2; keeping them out makes "the host starts, beats, dies and restarts
 * cleanly" verifiable on its own.
 */
import {
  RPC_PROTOCOL_VERSION,
  RpcError,
  isRpcEnvelope,
} from '../extensions/domain/rpc-protocol';
import type { RpcEnvelope } from '../extensions/domain/rpc-protocol';

/** Message main sends to hand over the channel (mirrors the launcher). */
export const HOST_PORT_MESSAGE = 'forge:extension-host-port';

export interface BootstrapResponderOptions {
  /** Monotonic-ish clock used for uptime; injected for tests. */
  now: () => number;
  nodeVersion: string;
  /** Called after `lifecycle.shutdown` has been answered. */
  exit: (code: number) => void;
  warn?: (message: string) => void;
}

/**
 * Pure message handler: envelope in, envelope out (or null when there is
 * nothing to answer). Everything I/O-shaped stays in `attachParentPort`, so
 * the protocol behaviour can be tested in-process against the real broker.
 */
export function createBootstrapResponder(
  options: BootstrapResponderOptions,
): (message: unknown) => RpcEnvelope | null {
  const startedAt = options.now();
  const warn = options.warn ?? ((message: string) => console.warn('[forge:host]', message));
  let initialized = false;

  const reply = (
    request: RpcEnvelope,
    kind: 'response' | 'error',
    payload: unknown,
  ): RpcEnvelope => ({
    v: RPC_PROTOCOL_VERSION,
    // The generation is echoed, never invented: main is its only source and
    // discards anything that comes back with a stale one.
    gen: request.gen,
    id: request.id,
    kind,
    method: request.method,
    payload,
    ...(request.extensionId ? { extensionId: request.extensionId } : {}),
  });

  const fail = (request: RpcEnvelope, error: RpcError): RpcEnvelope =>
    reply(request, 'error', error.toPayload());

  return (message: unknown): RpcEnvelope | null => {
    if (!isRpcEnvelope(message)) {
      warn('mensaje descartado: no es un envelope válido');
      return null;
    }
    // Main only issues requests in this milestone; responses to the host's own
    // calls arrive in 3.3, when the host starts calling back.
    if (message.kind !== 'request') return null;

    switch (message.method) {
      case 'lifecycle.initialize': {
        const payload = message.payload as { protocol?: unknown } | null;
        if (!payload || typeof payload !== 'object' || payload.protocol !== RPC_PROTOCOL_VERSION) {
          return fail(message, new RpcError(
            'HOST_UNAVAILABLE',
            `Protocolo no soportado por el host: ${String(payload?.protocol)}.`,
          ));
        }
        initialized = true;
        return reply(message, 'response', {
          protocol: RPC_PROTOCOL_VERSION,
          nodeVersion: options.nodeVersion,
          ready: true,
        });
      }
      case 'lifecycle.heartbeat': {
        if (!initialized) {
          return fail(message, new RpcError(
            'HOST_UNAVAILABLE',
            'El host todavía no completó el handshake.',
          ));
        }
        return reply(message, 'response', { ok: true, uptimeMs: options.now() - startedAt });
      }
      case 'lifecycle.shutdown': {
        const answer = reply(message, 'response', { ok: true });
        options.exit(0);
        return answer;
      }
      default:
        return fail(message, new RpcError(
          'UNSUPPORTED_API',
          `"${message.method}" todavía no está implementado en el Extension Host.`,
        ));
    }
  };
}

interface HostMessagePort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  start(): void;
}

interface HostParentPort {
  on(event: 'message', listener: (event: { data: unknown; ports: HostMessagePort[] }) => void): void;
  postMessage(message: unknown): void;
}

/** Wires the responder to the `MessagePortMain` main sends after the fork. */
export function attachParentPort(parentPort: HostParentPort): void {
  parentPort.on('message', (event) => {
    const data = event.data as { type?: unknown } | null;
    if (!data || typeof data !== 'object' || data.type !== HOST_PORT_MESSAGE) return;
    const port = event.ports[0];
    if (!port) return;

    const respond = createBootstrapResponder({
      now: () => Date.now(),
      nodeVersion: process.versions.node,
      // Give the answer a chance to leave before the process goes away.
      exit: (code) => setTimeout(() => process.exit(code), 0),
    });
    port.on('message', (incoming) => {
      const answer = respond(incoming.data);
      if (answer) port.postMessage(answer);
    });
    port.start();
  });
}

// `parentPort` only exists inside a utilityProcess; requiring this module from
// the test runner must not blow up.
if (typeof process !== 'undefined' && process.parentPort) {
  attachParentPort(process.parentPort as unknown as HostParentPort);
}

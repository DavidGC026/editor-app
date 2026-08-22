/**
 * Entry point of the Extension Host `utilityProcess`.
 *
 * Increment 3.1 taught it to speak the protocol; 3.2 puts the loader behind
 * it: `lifecycle.initialize` now carries the descriptors of the extensions
 * this generation may load, and `lifecycle.activate` runs their code through
 * the `ExtensionRuntime`. Everything outside `lifecycle` still answers
 * `UNSUPPORTED_API` — `commands.register` and friends are 3.3.
 *
 * The responder stays a pure `envelope → envelope` function (now allowed to
 * be async, since activation is), and all I/O wiring lives in
 * `attachParentPort`, so the protocol behaviour is testable in-process
 * against the real broker.
 */
import Module from 'module';
import path from 'path';
import {
  RPC_PROTOCOL_VERSION,
  RpcError,
  isExtensionHostDescriptor,
  isRpcEnvelope,
} from '../extensions/domain/rpc-protocol';
import type {
  ExtensionHostDescriptor,
  RpcEnvelope,
  RpcLogLevel,
} from '../extensions/domain/rpc-protocol';
import { ExtensionRuntime } from './extension-runtime';
import type { ExtensionRuntimeOptions } from './extension-runtime';
import type { ModuleSystemLike } from './module-loader';
import { createFsMementoStore } from './fs-memento-store';

/** Message main sends to hand over the channel (mirrors the launcher). */
export const HOST_PORT_MESSAGE = 'forge:extension-host-port';

export interface BootstrapResponderOptions {
  /** Monotonic-ish clock used for uptime; injected for tests. */
  now: () => number;
  nodeVersion: string;
  /** Called after `lifecycle.shutdown` has been answered. */
  exit: (code: number) => void;
  warn?: (message: string) => void;
  /** Sends a host-originated notification (logs, unsupported API reports).
   *  Absent in the pure unit tests, where nothing listens. */
  notify?: (envelope: RpcEnvelope) => void;
  /** Builds the runtime for a generation. Overridden in tests to load
   *  fixtures without touching the real module system. */
  createRuntime?: (options: RuntimeFactoryInput) => ExtensionRuntime;
}

export interface RuntimeFactoryInput {
  apiVersion: string;
  workspacePath: string | null;
  log: ExtensionRuntimeOptions['log'];
  reportUnsupportedApi: ExtensionRuntimeOptions['reportUnsupportedApi'];
  now: () => number;
}

/** Default runtime: the real module system, the real filesystem. */
function createDefaultRuntime(input: RuntimeFactoryInput): ExtensionRuntime {
  const fs = require('fs') as typeof import('fs');
  return new ExtensionRuntime({
    apiVersion: input.apiVersion,
    workspacePath: input.workspacePath,
    moduleSystem: Module as unknown as ModuleSystemLike,
    loadModule: (entryPoint) => require(entryPoint),
    entryPointDeps: {
      realpath: (target) => {
        try {
          return fs.realpathSync(target);
        } catch {
          // Missing paths realpath to themselves so "escaping" and "missing"
          // stay distinguishable in the resolver.
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
    // Storage paths travel in each descriptor, decided and sanitised by main.
    mementoStore: createFsMementoStore(),
    joinPath: (...segments) => path.join(...segments),
    now: input.now,
    log: input.log,
    reportUnsupportedApi: input.reportUnsupportedApi,
  });
}

type Responder = (message: unknown) => RpcEnvelope | null | Promise<RpcEnvelope | null>;

/**
 * Pure message handler: envelope in, envelope out (or null when there is
 * nothing to answer). May answer asynchronously — `lifecycle.activate` runs
 * extension code — which the transport side awaits before posting.
 */
export function createBootstrapResponder(options: BootstrapResponderOptions): Responder {
  const startedAt = options.now();
  const warn = options.warn ?? ((message: string) => console.warn('[forge:host]', message));
  const createRuntime = options.createRuntime ?? createDefaultRuntime;
  let initialized = false;
  let runtime: ExtensionRuntime | null = null;
  let generation = 0;

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

  const notify = (method: string, payload: unknown, extensionId?: string): void => {
    options.notify?.({
      v: RPC_PROTOCOL_VERSION,
      gen: generation,
      id: 0,
      kind: 'event',
      method,
      payload,
      ...(extensionId ? { extensionId } : {}),
    });
  };

  const log = (level: RpcLogLevel, message: string, extensionId?: string): void => {
    notify('diagnostics.log', { level, message, extensionId: extensionId ?? null }, extensionId);
  };

  /** Requests carrying `{ id }`; anything else is refused at the edge. */
  const extensionIdOf = (request: RpcEnvelope): string => {
    const payload = request.payload as { id?: unknown } | null;
    const id = payload && typeof payload === 'object' ? payload.id : undefined;
    if (typeof id !== 'string' || !id) {
      throw new RpcError('INVALID_PAYLOAD', `"${request.method}" requiere { id: string }.`);
    }
    return id;
  };

  const requireRuntime = (): ExtensionRuntime => {
    if (!runtime) {
      throw new RpcError('HOST_UNAVAILABLE', 'El host todavía no completó el handshake.');
    }
    return runtime;
  };

  return async (message: unknown): Promise<RpcEnvelope | null> => {
    if (!isRpcEnvelope(message)) {
      warn('mensaje descartado: no es un envelope válido');
      return null;
    }
    // Main only issues requests in this milestone; responses to the host's own
    // calls arrive in 3.3, when the host starts calling back.
    if (message.kind !== 'request') return null;

    try {
      switch (message.method) {
        case 'lifecycle.initialize': {
          const payload = message.payload as
            | { protocol?: unknown; apiVersion?: unknown; extensions?: unknown;
                workspace?: unknown }
            | null;
          if (!payload || typeof payload !== 'object'
            || payload.protocol !== RPC_PROTOCOL_VERSION) {
            return fail(message, new RpcError(
              'HOST_UNAVAILABLE',
              `Protocolo no soportado por el host: ${String(payload?.protocol)}.`,
            ));
          }

          generation = message.gen;
          const workspacePath = typeof payload.workspace === 'string' ? payload.workspace : null;
          const descriptors = descriptorsFrom(payload.extensions, warn);

          runtime = createRuntime({
            apiVersion: typeof payload.apiVersion === 'string' ? payload.apiVersion : '0.0.0',
            workspacePath,
            log,
            reportUnsupportedApi: (api, extensionId) => {
              notify('diagnostics.unsupportedApi', { api, extensionId }, extensionId);
            },
            now: options.now,
          });
          runtime.setExtensions(descriptors);
          initialized = true;

          return reply(message, 'response', {
            protocol: RPC_PROTOCOL_VERSION,
            nodeVersion: options.nodeVersion,
            ready: true,
            /** Echoed so main can tell a rejected descriptor from a dropped one. */
            loadable: descriptors.map((descriptor) => descriptor.id),
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
        case 'lifecycle.activate': {
          const result = await requireRuntime().activate(extensionIdOf(message));
          return reply(message, 'response', result);
        }
        case 'lifecycle.deactivate': {
          const id = extensionIdOf(message);
          await requireRuntime().deactivate(id);
          return reply(message, 'response', { id, status: 'inactive' });
        }
        case 'lifecycle.shutdown': {
          // Extensions get their `deactivate()` before the process goes away;
          // failures there must not stop the shutdown from being answered.
          try {
            await runtime?.deactivateAll();
          } catch (err) {
            warn(`deactivateAll falló: ${err instanceof Error ? err.message : String(err)}`);
          }
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
    } catch (err) {
      // Every failure leaves as a typed error envelope: the host never lets an
      // exception escape into the message pump, where it would look like a
      // hang to main and burn a heartbeat budget.
      return fail(message, err instanceof RpcError
        ? err
        : new RpcError('ACTIVATION_FAILED', err instanceof Error ? err.message : String(err)));
    }
  };
}

/** Validates the descriptor list at the edge; invalid entries are dropped and
 *  reported, never guessed at. */
function descriptorsFrom(value: unknown, warn: (message: string) => void): ExtensionHostDescriptor[] {
  if (!Array.isArray(value)) return [];
  const descriptors: ExtensionHostDescriptor[] = [];
  for (const entry of value) {
    if (isExtensionHostDescriptor(entry)) descriptors.push(entry);
    else warn(`descriptor de extensión inválido descartado: ${JSON.stringify(entry)}`);
  }
  return descriptors;
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
      notify: (envelope) => port.postMessage(envelope),
    });
    port.on('message', (incoming) => {
      void Promise.resolve(respond(incoming.data)).then((answer) => {
        if (answer) port.postMessage(answer);
      });
    });
    port.start();
  });
}

// `parentPort` only exists inside a utilityProcess; requiring this module from
// the test runner must not blow up.
if (typeof process !== 'undefined' && process.parentPort) {
  attachParentPort(process.parentPort as unknown as HostParentPort);
}

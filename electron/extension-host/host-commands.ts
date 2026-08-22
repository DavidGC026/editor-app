/**
 * `vscode.commands` inside the host.
 *
 * The handler itself never leaves this process: what travels to main is the
 * *fact* that a command id exists and who owns it (`commands.register`).
 * Execution comes back the other way as `commands.execute`, is looked up
 * here and the result is returned. That split is the whole point — a
 * function cannot cross a process boundary, and pretending otherwise is how
 * command registries end up leaking closures or, worse, `eval`.
 *
 * Ownership is tracked per extension so `deactivate()` can drop everything
 * an extension registered without asking it to cooperate.
 */
import { RpcError } from '../extensions/domain/rpc-protocol';
import { Disposable } from './vscode-api/primitives';

export type CommandHandler = (...args: unknown[]) => unknown;

/** How the registry talks to main. Injected, so the registry is testable
 *  without a transport and the runtime decides what "publishing" means. */
export interface CommandBridge {
  register(commandId: string, extensionId: string): void;
  unregister(commandId: string, extensionId: string): void;
}

interface RegisteredCommand {
  extensionId: string;
  handler: CommandHandler;
  thisArg: unknown;
}

export class HostCommandRegistry {
  private readonly commands = new Map<string, RegisteredCommand>();
  private readonly bridge: CommandBridge;

  constructor(bridge: CommandBridge) {
    this.bridge = bridge;
  }

  /**
   * `vscode.commands.registerCommand`. Duplicate ids throw, exactly as VS
   * Code does: silently replacing another extension's command would let any
   * extension hijack the workbench by declaring a well-known id.
   */
  register(
    extensionId: string,
    commandId: string,
    handler: CommandHandler,
    thisArg?: unknown,
  ): Disposable {
    if (typeof commandId !== 'string' || !commandId) {
      throw new Error('registerCommand requiere un id de comando no vacío.');
    }
    if (typeof handler !== 'function') {
      throw new Error(`El handler de "${commandId}" debe ser una función.`);
    }
    const existing = this.commands.get(commandId);
    if (existing) {
      throw new Error(
        `El comando "${commandId}" ya está registrado`
        + `${existing.extensionId === extensionId ? '' : ` por "${existing.extensionId}"`}.`,
      );
    }

    this.commands.set(commandId, { extensionId, handler, thisArg });
    this.bridge.register(commandId, extensionId);

    return new Disposable(() => {
      // Only if it is still ours: a dispose after the id was re-registered
      // by someone else must not unregister the newcomer.
      const current = this.commands.get(commandId);
      if (!current || current.handler !== handler) return;
      this.commands.delete(commandId);
      this.bridge.unregister(commandId, extensionId);
    });
  }

  has(commandId: string): boolean {
    return this.commands.has(commandId);
  }

  /** Ids owned by `extensionId`, in registration order. */
  ownedBy(extensionId: string): string[] {
    const owned: string[] = [];
    for (const [commandId, command] of this.commands) {
      if (command.extensionId === extensionId) owned.push(commandId);
    }
    return owned;
  }

  /**
   * Runs a command and resolves its result. Sync and async handlers are both
   * awaited so callers never have to care which one they got.
   */
  async execute(commandId: string, args: unknown[] = []): Promise<unknown> {
    const command = this.commands.get(commandId);
    if (!command) {
      throw new RpcError(
        'COMMAND_NOT_FOUND',
        `El comando "${commandId}" no está registrado en el Extension Host.`,
      );
    }
    return await command.handler.apply(command.thisArg, args);
  }

  /** Drops everything an extension registered. Used on `deactivate()`, where
   *  the extension may well not have disposed its own subscriptions. */
  disposeOwner(extensionId: string): void {
    for (const commandId of this.ownedBy(extensionId)) {
      this.commands.delete(commandId);
      this.bridge.unregister(commandId, extensionId);
    }
  }

  /** Every registered id. Feeds `vscode.commands.getCommands`. */
  ids(): string[] {
    return [...this.commands.keys()];
  }
}

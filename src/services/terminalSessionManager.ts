/**
 * Owns renderer-side terminal sessions independently from React views.
 *
 * A terminal view may be unmounted when the user changes tabs or moves the
 * terminal to another dock. The PTY must outlive that presentation change;
 * only an explicit session close is allowed to destroy it.
 */

interface TerminalStartOptions {
  cwd?: string;
  cols?: number;
  rows?: number;
}

type DataListener = (data: string) => void;
type ExitListener = (code: number) => void;

interface ManagedTerminalSession {
  ptyId: string | null;
  startPromise: Promise<string>;
  dataDisposable: { dispose: () => void } | null;
  exitDisposable: { dispose: () => void } | null;
  outputChunks: string[];
  outputSize: number;
  dataListeners: Set<DataListener>;
  exitListeners: Set<ExitListener>;
  exitCode: number | null;
  destroyed: boolean;
}

const MAX_REPLAY_BUFFER_CHARS = 2_000_000;

class TerminalSessionManager {
  private readonly sessions = new Map<string, ManagedTerminalSession>();

  start(sessionId: string, options: TerminalStartOptions): Promise<string> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing.startPromise;

    if (!window.electronAPI?.terminalCreate) {
      return Promise.reject(new Error('Terminal API not available — run inside Electron.'));
    }

    const session = {} as ManagedTerminalSession;
    session.ptyId = null;
    session.dataDisposable = null;
    session.exitDisposable = null;
    session.outputChunks = [];
    session.outputSize = 0;
    session.dataListeners = new Set();
    session.exitListeners = new Set();
    session.exitCode = null;
    session.destroyed = false;
    session.startPromise = window.electronAPI.terminalCreate(options).then(({ id }) => {
      if (session.destroyed) {
        window.electronAPI.terminalKill(id);
        throw new Error('Terminal session was closed before it finished starting.');
      }

      session.ptyId = id;
      session.dataDisposable = window.electronAPI.terminalOnData(id, (data) => {
        this.appendOutput(session, data);
        session.dataListeners.forEach((listener) => listener(data));
      });
      session.exitDisposable = window.electronAPI.terminalOnExit(id, (code) => {
        session.exitCode = code;
        session.ptyId = null;
        session.exitListeners.forEach((listener) => listener(code));
        session.exitListeners.clear();
        session.dataDisposable?.dispose();
        session.exitDisposable?.dispose();
        session.dataDisposable = null;
        session.exitDisposable = null;
      });
      return id;
    });

    this.sessions.set(sessionId, session);
    return session.startPromise;
  }

  subscribeToData(sessionId: string, listener: DataListener): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) return () => undefined;

    if (session.outputChunks.length > 0) {
      listener(session.outputChunks.join(''));
    }
    session.dataListeners.add(listener);
    return () => session.dataListeners.delete(listener);
  }

  subscribeToExit(sessionId: string, listener: ExitListener): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) return () => undefined;

    if (session.exitCode !== null) listener(session.exitCode);
    else session.exitListeners.add(listener);
    return () => session.exitListeners.delete(listener);
  }

  destroy(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.destroyed = true;
    session.dataDisposable?.dispose();
    session.exitDisposable?.dispose();
    session.dataListeners.clear();
    session.exitListeners.clear();
    if (session.ptyId) {
      window.electronAPI?.terminalKill(session.ptyId);
    }
    this.sessions.delete(sessionId);
    return true;
  }

  private appendOutput(session: ManagedTerminalSession, data: string): void {
    session.outputChunks.push(data);
    session.outputSize += data.length;

    while (
      session.outputSize > MAX_REPLAY_BUFFER_CHARS &&
      session.outputChunks.length > 1
    ) {
      const removed = session.outputChunks.shift();
      session.outputSize -= removed?.length ?? 0;
    }
  }
}

export const terminalSessionManager = new TerminalSessionManager();

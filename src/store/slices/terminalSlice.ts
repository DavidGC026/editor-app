import { StateCreator } from 'zustand';
import { AgentTerminalId, TerminalSession, SidebarPanel, BottomTab } from '../../types';

const AGENT_TERMINAL_CONFIG: Record<AgentTerminalId, { label: string; command: string }> = {
  codex: { label: 'Codex', command: 'codex' },
  claude: { label: 'Claude Code', command: 'claude' },
  'cursor-agent': { label: 'Cursor Agent', command: 'cursor-agent' },
  agy: { label: 'Antigravity', command: 'agy' },
};

function buildTerminalCommand(workspacePath: string | null, command: string): string {
  const trimmed = command.trim();
  const escapedWorkspace = workspacePath?.replace(/"/g, '\\"');
  return escapedWorkspace
    ? ` cd "${escapedWorkspace}" && ${trimmed}\r`
    : ` ${trimmed}\r`;
}

// Minimal dependency interface required from the root store
interface TerminalDependencies {
  workspacePath: string | null;
  agentTerminalDock: 'bottom' | 'sidebar' | 'right';
  activeSidebarPanel: SidebarPanel;
  sidebarVisible: boolean;
  bottomPanelVisible: boolean;
  activeBottomTab: BottomTab;
}

export interface TerminalSlice {
  terminalSessions: TerminalSession[];
  activeTerminalSessionId: string | null;

  ensureTerminalSession: () => string;
  createTerminalSession: (label?: string) => string;
  closeTerminalSession: (sessionId: string) => void;
  setActiveTerminalSession: (sessionId: string) => void;
  registerTerminalPty: (sessionId: string, ptyId: string | null) => void;
  runCommandInTerminalSession: (sessionId: string, command: string) => void;
  runCommandInTerminal: (command: string) => void;
  runAgentInTerminal: (agentId: AgentTerminalId) => void;
  sendCdToActiveTerminal: (workspacePath: string) => void;
}

export const createTerminalSlice: StateCreator<
  TerminalSlice & TerminalDependencies,
  [],
  [],
  TerminalSlice
> = (set, get) => ({
  terminalSessions: [],
  activeTerminalSessionId: null,

  ensureTerminalSession: () => {
    const { terminalSessions } = get();
    if (terminalSessions.length > 0) {
      const active = get().activeTerminalSessionId;
      if (active && terminalSessions.some((s) => s.id === active)) return active;
      return terminalSessions[0].id;
    }
    const id = `term-${Date.now()}`;
    const session: TerminalSession = {
      id,
      label: 'Terminal 1',
      ptyId: null,
      agentId: null,
      pendingCommand: null,
    };
    set({ terminalSessions: [session], activeTerminalSessionId: id });
    return id;
  },

  createTerminalSession: (label?: string) => {
    const count = get().terminalSessions.length;
    const id = `term-${Date.now()}`;
    const session: TerminalSession = {
      id,
      label: label ?? `Terminal ${count + 1}`,
      ptyId: null,
      agentId: null,
      pendingCommand: null,
    };
    set((state) => ({
      terminalSessions: [...state.terminalSessions, session],
      activeTerminalSessionId: id,
      bottomPanelVisible: true,
      activeBottomTab: 'terminal',
    }));
    return id;
  },

  closeTerminalSession: (sessionId: string) => {
    const state = get();
    const session = state.terminalSessions.find((s) => s.id === sessionId);
    if (!session) return;
    if (session.ptyId && window.electronAPI?.terminalKill) {
      try {
        window.electronAPI.terminalKill(session.ptyId);
      } catch {
        /* best-effort */
      }
    }
    const remaining = state.terminalSessions.filter((s) => s.id !== sessionId);
    let nextActive = state.activeTerminalSessionId;
    if (nextActive === sessionId) {
      nextActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    }
    set({ terminalSessions: remaining, activeTerminalSessionId: nextActive });
  },

  setActiveTerminalSession: (sessionId: string) => {
    const session = get().terminalSessions.find((s) => s.id === sessionId);
    const dock = get().agentTerminalDock;
    set({
      activeTerminalSessionId: sessionId,
      ...(session?.agentId && dock === 'sidebar'
        ? { activeSidebarPanel: 'agents' as SidebarPanel, sidebarVisible: true }
        : session?.agentId && dock === 'right'
          ? {}
          : { bottomPanelVisible: true, activeBottomTab: 'terminal' as BottomTab }),
    });
  },

  registerTerminalPty: (sessionId: string, ptyId: string | null) => {
    set((state) => ({
      terminalSessions: state.terminalSessions.map((s) =>
        s.id === sessionId ? { ...s, ptyId } : s,
      ),
    }));
    const session = get().terminalSessions.find((s) => s.id === sessionId);
    if (ptyId && session?.pendingCommand && window.electronAPI?.terminalWrite) {
      const pending = session.pendingCommand;
      window.setTimeout(() => {
        try {
          window.electronAPI.terminalWrite(
            ptyId,
            pending.endsWith('\r') ? pending : `${pending}\r`,
          );
          set({
            terminalSessions: get().terminalSessions.map((s) =>
              s.id === sessionId ? { ...s, pendingCommand: null } : s,
            ),
          });
        } catch (err) {
          console.debug('[forge] terminalWrite (pending) failed:', (err as Error)?.message);
        }
      }, 120);
    }
  },

  runCommandInTerminalSession: (sessionId: string, command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;
    const state = get();
    const fullCommand = buildTerminalCommand(state.workspacePath, trimmed);
    const session = state.terminalSessions.find((s) => s.id === sessionId);

    if (session?.ptyId && window.electronAPI?.terminalWrite) {
      try {
        window.electronAPI.terminalWrite(session.ptyId, fullCommand);
        return;
      } catch (err) {
        console.debug('[forge] terminalWrite failed:', (err as Error)?.message);
      }
    }

    set({
      terminalSessions: state.terminalSessions.map((s) =>
        s.id === sessionId ? { ...s, pendingCommand: fullCommand } : s,
      ),
    });
  },

  runCommandInTerminal: (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;
    set({ bottomPanelVisible: true, activeBottomTab: 'terminal' });
    const state = get();
    const activeNormal = state.terminalSessions.find((s) => (
      s.id === state.activeTerminalSessionId && !s.agentId
    ));
    const firstNormal = state.terminalSessions.find((s) => !s.agentId);
    const sessionId = activeNormal?.id ?? firstNormal?.id ?? get().createTerminalSession();
    get().setActiveTerminalSession(sessionId);
    get().runCommandInTerminalSession(sessionId, trimmed);
  },

  runAgentInTerminal: (agentId: AgentTerminalId) => {
    const cfg = AGENT_TERMINAL_CONFIG[agentId];
    const existing = get().terminalSessions.find((s) => s.agentId === agentId);
    let sessionId: string;
    let isNew = false;

    if (existing) {
      sessionId = existing.id;
    } else {
      sessionId = `term-agent-${agentId}-${Date.now()}`;
      const session: TerminalSession = {
        id: sessionId,
        label: cfg.label,
        ptyId: null,
        agentId,
        pendingCommand: null,
      };
      set((state) => ({
        terminalSessions: [...state.terminalSessions, session],
      }));
      isNew = true;
    }

    const dock = get().agentTerminalDock;
    set({
      activeTerminalSessionId: sessionId,
      ...(dock === 'sidebar'
        ? { activeSidebarPanel: 'agents' as SidebarPanel, sidebarVisible: true }
        : dock === 'right'
          ? {}
        : { bottomPanelVisible: true, activeBottomTab: 'terminal' as BottomTab }),
    });

    if (isNew) {
      get().runCommandInTerminalSession(sessionId, cfg.command);
    }
  },

  sendCdToActiveTerminal: (workspacePath: string) => {
    if (!workspacePath || !window.electronAPI?.terminalWrite) return;
    const escaped = workspacePath.replace(/"/g, '\\"');
    const command = ` cd "${escaped}"\r`;
    for (const session of get().terminalSessions) {
      if (!session.ptyId) continue;
      try {
        window.electronAPI.terminalWrite(session.ptyId, command);
      } catch (err) {
        console.debug('[forge] terminalWrite (cd) failed:', (err as Error)?.message);
      }
    }
  },
});

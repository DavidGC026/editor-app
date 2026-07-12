import { useStore } from '../../store';
import { FileCode2, Sparkles, Bot, Orbit, Terminal as TerminalIcon } from 'lucide-react';
import { TerminalsPanel } from '../BottomPanel';
import React from 'react';

function PanelBottomIcon() {
  return <span className="inline-block w-[13px] h-[13px] border border-current rounded-sm border-l-[4px]" />;
}

function PanelIcon({ dock }: { dock: 'bottom' | 'sidebar' | 'right' }) {
  if (dock === 'sidebar') return <PanelBottomIcon />;
  if (dock === 'right') return <span className="inline-block w-[13px] h-[13px] border border-current rounded-sm border-r-[4px]" />;
  return <TerminalIcon size={13} />;
}

export default function AgentsPanel() {
  const runAgentInTerminal = useStore((s) => s.runAgentInTerminal);
  const agentTerminalDock = useStore((s) => s.agentTerminalDock);
  const setAgentTerminalDock = useStore((s) => s.setAgentTerminalDock);
  const terminalSessions = useStore((s) => s.terminalSessions);
  const agentSessions = terminalSessions.filter((session) => session.agentId);

  const agents: Array<{
    id: import('../../types').AgentTerminalId;
    label: string;
    command: string;
    icon: React.ReactNode;
  }> = [
    { id: 'codex', label: 'Codex', command: 'codex', icon: <FileCode2 size={14} /> },
    { id: 'claude', label: 'Claude Code', command: 'claude', icon: <Sparkles size={14} /> },
    { id: 'cursor-agent', label: 'Cursor Agent', command: 'cursor-agent', icon: <Bot size={14} /> },
    { id: 'agy', label: 'Antigravity', command: 'agy', icon: <Orbit size={14} /> },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
        <span>Agents</span>
        <button
          onClick={() => setAgentTerminalDock(agentTerminalDock === 'right' ? 'bottom' : 'right')}
          title={agentTerminalDock === 'right' ? 'Move agent terminals to bottom' : 'Move agent terminals to right side'}
          className="text-forge-text hover:text-forge-accent"
        >
          <PanelIcon dock={agentTerminalDock} />
        </button>
      </div>

      <div className="px-3 pb-3 flex-shrink-0">
        <div className="grid grid-cols-2 gap-2">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => runAgentInTerminal(agent.id)}
              className="min-h-[58px] rounded border border-forge-border/50 bg-forge-input/35 hover:bg-forge-accent/10 hover:border-forge-accent/35 px-2 py-2 text-left transition-colors"
            >
              <span className="flex items-center gap-2 text-[12px] text-forge-text-strong">
                <span className="text-forge-accent">{agent.icon}</span>
                <span className="truncate">{agent.label}</span>
              </span>
              <span className="block mt-1 text-[10px] text-forge-text/45 truncate">
                {agent.command}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex rounded border border-forge-border/50 overflow-hidden text-[11px]">
          <button
            onClick={() => setAgentTerminalDock('right')}
            className={`flex-1 py-1.5 ${agentTerminalDock === 'right' ? 'bg-forge-accent/15 text-forge-accent' : 'text-forge-text/60 hover:text-forge-text'}`}
          >
            Right
          </button>
          <button
            onClick={() => setAgentTerminalDock('sidebar')}
            className={`flex-1 py-1.5 border-l border-forge-border/50 ${agentTerminalDock === 'sidebar' ? 'bg-forge-accent/15 text-forge-accent' : 'text-forge-text/60 hover:text-forge-text'}`}
          >
            Sidebar
          </button>
          <button
            onClick={() => setAgentTerminalDock('bottom')}
            className={`flex-1 py-1.5 border-l border-forge-border/50 ${agentTerminalDock === 'bottom' ? 'bg-forge-accent/15 text-forge-accent' : 'text-forge-text/60 hover:text-forge-text'}`}
          >
            Bottom
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 border-t border-forge-border/40 relative overflow-hidden">
        {agentTerminalDock === 'sidebar' ? (
          <TerminalsPanel
            visible
            kind="agents"
            showNew={false}
            empty={
              <div className="px-4 text-center leading-snug">
                <div className="text-forge-text/60">No agent terminal running.</div>
                <div className="mt-1 text-forge-text/35">Start Codex, Claude, Cursor or Antigravity.</div>
              </div>
            }
          />
        ) : agentTerminalDock === 'right' ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center text-forge-text/55 text-[12px]">
            <TerminalIcon size={28} />
            <p>Agent terminals are docked on the right side.</p>
            <p className="text-[11px] text-forge-text/35">
              Active agent sessions: {agentSessions.length}
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center text-forge-text/55 text-[12px]">
            <TerminalIcon size={28} />
            <p>Agent terminals are docked in the bottom panel.</p>
            <p className="text-[11px] text-forge-text/35">
              Active agent sessions: {agentSessions.length}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

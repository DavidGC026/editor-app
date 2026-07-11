import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { X, Terminal as TerminalIcon, AlertTriangle, FileOutput, Bug, Plus } from 'lucide-react';
import type { BottomTab, Problem, TerminalSession } from '../types';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';

interface PanelTab {
  id: BottomTab;
  label: string;
  icon: React.ReactNode;
}

const tabs: PanelTab[] = [
  { id: 'terminal', label: 'TERMINAL', icon: <TerminalIcon size={13} /> },
  { id: 'problems', label: 'PROBLEMS', icon: <AlertTriangle size={13} /> },
  { id: 'output', label: 'OUTPUT', icon: <FileOutput size={13} /> },
  { id: 'debug', label: 'DEBUG CONSOLE', icon: <Bug size={13} /> },
];

function relativePath(workspacePath: string | null, filePath: string): string {
  if (!workspacePath) return filePath;
  const root = workspacePath.replace(/\\/g, '/');
  const file = filePath.replace(/\\/g, '/');
  if (file.startsWith(root + '/')) return file.slice(root.length + 1);
  return filePath;
}

function severityLabel(problem: Problem): string {
  if (problem.severity === 1) return 'Error';
  if (problem.severity === 2) return 'Warning';
  if (problem.severity === 3) return 'Info';
  return 'Hint';
}

function severityColor(problem: Problem): string {
  if (problem.severity === 1) return '#FF5370';
  if (problem.severity === 2) return '#FFCB6B';
  if (problem.severity === 3) return '#89DDFF';
  return '#A1A3AF';
}

function ProblemsView() {
  const problems = useStore((s) => s.problems);
  const workspacePath = useStore((s) => s.workspacePath);
  const openFilePath = useStore((s) => s.openFilePath);

  if (problems.length === 0) {
    return (
      <div className="h-full flex items-center px-3 font-mono text-[13px] text-forge-text/70">
        No problems detected in workspace.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto sidebar-scroll p-2 font-mono text-[12px] text-forge-text">
      {problems.map((problem, index) => (
        <button
          key={`${problem.filePath}:${problem.startLine}:${problem.startColumn}:${index}`}
          onClick={() => void openFilePath(problem.filePath, { line: problem.startLine })}
          className="w-full flex items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-white/5 transition-colors"
        >
          <AlertTriangle
            size={13}
            className="mt-0.5 flex-shrink-0"
            style={{ color: severityColor(problem) }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{problem.message}</span>
            <span className="block text-[11px] text-forge-text/45 truncate">
              {relativePath(workspacePath, problem.filePath)}:{problem.startLine}:{problem.startColumn}
              {' · '}
              {severityLabel(problem)}
              {problem.code ? ` · ${problem.code}` : ''}
              {problem.source ? ` · ${problem.source}` : ''}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function TerminalSessionTabs({
  sessions,
  activeSessionId,
  onSelect,
  onClose,
  onNew,
}: {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="h-[28px] flex items-center gap-0.5 px-1 border-b border-forge-border/30 bg-[#1A1B20] overflow-x-auto sidebar-scroll flex-shrink-0">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;
        return (
          <div
            key={session.id}
            className={`group flex items-center gap-1 h-[24px] px-2 rounded text-[11px] cursor-pointer flex-shrink-0 transition-colors
              ${isActive
                ? 'bg-forge-accent/15 text-forge-accent'
                : 'text-forge-text/60 hover:bg-white/5 hover:text-forge-text'}
            `}
            onClick={() => onSelect(session.id)}
          >
            <TerminalIcon size={11} />
            <span className="truncate max-w-[120px]">{session.label}</span>
            {sessions.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(session.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-forge-text-strong"
                title="Close terminal"
              >
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onNew}
        title="New terminal"
        className="h-[24px] w-[24px] flex items-center justify-center rounded text-forge-text/50 hover:text-forge-accent hover:bg-white/5 flex-shrink-0"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

function XTermView({ sessionId, visible }: { sessionId: string; visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const disposablesRef = useRef<{ dispose: () => void }[]>([]);
  const initializedRef = useRef(false);
  const fitPendingRef = useRef(false);
  const workspacePath = useStore((s) => s.workspacePath);
  const editorFontSize = useStore((s) => s.editorFontSize);
  const registerTerminalPty = useStore((s) => s.registerTerminalPty);
  const [error, setError] = useState<string | null>(null);

  const safeFit = () => {
    const fit = fitRef.current;
    const container = containerRef.current;
    const term = termRef.current;
    if (!fit || !container || !term) return;
    if (container.offsetWidth <= 0 || container.offsetHeight <= 0) return;
    const rect = container.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const core = (term as unknown as { _core?: { _renderService?: { dimensions?: unknown } } })._core;
    if (!core || !core._renderService || !core._renderService.dimensions) return;
    try {
      fit.fit();
    } catch (err) {
      console.debug('[forge] xterm fit skipped:', (err as Error)?.message);
    }
  };

  const debouncedFit = () => {
    if (fitPendingRef.current) return;
    fitPendingRef.current = true;
    requestAnimationFrame(() => {
      fitPendingRef.current = false;
      safeFit();
    });
  };

  useEffect(() => {
    if (!containerRef.current) return;
    if (initializedRef.current) return;
    initializedRef.current = true;

    const term = new Terminal({
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: Math.max(8, editorFontSize - 1),
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      cols: 80,
      rows: 24,
      theme: {
        background: '#1F2025',
        foreground: '#B1B4BC',
        cursor: '#B65A48',
        cursorAccent: '#1F2025',
        selectionBackground: '#B65A4844',
        black: '#1F2025',
        brightBlack: '#5A5F6E',
        red: '#FF5370',
        brightRed: '#FF8B98',
        green: '#73C6A5',
        brightGreen: '#9AE7C5',
        yellow: '#FFCB6B',
        brightYellow: '#FFE082',
        blue: '#82AAFF',
        brightBlue: '#A8C5FF',
        magenta: '#C792EA',
        brightMagenta: '#DDB3F2',
        cyan: '#89DDFF',
        brightCyan: '#A8E5FF',
        white: '#D0D3DA',
        brightWhite: '#FFFFFF',
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    requestAnimationFrame(() => safeFit());
    const fitTimer1 = setTimeout(() => safeFit(), 60);
    const fitTimer2 = setTimeout(() => safeFit(), 250);
    const fitTimer3 = setTimeout(() => safeFit(), 500);

    let cancelled = false;

    (async () => {
      if (!window.electronAPI?.terminalCreate) {
        setError('Terminal API not available — run inside Electron.');
        return;
      }
      try {
        safeFit();
        const cols = term.cols || 80;
        const rows = term.rows || 24;
        const { id } = await window.electronAPI.terminalCreate({
          cwd: workspacePath || undefined,
          cols,
          rows,
        });
        if (cancelled) {
          window.electronAPI.terminalKill(id);
          return;
        }
        ptyIdRef.current = id;
        registerTerminalPty(sessionId, id);

        const dataDisp = window.electronAPI.terminalOnData(id, (data) => {
          term.write(data);
        });
        const exitDisp = window.electronAPI.terminalOnExit(id, (code) => {
          term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`);
        });
        disposablesRef.current.push(dataDisp, exitDisp);

        const inputDisp = term.onData((data) => {
          if (ptyIdRef.current) {
            window.electronAPI.terminalWrite(ptyIdRef.current, data);
          }
        });
        disposablesRef.current.push({ dispose: () => inputDisp.dispose() });

        const resizeDisp = term.onResize(({ cols, rows }) => {
          if (ptyIdRef.current && cols > 0 && rows > 0) {
            window.electronAPI.terminalResize(ptyIdRef.current, cols, rows);
          }
        });
        disposablesRef.current.push({ dispose: () => resizeDisp.dispose() });

        setTimeout(() => safeFit(), 100);
      } catch (err) {
        console.error(err);
        setError(`Failed to start terminal: ${(err as Error).message}`);
      }
    })();

    const observer = new ResizeObserver(() => {
      try {
        debouncedFit();
      } catch (err) {
        console.debug('[forge] ResizeObserver fit error:', (err as Error)?.message);
      }
    });
    observer.observe(containerRef.current);

    const pasteFromClipboard = async () => {
      try {
        if (!window.electronAPI?.readClipboard) return;
        const text = await window.electronAPI.readClipboard();
        if (!text || !ptyIdRef.current) return;
        window.electronAPI.terminalWrite(ptyIdRef.current, text);
      } catch (err) {
        console.debug('[forge] clipboard paste failed:', (err as Error)?.message);
      }
    };

    const handlePasteKey = (e: KeyboardEvent) => {
      const isPaste =
        (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'v' || e.key === 'V');
      if (!isPaste) return;
      e.preventDefault();
      e.stopPropagation();
      void pasteFromClipboard();
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      void pasteFromClipboard();
    };

    const container = containerRef.current;
    container.addEventListener('keydown', handlePasteKey, true);
    container.addEventListener('contextmenu', handleContextMenu);

    return () => {
      cancelled = true;
      clearTimeout(fitTimer1);
      clearTimeout(fitTimer2);
      clearTimeout(fitTimer3);
      try { container.removeEventListener('keydown', handlePasteKey, true); } catch { /* noop */ }
      try { container.removeEventListener('contextmenu', handleContextMenu); } catch { /* noop */ }
      try { observer.disconnect(); } catch { /* noop */ }
      disposablesRef.current.forEach((d) => {
        try { d.dispose(); } catch { /* noop */ }
      });
      disposablesRef.current = [];
      if (ptyIdRef.current && window.electronAPI?.terminalKill) {
        window.electronAPI.terminalKill(ptyIdRef.current);
      }
      ptyIdRef.current = null;
      try { registerTerminalPty(sessionId, null); } catch { /* noop */ }
      try { term.dispose(); } catch { /* noop */ }
      termRef.current = null;
      fitRef.current = null;
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!visible) return;
    const r1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        safeFit();
        try { termRef.current?.focus(); } catch { /* noop */ }
      });
    });
    const lateFit = setTimeout(() => safeFit(), 100);
    return () => {
      cancelAnimationFrame(r1);
      clearTimeout(lateFit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = Math.max(8, editorFontSize - 1);
    debouncedFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorFontSize]);

  return (
    <div className="w-full h-full bg-[#1F2025] relative overflow-hidden">
      {error && (
        <div className="absolute top-2 left-2 right-2 text-[12px] text-[#FF5370] bg-[#2A1A1F] border border-[#FF5370]/30 px-2 py-1 rounded z-10">
          {error}
        </div>
      )}
      <div className="absolute inset-0 px-2 py-1">
        <div
          ref={containerRef}
          className="w-full h-full"
          style={{ color: '#B1B4BC', backgroundColor: '#1F2025' }}
        />
      </div>
    </div>
  );
}

function TerminalsPanel() {
  const terminalSessions = useStore((s) => s.terminalSessions);
  const activeTerminalSessionId = useStore((s) => s.activeTerminalSessionId);
  const activeBottomTab = useStore((s) => s.activeBottomTab);
  const ensureTerminalSession = useStore((s) => s.ensureTerminalSession);
  const createTerminalSession = useStore((s) => s.createTerminalSession);
  const closeTerminalSession = useStore((s) => s.closeTerminalSession);
  const setActiveTerminalSession = useStore((s) => s.setActiveTerminalSession);

  useEffect(() => {
    if (terminalSessions.length === 0) {
      ensureTerminalSession();
    }
  }, [terminalSessions.length, ensureTerminalSession]);

  const visible = activeBottomTab === 'terminal';
  const sessions = terminalSessions;
  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-forge-text/50 text-[12px]">
        Starting terminal…
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <TerminalSessionTabs
        sessions={sessions}
        activeSessionId={activeTerminalSessionId}
        onSelect={setActiveTerminalSession}
        onClose={closeTerminalSession}
        onNew={() => createTerminalSession()}
      />
      <div className="flex-1 min-h-0 relative">
        {terminalSessions.map((session) => (
          <div
            key={session.id}
            className="absolute inset-0"
            style={{
              display:
                visible && session.id === activeTerminalSessionId ? 'block' : 'none',
            }}
          >
            <XTermView
              sessionId={session.id}
              visible={visible && session.id === activeTerminalSessionId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BottomPanel() {
  const activeBottomTab = useStore((s) => s.activeBottomTab);
  const setBottomTab = useStore((s) => s.setBottomTab);
  const togglePanel = useStore((s) => s.togglePanel);
  const bottomPanelHeight = useStore((s) => s.bottomPanelHeight);

  return (
    <div
      className="flex-shrink-0 border-t border-forge-border/50 bg-forge-terminal flex flex-col"
      style={{ height: `${bottomPanelHeight}px` }}
    >
      <div className="h-[32px] flex items-center justify-between px-2 bg-forge-titlebar border-b border-forge-border/40 select-none">
        <div className="flex items-center gap-0">
          {tabs.map((tab) => {
            const isActive = tab.id === activeBottomTab;
            return (
              <button
                key={tab.id}
                onClick={() => setBottomTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 h-[32px] text-[11px] uppercase tracking-wider border-b-2 transition-colors
                  ${isActive
                    ? 'text-forge-text-strong border-forge-accent'
                    : 'text-forge-text border-transparent hover:text-forge-text-strong'}
                `}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={togglePanel}
          className="p-1 hover:bg-white/10 rounded transition-colors"
          title="Close panel"
        >
          <X size={15} className="text-forge-text" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div
          className="absolute inset-0 flex flex-col"
          style={{ display: activeBottomTab === 'terminal' ? 'flex' : 'none' }}
        >
          <TerminalsPanel />
        </div>

        {activeBottomTab === 'problems' && (
          <div className="absolute inset-0">
            <ProblemsView />
          </div>
        )}
        {activeBottomTab === 'output' && (
          <div className="absolute inset-0 p-3 font-mono text-[13px] text-forge-text">
            Output channel is empty.
          </div>
        )}
        {activeBottomTab === 'debug' && (
          <div className="absolute inset-0 p-3 font-mono text-[13px] text-forge-text">
            Debug console is ready.
          </div>
        )}
      </div>
    </div>
  );
}

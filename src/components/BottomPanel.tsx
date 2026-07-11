import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { X, Terminal as TerminalIcon, AlertTriangle, FileOutput, Bug } from 'lucide-react';
import type { BottomTab, Problem } from '../types';
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
            <span className="block truncate">
              {problem.message}
            </span>
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

// ─────────────────────────────────────────────────────────────────────────
// XTerm-powered Terminal
// ─────────────────────────────────────────────────────────────────────────
function XTermView({ visible }: { visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const disposablesRef = useRef<{ dispose: () => void }[]>([]);
  const initializedRef = useRef(false);
  // Tracks whether a fit() has already been scheduled for the next animation
  // frame. Used by `debouncedFit` to coalesce the burst of ResizeObserver
  // callbacks fired while the user is dragging a divider — without this the
  // terminal re-renders (and visibly flickers) on every pixel of movement.
  const fitPendingRef = useRef(false);
  const workspacePath = useStore((s) => s.workspacePath);
  const editorFontSize = useStore((s) => s.editorFontSize);
  const setActiveTerminalId = useStore((s) => s.setActiveTerminalId);
  const [error, setError] = useState<string | null>(null);

  // Safe fit helper — guards against:
  //   1. Missing fit addon / container / terminal references.
  //   2. Zero-sized containers (cause FitAddon to produce 0 cols/rows or
  //      throw).
  //   3. xterm's renderer not yet being initialized (`_renderService`
  //      undefined) which throws "Cannot read properties of undefined
  //      (reading 'dimensions')" deep inside Viewport.syncScrollArea /
  //      _innerRefresh on the very first paint.
  // All errors are swallowed so a stray fit attempt never crashes the
  // renderer; the next ResizeObserver / visibility tick will retry.
  const safeFit = () => {
    const fit = fitRef.current;
    const container = containerRef.current;
    const term = termRef.current;
    if (!fit || !container || !term) return;

    // Container must be physically laid out and visible.
    if (container.offsetWidth <= 0 || container.offsetHeight <= 0) return;
    const rect = container.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    // xterm's renderer is created asynchronously after term.open(). FitAddon
    // and the Viewport both reach into `term._core._renderService.dimensions`,
    // which is undefined until the renderer has run its first frame. Skip
    // until it exists — a later refit will pick it up.
    const core = (term as unknown as { _core?: { _renderService?: { dimensions?: unknown } } })._core;
    if (!core || !core._renderService || !core._renderService.dimensions) return;

    try {
      fit.fit();
    } catch (err) {
      // Never let a fit error escape — it would crash the React tree.
      // eslint-disable-next-line no-console
      console.debug('[forge] xterm fit skipped:', (err as Error)?.message);
    }
  };

  // Coalesces multiple fit requests into a single rAF-aligned call.
  // ResizeObserver can fire dozens of times per second while the user drags
  // the sidebar or terminal divider. Calling fit() on every pixel causes the
  // xterm renderer to repaint mid-frame and produces a visible flicker. By
  // gating on `fitPendingRef`, we guarantee at most one fit() per animation
  // frame regardless of how many times debouncedFit() is invoked.
  const debouncedFit = () => {
    if (fitPendingRef.current) return;
    fitPendingRef.current = true;
    requestAnimationFrame(() => {
      fitPendingRef.current = false;
      safeFit();
    });
  };

  // Initialize xterm + connect to pty (only once per mount)
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
      // Reasonable defaults so the renderer has something to draw before fit.
      cols: 80,
      rows: 24,
      theme: {
        background: '#1F2025',
        foreground: '#B1B4BC',
        cursor: '#4ADB94',
        cursorAccent: '#1F2025',
        selectionBackground: '#4ADB9444',
        black: '#1F2025',
        brightBlack: '#5A5F6E',
        red: '#FF5370',
        brightRed: '#FF8B98',
        green: '#4ADB94',
        brightGreen: '#7AE5B4',
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

    // Defer fit() across multiple ticks to give xterm's renderer a chance
    // to initialize before FitAddon (and Viewport) try to read dimensions.
    // Each call is individually safe — see safeFit().
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
        // Make sure we have current cols/rows after fitting
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
        // Register the pty id globally so other store actions (e.g. `cd` on
        // workspace open) can write to it.
        setActiveTerminalId(id);

        // pty -> xterm
        const dataDisp = window.electronAPI.terminalOnData(id, (data) => {
          term.write(data);
        });
        // pty exit -> xterm message
        const exitDisp = window.electronAPI.terminalOnExit(id, (code) => {
          term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`);
        });
        disposablesRef.current.push(dataDisp, exitDisp);

        // xterm -> pty
        const inputDisp = term.onData((data) => {
          if (ptyIdRef.current) {
            window.electronAPI.terminalWrite(ptyIdRef.current, data);
          }
        });
        disposablesRef.current.push({ dispose: () => inputDisp.dispose() });

        // Resize -> pty
        const resizeDisp = term.onResize(({ cols, rows }) => {
          if (ptyIdRef.current && cols > 0 && rows > 0) {
            window.electronAPI.terminalResize(ptyIdRef.current, cols, rows);
          }
        });
        disposablesRef.current.push({ dispose: () => resizeDisp.dispose() });

        // Final fit after IPC is wired so the pty gets the correct size.
        // Use a small timeout so the renderer has time to settle.
        setTimeout(() => safeFit(), 100);
      } catch (err) {
        console.error(err);
        setError(`Failed to start terminal: ${(err as Error).message}`);
      }
    })();

    // Refit on container resize (covers panel toggle, window resize, and
    // — most importantly — divider drags). The handler is debounced through
    // `debouncedFit` so that a burst of ResizeObserver callbacks (one per
    // pixel while dragging a divider) collapses into a single fit() per
    // animation frame. Without this, xterm repaints continuously and the
    // terminal visibly flickers during a drag.
    // The callback itself is wrapped in try/catch so a transient error
    // never bubbles out of the observer.
    const observer = new ResizeObserver(() => {
      try {
        debouncedFit();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.debug('[forge] ResizeObserver fit error:', (err as Error)?.message);
      }
    });
    observer.observe(containerRef.current);

    // ── Clipboard paste (Ctrl+V / Cmd+V and right-click) ──────────────
    // xterm.js intercepts most keystrokes via its own input layer, which
    // means a normal window-level keydown handler still fires *after*
    // xterm has eaten the event. We bind on the container with capture so
    // we can hijack Ctrl+V (Cmd+V on macOS) before xterm processes it.
    const pasteFromClipboard = async () => {
      try {
        if (!window.electronAPI?.readClipboard) return;
        const text = await window.electronAPI.readClipboard();
        if (!text) return;
        if (ptyIdRef.current) {
          window.electronAPI.terminalWrite(ptyIdRef.current, text);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.debug('[forge] clipboard paste failed:', (err as Error)?.message);
      }
    };

    const handlePasteKey = (e: KeyboardEvent) => {
      const isPaste =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'v' || e.key === 'V');
      if (!isPaste) return;
      e.preventDefault();
      e.stopPropagation();
      void pasteFromClipboard();
    };

    const handleContextMenu = (e: MouseEvent) => {
      // Right-click paste mirrors the Windows Terminal / cmd.exe behaviour
      // most developers expect inside an integrated terminal.
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
      // Clear the registered terminal id so future cd-on-open calls no-op.
      try { setActiveTerminalId(null); } catch { /* noop */ }
      try {
        term.dispose();
      } catch { /* noop */ }
      termRef.current = null;
      fitRef.current = null;
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refit + focus when becoming visible (terminal tab activated).
  // We schedule fits across two animation frames AND a 100ms timeout so the
  // browser has time to: (a) un-hide the container, (b) lay it out, and
  // (c) let xterm's renderer paint a frame before FitAddon reads dimensions.
  useEffect(() => {
    if (!visible) return;
    const cleanupFrame: { id: number | null } = { id: null };
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => {
        safeFit();
        try { termRef.current?.focus(); } catch { /* noop */ }
      });
      cleanupFrame.id = r2;
    });
    cleanupFrame.id = r1;
    const lateFit = setTimeout(() => safeFit(), 100);
    return () => {
      if (cleanupFrame.id != null) cancelAnimationFrame(cleanupFrame.id);
      clearTimeout(lateFit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Keep terminal font size in sync with editor zoom.
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
      {/* Outer padding wrapper so the inner ref-div fills 100% with no padding */}
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

// ─────────────────────────────────────────────────────────────────────────
// Bottom Panel root
// ─────────────────────────────────────────────────────────────────────────
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
      {/* Tab Header */}
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

      {/* Panel Content */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {/* Terminal stays mounted (display:none when inactive) so the pty
            stays alive when switching tabs. */}
        <div
          className="absolute inset-0"
          style={{ display: activeBottomTab === 'terminal' ? 'block' : 'none' }}
        >
          <XTermView visible={activeBottomTab === 'terminal'} />
        </div>

        {activeBottomTab === 'problems' && (
          <ProblemsView />
        )}
        {activeBottomTab === 'output' && (
          <div className="p-3 font-mono text-[13px] text-forge-text">
            Output channel is empty.
          </div>
        )}
        {activeBottomTab === 'debug' && (
          <div className="p-3 font-mono text-[13px] text-forge-text">
            Debug console is ready.
          </div>
        )}
      </div>
    </div>
  );
}

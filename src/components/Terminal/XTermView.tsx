import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from 'xterm';
import { terminalSessionManager } from '../../services/terminalSessionManager';
import { useStore } from '../../store';

interface XTermViewProps {
  sessionId: string;
  visible: boolean;
}

export default function XTermView({ sessionId, visible }: XTermViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
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
    if (!core?._renderService?.dimensions) return;
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
    const container = containerRef.current;
    if (!container) return;

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
        background: '#1F2025', foreground: '#B1B4BC', cursor: '#E52E3D',
        cursorAccent: '#1F2025', selectionBackground: '#E52E3D44', black: '#1F2025',
        brightBlack: '#5A5F6E', red: '#FF5370', brightRed: '#FF8B98', green: '#73C6A5',
        brightGreen: '#9AE7C5', yellow: '#FFCB6B', brightYellow: '#FFE082', blue: '#82AAFF',
        brightBlue: '#A8C5FF', magenta: '#C792EA', brightMagenta: '#DDB3F2', cyan: '#89DDFF',
        brightCyan: '#A8E5FF', white: '#D0D3DA', brightWhite: '#FFFFFF',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    const fitTimers = [60, 250, 500].map((delay) => window.setTimeout(safeFit, delay));
    const observer = new ResizeObserver(debouncedFit);
    observer.observe(container);
    let disposed = false;
    let unsubscribeData: () => void = () => undefined;
    let unsubscribeExit: () => void = () => undefined;

    void terminalSessionManager.start(sessionId, {
      cwd: workspacePath || undefined,
      cols: term.cols || 80,
      rows: term.rows || 24,
    }).then((ptyId) => {
      if (disposed) return;
      ptyIdRef.current = ptyId;
      registerTerminalPty(sessionId, ptyId);
      unsubscribeData = terminalSessionManager.subscribeToData(sessionId, (data) => term.write(data));
      unsubscribeExit = terminalSessionManager.subscribeToExit(sessionId, (code) => {
        ptyIdRef.current = null;
        registerTerminalPty(sessionId, null);
        term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`);
      });
      safeFit();
    }).catch((err) => {
      if (!disposed) setError(`Failed to start terminal: ${(err as Error).message}`);
    });

    const inputDisposable = term.onData((data) => {
      if (ptyIdRef.current) window.electronAPI.terminalWrite(ptyIdRef.current, data);
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ptyIdRef.current && cols > 0 && rows > 0) {
        window.electronAPI.terminalResize(ptyIdRef.current, cols, rows);
      }
    });

    const pasteFromClipboard = async () => {
      try {
        const text = await window.electronAPI?.readClipboard?.();
        if (text && ptyIdRef.current) window.electronAPI.terminalWrite(ptyIdRef.current, text);
      } catch (err) {
        console.debug('[forge] clipboard paste failed:', (err as Error)?.message);
      }
    };
    const handlePasteKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'v') return;
      event.preventDefault();
      event.stopPropagation();
      void pasteFromClipboard();
    };
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      void pasteFromClipboard();
    };
    container.addEventListener('keydown', handlePasteKey, true);
    container.addEventListener('contextmenu', handleContextMenu);

    return () => {
      disposed = true;
      fitTimers.forEach(window.clearTimeout);
      observer.disconnect();
      container.removeEventListener('keydown', handlePasteKey, true);
      container.removeEventListener('contextmenu', handleContextMenu);
      unsubscribeData();
      unsubscribeExit();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      ptyIdRef.current = null;
      // Deliberately do not kill or unregister the PTY here. A React unmount
      // is a presentation change, not an explicit terminal close.
    };
    // A session keeps the workspace it was created in for its whole lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      safeFit();
      termRef.current?.focus();
    }));
    const timer = window.setTimeout(safeFit, 100);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = Math.max(8, editorFontSize - 1);
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
        <div ref={containerRef} className="w-full h-full text-[#B1B4BC] bg-[#1F2025]" />
      </div>
    </div>
  );
}

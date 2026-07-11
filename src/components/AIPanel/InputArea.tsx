import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  Slash,
  File as FileIcon,
  Folder as FolderIcon,
  FolderOpen,
  Square,
} from 'lucide-react';
import { useStore } from '../../store';
import { runUserPrompt } from '../../ai/runtime';

const COMMANDS = [
  {
    name: '/init',
    description:
      'Analiza el proyecto y genera PROJECT.md (requerido antes de usar el agente).',
  },
  {
    name: '/clear',
    description: 'Borra la conversación actual y vuelve al estado inicial.',
  },
];

export default function InputArea() {
  const workspacePath = useStore((s) => s.workspacePath);
  const selectedPath = useStore((s) => s.selectedPath);
  const selectedKind = useStore((s) => s.selectedKind);
  const status = useStore((s) => s.aiStatus);
  const activeProvider = useStore((s) => s.aiActiveProvider);
  const activeModel = useStore((s) => s.aiActiveModel);
  const initDone = useStore((s) => s.aiInitDone);
  const setApiKeyModalOpen = useStore((s) => s.setAIApiKeyModalOpen);

  const [text, setText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close commands menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  // Auto-grow the textarea (max ~6 lines).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, [text]);

  const contextLabel = useMemo(() => {
    if (!workspacePath) return 'Sin proyecto abierto';
    if (!selectedPath) {
      // root folder
      const segments = workspacePath.split(/[\\/]/).filter(Boolean);
      return segments[segments.length - 1] || workspacePath;
    }
    const segments = selectedPath.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] || selectedPath;
  }, [workspacePath, selectedPath]);

  const contextKind: 'file' | 'directory' | 'root' = !selectedPath
    ? 'root'
    : selectedKind === 'directory'
    ? 'directory'
    : 'file';

  const noProvider = !activeProvider || !activeModel;
  const noWorkspace = !workspacePath;
  const busy = status !== 'idle';
  const disabled = noProvider || noWorkspace || busy;

  const placeholder = !workspacePath
    ? 'Abre primero un proyecto desde el panel izquierdo…'
    : noProvider
    ? 'Configura una clave de API para empezar a chatear…'
    : !initDone
    ? 'Ejecuta /init para inicializar el agente en este proyecto…'
    : 'Pregunta o pide cambios al agente… (Enter para enviar, Shift+Enter para nueva línea)';

  const handleSend = () => {
    if (disabled) return;
    const value = text;
    setText('');
    void runUserPrompt(value);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCommand = (cmd: string) => {
    setText(cmd);
    setMenuOpen(false);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  // Aborts any in-flight stream by signalling the runtime. Best-effort.
  const handleStop = () => {
    // No streamId here — but we can call abort on every active stream via
    // the store's status. The runtime moves to 'idle' once the stream errors.
    // For now we simply revert UI state; in-flight requests will resolve.
    useStore.getState().setAIStatus('idle');
  };

  return (
    <div className="border-t border-forge-border bg-forge-sidebar">
      {/* Textarea row */}
      <div className="px-2 pt-2 pb-1 flex gap-2 items-end relative">
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="Comandos"
            className="h-7 w-7 rounded flex items-center justify-center text-forge-text hover:text-forge-text-strong hover:bg-white/5"
          >
            <Slash size={14} />
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              className="dropdown-menu absolute bottom-9 left-0 z-50 min-w-[260px]"
            >
              {COMMANDS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => handleCommand(c.name)}
                  className="block w-full text-left px-3 py-2 hover:bg-forge-accent/15 hover:text-forge-accent transition-colors"
                >
                  <div className="text-[13px] text-forge-text-menu font-medium">
                    {c.name}
                  </div>
                  <div className="text-[11px] text-forge-text-dim leading-snug mt-0.5">
                    {c.description}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          rows={1}
          className="flex-1 resize-none px-3 py-2 rounded text-[13px] bg-forge-input text-forge-text outline-none border border-forge-border focus:border-forge-accent leading-snug"
          style={{ maxHeight: 140 }}
        />

        {busy ? (
          <button
            onClick={handleStop}
            title="Detener"
            className="h-7 w-7 rounded flex items-center justify-center bg-forge-input border border-forge-border text-forge-text hover:text-forge-text-strong"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={disabled || text.trim().length === 0}
            title="Enviar"
            className={`h-7 w-7 rounded flex items-center justify-center transition-colors
              ${disabled || text.trim().length === 0
                ? 'bg-forge-input text-forge-text-dim cursor-not-allowed'
                : 'bg-forge-accent text-black hover:opacity-90'}
            `}
          >
            <Send size={14} />
          </button>
        )}
      </div>

      {/* Bottom: context bar */}
      <div className="px-3 py-1.5 border-t border-forge-border/60 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0 text-forge-text-dim">
          {contextKind === 'file' ? (
            <FileIcon size={11} />
          ) : contextKind === 'directory' ? (
            <FolderIcon size={11} />
          ) : (
            <FolderOpen size={11} />
          )}
          <span className="text-forge-text-dim flex-shrink-0">Contexto:</span>
          <span className="text-forge-text truncate" title={selectedPath || workspacePath || ''}>
            {contextLabel}
          </span>
          {contextKind === 'root' && workspacePath && (
            <span className="text-forge-text-dim flex-shrink-0">(raíz del proyecto)</span>
          )}
        </div>
        {!noProvider && workspacePath && initDone && (
          <span className="text-forge-text-dim flex-shrink-0">
            {busy ? 'Trabajando…' : 'Listo'}
          </span>
        )}
        {!initDone && workspacePath && !noProvider && (
          <span className="text-forge-accent flex-shrink-0">/init requerido</span>
        )}
        {noProvider && (
          <button
            onClick={() => setApiKeyModalOpen(true)}
            className="text-forge-accent hover:underline flex-shrink-0"
          >
            Configurar API
          </button>
        )}
      </div>
    </div>
  );
}

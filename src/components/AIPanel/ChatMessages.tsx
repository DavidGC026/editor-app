import { useEffect, useRef } from 'react';
import {
  FileEdit,
  FileText,
  FolderOpen,
  Search,
  Check,
  AlertCircle,
  Ban,
  Loader2,
  User,
  Bot,
  Info,
} from 'lucide-react';
import { useStore } from '../../store';
import type { AIMessage, AIToolCall } from '../../types';

function relativize(workspacePath: string | null, full: string): string {
  if (!workspacePath || !full) return full;
  if (full === workspacePath) return '.';
  const sep = workspacePath.includes('\\') && !workspacePath.includes('/') ? '\\' : '/';
  const ws = workspacePath.endsWith(sep) ? workspacePath : workspacePath + sep;
  return full.startsWith(ws) ? full.slice(ws.length) : full;
}

function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case 'escribir_archivo':
      return <FileEdit size={13} />;
    case 'leer_archivo':
      return <FileText size={13} />;
    case 'listar_carpeta':
      return <FolderOpen size={13} />;
    case 'buscar_en_proyecto':
      return <Search size={13} />;
    default:
      return <FileText size={13} />;
  }
}

function LiveWriteView({
  ruta,
  done,
}: {
  ruta: string;
  done: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[12px] border border-forge-accent/40"
      style={{
        background: done
          ? 'rgba(74, 219, 148, 0.06)'
          : 'rgba(74, 219, 148, 0.10)',
        color: done ? '#A8E4C5' : '#C8F0DD',
      }}
    >
      <span className="flex-shrink-0 inline-flex">
        <FileEdit size={13} />
      </span>
      <span className="flex-shrink-0 inline-flex">
        {done ? (
          <Check size={13} className="text-forge-accent" />
        ) : (
          <Loader2 size={13} className="animate-spin text-forge-accent" />
        )}
      </span>
      <span className="truncate">
        {done ? `Escrito ${ruta}` : `Escribiendo en ${ruta}…`}
      </span>
    </div>
  );
}

function ToolCallView({ tool }: { tool: AIToolCall }) {
  const workspacePath = useStore((s) => s.workspacePath);

  let icon: React.ReactNode;
  let textColor = '#D0D3DA';
  let bg = 'rgba(255,255,255,0.03)';
  let statusText = tool.statusLabel;

  if (!tool.done) {
    icon = <Loader2 size={13} className="animate-spin text-forge-accent" />;
  } else if (tool.rejected) {
    icon = <Ban size={13} className="text-red-400" />;
    textColor = '#FFB3B3';
    bg = 'rgba(255, 107, 107, 0.07)';
    statusText = `Cambios rechazados por el usuario.`;
  } else if (tool.error) {
    icon = <AlertCircle size={13} className="text-red-400" />;
    textColor = '#FFB3B3';
    bg = 'rgba(255, 107, 107, 0.07)';
    statusText = `Error en ${tool.name}: ${tool.error}`;
  } else {
    icon = <Check size={13} className="text-forge-accent" />;
    bg = 'rgba(74, 219, 148, 0.06)';
    if (tool.name === 'escribir_archivo') {
      const path = tool.paths?.[0] || tool.args.ruta;
      statusText = `Archivo afectado: ${relativize(workspacePath, path)}`;
    } else if (tool.name === 'leer_archivo') {
      const path = tool.paths?.[0] || tool.args.ruta;
      statusText = `Leído: ${relativize(workspacePath, path)}`;
    } else if (tool.name === 'listar_carpeta') {
      statusText = `Carpeta listada: ${tool.args.ruta || '.'}`;
    } else if (tool.name === 'buscar_en_proyecto') {
      statusText = `Búsqueda completada: "${tool.args.texto}"`;
    }
  }

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[12px] border border-forge-border/60"
      style={{ background: bg, color: textColor }}
    >
      <span className="flex-shrink-0 inline-flex">
        <ToolIcon name={tool.name} />
      </span>
      <span className="flex-shrink-0 inline-flex">{icon}</span>
      <span className="truncate">{statusText}</span>
    </div>
  );
}

function MessageBubble({ message }: { message: AIMessage }) {
  if (message.role === 'system') {
    return (
      <div className="flex gap-2 items-start text-[12px] text-forge-text-dim border border-forge-border/50 rounded px-3 py-2 bg-forge-input/30">
        <Info size={13} className="flex-shrink-0 mt-0.5 text-forge-accent" />
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 text-[11px] text-forge-text-dim">
          <User size={11} />
          Tú
        </div>
        <div
          className="max-w-[90%] px-3 py-2 rounded-md text-[13px] text-forge-text-strong border border-forge-border"
          style={{ background: 'rgba(74, 219, 148, 0.08)' }}
        >
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px] text-forge-text-dim">
        <Bot size={11} className="text-forge-accent" />
        Forge
      </div>
      {(message.content || message.streaming) && (
        <div className="text-[13px] text-forge-text leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
          {message.streaming && (
            <span className="inline-block w-[7px] h-[14px] bg-forge-accent ml-0.5 align-text-bottom animate-pulse" />
          )}
        </div>
      )}
      {message.liveWrites && message.liveWrites.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          {message.liveWrites.map((w, i) => (
            <LiveWriteView key={`${w.ruta}-${i}`} ruta={w.ruta} done={w.done} />
          ))}
        </div>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          {message.toolCalls
            .filter(
              (t) =>
                // Don't show the `escribir_archivo` tool card if it's already
                // shown above as a LiveWrite — they describe the same action.
                !(
                  t.name === 'escribir_archivo' &&
                  message.liveWrites?.some(
                    (lw) => lw.ruta === (t.args.ruta as string),
                  )
                ),
            )
            .map((t, i) => (
              <ToolCallView key={i} tool={t} />
            ))}
        </div>
      )}
      {message.error && (
        <div className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {message.error}
        </div>
      )}
    </div>
  );
}

export default function ChatMessages() {
  const messages = useStore((s) => s.aiMessages);
  const status = useStore((s) => s.aiStatus);
  const statusText = useStore((s) => s.aiStatusText);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on every change.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status, statusText]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto sidebar-scroll px-3 py-3 space-y-4"
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      {(status === 'streaming' ||
        status === 'running_tool' ||
        status === 'initializing' ||
        status === 'awaiting_diff') &&
        statusText && (
          <div className="flex items-center gap-2 text-[11px] text-forge-text-dim italic">
            <Loader2 size={11} className="animate-spin text-forge-accent" />
            {statusText}
          </div>
        )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, X, XCircle } from 'lucide-react';
import type { ExtensionHostMessage } from '../types';

/**
 * `window.showInformationMessage` and friends, on screen.
 *
 * Non-modal by design, like VS Code: an extension asking something must not
 * be able to block the editor. The host *is* waiting for an answer, so every
 * exit path answers — picking a button, dismissing, or the component
 * unmounting — because a message that resolves nothing leaves the extension
 * hanging on its own promise.
 *
 * `modal: true` is honoured as visual emphasis only. Forge does not give an
 * extension the power to freeze the workbench.
 */

const SEVERITY = {
  info: {
    Icon: Info,
    accent: 'border-l-sky-400/70',
    tint: 'text-sky-300',
  },
  warn: {
    Icon: AlertTriangle,
    accent: 'border-l-amber-400/70',
    tint: 'text-amber-300',
  },
  error: {
    Icon: XCircle,
    accent: 'border-l-red-400/70',
    tint: 'text-red-300',
  },
} as const;

export default function ExtensionNotifications() {
  const [messages, setMessages] = useState<ExtensionHostMessage[]>([]);
  // Read by the unmount cleanup, which must see the latest list without
  // re-running (and answering everything) on each render.
  const pending = useRef<ExtensionHostMessage[]>([]);
  pending.current = messages;

  useEffect(() => {
    const api = window.electronAPI?.ext;
    if (!api?.onHostMessage) return;
    const subscription = api.onHostMessage((message) => {
      setMessages((current) => [...current, message]);
    });
    return () => subscription.dispose();
  }, []);

  useEffect(() => () => {
    // Unmounting (window closing, hot reload) still answers everything
    // pending, so no extension is left waiting on a promise nobody owns.
    for (const message of pending.current) {
      window.electronAPI?.ext?.respondHostMessage?.(message.id, null);
    }
  }, []);

  if (messages.length === 0) return null;

  const answer = (message: ExtensionHostMessage, selection: string | null) => {
    setMessages((current) => current.filter((entry) => entry.id !== message.id));
    window.electronAPI?.ext?.respondHostMessage?.(message.id, selection);
  };

  return (
    <div className="fixed bottom-8 right-4 z-50 flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)]">
      {messages.map((message) => {
        const { Icon, accent, tint } = SEVERITY[message.severity] ?? SEVERITY.info;
        return (
          <div
            key={message.id}
            className={`rounded border border-forge-border/70 border-l-2 ${accent} bg-forge-panel shadow-lg shadow-black/30`}
          >
            <div className="flex items-start gap-2 px-3 pt-2.5">
              <Icon size={14} className={`${tint} mt-0.5 flex-shrink-0`} />
              <p className="flex-1 text-[12px] leading-snug text-forge-text-strong break-words">
                {message.message}
              </p>
              <button
                type="button"
                onClick={() => answer(message, null)}
                title="Descartar"
                className="text-forge-text/40 hover:text-forge-text transition-colors flex-shrink-0"
              >
                <X size={13} />
              </button>
            </div>

            {message.extensionId && (
              <div className="px-3 pt-1 text-[10px] text-forge-text/35 truncate">
                {message.extensionId}
              </div>
            )}

            <div className="flex justify-end gap-1.5 px-3 py-2">
              {message.items.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => answer(message, item)}
                  className="px-2 py-1 rounded text-[11px] border border-forge-border/60 bg-forge-input text-forge-text hover:bg-forge-hover transition-colors"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

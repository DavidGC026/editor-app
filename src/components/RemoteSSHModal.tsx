import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Folder, Loader2, Search, Server } from 'lucide-react';
import { useStore } from '../store';
import Modal from './ui/Modal';

interface RemoteListing {
  path: string;
  parent: string | null;
  directories: { name: string; path: string }[];
}

export default function RemoteSSHModal() {
  const open = useStore((s) => s.remoteSSHModalOpen);
  const setOpen = useStore((s) => s.setRemoteSSHModalOpen);
  const connectRemoteWorkspace = useStore((s) => s.connectRemoteWorkspace);
  const [target, setTarget] = useState('');
  const [listing, setListing] = useState<RemoteListing | null>(null);
  const [pathInput, setPathInput] = useState('~');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTarget('');
    setListing(null);
    setPathInput('~');
    setFilter('');
    setBusy(false);
    setError(null);
    window.setTimeout(() => hostRef.current?.focus(), 50);
  }, [open]);

  if (!open) return null;

  const browse = async (path: string) => {
    if (!target.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.remote.browse({ target: target.trim(), path });
      setListing(result);
      setPathInput(result.path);
      setFilter('');
    } catch (err) {
      setError((err as Error)?.message || 'No se pudo acceder a la carpeta remota.');
    } finally {
      setBusy(false);
    }
  };

  const openFolder = async () => {
    if (!listing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await connectRemoteWorkspace(target, pathInput.trim() || listing.path);
      setOpen(false);
    } catch (err) {
      setError((err as Error)?.message || 'No se pudo abrir la carpeta remota.');
    } finally {
      setBusy(false);
    }
  };

  const visibleDirectories = listing?.directories.filter((directory) =>
    directory.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()),
  ) ?? [];

  return (
    <Modal
      title={listing ? `Conectado a ${target}` : 'Conectar por SSH'}
      icon={<Server size={16} className="text-forge-accent" />}
      onClose={() => setOpen(false)}
      closeDisabled={busy}
      widthClass="w-[560px]"
      footer={listing ? (
        <>
          <button onClick={() => setListing(null)} disabled={busy} className="px-3 py-1.5 text-[12px] text-forge-text hover:text-forge-text-strong">Cambiar host</button>
          <button onClick={openFolder} disabled={busy} className="px-3 py-1.5 rounded text-[12px] font-medium bg-forge-accent text-black hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
            {busy && <Loader2 size={13} className="animate-spin" />} Abrir carpeta
          </button>
        </>
      ) : (
        <>
          <button onClick={() => setOpen(false)} disabled={busy} className="px-3 py-1.5 text-[12px] text-forge-text hover:text-forge-text-strong">Cancelar</button>
          <button onClick={() => void browse('~')} disabled={!target.trim() || busy} className="px-3 py-1.5 rounded text-[12px] font-medium bg-forge-accent text-black hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
            {busy && <Loader2 size={13} className="animate-spin" />} Conectar
          </button>
        </>
      )}
    >
      {!listing ? (
        <div>
          <label className="block text-xs text-forge-text-dim mb-1">Host SSH</label>
          <input ref={hostRef} value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void browse('~'); }} placeholder="usuario@servidor o alias de ~/.ssh/config" className="forge-input w-full" disabled={busy} />
          <p className="mt-2 text-[11px] text-forge-text-dim">Se usarán tus claves y la configuración de OpenSSH.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void browse(pathInput); }}>
            <button type="button" title="Carpeta superior" disabled={!listing.parent || busy} onClick={() => listing.parent && void browse(listing.parent)} className="w-8 h-8 flex items-center justify-center text-forge-text hover:text-forge-text-strong disabled:opacity-30"><ArrowLeft size={16} /></button>
            <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} className="forge-input flex-1" aria-label="Ruta remota" />
            <button type="submit" disabled={busy} className="px-3 h-8 rounded text-[12px] bg-forge-input text-forge-text-strong hover:bg-forge-border">Ir</button>
          </form>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-forge-text-dim" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar en esta carpeta" className="forge-input w-full pl-8" />
          </div>
          <div className="h-[260px] overflow-y-auto border border-forge-border rounded bg-forge-editor">
            {busy && <div className="h-full flex items-center justify-center text-forge-text-dim"><Loader2 size={18} className="animate-spin" /></div>}
            {!busy && visibleDirectories.map((directory) => (
              <button key={directory.path} onDoubleClick={() => void browse(directory.path)} onClick={() => { setPathInput(directory.path); }} className={`w-full h-8 px-3 flex items-center gap-2 text-left text-[12px] hover:bg-forge-input ${pathInput === directory.path ? 'bg-forge-input text-forge-text-strong' : 'text-forge-text'}`}>
                <Folder size={15} className="text-forge-accent" />
                <span className="truncate flex-1">{directory.name}</span>
                <ChevronRight size={14} className="text-forge-text-dim" />
              </button>
            ))}
            {!busy && visibleDirectories.length === 0 && <div className="h-full flex items-center justify-center text-[12px] text-forge-text-dim">No hay carpetas que mostrar</div>}
          </div>
          <p className="text-[11px] text-forge-text-dim">Doble clic para entrar. “Abrir carpeta” usa la ruta mostrada arriba.</p>
        </div>
      )}
      {error && <div className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 whitespace-pre-wrap">{error}</div>}
    </Modal>
  );
}

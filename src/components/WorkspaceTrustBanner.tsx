import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useStore } from '../store';

/**
 * Restricted Mode notice for the Extensions panel. It states what is
 * actually happening — extensions without
 * `capabilities.untrustedWorkspaces` are not activated — and offers the one
 * action that changes it. Trusted workspaces render nothing: a permanent
 * "you are safe" badge is noise, and this banner must keep meaning
 * something when it appears.
 */
export default function WorkspaceTrustBanner() {
  const workspaceTrust = useStore((s) => s.workspaceTrust);
  const workspaceTrustError = useStore((s) => s.workspaceTrustError);
  const setWorkspaceTrusted = useStore((s) => s.setWorkspaceTrusted);
  const [busy, setBusy] = useState(false);

  if (workspaceTrust.state === 'trusted') return null;
  // With no folder open nothing can be induced by a workspace yet.
  if (!workspaceTrust.workspace) return null;

  const grant = async () => {
    setBusy(true);
    try {
      await setWorkspaceTrusted(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-amber-200/90">
        <ShieldAlert size={12} className="flex-shrink-0" />
        <span className="uppercase tracking-wide">Restricted Mode</span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-forge-text/70">
        {workspaceTrust.remote
          ? 'Los workspaces remotos no son confiables todavía: sólo se activan las extensiones que declaran soporte para workspaces no confiables.'
          : 'Este workspace no es de confianza. Sólo se activan las extensiones que declaran soporte para workspaces no confiables.'}
      </p>
      {workspaceTrust.canGrant && (
        <button
          onClick={() => void grant()}
          disabled={busy}
          className="mt-1.5 w-full rounded bg-forge-input px-2 py-1 text-[11px] text-forge-text border border-forge-border/70 hover:border-forge-accent/60 hover:text-forge-accent transition-colors disabled:opacity-50"
        >
          {busy ? 'Aplicando…' : 'Confiar en este workspace'}
        </button>
      )}
      {workspaceTrustError && (
        <p className="mt-1.5 text-[11px] leading-snug text-red-400/90">{workspaceTrustError}</p>
      )}
    </div>
  );
}

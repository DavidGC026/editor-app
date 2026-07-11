import { useState } from 'react';
import { useStore } from '../store';
import { Blocks, Trash2, Palette, Loader2, PackagePlus, Check } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// Extensions panel — install .vsix files (themes + snippets subset)
// ─────────────────────────────────────────────────────────────────────────

export default function ExtensionsPanel() {
  const installedExtensions = useStore((s) => s.installedExtensions);
  const activeTheme = useStore((s) => s.activeTheme);
  const installVsixExtension = useStore((s) => s.installVsixExtension);
  const uninstallExtension = useStore((s) => s.uninstallExtension);
  const setColorTheme = useStore((s) => s.setColorTheme);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setBusy(true);
    setError(null);
    const message = await installVsixExtension();
    setBusy(false);
    if (message) setError(message);
  };

  const themeOptions: { id: string; label: string; source: string }[] = [
    { id: 'forge-dark', label: 'Forge Dark', source: 'built-in' },
    ...installedExtensions.flatMap((ext) =>
      ext.themes.map((t) => ({ id: t.id, label: t.label, source: ext.displayName })),
    ),
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
        <span>Extensions</span>
      </div>

      <div className="px-3 pb-2 flex-shrink-0">
        <button
          onClick={handleInstall}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-forge-accent/15 hover:bg-forge-accent/25 text-forge-accent text-[12px] rounded px-2 py-1.5 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <PackagePlus size={13} />}
          Install from VSIX...
        </button>
        {error && (
          <p className="mt-2 text-[11px] leading-snug text-red-400/90">{error}</p>
        )}
        <p className="mt-2 text-[10px] leading-snug text-forge-text/40">
          Forge soporta temas de color y snippets de extensiones VSCode (.vsix).
          Las extensiones que ejecutan código no están soportadas.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {/* ── Color theme picker ─────────────────────────────────────── */}
        <div className="px-3 pt-1 pb-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
            <Palette size={11} />
            Color Theme
          </div>
          {themeOptions.map((opt) => {
            const isActive = opt.id === activeTheme;
            return (
              <button
                key={opt.id}
                onClick={() => void setColorTheme(opt.id)}
                className={`w-full flex items-center justify-between px-2 py-1 rounded text-[12px] transition-colors
                  ${isActive ? 'bg-forge-accent/15 text-forge-accent' : 'text-forge-text hover:bg-white/5'}`}
              >
                <span className="truncate">{opt.label}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  <span className="text-[10px] text-forge-text/40">{opt.source}</span>
                  {isActive && <Check size={12} />}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Installed list ─────────────────────────────────────────── */}
        <div className="px-3 pb-4">
          <div className="text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
            Installed ({installedExtensions.length})
          </div>

          {installedExtensions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-forge-text/40">
              <Blocks size={28} />
              <p className="text-[11px]">No extensions installed</p>
            </div>
          ) : (
            installedExtensions.map((ext) => (
              <div
                key={ext.id}
                className="group rounded px-2 py-1.5 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-forge-text-strong truncate">
                    {ext.displayName}
                  </span>
                  <button
                    title="Uninstall"
                    onClick={() => void uninstallExtension(ext.id)}
                    className="opacity-0 group-hover:opacity-70 hover:!opacity-100 text-forge-text flex-shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="text-[10px] text-forge-text/45 truncate">
                  {ext.publisher} · v{ext.version}
                  {ext.themes.length > 0 && ` · ${ext.themes.length} theme${ext.themes.length > 1 ? 's' : ''}`}
                  {ext.snippets.length > 0 && ` · snippets`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

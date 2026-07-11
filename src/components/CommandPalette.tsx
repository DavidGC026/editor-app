import { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../store';
import type { Command } from '../types';

export default function CommandPalette() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const togglePanel = useStore((s) => s.togglePanel);
  const openFolder = useStore((s) => s.openFolder);
  const saveFile = useStore((s) => s.saveFile);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const installVsixExtension = useStore((s) => s.installVsixExtension);
  const installExtensionById = useStore((s) => s.installExtensionById);
  const setColorTheme = useStore((s) => s.setColorTheme);
  const installedExtensions = useStore((s) => s.installedExtensions);

  const close = () => setCommandPaletteOpen(false);

  const commands: Command[] = useMemo(
    () => [
      { id: 'open-folder', label: 'File: Open Folder', action: () => { openFolder(); close(); } },
      { id: 'save-file', label: 'File: Save', shortcut: 'Ctrl+S', action: () => { saveFile(); close(); } },
      { id: 'toggle-sidebar', label: 'View: Toggle Sidebar', shortcut: 'Ctrl+B', action: () => { toggleSidebar(); close(); } },
      { id: 'toggle-panel', label: 'View: Toggle Panel', shortcut: 'Ctrl+`', action: () => { togglePanel(); close(); } },
      { id: 'show-explorer', label: 'View: Show Explorer', action: () => { setSidebarPanel('explorer'); close(); } },
      { id: 'show-search', label: 'View: Show Search', action: () => { setSidebarPanel('search'); close(); } },
      { id: 'show-git', label: 'View: Show Source Control', action: () => { setSidebarPanel('git'); close(); } },
      { id: 'show-debug', label: 'View: Show Run and Debug', action: () => { setSidebarPanel('debug'); close(); } },
      { id: 'show-extensions', label: 'View: Show Extensions', action: () => { setSidebarPanel('extensions'); close(); } },
      { id: 'install-vsix', label: 'Extensions: Install from VSIX', action: () => { void installVsixExtension(); close(); } },
      { id: 'theme-forge-dark', label: 'Preferences: Color Theme — Forge Dark', action: () => { void setColorTheme('forge-dark'); close(); } },
      ...installedExtensions.flatMap((ext) =>
        ext.themes.map((t) => ({
          id: `theme-${t.id}`,
          label: `Preferences: Color Theme — ${t.label}`,
          action: () => { void setColorTheme(t.id); close(); },
        })),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installedExtensions]
  );

  const filtered = useMemo(() => {
    // VSCode-style quick install: `ext install publisher.name` downloads the
    // extension from Open VSX. Matches while typing so the entry is visible
    // as soon as `ext install ` is written.
    const extInstall = query.trim().match(/^ext\s+install(?:\s+(\S*))?$/i);
    if (extInstall) {
      const id = extInstall[1] ?? '';
      return [
        {
          id: 'ext-install-openvsx',
          label: id
            ? `Extensions: Install '${id}' from Open VSX`
            : 'Extensions: Install from Open VSX — escribe publisher.nombre',
          action: () => {
            if (!id) return;
            void installExtensionById(id);
            close();
          },
        },
      ];
    }

    if (!query.trim()) return commands;
    const lower = query.toLowerCase();
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(lower));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, commands]);

  useEffect(() => { setSelectedIndex(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) filtered[selectedIndex].action();
    }
  };

  return (
    <div
      className="command-palette-overlay fixed inset-0 z-50 flex justify-center pt-[80px]"
      onClick={close}
    >
      <div
        className="w-[600px] max-h-[400px] bg-forge-sidebar border border-forge-border rounded-md shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-2 border-b border-forge-border/50">
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-forge-input text-forge-text text-[14px] px-3 py-1.5 rounded outline-none border border-forge-accent/50 focus:border-forge-accent"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="flex-1 overflow-y-auto sidebar-scroll">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-forge-text/60 text-sm">
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <div
                key={cmd.id}
                onClick={() => cmd.action()}
                className={`flex items-center justify-between px-4 py-2 cursor-pointer text-[13px] transition-colors
                  ${idx === selectedIndex
                    ? 'bg-forge-accent/15 text-forge-accent'
                    : 'text-forge-text hover:bg-white/5'}
                `}
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <span className="text-forge-text/50 text-[12px] ml-4 flex-shrink-0">
                    {cmd.shortcut}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

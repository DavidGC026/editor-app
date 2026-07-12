import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Minus, Square, X } from 'lucide-react';
import type { SidebarPanel } from '../types';
import logoUrl from '../assets/dvg-logo.jpg';

type MenuId = 'file' | 'edit' | 'view' | 'help';

function MenuDropdown({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="dropdown-menu absolute top-[31px] left-0 z-50 py-1 min-w-[190px]"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function MenuItem({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between gap-4 px-3 py-1.5 text-left text-[12px] text-forge-text-menu hover:bg-forge-accent/10 hover:text-forge-accent transition-colors"
    >
      <span>{label}</span>
      {shortcut && <span className="text-[10px] text-forge-text/45">{shortcut}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div className="h-px my-1 bg-forge-border/70" />;
}

export default function TitleBar() {
  const workspaceName = useStore((s) => s.workspaceName);
  const openFolder = useStore((s) => s.openFolder);
  const openRemoteWorkspace = useStore((s) => s.openRemoteWorkspace);
  const saveFile = useStore((s) => s.saveFile);
  const closeWorkspace = useStore((s) => s.closeWorkspace);
  const setQuickOpenOpen = useStore((s) => s.setQuickOpenOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const togglePanel = useStore((s) => s.togglePanel);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const setBottomTab = useStore((s) => s.setBottomTab);
  const toggleAIPanel = useStore((s) => s.toggleAIPanel);
  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const zoomIn = useStore((s) => s.zoomIn);
  const zoomOut = useStore((s) => s.zoomOut);
  const resetZoom = useStore((s) => s.resetZoom);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);

  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = () => window.electronAPI?.maximize();
  const handleClose = () => window.electronAPI?.close();
  const closeMenu = () => setOpenMenu(null);

  const pickPanel = (panel: SidebarPanel) => {
    setSidebarPanel(panel);
    closeMenu();
  };

  const edit = window.electronAPI?.edit;

  return (
    <div className="h-[32px] bg-forge-titlebar flex items-center justify-between select-none drag-region border-b border-forge-border/40 relative">
      {/* Left: Logo + App name + Menu */}
      <div className="flex items-center h-full no-drag">
        {/* Logo + DVG */}
        <div className="flex items-center gap-2 px-3 h-full">
          <img src={logoUrl} alt="DVG" className="h-[20px] w-auto object-contain" />
          <span className="text-[13px] font-semibold text-forge-accent tracking-wide">DVG</span>
        </div>

        {/* Menu Items */}
        <div className="flex items-center h-full text-[13px] ml-1">
          <div className="relative h-full">
            <button
              onClick={() => setOpenMenu((cur) => cur === 'file' ? null : 'file')}
              className="px-3 h-full text-forge-text hover:text-forge-text-strong hover:bg-white/5 transition-colors"
            >
              File
            </button>
            {openMenu === 'file' && (
              <MenuDropdown onClose={closeMenu}>
                <MenuItem label="Nueva ventana" onClick={() => { window.electronAPI?.newWindow(); closeMenu(); }} />
                <MenuDivider />
                <MenuItem label="Open Folder..." onClick={() => { void openFolder(); closeMenu(); }} />
                <MenuItem label="Open Remote SSH..." onClick={() => { void openRemoteWorkspace(); closeMenu(); }} />
                <MenuItem label="Go to File..." shortcut="Ctrl+P" onClick={() => { setQuickOpenOpen(true); closeMenu(); }} />
                <MenuItem label="Save" shortcut="Ctrl+S" onClick={() => { void saveFile(); closeMenu(); }} />
                <MenuDivider />
                <MenuItem label="Close Folder" onClick={() => { closeWorkspace(); closeMenu(); }} />
              </MenuDropdown>
            )}
          </div>
          <div className="relative h-full">
            <button
              onClick={() => setOpenMenu((cur) => cur === 'edit' ? null : 'edit')}
              className="px-3 h-full text-forge-text hover:text-forge-text-strong hover:bg-white/5 transition-colors"
            >
              Edit
            </button>
            {openMenu === 'edit' && (
              <MenuDropdown onClose={closeMenu}>
                <MenuItem label="Undo" shortcut="Ctrl+Z" onClick={() => { edit?.undo(); closeMenu(); }} />
                <MenuItem label="Redo" shortcut="Ctrl+Y" onClick={() => { edit?.redo(); closeMenu(); }} />
                <MenuDivider />
                <MenuItem label="Cut" shortcut="Ctrl+X" onClick={() => { edit?.cut(); closeMenu(); }} />
                <MenuItem label="Copy" shortcut="Ctrl+C" onClick={() => { edit?.copy(); closeMenu(); }} />
                <MenuItem label="Paste" shortcut="Ctrl+V" onClick={() => { edit?.paste(); closeMenu(); }} />
                <MenuDivider />
                <MenuItem label="Select All" shortcut="Ctrl+A" onClick={() => { edit?.selectAll(); closeMenu(); }} />
              </MenuDropdown>
            )}
          </div>
          <div className="relative h-full">
            <button
              onClick={() => setOpenMenu((cur) => cur === 'view' ? null : 'view')}
              className="px-3 h-full text-forge-text hover:text-forge-text-strong hover:bg-white/5 transition-colors"
            >
              View
            </button>
            {openMenu === 'view' && (
              <MenuDropdown onClose={closeMenu}>
                <MenuItem label="Explorer" onClick={() => pickPanel('explorer')} />
                <MenuItem label="Search" onClick={() => pickPanel('search')} />
                <MenuItem label="Source Control" onClick={() => pickPanel('git')} />
                <MenuItem label="Run and Debug" onClick={() => pickPanel('debug')} />
                <MenuItem label="Extensions" onClick={() => pickPanel('extensions')} />
                <MenuDivider />
                <MenuItem label="Toggle Sidebar" shortcut="Ctrl+B" onClick={() => { toggleSidebar(); closeMenu(); }} />
                <MenuItem label="Toggle Panel" shortcut="Ctrl+`" onClick={() => { togglePanel(); closeMenu(); }} />
                <MenuItem label="Terminal" onClick={() => { setBottomTab('terminal'); closeMenu(); }} />
                <MenuItem label="Problems" onClick={() => { setBottomTab('problems'); closeMenu(); }} />
                <MenuItem label="AI Panel" onClick={() => { toggleAIPanel(); closeMenu(); }} />
                <MenuDivider />
                <MenuItem label="Zoom In" shortcut="Ctrl+=" onClick={() => { zoomIn(); closeMenu(); }} />
                <MenuItem label="Zoom Out" shortcut="Ctrl+-" onClick={() => { zoomOut(); closeMenu(); }} />
                <MenuItem label="Reset Zoom" shortcut="Ctrl+0" onClick={() => { resetZoom(); closeMenu(); }} />
              </MenuDropdown>
            )}
          </div>
          <div className="relative h-full">
            <button
              onClick={() => setOpenMenu((cur) => cur === 'help' ? null : 'help')}
              className="px-3 h-full text-forge-text hover:text-forge-text-strong hover:bg-white/5 transition-colors"
            >
              Help
            </button>
            {openMenu === 'help' && (
              <MenuDropdown onClose={closeMenu}>
                <MenuItem
                  label="Command Palette"
                  shortcut="Ctrl+Shift+P"
                  onClick={() => { setCommandPaletteOpen(true); closeMenu(); }}
                />
                <MenuItem
                  label="Keyboard Shortcuts"
                  onClick={() => {
                    window.alert([
                      'DVG shortcuts',
                      '',
                      'Ctrl+Shift+P  Command Palette',
                      'Ctrl+P        Quick Open',
                      'Ctrl+S        Save',
                      'Ctrl+B        Toggle Sidebar',
                      'Ctrl+`        Toggle Panel',
                      'Ctrl+=        Zoom In',
                      'Ctrl+-        Zoom Out',
                      'Ctrl+0        Reset Zoom',
                    ].join('\n'));
                    closeMenu();
                  }}
                />
                <MenuDivider />
                <MenuItem label="Show Problems" onClick={() => { setBottomTab('problems'); closeMenu(); }} />
                <MenuItem label="Show Output" onClick={() => { setBottomTab('output'); closeMenu(); }} />
                <MenuDivider />
                <MenuItem
                  label="About DVG"
                  onClick={() => {
                    window.alert('DVG\nModern Electron code editor');
                    closeMenu();
                  }}
                />
              </MenuDropdown>
            )}
          </div>
        </div>
      </div>

      {/* Center: Workspace title */}
      <div className="absolute left-1/2 -translate-x-1/2 text-[12px] text-forge-text/70 pointer-events-none">
        {workspaceName ? `${workspaceName} — DVG` : 'DVG'}
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center h-full no-drag">
        <button
          onClick={handleMinimize}
          className="w-[46px] h-full flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          <Minus size={16} className="text-forge-text" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-[46px] h-full flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          <Square size={12} className="text-forge-text" />
        </button>
        <button
          onClick={handleClose}
          className="w-[46px] h-full flex items-center justify-center hover:bg-[#e81123] hover:text-white transition-colors"
        >
          <X size={16} className="text-forge-text" />
        </button>
      </div>
    </div>
  );
}

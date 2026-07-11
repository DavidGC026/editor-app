import { useStore } from '../store';
import { Minus, Square, X } from 'lucide-react';
import logoUrl from '../assets/forge-logo.png';

export default function TitleBar() {
  const workspaceName = useStore((s) => s.workspaceName);
  const openFolder = useStore((s) => s.openFolder);

  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = () => window.electronAPI?.maximize();
  const handleClose = () => window.electronAPI?.close();

  return (
    <div className="h-[32px] bg-forge-titlebar flex items-center justify-between select-none drag-region border-b border-forge-border/40 relative">
      {/* Left: Logo + App name + Menu */}
      <div className="flex items-center h-full no-drag">
        {/* Logo + Forge */}
        <div className="flex items-center gap-2 px-3 h-full">
          <img src={logoUrl} alt="Forge" className="h-[20px] w-auto object-contain" />
          <span className="text-[13px] font-semibold text-forge-accent tracking-wide">Forge</span>
        </div>

        {/* Menu Items */}
        <div className="flex items-center h-full text-[13px] ml-1">
          <button
            onClick={() => openFolder()}
            className="px-3 h-full text-forge-text hover:text-forge-text-strong hover:bg-white/5 transition-colors"
          >
            File
          </button>
          <button className="px-3 h-full text-forge-text hover:text-forge-text-strong hover:bg-white/5 transition-colors">
            Edit
          </button>
          <button className="px-3 h-full text-forge-text hover:text-forge-text-strong hover:bg-white/5 transition-colors">
            View
          </button>
          <button className="px-3 h-full text-forge-text hover:text-forge-text-strong hover:bg-white/5 transition-colors">
            Help
          </button>
        </div>
      </div>

      {/* Center: Workspace title */}
      <div className="absolute left-1/2 -translate-x-1/2 text-[12px] text-forge-text/70 pointer-events-none">
        {workspaceName ? `${workspaceName} — Forge` : 'Forge'}
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

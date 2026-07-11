import { useStore } from '../store';
import { Bell, GitBranch, AlertCircle, CheckCircle2, Globe } from 'lucide-react';

export default function StatusBar() {
  const cursorPosition = useStore((s) => s.cursorPosition);
  const openTabs = useStore((s) => s.openTabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const workspacePath = useStore((s) => s.workspacePath);
  const togglePanel = useStore((s) => s.togglePanel);
  const liveServerActive = useStore((s) => s.liveServerActive);
  const liveServerPort = useStore((s) => s.liveServerPort);
  const liveServerUrl = useStore((s) => s.liveServerUrl);
  const toggleLiveServer = useStore((s) => s.toggleLiveServer);

  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const languageLabel = activeTab?.language || 'Plain Text';
  const displayLanguage = languageLabel.charAt(0).toUpperCase() + languageLabel.slice(1);

  const showPort = liveServerActive && liveServerPort != null;
  const liveServerLabel = showPort ? `Puerto: ${liveServerPort}` : 'Live Server';
  const liveServerColor = liveServerActive ? '#4ADB94' : '#A1A3AF';
  const liveServerTitle = liveServerActive
    ? `Live Server activo en ${liveServerUrl || `http://localhost:${liveServerPort}`} — clic para detener`
    : 'Live Server inactivo — clic para iniciar (requiere archivo HTML)';

  return (
    <div
      className="h-[22px] flex items-center justify-between px-2 text-[12px] select-none"
      style={{ backgroundColor: '#2F323F', color: '#A1A3AF' }}
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        {workspacePath && (
          <div className="flex items-center gap-1 hover:text-forge-text-strong transition-colors cursor-default">
            <GitBranch size={12} />
            <span>main</span>
          </div>
        )}

        <button
          onClick={togglePanel}
          className="flex items-center gap-1 hover:text-forge-text-strong px-1 rounded transition-colors"
        >
          <AlertCircle size={12} />
          <span>0</span>
          <CheckCircle2 size={12} className="ml-1" />
          <span>0</span>
        </button>

        <button
          onClick={() => toggleLiveServer()}
          title={liveServerTitle}
          className="flex items-center gap-1 hover:text-forge-text-strong px-1 rounded transition-colors"
        >
          <Globe size={12} style={{ color: liveServerColor }} />
          <span
            aria-hidden="true"
            className="inline-block w-[6px] h-[6px] rounded-full"
            style={{ backgroundColor: liveServerColor }}
          />
          <span style={{ color: liveServerActive ? '#D0D3DA' : '#A1A3AF' }}>
            {liveServerLabel}
          </span>
        </button>
      </div>

      {/* Right */}
      <div className="flex items-center gap-4">
        {activeTab && (
          <>
            <span>
              Ln {cursorPosition.line}, Col {cursorPosition.column}
            </span>
            <span>Spaces: 2</span>
            <span>UTF-8</span>
            <span>LF</span>
            <span>{displayLanguage}</span>
          </>
        )}

        <button className="flex items-center hover:text-forge-text-strong px-1 rounded transition-colors">
          <Bell size={12} />
        </button>
      </div>
    </div>
  );
}

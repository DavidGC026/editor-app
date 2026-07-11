import { useStore } from '../store';
import { Bell, GitBranch, AlertCircle, CheckCircle2, Globe, Save } from 'lucide-react';

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
  const gitIsRepo = useStore((s) => s.gitIsRepo);
  const gitBranch = useStore((s) => s.gitBranch);
  const gitChanges = useStore((s) => s.gitChanges);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const problems = useStore((s) => s.problems);
  const autoSave = useStore((s) => s.autoSave);
  const setAutoSave = useStore((s) => s.setAutoSave);
  const tabSize = useStore((s) => s.tabSize);

  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const languageLabel = activeTab?.language || 'Plain Text';
  const displayLanguage = languageLabel.charAt(0).toUpperCase() + languageLabel.slice(1);

  const showPort = liveServerActive && liveServerPort != null;
  const liveServerLabel = showPort ? `Puerto: ${liveServerPort}` : 'Live Server';
  const liveServerColor = liveServerActive ? '#E52E3D' : '#A1A3AF';
  const liveServerTitle = liveServerActive
    ? `Live Server activo en ${liveServerUrl || `http://localhost:${liveServerPort}`} — clic para detener`
    : 'Live Server inactivo — clic para iniciar (requiere archivo HTML)';
  const errorCount = problems.filter((p) => p.severity === 1).length;
  const warningCount = problems.filter((p) => p.severity === 2).length;

  return (
    <div
      className="h-[22px] flex items-center justify-between px-2 text-[12px] select-none"
      style={{ backgroundColor: '#2F323F', color: '#A1A3AF' }}
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        {workspacePath && gitIsRepo && (
          <button
            onClick={() => setSidebarPanel('git')}
            title={`${gitChanges.length} Git change${gitChanges.length === 1 ? '' : 's'}`}
            className="flex items-center gap-1 hover:text-forge-text-strong transition-colors px-1 rounded"
          >
            <GitBranch size={12} />
            <span>{gitBranch || 'HEAD'}</span>
            {gitChanges.length > 0 && <span className="text-forge-text/60">*{gitChanges.length}</span>}
          </button>
        )}

        <button
          onClick={() => {
            togglePanel();
            useStore.getState().setBottomTab('problems');
          }}
          className="flex items-center gap-1 hover:text-forge-text-strong px-1 rounded transition-colors"
        >
          <AlertCircle size={12} />
          <span>{errorCount}</span>
          <CheckCircle2 size={12} className="ml-1" />
          <span>{warningCount}</span>
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
        <button
          onClick={() => setAutoSave(!autoSave)}
          title={autoSave ? 'Auto Save activo — clic para desactivar' : 'Auto Save inactivo — clic para activar'}
          className={`flex items-center gap-1 px-1 rounded transition-colors hover:text-forge-text-strong ${
            autoSave ? 'text-forge-accent' : ''
          }`}
        >
          <Save size={12} />
          <span>{autoSave ? 'Auto Save' : 'Manual Save'}</span>
        </button>

        {activeTab && (
          <>
            <span>
              Ln {cursorPosition.line}, Col {cursorPosition.column}
            </span>
            <span>Spaces: {tabSize}</span>
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

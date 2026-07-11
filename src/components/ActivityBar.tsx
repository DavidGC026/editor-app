import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import {
  Blocks,
  Bot,
  Bug,
  Code2,
  Files,
  GitBranch,
  KeyRound,
  MessageSquare,
  Minus,
  MousePointer2,
  Orbit,
  PanelBottom,
  Search,
  Settings,
  Sparkles,
  Terminal,
  UserCircle,
  Wrench,
} from 'lucide-react';
import type { SidebarPanel } from '../types';

interface ActivityItem {
  id: SidebarPanel;
  icon: React.ReactNode;
  title: string;
}

const items: ActivityItem[] = [
  { id: 'explorer', icon: <Files size={18} />, title: 'Explorer' },
  { id: 'search', icon: <Search size={18} />, title: 'Search' },
  { id: 'git', icon: <GitBranch size={18} />, title: 'Source Control' },
  { id: 'debug', icon: <Bug size={18} />, title: 'Run and Debug' },
  { id: 'agents', icon: <Bot size={18} />, title: 'Agents' },
  { id: 'extensions', icon: <Blocks size={18} />, title: 'Extensions' },
  { id: 'settings', icon: <Settings size={18} />, title: 'Settings' },
];

function UtilityMenu({
  anchor,
  children,
  onClose,
}: {
  anchor: 'account' | 'settings';
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
      className="dropdown-menu absolute right-2 top-[38px] z-50 py-1 min-w-[220px]"
      style={{ transform: anchor === 'account' ? 'translateX(-42px)' : undefined }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function MenuButton({
  icon,
  label,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] text-forge-text-menu hover:bg-forge-accent/10 hover:text-forge-accent transition-colors"
    >
      <span className="w-4 flex items-center justify-center flex-shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail && <span className="block text-[10px] text-forge-text/45 truncate">{detail}</span>}
      </span>
    </button>
  );
}

export default function ActivityBar() {
  const activeSidebarPanel = useStore((s) => s.activeSidebarPanel);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const aiPanelVisible = useStore((s) => s.aiPanelVisible);
  const toggleAIPanel = useStore((s) => s.toggleAIPanel);
  const setApiKeyModalOpen = useStore((s) => s.setAIApiKeyModalOpen);
  const configuredProviders = useStore((s) => s.aiConfiguredProviders);
  const activeProvider = useStore((s) => s.aiActiveProvider);
  const activeModel = useStore((s) => s.aiActiveModel);
  const editorFontSize = useStore((s) => s.editorFontSize);
  const zoomIn = useStore((s) => s.zoomIn);
  const zoomOut = useStore((s) => s.zoomOut);
  const resetZoom = useStore((s) => s.resetZoom);
  const setBottomTab = useStore((s) => s.setBottomTab);
  const runAgentInTerminal = useStore((s) => s.runAgentInTerminal);
  const [openMenu, setOpenMenu] = useState<'account' | 'settings' | null>(null);

  const closeMenu = () => setOpenMenu(null);

  return (
    <div className="h-[40px] w-full bg-forge-activitybar flex items-center justify-between px-2 border-b border-forge-border/50 select-none relative">
      {/* Left: panel icons (horizontal) */}
      <div className="flex items-center h-full">
        {items.map((item) => {
          const isActive = activeSidebarPanel === item.id && sidebarVisible;
          return (
            <button
              key={item.id}
              onClick={() => setSidebarPanel(item.id)}
              title={item.title}
              className={`relative h-full px-4 flex items-center justify-center transition-colors
                ${isActive
                  ? 'text-forge-text-strong'
                  : 'text-forge-text hover:text-forge-text-strong'}
              `}
            >
              {item.icon}
              {/* Active bottom border accent */}
              {isActive && (
                <span className="absolute left-2 right-2 bottom-0 h-[2px] bg-forge-accent rounded-t" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right: utility icons */}
      <div className="flex items-center h-full">
        <button
          onClick={toggleAIPanel}
          title="Agente IA"
          className={`relative h-full px-3 flex items-center justify-center transition-colors
            ${aiPanelVisible
              ? 'text-forge-text-strong'
              : 'text-forge-text hover:text-forge-text-strong'}
          `}
        >
          <Sparkles size={18} />
          {aiPanelVisible && (
            <span className="absolute left-2 right-2 bottom-0 h-[2px] bg-forge-accent rounded-t" />
          )}
        </button>
        <button
          title="Account"
          onClick={() => setOpenMenu((cur) => cur === 'account' ? null : 'account')}
          className="h-full px-3 flex items-center justify-center text-forge-text hover:text-forge-text-strong transition-colors"
        >
          <UserCircle size={18} />
        </button>
        <button
          title="Settings"
          onClick={() => setOpenMenu((cur) => cur === 'settings' ? null : 'settings')}
          className="h-full px-3 flex items-center justify-center text-forge-text hover:text-forge-text-strong transition-colors"
        >
          <Settings size={18} />
        </button>
      </div>

      {openMenu === 'account' && (
        <UtilityMenu anchor="account" onClose={closeMenu}>
          <div className="px-3 py-2 border-b border-forge-border/60">
            <div className="text-[11px] uppercase tracking-wide text-forge-text/50">
              Profile
            </div>
            <div className="mt-1 text-[12px] text-forge-text-strong truncate">
              {activeProvider && activeModel ? `${activeProvider} · ${activeModel}` : 'No AI provider active'}
            </div>
            <div className="text-[10px] text-forge-text/45">
              {configuredProviders.length} provider{configuredProviders.length === 1 ? '' : 's'} configured
            </div>
          </div>
          <MenuButton
            icon={<KeyRound size={14} />}
            label="Manage AI Providers"
            detail="API keys and models"
            onClick={() => {
              setApiKeyModalOpen(true);
              closeMenu();
            }}
          />
          <MenuButton
            icon={<Sparkles size={14} />}
            label={aiPanelVisible ? 'Hide AI Panel' : 'Show AI Panel'}
            detail="Right-side assistant"
            onClick={() => {
              toggleAIPanel();
              closeMenu();
            }}
          />
          <div className="border-t border-forge-border/60 my-1" />
          <MenuButton
            icon={<Code2 size={14} />}
            label="Run Codex"
            detail="codex"
            onClick={() => {
              runAgentInTerminal('codex');
              closeMenu();
            }}
          />
          <MenuButton
            icon={<MessageSquare size={14} />}
            label="Run Claude Code"
            detail="claude"
            onClick={() => {
              runAgentInTerminal('claude');
              closeMenu();
            }}
          />
          <MenuButton
            icon={<MousePointer2 size={14} />}
            label="Run Cursor Agent"
            detail="cursor-agent"
            onClick={() => {
              runAgentInTerminal('cursor-agent');
              closeMenu();
            }}
          />
          <MenuButton
            icon={<Orbit size={14} />}
            label="Run Antigravity"
            detail="agy"
            onClick={() => {
              runAgentInTerminal('agy');
              closeMenu();
            }}
          />
        </UtilityMenu>
      )}

      {openMenu === 'settings' && (
        <UtilityMenu anchor="settings" onClose={closeMenu}>
          <div className="px-3 py-2 border-b border-forge-border/60">
            <div className="text-[11px] uppercase tracking-wide text-forge-text/50">
              Settings
            </div>
            <div className="mt-1 text-[12px] text-forge-text-strong">
              Font size {editorFontSize}px
            </div>
          </div>
          <MenuButton
            icon={<Settings size={14} />}
            label="Increase Editor Font"
            detail="Zoom in"
            onClick={zoomIn}
          />
          <MenuButton
            icon={<Minus size={14} />}
            label="Decrease Editor Font"
            detail="Zoom out"
            onClick={zoomOut}
          />
          <MenuButton
            icon={<Wrench size={14} />}
            label="Reset Editor Font"
            detail="Default size"
            onClick={resetZoom}
          />
          <div className="border-t border-forge-border/60 my-1" />
          <MenuButton
            icon={<Terminal size={14} />}
            label="Open Terminal"
            detail="Bottom panel"
            onClick={() => {
              setBottomTab('terminal');
              closeMenu();
            }}
          />
          <MenuButton
            icon={<PanelBottom size={14} />}
            label="Open Problems"
            detail="Diagnostics"
            onClick={() => {
              setBottomTab('problems');
              closeMenu();
            }}
          />
          <MenuButton
            icon={<Blocks size={14} />}
            label="Open Extensions"
            detail="Marketplace and themes"
            onClick={() => {
              setSidebarPanel('extensions');
              closeMenu();
            }}
          />
          <MenuButton
            icon={<Settings size={14} />}
            label="Open Settings"
            detail="Editor preferences"
            onClick={() => {
              setSidebarPanel('settings');
              closeMenu();
            }}
          />
        </UtilityMenu>
      )}
    </div>
  );
}

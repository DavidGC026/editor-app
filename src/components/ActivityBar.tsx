import { useStore } from '../store';
import { Files, Search, GitBranch, Bug, Blocks, Settings, UserCircle, Sparkles } from 'lucide-react';
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
  { id: 'extensions', icon: <Blocks size={18} />, title: 'Extensions' },
];

export default function ActivityBar() {
  const activeSidebarPanel = useStore((s) => s.activeSidebarPanel);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const aiPanelVisible = useStore((s) => s.aiPanelVisible);
  const toggleAIPanel = useStore((s) => s.toggleAIPanel);

  return (
    <div className="h-[40px] w-full bg-forge-activitybar flex items-center justify-between px-2 border-b border-forge-border/50 select-none">
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
          className="h-full px-3 flex items-center justify-center text-forge-text hover:text-forge-text-strong transition-colors"
        >
          <UserCircle size={18} />
        </button>
        <button
          title="Settings"
          className="h-full px-3 flex items-center justify-center text-forge-text hover:text-forge-text-strong transition-colors"
        >
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}

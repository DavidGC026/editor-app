import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '../store';
import { lspClient } from '../lsp/client';
import { isHtmlFile, type GitChange, type Tab, type TreeNode } from '../types';
import ExtensionsPanel from './ExtensionsPanel';
import SettingsPanel from './SettingsPanel';
import { TerminalsPanel } from './BottomPanel';
import ExplorerPanel, { BottomSections } from './Sidebar/ExplorerPanel';
import SourceControlPanel from './Sidebar/SourceControlPanel';
import RunDebugPanel from './Sidebar/RunDebugPanel';
import AgentsPanel from './Sidebar/AgentsPanel';
import SearchPanel from './Sidebar/SearchPanel';
import {
  Bot,
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Plus,
  Search,
  GitBranch,
  Bug,
  Blocks,
  ListTree,
  History,
  Globe,
  RefreshCw,
  PlusCircle,
  MinusCircle,
  CheckCircle2,
  GitCommit,
  Play,
  Terminal as TerminalIcon,
  Package,
  Hammer,
  Loader2,
  XCircle,
  Pencil,
  Save,
  Trash2,
  RotateCcw,
  FileCode2,
  ArrowUp,
  ArrowDown,
  UploadCloud,
  Sparkles,
  Github,
  Copy,
  LogOut,
  ExternalLink,
  Orbit,
} from 'lucide-react';
import { generateCommitMessage } from '../ai/quickActions';

// ─────────────────────────────────────────────────────────────────────────
// Placeholder panels (for non-explorer activity items)
// ─────────────────────────────────────────────────────────────────────────
function PlaceholderPanel({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-forge-text">
      {icon}
      <p className="text-sm">{title}</p>
      <p className="text-xs text-forge-text/60">Coming soon</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SideBar root
// ─────────────────────────────────────────────────────────────────────────
export default function SideBar() {
  const activeSidebarPanel = useStore((s) => s.activeSidebarPanel);

  const renderTopArea = () => {
    switch (activeSidebarPanel) {
      case 'explorer':
        return <ExplorerPanel />;
      case 'search':
        return <SearchPanel />;
      case 'git':
        return <SourceControlPanel />;
      case 'debug':
        return <RunDebugPanel />;
      case 'agents':
        return <AgentsPanel />;
      case 'extensions':
        return <ExtensionsPanel />;
      case 'settings':
        return <SettingsPanel />;
      default:
        return <ExplorerPanel />;
    }
  };

  const showBottomSections = activeSidebarPanel === 'explorer';

  return (
    <div className="w-full h-full bg-forge-sidebar flex flex-col border-r border-forge-border/40 overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col">
        {renderTopArea()}
      </div>
      {showBottomSections && <BottomSections />}
    </div>
  );
}

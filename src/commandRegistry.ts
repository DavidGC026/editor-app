import type { Command, GitChange, Tab } from './types';
import { isHtmlFile, isImageFile } from './types';

export interface CommandBuildContext {
  activeTab?: Tab;
  workspacePath: string | null;
  gitChanges: GitChange[];
  gitIsRepo: boolean;
  installedExtensionThemeCount: number;
  autoSave: boolean;
  formatOnSave: boolean;
  wordWrap: boolean;
  minimapEnabled: boolean;
  close: () => void;
  openFolder: () => Promise<void>;
  saveFile: (tabId?: string) => Promise<void>;
  setQuickOpenOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  setSidebarPanel: (panel: import('./types').SidebarPanel) => void;
  setBottomTab: (tab: import('./types').BottomTab) => void;
  toggleAIPanel: () => void;
  runCommandInTerminal: (command: string) => void;
  runAgentInTerminal: (agentId: import('./types').AgentTerminalId) => void;
  installVsixExtension: () => Promise<string | null>;
  installExtensionById: (id: string) => Promise<string | null>;
  setColorTheme: (themeId: string) => Promise<void>;
  toggleLiveServer: (htmlPath?: string) => Promise<void>;
  toggleActiveGitDiffMode: () => void;
  openGitDiff: (relPath: string, staged?: boolean) => Promise<void>;
  setAutoSave: (enabled: boolean) => void;
  setFormatOnSave: (enabled: boolean) => void;
  setWordWrap: (enabled: boolean) => void;
  setMinimapEnabled: (enabled: boolean) => void;
  themeCommands: Command[];
}

function relPath(workspacePath: string, filePath: string): string {
  const root = workspacePath.replace(/\\/g, '/');
  const file = filePath.replace(/\\/g, '/');
  return file.startsWith(root + '/') ? file.slice(root.length + 1) : file;
}

function gitChangeForFile(
  changes: GitChange[],
  workspacePath: string,
  filePath: string,
): GitChange | null {
  const rel = relPath(workspacePath, filePath);
  return changes.find((c) => c.relPath === rel) ?? null;
}

function withCategory(label: string, category: string, rest: Omit<Command, 'label' | 'category'>): Command {
  return { label, category, ...rest };
}

export function buildCommands(ctx: CommandBuildContext): Command[] {
  const { close, activeTab, workspacePath, gitChanges, gitIsRepo } = ctx;
  const wrap = (fn: () => void) => () => { fn(); close(); };

  const commands: Command[] = [
    withCategory('Open Folder', 'File', {
      id: 'open-folder',
      keywords: ['workspace', 'carpeta', 'abrir'],
      action: wrap(() => void ctx.openFolder()),
    }),
    withCategory('Save', 'File', {
      id: 'save-file',
      shortcut: 'Ctrl+S',
      keywords: ['guardar'],
      action: wrap(() => void ctx.saveFile()),
    }),
    withCategory('Quick Open', 'File', {
      id: 'quick-open',
      shortcut: 'Ctrl+P',
      keywords: ['archivo', 'find', 'go to'],
      action: wrap(() => ctx.setQuickOpenOpen(true)),
    }),
    withCategory('Toggle Sidebar', 'View', {
      id: 'toggle-sidebar',
      shortcut: 'Ctrl+B',
      action: wrap(() => ctx.toggleSidebar()),
    }),
    withCategory('Toggle Panel', 'View', {
      id: 'toggle-panel',
      shortcut: 'Ctrl+`',
      action: wrap(() => ctx.togglePanel()),
    }),
    withCategory('Show Explorer', 'View', {
      id: 'show-explorer',
      keywords: ['files', 'tree'],
      action: wrap(() => ctx.setSidebarPanel('explorer')),
    }),
    withCategory('Show Search', 'View', {
      id: 'show-search',
      keywords: ['find in files'],
      action: wrap(() => ctx.setSidebarPanel('search')),
    }),
    withCategory('Show Source Control', 'View', {
      id: 'show-git',
      keywords: ['git', 'scm'],
      action: wrap(() => ctx.setSidebarPanel('git')),
    }),
    withCategory('Show Run and Debug', 'View', {
      id: 'show-debug',
      keywords: ['run', 'terminal commands'],
      action: wrap(() => ctx.setSidebarPanel('debug')),
    }),
    withCategory('Show Extensions', 'View', {
      id: 'show-extensions',
      keywords: ['marketplace', 'vsix', 'themes'],
      action: wrap(() => ctx.setSidebarPanel('extensions')),
    }),
    withCategory('Open Settings', 'View', {
      id: 'show-settings',
      keywords: ['preferences', 'ajustes'],
      action: wrap(() => ctx.setSidebarPanel('settings')),
    }),
    withCategory('Focus Integrated Terminal', 'Terminal', {
      id: 'show-terminal',
      action: wrap(() => ctx.setBottomTab('terminal')),
    }),
    withCategory('Show Problems', 'Terminal', {
      id: 'show-problems',
      keywords: ['diagnostics', 'errors'],
      action: wrap(() => ctx.setBottomTab('problems')),
    }),
    withCategory('Show Output', 'Terminal', {
      id: 'show-output',
      action: wrap(() => ctx.setBottomTab('output')),
    }),
    withCategory('Toggle AI Panel', 'AI', {
      id: 'ai-panel',
      keywords: ['assistant', 'chat'],
      action: wrap(() => ctx.toggleAIPanel()),
    }),
    withCategory('Start Codex', 'Agent', {
      id: 'agent-codex',
      action: wrap(() => ctx.runAgentInTerminal('codex')),
    }),
    withCategory('Start Claude Code', 'Agent', {
      id: 'agent-claude',
      action: wrap(() => ctx.runAgentInTerminal('claude')),
    }),
    withCategory('Start Cursor Agent', 'Agent', {
      id: 'agent-cursor',
      action: wrap(() => ctx.runAgentInTerminal('cursor-agent')),
    }),
    withCategory('pnpm dev', 'Run', {
      id: 'run-pnpm-dev',
      action: wrap(() => ctx.runCommandInTerminal('pnpm dev')),
    }),
    withCategory('pnpm start', 'Run', {
      id: 'run-pnpm-start',
      action: wrap(() => ctx.runCommandInTerminal('pnpm start')),
    }),
    withCategory('pnpm build', 'Run', {
      id: 'run-pnpm-build',
      action: wrap(() => ctx.runCommandInTerminal('pnpm build')),
    }),
    withCategory('pnpm package', 'Run', {
      id: 'run-pnpm-package',
      action: wrap(() => ctx.runCommandInTerminal('pnpm package')),
    }),
    withCategory('Toggle Current File', 'Live Server', {
      id: 'live-server',
      keywords: ['html', 'preview', 'browser'],
      action: wrap(() => void ctx.toggleLiveServer(activeTab?.path)),
    }),
    withCategory('Install from VSIX', 'Extensions', {
      id: 'install-vsix',
      action: wrap(() => void ctx.installVsixExtension()),
    }),
    withCategory('Color Theme — Forge Dark', 'Preferences', {
      id: 'theme-forge-dark',
      keywords: ['theme', 'dark'],
      action: wrap(() => void ctx.setColorTheme('forge-dark')),
    }),
    withCategory(`Toggle Auto Save (${ctx.autoSave ? 'On' : 'Off'})`, 'Preferences', {
      id: 'pref-auto-save',
      keywords: ['autosave', 'guardar'],
      action: wrap(() => ctx.setAutoSave(!ctx.autoSave)),
    }),
    withCategory(`Toggle Format on Save (${ctx.formatOnSave ? 'On' : 'Off'})`, 'Preferences', {
      id: 'pref-format-save',
      keywords: ['format', 'prettier'],
      action: wrap(() => ctx.setFormatOnSave(!ctx.formatOnSave)),
    }),
    withCategory(`Toggle Word Wrap (${ctx.wordWrap ? 'On' : 'Off'})`, 'Preferences', {
      id: 'pref-word-wrap',
      action: wrap(() => ctx.setWordWrap(!ctx.wordWrap)),
    }),
    withCategory(`Toggle Minimap (${ctx.minimapEnabled ? 'On' : 'Off'})`, 'Preferences', {
      id: 'pref-minimap',
      action: wrap(() => ctx.setMinimapEnabled(!ctx.minimapEnabled)),
    }),
    ...ctx.themeCommands,
  ];

  if (activeTab?.gitDiff) {
    commands.unshift(withCategory('Toggle Diff View (Inline / Side by Side)', 'Git', {
      id: 'git-toggle-diff',
      keywords: ['diff', 'compare'],
      action: wrap(() => ctx.toggleActiveGitDiffMode()),
    }));
  }

  if (workspacePath && gitIsRepo && activeTab && !activeTab.gitDiff && !activeTab.imageDataUrl) {
    const change = gitChangeForFile(gitChanges, workspacePath, activeTab.path);
    if (change) {
      commands.unshift(withCategory(`Open Git Diff — ${change.relPath}`, 'Git', {
        id: 'ctx-git-diff',
        keywords: ['changes', 'source control'],
        action: wrap(() => void ctx.openGitDiff(change.relPath, false)),
      }));
    }
  }

  if (activeTab && isHtmlFile(activeTab.path)) {
    commands.unshift(withCategory('Toggle Live Server for Active HTML', 'Live Server', {
      id: 'ctx-live-server',
      action: wrap(() => void ctx.toggleLiveServer(activeTab.path)),
    }));
  }

  if (activeTab && !isImageFile(activeTab.path) && !activeTab.gitDiff) {
    commands.unshift(withCategory('Save Active File', 'File', {
      id: 'ctx-save-active',
      shortcut: 'Ctrl+S',
      action: wrap(() => void ctx.saveFile(activeTab.id)),
    }));
  }

  return commands;
}

export function categoryOrder(category: string): number {
  const order = [
    'Recently Used',
    'Git',
    'File',
    'View',
    'Terminal',
    'Run',
    'Live Server',
    'AI',
    'Agent',
    'Extensions',
    'Preferences',
  ];
  const idx = order.indexOf(category);
  return idx === -1 ? 50 : idx;
}

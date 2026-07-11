import type { Command, GitChange, Tab } from './types';
import { isHtmlFile, isImageFile } from './types';
import { runEditorAIAction, type EditorAIActionKind } from './ai/quickActions';
import { useStore } from './store';

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
    const monaco = (actionId: string) => () => {
      void useStore.getState().runEditorAction?.(actionId);
    };
    commands.push(
      withCategory('Go to Line/Column…', 'Editor', {
        id: 'editor-goto-line',
        shortcut: 'Ctrl+G',
        keywords: ['ir a línea', 'jump'],
        action: wrap(monaco('editor.action.gotoLine')),
      }),
      withCategory('Format Document', 'Editor', {
        id: 'editor-format',
        shortcut: 'Shift+Alt+F',
        keywords: ['formatear', 'prettier', 'indent'],
        action: wrap(monaco('editor.action.formatDocument')),
      }),
      withCategory('Toggle Line Comment', 'Editor', {
        id: 'editor-toggle-comment',
        shortcut: 'Ctrl+/',
        keywords: ['comentar', 'comment'],
        action: wrap(monaco('editor.action.commentLine')),
      }),
      withCategory('Duplicate Line Down', 'Editor', {
        id: 'editor-duplicate-line',
        shortcut: 'Shift+Alt+↓',
        keywords: ['duplicar línea', 'copy line'],
        action: wrap(monaco('editor.action.copyLinesDownAction')),
      }),
      withCategory('Delete Line', 'Editor', {
        id: 'editor-delete-line',
        shortcut: 'Ctrl+Shift+K',
        keywords: ['borrar línea'],
        action: wrap(monaco('editor.action.deleteLines')),
      }),
      withCategory('Rename Symbol', 'Editor', {
        id: 'editor-rename-symbol',
        shortcut: 'F2',
        keywords: ['renombrar símbolo', 'refactor'],
        action: wrap(monaco('editor.action.rename')),
      }),
      withCategory('Change All Occurrences', 'Editor', {
        id: 'editor-change-occurrences',
        shortcut: 'Ctrl+F2',
        keywords: ['ocurrencias', 'multi cursor'],
        action: wrap(monaco('editor.action.changeAll')),
      }),
      withCategory('Fold All', 'Editor', {
        id: 'editor-fold-all',
        keywords: ['plegar', 'collapse'],
        action: wrap(monaco('editor.foldAll')),
      }),
      withCategory('Unfold All', 'Editor', {
        id: 'editor-unfold-all',
        keywords: ['desplegar', 'expand'],
        action: wrap(monaco('editor.unfoldAll')),
      }),
    );
  }

  if (ctx.activeTab) {
    commands.push(
      withCategory('Close Active Tab', 'File', {
        id: 'tab-close',
        shortcut: 'Ctrl+W',
        keywords: ['cerrar pestaña'],
        action: wrap(() => {
          const s = useStore.getState();
          if (s.activeTabId) s.closeTab(s.activeTabId);
        }),
      }),
      withCategory(ctx.activeTab.pinned ? 'Unpin Active Tab' : 'Pin Active Tab', 'File', {
        id: 'tab-toggle-pin',
        keywords: ['pin', 'fijar', 'anclar'],
        action: wrap(() => {
          const s = useStore.getState();
          if (s.activeTabId) s.togglePinTab(s.activeTabId);
        }),
      }),
      withCategory('Close Other Tabs', 'File', {
        id: 'tab-close-others',
        action: wrap(() => {
          const s = useStore.getState();
          if (s.activeTabId) s.closeOtherTabs(s.activeTabId);
        }),
      }),
      withCategory('Close All Tabs', 'File', {
        id: 'tab-close-all',
        action: wrap(() => useStore.getState().closeAllTabs()),
      }),
      withCategory('Copy Path of Active File', 'File', {
        id: 'copy-active-path',
        keywords: ['ruta', 'path'],
        action: wrap(() => {
          const tab = ctx.activeTab;
          if (tab && !tab.gitDiff) void navigator.clipboard.writeText(tab.path);
        }),
      }),
      withCategory('Reveal Active File in File Manager', 'File', {
        id: 'reveal-active-file',
        keywords: ['explorador', 'carpeta', 'folder'],
        action: wrap(() => {
          const tab = ctx.activeTab;
          if (tab && !tab.gitDiff) void window.electronAPI.revealInFolder(tab.path);
        }),
      }),
    );
  }

  if (activeTab && !isImageFile(activeTab.path) && !activeTab.gitDiff) {
    const aiOnActiveFile = (kind: EditorAIActionKind) => () => {
      void runEditorAIAction(
        kind,
        {
          relPath: workspacePath ? relPath(workspacePath, activeTab.path) : activeTab.name,
          language: activeTab.language || 'plaintext',
          code: activeTab.content,
          wholeFile: true,
        },
        activeTab.path,
      );
    };
    commands.push(
      withCategory('IA: Explicar archivo actual', 'AI', {
        id: 'ai-explain-file',
        keywords: ['explain', 'explicar', 'entender'],
        action: wrap(aiOnActiveFile('explain')),
      }),
      withCategory('IA: Refactorizar archivo actual', 'AI', {
        id: 'ai-refactor-file',
        keywords: ['refactor', 'mejorar', 'limpiar'],
        action: wrap(aiOnActiveFile('refactor')),
      }),
      withCategory('IA: Documentar archivo actual', 'AI', {
        id: 'ai-document-file',
        keywords: ['document', 'comentarios', 'jsdoc'],
        action: wrap(aiOnActiveFile('document')),
      }),
      withCategory('IA: Corregir con diagnósticos', 'AI', {
        id: 'ai-fix-file',
        keywords: ['fix', 'errores', 'problems', 'diagnostics'],
        action: wrap(aiOnActiveFile('fix')),
      }),
    );
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
    'Editor',
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

import { StateCreator } from 'zustand';
import {
  GitChange,
  GitBranchEntry,
  GitLogEntry,
  Tab,
  getLanguageFromPath,
} from '../../types';

// Helper
function cleanIpcError(message: string): string {
  const marker = 'Error invoking remote method';
  if (message.includes(marker)) {
    const parts = message.split(': ');
    parts.shift(); // remove "Error invoking remote method"
    parts.shift(); // remove "git:..."
    return parts.join(': ').trim();
  }
  return message;
}

function joinPath(parent: string, name: string): string {
  if (parent.endsWith('/')) return `${parent}${name}`;
  return `${parent}/${name}`;
}

export interface GitDependencies {
  workspacePath: string | null;
  openTabs: Tab[];
  activeTabId: string | null;
  gitDiffMode: 'inline' | 'side-by-side';
  setGitDiffMode: (mode: 'inline' | 'side-by-side') => void;
  closeTab: (tabId: string) => void;
  activeSidebarPanel?: any; // From layout slice but just to be safe
}

export interface GitSlice {
  gitIsRepo: boolean;
  gitBranch: string | null;
  gitBranches: GitBranchEntry[];
  gitChanges: GitChange[];
  gitAhead: number;
  gitBehind: number;
  gitHasUpstream: boolean;
  gitHasRemote: boolean;
  gitBusy: boolean;
  gitSyncBusy: boolean;
  gitError: string | null;

  refreshGitStatus: () => Promise<void>;
  refreshGitBranches: () => Promise<void>;
  gitCheckoutBranch: (branchName: string) => Promise<boolean>;
  gitCreateBranch: (branchName: string) => Promise<boolean>;
  gitStageFiles: (relPaths: string[]) => Promise<void>;
  gitUnstageFiles: (relPaths: string[]) => Promise<void>;
  gitCommitChanges: (message: string) => Promise<boolean>;
  gitDiscardFiles: (relPaths: string[]) => Promise<void>;
  gitPushChanges: () => Promise<boolean>;
  gitPullChanges: () => Promise<boolean>;
  openGitDiff: (relPath: string, staged?: boolean) => Promise<void>;
  openGitCommitDiff: (relPath: string, entry: GitLogEntry) => Promise<void>;
  toggleActiveGitDiffMode: () => void;
}

export const createGitSlice: StateCreator<
  GitSlice & GitDependencies & { selectedPath?: string | null; selectedKind?: string | null; activeTabId: string | null },
  [],
  [],
  GitSlice
> = (set, get) => ({
  gitIsRepo: false,
  gitBranch: null,
  gitBranches: [],
  gitChanges: [],
  gitAhead: 0,
  gitBehind: 0,
  gitHasUpstream: false,
  gitHasRemote: false,
  gitBusy: false,
  gitSyncBusy: false,
  gitError: null,

  refreshGitStatus: async () => {
    const { workspacePath } = get();
    const empty = {
      gitIsRepo: false,
      gitBranch: null,
      gitBranches: [] as GitBranchEntry[],
      gitChanges: [] as GitChange[],
      gitAhead: 0,
      gitBehind: 0,
      gitHasUpstream: false,
      gitHasRemote: false,
    };
    if (!workspacePath || !window.electronAPI?.git) {
      set(empty);
      return;
    }
    try {
      const status = await window.electronAPI.git.status(workspacePath);
      set({
        gitIsRepo: status.isRepo,
        gitBranch: status.branch,
        gitChanges: status.changes,
        gitAhead: status.ahead ?? 0,
        gitBehind: status.behind ?? 0,
        gitHasUpstream: Boolean(status.hasUpstream),
        gitHasRemote: Boolean(status.hasRemote),
      });
      void get().refreshGitBranches();
    } catch (err) {
      console.warn('[forge] git status failed:', (err as Error).message);
      set(empty);
    }
  },

  refreshGitBranches: async () => {
    const { workspacePath, gitIsRepo } = get();
    if (!workspacePath || !gitIsRepo || !window.electronAPI?.git) {
      set({ gitBranches: [] });
      return;
    }
    try {
      const branches = await window.electronAPI.git.branches(workspacePath);
      set({ gitBranches: branches });
    } catch {
      set({ gitBranches: [] });
    }
  },

  gitCheckoutBranch: async (branchName: string) => {
    const { workspacePath } = get();
    if (!workspacePath || !branchName.trim()) return false;
    set({ gitBusy: true, gitError: null });
    try {
      await window.electronAPI.git.checkoutBranch(workspacePath, branchName);
      return true;
    } catch (err) {
      set({ gitError: cleanIpcError((err as Error).message) });
      return false;
    } finally {
      set({ gitBusy: false });
      await get().refreshGitStatus();
    }
  },

  gitCreateBranch: async (branchName: string) => {
    const { workspacePath } = get();
    if (!workspacePath || !branchName.trim()) return false;
    set({ gitBusy: true, gitError: null });
    try {
      await window.electronAPI.git.createBranch(workspacePath, branchName);
      return true;
    } catch (err) {
      set({ gitError: cleanIpcError((err as Error).message) });
      return false;
    } finally {
      set({ gitBusy: false });
      await get().refreshGitStatus();
    }
  },

  gitStageFiles: async (relPaths: string[]) => {
    const { workspacePath } = get();
    if (!workspacePath || relPaths.length === 0) return;
    set({ gitBusy: true, gitError: null });
    try {
      await window.electronAPI.git.stage(workspacePath, relPaths);
    } catch (err) {
      set({ gitError: cleanIpcError((err as Error).message) });
    } finally {
      set({ gitBusy: false });
      await get().refreshGitStatus();
    }
  },

  gitUnstageFiles: async (relPaths: string[]) => {
    const { workspacePath } = get();
    if (!workspacePath || relPaths.length === 0) return;
    set({ gitBusy: true, gitError: null });
    try {
      await window.electronAPI.git.unstage(workspacePath, relPaths);
    } catch (err) {
      set({ gitError: cleanIpcError((err as Error).message) });
    } finally {
      set({ gitBusy: false });
      await get().refreshGitStatus();
    }
  },

  gitCommitChanges: async (message: string) => {
    const { workspacePath } = get();
    if (!workspacePath) return false;
    set({ gitBusy: true, gitError: null });
    try {
      await window.electronAPI.git.commit(workspacePath, message);
      return true;
    } catch (err) {
      set({ gitError: cleanIpcError((err as Error).message) });
      return false;
    } finally {
      set({ gitBusy: false });
      await get().refreshGitStatus();
    }
  },

  gitDiscardFiles: async (relPaths: string[]) => {
    const { workspacePath } = get();
    if (!workspacePath || relPaths.length === 0) return;
    set({ gitBusy: true, gitError: null });
    try {
      await window.electronAPI.git.discard(workspacePath, relPaths);
      const affected = new Set(relPaths.map((rel) => joinPath(workspacePath, rel)));
      for (const tab of get().openTabs) {
        if (!affected.has(tab.path) || tab.gitDiff || tab.imageDataUrl) continue;
        try {
          const content = await window.electronAPI.agent.readFileSafe(workspacePath, tab.path);
          if (content === null) {
            get().closeTab(tab.id);
          } else {
            set((state) => ({
              openTabs: state.openTabs.map((t) =>
                t.id === tab.id
                  ? { ...t, content, savedContent: content, isUnsaved: false }
                  : t,
              ),
            }));
          }
        } catch {
          get().closeTab(tab.id);
        }
      }
    } catch (err) {
      set({ gitError: cleanIpcError((err as Error).message) });
    } finally {
      set({ gitBusy: false });
      await get().refreshGitStatus();
    }
  },

  gitPushChanges: async () => {
    const { workspacePath } = get();
    if (!workspacePath) return false;
    set({ gitSyncBusy: true, gitError: null });
    try {
      await window.electronAPI.git.push(workspacePath);
      return true;
    } catch (err) {
      set({ gitError: cleanIpcError((err as Error).message) });
      return false;
    } finally {
      set({ gitSyncBusy: false });
      await get().refreshGitStatus();
    }
  },

  gitPullChanges: async () => {
    const { workspacePath } = get();
    if (!workspacePath) return false;
    set({ gitSyncBusy: true, gitError: null });
    try {
      await window.electronAPI.git.pull(workspacePath);
      return true;
    } catch (err) {
      set({ gitError: cleanIpcError((err as Error).message) });
      return false;
    } finally {
      set({ gitSyncBusy: false });
      await get().refreshGitStatus();
    }
  },

  openGitDiff: async (relPath: string, staged = false) => {
    const { workspacePath, gitDiffMode, openTabs } = get();
    if (!workspacePath || !relPath.trim()) return;

    const tabId = `git-diff:${staged ? 'staged' : 'working'}:${relPath}`;
    const existing = openTabs.find((t) => t.id === tabId);
    if (existing) {
      set({ activeTabId: tabId, selectedPath: joinPath(workspacePath, relPath), selectedKind: 'file' } as any);
      return;
    }

    try {
      const versions = await window.electronAPI.git.fileVersions(workspacePath, relPath, staged);
      const fullPath = joinPath(workspacePath, relPath);
      const name = relPath.split('/').pop() || relPath;
      const language = getLanguageFromPath(relPath);
      const newTab: Tab = {
        id: tabId,
        name: `${name} (Git)`,
        path: fullPath,
        content: versions.modified,
        savedContent: versions.modified,
        language,
        isUnsaved: false,
        gitDiff: {
          relPath,
          staged,
          original: versions.original,
          modified: versions.modified,
          mode: gitDiffMode,
        },
      };
      set((state) => ({
        openTabs: [...state.openTabs, newTab],
        activeTabId: tabId,
        selectedPath: fullPath,
        selectedKind: 'file',
      }) as any);
    } catch (err) {
      console.warn('[forge] openGitDiff failed:', (err as Error).message);
    }
  },

  openGitCommitDiff: async (relPath: string, entry: GitLogEntry) => {
    const { workspacePath, gitDiffMode, openTabs } = get();
    if (!workspacePath || !relPath.trim() || !entry.hash) return;

    const tabId = `git-history:${entry.hash}:${relPath}`;
    const existing = openTabs.find((t) => t.id === tabId);
    if (existing) {
      set({ activeTabId: tabId });
      return;
    }

    try {
      const versions = await window.electronAPI.git.commitFileVersions(
        workspacePath,
        relPath,
        entry.hash,
      );
      const fullPath = joinPath(workspacePath, relPath);
      const name = relPath.split('/').pop() || relPath;
      const language = getLanguageFromPath(relPath);
      const newTab: Tab = {
        id: tabId,
        name: `${name} (${entry.shortHash})`,
        path: fullPath,
        content: versions.modified,
        savedContent: versions.modified,
        language,
        isUnsaved: false,
        gitDiff: {
          relPath,
          staged: false,
          original: versions.original,
          modified: versions.modified,
          mode: gitDiffMode,
          commitHash: entry.hash,
          commitLabel: `${entry.shortHash} · ${entry.subject}`,
        },
      };
      set((state) => ({
        openTabs: [...state.openTabs, newTab],
        activeTabId: tabId,
        selectedPath: fullPath,
        selectedKind: 'file',
      }) as any);
    } catch (err) {
      console.warn('[forge] openGitCommitDiff failed:', (err as Error).message);
    }
  },

  toggleActiveGitDiffMode: () => {
    const { activeTabId, openTabs, gitDiffMode } = get();
    const tab = openTabs.find((t) => t.id === activeTabId);
    if (!tab?.gitDiff) return;
    const next = gitDiffMode === 'inline' ? 'side-by-side' : 'inline';
    get().setGitDiffMode(next);
  },
});

import { StateCreator } from 'zustand';
import { SidebarPanel, BottomTab, AgentTerminalId } from '../../types';

export const LAYOUT_STORAGE_KEY = 'forge.layout.v1';

export interface PersistedLayoutSettings {
  sidebarWidth: number;
  bottomPanelHeight: number;
  aiPanelWidth: number;
  agentTerminalDock: 'bottom' | 'sidebar' | 'right';
  rightPanelMaximized: boolean;
}

export const DEFAULT_LAYOUT_SETTINGS: PersistedLayoutSettings = {
  sidebarWidth: 250,
  bottomPanelHeight: 260,
  aiPanelWidth: 360,
  agentTerminalDock: 'right',
  rightPanelMaximized: false,
};

export function loadLayoutSettings(): PersistedLayoutSettings {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT_SETTINGS;
    const parsed = JSON.parse(raw);
    const dock = parsed?.agentTerminalDock;
    return {
      sidebarWidth: Math.max(150, Math.min(500, Math.round(Number(parsed?.sidebarWidth ?? 250)))),
      bottomPanelHeight: Math.max(100, Math.round(Number(parsed?.bottomPanelHeight ?? 260))),
      aiPanelWidth: Math.max(280, Math.min(720, Math.round(Number(parsed?.aiPanelWidth ?? 360)))),
      agentTerminalDock: dock === 'bottom' || dock === 'sidebar' || dock === 'right' ? dock : 'right',
      rightPanelMaximized: Boolean(parsed?.rightPanelMaximized),
    };
  } catch {
    return DEFAULT_LAYOUT_SETTINGS;
  }
}

export function persistLayoutSettings(patch: Partial<PersistedLayoutSettings>): void {
  try {
    const current = loadLayoutSettings();
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    /* best-effort */
  }
}

export const initialLayoutSettings = loadLayoutSettings();

export interface LayoutSlice {
  sidebarVisible: boolean;
  bottomPanelVisible: boolean;
  activeSidebarPanel: SidebarPanel;
  activeBottomTab: BottomTab;
  sidebarWidth: number;
  bottomPanelHeight: number;
  rightPanelMaximized: boolean;
  aiPanelWidth: number;
  agentTerminalDock: 'bottom' | 'sidebar' | 'right';
  
  toggleSidebar: () => void;
  togglePanel: () => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setBottomTab: (tab: BottomTab) => void;
  setSidebarWidth: (width: number) => void;
  setBottomPanelHeight: (height: number) => void;
  setRightPanelMaximized: (maximized: boolean) => void;
  setAIPanelWidth: (width: number) => void;
  setAgentTerminalDock: (dock: 'bottom' | 'sidebar' | 'right') => void;
}

export const createLayoutSlice: StateCreator<any, [], [], LayoutSlice> = (set) => ({
  sidebarVisible: true,
  bottomPanelVisible: false,
  activeSidebarPanel: 'explorer',
  activeBottomTab: 'terminal',
  sidebarWidth: initialLayoutSettings.sidebarWidth,
  bottomPanelHeight: initialLayoutSettings.bottomPanelHeight,
  rightPanelMaximized: initialLayoutSettings.rightPanelMaximized,
  aiPanelWidth: initialLayoutSettings.aiPanelWidth,
  agentTerminalDock: initialLayoutSettings.agentTerminalDock,

  toggleSidebar: () => set((state: any) => ({ sidebarVisible: !state.sidebarVisible })),
  
  togglePanel: () => set((state: any) => ({ bottomPanelVisible: !state.bottomPanelVisible })),
  
  setSidebarPanel: (panel: SidebarPanel) => set((state: any) => {
    if (state.activeSidebarPanel === panel && state.sidebarVisible) {
      return { sidebarVisible: false };
    }
    return { activeSidebarPanel: panel, sidebarVisible: true };
  }),
  
  setBottomTab: (tab: BottomTab) => set({ activeBottomTab: tab, bottomPanelVisible: true }),
  
  setSidebarWidth: (width: number) => {
    const clamped = Math.max(150, Math.min(500, Math.round(width)));
    persistLayoutSettings({ sidebarWidth: clamped });
    set({ sidebarWidth: clamped });
  },
  
  setBottomPanelHeight: (height: number) => {
    const next = Math.max(100, Math.round(height));
    persistLayoutSettings({ bottomPanelHeight: next });
    set({ bottomPanelHeight: next });
  },
  
  setRightPanelMaximized: (maximized: boolean) => {
    persistLayoutSettings({ rightPanelMaximized: maximized });
    set({ rightPanelMaximized: maximized });
  },
  
  setAIPanelWidth: (width: number) => {
    const clamped = Math.max(280, Math.min(720, Math.round(width)));
    persistLayoutSettings({ aiPanelWidth: clamped });
    set({ aiPanelWidth: clamped });
  },
  
  setAgentTerminalDock: (dock: 'bottom' | 'sidebar' | 'right') => {
    persistLayoutSettings({ agentTerminalDock: dock });
    set({ agentTerminalDock: dock });
  },
});

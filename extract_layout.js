const fs = require('fs');

let content = fs.readFileSync('src/store.ts', 'utf8');

content = content.replace(
  `import { create } from 'zustand';`,
  `import { create } from 'zustand';\nimport { LayoutSlice, createLayoutSlice } from './store/slices/layoutSlice';`
);

content = content.replace(
  `interface EditorState {`,
  `interface EditorState extends LayoutSlice {`
);

content = content.replace(
  `  // Layout\n  sidebarVisible: boolean;\n  bottomPanelVisible: boolean;\n  activeSidebarPanel: SidebarPanel;\n  activeBottomTab: BottomTab;\n  /** Width of the sidebar column, in CSS pixels. */\n  sidebarWidth: number;\n  /** Height of the bottom panel (terminal), in CSS pixels. */\n  bottomPanelHeight: number;\n  rightPanelMaximized: boolean;\n`,
  `  // Layout (moved to LayoutSlice)\n`
);

content = content.replace(
  `  aiPanelWidth: number;\n`,
  ``
);

content = content.replace(
  `  agentTerminalDock: 'bottom' | 'sidebar' | 'right';\n`,
  ``
);

content = content.replace(
  `  toggleSidebar: () => void;\n  togglePanel: () => void;\n  setSidebarPanel: (panel: SidebarPanel) => void;\n  setBottomTab: (tab: BottomTab) => void;\n  setSidebarWidth: (width: number) => void;\n  setBottomPanelHeight: (height: number) => void;\n  setRightPanelMaximized: (maximized: boolean) => void;\n`,
  ``
);

content = content.replace(
  `  setAIPanelWidth: (width: number) => void;\n`,
  ``
);

content = content.replace(
  `  setAgentTerminalDock: (dock: 'bottom' | 'sidebar' | 'right') => void;\n`,
  ``
);

const persistMatch = content.match(/interface PersistedLayoutSettings \{.*?function persistLayoutSettings.*?\}\s+catch \{\s+\/\* best-effort \*\/\s+\}\s+\}\s+const initialLayoutSettings = loadLayoutSettings\(\);\n/s);
if (persistMatch) {
  content = content.replace(persistMatch[0], '');
}

content = content.replace(
  `export const useStore = create<EditorState>((set, get) => ({`,
  `export const useStore = create<EditorState>((set, get, api) => ({\n  ...createLayoutSlice(set, get, api as any),`
);

const stateMatch = content.match(/  sidebarVisible: true,\n  bottomPanelVisible: false,\n  activeSidebarPanel: 'explorer',\n  activeBottomTab: 'terminal',\n  sidebarWidth: initialLayoutSettings\.sidebarWidth,\n  bottomPanelHeight: initialLayoutSettings\.bottomPanelHeight,\n  rightPanelMaximized: initialLayoutSettings\.rightPanelMaximized,\n/s);
if (stateMatch) {
  content = content.replace(stateMatch[0], '');
}

content = content.replace(`  aiPanelWidth: 360,\n`, ``);
content = content.replace(`  agentTerminalDock: initialLayoutSettings.agentTerminalDock,\n`, ``);
content = content.replace(`  aiPanelWidth: initialLayoutSettings.aiPanelWidth,\n`, ``);

const layoutFuncsMatch = content.match(/  toggleSidebar: \(\) => \{\s+set\(\(state\) => \(\{ sidebarVisible: !state\.sidebarVisible \}\)\);\s+\},\s+togglePanel: \(\) => \{\s+set\(\(state\) => \(\{ bottomPanelVisible: !state\.bottomPanelVisible \}\)\);\s+\},\s+setSidebarPanel: \(panel: SidebarPanel\) => \{\s+set\(\(state\) => \{\s+if \(state\.activeSidebarPanel === panel && state\.sidebarVisible\) \{\s+return \{ sidebarVisible: false \};\s+\}\s+return \{ activeSidebarPanel: panel, sidebarVisible: true \};\s+\}\);\s+\},\s+setBottomTab: \(tab: BottomTab\) => \{\s+set\(\{ activeBottomTab: tab, bottomPanelVisible: true \}\);\s+\},\s+setSidebarWidth: \(width: number\) => \{\s+\/\/ Clamp to sane bounds matching the divider behaviour in App\.tsx\.\s+const clamped = Math\.max\(150, Math\.min\(500, Math\.round\(width\)\)\);\s+persistLayoutSettings\(\{ sidebarWidth: clamped \}\);\s+set\(\{ sidebarWidth: clamped \}\);\s+\},\s+setBottomPanelHeight: \(height: number\) => \{\s+\/\/ App\.tsx is responsible for clamping against the available viewport\s+\/\/ height \(it knows the dynamic max\)\. We just round to integer pixels\.\s+const next = Math\.max\(100, Math\.round\(height\)\);\s+persistLayoutSettings\(\{ bottomPanelHeight: next \}\);\s+set\(\{ bottomPanelHeight: next \}\);\s+\},\s+setRightPanelMaximized: \(maximized: boolean\) => \{\s+persistLayoutSettings\(\{ rightPanelMaximized: maximized \}\);\s+set\(\{ rightPanelMaximized: maximized \}\);\s+\},\n/s);

if (layoutFuncsMatch) {
  content = content.replace(layoutFuncsMatch[0], '');
}

const aiWidthMatch = content.match(/  setAIPanelWidth: \(width: number\) => \{\s+const clamped = Math\.max\(280, Math\.min\(720, Math\.round\(width\)\)\);\s+persistLayoutSettings\(\{ aiPanelWidth: clamped \}\);\s+set\(\{ aiPanelWidth: clamped \}\);\s+\},\n/s);
if (aiWidthMatch) {
  content = content.replace(aiWidthMatch[0], '');
}

const agentDockMatch = content.match(/  setAgentTerminalDock: \(dock: 'bottom' \| 'sidebar' \| 'right'\) => \{\s+persistLayoutSettings\(\{ agentTerminalDock: dock \}\);\s+set\(\(state\) => \(\{\s+agentTerminalDock: dock,\s+\.\.\.\(dock === 'sidebar'\s+\? \{ activeSidebarPanel: 'agents' as SidebarPanel, sidebarVisible: true \}\s+: dock === 'bottom' && state\.terminalSessions\.some\(\(s\) => s\.agentId\)\s+\? \{ bottomPanelVisible: true, activeBottomTab: 'terminal' as BottomTab \}\s+: \{\}\),\s+\}\)\);\s+\},\n/s);
if (agentDockMatch) {
  content = content.replace(agentDockMatch[0], '');
}

fs.writeFileSync('src/store.ts', content);
console.log('Layout extracted via JS');

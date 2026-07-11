import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import TitleBar from './components/TitleBar';
import ActivityBar from './components/ActivityBar';
import SideBar from './components/SideBar';
import EditorArea from './components/EditorArea';
import BottomPanel from './components/BottomPanel';
import StatusBar from './components/StatusBar';
import CommandPalette from './components/CommandPalette';
import QuickOpen from './components/QuickOpen';
import AIPanel from './components/AIPanel/AIPanel';
import type { ClaudeIdeEditorState } from './types';
import { lspClient } from './lsp/client';

// ─────────────────────────────────────────────────────────────────────────
// Drag dividers
//
// The dividers are 6px thick (clearly grabbable hit area), transparent by
// default, and show a 2px accent line on hover/while dragging.
//
// We intentionally avoid relying on React state to gate pointermove updates
// because the state-update-then-render cycle creates a race window where the
// first pointermove after pointerdown can fire with a stale `dragging=false`
// closure. Using a ref for the dragging flag means the very first movement
// pixel already triggers a resize callback, and pointer capture guarantees
// move/up events keep flowing even when the cursor leaves the 6px hit area.
// ─────────────────────────────────────────────────────────────────────────

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 500;
const BOTTOM_MIN = 100;
/** The bottom panel must always leave room for at least this many pixels
 *  of editor area above it. */
const EDITOR_MIN = 120;
/** Divider hit area thickness. Wider than the visual accent line so the user
 *  can actually grab it without pixel-perfect aim. */
const DIVIDER_HIT = 6;
/** AI sidebar (right) bounds. Larger than the left sidebar by design. */
const AI_PANEL_MIN = 280;
const AI_PANEL_MAX = 720;

function toFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return prefix + encodeURI(normalized);
}

function lineCount(content: string): number {
  if (!content) return 1;
  return content.split(/\r\n|\r|\n/).length;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function buildClaudeEditorState(): ClaudeIdeEditorState {
  const state = useStore.getState();
  return {
    workspacePath: state.workspacePath,
    workspaceName: state.workspaceName,
    openEditors: state.openTabs
      .filter((tab) => !tab.imageDataUrl)
      .map((tab) => ({
        uri: toFileUri(tab.path),
        filePath: tab.path,
        isActive: tab.id === state.activeTabId,
        label: tab.name,
        languageId: tab.language,
        isDirty: tab.isUnsaved,
        lineCount: lineCount(tab.content),
      })),
  };
}

function publishClaudeEditorState(): void {
  try {
    window.electronAPI?.claudeIde?.updateEditorState(buildClaudeEditorState());
  } catch {
    /* noop outside Electron */
  }
}

function VerticalDivider({
  onDrag,
}: {
  onDrag: (clientX: number) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Ref mirror of `dragging` so pointermove handlers don't see stale state.
  const draggingRef = useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    setDragging(true);
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      /* some browsers throw if the pointer is already captured */
    }
    // Apply immediately so a click without movement still snaps the sidebar
    // to the cursor column.
    onDrag(e.clientX);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    onDrag(e.clientX);
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const active = hovering || dragging;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        width: '100%',
        height: '100%',
        cursor: 'col-resize',
        background: 'transparent',
        position: 'relative',
        flexShrink: 0,
        zIndex: 10,
        // Disable browser touch/scroll behaviors so a drag stays a drag.
        touchAction: 'none',
        userSelect: 'none',
      }}
      title="Drag to resize sidebar"
      role="separator"
      aria-orientation="vertical"
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 2,
          background: active ? '#B65A48' : 'transparent',
          transition: 'background 0.12s ease',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

function HorizontalDivider({
  onDrag,
}: {
  onDrag: (clientY: number) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    setDragging(true);
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    onDrag(e.clientY);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    onDrag(e.clientY);
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const active = hovering || dragging;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        width: '100%',
        height: DIVIDER_HIT,
        cursor: 'row-resize',
        background: 'transparent',
        position: 'relative',
        flexShrink: 0,
        zIndex: 10,
        touchAction: 'none',
        userSelect: 'none',
      }}
      title="Drag to resize terminal"
      role="separator"
      aria-orientation="horizontal"
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          height: 2,
          background: active ? '#B65A48' : 'transparent',
          transition: 'background 0.12s ease',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

export default function App() {
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const bottomPanelVisible = useStore((s) => s.bottomPanelVisible);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const togglePanel = useStore((s) => s.togglePanel);
  const saveFile = useStore((s) => s.saveFile);
  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const commandPaletteOpen = useStore((s) => s.commandPaletteOpen);
  const setQuickOpenOpen = useStore((s) => s.setQuickOpenOpen);
  const quickOpenOpen = useStore((s) => s.quickOpenOpen);
  const zoomIn = useStore((s) => s.zoomIn);
  const zoomOut = useStore((s) => s.zoomOut);
  const resetZoom = useStore((s) => s.resetZoom);
  const subscribeToFsChanges = useStore((s) => s.subscribeToFsChanges);
  const openFolder = useStore((s) => s.openFolder);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setBottomPanelHeight = useStore((s) => s.setBottomPanelHeight);
  const aiPanelVisible = useStore((s) => s.aiPanelVisible);
  const aiPanelWidth = useStore((s) => s.aiPanelWidth);
  const setAIPanelWidth = useStore((s) => s.setAIPanelWidth);
  const refreshAIConfig = useStore((s) => s.refreshAIConfig);
  const refreshExtensions = useStore((s) => s.refreshExtensions);
  const refreshLiveServerStatus = useStore((s) => s.refreshLiveServerStatus);
  const _setLiveServerStatus = useStore((s) => s._setLiveServerStatus);

  // Ref to the editor+terminal container so we can clamp the terminal height
  // against the actually-available vertical space when dragging.
  const editorColumnRef = useRef<HTMLDivElement>(null);

  // Subscribe to workspace file system change notifications once on mount.
  // The subscription itself is cheap; refreshes only happen when the main
  // process emits an event for the currently-watched workspace.
  useEffect(() => {
    const unsubscribe = subscribeToFsChanges();
    return unsubscribe;
  }, [subscribeToFsChanges]);

  // Load AI configuration (configured providers / active provider) from disk.
  useEffect(() => {
    void refreshAIConfig();
  }, [refreshAIConfig]);

  // Mirror LSP diagnostics into the global store so the Problems panel can
  // render them independently from Monaco markers.
  useEffect(() => {
    lspClient.setProblemsHandler((filePath, problems) => {
      const state = useStore.getState();
      if (!filePath) state.clearProblems();
      else state.updateProblemsForFile(filePath, problems);
    });
    return () => lspClient.setProblemsHandler(null);
  }, []);

  // Load installed VSIX extensions (themes + snippets) from disk.
  useEffect(() => {
    void refreshExtensions();
  }, [refreshExtensions]);

  // Keep Claude Code's IDE bridge informed about the current workspace and
  // open text editors. The main process owns the WebSocket server; the
  // renderer owns editor state, so this is the mirror between them.
  useEffect(() => {
    publishClaudeEditorState();
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (
        state.workspacePath === prev.workspacePath &&
        state.workspaceName === prev.workspaceName &&
        state.openTabs === prev.openTabs &&
        state.activeTabId === prev.activeTabId
      ) {
        return;
      }
      publishClaudeEditorState();
    });
    return unsubscribe;
  }, []);

  // Main asks the renderer to perform editor actions for Claude MCP tools.
  useEffect(() => {
    if (!window.electronAPI?.claudeIde) return;
    const disposable = window.electronAPI.claudeIde.onCommand(async (command, args) => {
      const state = useStore.getState();
      if (command === 'openFile') {
        return state.openFilePath(String(args?.filePath || ''), {
          startText: typeof args?.startText === 'string' ? args.startText : undefined,
          endText: typeof args?.endText === 'string' ? args.endText : undefined,
          selectToEndOfLine: Boolean(args?.selectToEndOfLine),
          makeFrontmost: args?.makeFrontmost !== false,
        });
      }
      if (command === 'saveDocument') {
        const filePath = String(args?.filePath || '');
        const tab = state.openTabs.find((t) => (
          t.path === filePath ||
          toFileUri(t.path) === filePath ||
          t.name === filePath ||
          basename(t.path) === filePath
        ));
        if (!tab) {
          return { success: false, saved: false, message: `Document not open: ${filePath}` };
        }
        await state.saveFile(tab.id);
        return { success: true, saved: true, filePath: tab.path };
      }
      if (command === 'closeTab') {
        const tabName = String(args?.tabName || '');
        const tab = state.openTabs.find((t) => (
          t.name === tabName ||
          t.path === tabName ||
          basename(t.path) === tabName
        ));
        if (!tab) return { closed: false };
        state.closeTab(tab.id);
        return { closed: true };
      }
      return { success: false, message: `Unknown renderer command: ${command}` };
    });
    return () => disposable.dispose();
  }, []);

  // Subscribe to Live Server status changes emitted by the main process and
  // hydrate the initial status on mount. The main process is the source of
  // truth for the running HTTP server, so the renderer mirrors its state.
  useEffect(() => {
    if (!window.electronAPI?.liveServer) return;
    void refreshLiveServerStatus();
    const dispose = window.electronAPI.liveServer.onStatusChange((status) => {
      _setLiveServerStatus(status);
    });
    return () => dispose.dispose();
  }, [refreshLiveServerStatus, _setLiveServerStatus]);

  // Auto-restore the last workspace when the main process emits it.
  useEffect(() => {
    if (!window.electronAPI?.onWorkspaceRestore) return;

    const disposable = window.electronAPI.onWorkspaceRestore((workspacePath) => {
      void openFolder(workspacePath);
    });

    return () => disposable.dispose();
  }, [openFolder]);

  // Persist the AI conversation to `.forge/history.json` on every change,
  // debounced so quick stream updates don't thrash the disk. The store
  // action no-ops when the workspace hasn't been /init-ed yet.
  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (
        state.aiMessages === prev.aiMessages &&
        state.workspacePath === prev.workspacePath &&
        state.aiInitDone === prev.aiInitDone
      ) {
        return;
      }
      if (!state.aiInitDone || !state.workspacePath) return;

      // Debounce per-workspace.
      const w = window as unknown as {
        __forgeHistorySaveTimer?: ReturnType<typeof setTimeout>;
      };
      if (w.__forgeHistorySaveTimer) {
        clearTimeout(w.__forgeHistorySaveTimer);
      }
      w.__forgeHistorySaveTimer = setTimeout(() => {
        void useStore.getState().saveProjectHistory();
      }, 800);
    });
    return unsubscribe;
  }, []);

  // Global keyboard shortcuts.
  //
  // We normalize `e.key` to lowercase so the shortcuts keep working when Caps
  // Lock is on, and accept either Ctrl (Win/Linux) or Meta/Cmd (macOS) as the
  // primary modifier so the same combos feel native everywhere.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && !e.shiftKey && key === 's') {
        e.preventDefault();
        saveFile();
        return;
      }
      if (mod && !e.shiftKey && key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && !e.shiftKey && key === '`') {
        e.preventDefault();
        togglePanel();
        return;
      }
      if (mod && e.shiftKey && key === 'p') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }
      if (mod && !e.shiftKey && key === 'p') {
        e.preventDefault();
        setQuickOpenOpen(!quickOpenOpen);
        return;
      }
      // Zoom: Ctrl+= / Ctrl++ / Ctrl+NumpadAdd zoom in; Ctrl+- zoom out;
      // Ctrl+0 reset. Accept either Ctrl (Win/Linux) or Meta (macOS).
      if (mod && !e.altKey) {
        const zoomInKey =
          key === '+' ||
          (!e.shiftKey && key === '=') ||
          e.code === 'NumpadAdd';
        const zoomOutKey =
          key === '-' ||
          key === '_' ||
          e.code === 'NumpadSubtract';
        const resetZoomKey =
          !e.shiftKey && (key === '0' || e.code === 'Numpad0');

        if (zoomInKey) {
          e.preventDefault();
          zoomIn();
          return;
        }
        if (zoomOutKey) {
          e.preventDefault();
          zoomOut();
          return;
        }
        if (resetZoomKey) {
          e.preventDefault();
          resetZoom();
          return;
        }
      }
      if (e.key === 'Escape' && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
      if (e.key === 'Escape' && quickOpenOpen) {
        setQuickOpenOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    saveFile,
    toggleSidebar,
    togglePanel,
    setCommandPaletteOpen,
    commandPaletteOpen,
    setQuickOpenOpen,
    quickOpenOpen,
    zoomIn,
    zoomOut,
    resetZoom,
  ]);

  // Ctrl/Cmd + mouse wheel zoom (editor font size).
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else if (e.deltaY > 0) {
        zoomOut();
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [zoomIn, zoomOut]);

  // ── Sidebar drag handler ─────────────────────────────────────────────
  const handleSidebarDrag = (clientX: number) => {
    // The sidebar starts at column 1 (left edge), so clientX *is* the new
    // width. Clamp to [SIDEBAR_MIN, SIDEBAR_MAX].
    const width = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, clientX));
    setSidebarWidth(width);
  };

  // ── Bottom panel drag handler ────────────────────────────────────────
  const handleBottomDrag = (clientY: number) => {
    const container = editorColumnRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Distance from the divider to the bottom of the available column
    // becomes the new terminal height.
    const proposed = rect.bottom - clientY;
    const maxAllowed = Math.max(BOTTOM_MIN, rect.height - EDITOR_MIN);
    const clamped = Math.max(BOTTOM_MIN, Math.min(maxAllowed, proposed));
    setBottomPanelHeight(clamped);
  };

  // ── AI panel (right) drag handler ────────────────────────────────────
  const handleAIPanelDrag = (clientX: number) => {
    // The AI panel sits flush against the right edge of the viewport, so its
    // width is the distance from the cursor to the right edge.
    const proposed = window.innerWidth - clientX;
    const clamped = Math.max(AI_PANEL_MIN, Math.min(AI_PANEL_MAX, proposed));
    setAIPanelWidth(clamped);
  };

  // CSS Grid:
  //   Row 1: TitleBar 32px
  //   Row 2: ActivityBar 40px
  //   Row 3: Sidebar | leftDivider | Editor (1fr) | rightDivider | AIPanel
  //   Row 4: StatusBar 22px
  const sidebarPart = sidebarVisible
    ? `${sidebarWidth}px ${DIVIDER_HIT}px`
    : '0px 0px';
  const aiPart = aiPanelVisible
    ? `${DIVIDER_HIT}px ${aiPanelWidth}px`
    : '0px 0px';
  const gridTemplateColumns = `${sidebarPart} 1fr ${aiPart}`;

  return (
    <div
      className="w-screen h-screen grid bg-forge-bg text-forge-text text-[13px]"
      style={{
        gridTemplateRows: '32px 40px 1fr 22px',
        gridTemplateColumns,
      }}
    >
      {/* Row 1: TitleBar (full width) */}
      <div style={{ gridColumn: '1 / -1', gridRow: '1' }}>
        <TitleBar />
      </div>

      {/* Row 2: ActivityBar (full width, horizontal) */}
      <div style={{ gridColumn: '1 / -1', gridRow: '2' }}>
        <ActivityBar />
      </div>

      {/* Row 3 - Col 1: SideBar */}
      <div style={{ gridColumn: '1', gridRow: '3', overflow: 'hidden' }}>
        {sidebarVisible && <SideBar />}
      </div>

      {/* Row 3 - Col 2: vertical drag divider.
          The wrapper is explicitly sized so the divider's `height: 100%`
          resolves against a known box. */}
      {sidebarVisible && (
        <div
          style={{
            gridColumn: '2',
            gridRow: '3',
            width: '100%',
            height: '100%',
            position: 'relative',
            overflow: 'visible',
          }}
        >
          <VerticalDivider onDrag={handleSidebarDrag} />
        </div>
      )}

      {/* Row 3 - Col 3: Editor + Bottom panel */}
      <div
        ref={editorColumnRef}
        className="flex flex-col overflow-hidden"
        style={{ gridColumn: '3', gridRow: '3' }}
      >
        <div className="flex-1 overflow-hidden min-h-0">
          <EditorArea />
        </div>
        {bottomPanelVisible && (
          <>
            <HorizontalDivider onDrag={handleBottomDrag} />
            <BottomPanel />
          </>
        )}
      </div>

      {/* Row 3 - Col 4: right vertical drag divider (only when AI panel is open) */}
      {aiPanelVisible && (
        <div
          style={{
            gridColumn: '4',
            gridRow: '3',
            width: '100%',
            height: '100%',
            position: 'relative',
            overflow: 'visible',
          }}
        >
          <VerticalDivider onDrag={handleAIPanelDrag} />
        </div>
      )}

      {/* Row 3 - Col 5: AI Panel */}
      <div
        style={{
          gridColumn: '5',
          gridRow: '3',
          overflow: 'hidden',
        }}
      >
        {aiPanelVisible && <AIPanel />}
      </div>

      {/* Row 4: StatusBar (full width) */}
      <div style={{ gridColumn: '1 / -1', gridRow: '4' }}>
        <StatusBar />
      </div>

      {/* Command Palette overlay */}
      {commandPaletteOpen && <CommandPalette />}
      {quickOpenOpen && <QuickOpen />}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '../store';
import { isHtmlFile, type GitChange, type TreeNode } from '../types';
import ExtensionsPanel from './ExtensionsPanel';
import {
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
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns the set of folder paths that lie on the directory chain of the
 * currently active editor file. Used to highlight ancestors of the open file.
 */
function getActiveFolderPaths(activeFilePath: string | null): Set<string> {
  const result = new Set<string>();
  if (!activeFilePath) return result;

  const sep =
    activeFilePath.includes('\\') && !activeFilePath.includes('/')
      ? '\\'
      : '/';

  let cur = activeFilePath;
  while (cur.includes(sep)) {
    cur = cur.substring(0, cur.lastIndexOf(sep));
    if (cur) result.add(cur);
  }
  return result;
}

function joinPath(parent: string, child: string): string {
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return parent.endsWith(sep) ? `${parent}${child}` : `${parent}${sep}${child}`;
}

function gitStatusLabel(change: GitChange): string {
  if (change.x === '?' || change.y === '?') return 'U';
  if (change.x.trim()) return change.x;
  if (change.y.trim()) return change.y;
  return 'M';
}

function gitStatusTitle(change: GitChange): string {
  const code = gitStatusLabel(change);
  const labels: Record<string, string> = {
    M: 'Modified',
    A: 'Added',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    U: 'Untracked',
  };
  return labels[code] || code;
}

function isStaged(change: GitChange): boolean {
  return change.x !== ' ' && change.x !== '?' && change.x !== '';
}

function isUnstaged(change: GitChange): boolean {
  return change.y !== ' ' && change.y !== '';
}

// ─────────────────────────────────────────────────────────────────────────
// Context Menu
// ─────────────────────────────────────────────────────────────────────────
interface CtxMenuState {
  x: number;
  y: number;
  node: TreeNode;
}

function ContextMenu({
  state,
  onClose,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onLiveServerToggle,
  liveServerActive,
  liveServerHtmlPath,
}: {
  state: CtxMenuState;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  /** Optional handler that toggles the live server on this HTML file. */
  onLiveServerToggle: () => void;
  /** Current live-server state — used to decide between "Iniciar" / "Detener". */
  liveServerActive: boolean;
  /** Absolute path of the HTML file that the live server is currently
   *  rooted on (for "Detener" — null when no server is running). */
  liveServerHtmlPath: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  // Show the Live Server entry on HTML files. Wording:
  //   - "Iniciar Live Server" when no server is running, OR a server is
  //     running on a different file (we'll restart it on this file).
  //   - "Detener Live Server" when the server is rooted on THIS file's
  //     directory and serving THIS file.
  const isHtml = state.node.type === 'file' && isHtmlFile(state.node.path);
  const isServingThisFile =
    liveServerActive &&
    liveServerHtmlPath !== null &&
    liveServerHtmlPath === state.node.path;
  const liveServerLabel = isServingThisFile
    ? 'Detener Live Server'
    : 'Iniciar Live Server';

  return (
    <div
      ref={ref}
      className="context-menu fixed"
      style={{ top: state.y, left: state.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {isHtml && (
        <>
          <div
            className="context-menu-item flex items-center gap-2"
            onClick={() => {
              onLiveServerToggle();
              onClose();
            }}
          >
            <Globe
              size={13}
              className={isServingThisFile ? 'text-forge-accent' : 'text-forge-text/70'}
            />
            <span>{liveServerLabel}</span>
          </div>
          <div className="context-menu-divider" />
        </>
      )}
      <div className="context-menu-item" onClick={() => { onNewFile(); onClose(); }}>New File</div>
      <div className="context-menu-item" onClick={() => { onNewFolder(); onClose(); }}>New Folder</div>
      <div className="context-menu-divider" />
      <div className="context-menu-item" onClick={() => { onRename(); onClose(); }}>Rename</div>
      <div className="context-menu-item" onClick={() => { onDelete(); onClose(); }}>Delete</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// File Tree Item
// ─────────────────────────────────────────────────────────────────────────
interface InlineCreate {
  parentPath: string;
  type: 'file' | 'folder';
}

function TreeItem({
  node,
  depth,
  activeFolderPaths,
  onContextMenu,
  inlineCreate,
  setInlineCreate,
  renameNodeId,
  setRenameNodeId,
}: {
  node: TreeNode;
  depth: number;
  activeFolderPaths: Set<string>;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  inlineCreate: InlineCreate | null;
  setInlineCreate: (i: InlineCreate | null) => void;
  renameNodeId: string | null;
  setRenameNodeId: (id: string | null) => void;
}) {
  const expandedFolders = useStore((s) => s.expandedFolders);
  const toggleFolder = useStore((s) => s.toggleFolder);
  const openFile = useStore((s) => s.openFile);
  const activeTabId = useStore((s) => s.activeTabId);
  const selectedPath = useStore((s) => s.selectedPath);
  const setSelectedPath = useStore((s) => s.setSelectedPath);
  const createNewFile = useStore((s) => s.createNewFile);
  const createNewDirectory = useStore((s) => s.createNewDirectory);
  const renameItem = useStore((s) => s.renameItem);

  const isExpanded = expandedFolders.has(node.id);
  const isDirectory = node.type === 'directory';
  const isActiveFile = activeTabId === node.path;
  const isActiveFolder = isDirectory && activeFolderPaths.has(node.path);
  const isSelected = selectedPath === node.path;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Always update sidebar selection.
    setSelectedPath({ path: node.path, kind: isDirectory ? 'directory' : 'file' });
    if (isDirectory) {
      toggleFolder(node.id);
    } else {
      openFile(node);
    }
  };

  // Color logic
  let textColor = '#D0D3DA';
  if (isDirectory && isActiveFolder) textColor = '#4ADB94';
  else if (!isDirectory && isActiveFile) textColor = '#FFFFFF';

  const isRenaming = renameNodeId === node.id;
  const showInlineCreate = inlineCreate && inlineCreate.parentPath === node.path && isDirectory && isExpanded;

  return (
    <>
      {!isRenaming && (
        <div
          onClick={handleClick}
          onContextMenu={(e) => {
            // Right-click also selects
            setSelectedPath({ path: node.path, kind: isDirectory ? 'directory' : 'file' });
            onContextMenu(e, node);
          }}
          className="tree-item flex items-center cursor-pointer h-[24px] pr-2 transition-colors"
          style={{
            paddingLeft: `${depth * 14 + 8}px`,
            color: textColor,
            backgroundColor: isSelected ? 'rgba(74, 219, 148, 0.1)' : 'transparent',
          }}
        >
          {isDirectory ? (
            <span className="mr-0.5 flex-shrink-0">
              {isExpanded ? (
                <ChevronDown size={14} style={{ color: textColor }} />
              ) : (
                <ChevronRight size={14} style={{ color: textColor }} />
              )}
            </span>
          ) : (
            <span className="w-[14px] mr-0.5 flex-shrink-0" />
          )}

          <span className="mr-1.5 flex-shrink-0 inline-flex items-center">
            {isDirectory ? (
              isExpanded ? (
                <FolderOpen size={15} style={{ color: textColor }} />
              ) : (
                <Folder size={15} style={{ color: textColor }} />
              )
            ) : (
              <File size={14} style={{ color: textColor }} />
            )}
          </span>

          <span className="truncate text-[13px]" style={{ color: textColor }}>
            {node.name}
          </span>
        </div>
      )}

      {isRenaming && (
        <RenameInput
          initial={node.name}
          depth={depth}
          onSubmit={async (name) => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== node.name) {
              await renameItem(node.path, trimmed);
            }
            setRenameNodeId(null);
          }}
          onCancel={() => setRenameNodeId(null)}
        />
      )}

      {isDirectory && isExpanded && node.children && (
        <div>
          {showInlineCreate && (
            <NewItemInput
              type={inlineCreate!.type}
              depth={depth + 1}
              onSubmit={async (name) => {
                const trimmed = name.trim();
                if (trimmed) {
                  if (inlineCreate!.type === 'file') {
                    await createNewFile(node.path, trimmed);
                  } else {
                    await createNewDirectory(node.path, trimmed);
                  }
                }
                setInlineCreate(null);
              }}
              onCancel={() => setInlineCreate(null)}
            />
          )}
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFolderPaths={activeFolderPaths}
              onContextMenu={onContextMenu}
              inlineCreate={inlineCreate}
              setInlineCreate={setInlineCreate}
              renameNodeId={renameNodeId}
              setRenameNodeId={setRenameNodeId}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Inline input for creating a new file/folder under a folder.
//
// Focus handling notes:
//  • We focus on mount via a `setTimeout(0)` so that any in-flight re-renders
//    (e.g. from the dropdown closing or `expandFolder` updating the
//    `expandedFolders` Set) settle before we ask the input to take focus.
//  • Click / mousedown propagation is stopped on both the wrapper and the
//    input so the explorer's `onClick={handleEmptyClick}` (which clears the
//    sidebar selection and triggers a re-render) doesn't fight us.
//  • A `submittedRef` guards against double-submission caused by Enter
//    triggering `onBlur` immediately after `onSubmit`.
//  • Key events are also stopped from bubbling so the global Ctrl+S / Esc
//    handlers in App.tsx don't intercept what the user is typing.
function NewItemInput({
  type,
  depth,
  onSubmit,
  onCancel,
}: {
  type: 'file' | 'folder';
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const composingRef = useRef(false);

  useEffect(() => {
    // Defer focus to the next tick so any concurrent re-renders settle first.
    const id = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      // Keep the cursor at the end if the field already has a value.
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch { /* noop */ }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const submit = (name: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(name);
  };

  const cancel = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onCancel();
  };

  return (
    <div
      className="flex items-center h-[26px] pr-2"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="w-[14px] mr-0.5 flex-shrink-0" />
      <span className="mr-1.5 flex-shrink-0 inline-flex items-center">
        {type === 'folder' ? (
          <Folder size={15} className="text-forge-accent" />
        ) : (
          <File size={14} className="text-forge-accent" />
        )}
      </span>
      <input
        ref={ref}
        className="flex-1 bg-forge-input text-forge-text text-[13px] px-1.5 py-0.5 border border-forge-accent outline-none rounded-sm"
        placeholder={type === 'file' ? 'name.ext' : 'folder name'}
        value={val}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setVal(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onKeyDown={(e) => {
          // Don't let global shortcuts hijack typing.
          e.stopPropagation();
          if (composingRef.current) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            submit(val);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => submit(val)}
      />
    </div>
  );
}

function RenameInput({
  initial,
  depth,
  onSubmit,
  onCancel,
}: {
  initial: string;
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const composingRef = useRef(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      try { el.select(); } catch { /* noop */ }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const submit = (name: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(name);
  };

  const cancel = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onCancel();
  };

  return (
    <div
      className="flex items-center h-[26px] pr-2"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="w-[14px] mr-0.5 flex-shrink-0" />
      <span className="mr-1.5 flex-shrink-0 inline-flex items-center">
        <File size={14} className="text-forge-accent" />
      </span>
      <input
        ref={ref}
        className="flex-1 bg-forge-input text-forge-text text-[13px] px-1.5 py-0.5 border border-forge-accent outline-none rounded-sm"
        value={val}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setVal(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (composingRef.current) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            submit(val);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => submit(val)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Add (+) Dropdown
// ─────────────────────────────────────────────────────────────────────────
function AddDropdown({
  onPick,
  onClose,
}: {
  onPick: (type: 'file' | 'folder') => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<'file' | 'folder' | null>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="dropdown-menu absolute right-2 top-9 z-30 py-1 min-w-[140px]"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="block w-full text-left px-3 py-1.5 text-[13px] transition-colors"
        style={{ color: hover === 'file' ? '#4ADB94' : '#D3D5DE' }}
        onMouseEnter={() => setHover('file')}
        onMouseLeave={() => setHover(null)}
        onClick={() => onPick('file')}
      >
        New File
      </button>
      <button
        className="block w-full text-left px-3 py-1.5 text-[13px] transition-colors"
        style={{ color: hover === 'folder' ? '#4ADB94' : '#D3D5DE' }}
        onMouseEnter={() => setHover('folder')}
        onMouseLeave={() => setHover(null)}
        onClick={() => onPick('folder')}
      >
        New Folder
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Header Context Menu ("Close Folder")
// ─────────────────────────────────────────────────────────────────────────
interface HeaderCtxMenuState {
  x: number;
  y: number;
}

function HeaderContextMenu({
  state,
  onClose,
  onCloseFolder,
}: {
  state: HeaderCtxMenuState;
  onClose: () => void;
  onCloseFolder: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu fixed"
      style={{ top: state.y, left: state.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="context-menu-item"
        onClick={() => {
          onCloseFolder();
          onClose();
        }}
      >
        Close Folder
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Explorer Panel (file tree)
// ─────────────────────────────────────────────────────────────────────────
function ExplorerPanel() {
  const fileTree = useStore((s) => s.fileTree);
  const workspacePath = useStore((s) => s.workspacePath);
  const openFolder = useStore((s) => s.openFolder);
  const closeWorkspace = useStore((s) => s.closeWorkspace);
  const activeTabId = useStore((s) => s.activeTabId);
  const createNewFile = useStore((s) => s.createNewFile);
  const createNewDirectory = useStore((s) => s.createNewDirectory);
  const deleteItem = useStore((s) => s.deleteItem);
  const expandFolder = useStore((s) => s.expandFolder);
  const setSelectedPath = useStore((s) => s.setSelectedPath);
  const resolveCreateParent = useStore((s) => s.resolveCreateParent);
  // Live server state — used by the per-file context menu.
  const liveServerActive = useStore((s) => s.liveServerActive);
  const liveServerRoot = useStore((s) => s.liveServerRoot);
  const liveServerHtmlFile = useStore((s) => s.liveServerHtmlFile);
  const startLiveServer = useStore((s) => s.startLiveServer);
  const stopLiveServer = useStore((s) => s.stopLiveServer);

  // Compute the full absolute path of the HTML file currently being served,
  // joining root + basename with the OS-appropriate separator. We don't have
  // `path.join` in the renderer, so reuse whichever separator is already in
  // use in the root path string.
  const liveServerHtmlPath = useMemo<string | null>(() => {
    if (!liveServerActive || !liveServerRoot || !liveServerHtmlFile) return null;
    const sep =
      liveServerRoot.includes('\\') && !liveServerRoot.includes('/') ? '\\' : '/';
    return liveServerRoot.endsWith(sep)
      ? `${liveServerRoot}${liveServerHtmlFile}`
      : `${liveServerRoot}${sep}${liveServerHtmlFile}`;
  }, [liveServerActive, liveServerRoot, liveServerHtmlFile]);

  // Always derive the display name from the workspace path so it is just the
  // last path segment (folder name), even on Windows back-slash paths.
  const folderDisplayName = useMemo(() => {
    if (!workspacePath) return '';
    const segments = workspacePath.split(/[\\/]/).filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : workspacePath;
  }, [workspacePath]);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [inlineCreate, setInlineCreate] = useState<InlineCreate | null>(null);
  const [renameNodeId, setRenameNodeId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [headerCtxMenu, setHeaderCtxMenu] = useState<HeaderCtxMenuState | null>(null);

  // Folder-highlight chain — derived from the active tab's file path.
  // Re-computed on every activeTabId change so tab switches update the tree.
  const activeFolderPaths = useMemo(
    () => getActiveFolderPaths(activeTabId),
    [activeTabId]
  );

  // Smart "+" — uses the current sidebar selection to choose the parent.
  const handleAddPick = useCallback(
    (type: 'file' | 'folder') => {
      setDropdownOpen(false);
      const parent = resolveCreateParent();
      if (!parent) return;
      // If the parent is a folder we can drill into, expand it so the inline
      // input shows up where the new item will live.
      if (parent !== workspacePath) {
        // Find the matching node id (id === path in our tree)
        expandFolder(parent);
      }
      setInlineCreate({ parentPath: parent, type });
    },
    [resolveCreateParent, workspacePath, expandFolder]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleCtxNewFile = useCallback(() => {
    if (!ctxMenu) return;
    const parentPath = ctxMenu.node.type === 'directory'
      ? ctxMenu.node.path
      : (ctxMenu.node.path.includes('/')
          ? ctxMenu.node.path.substring(0, ctxMenu.node.path.lastIndexOf('/'))
          : ctxMenu.node.path.substring(0, ctxMenu.node.path.lastIndexOf('\\')));
    if (ctxMenu.node.type === 'directory') expandFolder(ctxMenu.node.id);
    setInlineCreate({ parentPath, type: 'file' });
  }, [ctxMenu, expandFolder]);

  const handleCtxNewFolder = useCallback(() => {
    if (!ctxMenu) return;
    const parentPath = ctxMenu.node.type === 'directory'
      ? ctxMenu.node.path
      : (ctxMenu.node.path.includes('/')
          ? ctxMenu.node.path.substring(0, ctxMenu.node.path.lastIndexOf('/'))
          : ctxMenu.node.path.substring(0, ctxMenu.node.path.lastIndexOf('\\')));
    if (ctxMenu.node.type === 'directory') expandFolder(ctxMenu.node.id);
    setInlineCreate({ parentPath, type: 'folder' });
  }, [ctxMenu, expandFolder]);

  const handleCtxRename = useCallback(() => {
    if (!ctxMenu) return;
    setRenameNodeId(ctxMenu.node.id);
  }, [ctxMenu]);

  const handleCtxDelete = useCallback(async () => {
    if (!ctxMenu) return;
    if (confirm(`Delete "${ctxMenu.node.name}"?`)) {
      await deleteItem(ctxMenu.node.path);
    }
  }, [ctxMenu, deleteItem]);

  // Toggle the live server for the right-clicked HTML file. When the server
  // is already serving THIS file, stop it; otherwise start (or restart) on
  // the new file.
  const handleCtxLiveServerToggle = useCallback(async () => {
    if (!ctxMenu) return;
    if (ctxMenu.node.type !== 'file') return;
    if (!isHtmlFile(ctxMenu.node.path)) return;

    if (liveServerActive && liveServerHtmlPath === ctxMenu.node.path) {
      await stopLiveServer();
    } else {
      await startLiveServer(ctxMenu.node.path);
    }
  }, [ctxMenu, liveServerActive, liveServerHtmlPath, startLiveServer, stopLiveServer]);

  // Click on empty area inside the explorer clears the sidebar selection so
  // that the next "+" creates at the workspace root.
  const handleEmptyClick = useCallback(() => {
    setSelectedPath(null);
  }, [setSelectedPath]);

  if (!workspacePath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-forge-text">
        <p className="text-sm text-center">No folder opened</p>
        <button
          onClick={() => openFolder()}
          className="px-4 py-1.5 bg-forge-accent text-[#1F2025] text-sm font-semibold rounded hover:opacity-90 transition-opacity"
        >
          Open Folder
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Top bar: folder name + add button */}
      <div className="flex items-center justify-between h-[36px] px-3 border-b border-forge-border/40">
        <button
          title={workspacePath ?? undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setHeaderCtxMenu({ x: e.clientX, y: e.clientY });
          }}
          className="flex items-center gap-1 text-forge-accent text-[13px] font-semibold uppercase tracking-wide truncate"
        >
          <span className="truncate">{folderDisplayName}</span>
          <ChevronDown size={14} className="flex-shrink-0" />
        </button>

        <button
          onClick={() => setDropdownOpen((v) => !v)}
          title="New..."
          className="p-1 rounded hover:bg-white/5 transition-colors"
        >
          <Plus size={16} className="text-forge-accent" />
        </button>

        {dropdownOpen && (
          <AddDropdown onPick={handleAddPick} onClose={() => setDropdownOpen(false)} />
        )}
      </div>

      {/* Inline create at root */}
      {inlineCreate && inlineCreate.parentPath === workspacePath && (
        <NewItemInput
          type={inlineCreate.type}
          depth={0}
          onSubmit={async (name) => {
            const trimmed = name.trim();
            if (trimmed) {
              if (inlineCreate.type === 'file') {
                await createNewFile(workspacePath, trimmed);
              } else {
                await createNewDirectory(workspacePath, trimmed);
              }
            }
            setInlineCreate(null);
          }}
          onCancel={() => setInlineCreate(null)}
        />
      )}

      {/* File Tree */}
      <div
        className="flex-1 overflow-y-auto sidebar-scroll py-1"
        onClick={handleEmptyClick}
      >
        {fileTree.map((node) => (
          <TreeItem
            key={node.id}
            node={node}
            depth={0}
            activeFolderPaths={activeFolderPaths}
            onContextMenu={handleContextMenu}
            inlineCreate={inlineCreate}
            setInlineCreate={setInlineCreate}
            renameNodeId={renameNodeId}
            setRenameNodeId={setRenameNodeId}
          />
        ))}
      </div>

      {ctxMenu && (
        <ContextMenu
          state={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onRename={handleCtxRename}
          onDelete={handleCtxDelete}
          onNewFile={handleCtxNewFile}
          onNewFolder={handleCtxNewFolder}
          onLiveServerToggle={handleCtxLiveServerToggle}
          liveServerActive={liveServerActive}
          liveServerHtmlPath={liveServerHtmlPath}
        />
      )}

      {headerCtxMenu && (
        <HeaderContextMenu
          state={headerCtxMenu}
          onClose={() => setHeaderCtxMenu(null)}
          onCloseFolder={closeWorkspace}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Bottom Section: Outline + Timeline (collapsible)
// ─────────────────────────────────────────────────────────────────────────
function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-forge-border/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-3 h-[28px] text-[11px] font-semibold uppercase tracking-wider text-forge-text hover:text-forge-text-strong transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="ml-1 inline-flex items-center gap-1.5">
          {icon}
          {title}
        </span>
      </button>
      {open && (
        <div className="px-3 py-2 text-[12px] text-forge-text/60 max-h-[140px] overflow-y-auto sidebar-scroll">
          {children}
        </div>
      )}
    </div>
  );
}

function BottomSections() {
  return (
    <div className="flex-shrink-0">
      <CollapsibleSection title="Outline" icon={<ListTree size={12} />}>
        <p className="italic">No symbols found in active editor.</p>
      </CollapsibleSection>
      <CollapsibleSection title="Timeline" icon={<History size={12} />}>
        <p className="italic">No timeline entries yet.</p>
      </CollapsibleSection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Placeholder panels (for non-explorer activity items)
// ─────────────────────────────────────────────────────────────────────────
function SourceControlPanel() {
  const workspacePath = useStore((s) => s.workspacePath);
  const gitIsRepo = useStore((s) => s.gitIsRepo);
  const gitBranch = useStore((s) => s.gitBranch);
  const gitChanges = useStore((s) => s.gitChanges);
  const gitBusy = useStore((s) => s.gitBusy);
  const gitError = useStore((s) => s.gitError);
  const refreshGitStatus = useStore((s) => s.refreshGitStatus);
  const gitStageFiles = useStore((s) => s.gitStageFiles);
  const gitUnstageFiles = useStore((s) => s.gitUnstageFiles);
  const gitCommitChanges = useStore((s) => s.gitCommitChanges);
  const openFilePath = useStore((s) => s.openFilePath);
  const runCommandInTerminal = useStore((s) => s.runCommandInTerminal);

  const [message, setMessage] = useState('');

  useEffect(() => {
    void refreshGitStatus();
  }, [refreshGitStatus, workspacePath]);

  const staged = gitChanges.filter(isStaged);
  const unstaged = gitChanges.filter((change) => !isStaged(change) || isUnstaged(change));
  const canCommit = staged.length > 0 && message.trim().length > 0 && !gitBusy;

  const openChange = (change: GitChange) => {
    if (!workspacePath) return;
    void openFilePath(joinPath(workspacePath, change.relPath));
  };

  const commit = async () => {
    if (!canCommit) return;
    const ok = await gitCommitChanges(message.trim());
    if (ok) setMessage('');
  };

  const renderChange = (change: GitChange, mode: 'unstaged' | 'staged') => (
    <div
      key={`${mode}-${change.relPath}-${change.x}-${change.y}`}
      className="group flex items-center gap-2 h-[28px] px-2 rounded hover:bg-white/5 text-[12px]"
    >
      <button
        onClick={() => openChange(change)}
        title={change.relPath}
        className="flex items-center gap-2 min-w-0 flex-1 text-left"
      >
        <span
          className="w-5 h-5 rounded bg-forge-input border border-forge-border/60 flex items-center justify-center text-[10px] text-forge-accent flex-shrink-0"
          title={gitStatusTitle(change)}
        >
          {gitStatusLabel(change)}
        </span>
        <span className="truncate text-forge-text">{change.relPath}</span>
      </button>
      {mode === 'unstaged' ? (
        <button
          onClick={() => void gitStageFiles([change.relPath])}
          disabled={gitBusy}
          title="Stage"
          className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-forge-accent disabled:opacity-30"
        >
          <PlusCircle size={14} />
        </button>
      ) : (
        <button
          onClick={() => void gitUnstageFiles([change.relPath])}
          disabled={gitBusy}
          title="Unstage"
          className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-forge-accent disabled:opacity-30"
        >
          <MinusCircle size={14} />
        </button>
      )}
    </div>
  );

  if (!workspacePath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-forge-text">
        <GitBranch size={36} className="text-forge-text/60" />
        <p className="text-sm text-center">Open a folder to use Source Control</p>
      </div>
    );
  }

  if (!gitIsRepo) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
          <span>Source Control</span>
          <button
            onClick={() => void refreshGitStatus()}
            title="Refresh"
            className="text-forge-text hover:text-forge-accent"
          >
            <RefreshCw size={13} className={gitBusy ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center text-forge-text">
          <GitBranch size={36} className="text-forge-text/50" />
          <p className="text-sm">This folder is not a Git repository</p>
          <button
            onClick={() => runCommandInTerminal('git init')}
            className="px-3 py-1.5 rounded bg-forge-accent/15 text-forge-accent text-[12px] hover:bg-forge-accent/25"
          >
            Initialize Repository
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
        <span>Source Control</span>
        <button
          onClick={() => void refreshGitStatus()}
          title="Refresh"
          className="text-forge-text hover:text-forge-accent"
        >
          <RefreshCw size={13} className={gitBusy ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-3 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2 text-[12px] text-forge-text/70 mb-2">
          <GitBranch size={13} className="text-forge-accent" />
          <span className="truncate">{gitBranch || 'HEAD'}</span>
          <span className="text-forge-text/35">·</span>
          <span className="text-forge-text/50">{gitChanges.length} changes</span>
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Message (Ctrl+Enter to commit)"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              void commit();
            }
          }}
          className="w-full h-[64px] resize-none bg-forge-input text-forge-text text-[12px] px-2 py-1.5 rounded outline-none border border-transparent focus:border-forge-accent/60"
        />
        <button
          onClick={() => void commit()}
          disabled={!canCommit}
          className="mt-1.5 w-full flex items-center justify-center gap-2 rounded bg-forge-accent/15 text-forge-accent text-[12px] py-1.5 hover:bg-forge-accent/25 disabled:opacity-40 disabled:hover:bg-forge-accent/15"
        >
          <GitCommit size={13} />
          Commit Staged
        </button>
        {gitError && (
          <p className="mt-2 text-[11px] leading-snug text-red-400/90">{gitError}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll px-3 pb-4">
        {gitChanges.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-forge-text/40">
            <CheckCircle2 size={28} />
            <p className="text-[11px]">Working tree clean</p>
          </div>
        ) : (
          <>
            {unstaged.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
                  <span>Changes ({unstaged.length})</span>
                  <button
                    onClick={() => void gitStageFiles(unstaged.map((c) => c.relPath))}
                    disabled={gitBusy}
                    title="Stage All"
                    className="text-forge-text hover:text-forge-accent disabled:opacity-30"
                  >
                    <PlusCircle size={13} />
                  </button>
                </div>
                {unstaged.map((change) => renderChange(change, 'unstaged'))}
              </div>
            )}
            {staged.length > 0 && (
              <div>
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
                  <span>Staged ({staged.length})</span>
                  <button
                    onClick={() => void gitUnstageFiles(staged.map((c) => c.relPath))}
                    disabled={gitBusy}
                    title="Unstage All"
                    className="text-forge-text hover:text-forge-accent disabled:opacity-30"
                  >
                    <MinusCircle size={13} />
                  </button>
                </div>
                {staged.map((change) => renderChange(change, 'staged'))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RunDebugPanel() {
  const workspacePath = useStore((s) => s.workspacePath);
  const runCommandInTerminal = useStore((s) => s.runCommandInTerminal);

  const commands = [
    { id: 'dev', label: 'npm run dev', command: 'npm run dev', icon: <Play size={14} /> },
    { id: 'test', label: 'npm test', command: 'npm test', icon: <CheckCircle2 size={14} /> },
    { id: 'build', label: 'npm run build', command: 'npm run build', icon: <Hammer size={14} /> },
    { id: 'start', label: 'npm start', command: 'npm start', icon: <Package size={14} /> },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
        <span>Run and Debug</span>
      </div>

      {!workspacePath ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center text-forge-text">
          <Bug size={36} className="text-forge-text/50" />
          <p className="text-sm">Open a folder to run commands</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto sidebar-scroll px-3 pb-4">
          <div className="text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
            Common Tasks
          </div>
          <div className="space-y-1">
            {commands.map((cmd) => (
              <button
                key={cmd.id}
                onClick={() => runCommandInTerminal(cmd.command)}
                className="w-full flex items-center gap-2 rounded px-2 py-2 text-left hover:bg-white/5 transition-colors"
              >
                <span className="w-7 h-7 rounded bg-forge-accent/10 text-forge-accent border border-forge-accent/20 flex items-center justify-center flex-shrink-0">
                  {cmd.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-forge-text-strong truncate">
                    {cmd.label}
                  </span>
                  <span className="block text-[10px] text-forge-text/45 truncate">
                    Run in integrated terminal
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
            Agents
          </div>
          <div className="space-y-1">
            {[
              ['Codex', 'codex'],
              ['Claude Code', 'claude'],
              ['Cursor Agent', 'cursor-agent'],
            ].map(([label, command]) => (
              <button
                key={command}
                onClick={() => runCommandInTerminal(command)}
                className="w-full flex items-center gap-2 rounded px-2 py-2 text-left hover:bg-white/5 transition-colors"
              >
                <span className="w-7 h-7 rounded bg-forge-input border border-forge-border/60 text-forge-accent flex items-center justify-center flex-shrink-0">
                  <TerminalIcon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-forge-text-strong truncate">
                    {label}
                  </span>
                  <span className="block text-[10px] text-forge-text/45 truncate">
                    {command}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}

function relativePath(workspacePath: string | null, filePath: string): string {
  if (!workspacePath) return filePath;
  const normalizedWorkspace = workspacePath.replace(/\\/g, '/');
  const normalizedFile = filePath.replace(/\\/g, '/');
  if (normalizedFile.startsWith(normalizedWorkspace + '/')) {
    return normalizedFile.slice(normalizedWorkspace.length + 1);
  }
  return filePath;
}

function SearchPanel() {
  const workspacePath = useStore((s) => s.workspacePath);
  const openFilePath = useStore((s) => s.openFilePath);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const runSearch = useCallback(async (term: string) => {
    const q = term.trim();
    if (!workspacePath || q.length < 2) {
      setMatches([]);
      setError(null);
      setTruncated(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.agent.buscarEnProyecto(workspacePath, q);
      setMatches(result.matches || []);
      setTruncated(Boolean(result.truncated));
    } catch (err) {
      setMatches([]);
      setTruncated(false);
      setError((err as Error).message || 'Search failed.');
    } finally {
      setBusy(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runSearch(query);
    }, query.trim().length >= 2 ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [query, runSearch]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
        <span>Search</span>
        {busy && <Loader2 size={12} className="animate-spin text-forge-accent" />}
      </div>

      <div className="px-3 pb-2 flex-shrink-0">
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-forge-text/45"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in files"
            spellCheck={false}
            className="w-full bg-forge-input text-forge-text text-[12px] pl-7 pr-7 py-1.5 rounded outline-none border border-transparent focus:border-forge-accent/60"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-forge-text/50 hover:text-forge-text"
            >
              <XCircle size={13} />
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-[11px] text-red-400/90">{error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll px-3 pb-4">
        {!workspacePath ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-forge-text/50">
            <Search size={32} />
            <p className="text-[12px]">Open a folder to search</p>
          </div>
        ) : query.trim().length < 2 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-forge-text/40">
            <Search size={32} />
            <p className="text-[12px]">Type at least 2 characters</p>
          </div>
        ) : matches.length === 0 && !busy ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-forge-text/40">
            <Search size={32} />
            <p className="text-[12px]">No results</p>
          </div>
        ) : (
          <>
            <div className="text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
              Results ({matches.length}{truncated ? '+' : ''})
            </div>
            <div className="space-y-1">
              {matches.map((match, index) => (
                <button
                  key={`${match.path}:${match.line}:${index}`}
                  onClick={() => void openFilePath(match.path, { line: match.line })}
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-forge-text-strong truncate">
                      {relativePath(workspacePath, match.path)}
                    </span>
                    <span className="text-[10px] text-forge-text/40 flex-shrink-0">
                      {match.line}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-forge-text/55 truncate">
                    {match.preview.trim()}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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
      case 'extensions':
        return <ExtensionsPanel />;
      default:
        return <ExplorerPanel />;
    }
  };

  return (
    <div className="w-full h-full bg-forge-sidebar flex flex-col border-r border-forge-border/40 overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col">
        {renderTopArea()}
      </div>
      <BottomSections />
    </div>
  );
}

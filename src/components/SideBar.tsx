import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '../store';
import { lspClient } from '../lsp/client';
import { isHtmlFile, type GitChange, type Tab, type TreeNode } from '../types';
import ExtensionsPanel from './ExtensionsPanel';
import SettingsPanel from './SettingsPanel';
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
  Pencil,
  Save,
  Trash2,
  RotateCcw,
  FileCode2,
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

function toWorkspaceRelPath(workspacePath: string | null, filePath: string): string {
  if (!workspacePath) return filePath.replace(/\\/g, '/');
  const root = workspacePath.replace(/\\/g, '/');
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.startsWith(root + '/') ? normalized.slice(root.length + 1) : normalized;
}

function changeForPath(changes: GitChange[], workspacePath: string | null, filePath: string): GitChange | null {
  const rel = toWorkspaceRelPath(workspacePath, filePath);
  return changes.find((change) => change.relPath === rel) || null;
}

function folderHasChanges(changes: GitChange[], workspacePath: string | null, folderPath: string): boolean {
  const rel = toWorkspaceRelPath(workspacePath, folderPath);
  const prefix = rel ? `${rel}/` : '';
  return changes.some((change) => change.relPath.startsWith(prefix));
}

function gitBadgeClass(change: GitChange): string {
  const label = gitStatusLabel(change);
  if (label === 'D') return 'text-red-400';
  if (label === 'U' || label === 'A') return 'text-forge-accent';
  return 'text-[#FFCB6B]';
}

interface RunCommand {
  id: string;
  label: string;
  command: string;
}

interface PackageScript {
  name: string;
  command: string;
}

const RUN_COMMANDS_STORAGE_KEY = 'forge.runCommands.v1';
const DEFAULT_RUN_COMMANDS: RunCommand[] = [
  { id: 'npm-dev', label: 'npm run dev', command: 'npm run dev' },
  { id: 'npm-test', label: 'npm test', command: 'npm test' },
  { id: 'npm-build', label: 'npm run build', command: 'npm run build' },
  { id: 'npm-start', label: 'npm start', command: 'npm start' },
  { id: 'pnpm-dev', label: 'pnpm dev', command: 'pnpm dev' },
  { id: 'pnpm-run', label: 'pnpm run', command: 'pnpm run' },
  { id: 'pnpm-start', label: 'pnpm start', command: 'pnpm start' },
  { id: 'pnpm-package', label: 'pnpm package', command: 'pnpm package' },
  { id: 'pnpm-build', label: 'pnpm build', command: 'pnpm build' },
];

function loadRunCommands(): RunCommand[] {
  try {
    const raw = window.localStorage.getItem(RUN_COMMANDS_STORAGE_KEY);
    if (!raw) return DEFAULT_RUN_COMMANDS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_RUN_COMMANDS;
    const commands = parsed
      .filter((item) => item && typeof item.label === 'string' && typeof item.command === 'string')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : `cmd-${Date.now()}`,
        label: item.label,
        command: item.command,
      }))
      .filter((item) => item.label.trim() && item.command.trim());
    return commands.length > 0 ? commands : DEFAULT_RUN_COMMANDS;
  } catch {
    return DEFAULT_RUN_COMMANDS;
  }
}

function saveRunCommands(commands: RunCommand[]): void {
  try {
    window.localStorage.setItem(RUN_COMMANDS_STORAGE_KEY, JSON.stringify(commands));
  } catch {
    /* best-effort */
  }
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
  const openTabs = useStore((s) => s.openTabs);
  const workspacePath = useStore((s) => s.workspacePath);
  const gitChanges = useStore((s) => s.gitChanges);
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
  const gitChange = !isDirectory ? changeForPath(gitChanges, workspacePath, node.path) : null;
  const hasNestedGitChange = isDirectory && folderHasChanges(gitChanges, workspacePath, node.path);
  const hasUnsavedFile = !isDirectory && openTabs.some((tab) => tab.path === node.path && tab.isUnsaved);
  const hasNestedUnsavedFile = isDirectory && openTabs.some((tab) => (
    tab.isUnsaved &&
    toWorkspaceRelPath(workspacePath, tab.path).startsWith(`${toWorkspaceRelPath(workspacePath, node.path)}/`)
  ));

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
  if (isDirectory && isActiveFolder) textColor = '#B65A48';
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
            backgroundColor: isSelected ? 'rgba(182, 90, 72, 0.1)' : 'transparent',
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
          <span className="ml-auto flex items-center gap-1 pl-2 flex-shrink-0">
            {(hasUnsavedFile || hasNestedUnsavedFile) && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-forge-text/70"
                title="Unsaved changes"
              />
            )}
            {gitChange && (
              <span
                className={`text-[10px] font-semibold ${gitBadgeClass(gitChange)}`}
                title={gitStatusTitle(gitChange)}
              >
                {gitStatusLabel(gitChange)}
              </span>
            )}
            {!gitChange && hasNestedGitChange && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-forge-accent/80"
                title="Folder contains Git changes"
              />
            )}
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
        style={{ color: hover === 'file' ? '#B65A48' : '#D3D5DE' }}
        onMouseEnter={() => setHover('file')}
        onMouseLeave={() => setHover(null)}
        onClick={() => onPick('file')}
      >
        New File
      </button>
      <button
        className="block w-full text-left px-3 py-1.5 text-[13px] transition-colors"
        style={{ color: hover === 'folder' ? '#B65A48' : '#D3D5DE' }}
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
      <OutlineSection />
      <TimelineSection />
    </div>
  );
}

function activeEditorFilePath(
  workspacePath: string | null,
  openTabs: Tab[],
  activeTabId: string | null,
): string | null {
  const tab = openTabs.find((t) => t.id === activeTabId);
  if (!tab || tab.imageDataUrl || !workspacePath) return null;
  if (tab.gitDiff) return tab.gitDiff.relPath;
  const rel = toWorkspaceRelPath(workspacePath, tab.path);
  return rel || null;
}

function symbolKindLabel(kind: number): string {
  const labels: Record<number, string> = {
    5: 'class', 6: 'method', 12: 'func', 11: 'func', 10: 'prop', 13: 'var',
    22: 'const', 4: 'field', 8: 'interface', 9: 'module', 3: 'ctor',
  };
  return labels[kind] ?? 'sym';
}

function OutlineSection() {
  const openTabs = useStore((s) => s.openTabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const openFilePath = useStore((s) => s.openFilePath);

  const tab = openTabs.find((t) => t.id === activeTabId);
  const filePath = tab && !tab.imageDataUrl && !tab.gitDiff ? tab.path : null;

  const [symbols, setSymbols] = useState<import('../lsp/client').OutlineSymbol[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!filePath) {
      setSymbols([]);
      return;
    }
    setBusy(true);
    void lspClient.fetchDocumentSymbols(filePath).then((result) => {
      if (!cancelled) {
        setSymbols(result);
        setBusy(false);
      }
    });
    return () => { cancelled = true; };
  }, [filePath, tab?.content]);

  const jumpTo = (line: number) => {
    if (!filePath) return;
    void openFilePath(filePath, { line });
  };

  return (
    <CollapsibleSection title="Outline" icon={<ListTree size={12} />} defaultOpen>
      {!filePath ? (
        <p className="italic">No active editor file.</p>
      ) : busy ? (
        <p className="italic flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Loading symbols…
        </p>
      ) : symbols.length === 0 ? (
        <p className="italic">No symbols found in active editor.</p>
      ) : (
        <div className="space-y-0.5">
          {symbols.map((sym, i) => (
            <button
              key={`${sym.name}-${sym.startLine}-${i}`}
              onClick={() => jumpTo(sym.startLine)}
              className="w-full flex items-center gap-1.5 text-left hover:text-forge-accent transition-colors truncate"
              style={{ paddingLeft: `${sym.depth * 10}px` }}
              title={`${sym.name} · line ${sym.startLine}`}
            >
              <span className="text-[9px] uppercase text-forge-text/35 flex-shrink-0 w-8">
                {symbolKindLabel(sym.kind)}
              </span>
              <span className="truncate">{sym.name}</span>
            </button>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

function TimelineSection() {
  const workspacePath = useStore((s) => s.workspacePath);
  const gitIsRepo = useStore((s) => s.gitIsRepo);
  const openTabs = useStore((s) => s.openTabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const openGitCommitDiff = useStore((s) => s.openGitCommitDiff);

  const relPath = activeEditorFilePath(workspacePath, openTabs, activeTabId);
  const [entries, setEntries] = useState<import('../types').GitLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!workspacePath || !gitIsRepo || !relPath) {
      setEntries([]);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    window.electronAPI.git
      .log(workspacePath, relPath, 20)
      .then((log) => {
        if (!cancelled) {
          setEntries(log);
          setBusy(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEntries([]);
          setError((err as Error).message || 'Could not load history.');
          setBusy(false);
        }
      });
    return () => { cancelled = true; };
  }, [workspacePath, gitIsRepo, relPath]);

  return (
    <CollapsibleSection title="Timeline" icon={<History size={12} />}>
      {!workspacePath || !gitIsRepo ? (
        <p className="italic">Not a Git repository.</p>
      ) : !relPath ? (
        <p className="italic">Open a file to see its history.</p>
      ) : busy ? (
        <p className="italic flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Loading commits…
        </p>
      ) : error ? (
        <p className="text-red-400/80">{error}</p>
      ) : entries.length === 0 ? (
        <p className="italic">No commits for this file yet.</p>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <button
              key={entry.hash}
              onClick={() => void openGitCommitDiff(relPath, entry)}
              className="w-full text-left rounded px-1 py-1 hover:bg-white/5 hover:text-forge-accent transition-colors"
              title={`${entry.author} · ${entry.date}\n${entry.hash}`}
            >
              <div className="flex items-center gap-1.5">
                <GitCommit size={11} className="text-forge-accent/80 flex-shrink-0" />
                <span className="font-mono text-[10px] text-forge-accent/90">{entry.shortHash}</span>
                <span className="text-[10px] text-forge-text/40">{entry.date}</span>
              </div>
              <div className="truncate text-[11px] mt-0.5">{entry.subject}</div>
              <div className="truncate text-[10px] text-forge-text/40">{entry.author}</div>
            </button>
          ))}
        </div>
      )}
    </CollapsibleSection>
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
  const openGitDiff = useStore((s) => s.openGitDiff);
  const runCommandInTerminal = useStore((s) => s.runCommandInTerminal);
  const runAgentInTerminal = useStore((s) => s.runAgentInTerminal);

  const [message, setMessage] = useState('');

  useEffect(() => {
    void refreshGitStatus();
  }, [refreshGitStatus, workspacePath]);

  const staged = gitChanges.filter(isStaged);
  const unstaged = gitChanges.filter((change) => !isStaged(change) || isUnstaged(change));
  const canCommit = staged.length > 0 && message.trim().length > 0 && !gitBusy;

  const openChangeDiff = (change: GitChange, mode: 'unstaged' | 'staged') => {
    void openGitDiff(change.relPath, mode === 'staged');
  };

  const openChangeFile = (change: GitChange) => {
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
        onClick={() => openChangeDiff(change, mode)}
        title={`${change.relPath} — clic para diff, icono derecho para abrir archivo`}
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
      <button
        onClick={() => openChangeFile(change)}
        disabled={gitBusy}
        title="Open file"
        className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-forge-accent disabled:opacity-30"
      >
        <FileCode2 size={14} />
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
  const runAgentInTerminal = useStore((s) => s.runAgentInTerminal);
  const [commands, setCommands] = useState<RunCommand[]>(() => loadRunCommands());
  const [packageScripts, setPackageScripts] = useState<PackageScript[]>([]);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftCommand, setDraftCommand] = useState('');

  useEffect(() => {
    saveRunCommands(commands);
  }, [commands]);

  useEffect(() => {
    let cancelled = false;
    if (!workspacePath) {
      setPackageScripts([]);
      setPackageError(null);
      return;
    }

    const packagePath = joinPath(workspacePath, 'package.json');
    window.electronAPI.readFile(packagePath)
      .then((text) => {
        if (cancelled) return;
        const parsed = JSON.parse(text);
        const scripts = parsed?.scripts && typeof parsed.scripts === 'object'
          ? Object.entries(parsed.scripts)
              .filter((entry): entry is [string, string] => (
                typeof entry[0] === 'string' && typeof entry[1] === 'string'
              ))
              .map(([name]) => ({ name, command: `pnpm run ${name}` }))
          : [];
        setPackageScripts(scripts);
        setPackageError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setPackageScripts([]);
        setPackageError(null);
      });

    return () => { cancelled = true; };
  }, [workspacePath]);

  const beginEdit = (command: RunCommand) => {
    setEditingId(command.id);
    setDraftLabel(command.label);
    setDraftCommand(command.command);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const label = draftLabel.trim();
    const command = draftCommand.trim();
    if (!label || !command) return;
    setCommands((prev) =>
      prev.map((item) => item.id === editingId ? { ...item, label, command } : item),
    );
    setEditingId(null);
  };

  const addCommand = () => {
    const next: RunCommand = {
      id: `cmd-${Date.now()}`,
      label: 'New command',
      command: 'echo hello',
    };
    setCommands((prev) => [...prev, next]);
    beginEdit(next);
  };

  const deleteCommand = (id: string) => {
    setCommands((prev) => prev.filter((item) => item.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const resetCommands = () => {
    setCommands(DEFAULT_RUN_COMMANDS);
    setEditingId(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
        <span>Run and Debug</span>
        <span className="flex items-center gap-1">
          <button
            onClick={addCommand}
            title="Add command"
            className="text-forge-text hover:text-forge-accent"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={resetCommands}
            title="Restore defaults"
            className="text-forge-text hover:text-forge-accent"
          >
            <RotateCcw size={13} />
          </button>
        </span>
      </div>

      {!workspacePath ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center text-forge-text">
          <Bug size={36} className="text-forge-text/50" />
          <p className="text-sm">Open a folder to run commands</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto sidebar-scroll px-3 pb-4">
          {packageScripts.length > 0 && (
            <>
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
                <span>Package Scripts</span>
                <span>{packageScripts.length}</span>
              </div>
              <div className="space-y-1 mb-4">
                {packageScripts.map((script) => (
                  <button
                    key={script.name}
                    onClick={() => runCommandInTerminal(script.command)}
                    className="w-full flex items-center gap-2 rounded px-2 py-2 text-left hover:bg-white/5 transition-colors"
                  >
                    <span className="w-7 h-7 rounded bg-forge-accent/10 text-forge-accent border border-forge-accent/20 flex items-center justify-center flex-shrink-0">
                      <Package size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-forge-text-strong truncate">
                        {script.name}
                      </span>
                      <span className="block text-[10px] text-forge-text/45 truncate">
                        {script.command}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {packageError && (
            <p className="mb-3 text-[11px] text-red-400/90">{packageError}</p>
          )}

          <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
            <span>Commands</span>
            <span>{commands.length}</span>
          </div>
          <div className="space-y-1">
            {commands.map((cmd) => {
              const isEditing = editingId === cmd.id;
              if (isEditing) {
                return (
                  <div
                    key={cmd.id}
                    className="rounded border border-forge-accent/40 bg-forge-input/50 p-2"
                  >
                    <input
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      placeholder="Label"
                      className="w-full bg-forge-input text-forge-text text-[12px] px-2 py-1 rounded outline-none border border-transparent focus:border-forge-accent/60"
                    />
                    <input
                      value={draftCommand}
                      onChange={(e) => setDraftCommand(e.target.value)}
                      placeholder="Command"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="mt-1.5 w-full bg-forge-input text-forge-text text-[12px] px-2 py-1 rounded outline-none border border-transparent focus:border-forge-accent/60"
                    />
                    <div className="mt-2 flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditingId(null)}
                        className="w-7 h-6 flex items-center justify-center rounded text-forge-text hover:bg-white/5"
                        title="Cancel"
                      >
                        <XCircle size={13} />
                      </button>
                      <button
                        onClick={saveEdit}
                        disabled={!draftLabel.trim() || !draftCommand.trim()}
                        className="w-7 h-6 flex items-center justify-center rounded text-forge-accent hover:bg-forge-accent/10 disabled:opacity-40"
                        title="Save"
                      >
                        <Save size={13} />
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={cmd.id}
                  className="group flex items-center gap-2 rounded px-2 py-2 hover:bg-white/5 transition-colors"
                >
                  <button
                    onClick={() => runCommandInTerminal(cmd.command)}
                    className="flex items-center gap-2 text-left min-w-0 flex-1"
                  >
                    <span className="w-7 h-7 rounded bg-forge-accent/10 text-forge-accent border border-forge-accent/20 flex items-center justify-center flex-shrink-0">
                      <Play size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-forge-text-strong truncate">
                        {cmd.label}
                      </span>
                      <span className="block text-[10px] text-forge-text/45 truncate">
                        {cmd.command}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => beginEdit(cmd)}
                    className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-forge-accent"
                    title="Edit command"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => deleteCommand(cmd.id)}
                    className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-red-400"
                    title="Delete command"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
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
                onClick={() => runAgentInTerminal(command as import('../types').AgentTerminalId)}
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
  const refreshFileTree = useStore((s) => s.refreshFileTree);
  const [mode, setMode] = useState<'search' | 'replace'>('search');
  const [query, setQuery] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [replacePreview, setReplacePreview] = useState<import('../types').ReplacePreviewResult | null>(null);
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
    setReplacePreview(null);
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

  const runReplacePreview = useCallback(async () => {
    if (!workspacePath || !query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.agent.reemplazarEnProyecto(
        workspacePath,
        query,
        replaceWith,
        { previewOnly: true },
      );
      setReplacePreview(result);
    } catch (err) {
      setReplacePreview(null);
      setError((err as Error).message || 'Replace preview failed.');
    } finally {
      setBusy(false);
    }
  }, [workspacePath, query, replaceWith]);

  const applyReplace = useCallback(async () => {
    if (!workspacePath || !query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.agent.reemplazarEnProyecto(
        workspacePath,
        query,
        replaceWith,
        { previewOnly: false },
      );
      setReplacePreview(result);
      await refreshFileTree();
    } catch (err) {
      setError((err as Error).message || 'Replace failed.');
    } finally {
      setBusy(false);
    }
  }, [workspacePath, query, replaceWith, refreshFileTree]);

  useEffect(() => {
    if (mode !== 'search') return;
    const timer = window.setTimeout(() => {
      void runSearch(query);
    }, query.trim().length >= 2 ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [query, runSearch, mode]);

  useEffect(() => {
    if (mode !== 'replace') return;
    setReplacePreview(null);
    const timer = window.setTimeout(() => {
      if (query.trim()) void runReplacePreview();
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, replaceWith, mode, runReplacePreview]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('search')}
            className={mode === 'search' ? 'text-forge-accent' : 'hover:text-forge-text'}
          >
            Search
          </button>
          <span className="text-forge-text/25">|</span>
          <button
            onClick={() => setMode('replace')}
            className={mode === 'replace' ? 'text-forge-accent' : 'hover:text-forge-text'}
          >
            Replace
          </button>
        </div>
        {busy && <Loader2 size={12} className="animate-spin text-forge-accent" />}
      </div>

      <div className="px-3 pb-2 flex-shrink-0 space-y-1.5">
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-forge-text/45"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'search' ? 'Search in files' : 'Find in project'}
            spellCheck={false}
            className="w-full bg-forge-input text-forge-text text-[12px] pl-7 pr-7 py-1.5 rounded outline-none border border-transparent focus:border-forge-accent/60"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="Clear"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-forge-text/50 hover:text-forge-text"
            >
              <XCircle size={13} />
            </button>
          )}
        </div>
        {mode === 'replace' && (
          <input
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
            placeholder="Replace with"
            spellCheck={false}
            className="w-full bg-forge-input text-forge-text text-[12px] px-2 py-1.5 rounded outline-none border border-transparent focus:border-forge-accent/60"
          />
        )}
        {mode === 'replace' && query.trim() && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => void runReplacePreview()}
              disabled={busy}
              className="px-2 py-1 text-[11px] rounded border border-forge-border/60 hover:border-forge-accent/50 disabled:opacity-40"
            >
              Preview
            </button>
            <button
              onClick={() => void applyReplace()}
              disabled={busy || !replacePreview || replacePreview.totalReplacements === 0}
              className="px-2 py-1 text-[11px] rounded bg-forge-accent/15 text-forge-accent hover:bg-forge-accent/25 disabled:opacity-40"
            >
              Replace All
            </button>
          </div>
        )}
        {error && <p className="text-[11px] text-red-400/90">{error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll px-3 pb-4">
        {!workspacePath ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-forge-text/50">
            <Search size={32} />
            <p className="text-[12px]">Open a folder to search</p>
          </div>
        ) : mode === 'search' ? (
          query.trim().length < 2 ? (
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
          )
        ) : !query.trim() ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-forge-text/40">
            <Search size={32} />
            <p className="text-[12px]">Enter text to find and replace</p>
          </div>
        ) : !replacePreview && !busy ? (
          <div className="py-6 text-[12px] text-forge-text/50 text-center">No preview yet</div>
        ) : replacePreview && replacePreview.totalReplacements === 0 && !busy ? (
          <div className="py-6 text-[12px] text-forge-text/50 text-center">No matches to replace</div>
        ) : replacePreview ? (
          <>
            <div className="text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
              Preview — {replacePreview.filesChanged} files, {replacePreview.totalReplacements} replacements
              {replacePreview.applied ? ' (applied)' : ''}
            </div>
            <div className="space-y-2">
              {replacePreview.changes.map((change) => (
                <div key={change.path} className="rounded border border-forge-border/40 p-2">
                  <div className="text-[12px] text-forge-text-strong truncate mb-1">
                    {relativePath(workspacePath, change.path)}
                    <span className="text-forge-text/40 ml-2">×{change.count}</span>
                  </div>
                  {change.previews.map((preview) => (
                    <div key={`${change.path}-${preview.line}`} className="text-[11px] font-mono mt-1">
                      <div className="text-red-400/80 truncate">− {preview.before}</div>
                      <div className="text-green-400/80 truncate">+ {preview.after}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : null}
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

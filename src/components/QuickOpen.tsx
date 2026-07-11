import { useEffect, useMemo, useRef, useState } from 'react';
import { File, Search } from 'lucide-react';
import { useStore } from '../store';
import type { TreeNode } from '../types';

interface FileEntry {
  path: string;
  name: string;
  displayPath: string;
}

function flattenFiles(nodes: TreeNode[], workspacePath: string | null): FileEntry[] {
  const files: FileEntry[] = [];
  const root = workspacePath?.replace(/\\/g, '/');

  const visit = (node: TreeNode) => {
    if (node.type === 'file') {
      const normalized = node.path.replace(/\\/g, '/');
      files.push({
        path: node.path,
        name: node.name,
        displayPath: root && normalized.startsWith(root + '/')
          ? normalized.slice(root.length + 1)
          : node.path,
      });
      return;
    }
    for (const child of node.children || []) visit(child);
  };

  for (const node of nodes) visit(node);
  return files;
}

function scoreEntry(entry: FileEntry, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const name = entry.name.toLowerCase();
  const path = entry.displayPath.toLowerCase();
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  if (path.includes(q)) return 35;

  let qi = 0;
  for (const ch of path) {
    if (ch === q[qi]) qi++;
    if (qi === q.length) return 20;
  }
  return 0;
}

export default function QuickOpen() {
  const fileTree = useStore((s) => s.fileTree);
  const workspacePath = useStore((s) => s.workspacePath);
  const setQuickOpenOpen = useStore((s) => s.setQuickOpenOpen);
  const openFilePath = useStore((s) => s.openFilePath);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => setQuickOpenOpen(false);

  const files = useMemo(
    () => flattenFiles(fileTree, workspacePath),
    [fileTree, workspacePath],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    return files
      .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.displayPath.localeCompare(b.entry.displayPath))
      .slice(0, 80)
      .map((item) => item.entry);
  }, [files, query]);

  useEffect(() => { setSelectedIndex(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const openSelected = () => {
    const selected = filtered[selectedIndex];
    if (!selected) return;
    void openFilePath(selected.path);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      className="command-palette-overlay fixed inset-0 z-50 flex justify-center pt-[72px]"
      onClick={close}
    >
      <div
        className="w-[620px] max-h-[430px] bg-forge-sidebar border border-forge-border rounded-md shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-2 border-b border-forge-border/50 relative">
          <Search
            size={15}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-forge-text/45"
          />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-forge-input text-forge-text text-[14px] pl-9 pr-3 py-1.5 rounded outline-none border border-forge-accent/50 focus:border-forge-accent"
            placeholder="Go to file..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="flex-1 overflow-y-auto sidebar-scroll">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-forge-text/60 text-sm">
              {workspacePath ? 'No matching files' : 'Open a folder to use Quick Open'}
            </div>
          ) : (
            filtered.map((entry, idx) => (
              <button
                key={entry.path}
                onClick={() => {
                  void openFilePath(entry.path);
                  close();
                }}
                className={`w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors
                  ${idx === selectedIndex
                    ? 'bg-forge-accent/15 text-forge-accent'
                    : 'text-forge-text hover:bg-white/5'}
                `}
              >
                <File size={14} className="flex-shrink-0" />
                <span className="truncate flex-1">{entry.name}</span>
                <span className="text-[11px] text-forge-text/45 truncate max-w-[360px]">
                  {entry.displayPath}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { Search, XCircle, Loader2 } from 'lucide-react';

interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}


export function relativePath(workspacePath: string, filePath: string) {
  const normalizedWorkspace = workspacePath.replace(/\\/g, '/');
  const normalizedFile = filePath.replace(/\\/g, '/');
  if (normalizedFile.startsWith(normalizedWorkspace + '/')) {
    return normalizedFile.slice(normalizedWorkspace.length + 1);
  }
  return filePath;
}

export default function SearchPanel() {
  const workspacePath = useStore((s) => s.workspacePath);
  const openFilePath = useStore((s) => s.openFilePath);
  const refreshFileTree = useStore((s) => s.refreshFileTree);
  const [mode, setMode] = useState<'search' | 'replace'>('search');
  const [query, setQuery] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [replacePreview, setReplacePreview] = useState<import('../../types').ReplacePreviewResult | null>(null);
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
      // @ts-ignore
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
      // @ts-ignore
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
      // @ts-ignore
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

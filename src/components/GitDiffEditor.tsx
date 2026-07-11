import { useCallback, useEffect, useRef } from 'react';
import { DiffEditor, BeforeMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Columns2, GitCompare, Rows2 } from 'lucide-react';
import { useStore } from '../store';
import { isThemeAvailable } from '../extensions/registry';
import type { Tab } from '../types';

interface GitDiffEditorProps {
  tab: Tab;
}

function defineForgeTheme(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme('forge-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#2B2D35',
      'editor.foreground': '#ABB2BF',
      'editorGutter.background': '#2B2D35',
      'diffEditor.insertedTextBackground': '#4ADB9422',
      'diffEditor.removedTextBackground': '#FF6B6B22',
      'diffEditor.insertedLineBackground': '#4ADB9414',
      'diffEditor.removedLineBackground': '#FF6B6B14',
    },
  });
}

export default function GitDiffEditor({ tab }: GitDiffEditorProps) {
  const editorFontSize = useStore((s) => s.editorFontSize);
  const activeTheme = useStore((s) => s.activeTheme);
  const gitDiffMode = useStore((s) => s.gitDiffMode);
  const setGitDiffMode = useStore((s) => s.setGitDiffMode);
  const diffRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  const diff = tab.gitDiff;
  if (!diff) return null;

  const renderSideBySide = diff.mode === 'side-by-side';

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    defineForgeTheme(monaco);
  }, []);

  useEffect(() => {
    diffRef.current?.updateOptions({ renderSideBySide });
  }, [renderSideBySide]);

  useEffect(() => {
    diffRef.current?.updateOptions({ fontSize: editorFontSize });
  }, [editorFontSize]);

  const stagedLabel = diff.staged ? 'Staged' : 'Working Tree';
  const footerLeft = diff.commitHash ? `Parent commit` : 'HEAD (committed)';
  const footerRight = diff.commitHash
    ? diff.commitLabel ?? `Commit ${diff.commitHash.slice(0, 7)}`
    : diff.staged ? 'Index (staged)' : 'Working tree';

  return (
    <div className="w-full h-full flex flex-col bg-forge-editor">
      <div className="h-[34px] bg-forge-editor/95 border-b border-forge-border/70 flex items-center justify-between px-3 select-none flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 text-[12px]">
          <GitCompare size={14} className="text-forge-accent flex-shrink-0" />
          <span className="text-forge-text-strong truncate">{diff.relPath}</span>
          <span className="text-forge-text/45">·</span>
          <span className="text-forge-text/60">
            {diff.commitLabel ?? stagedLabel}
          </span>
          <span className="text-green-400/90">+{diff.modified.split('\n').length}</span>
          <span className="text-red-400/90">−{diff.original.split('\n').length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setGitDiffMode('inline')}
            title="Inline diff"
            className={`forge-toolbar-button ${diff.mode === 'inline' ? 'text-forge-accent' : ''}`}
          >
            <Rows2 size={14} />
          </button>
          <button
            onClick={() => setGitDiffMode('side-by-side')}
            title="Side by side diff"
            className={`forge-toolbar-button ${diff.mode === 'side-by-side' ? 'text-forge-accent' : ''}`}
          >
            <Columns2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <DiffEditor
          original={diff.original}
          modified={diff.modified}
          language={tab.language}
          theme={isThemeAvailable(activeTheme) ? activeTheme : 'forge-dark'}
          beforeMount={handleBeforeMount}
          onMount={(editor) => {
            diffRef.current = editor;
          }}
          options={{
            readOnly: true,
            renderSideBySide,
            fontSize: editorFontSize,
            fontFamily:
              "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
            fontLigatures: true,
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            minimap: { enabled: false },
            automaticLayout: true,
            renderOverviewRuler: true,
            diffWordWrap: 'off',
            ignoreTrimWhitespace: false,
            originalEditable: false,
          }}
        />
      </div>

      <div className="h-[26px] border-t border-forge-border/50 flex items-center px-3 text-[11px] text-forge-text/50 gap-4 flex-shrink-0">
        <span>{footerLeft}</span>
        <span className="text-forge-text/30">→</span>
        <span>{footerRight}</span>
      </div>
    </div>
  );
}

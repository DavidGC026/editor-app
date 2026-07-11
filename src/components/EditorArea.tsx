import { useCallback, useEffect, useRef } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import { useStore } from '../store';
import { X } from 'lucide-react';
import type { editor } from 'monaco-editor';
import logoUrl from '../assets/forge-logo.png';
import { lspClient, getLspLanguageId } from '../lsp/client';
import { attachMonaco as attachExtensionMonaco, isThemeAvailable } from '../extensions/registry';
import ImageViewer from './ImageViewer';

function toFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return prefix + encodeURI(normalized);
}

// ─────────────────────────────────────────────────────────────────────────
// Welcome Screen
// ─────────────────────────────────────────────────────────────────────────
function WelcomeScreen() {
  const openFolder = useStore((s) => s.openFolder);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-forge-editor gap-6 select-none">
      <img src={logoUrl} alt="Forge" className="w-[88px] h-[88px] object-contain opacity-60" />
      <h1 className="text-3xl font-light text-forge-text-strong/70 tracking-wide">Forge</h1>
      <div className="flex flex-col items-center gap-3 text-sm">
        <p className="text-forge-text/50">Start</p>
        <button
          onClick={() => openFolder()}
          className="text-forge-accent hover:underline cursor-pointer"
        >
          Open Folder...
        </button>
        <div className="flex flex-col items-center gap-1 mt-4 text-forge-text/40 text-xs">
          <p>
            <kbd className="px-1.5 py-0.5 bg-forge-input rounded text-forge-text/70">Ctrl+Shift+P</kbd>{' '}
            Command Palette
          </p>
          <p>
            <kbd className="px-1.5 py-0.5 bg-forge-input rounded text-forge-text/70">Ctrl+B</kbd>{' '}
            Toggle Sidebar
          </p>
          <p>
            <kbd className="px-1.5 py-0.5 bg-forge-input rounded text-forge-text/70">Ctrl+`</kbd>{' '}
            Toggle Terminal
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tab Bar — no icons; active text #4ADB94
// ─────────────────────────────────────────────────────────────────────────
function TabBar() {
  const openTabs = useStore((s) => s.openTabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);

  if (openTabs.length === 0) return null;

  return (
    <div className="h-[35px] bg-forge-tabbar flex items-end overflow-x-auto select-none">
      {openTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex items-center h-[35px] px-3 gap-2 cursor-pointer min-w-0 max-w-[220px] border-r border-black/30 transition-colors
              ${isActive
                ? 'bg-forge-tab-active'
                : 'bg-forge-tabbar hover:bg-white/[0.03]'}
            `}
          >
            {tab.isUnsaved && (
              <div className="w-[7px] h-[7px] rounded-full bg-forge-text/70 flex-shrink-0" />
            )}

            <span
              className="truncate text-[13px]"
              style={{ color: isActive ? '#4ADB94' : '#96969D' }}
            >
              {tab.name}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className={`tab-close p-0.5 flex-shrink-0
                ${isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100'}
              `}
              style={{ color: isActive ? '#96969D' : '#96969D' }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Custom Monaco Theme — "forge-dark"
// ─────────────────────────────────────────────────────────────────────────
function defineForgeTheme(monaco: typeof import('monaco-editor')) {
  // Forge-dark theme — red-dominated palette.
  // Color reference:
  //   Red      #E06C75 — strings / attribute values / properties
  //   Bright   #FF6B6B — keywords / HTML tags / control flow
  //   Light    #ABB2BF — variables / identifiers / default text
  //   Gray     #5C6370 — comments
  //   Green    #4ADB94 — functions / methods (accent contrast)
  //   Orange   #D19A66 — numbers / constants
  //   Yellow-2 #E5C07B — types / classes (warm contrast)
  //   White    #D0D3DA — operators / punctuation / delimiters
  monaco.editor.defineTheme('forge-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      // Default text
      { token: '', foreground: 'ABB2BF', background: '2D2F38' },

      // Comments — gray (kept neutral for contrast)
      { token: 'comment', foreground: '5C6370', fontStyle: 'italic' },
      { token: 'comment.html', foreground: '5C6370', fontStyle: 'italic' },
      { token: 'comment.block', foreground: '5C6370', fontStyle: 'italic' },
      { token: 'comment.line', foreground: '5C6370', fontStyle: 'italic' },

      // Keywords — bright red (control flow, declarations)
      { token: 'keyword', foreground: 'FF6B6B' },
      { token: 'keyword.control', foreground: 'FF6B6B' },
      { token: 'keyword.operator', foreground: 'D0D3DA' },
      { token: 'storage', foreground: 'FF6B6B' },
      { token: 'storage.type', foreground: 'FF6B6B' },
      { token: 'storage.modifier', foreground: 'FF6B6B' },

      // HTML / XML / template tags — bright red
      { token: 'tag', foreground: 'FF6B6B' },
      { token: 'tag.html', foreground: 'FF6B6B' },
      { token: 'tag.xml', foreground: 'FF6B6B' },
      { token: 'metatag', foreground: 'FF6B6B' },
      { token: 'metatag.content.html', foreground: 'FF6B6B' },
      { token: 'metatag.html', foreground: 'FF6B6B' },
      { token: 'metatag.xml', foreground: 'FF6B6B' },

      // Attributes / properties / keys — softer red
      { token: 'attribute.name', foreground: 'E06C75' },
      { token: 'attribute.name.html', foreground: 'E06C75' },
      { token: 'tag.attribute.name', foreground: 'E06C75' },
      { token: 'attribute.name.css', foreground: 'E06C75' },
      { token: 'property', foreground: 'E06C75' },
      { token: 'property.json', foreground: 'E06C75' },
      { token: 'key', foreground: 'E06C75' },
      { token: 'key.json', foreground: 'E06C75' },

      // Strings / attribute values — softer red
      { token: 'string', foreground: 'E06C75' },
      { token: 'string.html', foreground: 'E06C75' },
      { token: 'string.value', foreground: 'E06C75' },
      { token: 'string.quote', foreground: 'E06C75' },
      { token: 'string.escape', foreground: 'E06C75' },
      { token: 'attribute.value', foreground: 'E06C75' },
      { token: 'attribute.value.html', foreground: 'E06C75' },
      { token: 'attribute.value.xml', foreground: 'E06C75' },
      { token: 'string.value.json', foreground: 'E06C75' },
      { token: 'regexp', foreground: 'E06C75' },

      // Template / delimiters — neutral white (so red tokens pop)
      // (covers Liquid/Jinja {% %} {{ }} as well as generic delimiters)
      { token: 'delimiter', foreground: 'D0D3DA' },
      { token: 'delimiter.html', foreground: 'D0D3DA' },
      { token: 'delimiter.xml', foreground: 'D0D3DA' },
      { token: 'delimiter.bracket', foreground: 'D0D3DA' },
      { token: 'delimiter.parenthesis', foreground: 'D0D3DA' },
      { token: 'delimiter.square', foreground: 'D0D3DA' },
      { token: 'delimiter.curly', foreground: 'D0D3DA' },
      { token: 'delimiter.angle', foreground: 'D0D3DA' },
      { token: 'delimiter.template', foreground: 'FF6B6B' },
      { token: 'meta.tag.template', foreground: 'FF6B6B' },
      { token: 'string.template', foreground: 'E06C75' },
      { token: 'punctuation.definition.template', foreground: 'FF6B6B' },

      // Variables / identifiers — light (keep readable for contrast)
      { token: 'identifier', foreground: 'ABB2BF' },
      { token: 'variable', foreground: 'ABB2BF' },
      { token: 'variable.parameter', foreground: 'ABB2BF' },
      { token: 'variable.other', foreground: 'ABB2BF' },
      { token: 'variable.predefined', foreground: 'ABB2BF' },

      // Functions / methods — green (accent contrast against red)
      { token: 'function', foreground: '4ADB94' },
      { token: 'support.function', foreground: '4ADB94' },
      { token: 'entity.name.function', foreground: '4ADB94' },
      { token: 'method', foreground: '4ADB94' },

      // Numbers — orange (warm contrast)
      { token: 'number', foreground: 'D19A66' },
      { token: 'number.hex', foreground: 'D19A66' },
      { token: 'number.float', foreground: 'D19A66' },
      { token: 'constant.numeric', foreground: 'D19A66' },
      { token: 'constant', foreground: 'D19A66' },
      { token: 'constant.language', foreground: 'D19A66' },

      // Types / classes — warm yellow (contrast against red keywords)
      { token: 'type', foreground: 'E5C07B' },
      { token: 'type.identifier', foreground: 'E5C07B' },
      { token: 'class', foreground: 'E5C07B' },
      { token: 'entity.name.class', foreground: 'E5C07B' },
      { token: 'entity.name.type', foreground: 'E5C07B' },
      { token: 'support.class', foreground: 'E5C07B' },
      { token: 'support.type', foreground: 'E5C07B' },
      { token: 'namespace', foreground: 'E5C07B' },

      // Operators — white
      { token: 'operator', foreground: 'D0D3DA' },
      { token: 'operator.sql', foreground: 'D0D3DA' },

      // CSS-specific
      { token: 'attribute.value.css', foreground: 'E06C75' },
      { token: 'attribute.value.unit.css', foreground: 'D19A66' },
      { token: 'attribute.value.number.css', foreground: 'D19A66' },
      { token: 'attribute.value.hex.css', foreground: 'D19A66' },

      // Markdown
      { token: 'emphasis', fontStyle: 'italic' },
      { token: 'strong', fontStyle: 'bold' },

      // Errors
      { token: 'invalid', foreground: 'FF5370' },
    ],
    colors: {
      // Editor surface
      'editor.background': '#2D2F38',
      'editor.foreground': '#ABB2BF',

      // Cursor & selection
      'editorCursor.foreground': '#4ADB94',
      'editor.selectionBackground': '#3E4451',
      'editor.inactiveSelectionBackground': '#3E445199',
      'editor.selectionHighlightBackground': '#3E445166',
      'editor.wordHighlightBackground': '#3E445166',
      'editor.wordHighlightStrongBackground': '#3E445188',
      'editor.findMatchBackground': '#4ADB9444',
      'editor.findMatchHighlightBackground': '#4ADB9422',

      // Line numbers / gutter
      'editorLineNumber.foreground': '#636D83',
      'editorLineNumber.activeForeground': '#ABB2BF',
      'editorGutter.background': '#2D2F38',

      // Current line
      'editor.lineHighlightBackground': '#FFFFFF08',
      'editor.lineHighlightBorder': '#00000000',

      // Whitespace / indent guides
      'editorWhitespace.foreground': '#3A3F4B',
      'editorIndentGuide.background': '#3A3F4B',
      'editorIndentGuide.activeBackground': '#4ADB9466',

      // Bracket matching
      'editorBracketMatch.background': '#4ADB9422',
      'editorBracketMatch.border': '#4ADB9488',

      // Widgets
      'editorWidget.background': '#24282E',
      'editorWidget.border': '#3A3F4B',
      'editorSuggestWidget.background': '#24282E',
      'editorSuggestWidget.border': '#3A3F4B',
      'editorSuggestWidget.selectedBackground': '#3E4451',
      'editorSuggestWidget.highlightForeground': '#4ADB94',
      'editorHoverWidget.background': '#24282E',
      'editorHoverWidget.border': '#3A3F4B',

      // Scrollbars
      'scrollbarSlider.background': '#FFFFFF14',
      'scrollbarSlider.hoverBackground': '#FFFFFF22',
      'scrollbarSlider.activeBackground': '#FFFFFF33',

      // Minimap / overview
      'minimap.background': '#2D2F38',
      'editorOverviewRuler.border': '#2D2F38',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Monaco Editor Wrapper
// ─────────────────────────────────────────────────────────────────────────
function MonacoWrapper() {
  const openTabs = useStore((s) => s.openTabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const updateTabContent = useStore((s) => s.updateTabContent);
  const setCursorPosition = useStore((s) => s.setCursorPosition);
  const editorFontSize = useStore((s) => s.editorFontSize);
  const activeTheme = useStore((s) => s.activeTheme);
  const pendingEditorReveal = useStore((s) => s.pendingEditorReveal);
  const clearPendingEditorReveal = useStore((s) => s.clearPendingEditorReveal);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // Track which tab paths we've sent textDocument/didOpen for, so we
  // can fire didOpen exactly once per tab and didClose when the tab
  // disappears.
  const openedTabPathsRef = useRef<Set<string>>(new Set());

  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    defineForgeTheme(monaco);

    // Register themes/snippets contributed by installed VSIX extensions.
    // If the extension list was fetched before Monaco loaded, this replays it.
    try {
      attachExtensionMonaco(monaco);
    } catch (err) {
      console.warn('[forge] extension registry attach failed:', (err as Error)?.message);
    }

    // ── Disable Monaco's built-in TS/JS semantic diagnostics ──────────
    // Monaco ships a bundled TypeScript service that doesn't know about
    // the user's tsconfig, node_modules or types-installed packages.
    // typescript-language-server (running in the Electron main process)
    // gives us accurate, project-aware diagnostics; we plumb those in
    // via lspClient.applyDiagnostics() instead. Syntax validation is
    // kept ON because Monaco's parser also tokens cheap stuff (mismatched
    // braces, stray characters) we want to highlight regardless.
    try {
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
      });
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug('[forge] Monaco TS diagnostics setup skipped:', (err as Error)?.message);
    }

    // Wire the LSP client into Monaco. attachMonaco is idempotent — it
    // registers the providers and the diagnostics listener exactly once.
    try {
      lspClient.attachMonaco(monaco);
    } catch (err) {
      console.warn('[forge] LSP attach failed:', (err as Error)?.message);
    }
  }, []);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.focus();

    editor.onDidChangeCursorPosition((e) => {
      setCursorPosition({
        line: e.position.lineNumber,
        column: e.position.column,
      });
    });

    editor.onDidChangeCursorSelection((e) => {
      const tab = activeTabRef.current;
      const model = editor.getModel();
      if (!tab || tab.imageDataUrl || !model) {
        window.electronAPI?.claudeIde?.updateSelection(null);
        return;
      }

      const selection = e.selection;
      const text = model.getValueInRange(selection);
      window.electronAPI?.claudeIde?.updateSelection({
        text,
        filePath: tab.path,
        fileUrl: toFileUri(tab.path),
        selection: {
          start: {
            line: selection.startLineNumber - 1,
            character: selection.startColumn - 1,
          },
          end: {
            line: selection.endLineNumber - 1,
            character: selection.endColumn - 1,
          },
          isEmpty: selection.isEmpty(),
        },
      });
    });
  }, [setCursorPosition]);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: editorFontSize });
  }, [editorFontSize]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeTab || !pendingEditorReveal) return;
    if (activeTab.path !== pendingEditorReveal.filePath) return;
    if (pendingEditorReveal.selection) {
      editor.setSelection(pendingEditorReveal.selection);
      editor.revealRangeInCenter(pendingEditorReveal.selection);
      editor.focus();
    }
    clearPendingEditorReveal(pendingEditorReveal.id);
  }, [activeTab, pendingEditorReveal, clearPendingEditorReveal]);

  useEffect(() => {
    if (!activeTab || activeTab.imageDataUrl) {
      window.electronAPI?.claudeIde?.updateSelection(null);
    }
  }, [activeTab]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (activeTabId && value !== undefined) {
        const tab = activeTab;
        // Image tabs are read-only previews; ignore any spurious change
        // event Monaco might fire while we're mounted alongside them.
        if (tab?.imageDataUrl) return;

        // ── Agent streaming guard ─────────────────────────────────────
        // While the AI agent is streaming chunks into this file's buffer
        // (via `agentStreamAppendTab`) the React `value` prop changes on
        // every chunk. @monaco-editor/react does flag those as external
        // edits, but in practice a `controlled-component` race can still
        // make Monaco fire `onChange` with a STALE editor value just
        // after the next chunk lands in the store — which would clobber
        // the streamed content with the previous frame and ultimately
        // cause `agentStreamFinalizeTab` to persist OLD content to disk.
        //
        // We read the latest state via `getState()` so the callback's
        // dependency array stays narrow (no re-creation on every chunk).
        const streamingPaths = useStore.getState().agentStreamingPaths;
        if (tab && streamingPaths.has(tab.path)) {
          return;
        }

        updateTabContent(activeTabId, value);
        // Notify the LSP about the change (no-op for non-TS/JS files).
        if (tab && getLspLanguageId(tab.path)) {
          lspClient.changeDocument(tab.path, value);
        }
      }
    },
    [activeTabId, updateTabContent, activeTab]
  );

  // ── Manage didOpen / didClose for each tab ────────────────────────────
  // Whenever the set of open tabs changes we diff against what we last
  // sent: new tabs get didOpen, removed ones get didClose. Tabs whose
  // language LSP doesn't care about (e.g. markdown, json, images) are
  // skipped.
  useEffect(() => {
    const currentPaths = new Set(openTabs.map((t) => t.path));
    const previouslyOpened = openedTabPathsRef.current;

    // didOpen for newly opened tabs.
    for (const tab of openTabs) {
      if (previouslyOpened.has(tab.path)) continue;
      // Image tabs are never sent to the language server.
      if (tab.imageDataUrl) continue;
      if (!getLspLanguageId(tab.path)) continue;
      lspClient.openDocument(tab.path, tab.content);
      previouslyOpened.add(tab.path);
    }

    // didClose for tabs that have been closed.
    for (const oldPath of Array.from(previouslyOpened)) {
      if (!currentPaths.has(oldPath)) {
        lspClient.closeDocument(oldPath);
        previouslyOpened.delete(oldPath);
      }
    }
  }, [openTabs]);

  if (!activeTab) return <WelcomeScreen />;

  // Image tabs are rendered as a non-editable preview instead of being
  // forced through Monaco (which would otherwise show garbled binary text
  // for PNG/JPG/etc.).
  if (activeTab.imageDataUrl) {
    return (
      <ImageViewer
        key={activeTab.id}
        fileName={activeTab.name}
        dataUrl={activeTab.imageDataUrl}
        fileSize={activeTab.fileSize}
      />
    );
  }

  return (
    <div className="w-full h-full bg-forge-editor">
      <Editor
        key={activeTab.id}
        // path becomes part of the Monaco model URI so completion / hover
        // providers can identify which file the request is for.
        path={activeTab.path}
        language={activeTab.language}
        value={activeTab.content}
        theme={isThemeAvailable(activeTheme) ? activeTheme : 'forge-dark'}
        beforeMount={handleBeforeMount}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          fontSize: editorFontSize,
          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
          fontLigatures: true,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          renderLineHighlight: 'all',
          wordWrap: 'off',
          lineNumbers: 'on',
          glyphMargin: false,
          folding: true,
          bracketPairColorization: { enabled: true },
          automaticLayout: true,
          tabSize: 2,
          padding: { top: 8 },
          suggest: {
            showWords: true,
            showSnippets: true,
          },
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// EditorArea root
// ─────────────────────────────────────────────────────────────────────────
export default function EditorArea() {
  return (
    <div className="w-full h-full flex flex-col bg-forge-editor">
      <TabBar />
      <div className="flex-1 overflow-hidden">
        <MonacoWrapper />
      </div>
    </div>
  );
}

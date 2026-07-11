import { useStore } from '../store';
import { isThemeAvailable } from '../extensions/registry';
import {
  Bot,
  Columns2,
  KeyRound,
  Minus,
  Monitor,
  Palette,
  Plus,
  Rows2,
  Settings,
  Terminal,
  Type,
  WrapText,
} from 'lucide-react';

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-forge-border/30 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-forge-text-strong">{label}</div>
        {description && (
          <div className="mt-0.5 text-[11px] leading-snug text-forge-text/50">{description}</div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? 'bg-forge-accent' : 'bg-forge-input border border-forge-border/60'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-forge-accent">{icon}</span>
        <h3 className="text-[11px] uppercase tracking-wider text-forge-text/60 font-semibold">
          {title}
        </h3>
      </div>
      <div className="rounded-md border border-forge-border/40 bg-forge-input/20 px-3">
        {children}
      </div>
    </section>
  );
}

export default function SettingsPanel() {
  const activeTheme = useStore((s) => s.activeTheme);
  const installedExtensions = useStore((s) => s.installedExtensions);
  const setColorTheme = useStore((s) => s.setColorTheme);
  const editorFontSize = useStore((s) => s.editorFontSize);
  const setEditorFontSize = useStore((s) => s.setEditorFontSize);
  const zoomIn = useStore((s) => s.zoomIn);
  const zoomOut = useStore((s) => s.zoomOut);
  const resetZoom = useStore((s) => s.resetZoom);
  const autoSave = useStore((s) => s.autoSave);
  const formatOnSave = useStore((s) => s.formatOnSave);
  const wordWrap = useStore((s) => s.wordWrap);
  const minimapEnabled = useStore((s) => s.minimapEnabled);
  const tabSize = useStore((s) => s.tabSize);
  const gitDiffMode = useStore((s) => s.gitDiffMode);
  const setAutoSave = useStore((s) => s.setAutoSave);
  const setFormatOnSave = useStore((s) => s.setFormatOnSave);
  const setWordWrap = useStore((s) => s.setWordWrap);
  const setMinimapEnabled = useStore((s) => s.setMinimapEnabled);
  const setTabSize = useStore((s) => s.setTabSize);
  const setGitDiffMode = useStore((s) => s.setGitDiffMode);
  const setAIApiKeyModalOpen = useStore((s) => s.setAIApiKeyModalOpen);
  const aiActiveProvider = useStore((s) => s.aiActiveProvider);
  const aiActiveModel = useStore((s) => s.aiActiveModel);
  const aiConfiguredProviders = useStore((s) => s.aiConfiguredProviders);
  const setBottomTab = useStore((s) => s.setBottomTab);

  const themeOptions = [
    { id: 'forge-dark', label: 'Forge Dark' },
    ...installedExtensions.flatMap((ext) =>
      ext.themes.map((t) => ({ id: t.id, label: t.label })),
    ),
  ].filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-[35px] flex items-center px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
        <Settings size={13} className="mr-2 text-forge-accent" />
        Settings
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll px-3 pb-6">
        <Section title="Appearance" icon={<Palette size={14} />}>
          <SettingRow label="Color Theme" description="Editor syntax colors and UI chrome.">
            <select
              value={isThemeAvailable(activeTheme) ? activeTheme : 'forge-dark'}
              onChange={(e) => void setColorTheme(e.target.value)}
              className="bg-forge-input text-forge-text text-[12px] px-2 py-1 rounded border border-forge-border/60 outline-none focus:border-forge-accent/60 max-w-[180px]"
            >
              {themeOptions.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label="Editor Font Size" description={`Currently ${editorFontSize}px.`}>
            <div className="flex items-center gap-1">
              <button
                onClick={zoomOut}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 text-forge-text"
                title="Decrease"
              >
                <Minus size={14} />
              </button>
              <input
                type="number"
                min={8}
                max={32}
                value={editorFontSize}
                onChange={(e) => setEditorFontSize(Number(e.target.value))}
                className="w-12 bg-forge-input text-forge-text text-[12px] text-center px-1 py-1 rounded border border-forge-border/60 outline-none"
              />
              <button
                onClick={zoomIn}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 text-forge-text"
                title="Increase"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={resetZoom}
                className="ml-1 px-2 py-1 text-[11px] rounded hover:bg-white/5 text-forge-text/60"
              >
                Reset
              </button>
            </div>
          </SettingRow>
          <SettingRow label="Minimap" description="Code overview on the right edge.">
            <Toggle checked={minimapEnabled} onChange={setMinimapEnabled} label="Minimap" />
          </SettingRow>
          <SettingRow label="Word Wrap" description="Wrap long lines instead of horizontal scroll.">
            <Toggle checked={wordWrap} onChange={setWordWrap} label="Word wrap" />
          </SettingRow>
        </Section>

        <Section title="Editor" icon={<Type size={14} />}>
          <SettingRow label="Tab Size" description="Spaces per Tab key press.">
            <select
              value={tabSize}
              onChange={(e) => setTabSize(Number(e.target.value))}
              className="bg-forge-input text-forge-text text-[12px] px-2 py-1 rounded border border-forge-border/60 outline-none focus:border-forge-accent/60"
            >
              {[2, 4, 8].map((n) => (
                <option key={n} value={n}>
                  {n} spaces
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow
            label="Auto Save"
            description="Save files automatically after 1 second of inactivity."
          >
            <Toggle checked={autoSave} onChange={setAutoSave} label="Auto save" />
          </SettingRow>
          <SettingRow
            label="Format on Save"
            description="Run the document formatter before each save (Ctrl+S)."
          >
            <Toggle checked={formatOnSave} onChange={setFormatOnSave} label="Format on save" />
          </SettingRow>
        </Section>

        <Section title="Git" icon={<Monitor size={14} />}>
          <SettingRow
            label="Default Diff View"
            description="How Git changes open from Source Control."
          >
            <div className="flex items-center gap-1">
              <button
                onClick={() => setGitDiffMode('inline')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors ${
                  gitDiffMode === 'inline'
                    ? 'border-forge-accent text-forge-accent bg-forge-accent/10'
                    : 'border-forge-border/60 text-forge-text/60 hover:text-forge-text'
                }`}
              >
                <Rows2 size={12} />
                Inline
              </button>
              <button
                onClick={() => setGitDiffMode('side-by-side')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors ${
                  gitDiffMode === 'side-by-side'
                    ? 'border-forge-accent text-forge-accent bg-forge-accent/10'
                    : 'border-forge-border/60 text-forge-text/60 hover:text-forge-text'
                }`}
              >
                <Columns2 size={12} />
                Side by side
              </button>
            </div>
          </SettingRow>
        </Section>

        <Section title="AI" icon={<Bot size={14} />}>
          <SettingRow
            label="Active Provider"
            description={
              aiActiveProvider && aiActiveModel
                ? `${aiActiveProvider} · ${aiActiveModel}`
                : 'No provider selected'
            }
          >
            <button
              onClick={() => setAIApiKeyModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] bg-forge-accent/15 text-forge-accent hover:bg-forge-accent/25"
            >
              <KeyRound size={13} />
              Configure
            </button>
          </SettingRow>
          <SettingRow
            label="Configured Providers"
            description={`${aiConfiguredProviders.length} API key${aiConfiguredProviders.length === 1 ? '' : 's'} stored.`}
          >
            <span className="text-[12px] text-forge-text/50">
              {aiConfiguredProviders.length > 0
                ? aiConfiguredProviders.join(', ')
                : 'None'}
            </span>
          </SettingRow>
        </Section>

        <Section title="Terminal" icon={<Terminal size={14} />}>
          <SettingRow
            label="Integrated Terminal"
            description="Open the bottom panel terminal."
          >
            <button
              onClick={() => setBottomTab('terminal')}
              className="px-2.5 py-1 rounded text-[12px] border border-forge-border/60 text-forge-text hover:border-forge-accent/50 hover:text-forge-accent"
            >
              Open Terminal
            </button>
          </SettingRow>
        </Section>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { RotateCcw } from 'lucide-react';
import type { ExtensionConfigurationValue } from '../types';

function formatValue(value: unknown): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseInputValue(
  raw: string,
  setting: ExtensionConfigurationValue,
): unknown {
  switch (setting.type) {
    case 'number':
    case 'integer': {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? raw : parsed;
    }
    case 'array':
    case 'object':
      try {
        return JSON.parse(raw);
      } catch {
        return raw; // let the main-process validation produce the error
      }
    default:
      return raw;
  }
}

/** One editable row: control shape follows the declared schema. Edits land
 *  in the scope currently providing the effective value (workspace when the
 *  workspace already overrides, user otherwise). */
function SettingRow({ setting }: { setting: ExtensionConfigurationValue }) {
  const setExtensionSetting = useStore((s) => s.setExtensionSetting);
  const [draft, setDraft] = useState(() => formatValue(setting.effectiveValue));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(formatValue(setting.effectiveValue));
  }, [setting.effectiveValue]);

  const editScope = setting.effectiveSource === 'workspace' ? 'workspace' : 'user';
  const submit = async (value: unknown) => {
    setError(await setExtensionSetting(setting.key, value, editScope));
  };

  return (
    <div className="py-2 border-b border-forge-border/30 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <code className="text-[12px] text-forge-text-strong">{setting.key}</code>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {(setting.effectiveSource === 'user' || setting.effectiveSource === 'workspace') && (
            <button
              title={editScope === 'workspace' ? 'Clear workspace value' : 'Reset to default'}
              onClick={() => void submit(undefined)}
              className="w-5 h-5 flex items-center justify-center rounded text-forge-text/50 hover:text-forge-text hover:bg-white/10"
            >
              <RotateCcw size={11} />
            </button>
          )}
          {setting.type === 'boolean' ? (
            <input
              type="checkbox"
              checked={setting.effectiveValue === true}
              onChange={(e) => void submit(e.target.checked)}
              className="accent-[var(--forge-accent,#4ec9b0)]"
            />
          ) : setting.enum ? (
            <select
              value={formatValue(setting.effectiveValue)}
              onChange={(e) => {
                const chosen = setting.enum!.find(
                  (option) => formatValue(option) === e.target.value,
                );
                void submit(chosen);
              }}
              className="bg-forge-input text-forge-text text-[11px] rounded px-1.5 py-1 outline-none border border-forge-border/50 focus:border-forge-accent/60 max-w-[160px]"
            >
              {setting.enum.map((option) => (
                <option key={formatValue(option)} value={formatValue(option)}>
                  {formatValue(option)}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft !== formatValue(setting.effectiveValue)) {
                  void submit(parseInputValue(draft, setting));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="bg-forge-input text-forge-text text-[11px] rounded px-1.5 py-1 outline-none border border-forge-border/50 focus:border-forge-accent/60 w-[160px]"
            />
          )}
        </div>
      </div>
      {setting.description && (
        <p className="mt-0.5 text-[11px] leading-snug text-forge-text/50">
          {setting.description}
        </p>
      )}
      <div className="mt-0.5 text-[10px] text-forge-text/35">
        {setting.effectiveSource === 'workspace'
          ? 'Set in this workspace (.forge/settings.json)'
          : setting.effectiveSource === 'user'
            ? 'Modified by you'
            : setting.effectiveSource === 'extension-override'
              ? 'Default overridden by another extension'
              : 'Default value'}
      </div>
      {error && <p className="mt-1 text-[11px] text-red-400/90">{error}</p>}
    </div>
  );
}

/** Settings declared by one installed extension, editable in place. */
export default function ExtensionSettingsSection({ extensionId }: { extensionId: string }) {
  const extensionConfiguration = useStore((s) => s.extensionConfiguration);
  const refreshExtensionConfiguration = useStore((s) => s.refreshExtensionConfiguration);

  useEffect(() => {
    void refreshExtensionConfiguration();
  }, [refreshExtensionConfiguration]);

  const owned = extensionConfiguration.filter(
    (setting) => setting.ownerId === extensionId.toLowerCase(),
  );
  if (owned.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="text-[11px] uppercase tracking-wide text-forge-text/50 mb-1">
        Settings ({owned.length})
      </div>
      {owned.map((setting) => (
        <SettingRow key={setting.key} setting={setting} />
      ))}
    </div>
  );
}

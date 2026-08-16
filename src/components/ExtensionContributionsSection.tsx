import { useMemo } from 'react';
import { Keyboard } from 'lucide-react';
import { detectPlatform, summarizeCommands } from '../extensions/commands';
import { extensionCommandService } from '../extensions/registry';
import type { InstalledExtension } from '../types';

/** Surfaces where a command shows up, in the wording of the UI rather than
 *  the raw menu id (unknown ids fall back to the id itself). */
const MENU_LABELS: Record<string, string> = {
  'explorer/context': 'Explorer menu',
  'editor/context': 'Editor menu',
  'editor/title': 'Editor title',
  commandPalette: 'Command palette',
};

/**
 * The commands and keybindings an installed extension declares, with the
 * shortcut that reaches each one on this platform and where it surfaces.
 *
 * Declarative contributions ship metadata only: until the Extension Host
 * lands there is no handler behind them, and the section says so per
 * command instead of pretending they are runnable.
 */
export default function ExtensionContributionsSection({
  extension,
}: {
  extension: InstalledExtension;
}) {
  const platform = useMemo(() => detectPlatform(), []);
  const commands = useMemo(
    () => summarizeCommands(extension, platform),
    [extension, platform],
  );

  if (commands.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="text-[11px] uppercase tracking-wide text-forge-text/50 mb-1">
        Commands ({commands.length})
      </div>
      {commands.map((summary) => {
        const surfaces = extension.menus
          .filter((item) => item.command === summary.command)
          .map((item) => MENU_LABELS[item.menu] ?? item.menu);
        const runnable = extensionCommandService.hasHandler(summary.command);

        return (
          <div
            key={summary.command}
            className="py-2 border-b border-forge-border/30 last:border-b-0"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] text-forge-text-strong leading-snug">
                {summary.title}
              </span>
              {summary.keybindings.length > 0 && (
                <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
                  {summary.keybindings.map((binding, index) => (
                    <span
                      key={`${binding.chord}-${index}`}
                      title={binding.when ? `when: ${binding.when}` : undefined}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${
                        binding.label
                          ? 'border-forge-border/60 bg-forge-input text-forge-text/75'
                          : 'border-amber-400/25 bg-amber-400/10 text-amber-200/80'
                      }`}
                    >
                      <Keyboard size={9} />
                      {binding.label ?? `${binding.chord} (unsupported)`}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <code className="block mt-0.5 text-[10px] text-forge-text/40 break-all">
              {summary.command}
            </code>
            <div className="mt-0.5 text-[10px] text-forge-text/35">
              {surfaces.length > 0 ? surfaces.join(' · ') : 'Command palette'}
              {!runnable && ' · needs the Extension Host'}
            </div>
            {summary.enablement && (
              <div
                className="mt-0.5 text-[10px] text-forge-text/30 truncate"
                title={summary.enablement}
              >
                when: {summary.enablement}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

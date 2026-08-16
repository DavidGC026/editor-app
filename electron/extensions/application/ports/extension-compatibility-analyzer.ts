import type { ExtensionCompatibilityReport } from '../../domain/extension-dto';
import type { InstalledExtensionRecord } from '../../domain/extension-manifest';

export interface LoadedContributionCounts {
  themes: number;
  snippets: number;
  languages: number;
  iconThemes: number;
  /** Settings served by the ConfigurationService (declared inline, so
   *  loaded === declared unless normalization dropped entries). */
  configuration: number;
  configurationDefaults: number;
  /** Commands surfaced in the palette and keybindings dispatched by the
   *  renderer; both are declared inline, so loaded === declared. */
  commands: number;
  keybindings: number;
  /** TextMate grammars whose source loaded from disk. */
  grammars: number;
  /** Menu items surfaced in workbench context menus (declared inline). */
  menus: number;
}

export interface ExtensionCompatibilityAnalyzer {
  analyze(
    extension: InstalledExtensionRecord,
    loaded: LoadedContributionCounts,
  ): ExtensionCompatibilityReport;
}

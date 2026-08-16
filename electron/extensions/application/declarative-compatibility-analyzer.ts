import type {
  ExtensionCompatibilityAnalyzer,
  LoadedContributionCounts,
} from './ports/extension-compatibility-analyzer';
import type {
  ExtensionCompatibilityBlocker,
  ExtensionCompatibilityReport,
} from '../domain/extension-dto';
import type { InstalledExtensionRecord } from '../domain/extension-manifest';
import type { InstalledExtensionPayload } from '../domain/extension-dto';

type DeclarativeFamily = keyof LoadedContributionCounts;

const DECLARATIVE_FAMILIES: DeclarativeFamily[] = [
  'themes',
  'snippets',
  'languages',
  'iconThemes',
  'configuration',
  'configurationDefaults',
  'commands',
  'keybindings',
  'grammars',
  'menus',
];

function isDeclarativeFamily(key: string): key is DeclarativeFamily {
  return (DECLARATIVE_FAMILIES as string[]).includes(key);
}

/** Reports only contributions that Forge loaded and can currently activate. */
export class DeclarativeCompatibilityAnalyzer implements ExtensionCompatibilityAnalyzer {
  analyze(
    extension: InstalledExtensionRecord,
    loaded: LoadedContributionCounts,
  ): ExtensionCompatibilityReport {
    const declared: LoadedContributionCounts = {
      themes: extension.themes.length,
      snippets: extension.snippets.length,
      languages: extension.languages.length,
      iconThemes: extension.iconThemes.length,
      configuration: extension.configuration.length,
      configurationDefaults: Object.keys(extension.configurationDefaults).length,
      commands: extension.commands.length,
      keybindings: extension.keybindings.length,
      grammars: extension.grammars.length,
      menus: extension.menus.length,
    };

    const supportedContributions: string[] = [];
    const pendingContributions: string[] = [];
    const blockers: ExtensionCompatibilityBlocker[] = [];

    for (const key of extension.contributes) {
      if (!isDeclarativeFamily(key)) {
        pendingContributions.push(key);
        blockers.push({ kind: 'unsupported-contribution', contribution: key });
        continue;
      }
      if (loaded[key] > 0) {
        supportedContributions.push(key);
      } else {
        pendingContributions.push(key);
      }
      if (loaded[key] < declared[key]) {
        blockers.push({
          kind: 'contribution-load-failed',
          contribution: key,
          declared: declared[key],
          loaded: loaded[key],
        });
      }
    }

    // Activation events describe when executable code should load; without a
    // Node or browser entrypoint there is no runtime code to host.
    const entryPoints = [
      ...(extension.main ? [extension.main] : []),
      ...(extension.browser ? [extension.browser] : []),
    ];
    if (entryPoints.length > 0) {
      blockers.push({ kind: 'requires-extension-host', entryPoints });
    }

    const level: ExtensionCompatibilityReport['level'] =
      supportedContributions.length === 0
        ? 'none'
        : pendingContributions.length === 0 && entryPoints.length === 0
          ? 'full'
          : 'partial';

    return { level, supportedContributions, pendingContributions, blockers };
  }
}

/** Bridges the rich report back to the legacy `supported` IPC field. */
export function toLegacySupported(
  report: ExtensionCompatibilityReport,
): InstalledExtensionPayload['supported'] {
  return {
    declarative: report.supportedContributions,
    requiresExtensionHost: report.blockers.some((b) => b.kind === 'requires-extension-host'),
  };
}

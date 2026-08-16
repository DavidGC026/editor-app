import type {
  ExtensionGrammarPayload,
  ExtensionIconThemePayload,
  ExtensionLanguagePayload,
  ExtensionSnippetsPayload,
  ExtensionThemePayload,
} from '../../domain/extension-dto';
import type { InstalledExtensionRecord } from '../../domain/extension-manifest';

export interface ThemeContributionReader {
  read(extension: InstalledExtensionRecord): ExtensionThemePayload[];
}

export interface SnippetContributionReader {
  read(extension: InstalledExtensionRecord): ExtensionSnippetsPayload[];
}

export interface LanguageContributionReader {
  read(extension: InstalledExtensionRecord): ExtensionLanguagePayload[];
}

export interface IconThemeContributionReader {
  read(extension: InstalledExtensionRecord): ExtensionIconThemePayload[];
}

export interface GrammarContributionReader {
  read(extension: InstalledExtensionRecord): ExtensionGrammarPayload[];
}

// ── Icon theme resolution (renderer) ────────────────────────────────────
//
// Maps Explorer entries to the data-URL icons of the active icon theme,
// following VS Code's association precedence:
//
//   files:   fileNames > fileExtensions (longest multi-dot suffix) >
//            languageIds > file default
//   folders: folderNames(Expanded) > folder(Expanded) > folder
//
// Every lookup is case-insensitive and returns null when the theme has no
// association, so callers can fall back to the built-in icon set.

import type { ExtensionIconTheme, InstalledExtension } from '../types';
import { getLanguageFromPath } from '../types';

export function findIconTheme(
  extensions: InstalledExtension[],
  iconThemeId: string | null,
): ExtensionIconTheme | null {
  if (!iconThemeId) return null;
  for (const ext of extensions) {
    if (ext.enabled === false) continue;
    const match = (ext.iconThemes || []).find((theme) => theme.id === iconThemeId);
    if (match) return match;
  }
  return null;
}

function lookup(map: Record<string, string>, key: string): string | null {
  return map[key] ?? map[key.toLowerCase()] ?? null;
}

function definitionUrl(theme: ExtensionIconTheme, definitionId: string | null): string | null {
  if (!definitionId) return null;
  return theme.definitions[definitionId] ?? null;
}

export function fileIconUrl(theme: ExtensionIconTheme, fileName: string): string | null {
  const byName = lookup(theme.fileNames, fileName);
  if (byName) return definitionUrl(theme, byName);

  // "a.test.ts" tries "test.ts" before "ts" — themes may associate compound
  // extensions. Keys are stored without the leading dot.
  const segments = fileName.split('.');
  for (let i = 1; i < segments.length; i++) {
    const byExtension = lookup(theme.fileExtensions, segments.slice(i).join('.'));
    if (byExtension) return definitionUrl(theme, byExtension);
  }

  const byLanguage = lookup(theme.languageIds, getLanguageFromPath(fileName));
  if (byLanguage) return definitionUrl(theme, byLanguage);

  return definitionUrl(theme, theme.file);
}

export function folderIconUrl(
  theme: ExtensionIconTheme,
  folderName: string,
  expanded: boolean,
): string | null {
  if (expanded) {
    return definitionUrl(
      theme,
      lookup(theme.folderNamesExpanded, folderName)
        ?? theme.folderExpanded
        ?? lookup(theme.folderNames, folderName)
        ?? theme.folder,
    );
  }
  return definitionUrl(theme, lookup(theme.folderNames, folderName) ?? theme.folder);
}

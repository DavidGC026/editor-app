import * as fs from 'fs';
import * as path from 'path';
import type { ThemeContributionReader } from '../application/ports/contribution-readers';
import type { ExtensionThemePayload } from '../domain/extension-dto';
import type { InstalledExtensionRecord } from '../domain/extension-manifest';
import { resolveExtensionPath } from './extension-path';
import { parseJsonc, type JsonObject } from './jsonc';

function jsonObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function readTheme(
  extensionDir: string,
  themePath: string,
  depth = 0,
  visited = new Set<string>(),
): JsonObject {
  if (depth > 5) return {};
  const absolutePath = resolveExtensionPath(extensionDir, themePath);
  if (visited.has(absolutePath)) return {};
  visited.add(absolutePath);

  const raw = parseJsonc(fs.readFileSync(absolutePath, 'utf8'));
  if (typeof raw.include !== 'string') return raw;

  try {
    const parentAbsolute = resolveExtensionPath(
      extensionDir,
      path.resolve(path.dirname(absolutePath), raw.include),
    );
    const parent = readTheme(extensionDir, parentAbsolute, depth + 1, visited);
    return {
      ...parent,
      ...raw,
      colors: { ...jsonObject(parent.colors), ...jsonObject(raw.colors) },
      tokenColors: [
        ...(Array.isArray(parent.tokenColors) ? parent.tokenColors : []),
        ...(Array.isArray(raw.tokenColors) ? raw.tokenColors : []),
      ],
    };
  } catch {
    return raw;
  }
}

function toMonacoThemeId(extensionId: string, label: string): string {
  const slug = `${extensionId}-${label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'ext-theme';
}

export class FileThemeContributionReader implements ThemeContributionReader {
  read(extension: InstalledExtensionRecord): ExtensionThemePayload[] {
    return extension.themes.flatMap((theme) => {
      try {
        return [{
          id: toMonacoThemeId(extension.id, theme.label),
          label: theme.label,
          uiTheme: theme.uiTheme,
          data: readTheme(extension.dir, theme.path),
        }];
      } catch (error) {
        console.warn(`[forge:ext] skipping theme "${theme.label}":`, (error as Error).message);
        return [];
      }
    });
  }
}

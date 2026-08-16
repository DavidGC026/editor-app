import * as fs from 'fs';
import * as path from 'path';
import type { IconThemeContributionReader } from '../application/ports/contribution-readers';
import type { ExtensionIconThemePayload } from '../domain/extension-dto';
import type { InstalledExtensionRecord } from '../domain/extension-manifest';
import { resolveExtensionPath } from './extension-path';
import { parseJsonc } from './jsonc';

const ICON_MAX_BYTES = 32 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringRecord(value: unknown): Record<string, string> {
  const raw = record(value);
  if (!raw) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function iconToDataUrl(iconPath: string): string | null {
  const stat = fs.statSync(iconPath);
  if (stat.size > ICON_MAX_BYTES) return null;
  const buffer = fs.readFileSync(iconPath);
  const extension = path.extname(iconPath).toLowerCase();
  if (extension === '.svg') {
    return `data:image/svg+xml;utf8,${encodeURIComponent(buffer.toString('utf8'))}`;
  }
  const mime = extension === '.png' ? 'image/png'
    : extension === '.gif' ? 'image/gif'
    : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
    : extension === '.webp' ? 'image/webp'
    : 'application/octet-stream';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export class FileIconThemeContributionReader implements IconThemeContributionReader {
  read(extension: InstalledExtensionRecord): ExtensionIconThemePayload[] {
    return extension.iconThemes.flatMap((theme) => {
      try {
        const themePath = resolveExtensionPath(extension.dir, theme.path);
        const raw = parseJsonc(fs.readFileSync(themePath, 'utf8'));
        const definitions: Record<string, string> = {};
        const rawDefinitions = record(raw.iconDefinitions) ?? {};
        for (const [definitionId, value] of Object.entries(rawDefinitions)) {
          const definition = record(value);
          if (!definition || typeof definition.iconPath !== 'string') continue;
          const iconPath = resolveExtensionPath(
            extension.dir,
            path.resolve(path.dirname(themePath), definition.iconPath),
          );
          const dataUrl = iconToDataUrl(iconPath);
          if (dataUrl) definitions[definitionId] = dataUrl;
        }
        return [{
          id: theme.id,
          label: theme.label,
          definitions,
          file: typeof raw.file === 'string' ? raw.file : null,
          folder: typeof raw.folder === 'string' ? raw.folder : null,
          folderExpanded: typeof raw.folderExpanded === 'string' ? raw.folderExpanded : null,
          rootFolder: typeof raw.rootFolder === 'string' ? raw.rootFolder : null,
          rootFolderExpanded: typeof raw.rootFolderExpanded === 'string' ? raw.rootFolderExpanded : null,
          fileExtensions: stringRecord(raw.fileExtensions),
          fileNames: stringRecord(raw.fileNames),
          folderNames: stringRecord(raw.folderNames),
          folderNamesExpanded: stringRecord(raw.folderNamesExpanded),
          languageIds: stringRecord(raw.languageIds),
        }];
      } catch (error) {
        console.warn(`[forge:ext] skipping icon theme "${theme.label}":`, (error as Error).message);
        return [];
      }
    });
  }
}

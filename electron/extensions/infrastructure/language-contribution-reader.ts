import * as fs from 'fs';
import type { LanguageContributionReader } from '../application/ports/contribution-readers';
import type {
  ExtensionLanguageConfigPayload,
  ExtensionLanguagePayload,
} from '../domain/extension-dto';
import type { InstalledExtensionRecord } from '../domain/extension-manifest';
import { resolveExtensionPath } from './extension-path';
import { parseJsonc } from './jsonc';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringPairs(value: unknown): [string, string][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pairs = value.flatMap((pair) => (
    Array.isArray(pair) && pair.length === 2 && pair.every((item) => typeof item === 'string')
      ? [[pair[0] as string, pair[1] as string] as [string, string]]
      : []
  ));
  return pairs.length > 0 ? pairs : undefined;
}

function closingPairs(
  value: unknown,
): ExtensionLanguageConfigPayload['autoClosingPairs'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pairs: NonNullable<ExtensionLanguageConfigPayload['autoClosingPairs']> = [];
  for (const pair of value) {
    if (Array.isArray(pair) && pair.length === 2 && pair.every((item) => typeof item === 'string')) {
      pairs.push([pair[0] as string, pair[1] as string]);
      continue;
    }
    const item = record(pair);
    if (!item || typeof item.open !== 'string' || typeof item.close !== 'string') continue;
    pairs.push({
      open: item.open,
      close: item.close,
      ...(Array.isArray(item.notIn)
        ? { notIn: item.notIn.filter((part): part is string => typeof part === 'string') }
        : {}),
    });
  }
  return pairs.length > 0 ? pairs : undefined;
}

function readConfiguration(extensionDir: string, configPath: string): ExtensionLanguageConfigPayload {
  const raw = parseJsonc(fs.readFileSync(resolveExtensionPath(extensionDir, configPath), 'utf8'));
  const comments = record(raw.comments);
  const folding = record(raw.folding);
  const markers = record(folding?.markers);
  const indentation = record(raw.indentationRules);
  const brackets = stringPairs(raw.brackets);
  const autoClosingPairs = closingPairs(raw.autoClosingPairs);
  const surroundingPairs = closingPairs(raw.surroundingPairs);

  return {
    ...(comments ? { comments: {
      ...(typeof comments.lineComment === 'string' ? { lineComment: comments.lineComment } : {}),
      ...(stringPairs([comments.blockComment])?.[0]
        ? { blockComment: stringPairs([comments.blockComment])?.[0] }
        : {}),
    } } : {}),
    ...(brackets ? { brackets } : {}),
    ...(autoClosingPairs ? { autoClosingPairs } : {}),
    ...(surroundingPairs ? { surroundingPairs } : {}),
    ...(markers ? { folding: { markers: {
      ...(typeof markers.start === 'string' ? { start: markers.start } : {}),
      ...(typeof markers.end === 'string' ? { end: markers.end } : {}),
    } } } : {}),
    ...(typeof raw.wordPattern === 'string' ? { wordPattern: raw.wordPattern } : {}),
    ...(indentation ? { indentationRules: {
      ...(typeof indentation.increaseIndentPattern === 'string'
        ? { increaseIndentPattern: indentation.increaseIndentPattern } : {}),
      ...(typeof indentation.decreaseIndentPattern === 'string'
        ? { decreaseIndentPattern: indentation.decreaseIndentPattern } : {}),
    } } : {}),
  };
}

export class FileLanguageContributionReader implements LanguageContributionReader {
  read(extension: InstalledExtensionRecord): ExtensionLanguagePayload[] {
    return extension.languages.map((language) => {
      let configuration: ExtensionLanguageConfigPayload | null = null;
      if (language.configPath) {
        try {
          configuration = readConfiguration(extension.dir, language.configPath);
        } catch (error) {
          console.warn(`[forge:ext] skipping language config for "${language.id}":`, (error as Error).message);
        }
      }
      return {
        id: language.id,
        aliases: language.aliases,
        extensions: language.extensions,
        filenames: language.filenames,
        firstLine: language.firstLine,
        configuration,
      };
    });
  }
}

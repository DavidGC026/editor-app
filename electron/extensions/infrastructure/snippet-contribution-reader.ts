import * as fs from 'fs';
import type { SnippetContributionReader } from '../application/ports/contribution-readers';
import type { ExtensionSnippetsPayload } from '../domain/extension-dto';
import type { InstalledExtensionRecord } from '../domain/extension-manifest';
import { resolveExtensionPath } from './extension-path';
import { parseJsonc } from './jsonc';

type SnippetDefinition = ExtensionSnippetsPayload['snippets'][string];

function stringOrStrings(value: unknown): string | string[] | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === 'string');
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function normalizeSnippets(raw: Record<string, unknown>): ExtensionSnippetsPayload['snippets'] {
  const snippets: ExtensionSnippetsPayload['snippets'] = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const definition = value as Record<string, unknown>;
    const prefix = stringOrStrings(definition.prefix);
    const body = stringOrStrings(definition.body);
    const description = typeof definition.description === 'string'
      ? definition.description
      : undefined;
    const normalized: SnippetDefinition = { ...(prefix ? { prefix } : {}), ...(body ? { body } : {}) };
    if (description) normalized.description = description;
    snippets[name] = normalized;
  }
  return snippets;
}

export class FileSnippetContributionReader implements SnippetContributionReader {
  read(extension: InstalledExtensionRecord): ExtensionSnippetsPayload[] {
    return extension.snippets.flatMap((snippet) => {
      try {
        const source = fs.readFileSync(resolveExtensionPath(extension.dir, snippet.path), 'utf8');
        return [{ language: snippet.language, snippets: normalizeSnippets(parseJsonc(source)) }];
      } catch (error) {
        console.warn(`[forge:ext] skipping snippets for "${snippet.language}":`, (error as Error).message);
        return [];
      }
    });
  }
}

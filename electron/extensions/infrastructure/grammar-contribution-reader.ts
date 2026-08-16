import * as fs from 'fs';
import type { GrammarContributionReader } from '../application/ports/contribution-readers';
import type { ExtensionGrammarPayload } from '../domain/extension-dto';
import type { InstalledExtensionRecord } from '../domain/extension-manifest';
import { resolveExtensionPath } from './extension-path';

/**
 * Ships each declared grammar's raw source to the renderer. No parsing
 * happens here on purpose: vscode-textmate's `parseRawGrammar` understands
 * both JSON and plist grammars and lives with the tokenizer, so the main
 * process only guarantees the file exists, is readable and stays inside
 * the extension directory (resolveExtensionPath rejects traversal).
 */
export class FileGrammarContributionReader implements GrammarContributionReader {
  read(extension: InstalledExtensionRecord): ExtensionGrammarPayload[] {
    return extension.grammars.flatMap((grammar) => {
      try {
        const content = fs.readFileSync(
          resolveExtensionPath(extension.dir, grammar.path),
          'utf8',
        );
        return [{
          language: grammar.language,
          scopeName: grammar.scopeName,
          path: grammar.path,
          content,
          embeddedLanguages: grammar.embeddedLanguages,
          injectTo: grammar.injectTo,
        }];
      } catch (error) {
        console.warn(
          `[forge:ext] skipping grammar "${grammar.scopeName}":`,
          (error as Error).message,
        );
        return [];
      }
    });
  }
}

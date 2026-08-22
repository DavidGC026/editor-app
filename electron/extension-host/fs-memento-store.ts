/**
 * Filesystem adapter for `MementoStore`.
 *
 * One JSON file per extension and scope, **inside the directory main
 * assigned in the descriptor**. The host derives no path of its own: main is
 * the side that knows the storage root and that sanitises the extension id
 * before it becomes a path segment (design §7), so there is exactly one
 * place where that decision lives.
 */
import fs from 'fs';
import path from 'path';
import type { MementoState, MementoStore } from './extension-context';
import type { ExtensionHostDescriptor } from '../extensions/domain/rpc-protocol';

const STATE_FILE = 'state.json';

export function createFsMementoStore(): MementoStore {
  // Extensions without a workspace still get working workspace state; it
  // simply does not outlive the session, because there is nothing to scope
  // it to and inventing a path would leak state between projects.
  const volatile = new Map<string, MementoState>();

  const directoryFor = (
    scope: 'global' | 'workspace',
    descriptor: ExtensionHostDescriptor,
  ): string | null => (scope === 'global'
    ? descriptor.globalStoragePath
    : descriptor.workspaceStoragePath);

  return {
    read(scope, descriptor) {
      const directory = directoryFor(scope, descriptor);
      if (!directory) return volatile.get(`${scope}:${descriptor.id}`) ?? {};
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(directory, STATE_FILE), 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as MementoState)
          : {};
      } catch {
        // Missing or corrupt storage reads as empty: losing state is
        // recoverable, refusing to activate is not.
        return {};
      }
    },
    write(scope, descriptor, state) {
      const directory = directoryFor(scope, descriptor);
      if (!directory) {
        volatile.set(`${scope}:${descriptor.id}`, { ...state });
        return;
      }
      fs.mkdirSync(directory, { recursive: true });
      // Write-then-rename: a crash mid-write must not leave a truncated file
      // that reads as "no state" on the next launch.
      const file = path.join(directory, STATE_FILE);
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state), 'utf8');
      fs.renameSync(temporary, file);
    },
  };
}

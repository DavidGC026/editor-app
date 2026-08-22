/**
 * Filesystem side of `workspaceContains:`.
 *
 * A bounded breadth-first walk that answers one question: which of these
 * patterns match something in the workspace. Bounded on purpose — this runs
 * when a folder opens, and an unbounded walk over a monorepo (or a home
 * directory opened by accident) would stall the first seconds of the
 * session for a feature nobody asked for yet.
 *
 * The walk stops as soon as every pattern has matched, so the common case
 * (`workspaceContains:package.json`) costs one directory read.
 */
import fs from 'fs';
import path from 'path';
import { matchesWorkspacePattern } from '../domain/activation-events';

export interface WorkspaceScanLimits {
  /** Entries visited before giving up. */
  maxEntries?: number;
  /** Directory depth below the workspace root. */
  maxDepth?: number;
  /** Never descended into: huge, and never what a manifest means. */
  skipDirectories?: readonly string[];
}

const DEFAULT_SKIP = ['node_modules', '.git', 'dist', 'build', 'out', 'target', '.venv'];

export async function scanWorkspaceForPatterns(
  workspace: string | null,
  patterns: string[],
  limits: WorkspaceScanLimits = {},
): Promise<string[]> {
  if (!workspace || patterns.length === 0) return [];

  const maxEntries = limits.maxEntries ?? 4_000;
  const maxDepth = limits.maxDepth ?? 6;
  const skip = new Set(limits.skipDirectories ?? DEFAULT_SKIP);

  const pending = new Set(patterns);
  const matched: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: workspace, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && pending.size > 0) {
    const { dir, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      // An unreadable directory is not an error here: it simply contains
      // nothing we can match.
      continue;
    }

    for (const entry of entries) {
      if (++visited > maxEntries) return matched;
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(workspace, absolute);

      for (const pattern of [...pending]) {
        if (matchesWorkspacePattern(pattern, relative)) {
          pending.delete(pattern);
          matched.push(pattern);
        }
      }
      if (pending.size === 0) return matched;

      // Symlinked directories are not followed: a link pointing at `/` would
      // turn the budget into the only thing standing between us and the
      // whole filesystem.
      if (entry.isDirectory() && !skip.has(entry.name) && depth < maxDepth) {
        queue.push({ dir: absolute, depth: depth + 1 });
      }
    }
  }

  return matched;
}

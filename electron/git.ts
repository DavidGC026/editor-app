// ── Git integration (main process) ─────────────────────────────────────
//
// Thin wrapper over the `git` CLI for the Source Control panel: status,
// stage, unstage and commit. No libgit2 binding — the CLI is universally
// available wherever a repo exists and keeps us dependency-free.

import { spawn } from 'child_process';

export interface GitChange {
  /** Path relative to the repo root, forward slashes (as git reports it). */
  relPath: string;
  /** Staged (index) status letter: M/A/D/R/C/U/? or space. */
  x: string;
  /** Working-tree status letter. */
  y: string;
}

export interface GitStatusPayload {
  isRepo: boolean;
  branch: string | null;
  changes: GitChange[];
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('git', args, { cwd, windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('error', (err) => reject(err)); // git binary missing
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

async function gitOrThrow(cwd: string, args: string[]): Promise<string> {
  const { stdout, stderr, code } = await runGit(cwd, args);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `git ${args[0]} falló (código ${code}).`);
  }
  return stdout;
}

export async function gitStatus(workspacePath: string): Promise<GitStatusPayload> {
  try {
    const { stdout, code } = await runGit(workspacePath, [
      'rev-parse',
      '--is-inside-work-tree',
    ]);
    if (code !== 0 || stdout.trim() !== 'true') {
      return { isRepo: false, branch: null, changes: [] };
    }
  } catch {
    // git binary not installed
    return { isRepo: false, branch: null, changes: [] };
  }

  let branch: string | null = null;
  try {
    branch = (await gitOrThrow(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    // Repo with no commits yet: fall back to the symbolic ref name.
    try {
      const ref = (
        await gitOrThrow(workspacePath, ['symbolic-ref', '--short', 'HEAD'])
      ).trim();
      branch = ref || null;
    } catch {
      branch = null;
    }
  }

  // -z: NUL-separated entries, no quoting/escaping of paths. Rename/copy
  // entries carry a second NUL-separated field (the original path).
  const raw = await gitOrThrow(workspacePath, ['status', '--porcelain=v1', '-z']);
  const tokens = raw.split('\0').filter((t) => t.length > 0);

  const changes: GitChange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    const relPath = entry.slice(3);
    if (x === 'R' || x === 'C') i++; // skip the "original path" token
    changes.push({ relPath, x, y });
  }

  return { isRepo: true, branch, changes };
}

export async function gitStage(workspacePath: string, relPaths: string[]): Promise<void> {
  if (relPaths.length === 0) return;
  await gitOrThrow(workspacePath, ['add', '--', ...relPaths]);
}

export async function gitUnstage(workspacePath: string, relPaths: string[]): Promise<void> {
  if (relPaths.length === 0) return;
  // `git restore --staged` requires git ≥ 2.23; fall back to reset for
  // ancient installs.
  const { code, stderr } = await runGit(workspacePath, [
    'restore',
    '--staged',
    '--',
    ...relPaths,
  ]);
  if (code !== 0) {
    if (/is not a git command|unknown option/i.test(stderr)) {
      await gitOrThrow(workspacePath, ['reset', 'HEAD', '--', ...relPaths]);
      return;
    }
    throw new Error(stderr.trim() || 'git restore --staged falló.');
  }
}

export async function gitCommit(workspacePath: string, message: string): Promise<string> {
  if (!message.trim()) {
    throw new Error('El mensaje de commit no puede estar vacío.');
  }
  const stdout = await gitOrThrow(workspacePath, ['commit', '-m', message]);
  return stdout.trim();
}

export async function gitDiff(
  workspacePath: string,
  relPath: string,
  staged = false,
): Promise<string> {
  if (!relPath.trim()) return '';
  const args = staged
    ? ['diff', '--cached', '--', relPath]
    : ['diff', '--', relPath];
  return gitOrThrow(workspacePath, args);
}

export interface GitFileVersions {
  /** Content at HEAD (or empty for new files). */
  original: string;
  /** Working-tree or index content, depending on `staged`. */
  modified: string;
}

async function gitShowRef(cwd: string, ref: string, relPath: string): Promise<string> {
  try {
    return await gitOrThrow(cwd, ['show', `${ref}:${relPath}`]);
  } catch {
    return '';
  }
}

async function readWorkingFile(cwd: string, relPath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  try {
    return await readFile(join(cwd, relPath), 'utf8');
  } catch {
    return '';
  }
}

/** Return the two sides of a diff for Monaco's diff editor.
 *  - unstaged: HEAD vs working tree
 *  - staged:   HEAD vs index */
export async function gitGetFileVersions(
  workspacePath: string,
  relPath: string,
  staged = false,
): Promise<GitFileVersions> {
  if (!relPath.trim()) return { original: '', modified: '' };
  const original = await gitShowRef(workspacePath, 'HEAD', relPath);
  const modified = staged
    ? await gitShowRef(workspacePath, '', relPath)
    : await readWorkingFile(workspacePath, relPath);
  return { original, modified };
}

/** Diff sides for a specific commit: parent version vs commit version. */
export async function gitGetCommitFileVersions(
  workspacePath: string,
  relPath: string,
  commitHash: string,
): Promise<GitFileVersions> {
  if (!relPath.trim() || !commitHash.trim()) return { original: '', modified: '' };
  const modified = await gitShowRef(workspacePath, commitHash, relPath);
  let original = '';
  try {
    original = await gitOrThrow(workspacePath, ['show', `${commitHash}^:${relPath}`]);
  } catch {
    original = '';
  }
  return { original, modified };
}

export async function gitLog(
  workspacePath: string,
  relPath?: string,
  limit = 30,
): Promise<GitLogEntry[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));
  const pretty = '%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e';
  const args = [
    'log',
    `-${safeLimit}`,
    '--date=short',
    `--pretty=format:${pretty}`,
  ];
  if (relPath?.trim()) args.push('--', relPath);

  const stdout = await gitOrThrow(workspacePath, args);
  return stdout
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash = '', shortHash = '', author = '', date = '', subject = ''] = entry.split('\x1f');
      return { hash, shortHash, author, date, subject };
    })
    .filter((entry) => entry.hash && entry.subject);
}

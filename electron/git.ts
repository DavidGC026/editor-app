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
  /** Commits ahead of the upstream (pending push). 0 when no upstream. */
  ahead: number;
  /** Commits behind the upstream (pending pull). 0 when no upstream. */
  behind: number;
  /** The current branch tracks a remote branch. */
  hasUpstream: boolean;
  /** The repo has at least one remote configured. */
  hasRemote: boolean;
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
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('git', args, {
        cwd,
        windowsHide: true,
        // Never block on an interactive credential/host prompt inside the
        // app: fail fast with a readable error instead.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extraEnv },
      });
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

async function gitOrThrow(
  cwd: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<string> {
  const { stdout, stderr, code } = await runGit(cwd, args, extraEnv);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `git ${args[0]} falló (código ${code}).`);
  }
  return stdout;
}

// ── GitHub token injection ──────────────────────────────────────────────
//
// When the user signed in with GitHub (OAuth device flow) we authenticate
// HTTPS remotes through a transient in-memory credential helper. The token
// travels via an environment variable — it never touches the command line
// (visible in `ps`) nor any file on disk.
export interface GitAuth {
  githubToken: string;
}

async function remoteIsGithubHttps(cwd: string): Promise<boolean> {
  const { stdout, code } = await runGit(cwd, ['remote', 'get-url', '--push', 'origin']);
  if (code !== 0) return false;
  return /^https:\/\/([^/]+@)?github\.com\//i.test(stdout.trim());
}

/** `-c` args that override every configured credential helper with one that
 *  answers from $FORGE_GITHUB_TOKEN. The empty first value resets the
 *  helper list so system/global helpers can't interfere. */
function credentialArgs(): string[] {
  return [
    '-c', 'credential.helper=',
    '-c',
    'credential.helper=!f() { echo "username=x-access-token"; echo "password=$FORGE_GITHUB_TOKEN"; }; f',
  ];
}

async function authFor(
  cwd: string,
  auth: GitAuth | undefined,
): Promise<{ args: string[]; env: Record<string, string> }> {
  if (auth?.githubToken && (await remoteIsGithubHttps(cwd))) {
    return { args: credentialArgs(), env: { FORGE_GITHUB_TOKEN: auth.githubToken } };
  }
  return { args: [], env: {} };
}

const NOT_A_REPO: GitStatusPayload = {
  isRepo: false,
  branch: null,
  changes: [],
  ahead: 0,
  behind: 0,
  hasUpstream: false,
  hasRemote: false,
};

export async function gitStatus(workspacePath: string): Promise<GitStatusPayload> {
  try {
    const { stdout, code } = await runGit(workspacePath, [
      'rev-parse',
      '--is-inside-work-tree',
    ]);
    if (code !== 0 || stdout.trim() !== 'true') {
      return NOT_A_REPO;
    }
  } catch {
    // git binary not installed
    return NOT_A_REPO;
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

  let hasRemote = false;
  try {
    hasRemote = (await gitOrThrow(workspacePath, ['remote'])).trim().length > 0;
  } catch {
    hasRemote = false;
  }

  let ahead = 0;
  let behind = 0;
  let hasUpstream = false;
  try {
    const counts = (
      await gitOrThrow(workspacePath, [
        'rev-list',
        '--left-right',
        '--count',
        'HEAD...@{upstream}',
      ])
    ).trim();
    const [a = '0', b = '0'] = counts.split(/\s+/);
    ahead = Number.parseInt(a, 10) || 0;
    behind = Number.parseInt(b, 10) || 0;
    hasUpstream = true;
  } catch {
    // No upstream configured (or no commits yet).
    hasUpstream = false;
  }

  return { isRepo: true, branch, changes, ahead, behind, hasUpstream, hasRemote };
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

/** Discard local changes for the given paths (like VS Code's "Discard
 *  Changes"): untracked files are removed, staged-new files are dropped
 *  from index and disk, and everything else is restored from HEAD. */
export async function gitDiscard(workspacePath: string, relPaths: string[]): Promise<void> {
  if (relPaths.length === 0) return;
  const status = await gitStatus(workspacePath);
  const byPath = new Map(status.changes.map((c) => [c.relPath, c]));

  const untracked: string[] = [];
  const addedNew: string[] = [];
  const tracked: string[] = [];
  for (const p of relPaths) {
    const change = byPath.get(p);
    if (!change) continue;
    if (change.x === '?' || change.y === '?') untracked.push(p);
    else if (change.x === 'A') addedNew.push(p);
    else tracked.push(p);
  }

  if (tracked.length > 0) {
    await gitOrThrow(workspacePath, ['checkout', 'HEAD', '--', ...tracked]);
  }
  if (addedNew.length > 0) {
    await gitOrThrow(workspacePath, ['rm', '-f', '--', ...addedNew]);
  }
  if (untracked.length > 0) {
    await gitOrThrow(workspacePath, ['clean', '-f', '--', ...untracked]);
  }
}

export async function gitCommit(workspacePath: string, message: string): Promise<string> {
  if (!message.trim()) {
    throw new Error('El mensaje de commit no puede estar vacío.');
  }
  const { stdout, stderr, code } = await runGit(workspacePath, ['commit', '-m', message]);
  if (code !== 0) {
    const raw = (stderr.trim() || stdout.trim());
    // The most common first-run failure: git identity not configured. Give
    // an actionable message instead of git's multi-line lecture.
    if (/user\.(name|email)/.test(raw)) {
      throw new Error(
        'Git no tiene identidad configurada. Ejecuta:\n' +
          'git config --global user.name "Tu Nombre"\n' +
          'git config --global user.email "tu@email.com"',
      );
    }
    throw new Error(raw || `git commit falló (código ${code}).`);
  }
  return stdout.trim();
}

async function upstreamRef(workspacePath: string): Promise<string | null> {
  const { stdout, code } = await runGit(workspacePath, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  return code === 0 ? stdout.trim() || null : null;
}

/** Re-throw remote errors with an actionable message when git couldn't
 *  authenticate (interactive prompts are disabled inside the app). */
function friendlyRemoteError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/could not read (Username|Password)|Authentication failed|Permission denied \(publickey\)/i.test(msg)) {
    return new Error(
      'Git no pudo autenticarse con el remoto. Inicia sesión con GitHub desde el ' +
        'panel Source Control (icono de GitHub), o usa una URL SSH con tu clave cargada.\n\n' + msg,
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

export async function gitPush(workspacePath: string, auth?: GitAuth): Promise<string> {
  const { args: credArgs, env } = await authFor(workspacePath, auth);
  const upstream = await upstreamRef(workspacePath);
  if (upstream) {
    try {
      return (await gitOrThrow(workspacePath, [...credArgs, 'push'], env)).trim();
    } catch (err) {
      throw friendlyRemoteError(err);
    }
  }
  // No upstream yet: publish the current branch to the first remote.
  const remotes = (await gitOrThrow(workspacePath, ['remote']))
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);
  if (remotes.length === 0) {
    throw new Error(
      'No hay ningún remoto configurado. Añade uno con:\ngit remote add origin <url>',
    );
  }
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  const branch = (
    await gitOrThrow(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  ).trim();
  if (!branch || branch === 'HEAD') {
    throw new Error('No hay una rama activa para hacer push (HEAD desprendido).');
  }
  try {
    return (await gitOrThrow(workspacePath, [...credArgs, 'push', '-u', remote, branch], env)).trim();
  } catch (err) {
    throw friendlyRemoteError(err);
  }
}

export async function gitPull(workspacePath: string, auth?: GitAuth): Promise<string> {
  const upstream = await upstreamRef(workspacePath);
  if (!upstream) {
    throw new Error(
      'La rama actual no tiene upstream configurado. Haz push primero para publicarla.',
    );
  }
  const { args: credArgs, env } = await authFor(workspacePath, auth);
  try {
    return (await gitOrThrow(workspacePath, [...credArgs, 'pull', '--ff-only'], env)).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Not possible to fast-forward|divergent branches/i.test(msg)) {
      throw new Error(
        'Las ramas local y remota divergieron. Resuélvelo en una terminal con ' +
          '`git pull --rebase` o `git merge`.',
      );
    }
    throw friendlyRemoteError(err);
  }
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

export interface GitDiffSummary {
  /** True when the summary covers the index (staged); false → working tree. */
  staged: boolean;
  /** Unified diff (truncated for LLM consumption), '' when nothing changed. */
  text: string;
}

const DIFF_SUMMARY_MAX_CHARS = 50_000;

/** Diff of the pending changes, meant as LLM input (e.g. to draft a commit
 *  message). Prefers the staged diff; falls back to the working tree plus
 *  the list of untracked files. */
export async function gitDiffSummary(workspacePath: string): Promise<GitDiffSummary> {
  let staged = true;
  let text = await gitOrThrow(workspacePath, ['diff', '--cached']);
  if (!text.trim()) {
    staged = false;
    text = await gitOrThrow(workspacePath, ['diff']);
    const untracked = (
      await gitOrThrow(workspacePath, ['ls-files', '--others', '--exclude-standard'])
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (untracked.length > 0) {
      text += `\n\nArchivos nuevos sin seguimiento:\n${untracked.map((f) => `- ${f}`).join('\n')}`;
    }
  }
  text = text.trim();
  if (text.length > DIFF_SUMMARY_MAX_CHARS) {
    text = `${text.slice(0, DIFF_SUMMARY_MAX_CHARS)}\n\n[diff truncado por longitud]`;
  }
  return { staged, text };
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

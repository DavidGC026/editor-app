/**
 * Agent tools — filesystem primitives the AI agent can call.
 *
 * These run in the main process so they have unrestricted disk access.
 * Each tool returns a stringified result that's safe to feed back into
 * the model's context.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Directories the agent must never inspect. */
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  '.git',
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.svelte-kit',
  '.vercel',
  '.idea',
  '.vscode',
  'venv',
  '.venv',
  '__pycache__',
  'target',
  'build',
  'out',
  'coverage',
]);

const MAX_FILE_BYTES = 1_500_000; // 1.5 MB safety cap
const MAX_SEARCH_RESULTS = 100;
const MAX_LIST_ENTRIES = 500;

function isIgnoredDir(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.has(name);
}

/** Resolve a path that may be relative to the workspace. */
function resolveAgentPath(workspacePath: string, ruta: string): string {
  if (path.isAbsolute(ruta)) return path.normalize(ruta);
  return path.normalize(path.join(workspacePath, ruta));
}

/** Make sure the resolved path lives inside the workspace. Prevents accidental
 *  escapes like `../../etc/passwd`. */
function assertInsideWorkspace(workspacePath: string, fullPath: string): void {
  const wsResolved = path.resolve(workspacePath);
  const tgt = path.resolve(fullPath);
  if (tgt !== wsResolved && !tgt.startsWith(wsResolved + path.sep)) {
    throw new Error(`Ruta fuera del workspace: ${fullPath}`);
  }
}

// ─── leer_archivo ────────────────────────────────────────────────────────
export function leerArchivo(workspacePath: string, ruta: string): {
  path: string;
  content: string;
  bytes: number;
} {
  const full = resolveAgentPath(workspacePath, ruta);
  assertInsideWorkspace(workspacePath, full);
  if (!fs.existsSync(full)) {
    throw new Error(`Archivo no encontrado: ${ruta}`);
  }
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    throw new Error(`La ruta apunta a una carpeta, no a un archivo: ${ruta}`);
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(
      `Archivo demasiado grande (${stat.size} bytes). Límite: ${MAX_FILE_BYTES} bytes.`,
    );
  }
  const content = fs.readFileSync(full, 'utf-8');
  return { path: full, content, bytes: stat.size };
}

// ─── escribir_archivo ────────────────────────────────────────────────────
export function escribirArchivo(
  workspacePath: string,
  ruta: string,
  contenido: string,
): { path: string; existed: boolean; bytes: number } {
  const full = resolveAgentPath(workspacePath, ruta);
  assertInsideWorkspace(workspacePath, full);
  const existed = fs.existsSync(full);
  if (existed) {
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      throw new Error(`No se puede sobreescribir una carpeta: ${ruta}`);
    }
  }
  // Make parent directories if needed.
  const parent = path.dirname(full);
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(full, contenido, 'utf-8');
  return { path: full, existed, bytes: Buffer.byteLength(contenido, 'utf-8') };
}

// ─── listar_carpeta ──────────────────────────────────────────────────────
export function listarCarpeta(workspacePath: string, ruta: string): {
  path: string;
  entries: { name: string; type: 'file' | 'directory' }[];
} {
  const full = resolveAgentPath(workspacePath, ruta || '.');
  assertInsideWorkspace(workspacePath, full);
  if (!fs.existsSync(full)) {
    throw new Error(`Carpeta no encontrada: ${ruta}`);
  }
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) {
    throw new Error(`La ruta no es una carpeta: ${ruta}`);
  }
  const dirents = fs.readdirSync(full, { withFileTypes: true });
  const entries = dirents
    .filter((e) => !(e.isDirectory() && isIgnoredDir(e.name)))
    .slice(0, MAX_LIST_ENTRIES)
    .map((e) => ({
      name: e.name,
      type: (e.isDirectory() ? 'directory' : 'file') as 'file' | 'directory',
    }));
  return { path: full, entries };
}

// ─── buscar_en_proyecto ──────────────────────────────────────────────────
export function buscarEnProyecto(
  workspacePath: string,
  texto: string,
): {
  query: string;
  matches: { path: string; line: number; preview: string }[];
  truncated: boolean;
} {
  if (!texto || texto.length < 2) {
    throw new Error('La consulta debe tener al menos 2 caracteres.');
  }
  const lowerNeedle = texto.toLowerCase();
  const matches: { path: string; line: number; preview: string }[] = [];
  let truncated = false;

  function walk(dir: string) {
    if (matches.length >= MAX_SEARCH_RESULTS) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= MAX_SEARCH_RESULTS) {
        truncated = true;
        return;
      }
      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      // Skip binary-ish files by extension.
      const ext = path.extname(entry.name).toLowerCase();
      if (
        [
          '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.icns',
          '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
          '.mp3', '.mp4', '.mov', '.avi', '.wav', '.ogg', '.flac',
          '.woff', '.woff2', '.ttf', '.eot', '.otf',
          '.exe', '.dll', '.dylib', '.so', '.bin', '.lock',
        ].includes(ext)
      ) {
        continue;
      }
      const full = path.join(dir, entry.name);
      let text: string;
      try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        text = fs.readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerNeedle)) {
          matches.push({
            path: full,
            line: i + 1,
            preview: lines[i].slice(0, 240),
          });
          if (matches.length >= MAX_SEARCH_RESULTS) {
            truncated = true;
            return;
          }
        }
      }
    }
  }

  walk(workspacePath);
  return { query: texto, matches, truncated };
}

// ─── Project tree (used by /init) ────────────────────────────────────────
export interface ProjectTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ProjectTreeNode[];
  size?: number;
}

export function buildProjectTree(workspacePath: string, maxDepth = 8): ProjectTreeNode {
  function walk(dir: string, depth: number): ProjectTreeNode {
    const name = path.basename(dir) || dir;
    const node: ProjectTreeNode = { name, path: dir, type: 'directory', children: [] };
    if (depth >= maxDepth) return node;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return node;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (isIgnoredDir(e.name)) continue;
        node.children!.push(walk(full, depth + 1));
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          /* noop */
        }
        node.children!.push({ name: e.name, path: full, type: 'file', size });
      }
    }
    return node;
  }
  return walk(workspacePath, 0);
}

/** Renders a project tree as an ASCII tree string. */
export function renderTree(root: ProjectTreeNode, prefix = '', isLast = true): string {
  let out = '';
  if (prefix === '') {
    out += `${root.name}/\n`;
  } else {
    out += `${prefix}${isLast ? '└── ' : '├── '}${root.name}${root.type === 'directory' ? '/' : ''}\n`;
  }
  const children = root.children || [];
  const childPrefix = prefix === '' ? '' : prefix + (isLast ? '    ' : '│   ');
  children.forEach((child, idx) => {
    const last = idx === children.length - 1;
    out += renderTree(child, childPrefix, last);
  });
  return out;
}

/**
 * Collect a representative set of files for /init context. We sample the
 * "interesting" files (package.json, README, top-level configs, src/**)
 * up to ~30 entries to give the model enough signal without overloading.
 */
export function collectInitContext(workspacePath: string): {
  tree: string;
  manifestFiles: { path: string; relPath: string; content: string }[];
} {
  const root = buildProjectTree(workspacePath, 8);
  const tree = renderTree(root);

  const INTERESTING_NAMES = new Set([
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'tsconfig.electron.json',
    'vite.config.ts',
    'vite.config.js',
    'webpack.config.js',
    'rollup.config.js',
    'tailwind.config.js',
    'postcss.config.js',
    'next.config.js',
    'nuxt.config.ts',
    'astro.config.mjs',
    'svelte.config.js',
    'README.md',
    'readme.md',
    'README',
    'LICENSE',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    'requirements.txt',
    'Pipfile',
    'composer.json',
    'Gemfile',
    'pom.xml',
    'build.gradle',
    'Dockerfile',
    'docker-compose.yml',
    '.env.example',
    'index.html',
  ]);

  const manifestFiles: { path: string; relPath: string; content: string }[] = [];
  let budget = 30;

  function visit(node: ProjectTreeNode) {
    if (budget <= 0) return;
    if (node.type === 'file') {
      const rel = path.relative(workspacePath, node.path);
      const isInteresting =
        INTERESTING_NAMES.has(node.name) ||
        // Capture the very first index/main file of an "src" folder.
        /^src[\\/](?:index|main|app)\.(?:tsx?|jsx?|py|go|rs|java|kt|swift)$/i.test(rel);
      if (isInteresting) {
        try {
          const stat = fs.statSync(node.path);
          if (stat.size <= MAX_FILE_BYTES) {
            const content = fs.readFileSync(node.path, 'utf-8');
            manifestFiles.push({
              path: node.path,
              relPath: rel,
              content: content.slice(0, 30_000),
            });
            budget--;
          }
        } catch {
          /* noop */
        }
      }
    } else {
      for (const c of node.children || []) visit(c);
    }
  }
  visit(root);

  return { tree, manifestFiles };
}

// ─── Folder content snapshot (used as agent context) ─────────────────────
//
// When the user selects a folder in the explorer, we ship a snapshot of
// every file inside (up to a budget) as the active context. The agent
// can then ask for more via `leer_archivo` if needed.
export function snapshotFolder(
  workspacePath: string,
  folderPath: string,
  maxFiles = 25,
  maxBytesPerFile = 30_000,
): { path: string; relPath: string; content: string }[] {
  const results: { path: string; relPath: string; content: string }[] = [];

  function walk(dir: string) {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (results.length >= maxFiles) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (isIgnoredDir(e.name)) continue;
        walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (
        [
          '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.icns',
          '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar', '.lock',
          '.woff', '.woff2', '.ttf', '.eot', '.otf',
          '.exe', '.dll', '.dylib', '.so', '.bin',
        ].includes(ext)
      ) {
        continue;
      }
      try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = fs.readFileSync(full, 'utf-8');
        results.push({
          path: full,
          relPath: path.relative(workspacePath, full),
          content: content.slice(0, maxBytesPerFile),
        });
      } catch {
        /* noop */
      }
    }
  }

  walk(folderPath);
  return results;
}

/** Check if a file exists. Used by the renderer to decide whether a diff is
 *  needed before applying `escribir_archivo`. */
export function fileExists(workspacePath: string, ruta: string): boolean {
  const full = resolveAgentPath(workspacePath, ruta);
  try {
    assertInsideWorkspace(workspacePath, full);
    return fs.existsSync(full) && fs.statSync(full).isFile();
  } catch {
    return false;
  }
}

export function readFileSafe(workspacePath: string, ruta: string): string | null {
  try {
    const r = leerArchivo(workspacePath, ruta);
    return r.content;
  } catch {
    return null;
  }
}

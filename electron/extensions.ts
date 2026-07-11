// ── VSIX extension manager (main process) ──────────────────────────────
//
// Forge supports a small, safe subset of the VSCode extension surface:
// declarative contributions that don't require running extension code.
//
//   contributes.themes    → color themes (converted to Monaco in renderer)
//   contributes.snippets  → completion snippets per language
//
// A .vsix is just a ZIP with the extension under `extension/`. We extract
// it into userData/extensions/<publisher.name>/ and keep a registry in the
// same JSON config file the rest of the app uses.

import { app, dialog, net, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { readZipEntries } from './zip';

// ── Payload shapes shared with the renderer ────────────────────────────

export interface ExtensionThemePayload {
  /** Monaco-safe id, e.g. "dracula-soft". Unique across extensions. */
  id: string;
  /** Human label from the theme contribution ("Dracula Soft"). */
  label: string;
  /** "vs" | "vs-dark" | "hc-black" hint derived from uiTheme/type. */
  uiTheme: string;
  /** Raw VSCode theme JSON (comments stripped, includes merged). */
  data: any;
}

export interface ExtensionSnippetsPayload {
  /** VSCode language id the snippets apply to (e.g. "typescript"). */
  language: string;
  /** Parsed snippets file: { name: { prefix, body, description } }. */
  snippets: Record<string, { prefix?: string | string[]; body?: string | string[]; description?: string }>;
}

export interface InstalledExtensionPayload {
  id: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  themes: ExtensionThemePayload[];
  snippets: ExtensionSnippetsPayload[];
}

export interface MarketplaceExtensionPayload {
  id: string;
  name: string;
  namespace: string;
  displayName: string;
  description: string;
  version: string;
  iconUrl: string | null;
  downloadCount: number;
  averageRating: number | null;
  reviewCount: number;
  verified: boolean;
  deprecated: boolean;
  lastUpdated: string | null;
}

export interface MarketplaceSearchPayload {
  total: number;
  extensions: MarketplaceExtensionPayload[];
}

interface RegistryEntry {
  id: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  /** Directory (under userData/extensions) the vsix was extracted into. */
  dir: string;
  themes: { label: string; uiTheme: string; path: string }[];
  snippets: { language: string; path: string }[];
}

// ── Config helpers (same forge-config.json as the rest of main.ts) ─────

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'forge-config.json');
}

function loadConfig(): Record<string, any> {
  try {
    const parsed = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, any>): void {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[forge:ext] failed to write config:', (err as Error).message);
  }
}

function loadRegistry(): Record<string, RegistryEntry> {
  const cfg = loadConfig();
  const reg = cfg.extensions;
  return reg && typeof reg === 'object' ? reg : {};
}

function saveRegistry(registry: Record<string, RegistryEntry>): void {
  const cfg = loadConfig();
  cfg.extensions = registry;
  saveConfig(cfg);
}

function getExtensionsRoot(): string {
  return path.join(app.getPath('userData'), 'extensions');
}

// ── JSONC parsing ───────────────────────────────────────────────────────
// VSCode theme/snippet files are JSON-with-comments and often carry
// trailing commas. Strip both before JSON.parse.

function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') { inLine = false; out += ch; }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i++; }
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    out += ch;
  }
  return out;
}

function parseJsonc(text: string): any {
  const noComments = stripJsonComments(text);
  // Remove trailing commas: `,` followed by whitespace and `}` or `]`.
  const noTrailing = noComments.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noTrailing);
}

// ── Theme reading (with `include` chain merging) ────────────────────────
// VSCode themes can reference a parent file: { "include": "./dark_vs.json" }.
// The child's colors/tokenColors override/extend the parent's.

function readThemeJson(themePath: string, depth = 0): any {
  if (depth > 5) return {};
  const raw = parseJsonc(fs.readFileSync(themePath, 'utf-8'));
  if (raw && typeof raw.include === 'string') {
    const parentPath = path.resolve(path.dirname(themePath), raw.include);
    try {
      const parent = readThemeJson(parentPath, depth + 1);
      return {
        ...parent,
        ...raw,
        colors: { ...(parent.colors || {}), ...(raw.colors || {}) },
        tokenColors: [
          ...(Array.isArray(parent.tokenColors) ? parent.tokenColors : []),
          ...(Array.isArray(raw.tokenColors) ? raw.tokenColors : []),
        ],
      };
    } catch {
      return raw;
    }
  }
  return raw;
}

// ── ID helpers ──────────────────────────────────────────────────────────

/** Monaco theme names must match /^[a-z0-9\-]+$/i. */
function toMonacoThemeId(extId: string, label: string): string {
  const slug = `${extId}-${label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'ext-theme';
}

// ── Install / list / uninstall ──────────────────────────────────────────

function entryToPayload(entry: RegistryEntry): InstalledExtensionPayload {
  const themes: ExtensionThemePayload[] = [];
  for (const t of entry.themes) {
    try {
      themes.push({
        id: toMonacoThemeId(entry.id, t.label),
        label: t.label,
        uiTheme: t.uiTheme,
        data: readThemeJson(path.join(entry.dir, t.path)),
      });
    } catch (err) {
      console.warn(`[forge:ext] skipping theme "${t.label}":`, (err as Error).message);
    }
  }

  const snippets: ExtensionSnippetsPayload[] = [];
  for (const s of entry.snippets) {
    try {
      const parsed = parseJsonc(fs.readFileSync(path.join(entry.dir, s.path), 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        snippets.push({ language: s.language, snippets: parsed });
      }
    } catch (err) {
      console.warn(`[forge:ext] skipping snippets for "${s.language}":`, (err as Error).message);
    }
  }

  return {
    id: entry.id,
    displayName: entry.displayName,
    publisher: entry.publisher,
    version: entry.version,
    description: entry.description,
    themes,
    snippets,
  };
}

export function listExtensions(): {
  extensions: InstalledExtensionPayload[];
  activeTheme: string | null;
} {
  const registry = loadRegistry();
  const cfg = loadConfig();
  return {
    extensions: Object.values(registry).map(entryToPayload),
    activeTheme: typeof cfg.activeTheme === 'string' ? cfg.activeTheme : null,
  };
}

export function setActiveTheme(themeId: string | null): void {
  const cfg = loadConfig();
  if (themeId) cfg.activeTheme = themeId;
  else delete cfg.activeTheme;
  saveConfig(cfg);
}

export async function installVsix(
  window: BrowserWindow | null,
): Promise<InstalledExtensionPayload | null> {
  if (!window) return null;
  const result = await dialog.showOpenDialog(window, {
    title: 'Install extension from VSIX',
    properties: ['openFile'],
    filters: [{ name: 'VSCode Extension', extensions: ['vsix', 'zip'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return installVsixFromPath(result.filePaths[0]);
}

export function installVsixFromPath(vsixPath: string): InstalledExtensionPayload {
  const zipEntries = readZipEntries(vsixPath);

  const manifestEntry = zipEntries.find((e) => e.name === 'extension/package.json');
  if (!manifestEntry) {
    throw new Error('El archivo no parece un VSIX válido (falta extension/package.json).');
  }
  const manifest = parseJsonc(manifestEntry.getData().toString('utf-8'));
  const name: string = manifest.name || 'unknown';
  const publisher: string = manifest.publisher || 'unknown';
  const id = `${publisher}.${name}`.toLowerCase();

  const destDir = path.join(getExtensionsRoot(), id);

  // Fresh install: clear any previous version of the same extension.
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  // Extract only the `extension/` subtree, guarding against zip-slip.
  for (const entry of zipEntries) {
    if (entry.isDirectory) continue;
    if (!entry.name.startsWith('extension/')) continue;
    const rel = entry.name.slice('extension/'.length);
    const target = path.resolve(destDir, rel);
    if (target !== destDir && !target.startsWith(destDir + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }

  const contributes = manifest.contributes || {};

  const themes: RegistryEntry['themes'] = [];
  if (Array.isArray(contributes.themes)) {
    for (const t of contributes.themes) {
      if (!t || typeof t.path !== 'string') continue;
      themes.push({
        label: typeof t.label === 'string' ? t.label : name,
        uiTheme: typeof t.uiTheme === 'string' ? t.uiTheme : 'vs-dark',
        path: t.path.replace(/^\.\//, ''),
      });
    }
  }

  const snippets: RegistryEntry['snippets'] = [];
  if (Array.isArray(contributes.snippets)) {
    for (const s of contributes.snippets) {
      if (!s || typeof s.path !== 'string' || typeof s.language !== 'string') continue;
      snippets.push({ language: s.language, path: s.path.replace(/^\.\//, '') });
    }
  }

  if (themes.length === 0 && snippets.length === 0) {
    // Nothing Forge can use — clean up and tell the user why.
    fs.rmSync(destDir, { recursive: true, force: true });
    throw new Error(
      'Esta extensión no aporta temas ni snippets. Forge todavía no ejecuta código de extensiones ' +
        '(la mayoría de extensiones de lenguaje son wrappers de un language server — esa integración va por LSP).',
    );
  }

  const entry: RegistryEntry = {
    id,
    displayName: typeof manifest.displayName === 'string' ? manifest.displayName : name,
    publisher,
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    description: typeof manifest.description === 'string' ? manifest.description : '',
    dir: destDir,
    themes,
    snippets,
  };

  const registry = loadRegistry();
  registry[id] = entry;
  saveRegistry(registry);

  return entryToPayload(entry);
}

// ── Open VSX (`ext install publisher.name`) ─────────────────────────────
// Open VSX (open-vsx.org) is the vendor-neutral extension registry used by
// VSCode forks — the Microsoft marketplace is licensed for MS products only.

export async function installFromOpenVsx(extensionId: string): Promise<InstalledExtensionPayload> {
  const match = extensionId.trim().match(/^([A-Za-z0-9][\w.-]*)\.([A-Za-z0-9][\w-]*)$/);
  if (!match) {
    throw new Error(
      `Identificador inválido: "${extensionId}". Usa el formato publisher.nombre ` +
        '(ej. dracula-theme.theme-dracula).',
    );
  }
  const [, namespace, name] = match;

  const metaRes = await net.fetch(
    `https://open-vsx.org/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/latest`,
  );
  if (metaRes.status === 404) {
    throw new Error(`No se encontró "${namespace}.${name}" en Open VSX (open-vsx.org).`);
  }
  if (!metaRes.ok) {
    throw new Error(`Open VSX respondió ${metaRes.status} al buscar "${namespace}.${name}".`);
  }
  const meta: any = await metaRes.json();
  const downloadUrl: string | undefined = meta?.files?.download;
  if (!downloadUrl) {
    throw new Error(`"${namespace}.${name}" no tiene un paquete descargable en Open VSX.`);
  }

  const dlRes = await net.fetch(downloadUrl);
  if (!dlRes.ok) {
    throw new Error(`La descarga del VSIX falló (HTTP ${dlRes.status}).`);
  }
  const buf = Buffer.from(await dlRes.arrayBuffer());

  const tmpPath = path.join(app.getPath('temp'), `forge-vsix-${Date.now()}.vsix`);
  fs.writeFileSync(tmpPath, buf);
  try {
    return installVsixFromPath(tmpPath);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeMarketplaceExtension(raw: any): MarketplaceExtensionPayload | null {
  const namespace = typeof raw?.namespace === 'string' ? raw.namespace : '';
  const name = typeof raw?.name === 'string' ? raw.name : '';
  if (!namespace || !name) return null;

  return {
    id: `${namespace}.${name}`.toLowerCase(),
    namespace,
    name,
    displayName:
      typeof raw.displayName === 'string' && raw.displayName.trim()
        ? raw.displayName
        : name,
    description: typeof raw.description === 'string' ? raw.description : '',
    version: typeof raw.version === 'string' ? raw.version : '',
    iconUrl: typeof raw?.files?.icon === 'string' ? raw.files.icon : null,
    downloadCount: asNumber(raw.downloadCount),
    averageRating:
      typeof raw.averageRating === 'number' && Number.isFinite(raw.averageRating)
        ? raw.averageRating
        : null,
    reviewCount: asNumber(raw.reviewCount),
    verified: Boolean(raw.verified),
    deprecated: Boolean(raw.deprecated),
    lastUpdated: typeof raw.timestamp === 'string' ? raw.timestamp : null,
  };
}

export async function searchOpenVsx(
  query: string,
  size = 20,
): Promise<MarketplaceSearchPayload> {
  const cleanQuery = query.trim();
  const safeSize = Math.max(1, Math.min(50, Math.round(size)));
  const url = new URL('https://open-vsx.org/api/-/search');
  if (cleanQuery) url.searchParams.set('query', cleanQuery);
  url.searchParams.set('size', String(safeSize));
  url.searchParams.set('sortBy', 'relevance');
  url.searchParams.set('sortOrder', 'desc');

  const res = await net.fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open VSX respondió ${res.status} al buscar extensiones.`);
  }

  const data: any = await res.json();
  const extensions = Array.isArray(data?.extensions)
    ? data.extensions
        .map(normalizeMarketplaceExtension)
        .filter((ext: MarketplaceExtensionPayload | null): ext is MarketplaceExtensionPayload =>
          Boolean(ext),
        )
    : [];

  return {
    total: asNumber(data?.totalSize, extensions.length),
    extensions,
  };
}

export function uninstallExtension(id: string): boolean {
  const registry = loadRegistry();
  const entry = registry[id];
  if (!entry) return false;
  try {
    // Only delete directories we created under our own extensions root.
    const root = getExtensionsRoot();
    const resolved = path.resolve(entry.dir);
    if (resolved.startsWith(root + path.sep)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('[forge:ext] failed to remove extension dir:', (err as Error).message);
  }
  delete registry[id];
  saveRegistry(registry);
  return true;
}

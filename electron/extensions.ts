// ── VSIX extension manager (main process) ──────────────────────────────
//
// Forge installs complete VSIX packages and currently activates the safe,
// declarative subset that doesn't require running extension code.
//
//   contributes.themes    -> color themes (converted to Monaco in renderer)
//   contributes.snippets  -> completion snippets per language
//
// Everything else is preserved as manifest metadata so the UI can expose
// what is installed and what needs a future extension host / VSCode API shim.
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

export interface ExtensionIconThemePayload {
  id: string;
  label: string;
  /** definitionId -> data URL (SVG inline or base64 PNG). */
  definitions: Record<string, string>;
  file: string | null;
  folder: string | null;
  folderExpanded: string | null;
  rootFolder: string | null;
  rootFolderExpanded: string | null;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
  languageIds: Record<string, string>;
}

export interface ExtensionLanguageConfigPayload {
  comments?: {
    lineComment?: string;
    blockComment?: [string, string];
  };
  brackets?: [string, string][];
  autoClosingPairs?: ({ open: string; close: string; notIn?: string[] } | [string, string])[];
  surroundingPairs?: ({ open: string; close: string } | [string, string])[];
  folding?: {
    markers?: { start?: string; end?: string };
  };
  wordPattern?: string;
  indentationRules?: {
    increaseIndentPattern?: string;
    decreaseIndentPattern?: string;
  };
}

export interface ExtensionLanguagePayload {
  id: string;
  aliases: string[];
  extensions: string[];
  filenames: string[];
  firstLine: string | null;
  configuration: ExtensionLanguageConfigPayload | null;
}

export interface InstalledExtensionPayload {
  id: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  categories: string[];
  activationEvents: string[];
  extensionKind: string[];
  main: string | null;
  browser: string | null;
  contributes: string[];
  supported: {
    declarative: string[];
    requiresExtensionHost: boolean;
  };
  themes: ExtensionThemePayload[];
  snippets: ExtensionSnippetsPayload[];
  iconThemes: ExtensionIconThemePayload[];
  languages: ExtensionLanguagePayload[];
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

export interface MarketplaceExtensionDetailPayload extends MarketplaceExtensionPayload {
  readme: string | null;
  categories: string[];
  tags: string[];
  license: string | null;
  homepage: string | null;
  repository: string | null;
  bugs: string | null;
  engines: Record<string, string>;
  preRelease: boolean;
  publishedBy: string | null;
}

interface RegistryEntry {
  id: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  categories: string[];
  activationEvents: string[];
  extensionKind: string[];
  main: string | null;
  browser: string | null;
  contributes: string[];
  /** Directory (under userData/extensions) the vsix was extracted into. */
  dir: string;
  themes: { label: string; uiTheme: string; path: string }[];
  snippets: { language: string; path: string }[];
  iconThemes: { id: string; label: string; path: string }[];
  languages: {
    id: string;
    aliases: string[];
    extensions: string[];
    filenames: string[];
    firstLine: string | null;
    /** Relative path to language-configuration.json within the extension dir. */
    configPath: string | null;
  }[];
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

/** Max icon file size (32 KB) — anything larger is skipped. */
const ICON_MAX_BYTES = 32 * 1024;

/** Read an icon file and return a data URL, or null if unreadable / too large. */
function iconToDataUrl(iconAbsPath: string): string | null {
  try {
    const stat = fs.statSync(iconAbsPath);
    if (stat.size > ICON_MAX_BYTES) return null;
    const buf = fs.readFileSync(iconAbsPath);
    const ext = path.extname(iconAbsPath).toLowerCase();
    if (ext === '.svg') {
      return `data:image/svg+xml;utf8,${encodeURIComponent(buf.toString('utf-8'))}`;
    }
    const mime = ext === '.png' ? 'image/png'
      : ext === '.gif' ? 'image/gif'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.webp' ? 'image/webp'
      : 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function readIconThemePayload(entry: RegistryEntry, it: { id: string; label: string; path: string }): ExtensionIconThemePayload | null {
  try {
    const themeJsonPath = path.join(entry.dir, it.path);
    const raw = parseJsonc(fs.readFileSync(themeJsonPath, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;

    const themeDir = path.dirname(themeJsonPath);
    const definitions: Record<string, string> = {};
    const rawDefs = raw.iconDefinitions;
    if (rawDefs && typeof rawDefs === 'object') {
      for (const [defId, def] of Object.entries(rawDefs)) {
        const iconPath = (def as any)?.iconPath;
        if (typeof iconPath !== 'string') continue;
        const absIcon = path.resolve(themeDir, iconPath);
        const dataUrl = iconToDataUrl(absIcon);
        if (dataUrl) definitions[defId] = dataUrl;
      }
    }

    const asStringRecord = (val: unknown): Record<string, string> => {
      if (!val || typeof val !== 'object') return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    };

    return {
      id: it.id,
      label: it.label,
      definitions,
      file: typeof raw.file === 'string' ? raw.file : null,
      folder: typeof raw.folder === 'string' ? raw.folder : null,
      folderExpanded: typeof raw.folderExpanded === 'string' ? raw.folderExpanded : null,
      rootFolder: typeof raw.rootFolder === 'string' ? raw.rootFolder : null,
      rootFolderExpanded: typeof raw.rootFolderExpanded === 'string' ? raw.rootFolderExpanded : null,
      fileExtensions: asStringRecord(raw.fileExtensions),
      fileNames: asStringRecord(raw.fileNames),
      folderNames: asStringRecord(raw.folderNames),
      folderNamesExpanded: asStringRecord(raw.folderNamesExpanded),
      languageIds: asStringRecord(raw.languageIds),
    };
  } catch (err) {
    console.warn(`[forge:ext] skipping icon theme "${it.label}":`, (err as Error).message);
    return null;
  }
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

  const entryIconThemes = entry.iconThemes || [];
  const iconThemes: ExtensionIconThemePayload[] = [];
  for (const it of entryIconThemes) {
    const payload = readIconThemePayload(entry, it);
    if (payload) iconThemes.push(payload);
  }

  const entryLanguages = entry.languages || [];
  const languages: ExtensionLanguagePayload[] = [];
  for (const lang of entryLanguages) {
    let configuration: ExtensionLanguageConfigPayload | null = null;
    if (lang.configPath) {
      try {
        const raw = parseJsonc(fs.readFileSync(path.join(entry.dir, lang.configPath), 'utf-8'));
        if (raw && typeof raw === 'object') {
          configuration = {};
          if (raw.comments && typeof raw.comments === 'object') {
            configuration.comments = {};
            if (typeof raw.comments.lineComment === 'string') {
              configuration.comments.lineComment = raw.comments.lineComment;
            }
            if (Array.isArray(raw.comments.blockComment) && raw.comments.blockComment.length === 2) {
              configuration.comments.blockComment = [String(raw.comments.blockComment[0]), String(raw.comments.blockComment[1])];
            }
          }
          if (Array.isArray(raw.brackets)) configuration.brackets = raw.brackets;
          if (Array.isArray(raw.autoClosingPairs)) configuration.autoClosingPairs = raw.autoClosingPairs;
          if (Array.isArray(raw.surroundingPairs)) configuration.surroundingPairs = raw.surroundingPairs;
          if (raw.folding && typeof raw.folding === 'object') {
            configuration.folding = {};
            if (raw.folding.markers && typeof raw.folding.markers === 'object') {
              configuration.folding.markers = {
                ...(typeof raw.folding.markers.start === 'string' ? { start: raw.folding.markers.start } : {}),
                ...(typeof raw.folding.markers.end === 'string' ? { end: raw.folding.markers.end } : {}),
              };
            }
          }
          if (typeof raw.wordPattern === 'string') configuration.wordPattern = raw.wordPattern;
          if (raw.indentationRules && typeof raw.indentationRules === 'object') {
            configuration.indentationRules = {
              ...(typeof raw.indentationRules.increaseIndentPattern === 'string'
                ? { increaseIndentPattern: raw.indentationRules.increaseIndentPattern } : {}),
              ...(typeof raw.indentationRules.decreaseIndentPattern === 'string'
                ? { decreaseIndentPattern: raw.indentationRules.decreaseIndentPattern } : {}),
            };
          }
        }
      } catch (err) {
        console.warn(`[forge:ext] skipping language config for "${lang.id}":`, (err as Error).message);
      }
    }
    languages.push({
      id: lang.id,
      aliases: lang.aliases,
      extensions: lang.extensions,
      filenames: lang.filenames,
      firstLine: lang.firstLine,
      configuration,
    });
  }

  return {
    id: entry.id,
    displayName: entry.displayName,
    publisher: entry.publisher,
    version: entry.version,
    description: entry.description,
    categories: entry.categories || [],
    activationEvents: entry.activationEvents || [],
    extensionKind: entry.extensionKind || [],
    main: entry.main || null,
    browser: entry.browser || null,
    contributes: entry.contributes || [],
    supported: {
      declarative: [
        ...(entry.themes.length > 0 ? ['themes'] : []),
        ...(entry.snippets.length > 0 ? ['snippets'] : []),
        ...(entryLanguages.length > 0 ? ['languages'] : []),
      ],
      requiresExtensionHost: Boolean(entry.main || entry.browser || (entry.activationEvents || []).length > 0),
    },
    themes,
    iconThemes,
    snippets,
    languages,
  };
}

export function listExtensions(): {
  extensions: InstalledExtensionPayload[];
  activeTheme: string | null;
  activeIconTheme: string | null;
} {
  const registry = loadRegistry();
  const cfg = loadConfig();
  return {
    extensions: Object.values(registry).map(entryToPayload),
    activeTheme: typeof cfg.activeTheme === 'string' ? cfg.activeTheme : null,
    activeIconTheme: typeof cfg.activeIconTheme === 'string' ? cfg.activeIconTheme : null,
  };
}

export function setActiveTheme(themeId: string | null): void {
  const cfg = loadConfig();
  if (themeId) cfg.activeTheme = themeId;
  else delete cfg.activeTheme;
  saveConfig(cfg);
}

export function setActiveIconTheme(iconThemeId: string | null): void {
  const cfg = loadConfig();
  if (iconThemeId) cfg.activeIconTheme = iconThemeId;
  else delete cfg.activeIconTheme;
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
      snippets.push({ language: s.language, path: s.path.replace(/^\.\//,  '') });
    }
  }

  const languages: RegistryEntry['languages'] = [];
  if (Array.isArray(contributes.languages)) {
    for (const lang of contributes.languages) {
      if (!lang || typeof lang.id !== 'string') continue;
      const aliases = Array.isArray(lang.aliases)
        ? lang.aliases.filter((a: unknown): a is string => typeof a === 'string')
        : [];
      const exts = Array.isArray(lang.extensions)
        ? lang.extensions.filter((e: unknown): e is string => typeof e === 'string')
        : [];
      const filenames = Array.isArray(lang.filenames)
        ? lang.filenames.filter((f: unknown): f is string => typeof f === 'string')
        : [];
      const firstLine = typeof lang.firstLine === 'string' ? lang.firstLine : null;
      const configPath = typeof lang.configuration === 'string'
        ? lang.configuration.replace(/^\.\//,  '')
        : null;
      languages.push({ id: lang.id, aliases, extensions: exts, filenames, firstLine, configPath });
    }
  }

  const iconThemes: RegistryEntry['iconThemes'] = [];
  if (Array.isArray(contributes.iconThemes)) {
    for (const t of contributes.iconThemes) {
      if (!t || typeof t.path !== 'string') continue;
      iconThemes.push({
        id: typeof t.id === 'string' ? t.id : name,
        label: typeof t.label === 'string' ? t.label : name,
        path: t.path.replace(/^\.\//, ''),
      });
    }
  }

  const contributesKeys = contributes && typeof contributes === 'object'
    ? Object.keys(contributes).sort()
    : [];
  const categories = Array.isArray(manifest.categories)
    ? manifest.categories.filter((c: unknown): c is string => typeof c === 'string')
    : [];
  const activationEvents = Array.isArray(manifest.activationEvents)
    ? manifest.activationEvents.filter((e: unknown): e is string => typeof e === 'string')
    : [];
  const extensionKind = Array.isArray(manifest.extensionKind)
    ? manifest.extensionKind.filter((k: unknown): k is string => typeof k === 'string')
    : typeof manifest.extensionKind === 'string'
      ? [manifest.extensionKind]
      : [];

  const entry: RegistryEntry = {
    id,
    displayName: typeof manifest.displayName === 'string' ? manifest.displayName : name,
    publisher,
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    description: typeof manifest.description === 'string' ? manifest.description : '',
    categories,
    activationEvents,
    extensionKind,
    main: typeof manifest.main === 'string' ? manifest.main : null,
    browser: typeof manifest.browser === 'string' ? manifest.browser : null,
    contributes: contributesKeys,
    dir: destDir,
    themes,
    snippets,
    iconThemes,
    languages,
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

// Full metadata + README for the extension-detail page shown in the editor
// area. README download is capped so a pathological package can't balloon
// the renderer payload.
const README_MAX_BYTES = 512 * 1024;

export async function getOpenVsxDetail(
  extensionId: string,
): Promise<MarketplaceExtensionDetailPayload> {
  const match = extensionId.trim().match(/^([A-Za-z0-9][\w.-]*)\.([A-Za-z0-9][\w-]*)$/);
  if (!match) {
    throw new Error(`Identificador inválido: "${extensionId}". Usa el formato publisher.nombre.`);
  }
  const [, namespace, name] = match;

  const res = await net.fetch(
    `https://open-vsx.org/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/latest`,
  );
  if (res.status === 404) {
    throw new Error(`No se encontró "${namespace}.${name}" en Open VSX (open-vsx.org).`);
  }
  if (!res.ok) {
    throw new Error(`Open VSX respondió ${res.status} al obtener "${namespace}.${name}".`);
  }
  const meta: any = await res.json();

  let readme: string | null = null;
  const readmeUrl = asOptionalString(meta?.files?.readme);
  if (readmeUrl) {
    try {
      const readmeRes = await net.fetch(readmeUrl);
      if (readmeRes.ok) {
        readme = (await readmeRes.text()).slice(0, README_MAX_BYTES);
      }
    } catch {
      /* README is optional — the page still renders without it */
    }
  }

  const engines: Record<string, string> = {};
  if (meta?.engines && typeof meta.engines === 'object') {
    for (const [key, value] of Object.entries(meta.engines)) {
      if (typeof value === 'string') engines[key] = value;
    }
  }

  return {
    id: `${namespace}.${name}`.toLowerCase(),
    namespace,
    name,
    displayName: asOptionalString(meta?.displayName) ?? name,
    description: typeof meta?.description === 'string' ? meta.description : '',
    version: typeof meta?.version === 'string' ? meta.version : '',
    iconUrl: asOptionalString(meta?.files?.icon),
    downloadCount: asNumber(meta?.downloadCount),
    averageRating:
      typeof meta?.averageRating === 'number' && Number.isFinite(meta.averageRating)
        ? meta.averageRating
        : null,
    reviewCount: asNumber(meta?.reviewCount),
    verified: Boolean(meta?.verified),
    deprecated: Boolean(meta?.deprecated),
    lastUpdated: asOptionalString(meta?.timestamp),
    readme,
    categories: asStringArray(meta?.categories),
    tags: asStringArray(meta?.tags).filter((t) => !t.startsWith('__')),
    license: asOptionalString(meta?.license),
    homepage: asOptionalString(meta?.homepage),
    repository: asOptionalString(meta?.repository),
    bugs: asOptionalString(meta?.bugs),
    engines,
    preRelease: Boolean(meta?.preRelease),
    publishedBy: asOptionalString(meta?.publishedBy?.loginName),
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

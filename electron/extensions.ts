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
import type { ExtensionRegistry } from './extensions/application/ports/extension-registry';
import type { ManifestReader } from './extensions/application/ports/manifest-reader';
import type {
  GrammarContributionReader,
  IconThemeContributionReader,
  LanguageContributionReader,
  SnippetContributionReader,
  ThemeContributionReader,
} from './extensions/application/ports/contribution-readers';
import type { ExtensionCompatibilityAnalyzer } from './extensions/application/ports/extension-compatibility-analyzer';
import {
  DeclarativeCompatibilityAnalyzer,
  toLegacySupported,
} from './extensions/application/declarative-compatibility-analyzer';
import {
  EXTENSION_IPC_PROTOCOL_VERSION,
  type ExtensionListPayload,
  type InstalledExtensionPayload,
  type MarketplaceExtensionDetailPayload,
  type MarketplaceExtensionPayload,
  type MarketplaceSearchPayload,
} from './extensions/domain/extension-dto';
import type { InstalledExtensionRecord } from './extensions/domain/extension-manifest';
import {
  CheckExtensionUpdates,
  type ExtensionUpdateInfo,
} from './extensions/application/check-extension-updates';
import {
  ConfigurationService,
  type ConfigurationInspection,
  type WritableConfigurationScope,
} from './extensions/application/configuration-service';
import { ForgeWorkspaceSettingsStore } from './extensions/infrastructure/forge-workspace-settings-store';
import { InstallExtensionById } from './extensions/application/install-extension-by-id';
import { InstallExtensionFromVsix } from './extensions/application/install-extension-from-vsix';
import { RollbackExtension } from './extensions/application/rollback-extension';
import { OpenVsxCatalog } from './extensions/infrastructure/open-vsx-catalog';
import { VsixPackageStore } from './extensions/infrastructure/vsix-package-store';
import { FileGrammarContributionReader } from './extensions/infrastructure/grammar-contribution-reader';
import { FileIconThemeContributionReader } from './extensions/infrastructure/icon-theme-contribution-reader';
import { JsonExtensionRegistry } from './extensions/infrastructure/json-extension-registry';
import { FileLanguageContributionReader } from './extensions/infrastructure/language-contribution-reader';
import { FileSnippetContributionReader } from './extensions/infrastructure/snippet-contribution-reader';
import { FileThemeContributionReader } from './extensions/infrastructure/theme-contribution-reader';
import { VscodeManifestReader } from './extensions/infrastructure/vscode-manifest-reader';

const manifestReader: ManifestReader = new VscodeManifestReader();
const themeReader: ThemeContributionReader = new FileThemeContributionReader();
const snippetReader: SnippetContributionReader = new FileSnippetContributionReader();
const languageReader: LanguageContributionReader = new FileLanguageContributionReader();
const iconThemeReader: IconThemeContributionReader = new FileIconThemeContributionReader();
const grammarReader: GrammarContributionReader = new FileGrammarContributionReader();
const compatibilityAnalyzer: ExtensionCompatibilityAnalyzer = new DeclarativeCompatibilityAnalyzer();

// ── Config helpers (same forge-config.json as the rest of main.ts) ─────

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'forge-config.json');
}

function loadConfig(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, unknown>): void {
  try {
    // Atomic replace: a crash mid-write must never leave a truncated
    // forge-config.json behind (it holds the extension registry).
    const configPath = getConfigPath();
    const tmpPath = `${configPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, configPath);
  } catch (err) {
    console.warn('[forge:ext] failed to write config:', (err as Error).message);
  }
}

const extensionRegistry: ExtensionRegistry = new JsonExtensionRegistry({
  readConfig: loadConfig,
  writeConfig: saveConfig,
});

function getExtensionsRoot(): string {
  return path.join(app.getPath('userData'), 'extensions');
}

// ── Install / list / uninstall ──────────────────────────────────────────

function entryToPayload(entry: InstalledExtensionRecord): InstalledExtensionPayload {
  const themes = themeReader.read(entry);
  const snippets = snippetReader.read(entry);
  const languages = languageReader.read(entry);
  const iconThemes = iconThemeReader.read(entry);
  const grammars = grammarReader.read(entry);
  const compatibility = compatibilityAnalyzer.analyze(entry, {
    themes: themes.length,
    snippets: snippets.length,
    languages: languages.length,
    iconThemes: iconThemes.length,
    // Settings are declared inline in the manifest, so what normalization
    // kept is exactly what the ConfigurationService serves.
    configuration: entry.configuration.length,
    configurationDefaults: Object.keys(entry.configurationDefaults).length,
    commands: entry.commands.length,
    keybindings: entry.keybindings.length,
    grammars: grammars.length,
    menus: entry.menus.length,
  });

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
    supported: toLegacySupported(compatibility),
    compatibility,
    enabled: entry.enabled,
    previousVersion: entry.previousVersion?.version ?? null,
    themes,
    iconThemes,
    snippets,
    languages,
    configuration: entry.configuration.map((setting) => ({
      key: setting.key,
      type: setting.type,
      default: setting.default,
      description: setting.description,
      enum: setting.enum,
    })),
    commands: entry.commands,
    keybindings: entry.keybindings,
    grammars,
    menus: entry.menus,
  };
}

export function listExtensions(): ExtensionListPayload {
  const cfg = loadConfig();
  return {
    protocolVersion: EXTENSION_IPC_PROTOCOL_VERSION,
    extensions: extensionRegistry.list().map(entryToPayload),
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

const packageStore = new VsixPackageStore({
  rootDir: getExtensionsRoot,
  manifestReader,
});

const installFromVsix = new InstallExtensionFromVsix({
  packageStore,
  registry: extensionRegistry,
});

const catalog = new OpenVsxCatalog({
  tempDir: () => app.getPath('temp'),
  fetchImpl: net.fetch,
});

const installById = new InstallExtensionById({
  catalog,
  installer: installFromVsix,
  registry: extensionRegistry,
  deleteTempFile: (filePath) => fs.rmSync(filePath, { force: true }),
});

const updateChecker = new CheckExtensionUpdates({
  catalog,
  registry: extensionRegistry,
});

// Main owns which workspace is open; the facade only needs a provider that
// yields the local workspace dir (or null for none/remote).
let workspaceDirProvider: () => string | null = () => null;

/** Wires the active-workspace provider; called once from main. */
export function configureExtensionWorkspace(provider: () => string | null): void {
  workspaceDirProvider = provider;
}

// User-scope setting values live under their own forge-config.json key so
// they survive uninstall/reinstall of the extension that declares them.
const configurationService = new ConfigurationService({
  records: () => extensionRegistry.list(),
  workspaceStore: () => {
    const dir = workspaceDirProvider();
    return dir ? new ForgeWorkspaceSettingsStore({ workspaceDir: dir }) : null;
  },
  userStore: {
    read: () => {
      const raw = loadConfig().extensionSettings;
      return raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};
    },
    write: (values) => {
      const cfg = loadConfig();
      cfg.extensionSettings = values;
      saveConfig(cfg);
    },
  },
});

const rollback = new RollbackExtension({
  packageStore,
  registry: extensionRegistry,
  manifestReader,
  readManifestSource: (dir) => fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'),
});

export function installVsixFromPath(vsixPath: string): InstalledExtensionPayload {
  return entryToPayload(installFromVsix.install(vsixPath));
}

/** Re-points an installed extension at its retained previous version. */
export function rollbackExtension(id: string): InstalledExtensionPayload {
  return entryToPayload(rollback.rollback(id));
}

/** Installed extensions with a newer version published in the catalog. */
export function checkExtensionUpdates(): Promise<ExtensionUpdateInfo[]> {
  return updateChecker.check();
}

/** Every setting contributed by installed extensions, fully resolved. */
export function listConfiguration(): ConfigurationInspection[] {
  return configurationService.inspectAll();
}

/** Writes (`undefined` clears) a setting value in the given scope. */
export function setConfigurationValue(
  key: string,
  value: unknown,
  scope: WritableConfigurationScope = 'user',
): void {
  configurationService.setValue(key, value, scope);
}

/** Notifies after every configuration write. Returns the unsubscribe. */
export function onExtensionConfigurationChanged(
  listener: (key: string) => void,
): () => void {
  return configurationService.onDidChange(listener);
}

/**
 * Startup inventory: removes abandoned staging and orphan directories a
 * post-commit failure could have left in the store.
 */
export function sweepExtensionStore(): void {
  try {
    for (const removed of packageStore.sweep(extensionRegistry.list())) {
      console.warn('[forge:ext] swept orphan store entry:', removed);
    }
  } catch (err) {
    console.warn('[forge:ext] store sweep failed:', (err as Error).message);
  }
}

// ── Open VSX (`ext install publisher.name`) ─────────────────────────────
// Open VSX (open-vsx.org) is the vendor-neutral extension registry used by
// VSCode forks — the Microsoft marketplace is licensed for MS products only.

export async function installFromOpenVsx(extensionId: string): Promise<InstalledExtensionPayload> {
  return entryToPayload(await installById.install(extensionId));
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

/** Toggles an installed extension without uninstalling it. */
export function setExtensionEnabled(id: string, enabled: boolean): boolean {
  const entry = extensionRegistry.get(id);
  if (!entry || entry.enabled === enabled) return Boolean(entry);
  extensionRegistry.upsert({ ...entry, enabled });
  return true;
}

export function uninstallExtension(id: string): boolean {
  const entry = extensionRegistry.get(id);
  if (!entry) return false;
  try {
    // Only delete directories we created under our own extensions root.
    // Installs are versioned (`<root>/<id>/<version>`), so remove the whole
    // per-extension directory; legacy flat installs (`<root>/<id>`) resolve
    // to the same top-level segment.
    const root = getExtensionsRoot();
    const resolved = path.resolve(entry.dir);
    if (resolved.startsWith(root + path.sep)) {
      const topLevel = path.relative(root, resolved).split(path.sep)[0];
      fs.rmSync(path.join(root, topLevel), { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('[forge:ext] failed to remove extension dir:', (err as Error).message);
  }
  extensionRegistry.remove(id);
  return true;
}

import type { ExtensionRegistry } from '../application/ports/extension-registry';
import type {
  ExtensionCommandManifest,
  ExtensionGrammarManifest,
  ExtensionIconThemeManifest,
  ExtensionKeybindingManifest,
  ExtensionLanguageManifest,
  ExtensionMenuItemManifest,
  ExtensionSettingManifest,
  ExtensionSettingType,
  ExtensionSnippetManifest,
  ExtensionThemeManifest,
  InstalledExtensionRecord,
} from '../domain/extension-manifest';

export type ExtensionConfig = Record<string, unknown>;
type UnknownRecord = Record<string, unknown>;

export interface JsonExtensionRegistryOptions {
  readConfig: () => ExtensionConfig;
  writeConfig: (config: ExtensionConfig) => void;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is UnknownRecord => item !== null)
    : [];
}

function themes(value: unknown, fallback: string): ExtensionThemeManifest[] {
  return records(value).flatMap((item) => typeof item.path === 'string' ? [{
    label: typeof item.label === 'string' ? item.label : fallback,
    uiTheme: typeof item.uiTheme === 'string' ? item.uiTheme : 'vs-dark',
    path: item.path,
  }] : []);
}

function snippets(value: unknown): ExtensionSnippetManifest[] {
  return records(value).flatMap((item) => (
    typeof item.path === 'string' && typeof item.language === 'string'
      ? [{ language: item.language, path: item.path }]
      : []
  ));
}

function iconThemes(value: unknown, fallback: string): ExtensionIconThemeManifest[] {
  return records(value).flatMap((item) => typeof item.path === 'string' ? [{
    id: typeof item.id === 'string' ? item.id : fallback,
    label: typeof item.label === 'string' ? item.label : fallback,
    path: item.path,
  }] : []);
}

function languages(value: unknown): ExtensionLanguageManifest[] {
  return records(value).flatMap((item) => typeof item.id === 'string' ? [{
    id: item.id,
    aliases: strings(item.aliases),
    extensions: strings(item.extensions),
    filenames: strings(item.filenames),
    firstLine: typeof item.firstLine === 'string' ? item.firstLine : null,
    configPath: typeof item.configPath === 'string' ? item.configPath : null,
  }] : []);
}

const SETTING_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

function settings(value: unknown): ExtensionSettingManifest[] {
  return records(value).flatMap((item) => typeof item.key === 'string' && item.key ? [{
    key: item.key,
    type: SETTING_TYPES.includes(item.type as string)
      ? item.type as ExtensionSettingType
      : null,
    ...(item.default !== undefined ? { default: item.default } : {}),
    description: typeof item.description === 'string' ? item.description : '',
    enum: Array.isArray(item.enum) && item.enum.length > 0 ? item.enum : null,
  }] : []);
}

function commands(value: unknown): ExtensionCommandManifest[] {
  return records(value).flatMap((item) => (
    typeof item.command === 'string' && item.command ? [{
      command: item.command,
      title: typeof item.title === 'string' && item.title ? item.title : item.command,
      category: typeof item.category === 'string' ? item.category : null,
      enablement: typeof item.enablement === 'string' ? item.enablement : null,
    }] : []
  ));
}

function keybindings(value: unknown): ExtensionKeybindingManifest[] {
  return records(value).flatMap((item) => (
    typeof item.command === 'string' && item.command
      && typeof item.key === 'string' && item.key ? [{
      command: item.command,
      key: item.key,
      mac: typeof item.mac === 'string' ? item.mac : null,
      linux: typeof item.linux === 'string' ? item.linux : null,
      win: typeof item.win === 'string' ? item.win : null,
      when: typeof item.when === 'string' ? item.when : null,
    }] : []
  ));
}

function grammars(value: unknown): ExtensionGrammarManifest[] {
  return records(value).flatMap((item) => (
    typeof item.scopeName === 'string' && item.scopeName
      && typeof item.path === 'string' && item.path ? [{
      language: typeof item.language === 'string' && item.language ? item.language : null,
      scopeName: item.scopeName,
      path: item.path,
      embeddedLanguages: Object.fromEntries(
        Object.entries(asRecord(item.embeddedLanguages) ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
      injectTo: strings(item.injectTo),
    }] : []
  ));
}

function menus(value: unknown): ExtensionMenuItemManifest[] {
  return records(value).flatMap((item) => (
    typeof item.menu === 'string' && item.menu
      && typeof item.command === 'string' && item.command ? [{
      menu: item.menu,
      command: item.command,
      when: typeof item.when === 'string' ? item.when : null,
      group: typeof item.group === 'string' ? item.group : null,
    }] : []
  ));
}

function decodePreviousVersion(
  value: unknown,
): Pick<InstalledExtensionRecord, 'previousVersion'> {
  const raw = asRecord(value);
  if (!raw || typeof raw.version !== 'string' || !raw.version) return {};
  return {
    previousVersion: {
      version: raw.version,
      ...(typeof raw.sha256 === 'string' && raw.sha256 ? { sha256: raw.sha256 } : {}),
    },
  };
}

/** Decodes current and pre-Milestone-0 registry entries at the persistence edge. */
export function decodeInstalledExtensionRecord(
  registryKey: string,
  value: unknown,
): InstalledExtensionRecord | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.dir !== 'string' || !raw.dir) return null;

  const id = (typeof raw.id === 'string' && raw.id ? raw.id : registryKey).toLowerCase();
  const separator = id.indexOf('.');
  const inferredPublisher = separator > 0 ? id.slice(0, separator) : 'unknown';
  const inferredName = separator > 0 ? id.slice(separator + 1) : id;
  const publisher = typeof raw.publisher === 'string' && raw.publisher
    ? raw.publisher
    : inferredPublisher;
  const name = typeof raw.name === 'string' && raw.name ? raw.name : inferredName;

  return {
    id,
    name,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : name,
    publisher,
    version: typeof raw.version === 'string' ? raw.version : '0.0.0',
    description: typeof raw.description === 'string' ? raw.description : '',
    categories: strings(raw.categories),
    activationEvents: strings(raw.activationEvents),
    extensionKind: typeof raw.extensionKind === 'string'
      ? [raw.extensionKind]
      : strings(raw.extensionKind),
    main: typeof raw.main === 'string' ? raw.main : null,
    browser: typeof raw.browser === 'string' ? raw.browser : null,
    enginesVscode: typeof raw.enginesVscode === 'string' ? raw.enginesVscode : null,
    extensionDependencies: strings(raw.extensionDependencies),
    extensionPack: strings(raw.extensionPack),
    contributes: strings(raw.contributes).sort(),
    themes: themes(raw.themes, name),
    snippets: snippets(raw.snippets),
    iconThemes: iconThemes(raw.iconThemes, name),
    languages: languages(raw.languages),
    configuration: settings(raw.configuration),
    configurationDefaults: asRecord(raw.configurationDefaults) ?? {},
    commands: commands(raw.commands),
    keybindings: keybindings(raw.keybindings),
    grammars: grammars(raw.grammars),
    menus: menus(raw.menus),
    dir: raw.dir,
    ...(typeof raw.sha256 === 'string' && raw.sha256 ? { sha256: raw.sha256 } : {}),
    // Only an explicit `false` disables; legacy records predate the flag.
    enabled: raw.enabled !== false,
    ...(decodePreviousVersion(raw.previousVersion)),
  };
}

/** JSON-backed adapter that preserves unrelated Forge configuration keys. */
export class JsonExtensionRegistry implements ExtensionRegistry {
  constructor(private readonly options: JsonExtensionRegistryOptions) {}

  list(): InstalledExtensionRecord[] {
    const registry = asRecord(this.options.readConfig().extensions) ?? {};
    return Object.entries(registry).flatMap(([key, value]) => {
      const decoded = decodeInstalledExtensionRecord(key, value);
      return decoded ? [decoded] : [];
    });
  }

  get(id: string): InstalledExtensionRecord | null {
    const normalizedId = id.toLowerCase();
    return this.list().find((extension) => extension.id === normalizedId) ?? null;
  }

  upsert(extension: InstalledExtensionRecord): void {
    const config = this.options.readConfig();
    const registry = asRecord(config.extensions) ?? {};
    const normalizedId = extension.id.toLowerCase();
    const nextRegistry = { ...registry };
    const legacyKey = Object.keys(nextRegistry).find((key) => key.toLowerCase() === normalizedId);
    if (legacyKey) delete nextRegistry[legacyKey];
    nextRegistry[normalizedId] = extension;
    config.extensions = nextRegistry;
    this.options.writeConfig(config);
  }

  remove(id: string): InstalledExtensionRecord | null {
    const normalizedId = id.toLowerCase();
    const config = this.options.readConfig();
    const registry = asRecord(config.extensions) ?? {};
    const registryKey = Object.keys(registry).find((key) => key.toLowerCase() === normalizedId);
    if (!registryKey) return null;
    const existing = decodeInstalledExtensionRecord(registryKey, registry[registryKey]);
    if (!existing) return null;

    const nextRegistry = { ...registry };
    delete nextRegistry[registryKey];
    config.extensions = nextRegistry;
    this.options.writeConfig(config);
    return existing;
  }
}

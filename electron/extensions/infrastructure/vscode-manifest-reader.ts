import type { ManifestReader } from '../application/ports/manifest-reader';
import type {
  ExtensionCapabilitiesManifest,
  ExtensionCapabilitySupport,
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
  ManifestReadResult,
  ManifestValidationIssue,
  NormalizedExtensionManifest,
} from '../domain/extension-manifest';
import {
  defaultExtensionCapabilities,
  EXTENSION_IDENTIFIER_PATTERN,
} from '../domain/extension-manifest';
import { JsoncRootTypeError, parseJsonc } from './jsonc';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function contributionArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is UnknownRecord => (
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ))
    : [];
}

function relativeContributionPath(value: string): string {
  return value.replace(/^\.\//, '');
}

const EXTENSION_ID_PATTERN = /^[a-z0-9][\w.-]*\.[a-z0-9][\w-]*$/i;

function extensionIdList(value: unknown): string[] {
  return [...new Set(
    stringArray(value)
      .map((id) => id.trim().toLowerCase())
      .filter((id) => EXTENSION_ID_PATTERN.test(id)),
  )];
}

function normalizeThemes(contributes: UnknownRecord, fallbackLabel: string): ExtensionThemeManifest[] {
  return contributionArray(contributes.themes).flatMap((theme) => {
    if (typeof theme.path !== 'string') return [];
    return [{
      label: typeof theme.label === 'string' ? theme.label : fallbackLabel,
      uiTheme: typeof theme.uiTheme === 'string' ? theme.uiTheme : 'vs-dark',
      path: relativeContributionPath(theme.path),
    }];
  });
}

function normalizeSnippets(contributes: UnknownRecord): ExtensionSnippetManifest[] {
  return contributionArray(contributes.snippets).flatMap((snippet) => {
    if (typeof snippet.path !== 'string' || typeof snippet.language !== 'string') return [];
    return [{
      language: snippet.language,
      path: relativeContributionPath(snippet.path),
    }];
  });
}

function normalizeLanguages(contributes: UnknownRecord): ExtensionLanguageManifest[] {
  return contributionArray(contributes.languages).flatMap((language) => {
    if (typeof language.id !== 'string') return [];
    return [{
      id: language.id,
      aliases: stringArray(language.aliases),
      extensions: stringArray(language.extensions),
      filenames: stringArray(language.filenames),
      firstLine: typeof language.firstLine === 'string' ? language.firstLine : null,
      configPath: typeof language.configuration === 'string'
        ? relativeContributionPath(language.configuration)
        : null,
    }];
  });
}

function normalizeIconThemes(
  contributes: UnknownRecord,
  fallbackLabel: string,
): ExtensionIconThemeManifest[] {
  return contributionArray(contributes.iconThemes).flatMap((theme) => {
    if (typeof theme.path !== 'string') return [];
    return [{
      id: typeof theme.id === 'string' ? theme.id : fallbackLabel,
      label: typeof theme.label === 'string' ? theme.label : fallbackLabel,
      path: relativeContributionPath(theme.path),
    }];
  });
}

const SETTING_TYPES: ExtensionSettingType[] = [
  'string', 'number', 'integer', 'boolean', 'array', 'object',
];

function settingType(value: unknown): ExtensionSettingType | null {
  // JSON Schema allows `type` to be a list; VS Code settings use the first.
  const raw = Array.isArray(value) ? value[0] : value;
  return (SETTING_TYPES as unknown[]).includes(raw) ? raw as ExtensionSettingType : null;
}

function normalizeSettings(properties: unknown): ExtensionSettingManifest[] {
  return Object.entries(asRecord(properties)).flatMap(([key, value]) => {
    const schema = asRecord(value);
    if (!key.trim()) return [];
    const description = typeof schema.description === 'string'
      ? schema.description
      : typeof schema.markdownDescription === 'string' ? schema.markdownDescription : '';
    return [{
      key,
      type: settingType(schema.type),
      ...(schema.default !== undefined ? { default: schema.default } : {}),
      description,
      enum: Array.isArray(schema.enum) && schema.enum.length > 0 ? schema.enum : null,
    }];
  });
}

// `contributes.configuration` is one section or an array of sections; the
// settings live under each section's `properties`.
function normalizeConfiguration(contributes: UnknownRecord): ExtensionSettingManifest[] {
  const sections = Array.isArray(contributes.configuration)
    ? contributes.configuration
    : contributes.configuration !== undefined ? [contributes.configuration] : [];
  const seen = new Set<string>();
  return sections
    .flatMap((section) => normalizeSettings(asRecord(section).properties))
    .filter((setting) => {
      if (seen.has(setting.key)) return false;
      seen.add(setting.key);
      return true;
    });
}

// Command titles are strings, but nls-aware manifests may use `{ value }`.
function commandText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  const record = asRecord(value);
  return typeof record.value === 'string' && record.value.trim() ? record.value : null;
}

function normalizeCommands(contributes: UnknownRecord): ExtensionCommandManifest[] {
  const seen = new Set<string>();
  return contributionArray(contributes.commands).flatMap((entry) => {
    if (typeof entry.command !== 'string' || !entry.command.trim()) return [];
    const command = entry.command.trim();
    if (seen.has(command)) return []; // first declaration wins
    seen.add(command);
    return [{
      command,
      title: commandText(entry.title) ?? command,
      category: commandText(entry.category),
      enablement: typeof entry.enablement === 'string' && entry.enablement.trim()
        ? entry.enablement
        : null,
    }];
  });
}

// `contributes.keybindings` is one binding or an array. Entries whose
// command starts with `-` remove a default VS Code binding — Forge has no
// such defaults, so they are skipped rather than misread as commands.
function normalizeKeybindings(contributes: UnknownRecord): ExtensionKeybindingManifest[] {
  const entries = Array.isArray(contributes.keybindings)
    ? contributionArray(contributes.keybindings)
    : contributes.keybindings !== undefined ? [asRecord(contributes.keybindings)] : [];
  const chord = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  return entries.flatMap((entry) => {
    const command = typeof entry.command === 'string' ? entry.command.trim() : '';
    const key = chord(entry.key);
    if (!command || command.startsWith('-') || !key) return [];
    return [{
      command,
      key,
      mac: chord(entry.mac),
      linux: chord(entry.linux),
      win: chord(entry.win),
      when: typeof entry.when === 'string' && entry.when.trim() ? entry.when : null,
    }];
  });
}

// `contributes.menus` is a record: menu id → item list. Entries without a
// `command` (pure submenu references) are skipped until submenus land.
function normalizeMenus(contributes: UnknownRecord): ExtensionMenuItemManifest[] {
  return Object.entries(asRecord(contributes.menus)).flatMap(([menu, items]) => {
    if (!menu.trim()) return [];
    return contributionArray(items).flatMap((item) => {
      if (typeof item.command !== 'string' || !item.command.trim()) return [];
      return [{
        menu: menu.trim(),
        command: item.command.trim(),
        when: typeof item.when === 'string' && item.when.trim() ? item.when : null,
        group: typeof item.group === 'string' && item.group.trim() ? item.group.trim() : null,
      }];
    });
  });
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function normalizeGrammars(contributes: UnknownRecord): ExtensionGrammarManifest[] {
  return contributionArray(contributes.grammars).flatMap((grammar) => {
    if (typeof grammar.scopeName !== 'string' || !grammar.scopeName.trim()) return [];
    if (typeof grammar.path !== 'string' || !grammar.path.trim()) return [];
    return [{
      language: typeof grammar.language === 'string' && grammar.language
        ? grammar.language
        : null,
      scopeName: grammar.scopeName.trim(),
      path: relativeContributionPath(grammar.path),
      embeddedLanguages: stringRecord(grammar.embeddedLanguages),
      injectTo: stringArray(grammar.injectTo),
    }];
  });
}

// `capabilities.*.supported` is `true`, `false` or `"limited"`; the whole
// capability may also be a bare boolean. Anything else is unknown to Forge
// and falls back to the caller-provided default rather than to "supported",
// so a typo can never widen what an extension is allowed to do.
function capabilitySupport(
  value: unknown,
  fallback: ExtensionCapabilitySupport,
): ExtensionCapabilitySupport {
  if (value === true) return 'supported';
  if (value === false) return 'unsupported';
  if (typeof value === 'string' && value.trim().toLowerCase() === 'limited') return 'limited';
  return fallback;
}

function capabilityDescription(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeCapabilities(manifest: UnknownRecord): ExtensionCapabilitiesManifest {
  const defaults = defaultExtensionCapabilities();
  const capabilities = asRecord(manifest.capabilities);

  const untrustedRaw = capabilities.untrustedWorkspaces;
  const untrusted = asRecord(untrustedRaw);
  const virtualRaw = capabilities.virtualWorkspaces;
  const virtual = asRecord(virtualRaw);

  return {
    untrustedWorkspaces: {
      supported: typeof untrustedRaw === 'boolean' || typeof untrustedRaw === 'string'
        ? capabilitySupport(untrustedRaw, defaults.untrustedWorkspaces.supported)
        : capabilitySupport(untrusted.supported, defaults.untrustedWorkspaces.supported),
      description: capabilityDescription(untrusted.description),
      restrictedConfigurations: [...new Set(stringArray(untrusted.restrictedConfigurations))],
    },
    virtualWorkspaces: {
      supported: typeof virtualRaw === 'boolean' || typeof virtualRaw === 'string'
        ? capabilitySupport(virtualRaw, defaults.virtualWorkspaces.supported)
        : capabilitySupport(virtual.supported, defaults.virtualWorkspaces.supported),
      description: capabilityDescription(virtual.description),
    },
  };
}

// Fields the validating mode inspects today. Recoverable defects keep the
// legacy defaults; the transactional installer will reject them later.
function collectManifestIssues(manifest: UnknownRecord): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];

  const requireString = (field: 'name' | 'publisher' | 'version') => {
    const value = manifest[field];
    if (value === undefined || value === null || value === '') {
      issues.push({ code: 'missing-field', field });
    } else if (typeof value !== 'string') {
      issues.push({ code: 'invalid-field-type', field, expected: 'string' });
    }
  };
  requireString('name');
  requireString('publisher');
  requireString('version');

  // `<publisher>.<name>` is the directory the package is installed into, so
  // a value carrying separators or dot segments is rejected here instead of
  // being sanitized: a manifest whose identity does not match its own id is
  // never a mistake worth recovering from.
  for (const field of ['name', 'publisher'] as const) {
    const value = manifest[field];
    if (typeof value === 'string' && value !== '' && !EXTENSION_IDENTIFIER_PATTERN.test(value)) {
      issues.push({ code: 'invalid-field-format', field, value });
    }
  }

  const capabilities = normalizeCapabilities(manifest);
  const untrusted = capabilities.untrustedWorkspaces;
  if (untrusted.supported === 'supported' && untrusted.restrictedConfigurations.length > 0) {
    issues.push({
      code: 'contradictory-capabilities',
      capability: 'untrustedWorkspaces',
      detail:
        'declara soporte completo en workspaces no confiables y a la vez '
        + `restringe ${untrusted.restrictedConfigurations.length} setting(s)`,
    });
  }

  const engines = asRecord(manifest.engines);
  if (typeof engines.vscode !== 'string' || !engines.vscode) {
    issues.push({ code: 'missing-field', field: 'engines.vscode' });
  }

  if (manifest.contributes !== undefined && (
    manifest.contributes === null
      || typeof manifest.contributes !== 'object'
      || Array.isArray(manifest.contributes)
  )) {
    issues.push({ code: 'invalid-field-type', field: 'contributes', expected: 'object' });
  }

  return issues;
}

/** VS Code manifest adapter. It contains parsing rules, not installation I/O. */
export class VscodeManifestReader implements ManifestReader {
  read(source: string): NormalizedExtensionManifest {
    return this.normalize(asRecord(parseJsonc(source)));
  }

  readWithDiagnostics(source: string): ManifestReadResult {
    let manifest: UnknownRecord;
    try {
      manifest = parseJsonc(source);
    } catch (err) {
      if (err instanceof JsoncRootTypeError) {
        return { ok: false, issues: [{ code: 'not-an-object' }] };
      }
      return { ok: false, issues: [{ code: 'invalid-json', message: (err as Error).message }] };
    }
    return {
      ok: true,
      manifest: this.normalize(manifest),
      issues: collectManifestIssues(manifest),
    };
  }

  private normalize(manifest: UnknownRecord): NormalizedExtensionManifest {
    const name = typeof manifest.name === 'string' && manifest.name ? manifest.name : 'unknown';
    const publisher = typeof manifest.publisher === 'string' && manifest.publisher
      ? manifest.publisher
      : 'unknown';
    const contributes = asRecord(manifest.contributes);

    return {
      id: `${publisher}.${name}`.toLowerCase(),
      name,
      displayName: typeof manifest.displayName === 'string' ? manifest.displayName : name,
      publisher,
      version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
      description: typeof manifest.description === 'string' ? manifest.description : '',
      categories: stringArray(manifest.categories),
      activationEvents: stringArray(manifest.activationEvents),
      extensionKind: typeof manifest.extensionKind === 'string'
        ? [manifest.extensionKind]
        : stringArray(manifest.extensionKind),
      main: typeof manifest.main === 'string' ? manifest.main : null,
      browser: typeof manifest.browser === 'string' ? manifest.browser : null,
      enginesVscode: (() => {
        const engines = asRecord(manifest.engines);
        return typeof engines.vscode === 'string' && engines.vscode ? engines.vscode : null;
      })(),
      extensionDependencies: extensionIdList(manifest.extensionDependencies),
      extensionPack: extensionIdList(manifest.extensionPack),
      contributes: Object.keys(contributes).sort(),
      themes: normalizeThemes(contributes, name),
      snippets: normalizeSnippets(contributes),
      iconThemes: normalizeIconThemes(contributes, name),
      languages: normalizeLanguages(contributes),
      configuration: normalizeConfiguration(contributes),
      configurationDefaults: asRecord(contributes.configurationDefaults),
      commands: normalizeCommands(contributes),
      keybindings: normalizeKeybindings(contributes),
      grammars: normalizeGrammars(contributes),
      menus: normalizeMenus(contributes),
      capabilities: normalizeCapabilities(manifest),
    };
  }
}

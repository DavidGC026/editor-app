/** Declarative contribution metadata normalized from a VS Code manifest. */
export interface ExtensionThemeManifest {
  label: string;
  uiTheme: string;
  path: string;
}

export interface ExtensionSnippetManifest {
  language: string;
  path: string;
}

export interface ExtensionIconThemeManifest {
  id: string;
  label: string;
  path: string;
}

export interface ExtensionLanguageManifest {
  id: string;
  aliases: string[];
  extensions: string[];
  filenames: string[];
  firstLine: string | null;
  configPath: string | null;
}

/** JSON-schema types Forge understands for a contributed setting. */
export type ExtensionSettingType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object';

/** One setting declared under `contributes.configuration`. */
export interface ExtensionSettingManifest {
  key: string;
  /** Null when the schema omits the type or uses one Forge does not know. */
  type: ExtensionSettingType | null;
  /** Declared default; `undefined` when the schema does not provide one. */
  default?: unknown;
  description: string;
  /** Allowed values when the schema restricts them; null otherwise. */
  enum: unknown[] | null;
}

/** One command declared under `contributes.commands`. Declarative metadata
 *  only: whether the command has a handler is decided at runtime. */
export interface ExtensionCommandManifest {
  command: string;
  title: string;
  category: string | null;
  /** `when`-clause gating availability in UI surfaces; null = always. */
  enablement: string | null;
}

/** One keybinding declared under `contributes.keybindings`. `key` is the
 *  default chord; platform fields override it when present. */
export interface ExtensionKeybindingManifest {
  command: string;
  key: string;
  mac: string | null;
  linux: string | null;
  win: string | null;
  /** `when`-clause gating dispatch; null = always active. */
  when: string | null;
}

/** One menu item declared under `contributes.menus`, flattened with the
 *  menu id it belongs to (`explorer/context`, `editor/context`, …). */
export interface ExtensionMenuItemManifest {
  menu: string;
  command: string;
  /** `when`-clause gating visibility; null = always visible. */
  when: string | null;
  /** VS Code group sort key (`navigation`, `2_workspace@1`, …). */
  group: string | null;
}

/** One TextMate grammar declared under `contributes.grammars`. */
export interface ExtensionGrammarManifest {
  /** VS Code language id the grammar tokenizes; null for injection-only
   *  or embedded grammars referenced by scope. */
  language: string | null;
  scopeName: string;
  path: string;
  /** Embedded scope → language id map (`embeddedLanguages`). */
  embeddedLanguages: Record<string, string>;
  /** Scopes this grammar injects into (`injectTo`). */
  injectTo: string[];
}

// ── Capabilities ────────────────────────────────────────────────────────
// `capabilities.*` declares where an extension is willing to run. Forge
// reads it as a security input, so the shape is normalized to three states
// instead of the union of booleans and strings VS Code accepts.

/** Declared support level of one capability (`capabilities.*.supported`). */
export type ExtensionCapabilitySupport = 'supported' | 'limited' | 'unsupported';

/** `capabilities.untrustedWorkspaces`: what the extension does in a
 *  workspace the user has not trusted. */
export interface ExtensionUntrustedWorkspacesCapability {
  supported: ExtensionCapabilitySupport;
  description: string | null;
  /** Settings the extension itself ignores while the workspace is
   *  untrusted; only meaningful with `limited` support. */
  restrictedConfigurations: string[];
}

/** `capabilities.virtualWorkspaces`: whether it works without a filesystem. */
export interface ExtensionVirtualWorkspacesCapability {
  supported: ExtensionCapabilitySupport;
  description: string | null;
}

export interface ExtensionCapabilitiesManifest {
  untrustedWorkspaces: ExtensionUntrustedWorkspacesCapability;
  virtualWorkspaces: ExtensionVirtualWorkspacesCapability;
}

/** Defaults when the manifest declares nothing: untrusted workspaces fail
 *  closed (as in VS Code), virtual workspaces are assumed to work. */
export function defaultExtensionCapabilities(): ExtensionCapabilitiesManifest {
  return {
    untrustedWorkspaces: {
      supported: 'unsupported',
      description: null,
      restrictedConfigurations: [],
    },
    virtualWorkspaces: { supported: 'supported', description: null },
  };
}

/**
 * Identifier segments become path segments in the extension store, so they
 * are constrained to a conservative charset: no separators, no leading dot,
 * nothing that could climb out of the store root.
 */
export const EXTENSION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Stable domain representation consumed by installation and persistence.
 * Infrastructure-specific locations such as the extracted directory do not
 * belong here and are added by the package store.
 */
export interface NormalizedExtensionManifest {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  categories: string[];
  activationEvents: string[];
  extensionKind: string[];
  main: string | null;
  browser: string | null;
  /** Raw `engines.vscode` range, kept verbatim for compatibility policy. */
  enginesVscode: string | null;
  /** Required extensions (`publisher.name`, lowercase). Install fails if one
   *  cannot be resolved. */
  extensionDependencies: string[];
  /** Bundled extensions installed best-effort alongside this one. */
  extensionPack: string[];
  contributes: string[];
  themes: ExtensionThemeManifest[];
  snippets: ExtensionSnippetManifest[];
  iconThemes: ExtensionIconThemeManifest[];
  languages: ExtensionLanguageManifest[];
  /** Settings declared under `contributes.configuration`, sections flattened. */
  configuration: ExtensionSettingManifest[];
  /** Default overrides for settings owned by *other* extensions
   *  (`contributes.configurationDefaults`). */
  configurationDefaults: Record<string, unknown>;
  /** Commands declared under `contributes.commands`. */
  commands: ExtensionCommandManifest[];
  /** Keybindings declared under `contributes.keybindings`. */
  keybindings: ExtensionKeybindingManifest[];
  /** TextMate grammars declared under `contributes.grammars`. */
  grammars: ExtensionGrammarManifest[];
  /** Menu items declared under `contributes.menus`, flattened. */
  menus: ExtensionMenuItemManifest[];
  /** Where the extension declares it is willing to run (`capabilities`). */
  capabilities: ExtensionCapabilitiesManifest;
}

/** Persisted installation record. Package-store metadata stays out of manifests. */
export interface InstalledExtensionRecord extends NormalizedExtensionManifest {
  dir: string;
  /** sha256 (hex) of the VSIX the version was installed from, when known. */
  sha256?: string;
  /** Disabled extensions stay installed but contribute nothing. */
  enabled: boolean;
  /** Retained previous install, kept on disk to support explicit rollback. */
  previousVersion?: { version: string; sha256?: string };
}

// ── Manifest validation ─────────────────────────────────────────────────
// Discriminated issues emitted while the legacy `unknown.unknown` defaults
// are still tolerated. The transactional package manager (Milestone 1) will
// turn recoverable issues into hard rejections.

export type ManifestValidationIssue =
  | { code: 'invalid-json'; message: string }
  | { code: 'not-an-object' }
  | { code: 'missing-field'; field: 'name' | 'publisher' | 'version' | 'engines.vscode' }
  | { code: 'invalid-field-type'; field: string; expected: string }
  /** Identifier segment that cannot be used as a path segment safely. */
  | { code: 'invalid-field-format'; field: 'name' | 'publisher'; value: string }
  /** `capabilities` declaring two things at once (e.g. full support in
   *  untrusted workspaces *and* settings restricted there). */
  | { code: 'contradictory-capabilities'; capability: 'untrustedWorkspaces'; detail: string };

export type ManifestReadResult =
  /** Usable manifest; `issues` lists recoverable defects covered by legacy defaults. */
  | { ok: true; manifest: NormalizedExtensionManifest; issues: ManifestValidationIssue[] }
  /** Unreadable document — no manifest can be produced. */
  | { ok: false; issues: ManifestValidationIssue[] };

export function describeManifestIssue(issue: ManifestValidationIssue): string {
  switch (issue.code) {
    case 'invalid-json':
      return `JSON inválido: ${issue.message}`;
    case 'not-an-object':
      return 'el manifiesto no es un objeto JSON';
    case 'missing-field':
      return `falta el campo obligatorio "${issue.field}"`;
    case 'invalid-field-type':
      return `el campo "${issue.field}" debe ser ${issue.expected}`;
    case 'invalid-field-format':
      return `el campo "${issue.field}" tiene un valor no admitido: "${issue.value}"`;
    case 'contradictory-capabilities':
      return `"capabilities.${issue.capability}" se contradice: ${issue.detail}`;
  }
}

/** Version negotiated by the current main/preload extension IPC surface. */
export const EXTENSION_IPC_PROTOCOL_VERSION = 1 as const;

export interface ExtensionThemePayload {
  id: string;
  label: string;
  uiTheme: string;
  data: Record<string, unknown>;
}

export interface ExtensionSnippetsPayload {
  language: string;
  snippets: Record<
    string,
    { prefix?: string | string[]; body?: string | string[]; description?: string }
  >;
}

export interface ExtensionIconThemePayload {
  id: string;
  label: string;
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
  folding?: { markers?: { start?: string; end?: string } };
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

/** One setting contributed via `contributes.configuration`, with the value
 *  the ConfigurationService currently resolves for it. */
export interface ExtensionSettingPayload {
  key: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | null;
  default: unknown;
  description: string;
  enum: unknown[] | null;
}

/** One command contributed via `contributes.commands`. */
export interface ExtensionCommandPayload {
  command: string;
  title: string;
  category: string | null;
  /** `when`-clause the renderer evaluates before surfacing the command. */
  enablement: string | null;
}

/** One keybinding contributed via `contributes.keybindings`. */
export interface ExtensionKeybindingPayload {
  command: string;
  key: string;
  mac: string | null;
  linux: string | null;
  win: string | null;
  when: string | null;
}

/** One TextMate grammar with its raw source, ready for vscode-textmate in
 *  the renderer (`parseRawGrammar` handles both JSON and plist sources —
 *  `path` keeps the filename hint it needs to pick the parser). */
export interface ExtensionGrammarPayload {
  language: string | null;
  scopeName: string;
  path: string;
  /** Raw grammar file contents (JSON or plist XML). */
  content: string;
  embeddedLanguages: Record<string, string>;
  injectTo: string[];
}

/** One menu item contributed via `contributes.menus`, flattened. */
export interface ExtensionMenuItemPayload {
  menu: string;
  command: string;
  when: string | null;
  group: string | null;
}

/** Mirror of `capabilities.*` as normalized in the main process. */
export type ExtensionCapabilitySupportPayload = 'supported' | 'limited' | 'unsupported';

export interface ExtensionCapabilitiesPayload {
  untrustedWorkspaces: {
    supported: ExtensionCapabilitySupportPayload;
    description: string | null;
    restrictedConfigurations: string[];
  };
  virtualWorkspaces: {
    supported: ExtensionCapabilitySupportPayload;
    description: string | null;
  };
}

/** Trust of the open workspace, as the renderer sees it. */
export interface WorkspaceTrustStatusPayload {
  workspace: string | null;
  state: 'trusted' | 'restricted';
  decided: boolean;
  remote: boolean;
  canGrant: boolean;
}

// ── Compatibility report ────────────────────────────────────────────────
// Derived from what actually loaded, never from package-name heuristics.

export type ExtensionCompatibilityLevel = 'full' | 'partial' | 'none';

export type ExtensionCompatibilityBlocker =
  /** The extension ships executable code that needs the future Extension Host. */
  | { kind: 'requires-extension-host'; entryPoints: string[] }
  /** Contribution point with no declarative engine support yet. */
  | { kind: 'unsupported-contribution'; contribution: string }
  /** Declarative family whose payloads failed to load from disk. */
  | { kind: 'contribution-load-failed'; contribution: string; declared: number; loaded: number }
  /** Payload loaded correctly but the workbench does not consume it yet. */
  | { kind: 'integration-pending'; contribution: string };

export interface ExtensionCompatibilityReport {
  level: ExtensionCompatibilityLevel;
  /** Contribution points active right now. */
  supportedContributions: string[];
  /** Declared contribution points that are not active yet. */
  pendingContributions: string[];
  blockers: ExtensionCompatibilityBlocker[];
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
  /** Legacy contract kept while the UI finishes migrating to `compatibility`. */
  supported: {
    declarative: string[];
    requiresExtensionHost: boolean;
  };
  compatibility: ExtensionCompatibilityReport;
  /** Disabled extensions stay listed but the renderer applies none of their
   *  contributions. */
  enabled: boolean;
  /** Retained version an explicit rollback would return to, if any. */
  previousVersion: string | null;
  themes: ExtensionThemePayload[];
  snippets: ExtensionSnippetsPayload[];
  iconThemes: ExtensionIconThemePayload[];
  languages: ExtensionLanguagePayload[];
  /** Settings this extension declares (`contributes.configuration`). */
  configuration: ExtensionSettingPayload[];
  /** Commands this extension declares (`contributes.commands`). */
  commands: ExtensionCommandPayload[];
  /** Keybindings this extension declares (`contributes.keybindings`). */
  keybindings: ExtensionKeybindingPayload[];
  /** TextMate grammars this extension declares (`contributes.grammars`). */
  grammars: ExtensionGrammarPayload[];
  /** Menu items this extension declares (`contributes.menus`). */
  menus: ExtensionMenuItemPayload[];
  /** Declared `capabilities`, used by the Workspace Trust policy. */
  capabilities: ExtensionCapabilitiesPayload;
  /** What Restricted Mode allows for this extension right now. */
  trust: {
    activation: 'allowed' | 'limited' | 'blocked';
    /** Settings the extension ignores while the workspace is untrusted. */
    restrictedConfigurations: string[];
  };
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

/** A declared setting resolved through every configuration scope. */
export interface ExtensionConfigurationValuePayload {
  key: string;
  /** Extension that declares the setting. */
  ownerId: string;
  type: ExtensionSettingPayload['type'];
  description: string;
  enum: unknown[] | null;
  defaultValue: unknown;
  /** `configurationDefaults` override contributed by another extension. */
  overrideValue: unknown;
  userValue: unknown;
  /** Value from `.forge/settings.json`; undefined without a workspace. */
  workspaceValue: unknown;
  effectiveValue: unknown;
  effectiveSource: 'default' | 'extension-override' | 'user' | 'workspace';
}

/** An installed extension with a newer version published in the catalog. */
export interface ExtensionUpdatePayload {
  id: string;
  installedVersion: string;
  latestVersion: string;
}

export interface ExtensionListPayload {
  protocolVersion: typeof EXTENSION_IPC_PROTOCOL_VERSION;
  extensions: InstalledExtensionPayload[];
  activeTheme: string | null;
  activeIconTheme: string | null;
  /** Trust of the open workspace when the list was produced. */
  workspaceTrust: WorkspaceTrustStatusPayload;
}

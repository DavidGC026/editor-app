import type { ConfigurationScopeStore } from './ports/user-configuration-store';
import type {
  ExtensionSettingManifest,
  InstalledExtensionRecord,
} from '../domain/extension-manifest';

/** Where the effective value of a setting comes from. */
export type ConfigurationValueSource =
  | 'default'
  | 'extension-override'
  | 'user'
  | 'workspace';

/** Scopes a value can be written to. */
export type WritableConfigurationScope = 'user' | 'workspace';

/** A declared setting with every scope the service resolved for it. */
export interface ConfigurationInspection {
  key: string;
  /** Extension that declares the setting. */
  ownerId: string;
  type: ExtensionSettingManifest['type'];
  description: string;
  enum: unknown[] | null;
  defaultValue: unknown;
  /** `configurationDefaults` override contributed by another extension. */
  overrideValue: unknown;
  userValue: unknown;
  /** Value from `.forge/settings.json`; undefined without a workspace. */
  workspaceValue: unknown;
  effectiveValue: unknown;
  effectiveSource: ConfigurationValueSource;
}

export interface ConfigurationServiceOptions {
  /** Installed records; the service ignores disabled extensions itself. */
  records: () => InstalledExtensionRecord[];
  userStore: ConfigurationScopeStore;
  /** Workspace-scope store, or null while no local workspace is open
   *  (remote workspaces resolve their settings on the remote side). */
  workspaceStore?: () => ConfigurationScopeStore | null;
  /** Diagnostics sink; defaults to console.warn. */
  warn?: (message: string) => void;
}

/** Thrown when a user value contradicts the declared schema. */
export class ConfigurationValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationValueError';
  }
}

function matchesType(value: unknown, type: ExtensionSettingManifest['type']): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'array': return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    default: return true; // unknown/omitted type: accept anything
  }
}

/**
 * Resolves setting values with VS Code's scope precedence, bottom to top:
 * the declaring extension's default < `configurationDefaults` overrides
 * contributed by other enabled extensions < the user's explicit value <
 * the workspace's `.forge/settings.json`.
 */
export class ConfigurationService {
  private readonly warn: (message: string) => void;
  private readonly listeners = new Set<(key: string) => void>();

  constructor(private readonly options: ConfigurationServiceOptions) {
    this.warn = options.warn ?? ((message) => console.warn('[forge:config]', message));
  }

  /** Notifies after every successful write. Returns the unsubscribe. */
  onDidChange(listener: (key: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Every declared setting, resolved. Sorted by key for stable UIs. */
  inspectAll(): ConfigurationInspection[] {
    const enabled = this.options.records().filter((record) => record.enabled !== false);
    const userValues = this.options.userStore.read();
    const workspaceValues = this.options.workspaceStore?.()?.read() ?? {};

    // First declaration wins so a key cannot be silently re-owned.
    const owners = new Map<string, { ownerId: string; schema: ExtensionSettingManifest }>();
    for (const record of enabled) {
      for (const schema of record.configuration) {
        const existing = owners.get(schema.key);
        if (existing && existing.ownerId !== record.id) {
          this.warn(
            `"${record.id}" redeclara "${schema.key}", ya definido por "${existing.ownerId}"`,
          );
          continue;
        }
        if (!existing) owners.set(schema.key, { ownerId: record.id, schema });
      }
    }

    // Later extensions win among overrides, mirroring VS Code's load order.
    const overrides = new Map<string, unknown>();
    for (const record of enabled) {
      for (const [key, value] of Object.entries(record.configurationDefaults)) {
        overrides.set(key, value);
      }
    }

    return [...owners.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, { ownerId, schema }]) => {
        const overrideValue = overrides.has(key) ? overrides.get(key) : undefined;
        const userValue = key in userValues ? userValues[key] : undefined;
        const workspaceValue = key in workspaceValues ? workspaceValues[key] : undefined;
        const [effectiveValue, effectiveSource]: [unknown, ConfigurationValueSource] =
          workspaceValue !== undefined
            ? [workspaceValue, 'workspace']
            : userValue !== undefined
              ? [userValue, 'user']
              : overrideValue !== undefined
                ? [overrideValue, 'extension-override']
                : [schema.default, 'default'];
        return {
          key,
          ownerId,
          type: schema.type,
          description: schema.description,
          enum: schema.enum,
          defaultValue: schema.default,
          overrideValue,
          userValue,
          workspaceValue,
          effectiveValue,
          effectiveSource,
        };
      });
  }

  /** Effective value of one setting; `undefined` when nothing declares it. */
  get(key: string): unknown {
    return this.inspectAll().find((entry) => entry.key === key)?.effectiveValue;
  }

  /** Writes (or, with `undefined`, clears) a user-scope value. */
  setUserValue(key: string, value: unknown): void {
    this.setValue(key, value, 'user');
  }

  /**
   * Writes (or, with `undefined`, clears) a value in `scope`. Declared
   * settings validate against their schema; unknown keys are stored as-is,
   * like VS Code does for settings of not-yet-installed extensions.
   * Workspace writes require a local workspace to be open.
   */
  setValue(key: string, value: unknown, scope: WritableConfigurationScope): void {
    if (!key.trim()) throw new ConfigurationValueError('La clave del setting está vacía.');
    if (value !== undefined) {
      const declared = this.inspectAll().find((entry) => entry.key === key);
      if (declared && !matchesType(value, declared.type)) {
        throw new ConfigurationValueError(
          `"${key}" espera un valor de tipo ${declared.type}.`,
        );
      }
      if (declared?.enum && !declared.enum.some((allowed) => allowed === value)) {
        throw new ConfigurationValueError(
          `"${key}" sólo admite: ${declared.enum.map((v) => JSON.stringify(v)).join(', ')}.`,
        );
      }
    }

    const store = scope === 'workspace' ? this.options.workspaceStore?.() ?? null : this.options.userStore;
    if (!store) {
      throw new ConfigurationValueError(
        'No hay un workspace local abierto donde guardar el setting.',
      );
    }
    const values = { ...store.read() };
    if (value === undefined) delete values[key];
    else values[key] = value;
    store.write(values);

    for (const listener of [...this.listeners]) {
      // A faulty subscriber must not break the write for everyone else.
      try {
        listener(key);
      } catch (err) {
        this.warn(`config listener failed: ${(err as Error).message}`);
      }
    }
  }
}

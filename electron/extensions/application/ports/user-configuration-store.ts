/**
 * Persistence for one configuration scope's values. The service treats a
 * store as a flat `key → value` map; where and how it persists is an
 * infrastructure concern (user scope lives in forge-config.json, workspace
 * scope in `<workspace>/.forge/settings.json`).
 */
export interface ConfigurationScopeStore {
  read(): Record<string, unknown>;
  write(values: Record<string, unknown>): void;
}

/** Historical name of the user-scope store; same contract. */
export type UserConfigurationStore = ConfigurationScopeStore;

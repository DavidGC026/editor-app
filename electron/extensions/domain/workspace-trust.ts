import type { ExtensionCapabilitiesManifest } from './extension-manifest';

/**
 * Trust of the open workspace. Only two states are observable at runtime:
 * a workspace is trusted or it is not. Whether the user already decided is
 * reported separately (`decided`) so the UI can ask instead of pretending
 * the answer was "no".
 */
export type WorkspaceTrustState = 'trusted' | 'restricted';

/** A persisted user decision about one workspace. */
export interface WorkspaceTrustDecision {
  /** Local absolute path of the workspace the decision applies to. */
  workspace: string;
  trusted: boolean;
  /** ISO timestamp; also the pruning key when the list grows. */
  decidedAt: string;
}

export interface WorkspaceTrustStatus {
  /** Open workspace (local path or remote URI); null when none is open. */
  workspace: string | null;
  state: WorkspaceTrustState;
  /** False while the user has never decided for this workspace. */
  decided: boolean;
  /** Remote workspaces never inherit a local decision (see §3 of the
   *  security document): they start — and stay — restricted. */
  remote: boolean;
  /** True when the workspace could be trusted by an explicit user action. */
  canGrant: boolean;
}

/** Remote workspaces are addressed by URI; they never carry local trust. */
export function isRemoteWorkspaceUri(workspace: string): boolean {
  return workspace.startsWith('ssh://');
}

/** What Restricted Mode allows for one installed extension. */
export type ExtensionTrustActivation = 'allowed' | 'limited' | 'blocked';

export interface ExtensionTrustVerdict {
  id: string;
  activation: ExtensionTrustActivation;
  /** Settings the extension itself declares as ignored while untrusted. */
  restrictedConfigurations: string[];
}

/** Extension shape the policy needs; keeps records out of the domain rule. */
export interface TrustEvaluableExtension {
  id: string;
  capabilities: ExtensionCapabilitiesManifest;
}

/**
 * Activation policy: a trusted workspace activates everything, and a
 * restricted one only what declares `capabilities.untrustedWorkspaces`.
 * `limited` support activates too — that is what the declaration means in
 * VS Code — but carries the settings the extension refuses to honour, so
 * callers can surface the limitation instead of hiding it.
 */
export function resolveExtensionTrust(
  extension: TrustEvaluableExtension,
  state: WorkspaceTrustState,
): ExtensionTrustVerdict {
  const untrusted = extension.capabilities.untrustedWorkspaces;
  if (state === 'trusted') {
    return { id: extension.id, activation: 'allowed', restrictedConfigurations: [] };
  }
  switch (untrusted.supported) {
    case 'supported':
      return { id: extension.id, activation: 'allowed', restrictedConfigurations: [] };
    case 'limited':
      return {
        id: extension.id,
        activation: 'limited',
        restrictedConfigurations: [...untrusted.restrictedConfigurations],
      };
    default:
      // Undeclared support fails closed: nothing runs in a workspace the
      // user has not vouched for.
      return { id: extension.id, activation: 'blocked', restrictedConfigurations: [] };
  }
}

/** True when the extension may activate under `state`. */
export function isActivatableUnderTrust(
  extension: TrustEvaluableExtension,
  state: WorkspaceTrustState,
): boolean {
  return resolveExtensionTrust(extension, state).activation !== 'blocked';
}

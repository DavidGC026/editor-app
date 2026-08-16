import type { WorkspaceTrustDecision } from '../../domain/workspace-trust';

/**
 * Persistence of the user's trust decisions. Reads must tolerate a missing
 * or corrupt document — a workspace whose decision cannot be read is
 * treated as undecided, never as trusted.
 */
export interface WorkspaceTrustStore {
  read(): WorkspaceTrustDecision[];
  write(decisions: WorkspaceTrustDecision[]): void;
}

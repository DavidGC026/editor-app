/**
 * Activation events: parsing and matching.
 *
 * Pure domain vocabulary — no host, no filesystem — because deciding *who*
 * should wake up is a question about manifests, and the answer must be
 * testable without a process. Actually waking them is the activation
 * service's job.
 *
 * The set Forge understands is the one the design fixes for Milestone 3
 * (§5): `*`, `onStartupFinished`, `onCommand:`, `onLanguage:` and
 * `workspaceContains:`. Anything else is recognised as *unknown* rather
 * than silently ignored, so the compatibility report can say which
 * extensions ask for something Forge cannot trigger yet.
 */

export type ActivationEvent =
  /** VS Code's `*`: activate as early as possible. */
  | { kind: 'star' }
  | { kind: 'startupFinished' }
  | { kind: 'command'; command: string }
  | { kind: 'language'; language: string }
  | { kind: 'workspaceContains'; pattern: string }
  /** Declared by the extension but not dispatchable by Forge yet. */
  | { kind: 'unknown'; raw: string };

export function parseActivationEvent(raw: string): ActivationEvent {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { kind: 'unknown', raw: String(raw) };
  if (value === '*') return { kind: 'star' };
  if (value === 'onStartupFinished') return { kind: 'startupFinished' };

  const separator = value.indexOf(':');
  if (separator === -1) return { kind: 'unknown', raw: value };
  const prefix = value.slice(0, separator);
  const argument = value.slice(separator + 1).trim();
  if (!argument) return { kind: 'unknown', raw: value };

  switch (prefix) {
    case 'onCommand':
      return { kind: 'command', command: argument };
    case 'onLanguage':
      return { kind: 'language', language: argument };
    case 'workspaceContains':
      return { kind: 'workspaceContains', pattern: argument };
    default:
      return { kind: 'unknown', raw: value };
  }
}

/** A trigger the workbench reports. `workspaceContains` is not here: it is
 *  resolved against the filesystem when a workspace opens, not fired. */
export type ActivationTrigger =
  | { kind: 'startupFinished' }
  | { kind: 'command'; command: string }
  | { kind: 'language'; language: string };

/**
 * Whether a declared event is satisfied by a trigger. `*` matches startup
 * only: VS Code activates it eagerly, and folding it into every trigger
 * would make a `*` extension activate again on each language.
 */
export function matchesTrigger(event: ActivationEvent, trigger: ActivationTrigger): boolean {
  switch (event.kind) {
    case 'star':
    case 'startupFinished':
      return trigger.kind === 'startupFinished';
    case 'command':
      return trigger.kind === 'command' && event.command === trigger.command;
    case 'language':
      return trigger.kind === 'language' && event.language === trigger.language;
    default:
      return false;
  }
}

/**
 * Matches a `workspaceContains:` pattern against a workspace-relative path.
 *
 * The supported subset is glob-as-VS-Code-uses-it in practice: `*` (no
 * separator), `**` (any depth), `?`, and brace alternation `{a,b}`. It is
 * translated to a RegExp rather than pulled from a dependency because the
 * pattern comes from a manifest and must not be able to do anything but
 * match — no filesystem, no backtracking bomb via `**` chains.
 */
export function matchesWorkspacePattern(pattern: string, relativePath: string): boolean {
  const regex = globToRegExp(pattern);
  return regex.test(relativePath.split('\\').join('/'));
}

const GLOB_CACHE = new Map<string, RegExp>();

function globToRegExp(pattern: string): RegExp {
  const cached = GLOB_CACHE.get(pattern);
  if (cached) return cached;

  let out = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        // `**/` may match zero segments, which is what makes
        // `**/package.json` find the file at the root too.
        if (pattern[index + 2] === '/') {
          out += '(?:.*/)?';
          index += 3;
          continue;
        }
        out += '.*';
        index += 2;
        continue;
      }
      out += '[^/]*';
      index += 1;
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      index += 1;
      continue;
    }
    if (char === '{') {
      const close = pattern.indexOf('}', index);
      if (close !== -1) {
        const alternatives = pattern.slice(index + 1, close).split(',');
        out += `(?:${alternatives.map(escapeRegExp).join('|')})`;
        index = close + 1;
        continue;
      }
    }
    out += escapeRegExp(char);
    index += 1;
  }

  const regex = new RegExp(`^${out}$`);
  GLOB_CACHE.set(pattern, regex);
  return regex;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

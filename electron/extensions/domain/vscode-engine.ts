// ── engines.vscode policy ───────────────────────────────────────────────
//
// Forge does not embed a full semver implementation; it understands the
// range shapes that cover virtually every published extension: `*`,
// `^A.B.C`, `>=A.B.C` and bare `A.B.C`, with `x` wildcards. Anything else
// is reported as `unknown` so callers can decide (today: install with a
// warning) instead of mis-parsing a range into a false rejection.

/** VS Code API level Forge currently emulates for declarative extensions. */
export const FORGE_VSCODE_API_VERSION = '1.85.0';

export type EngineCompatibility = 'compatible' | 'incompatible' | 'unknown';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(raw: string): ParsedVersion | null {
  const match = raw.trim().match(/^(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i);
  if (!match) return null;
  const part = (value: string | undefined): number => {
    if (value === undefined || value === 'x' || value === 'X' || value === '*') return 0;
    return Number(value);
  };
  return { major: part(match[1]), minor: part(match[2]), patch: part(match[3]) };
}

function compare(a: ParsedVersion, b: ParsedVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function checkVscodeEngine(
  range: string | null | undefined,
  apiVersion: string = FORGE_VSCODE_API_VERSION,
): EngineCompatibility {
  if (!range) return 'unknown';
  const cleaned = range.trim();
  if (cleaned === '*' || cleaned.toLowerCase() === 'x') return 'compatible';

  const api = parseVersion(apiVersion);
  if (!api) return 'unknown';

  const match = cleaned.match(/^(\^|>=)?\s*(.+)$/);
  if (!match) return 'unknown';
  const [, operator, versionPart] = match;
  const minimum = parseVersion(versionPart);
  if (!minimum) return 'unknown';

  if (compare(api, minimum) < 0) return 'incompatible';
  // `^` pins the major once past 0.x; a future-major extension on `^1.x`
  // stays compatible while the emulated API is still major 1.
  if (operator === '^' && minimum.major >= 1 && api.major !== minimum.major) {
    return 'incompatible';
  }
  return 'compatible';
}

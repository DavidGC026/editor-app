// ── Extension version ordering ──────────────────────────────────────────
//
// Lenient semver-ish comparison for update checks. Marketplace versions are
// almost always `A.B.C[-prerelease]`; anything unparseable compares as a
// string so exotic versions order deterministically instead of throwing.

function mainAndPrerelease(version: string): [string, string | null] {
  const idx = version.indexOf('-');
  return idx === -1 ? [version, null] : [version.slice(0, idx), version.slice(idx + 1)];
}

export function compareExtensionVersions(a: string, b: string): number {
  const [aMain, aPre] = mainAndPrerelease(a.trim());
  const [bMain, bPre] = mainAndPrerelease(b.trim());

  const aParts = aMain.split('.');
  const bParts = bMain.split('.');
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aRaw = aParts[i] ?? '0';
    const bRaw = bParts[i] ?? '0';
    const aNum = Number(aRaw);
    const bNum = Number(bRaw);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else if (aRaw !== bRaw) {
      return aRaw < bRaw ? -1 : 1;
    }
  }

  // Same core version: a release outranks any prerelease of it.
  if (aPre === bPre) return 0;
  if (aPre === null) return 1;
  if (bPre === null) return -1;
  return aPre < bPre ? -1 : aPre > bPre ? 1 : 0;
}

/** True when `candidate` is strictly newer than `installed`. */
export function isNewerExtensionVersion(candidate: string, installed: string): boolean {
  return compareExtensionVersions(candidate, installed) > 0;
}

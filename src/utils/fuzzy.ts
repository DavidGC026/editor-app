/** Score how well `query` matches `text`. Higher is better; 0 = no match. */
export function fuzzyScore(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return 1;

  if (haystack.includes(needle)) {
    let score = 100;
    if (haystack.startsWith(needle)) score += 40;
    const wordStart = haystack.indexOf(` ${needle}`);
    if (wordStart >= 0) score += 25;
    score += Math.max(0, 30 - haystack.indexOf(needle));
    return score;
  }

  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < haystack.length && qi < needle.length; i++) {
    if (haystack[i] === needle[qi]) {
      score += 8 + streak * 4;
      if (i === 0 || haystack[i - 1] === ' ' || haystack[i - 1] === ':' || haystack[i - 1] === '-') {
        score += 6;
      }
      streak++;
      qi++;
    } else {
      streak = 0;
    }
  }
  return qi === needle.length ? score : 0;
}

export function fuzzyMatchCommand(
  label: string,
  query: string,
  keywords: string[] = [],
): number {
  const labelScore = fuzzyScore(label, query);
  if (labelScore === 0) {
    for (const kw of keywords) {
      const s = fuzzyScore(kw, query);
      if (s > 0) return Math.round(s * 0.85);
    }
    return 0;
  }
  return labelScore;
}

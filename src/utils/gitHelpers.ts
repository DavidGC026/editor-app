import { GitChange } from '../types';

export function gitStatusLabel(change: GitChange): string {
  if (change.x === '?' && change.y === '?') return 'U';
  if (change.x === '!' && change.y === '!') return 'I';
  if (change.x === 'A') return 'A';
  if (change.x === 'D' || change.y === 'D') return 'D';
  if (change.x === 'R') return 'R';
  if (change.x === 'C') return 'C';
  if (change.x === 'M' || change.y === 'M') return 'M';
  return 'U';
}

export function gitStatusTitle(change: GitChange): string {
  const code = gitStatusLabel(change);
  const labels: Record<string, string> = {
    M: 'Modified',
    A: 'Added',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    U: 'Untracked',
  };
  return labels[code] || code;
}

export function isStaged(change: GitChange): boolean {
  return change.x !== ' ' && change.x !== '?' && change.x !== '';
}

export function isUnstaged(change: GitChange): boolean {
  return change.y !== ' ' && change.y !== '';
}

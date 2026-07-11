const STORAGE_KEY = 'forge.recentCommands.v1';
const MAX_RECENT = 8;

export function loadRecentCommandIds(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function recordRecentCommand(commandId: string): void {
  if (!commandId) return;
  const prev = loadRecentCommandIds().filter((id) => id !== commandId);
  const next = [commandId, ...prev].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

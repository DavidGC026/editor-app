// ── Extension menus (renderer) ──────────────────────────────────────────
//
// Pure helpers that turn `contributes.menus` payloads into renderable
// context-menu entries. Everything is derived from the installed-extension
// payloads on demand — there is no registration state, so a disabled or
// uninstalled extension can never leave an orphaned menu item behind.
//
// Visibility is decided at open time: the caller evaluates each item's
// `when`-clause against the ContextKeyService with transient resource keys
// (`resourceExtname`, `explorerResourceIsFolder`, …) overlaid for the
// node the menu opened on.
//
// Erasable TypeScript, tested unbundled via Node type stripping.

/** Minimum payload shape needed (structural twin of InstalledExtension). */
export interface MenuContributionSource {
  id: string;
  enabled: boolean;
  displayName: string;
  commands: { command: string; title: string; category: string | null }[];
  menus: { menu: string; command: string; when: string | null; group: string | null }[];
}

/** One resolved entry of a workbench menu, ready to render. */
export interface ResolvedMenuItem {
  command: string;
  /** Command title (category-prefixed), falling back to the raw id. */
  title: string;
  /** Extension that contributed the item. */
  ownerId: string;
  when: string | null;
  group: string | null;
}

// VS Code group semantics: `navigation` sorts first, then groups
// alphabetically; `name@order` sorts by the numeric suffix within a group.
function groupRank(group: string | null): { name: string; order: number } {
  if (!group) return { name: '9_zzz_default', order: 0 };
  const at = group.lastIndexOf('@');
  const name = at > 0 ? group.slice(0, at) : group;
  const order = at > 0 ? Number(group.slice(at + 1)) : 0;
  return { name, order: Number.isFinite(order) ? order : 0 };
}

function compareMenuItems(a: ResolvedMenuItem, b: ResolvedMenuItem): number {
  const ga = groupRank(a.group);
  const gb = groupRank(b.group);
  if (ga.name !== gb.name) {
    if (ga.name === 'navigation') return -1;
    if (gb.name === 'navigation') return 1;
    return ga.name < gb.name ? -1 : 1;
  }
  // Ties keep declaration order (Array#sort is stable).
  return ga.order - gb.order;
}

/** Resolves the items every enabled extension contributes to `menuId`,
 *  with command titles looked up across ALL enabled extensions (an item
 *  may reference a command another extension declares). */
export function buildMenuItems(
  extensions: MenuContributionSource[],
  menuId: string,
): ResolvedMenuItem[] {
  const enabled = extensions.filter((ext) => ext.enabled !== false);
  const titles = new Map<string, string>();
  for (const ext of enabled) {
    for (const cmd of ext.commands ?? []) {
      if (titles.has(cmd.command)) continue; // first declaration wins
      titles.set(cmd.command, cmd.category ? `${cmd.category}: ${cmd.title}` : cmd.title);
    }
  }

  const items = enabled.flatMap((ext) =>
    (ext.menus ?? [])
      .filter((item) => item.menu === menuId)
      .map((item) => ({
        command: item.command,
        title: titles.get(item.command) ?? item.command,
        ownerId: ext.id,
        when: item.when,
        group: item.group,
      })),
  );
  return items.sort(compareMenuItems);
}

/** Keeps the items whose `when`-clause holds right now. `match` is the
 *  ContextKeyService closure carrying the transient resource keys. */
export function filterMenuItems(
  items: ResolvedMenuItem[],
  match: (expression: string | null) => boolean,
): ResolvedMenuItem[] {
  return items.filter((item) => match(item.when));
}

/** Transient context keys describing the file-tree node a context menu
 *  opened on, mirroring the VS Code names extension authors target. */
export function explorerResourceContext(node: {
  path: string;
  name: string;
  /** Forge's tree uses 'file' | 'directory'. */
  type: string;
}): Record<string, unknown> {
  const isFile = node.type === 'file';
  const dot = node.name.lastIndexOf('.');
  return {
    resourceScheme: 'file',
    resourcePath: node.path,
    resourceFilename: node.name,
    resourceExtname: isFile && dot > 0 ? node.name.slice(dot) : '',
    explorerResourceIsFolder: !isFile,
  };
}

# Extension Architecture

The extension system is split between Electron main process, preload API, renderer state, and the Extensions panel UI.

## Main Process

File: `electron/extensions.ts`

Responsibilities:

- Search Open VSX.
- Download VSIX packages from Open VSX.
- Open a file picker for local VSIX installation.
- Extract the `extension/` subtree from a VSIX.
- Parse `extension/package.json`.
- Register installed package metadata.
- Read theme and snippet contribution files.
- Uninstall extension directories owned by Forge.

## IPC Surface

Files:

- `electron/main.ts`
- `electron/preload.ts`
- `src/types.ts`

Available extension methods:

- `ext.installVsix()`
- `ext.installFromOpenVsx(extensionId)`
- `ext.searchOpenVsx(query, size)`
- `ext.list()`
- `ext.uninstall(id)`
- `ext.setActiveTheme(themeId)`

## Renderer State

File: `src/store.ts`

Responsibilities:

- Load installed extensions on startup.
- Apply supported Monaco contributions.
- Persist active theme selection.
- Track install/search loading state.
- Track Marketplace errors.

## UI

File: `src/components/ExtensionsPanel.tsx`

The panel now treats installed extensions as complete packages, not only themes or snippets.

Installed extensions display:

- Runtime status.
- Publisher and version.
- Supported declarative features.
- Contribution keys.
- Entrypoints and activation event counts when present.

Runtime labels:

- `Declarative`: Forge can activate at least one contribution now.
- `Extension Host required`: package has code entrypoints or activation events.
- `Metadata only`: package installed, but no currently supported contribution was found.


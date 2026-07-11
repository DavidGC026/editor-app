# Extension Host Roadmap

Installing complete VSIX packages is the foundation. Full VS Code compatibility requires a real extension-host layer.

## Phase 1: Manifest Coverage

Status: partially implemented.

Goals:

- Keep complete manifest metadata.
- Show compatibility status in UI.
- Avoid rejecting valid VSIX packages.
- Activate safe declarative contributions.

Implemented:

- Themes.
- Snippets.
- Contribution key display.
- Entrypoint and activation event visibility.

## Phase 2: Contribution Registry

Add non-code contribution support where feasible:

- `contributes.languages`
- `contributes.grammars`
- `contributes.iconThemes`
- `contributes.productIconThemes`
- `contributes.configuration`
- `contributes.keybindings`
- `contributes.menus`

This phase should prefer declarative interpretation over running extension code.

## Phase 3: Extension Host Runtime

Build a controlled extension host process that can load extension JavaScript and expose a compatible subset of the VS Code API.

Required pieces:

- Isolated process or worker.
- Activation event dispatcher.
- `vscode` module shim.
- Command registry bridge.
- Workspace/file system APIs.
- Window/editor APIs.
- Configuration API.
- Diagnostics bridge.
- Language feature provider bridge.
- Cancellation tokens and disposables.
- Logging and error isolation.

## Phase 4: Language and Debug Bridges

Many VS Code extensions are wrappers around external tools. Forge should integrate these through native systems where possible:

- LSP for language servers.
- DAP for debug adapters.
- Task runner for scripts and commands.
- Problem matchers for compiler/test output.

This avoids depending exclusively on extension code for core developer workflows.

## Phase 5: Compatibility Matrix

Add a compatibility view per extension:

- Installed version.
- Supported contributions.
- Unsupported contributions.
- Required APIs.
- Activation events.
- Known runtime errors.

This gives users a practical answer to "installed" versus "works".


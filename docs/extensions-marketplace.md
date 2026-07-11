# Extensions Marketplace

Forge integrates a VS Code-style extension marketplace through Open VSX and local VSIX installation.

## Current Scope

Forge can install complete VSIX packages from:

- Open VSX search results.
- Manual `.vsix` or `.zip` selection.

Installed packages are extracted under Electron `userData/extensions/<publisher.name>/` and registered in Forge's shared config file.

Forge currently activates safe declarative extension contributions:

- `contributes.themes`
- `contributes.snippets`

All other manifest metadata is preserved so the editor can show what is installed and whether a future extension host is required.

## Why Open VSX

The Microsoft Visual Studio Marketplace is licensed for Microsoft VS Code products. Forge should use Open VSX as the default registry and keep local VSIX installation available for user-supplied packages.

## Installed Extension Metadata

For each installed extension, Forge stores and exposes:

- `id`
- `displayName`
- `publisher`
- `version`
- `description`
- `categories`
- `activationEvents`
- `extensionKind`
- `main`
- `browser`
- `contributes`
- `supported`
- `themes`
- `snippets`

The renderer uses this metadata to distinguish immediately supported contributions from packages that require a real extension host.


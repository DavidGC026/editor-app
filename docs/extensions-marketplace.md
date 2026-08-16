# Extensions Marketplace

> Este documento describe la implementación actual. La arquitectura objetivo y
> el plan de evolución están en
> [extensions-architecture.md](./extensions-architecture.md) y
> [extensions-roadmap.md](./extensions-roadmap.md).

Forge integrates a VS Code-style extension marketplace through Open VSX and local VSIX installation.

## Current Scope

Forge can install complete VSIX packages from:

- Open VSX search results.
- Manual `.vsix` or `.zip` selection.

Installed packages are extracted under Electron `userData/extensions/<publisher.name>/` and registered in Forge's shared config file.

Forge currently activates a limited declarative subset:

- `contributes.themes`
- `contributes.snippets`
- Part of `contributes.languages`

`contributes.iconThemes` is parsed and selectable in the UI, but is not yet
applied to the Explorer and therefore remains metadata-level compatibility.

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

## Extension Detail Page

Clicking a marketplace result in the Extensions panel opens a detail tab in the editor area (like VS Code's extension page). The tab shows:

- Icon, display name, version, verified/pre-release/deprecated badges.
- Download count, rating, and last-updated date.
- Install / Uninstall actions and a link to the Open VSX page.
- The extension README, rendered with a minimal safe markdown subset (no raw HTML execution).
- Sidebar metadata: categories, tags, publisher, license, `engines.vscode`, and repository/homepage/issues links.
- For installed extensions, the runtime-support status (declarative contributions vs. extension host required).

The full metadata + README is fetched through the `ext:detail` IPC handler (`getOpenVsxDetail` in `electron/extensions.ts`), which queries `open-vsx.org/api/<namespace>/<name>/latest`. README downloads are capped at 512 KB.

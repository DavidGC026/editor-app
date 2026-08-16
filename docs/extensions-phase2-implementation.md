# Extensions: Phase 2 Implementation Details

> Historical implementation note. It is not the current roadmap or
> compatibility source of truth. Use
> [extensions-roadmap.md](./extensions-roadmap.md) and
> [extensions-compatibility.md](./extensions-compatibility.md).

This document outlines the Phase 2 extension integration features implemented in Forge.

## Overview
Forge uses a dual-process model for extensions. Previously, only `contributes.themes` and `contributes.snippets` were supported. We have now implemented parsing and activation for:
- `contributes.languages`
- `contributes.iconThemes`
- Enhanced integration for "Extension Host required" extensions (Agent CLIs and Formatters)

## 1. Language Contributions
Extensions can contribute language configurations, allowing Monaco to understand file associations, brackets, comments, and auto-closing pairs.

### Implementation Details:
- **Parsing:** `electron/extensions.ts` reads the `contributes.languages` array from `package.json` during VSIX installation.
- **Language Configurations:** If a `configuration` file (e.g., `language-configuration.json`) is provided, it is read, parsed using our internal JSONC parser, and included in the `InstalledExtensionPayload`.
- **Monaco Registration:** `src/extensions/registry.ts` exposes `registerLanguages`. It checks if a language is already registered in Monaco. If not, it registers it. It then applies the language configuration via `monaco.languages.setLanguageConfiguration()`.
- **Clean up:** Disposables are tracked and cleaned up on extension reloads.

## 2. Icon Themes
Icon themes are parsed and exposed in the selector, but renderer application is
not complete yet.

### Implementation Details:
- **Parsing:** `electron/extensions.ts` reads `contributes.iconThemes`. For each icon theme, the definitions JSON is parsed.
- **Data Conversion:** The actual SVG/PNG icon files are read from the extension bundle and converted into Base64 Data URLs so they can be easily transmitted to the renderer process.
- **Store & IPC:** The active icon theme is persisted in the main process via `forge-config.json`. The `ext:setActiveIconTheme` IPC handler enables the renderer to switch themes.
- **UI:** The Extensions panel lists installed Icon Themes and stores a renderer
  selection. The Explorer does not consume the selected theme yet.

## 3. Agent & Formatter Integrations
Extensions that require a full Extension Host (like `Claude Code for VS Code`, `Prettier`, or `ESLint`) are still lacking true host support. However, we've vastly improved their UX.

### Implementation Details:
- **Terminal Agent Launch:** For AI Agent extensions (e.g., Claude Code, Codex), a prominent "Launch in Terminal" button is shown.
- **Formatter Quick Actions:** For formatting extensions (e.g., Prettier, ESLint, Biome), a quick action is shown to format the workspace using the equivalent CLI command.
- **Nuanced Status Labels:** Instead of a generic "Extension Host required" tag, extensions now show dynamic, color-coded badges based on their capabilities (e.g., "Terminal Agent", "Partial", "Active").
- **Capability Summary:** The Extensions panel explicitly lists which `contributes` keys are active and which are pending support.

## Future Work
- Finalizing the Icon Theme renderer integration for the `FileTree` component.
- Supporting `contributes.grammars` for TextMate syntax highlighting.

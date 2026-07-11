# Extension Compatibility

Forge now accepts general VSIX/Open VSX extensions, but full VS Code extension compatibility requires an extension host.

## Supported Now

### Themes

VS Code color themes from `contributes.themes` are parsed, converted to Monaco theme IDs, and exposed in the Color Theme list.

Theme JSON supports JSONC-style comments and trailing commas. Basic `include` chains are merged.

### Snippets

VS Code snippets from `contributes.snippets` are loaded per language and registered with Monaco completion support.

## Installed But Not Executed Yet

Extensions with these fields are installed and shown, but their code is not executed:

- `main`
- `browser`
- `activationEvents`

Common examples:

- Language extensions that wrap a language server.
- Debug adapters.
- Formatters.
- Linters.
- Tree views.
- Commands implemented in extension code.
- Webview-based extensions.

## UI Behavior

Forge no longer rejects an extension because it lacks themes or snippets. Instead, it installs the package and shows whether it is usable immediately or requires future extension-host work.

This prevents false negatives for valid VS Code extensions while keeping runtime behavior explicit.

## Agent Extensions

Known AI-agent-related marketplace entries can map to Forge terminal agents:

- OpenAI ChatGPT extension -> `codex`
- Anthropic Claude Code extension -> `claude`
- Cursor Agent-related entries -> `cursor-agent`
- Antigravity-related entries -> `agy`

These are terminal-agent integrations, not VS Code extension host execution.


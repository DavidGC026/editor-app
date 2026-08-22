# Forge

Editor de código de escritorio (Electron + React + TypeScript + Monaco).
La UI y los prompts del agente van en español.

Forge ya edita, busca, habla con Git y con varios LLMs, y abre workspaces
por SSH. El trabajo grande en curso es una plataforma de extensiones
compatible de forma incremental con VS Code: hoy corre el motor
declarativo y el kernel del Extension Host; **todavía no ejecuta** el
`main` de extensiones de terceros.

Documentación: [docs/README.md](./docs/README.md).

## Requisitos

- Node.js 18+ y [pnpm](https://pnpm.io)
- `git` en el PATH (Source Control)
- cliente OpenSSH (`ssh`) si vas a abrir un workspace remoto
- Los CLIs de los agentes de terminal (`codex`, `claude`, `cursor-agent`,
  `agy`) son opcionales: Forge los lanza si existen

Tras clonar, hace falta un rebuild nativo de `node-pty`:

```bash
pnpm install
pnpm rebuild:native
```

`pnpm install` también corre `electron-builder install-app-deps`. Si el
PTY no arranca, vuelve a ejecutar `rebuild:native`.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Vite en `:5173`, compila Electron y abre la ventana |
| `pnpm build` | Compila `dist-electron/` + `dist/` (renderer) |
| `pnpm test:extensions` | Suite `node:test` de `tests/extensions/` |
| `pnpm package` | AppImage Linux en `release/` |
| `pnpm rebuild:native` | Rebuild de `node-pty` contra la ABI de Electron |

No hay tests del renderer, de Git, de LSP ni de SSH. La única suite es
la de extensiones.

## Empaquetado

`pnpm package` corre `scripts/prepare-pack.mjs` y luego electron-builder
sobre `.electron-pack/`. El script aplana el store de pnpm porque
electron-builder no sigue `node_modules/.pnpm`. Salida: AppImage en
`release/`. `node-pty` va fuera del asar (`asarUnpack`).

Hoy el target de `package.json` es solo Linux. Windows y macOS no están
en el pipeline.

## Mapa rápido

| Pieza | Dónde |
| --- | --- |
| Proceso main | `electron/main.ts` y módulos vecinos |
| Puente IPC | `electron/preload.ts` → `window.electronAPI` |
| Renderer | `src/` (React 18 + Zustand + Tailwind) |
| Extensiones | `electron/extensions/`, `src/extensions/`, [docs del sistema](./docs/extensions-architecture.md) |
| Config global | `forge-config.json` en el `userData` de Electron |
| Por workspace | `.forge/` (`settings.json`, `history.json`, `PROJECT.md`) |

Arquitectura del editor: [docs/app-architecture.md](./docs/app-architecture.md).

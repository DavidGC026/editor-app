# Tienda de extensiones

Estado: **implementación actual** (2026-08-22). El plan y la matriz
mandan: [extensions-roadmap.md](./extensions-roadmap.md),
[extensions-compatibility.md](./extensions-compatibility.md).

Forge instala VSIX desde **Open VSX** o desde un `.vsix` / `.zip` local.
El Marketplace de Microsoft no se usa: su licencia cubre productos de
VS Code, no a Forge. Decisión de producto en
[extensions-architecture.md](./extensions-architecture.md) §17.

“Instalada” no significa “compatible”. La UI tiene que mostrar el
reporte, no un badge genérico *Active*.

## Superficie

El panel (`ExtensionsPanel`) tiene cuatro bloques, de arriba abajo:

1. Búsqueda + *Install from VSIX…* + banner de Workspace Trust.
2. Resultados de Marketplace (Open VSX).
3. Selectores de color theme e icon theme (built-in + contribuciones
   habilitadas).
4. Lista *Installed* con enable/disable, update, rollback y uninstall.

Un click en un resultado abre `ExtensionDetailView` como tab del
editor. El estado vive en `extensionSlice`.

## Capas

| Pieza | Dónde | Rol |
| --- | --- | --- |
| Puerto `ExtensionCatalog` | `application/ports/extension-catalog.ts` | `latestMetadata` y `downloadLatestVsix` |
| Adaptador Open VSX | `infrastructure/open-vsx-catalog.ts` | `https://open-vsx.org`, fetch inyectable |
| Install por id | `InstallExtensionById` | Grafo de deps **antes** de descargar |
| Updates | `CheckExtensionUpdates` | Compara cada instalada contra `latest` |
| Búsqueda / detalle | `electron/extensions.ts` | Todavía en la facade, **fuera** del puerto |
| IPC | `ext:searchOpenVsx`, `ext:detail`, `ext:installFromOpenVsx`, … | Preload tipado |
| Fallback Vite | `searchOpenVsxFromRenderer` / `fetchDetailFromRenderer` | Solo si no hay Electron |

El catálogo instala y comprueba updates. Buscar y pintar el README no
pasaron por el puerto: duplican URL y normalización. Sacarlos al
catálogo es deuda de la tienda, no un milestone nuevo.

## Búsqueda

- Debounce 260 ms; query vacío también pega a Open VSX (lista por
  relevancia).
- `GET /api/-/search?query=&size=&sortBy=relevance&sortOrder=desc`.
- `size` pedido: 24. Main lo recorta a 1–50.
- El panel muestra `totalSize` pero **no pagina**: no hay offset ni
  “cargar más”.
- Campos de tarjeta: icono (o inicial), `displayName`,
  `namespace.name`, descripción, versión, downloads, rating, verified.
- Deprecated: el botón Install se deshabilita.
- No hay selector de versión: se instala siempre `/latest`.

Nivel en la matriz: `partial` (falta paginación y versiones).

## Install por id (Marketplace)

`InstallExtensionById.install(publisher.name)`:

1. Resuelve el grafo con `latestMetadata` (tope 32 ids). Un ciclo se
   corta: cada id se visita una vez.
2. `extensionDependencies` son **requeridas** y van antes que la raíz.
   Si una falla, no se instala la pedida.
3. `extensionPack` es best-effort (warning, no aborta).
4. Una dependencia ya instalada **no** se actualiza de paso.
5. Se descarga el VSIX a un temp, se instala por el mismo store que el
   VSIX local, se borra el temp.
6. Si el manifiesto del paquete no declara el id pedido
   (`identity-mismatch`), se hace rollback: el usuario aprobó `id`, no
   otro publisher.

Tras el commit: directorio
`userData/extensions/<id>/<version>/`, hash, provenance, registry
atómico. Una instalación fallida deja intacta la versión activa.

VSIX local: mismo store, sin grafo de catálogo. El picker está en
main (`ext:installVsix`).

## Updates y rollback

Al montar el panel se llama `checkExtensionUpdates`. Un fallo de
catálogo por extensión es warning: la tienda offline no tumba la lista.

- Update = volver a `install(id)` (reinstala `latest`).
- Rollback = intercambia el directorio versionado anterior
  (`previousVersion` en el registro). El botón History solo aparece si
  hay versión retenida.

No hay auto-update, canal prerelease ni pausa de updates (Milestone 10).

## Lista instalada y badges

El label de runtime sale del reporte + trust, no del nombre del
paquete:

| Label | Cuándo |
| --- | --- |
| Disabled | `enabled === false` |
| Terminal Agent | Heurística de CLI (ver abajo) |
| Restricted | `trust.activation === 'blocked'` |
| Active | `compatibility.level === 'full'` |
| Partial | hay contribuciones activas y otras pendientes, o pide host |
| Extension Host required / Metadata only | nada declarativo activo |

Badges por contribution point: las `supportedContributions` van en
verde; las `pendingContributions` en gris con el motivo del blocker
(`unsupported-contribution`, `contribution-load-failed`,
`integration-pending`).

Trust: el banner del panel ofrece conceder confianza en workspaces
locales. Un remoto no se puede marcar trusted. Ver
[extensions-phase3-trust.md](./extensions-phase3-trust.md).

## Vista de detalle

Tab del editor, no un modal.

- Header: icono, versión, verified, pre-release, deprecated, downloads,
  rating, fecha.
- Install / Uninstall y enlace a la página de Open VSX.
- README: subset de markdown renderizado como React (**nunca**
  `innerHTML`). HTML desconocido se tira; `<img src>` se acepta como
  imagen markdown. Tope 512 KB.
- Sidebar: categories, tags (sin los `__internos` de Open VSX),
  license, publisher, `engines.vscode`, homepage / repo / issues.
- Si está instalada: settings de `contributes.configuration` y la lista
  de comandos/atajos.

En Vite sin Electron el detalle se fetchea desde el renderer; en la
app empaquetada va por `ext:detail`.

## Heurísticas que no son compatibilidad

La tienda **no** sustituye una extensión por un CLI y la vende como la
misma extensión (regla de la matriz). Dos atajos de producto conviven
con esa regla y tienen que etiquetarse como integración Forge:

**Agentes de terminal.** Claude Code y Codex **no** aparecen como
atajo en este panel: viven en `AgentsPanel` hasta que el Extension Host
los hospede. Cursor Agent y Antigravity sí muestran un botón Terminal
si el id/nombre/descripción coincide; lanzan `cursor-agent` / `agy` en
un PTY. El badge dice *Terminal Agent*, no *Active*.

**Formatters.** Prettier, ESLint y Biome (por id o categoría) muestran
un CLI sugerido (`npx prettier --write .`, etc.). Es una pista, no la
extensión corriendo. El botón Play del panel **todavía no dispara** ese
comando (el click pasa `null` a `runAgentInTerminal`).

Ver [ai-and-agents.md](./ai-and-agents.md).

## Lo que la tienda no tiene (y no hay que fingir)

Del Milestone 10 y de la matriz `partial`:

| Hueco | Dónde cae |
| --- | --- |
| Paginación / infinite scroll | search `partial` |
| Instalar una versión concreta | siempre `/latest` |
| Filtros `@installed`, `@enabled`, `@disabled`, `@updates`, `@builtin` | M10 |
| Recommendations / workspace recommendations | M10 |
| Perfiles, auto-update, canales prerelease | M10 |
| Firma del publisher más allá de `verified` de Open VSX | M10 |
| Search/detail en el puerto `ExtensionCatalog` | deuda de diseño |
| Normalización de resultados compartida (hoy se copia en facade y slice) | deuda |

Un extension pack se instala best-effort; no hay UI de “estas van
juntas”. El compatibility dashboard rico (API faltante, activation
time, logs) también es M10: hoy bastan nivel + blockers + badges.

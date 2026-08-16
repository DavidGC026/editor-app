# Extensiones: progreso del Milestone 0

Última actualización: 2026-07-16

## Incremento 0.1 — contratos y manifest reader

Completado:

- Entidades tipadas para el manifiesto normalizado y sus contribuciones
  declarativas actuales.
- Puerto pequeño `ManifestReader`, independiente de Electron y filesystem.
- Adaptador `VscodeManifestReader` responsable de JSONC y normalización.
- Parser JSONC que preserva comentarios y comas aparentes dentro de strings.
- `electron/extensions.ts` conserva su función de facade y delega el parsing al
  nuevo puerto, sin cambiar el flujo visible de instalación.
- Fixtures declarativo y runtime.
- Fixture VSIX generado de forma determinista y pruebas del contenedor ZIP.
- Suite basada en `node:test`, sin añadir dependencias de producción o test.

Pruebas de caracterización cubiertas:

- Comentarios JSONC y trailing commas.
- Normalización de themes, snippets, languages e icon themes.
- `main`, `browser`, activation events y `extensionKind` string/array.
- Defaults legacy durante la migración de la facade.
- Rechazo de JSON malformado.
- Lectura de `extension/package.json` desde un VSIX mínimo real.

## Decisiones

- Se conservan temporalmente defaults legacy como `unknown.unknown`; el
  package manager transaccional los reemplazará por validación discriminada en
  Milestone 1.
- El reader no realiza I/O, instalación ni persistencia.
- Paths de contribuciones sólo mantienen por ahora la normalización anterior de
  `./`; su validación de seguridad pertenece al package store transaccional.

## Incremento 0.2 — registry y contratos IPC

Completado:

- Puerto `ExtensionRegistry` con operaciones pequeñas `list`, `get`, `upsert` y
  `remove`.
- Adaptador `JsonExtensionRegistry` con persistencia inyectada; no depende de
  Electron, `app.getPath` ni filesystem.
- Entidad `InstalledExtensionRecord`, separando ubicación de instalación del
  manifiesto original.
- Decoder en el límite de persistencia para registros actuales y legacy.
- Inferencia de `name` para entradas creadas antes del Milestone 0.
- Normalización de claves legacy con mayúsculas/minúsculas durante update/remove.
- Rechazo tolerante de entradas corruptas sin contaminar el dominio.
- Preservación comprobada de otras preferencias dentro de `forge-config.json`.
- DTOs de Electron agrupados en `extension-dto.ts`.
- Superficie `ext` del preload tipada sin `any`.
- `ext:list` expone `protocolVersion: 1` como handshake inicial entre main,
  preload y renderer.
- La facade delega list/get/upsert/remove al puerto de registry.

Pruebas añadidas:

- Upsert/remove preservan configuración no relacionada.
- Upsert no elimina otras extensiones.
- Migración tolerante de registros sin el campo `name`.
- Entradas corruptas son ignoradas y no provocan escrituras accidentales.
- Claves legacy de casing distinto se consolidan sin crear duplicados.

### Decisiones del incremento 0.2

- El adaptador recibe funciones `readConfig`/`writeConfig`; así conserva por
  ahora el archivo compartido sin acoplar dominio y aplicación a Electron.
- La escritura todavía usa el mecanismo legacy no transaccional. Staging,
  escritura atómica y rollback pertenecen al Milestone 1.
- El protocolo se versiona primero en `ext:list`, que funciona como handshake.
  Los envelopes RPC generales se introducirán antes del Extension Host.
- Los registros se normalizan al leer, pero no se reescriben automáticamente:
  evitamos mutaciones sorpresivas y se persistirán al siguiente cambio explícito.

## Incremento 0.3 — contribution readers y compatibilidad determinista

Completado:

- Cuatro puertos segregados: themes, snippets, languages e icon themes.
- Adaptadores filesystem independientes para cada familia de contribución.
- Resolución común de recursos que rechaza lecturas fuera del directorio de la
  extensión.
- Theme reader con includes acotados, detección de ciclos y merge de colors y
  token colors.
- Snippet reader que valida definiciones antes de crear DTOs.
- Language reader que normaliza comments, brackets, closing pairs, folding,
  word pattern e indentation rules.
- Icon theme reader con límite de 32 KB por icono y conversión SVG/binaria a
  data URL.
- Puerto `ExtensionCompatibilityAnalyzer` y primera implementación declarativa.
- La compatibilidad activa ahora depende de payloads cargados correctamente, no
  sólo de claves presentes en el manifiesto.
- Corrección de `requiresExtensionHost`: activation events sin `main`/`browser`
  no implican código ejecutable.
- La facade `electron/extensions.ts` quedó limitada a composición y casos de uso
  de alto nivel para estas contribuciones.

Fixtures y pruebas añadidas:

- Theme con include y override de colores.
- Snippets válidos e inválidos.
- Configuración completa de lenguaje.
- Icon theme con recursos SVG reales.
- Rechazo de path traversal.
- Compatibilidad con cargas exitosas/fallidas y entrypoints runtime.

### Decisiones del incremento 0.3

- Los readers capturan el fallo de una contribución individual para que una
  extensión parcialmente dañada no impida listar las demás.
- `iconThemes` continúa fuera de `supported.declarative` hasta que el Explorer
  realmente consuma el tema seleccionado.
- La resolución segura de lectura complementa, pero no sustituye, la validación
  transaccional del paquete prevista para Milestone 1.
- El analyzer actual entrega el contrato legacy `supported`; el reporte rico de
  compatibility level/blockers llegará en el siguiente corte.

## Incremento 0.4 — reporte de compatibilidad, extensionSlice y validación

Completado:

- `ExtensionCompatibilityReport` tipado en el DTO IPC: `level`
  (`full`/`partial`/`none`), `supportedContributions`, `pendingContributions`
  y `blockers` discriminados (`requires-extension-host`,
  `unsupported-contribution`, `contribution-load-failed`,
  `integration-pending`).
- `DeclarativeCompatibilityAnalyzer` produce el reporte a partir de lo que
  realmente cargó; el contrato legacy `supported` se deriva del reporte con
  `toLegacySupported` y queda marcado como transitorio.
- `iconThemes` se reporta como `integration-pending`: carga correctamente pero
  el Explorer aún no consume el tema seleccionado.
- Los badges del panel de extensiones y del detail view consumen el reporte;
  el tooltip de cada contribución pendiente explica el blocker real en lugar
  de asumir "requires Extension Host".
- Estado de tienda extraído del store monolítico a
  `src/store/slices/extensionSlice.ts` con el patrón de dependencias de los
  demás slices; los helpers de Open VSX y `cleanIpcError` salieron de
  `store.ts` (`cleanIpcError` ahora vive en `src/store/utils/ipcError.ts`).
- `ManifestReader` ganó `readWithDiagnostics`, que nunca lanza y devuelve
  `ManifestReadResult` discriminado; `read` conserva el modo legacy.
- `parseJsonc` distingue raíz no-objeto (`JsoncRootTypeError`) de JSON
  malformado, lo que permite discriminar `not-an-object` de `invalid-json`.
- La instalación de VSIX usa el modo validante: documentos ilegibles rechazan
  la instalación con el detalle de issues; los defectos recuperables solo se
  registran como warning hasta el package manager transaccional.

Pruebas añadidas:

- Reporte del analyzer para cargas completas, fallos de carga, entrypoints
  runtime, contribuciones sin soporte declarativo y derivación legacy.
- `readWithDiagnostics` con JSON malformado, raíz no-objeto, manifiestos
  incompletos (issues + defaults legacy) y manifiesto completo sin issues.
- El fixture declarativo ahora declara `engines.vscode`, como cualquier VSIX
  real.

### Decisiones del incremento 0.4

- El campo legacy `supported` sigue en el payload porque el protocolo IPC v1
  no se rompe dentro del Milestone 0; se retirará junto con el bump de
  `protocolVersion`.
- Los issues recuperables (`missing-field`, `invalid-field-type`) no bloquean
  instalación todavía: el modo legacy `unknown.unknown` sigue vigente hasta el
  Milestone 1, donde pasarán a ser rechazos.
- `gitSlice` conserva su propio `cleanIpcError` porque su semántica de parseo
  difiere; unificarlo es un cambio de comportamiento que no pertenece a este
  corte.

## Incremento 0.5 — icon theme aplicado y persistente

Completado:

- Resolver de icon themes en el renderer (`src/extensions/iconTheme.ts`):
  módulo puro que sigue la precedencia de VS Code — `fileNames` >
  `fileExtensions` (sufijos multi-punto, sin punto inicial) > `languageIds` >
  default `file`; carpetas usan `folderNames(Expanded)` > `folder(Expanded)`.
  Lookups case-insensitive; devuelve `null` para que el caller haga fallback.
- El Explorer (`TreeItem`) consume el resolver: cuando hay icon theme activo
  renderiza los data URLs del tema y conserva los iconos lucide como fallback
  cuando el tema no tiene asociación para la entrada.
- Persistencia completa del active icon theme: `setIconTheme` valida el id
  contra los temas instalados y persiste vía `ext:setActiveIconTheme` (canal
  que ya existía pero nadie invocaba); `refreshExtensions` restaura
  `activeIconTheme` desde `ext:list` y lo descarta si la extensión que lo
  aportaba ya no está instalada.
- `iconThemes` promovido en el analyzer: con payload cargado cuenta como
  contribución soportada. El blocker `integration-pending` permanece en la
  unión para futuras familias que carguen sin superficie de consumo.

Pruebas: el suite del analyzer se actualizó al nuevo contrato (fixture
declarativo completo ahora reporta `level: full` con las cuatro familias
soportadas).

### Decisiones del incremento 0.5

- La resolución de iconos vive en el renderer porque opera sobre payloads ya
  cargados y validados por main; main sigue siendo dueño de leer y acotar los
  recursos (límite de 32 KB por icono).
- `rootFolder`/`rootFolderExpanded` no se aplican todavía: el árbol del
  Explorer no distingue la raíz del workspace como nodo renderizado.
- El resolver no tiene pruebas unitarias propias: la suite `node:test` sólo
  compila `electron/`; queda anotado para cuando exista infraestructura de
  pruebas del renderer.

## Continuación

El trabajo continúa en el Milestone 1:
[extensions-phase1-progress.md](./extensions-phase1-progress.md). Su
incremento 1.0 cubrió los tres puntos que quedaban planificados aquí (package
store transaccional, promoción de issues a rechazos y directorios versionados
con validación de `engines.vscode`).

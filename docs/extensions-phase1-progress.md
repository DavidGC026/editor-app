# Extensiones: progreso del Milestone 1

Última actualización: 2026-07-17

Roadmap: [extensions-roadmap.md](./extensions-roadmap.md) · Baseline previo:
[extensions-phase0-progress.md](./extensions-phase0-progress.md)

## Incremento 1.0 — package store transaccional

Completado:

- Puerto `ExtensionPackageStore` con ciclo `stage` → `commit` → `abort` y
  `prune` de versiones antiguas. `stage` nunca toca la versión activa; sólo
  `commit` promueve el staging al almacén.
- Adaptador `VsixPackageStore`:
  - Extracción a `<root>/.staging/<id>-<version>-<ts>-<rand>` con guard
    zip-slip que ahora **rechaza** el paquete (antes se omitían entradas en
    silencio).
  - Límites configurables: número de entradas (20 000), tamaño por archivo
    (128 MB) y tamaño total (512 MB).
  - sha256 del VSIX calculado en staging y persistido en el registro
    (`InstalledExtensionRecord.sha256`) como base de provenance.
  - `commit` instala en directorios versionados `<root>/<id>/<version>` con
    rename atómico; una reinstalación de la misma versión aparca el directorio
    anterior y lo restaura si el rename falla.
- Caso de uso `InstallExtensionFromVsix` (application, sin Electron):
  orquesta stage → política de engines → commit → registry → prune, con
  staging garantizadamente descartado en cualquier fallo.
- Errores discriminados `ExtensionInstallError` con código por etapa:
  `missing-manifest`, `invalid-manifest`, `unsafe-path`,
  `entry-limit-exceeded`, `file-too-large`, `package-too-large`,
  `incompatible-engine`, `commit-failed`.
- Los issues de manifest pasaron de warning a **rechazo** en la ruta de
  instalación (el rollback ahora es seguro): `missing-field` de
  name/publisher/version e `invalid-field-type` rechazan el paquete.
- Validación de `engines.vscode` (`domain/vscode-engine.ts`): política sin
  dependencias que entiende `*`, `^A.B.C`, `>=A.B.C` y `A.B.x` contra la API
  emulada (`FORGE_VSCODE_API_VERSION = 1.85.0`). `incompatible` rechaza;
  rangos no reconocidos instalan con warning.
- `NormalizedExtensionManifest.enginesVscode` normalizado por el reader y
  decodificado por el registry.
- Escritura atómica de `forge-config.json` (tmp + rename) para que un corte a
  mitad de escritura no trunque el registro.
- `uninstallExtension` elimina el directorio completo del id (cubre layout
  versionado y legacy plano).

Pruebas añadidas (`tests/extensions/package-store.test.cjs`):

- Instalación en directorio versionado con sha256 y registry actualizado.
- Upgrade que reapunta el registry y poda la versión anterior.
- Paquete rechazado (manifest inválido) deja versión activa, registry y
  staging intactos — criterio de salida del Milestone 1.
- Rechazo de zip-slip sin escribir fuera del almacén.
- Límites por archivo y totales.
- Rechazo por `engines.vscode` incompatible; warning con rango no reconocido;
  tolerancia a manifiestos sin engines.
- Tabla de casos de la política de engines.
- Helper de ZIP compartido extraído a `tests/extensions/helpers/stored-zip.cjs`.

## Decisiones del incremento 1.0

- `engines.vscode` ausente instala con tolerancia legacy: los VSIX
  hand-built lo omiten con frecuencia y el issue sigue reportándose por
  `readWithDiagnostics`. El resto de issues ya rechaza.
- La política semver es deliberadamente parcial (`*`, `^`, `>=`, exacto, `x`);
  rangos compuestos (`||`, `<`) devuelven `unknown` e instalan con warning en
  lugar de arriesgar un falso rechazo.
- Si el registry fallara después de `commit`, el registro anterior sigue
  apuntando a la versión antigua (que `prune` aún no tocó): la instalación
  queda huérfana pero el editor no se corrompe. La limpieza de huérfanos
  llegará con el inventario del store.
- Las extensiones legacy instaladas en `<root>/<id>` (sin versión) siguen
  funcionando: los readers usan `entry.dir` y el uninstall resuelve el
  segmento superior.

## Incremento 1.1 — enable/disable y pruebas de corte en commit

Completado:

- `InstalledExtensionRecord.enabled`: las extensiones deshabilitadas quedan
  instaladas pero no contribuyen nada. El decoder trata los registros previos
  al flag como habilitados (`raw.enabled !== false`).
- Los upgrades preservan la elección del usuario: `InstallExtensionFromVsix`
  consulta el registro previo antes de escribir el nuevo record.
- Facade `setExtensionEnabled` + canal IPC `ext:setEnabled` tipado en
  main/preload/renderer; el payload expone `enabled`.
- Renderer honra el flag de punta a punta: `applyExtensions` filtra
  deshabilitadas antes de registrar themes/snippets/languages en Monaco (los
  providers anteriores se descartan al re-registrar), `findIconTheme` las
  ignora, y `refreshExtensions` hace fallback de tema cuando el activo venía
  de una extensión deshabilitada.
- UI: botón de toggle (Power) por extensión instalada, badge "Disabled" y
  exclusión de los selectores de color/icon theme.
- Rollback del commit endurecido: un fallo en el promote de una instalación
  fresca ya no deja el directorio del id vacío en el almacén.

Pruebas añadidas (36 en total en la suite):

- Corte simulado en el promote (monkeypatch de `fs.renameSync`):
  - Reinstalación de la misma versión: el directorio aparcado se restaura con
    su contenido original y el registry no cambia.
  - Instalación fresca: no queda directorio parcial ni entrada de registry.
- `enabled` por defecto en instalaciones nuevas, preservado en upgrades y
  decodificado como `true` en registros legacy.

### Decisiones del incremento 1.1

- Deshabilitar no descarga contribuciones del proceso main (siguen en el
  payload de `ext:list`); es el renderer quien no las aplica. Así la UI puede
  seguir mostrando qué contribuiría la extensión al reactivarla.
- Monaco no permite retirar un theme definido (`defineTheme` no tiene
  inverso); deshabilitar hace fallback a `forge-dark` vía la validación de
  `refreshExtensions`, y el theme huérfano queda inerte hasta el reload.
- El corte simulado cubre el promote (la etapa con efectos); la escritura del
  registry ya es atómica (tmp + rename) y `stage` es libre de efectos sobre el
  almacén activo por construcción.

## Incremento 1.2 — rollback, dependencias y catálogo como puerto

Completado:

- **Retención de la versión anterior**: un upgrade guarda
  `previousVersion { version, sha256 }` en el record y `prune` conserva
  exactamente dos directorios (actual + anterior); una tercera instalación
  poda la más antigua.
- **Rollback explícito** (`RollbackExtension`): reapunta el registry al
  directorio retenido releyendo su `package.json` con el `ManifestReader`
  (lectura de disco inyectada). Ambas versiones permanecen en disco, así que
  un rollback puede deshacerse — los roles simplemente se intercambian. El
  estado enabled sobrevive al cambio. Sin versión retenida el error es
  discriminado (`rollback-unavailable`).
- **Catálogo como puerto**: `ExtensionCatalog.downloadLatestVsix(id)` con
  adaptador `OpenVsxCatalog` (fetch inyectable — Electron pasa `net.fetch`,
  las pruebas un fake; el temp dir también se inyecta). La facade
  `installFromOpenVsx` quedó reducida a una línea sobre el use case.
- **Dependencias**: el manifest normaliza `extensionDependencies` y
  `extensionPack` (ids validados y deduplicados). `InstallExtensionById`
  resuelve el grafo: las dependencias requeridas abortan la instalación si
  fallan (`dependency-failed`); las del pack instalan best-effort con
  warning. El set de visitados garantiza que los ciclos terminan (cada id se
  intenta una sola vez) y un tope de 32 extensiones acota grafos patológicos.
- Superficie completa: `previousVersion` en el payload y en
  `InstalledExtension`, canal IPC `ext:rollback`, acción del slice y botón de
  rollback (History) en el panel cuando existe versión retenida.
- Nuevos códigos discriminados: `rollback-unavailable`, `not-found`,
  `download-failed`, `dependency-failed`.

Pruebas añadidas (40 en total):

- Upgrade retiene la versión anterior con provenance; la tercera instalación
  poda la más antigua.
- Rollback: swap, doble rollback (deshacer), preservación de enabled y error
  discriminado sin versión retenida.
- Dependencias con catálogo fake: resolución transitiva descargando cada id
  una sola vez, ciclo A↔B que termina, dependencia requerida ausente que
  aborta y pack ausente que sólo advierte; limpieza de todos los VSIX
  temporales.

### Decisiones del incremento 1.2

- La retención es de exactamente una versión anterior: suficiente para
  deshacer el último update sin convertir el almacén en un historial
  ilimitado.
- El rollback relee el manifest desde el directorio retenido en lugar de
  persistir un snapshot del record anterior: el disco es la fuente de verdad
  y evita divergencias entre registry y almacén.
- Si una dependencia requerida falla, la extensión raíz ya quedó instalada
  (el pipeline instala primero y resuelve después); el error discriminado lo
  hace visible. Alinear esto con VS Code (instalar deps primero) queda para
  cuando el grafo se resuelva por adelantado con metadatos del catálogo.
- `installOne` consulta el registry antes de descargar: las dependencias ya
  instaladas no se re-descargan ni se actualizan implícitamente.

## Incremento 1.3 — updates, grafo por adelantado e inventario del almacén

Completado (cierra el Milestone 1):

- **Grafo de dependencias por adelantado**: el puerto `ExtensionCatalog` ganó
  `latestMetadata(id)` (versión + `dependencies`/`bundledExtensions` de Open
  VSX sin descargar el paquete). `InstallExtensionById` ahora trabaja en dos
  fases: resuelve el plan completo (post-orden: cada dependencia precede a su
  dependiente; ciclos terminados por el set de visitados; tope de 32) y luego
  instala en ese orden. **Una dependencia requerida que falla aborta antes de
  instalar la extensión pedida**, alineado con VS Code. Red de seguridad: las
  deps del manifest que el metadata del catálogo no reportó se resuelven tras
  el commit y saltan al frente de la cola.
- **Update explícito por extensión**: use case `CheckExtensionUpdates`
  (compara cada registro contra `latestMetadata`; un catálogo caído advierte
  por extensión en lugar de fallar el check completo) sobre un comparador
  semver-ish tolerante (`domain/extension-version.ts`, con prereleases). IPC
  `ext:checkUpdates` tipado, estado `extensionUpdates` en el slice y botón de
  update en el panel (el update reutiliza la instalación por id: la raíz
  siempre se re-descarga, y la retención del 1.2 permite deshacerlo con
  rollback).
- **Inventario del almacén** (`sweep`): al arrancar, el package store elimina
  staging abandonado, ids sin entrada de registry (huérfanos de un fallo
  post-commit) y directorios de versión no referenciados, conservando la
  versión activa, la retenida para rollback y las instalaciones legacy
  planas (que poseen su directorio completo de id).
- La UI retiró la excepción que mapeaba `anthropic.claude-code` y
  `openai.chatgpt` a agentes de terminal en el panel de extensiones: ambos
  siguen disponibles como agentes CLI (AgentsPanel/ActivityBar) y en el
  marketplace se comportan como cualquier extensión instalable, preparándolos
  para funcionar como extensiones independientes cuando exista el Extension
  Host.

Pruebas añadidas (43 en total):

- El orden de descarga observado es deps → dependientes (c, b, a).
- Una dependencia requerida ausente aborta **sin instalar la raíz** y sin
  descargar nada (la resolución falla antes).
- Sweep: elimina huérfanos (id sin registry, versión extra, staging
  abandonado) y conserva activa, retenida y legacy plana.
- Check de updates: sólo versiones estrictamente más nuevas; catálogo caído
  advierte sin fallar.
- Tabla de ordering de versiones (numérico vs. lexicográfico, prereleases,
  segmentos ausentes).

### Decisiones del incremento 1.3

- El plan se resuelve con metadatos del catálogo; las deps declaradas sólo en
  el manifest descargado (metadata incompleto) se instalan tras el commit del
  paquete que las declara — la garantía "deps primero" es tan buena como el
  metadata del catálogo, que Open VSX deriva del propio manifest.
- Las dependencias ya instaladas no se re-descargan ni actualizan
  implícitamente; sólo la raíz se re-instala siempre (eso es el update).
- El sweep corre únicamente al arrancar, cuando no hay instalación en vuelo:
  todo lo que quede en `.staging` es basura por definición.
- El check de updates es explícito (al abrir el panel) y best-effort; el
  auto-update configurable queda para el Milestone 10.

## Próximo incremento

Milestone 1 completo. Empezar Milestone 2 (motor declarativo):

1. `ContributionRegistry` extensible con ownership/cleanup por extensión.
2. `configuration` y `configurationDefaults` con `ConfigurationService`
   (scopes default/user/workspace).
3. Después: `grammars` TextMate y `commands`/`keybindings` declarativos.

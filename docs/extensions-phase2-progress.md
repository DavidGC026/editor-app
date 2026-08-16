# Extensiones: progreso del Milestone 2 (motor declarativo)

Última actualización: 2026-07-18

Roadmap: [extensions-roadmap.md](./extensions-roadmap.md) · Milestone anterior:
[extensions-phase1-progress.md](./extensions-phase1-progress.md)

> Nota: `extensions-phase2-implementation.md` es una nota histórica de una
> etapa previa del proyecto; este documento es el registro vigente del
> Milestone 2 del roadmap.

## Incremento 2.0 — configuration y ConfigurationService

Completado:

- **Dominio**: `ExtensionSettingManifest` (key, type JSON-schema acotado,
  default, description, enum) en `domain/extension-manifest.ts`. El manifest
  normalizado ganó `configuration` (secciones aplanadas) y
  `configurationDefaults` (overrides para settings de *otras* extensiones).
- **Reader** (`VscodeManifestReader`): `contributes.configuration` acepta un
  objeto o un array de secciones; las `properties` se aplanan deduplicando
  por key (la primera declaración gana). `type` admite listas JSON-schema
  (se toma la primera), `markdownDescription` cae a `description` y los
  `enum` vacíos se normalizan a null.
- **Registry** (`JsonExtensionRegistry`): passthrough validado de ambos
  campos; los registros legacy decodifican a listas/objetos vacíos.
- **`ConfigurationService`** (application): resuelve cada setting con la
  precedencia de VS Code, de abajo hacia arriba: default de la extensión que
  lo declara < override de `configurationDefaults` de otra extensión
  habilitada (la última gana, como el load order de VS Code) < valor
  explícito del usuario. `inspectAll()` devuelve cada scope por separado
  (`defaultValue`/`overrideValue`/`userValue`/`effectiveValue` +
  `effectiveSource`) para que la UI pueda mostrar de dónde viene el valor.
  - Ownership: la primera extensión que declara una key es su dueña; una
    redeclaración por otra extensión se ignora con warning (ninguna key se
    re-posee en silencio).
  - Escrituras validadas contra el schema declarado (`matchesType` + enum)
    con error discriminado `ConfigurationValueError`. Las keys no declaradas
    se guardan tal cual, como hace VS Code con settings de extensiones aún
    no instaladas. `undefined` borra el valor de usuario.
  - Las extensiones deshabilitadas no aportan ni settings ni overrides.
- **Persistencia**: puerto `UserConfigurationStore` (mapa plano key→value).
  El adaptador en la facade lo guarda bajo `extensionSettings` en
  `forge-config.json` (escritura atómica ya existente), separado del
  registry para que los valores del usuario sobrevivan a un
  uninstall/reinstall de la extensión que los declara.
- **IPC/UI**: `ext:config:list` y `ext:config:set` tipados en
  main/preload/types; el payload de cada extensión incluye su
  `configuration`; el slice ganó `extensionConfiguration`,
  `refreshExtensionConfiguration` y `setExtensionSetting` (los settings se
  refrescan junto con `refreshExtensions` porque siguen al set de
  habilitadas). `ExtensionSettingsSection` (componente propio) edita los
  settings en la vista de detalle: checkbox para boolean, select para enum,
  input para el resto, con badge de procedencia y reset al default.
- **Analyzer**: `configuration` y `configurationDefaults` son ahora familias
  declarativas soportadas; al declararse inline en el manifest, lo que la
  normalización conserva es exactamente lo que sirve el
  ConfigurationService (loaded === declared).

Pruebas añadidas (`tests/extensions/configuration.test.cjs`, 51 en total):

- Aplanado de secciones, duplicados (primera gana), type-lists, enum,
  markdownDescription, objeto único sin array.
- Round-trip del decoder del registry y tolerancia a registros legacy.
- Precedencia completa de scopes y su colapso al retirar cada capa.
- Deshabilitadas fuera del cálculo; validación de tipo y enum al escribir;
  borrado con `undefined`; keys desconocidas sin validación; ownership con
  warning en redeclaraciones.

### Decisiones del incremento 2.0

- El scope workspace (`.forge/settings.json`) queda para un incremento
  posterior; el puerto `UserConfigurationStore` ya aísla la persistencia
  para añadirlo sin tocar el servicio.
- El servicio no emite eventos de cambio todavía: el renderer refresca tras
  cada escritura. El `ContributionRegistry` con ownership/cleanup y la
  notificación push llegarán cuando haya un consumidor real (context keys,
  `when` clauses).
- `configurationDefaults` se aplica aunque la key no esté declarada por
  ninguna extensión instalada (VS Code hace lo mismo con settings del core);
  hoy esas keys no aparecen en `inspectAll()` porque no tienen dueño.

## Incremento 2.1 — ContributionRegistry con ownership y cleanup

Completado:

- **`ContributionRegistry`** (`src/extensions/contributionRegistry.ts`):
  clase genérica, agnóstica del host y sin dependencias. Cada contribución
  aplicada pertenece a la extensión que la declaró; `sync(host, activas)`
  reconcilia por diff — las extensiones que salen del set activo
  (deshabilitadas, desinstaladas) retiran sus disposables, las que cambian
  de versión (update, rollback) se retiran y re-aplican, y las que no
  cambiaron **no se tocan**. Antes, cualquier cambio re-registraba el set
  completo de todas las extensiones.
- **Appliers por familia** (open/closed: una familia nueva es un applier
  nuevo, no una edición del sync):
  - `themes`: aplica `defineTheme` y devuelve cero disposables — Monaco no
    tiene `undefineTheme`; un theme retirado queda definido pero inerte y el
    fallback de `refreshExtensions` deja de seleccionarlo (decisión ya
    documentada en el incremento 1.1).
  - `snippets`: los providers ahora se registran **por extensión** y
    lenguaje (antes se agrupaban entre extensiones en un provider por
    lenguaje, sin dueño). Monaco fusiona sugerencias de varios providers del
    mismo lenguaje, así que el comportamiento visible no cambia.
  - `languages`: `monaco.languages.register` no tiene inverso (el id queda
    registrado), pero los disposables de `setLanguageConfiguration` son por
    extensión.
- Aislamiento de fallos: un applier que lanza sobre una extensión advierte y
  no bloquea ni al resto de familias ni al resto de extensiones; un dispose
  que lanza advierte y aun así olvida la extensión (puede volver limpia).
- `attachMonaco` hace `reset()` cuando cambia la instancia de Monaco: los
  disposables del host anterior no significan nada en el nuevo y el set
  pendiente se re-aplica desde cero.
- El registry es TypeScript borrable a propósito (sin parameter properties):
  la suite lo ejecuta sin bundler vía type stripping de Node.

Pruebas añadidas (`tests/extensions/contribution-registry.test.cjs`, 57 en
total): sync incremental sin tocar lo no cambiado, retiro exacto al salir
del set, retire+re-apply en cambio de versión, applier que falla aislado
por familia y extensión, dispose que falla sin dejar estado fantasma, y
reset para un host nuevo.

### Decisiones del incremento 2.1

- El fingerprint de cambio es la versión de la extensión: updates y
  rollbacks cambian versión, y enable/disable se modela como presencia en
  el set activo. Una reinstalación de la misma versión con contenido
  distinto no re-aplica (caso marginal; el sha256 no viaja en el payload
  hoy).
- Los icon themes no pasan por el registry: son un resolver puro
  (`iconTheme.ts`) sin registros con estado que retirar.
- El registry vive en el renderer porque las contribuciones activables hoy
  son de Monaco; cuando el proceso main tenga contribuciones propias
  (commands, keybindings) la misma clase genérica puede instanciarse allí.

## Incremento 2.2 — scope workspace y eventos de configuración

Completado (2026-07-18):

- **Scope workspace en `ConfigurationService`**: la precedencia ahora es
  default < `configurationDefaults` de otra extensión < user < **workspace**,
  igual que VS Code. `inspectAll()` expone `workspaceValue` y el nuevo
  `effectiveSource: 'workspace'`; el valor de usuario nunca se pierde —
  al cerrar el workspace vuelve a ser el efectivo.
- **Puerto generalizado**: `UserConfigurationStore` pasó a ser el alias del
  nuevo `ConfigurationScopeStore` (`read()`/`write(values)`); el servicio
  recibe el workspace como *provider* (`workspaceStore?: () =>
  ConfigurationScopeStore | null`) para seguir al workspace abierto sin
  reconstruir el servicio (DIP: el servicio no sabe de rutas ni archivos).
- **Escrituras por scope**: `setValue(key, value, scope)` con
  `scope: 'user' | 'workspace'`; `setUserValue` queda como wrapper. La
  validación de tipo/enum aplica a todos los scopes; escribir en workspace
  sin workspace abierto es `ConfigurationValueError`. `undefined` borra la
  key del scope indicado.
- **`onDidChange`**: cada escritura exitosa notifica a los suscriptores con
  la key cambiada; las escrituras fallidas no notifican; los listeners que
  lanzan quedan aislados y el unsubscribe es idempotente.
- **Adaptador `ForgeWorkspaceSettingsStore`** (infrastructure): persiste en
  `<workspace>/.forge/settings.json`. Lectura tolerante (archivo ausente →
  `{}` sin warning; JSON corrupto o raíz no-objeto → `{}` con warning) y
  escritura atómica tmp+rename con mkdir recursivo.
- **Facade/main**: `configureExtensionWorkspace(provider)` conecta el
  workspace actual; en `main.ts` el provider devuelve null para workspaces
  remotos (SSH) — allí `.forge/settings.json` no es accesible por fs local,
  así que el scope workspace se desactiva en vez de escribir en el lugar
  equivocado. Al cambiar de workspace (`fs:watch`) se emite un broadcast
  `'*'` para que el renderer recargue la configuración completa.
- **Eventos hacia el renderer**: `onExtensionConfigurationChanged` en la
  facade → canal `ext:config:changed` (webContents.send a todas las
  ventanas) → `ext.onConfigurationChanged(cb)` en preload (devuelve
  `{ dispose }`). `App.tsx` se suscribe y refresca
  `extensionConfiguration`, de modo que cualquier ventana/vista ve los
  cambios sin depender de su propio ciclo de escritura.
- **UI**: `ExtensionSettingsSection` edita el scope que provee el valor
  efectivo (workspace si el workspace ya lo sobreescribe, user en el resto
  de casos), con reset contextual ("Clear workspace value" vs "Reset to
  default") y badge de procedencia «Set in this workspace
  (.forge/settings.json)».

Pruebas añadidas (`tests/extensions/configuration.test.cjs`, 61 en total):
workspace por encima de user y colapso al cerrar el workspace; escrituras
por scope con validación y error sin workspace abierto; notificaciones de
`onDidChange` (éxito sí, fallo no, unsubscribe); y el adaptador de
`.forge/settings.json` (ausente/corrupto/raíz inválida → `{}`, escritura
atómica verificada sobre disco real).

### Decisiones del incremento 2.2

- La UI edita **un** scope por interacción (el que ya es efectivo) en vez
  de exponer un selector user/workspace por setting: menos superficie, y el
  comportamiento coincide con la intuición de "cambio lo que estoy viendo".
  Un selector explícito puede añadirse después sin tocar el servicio.
- El evento notifica solo la **key** (o `'*'` en cambio de workspace), no el
  valor: el renderer siempre relee `inspectAll()` vía IPC, así hay una sola
  fuente de verdad y ningún riesgo de payloads desincronizados.
- Workspaces remotos quedan sin scope workspace por ahora; cuando el canal
  SFTP soporte lectura/escritura de `.forge/settings.json`, bastará otro
  `ConfigurationScopeStore` sin cambios en el servicio.
- `.forge/settings.json` guarda el mapa plano key→value tal cual (sin
  envoltorio), para que sea diffeable y editable a mano como el
  `.vscode/settings.json` de VS Code.

## Incremento 2.3 — commands/keybindings declarativos + ContextKeyService

Completado (2026-07-18):

- **Dominio/reader/registry**: `ExtensionCommandManifest` (command, title,
  category, `enablement`) y `ExtensionKeybindingManifest` (command, key,
  mac/linux/win, `when`). El reader acepta títulos nls (`{ value }`), usa el
  id como título de respaldo, deduplica por command (primera gana), admite
  `keybindings` como objeto único o array, y descarta las entradas de
  *remoción* (`-command`, que en VS Code quitan un binding por defecto que
  Forge no tiene). Decoder del registry con passthrough y tolerancia legacy.
- **`whenClause.ts`** (renderer, puro): parser del subset de cláusulas
  `when` de VS Code — keys, `!`, `&&`, `||`, `==`, `!=`, paréntesis y
  literales string/número/boolean, con la precedencia de VS Code
  (`!` > `==` > `&&` > `||`). La igualdad es tolerante (`count == '3'`
  matchea 3). Una cláusula malformada parsea a `null`, nunca lanza.
- **`ContextKeyService`** (`contextKeys.ts`): registro de context keys con
  `set` (undefined borra, no-op si no cambia), `onDidChange` y `match` con
  caché de parseo; una cláusula malformada advierte una sola vez y nunca
  matchea; una key desconocida es falsy — el default seguro. App.tsx
  publica las keys iniciales: `workspaceOpen`, `editorIsOpen`,
  `editorLangId`, `sidebarVisible`, `panelVisible`,
  `gitOpenRepositoryCount`, espejadas del store en vivo.
- **`ExtensionCommandService`** (`commands.ts`): mapa id→handler con
  `registerHandler` (el último gana, dispose sólo retira el handler
  vigente) y `execute` con fallos aislados. Los `contributes.commands`
  declarativos sólo traen metadata: sin Extension Host no hay handlers, y
  ejecutar uno es un no-op **bien reportado** (warning con el motivo).
- **`KeybindingService`**: resuelve el chord de la plataforma
  (mac/linux/win con fallback a `key`), parsea chords de un solo golpe
  (`ctrl+shift+p`; los multi-golpe `ctrl+k ctrl+s` advierten y se omiten) y
  despacha eventos de teclado: gana el binding registrado más reciente que
  matchea y cuya cláusula `when` se cumple. **Sólo consume el evento si un
  handler corrió de verdad** — un binding sin handler jamás se traga la
  pulsación del usuario.
- **Ownership**: los keybindings se registran vía un applier en un
  `ContributionRegistry` de *workbench* separado del de Monaco, que se
  sincroniza en cada `applyExtensions()` aunque no haya editor montado;
  deshabilitar/desinstalar una extensión retira exactamente sus bindings.
- **Integración**: la paleta lista los comandos de extensiones habilitadas
  (con `enablement` evaluado contra el ContextKeyService) bajo la categoría
  Extensions, buscables también por id; App.tsx despacha los keybindings de
  extensiones **después** de todos los atajos nativos, así una VSIX nunca
  puede sombrear un atajo de Forge. El analyzer suma `commands` y
  `keybindings` como familias declarativas soportadas.

Pruebas añadidas (`tests/extensions/commands-keybindings.test.cjs`, 74 en
total): normalización del reader (nls, duplicados, remociones, formas
objeto/array), round-trip del decoder, precedencia y tolerancia del parser
`when`, caché/notificación del ContextKeyService, ejecución con y sin
handler, parseo de chords y selección por plataforma, gating por `when`,
no-consumo sin handler, prioridad del binding más reciente y cleanup por
dispose.

### Decisiones del incremento 2.3

- Los atajos nativos de Forge siempre ganan: el despacho de extensiones va
  al final del handler global. Cuando exista un keybinding editor propio se
  podrá invertir por-binding, no globalmente.
- El matching de teclas usa `KeyboardEvent.key` normalizado a minúsculas
  (no `code`): suficiente para chords con modificadores; combos que
  dependen de la disposición del teclado pueden variar, igual que en el
  resto de atajos de Forge.
- Chords de un solo golpe por ahora; los multi-golpe requieren un estado de
  "chord pendiente" con timeout que llegará con el keybinding editor.
- Los comandos sin handler se listan igualmente en la paleta (como hace VS
  Code): dan visibilidad de lo que la extensión ofrece y quedarán vivos en
  cuanto el Extension Host (Milestone 3) registre handlers reales.
- `whenClause.ts`, `contextKeys.ts` y `commands.ts` son TypeScript borrable
  (sin parameter properties; imports relativos con extensión `.ts`) para
  ejecutarse sin bundler bajo el type stripping de Node en la suite.

## Incremento 2.4 — grammars TextMate con Oniguruma/WASM

Completado (2026-07-18):

- **Dependencias**: `vscode-textmate` (compilador/tokenizador de gramáticas,
  el mismo que usa VS Code) y `vscode-oniguruma` (motor de regex Oniguruma
  compilado a WASM). Se eligió sobre alternativas (shiki, monaco-textmate)
  por ser los paquetes canónicos, mantenidos por Microsoft y sin capas
  intermedias.
- **Dominio/reader/registry**: `ExtensionGrammarManifest` (language
  opcional — las gramáticas de inyección/embebidas no mapean a un lenguaje,
  scopeName, path, `embeddedLanguages`, `injectTo`). El reader exige
  scopeName y path; el decoder del registry hace round-trip con tolerancia
  legacy.
- **`FileGrammarContributionReader`** (infrastructure): envía al renderer
  el **contenido crudo** del archivo de gramática (JSON o plist XML) sin
  parsearlo — `parseRawGrammar` de vscode-textmate distingue el formato por
  el nombre de archivo y vive junto al tokenizador; main sólo garantiza
  lectura y confinamiento (`resolveExtensionPath` rechaza traversal).
  Archivos ilegibles se omiten con warning (familia `grammars` cuenta como
  `contribution-load-failed` en el analyzer).
- **`TextmateGrammarService`** (`src/extensions/textmate.ts`): registra
  fuentes por scopeName (primera declaración gana, como el resto de
  ownership del proyecto), mapea language→scope, compila bajo demanda con
  un `Registry` de vscode-textmate y expone providers compatibles con
  `monaco.languages.setTokensProvider`. El motor Oniguruma se **inyecta**
  (`createOnigLib`): la app cablea el WASM empaquetado por vite y la suite
  los bytes de node_modules — el módulo queda libre de imports de bundler
  y es TS borrable como sus hermanos.
  - Cada token lleva el scope TextMate **más profundo**, que es el que las
    reglas de tema de Monaco matchean por prefijo con mayor especificidad.
  - El estado del tokenizador (StateStack) viaja entre líneas: los bloques
    multi-línea (comentarios, strings) colorean correctamente.
  - `dispose` de una fuente invalida el Registry compilado: una gramática
    retirada (uninstall/disable/update) no se sirve nunca más desde caché.
  - `getInjections` sirve `injectTo`: una gramática de inyección extiende
    los scopes de su objetivo.
- **Applier `grammars`** en el ContributionRegistry de Monaco: registra las
  fuentes y crea el tokens provider por lenguaje de forma asíncrona — si el
  applier se retira antes de que compile, el registro se cancela; si
  compila, el disposable de Monaco queda amarrado a la extensión dueña. El
  applier de `languages` corre antes en la misma pasada, así el lenguaje ya
  existe en Monaco cuando llega su gramática.
- **Empaquetado**: `assetsInlineLimit` en vite.config.ts inlinea `.wasm`
  como data URL — la app empaquetada carga `index.html` por `file://`,
  donde un fetch de asset relativo falla. El import es lazy: el WASM sólo
  se paga cuando una extensión con gramáticas se activa.
- **Analyzer/payloads**: `grammars` es familia declarativa soportada;
  `InstalledExtensionPayload.grammars` viaja con el resto del payload.

Pruebas añadidas (`tests/extensions/grammars.test.cjs`): normalización y
round-trip; reader que omite archivos ilegibles; y contra el **motor real**
(WASM de node_modules): cinco lenguajes fixture tokenizan con sus propios
scopes (criterio de salida del milestone), gramáticas plist parsean,
estado multi-línea, ownership con dispose exacto e inyecciones.

### Decisiones del incremento 2.4

- El contenido de la gramática viaja crudo por IPC en el payload de la
  extensión (como themes/snippets): mantiene el parseo en un solo sitio
  (vscode-textmate) y evita duplicar la lógica JSON/plist en main.
- Tokens provider "coarse" (`setTokensProvider` con scopes string) en vez
  de `setTokensProviderFactory`/binary tokens: suficiente para coloreado
  temático y mucho más simple; optimizable después sin cambiar el servicio.
- Las gramáticas ganan a los tokenizadores monarch built-in de Monaco para
  el mismo language id (semántica de `setTokensProvider`): es exactamente
  lo que se quiere de un language pack real.
- `embeddedLanguages` se normaliza y viaja, pero el coloreado embebido usa
  el scope TextMate del token (no re-mapea a otro lenguaje Monaco); el
  remapeo fino puede llegar con los binary tokens.

## Incremento 2.5 — menus declarativos (explorer/context)

Completado (2026-07-18):

- **Dominio/reader/registry**: `ExtensionMenuItemManifest` — el record
  `contributes.menus` (menu id → items) se aplana a una lista con el menu
  id incorporado. Entradas sin `command` (referencias a submenús) se omiten
  hasta que lleguen los submenus; `when` y `group` viajan tal cual. Decoder
  con round-trip y tolerancia legacy; `menus` es familia declarativa
  soportada en el analyzer.
- **`menus.ts`** (renderer, funciones puras): `buildMenuItems(extensions,
  menuId)` resuelve los items de las extensiones habilitadas con títulos
  buscados **entre todas** las habilitadas (un item puede referenciar un
  comando declarado por otra extensión; sin título se muestra el id), y los
  ordena con la semántica de grupos de VS Code: `navigation` primero,
  grupos alfabéticos, sufijo `@N` numérico dentro del grupo, y empates en
  orden de declaración (sort estable). `filterMenuItems(items, match)`
  decide visibilidad en el momento de abrir.
- **Overlay de context keys**: `ContextKeyService.match(expr, extras?)`
  acepta keys transitorias que se superponen sin mutar el estado
  compartido. `explorerResourceContext(node)` produce las keys de recurso
  que los autores de extensiones usan en VS Code: `resourceScheme`,
  `resourcePath`, `resourceFilename`, `resourceExtname` (un dotfile no es
  extensión), `explorerResourceIsFolder`.
- **Integración**: el `ContextMenu` del explorador añade una sección al
  final con los items de `explorer/context` cuyo `when` se cumple para el
  nodo clicado; ejecutar pasa por `extensionCommandService.execute(command,
  path)` — la ruta del recurso viaja como argumento, el contrato de VS Code
  para comandos del explorador. Sin handler (hasta el Extension Host) es el
  no-op reportado de siempre y el menú se cierra igual.

Pruebas añadidas (`tests/extensions/menus.test.cjs`, 89 en total):
aplanado del record con omisión de submenús, round-trip del decoder,
resolución de títulos entre extensiones y orden de grupos, extensiones
deshabilitadas sin items ni títulos, gating por nodo (`.html` vs carpeta),
keys de recurso (incluido el dotfile) y aislamiento del overlay.

### Decisiones del incremento 2.5

- **Sin estado registrado**: los items se derivan bajo demanda de los
  payloads instalados (como los comandos de la paleta), así que una
  extensión deshabilitada/desinstalada no puede dejar items huérfanos —
  el criterio de salida "sin registros huérfanos" se cumple por
  construcción, sin necesitar appliers ni disposables para esta familia.
- Sólo `explorer/context` tiene superficie hoy; el resto de menu ids se
  normalizan y persisten (aparecerán cuando su superficie exista —
  `editor/context` requiere integrar acciones de Monaco).
- La visibilidad se evalúa al abrir el menú, no al sincronizar: las
  cláusulas de recurso (`resourceExtname == '.html'`) dependen del nodo
  clicado y no tienen sentido precomputadas.

## Próximo incremento

1. `editor/context` mapeando los items al menú contextual de Monaco
   (`monaco.editor.addAction` con ownership), o superficie de
   keybindings/comandos en la vista de detalle de la extensión.
2. Con el motor declarativo del Milestone 2 esencialmente completo,
   evaluar arrancar el Milestone 3 (kernel del Node Extension Host) — los
   comandos, menús y keybindings ya ejecutan por el
   `ExtensionCommandService`, que es el punto donde el host registrará
   handlers reales.

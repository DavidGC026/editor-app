# Registro de Refactorización (Refactoring Log)

Este documento mantiene un registro de los esfuerzos de modularización y refactorización aplicados al proyecto para evitar código espagueti.

## Cambios Realizados

### 1. Refactorización de `SideBar.tsx`
Se extrajo la lógica pesada de los paneles de la barra lateral hacia componentes independientes dentro de `src/components/Sidebar/`:
- **`SearchPanel.tsx`**: Funcionalidad de búsqueda en todo el proyecto.
- **`AgentsPanel.tsx`**: Integración con agentes IA.
- **`RunDebugPanel.tsx`**: Gestión de comandos de terminal, scripts de NPM y depuración.
- **`SourceControlPanel.tsx`**: Funcionalidad completa de Git, visualización de cambios y modal de GitHub OAuth.
- **`ExplorerPanel.tsx`**: Árbol de archivos, menús contextuales, arrastrar y soltar, sub-secciones Outline y Timeline.
- **`gitHelpers.ts`** (en `src/utils/`): Se extrajeron funciones repetidas de Git (`gitStatusLabel`, `isStaged`, etc.) para uso compartido.

> **Resultado:** `SideBar.tsx` se redujo de ~2,600 líneas a apenas 106 líneas, siendo responsable únicamente de la orquestación y renderizado condicional de sus paneles.

### 2. Refactorización de `store.ts` (En Progreso)
El archivo principal de estado global (`store.ts`) creció desmesuradamente a ~2,600 líneas. Se ha comenzado a dividir usando el patrón "Slices" de Zustand en la carpeta `src/store/slices/`.

- **`layoutSlice.ts`**: Creado. Maneja todo el estado visual de la interfaz (visibilidad del sidebar, anchos de paneles, panel activo, persistencia de preferencias de layout, etc.).

## Próximos Pasos (To-Do)
- [ ] Extraer `editorSlice.ts` (Manejo de archivos abiertos, pestañas, guardado, fuente, etc.).
- [x] Extraer `gitSlice.ts` (Ramas, cambios en staging, árbol de commits).
- [x] Extraer `terminalSlice.ts` (Manejo de PTY, sesiones de terminales nativas y de agentes).
- [ ] Extraer `aiSlice.ts` (Mensajes de chat, configuración de proveedores, status del modelo).
- [x] Extraer `extensionSlice.ts` (Extensiones instaladas, tema activo, búsqueda/instalación desde Open VSX).
- [ ] Construir un pequeño `store/index.ts` unificado usando el combinador de slices de Zustand.

## Progreso Reciente
- **Plataforma de extensiones**: Se documentó la arquitectura objetivo SOLID,
  roadmap por milestones, contrato de compatibilidad y gates de seguridad/pruebas
  para evolucionar desde contribuciones declarativas hacia hosts Node, Web y remoto.
- **Extensiones Milestone 0.1**: Se extrajeron contratos de manifiesto, el puerto
  `ManifestReader`, su adaptador VS Code y fixtures/pruebas de caracterización
  JSONC/VSIX sin añadir dependencias.
- **Extensiones Milestone 0.2**: Se extrajo `ExtensionRegistry` con adaptador JSON
  inyectable y migración legacy, se tiparon los DTO IPC de tienda y `ext:list`
  comenzó el handshake con `protocolVersion: 1`.
- **Extensiones Milestone 0.3**: Themes, snippets, languages e icon themes ahora
  usan readers segregados con resolución segura de recursos; un analyzer central
  calcula compatibilidad desde contribuciones cargadas realmente.
- **TerminalSlice**: Se ha extraído exitosamente `terminalSlice.ts`, moviendo el manejo de terminales nativas, PTY y agentes.
- **Persistencia de terminales**: El ciclo de vida de los PTY se separó de React mediante
  `TerminalSessionManager`. Cambiar pestañas o mover un agente entre docks ya no
  destruye su proceso; sólo cerrar o reiniciar una sesión lo termina.
- **GitSlice**: Se ha extraído exitosamente `gitSlice.ts`, moviendo todo el control de cambios de git.
- **Extensiones Milestone 0.4**: El analyzer entrega un `ExtensionCompatibilityReport`
  tipado (nivel + blockers) que la UI consume en lugar de heurísticas; se extrajo
  `extensionSlice.ts` del store monolítico y el manifest reader ganó un modo
  validante con errores discriminados (`readWithDiagnostics`), manteniendo el
  modo legacy hasta el package manager transaccional.
- **Extensiones Milestone 0.5**: El Explorer aplica el icon theme activo mediante
  un resolver puro (`src/extensions/iconTheme.ts`) con fallback a lucide; la
  selección se persiste y restaura vía IPC y `iconThemes` cuenta como
  contribución soportada en el compatibility report.
- **Extensiones Milestone 1.0**: Instalación de VSIX transaccional — staging con
  límites y guard zip-slip que rechaza, sha256 de provenance, commit atómico en
  directorios versionados `<id>/<version>`, errores discriminados
  (`ExtensionInstallError`), validación de `engines.vscode` y escritura atómica
  del registry. Una instalación fallida ya no puede corromper la versión activa.
- **Extensiones Milestone 1.1**: Enable/disable por extensión sin desinstalar
  (persistido, preservado en upgrades y honrado por Monaco, icon themes y la UI)
  y pruebas de corte simulado en el promote del commit con restauración del
  directorio aparcado.
- **Extensiones Milestone 1.2**: Rollback explícito con retención de la versión
  anterior (los directorios versionados intercambian roles), dependencias
  `extensionDependencies`/`extensionPack` resueltas con detección de ciclos, y
  el downloader de Open VSX extraído a un puerto `ExtensionCatalog` con fetch
  inyectable.
- **Extensiones Milestone 1.3 (Milestone 1 completo)**: El grafo de
  dependencias se resuelve por adelantado con metadatos del catálogo
  (`latestMetadata`) y las deps se instalan antes que la raíz — una dep
  requerida que falla aborta sin instalar nada de la extensión pedida.
  Update explícito por extensión (`CheckExtensionUpdates` + botón en el
  panel) y sweep de huérfanos del almacén al arrancar. Se retiró la
  excepción de UI que trataba Claude Code y Codex como agentes en el panel
  de extensiones: viven como agentes de terminal hasta que el Extension
  Host los soporte como extensiones independientes.
- **Extensiones Milestone 2.0**: `contributes.configuration` y
  `configurationDefaults` soportados de punta a punta — normalización con
  secciones aplanadas en el reader, `ConfigurationService` (application) con
  precedencia default < override de otra extensión < usuario, ownership con
  warning en redeclaraciones, validación de tipo/enum al escribir, puerto
  `UserConfigurationStore` persistido bajo `extensionSettings` en
  forge-config.json, IPC `ext:config:*` tipado y sección de settings
  editable en la vista de detalle (`ExtensionSettingsSection`).
- **Extensiones Milestone 2.1**: `ContributionRegistry` genérico
  (renderer) con ownership y cleanup por extensión — `sync` reconcilia por
  diff (aplicar nuevas, retirar salientes, re-aplicar cambios de versión)
  sin tocar las que no cambiaron. Themes, snippets y languages migrados a
  appliers por familia; los snippets pasaron a providers por extensión.
  Fallos de applier/dispose aislados con warning. Probado sin bundler vía
  type stripping de Node.
- **Extensiones Milestone 2.2**: scope workspace del `ConfigurationService`
  con precedencia default < override < user < workspace, puerto
  `ConfigurationScopeStore` con provider de workspace (null en remotos),
  adaptador `ForgeWorkspaceSettingsStore` (`.forge/settings.json`, lectura
  tolerante y escritura atómica), `setValue(key, value, scope)` validado y
  `onDidChange` → broadcast `ext:config:changed` a todas las ventanas
  (`'*'` al cambiar de workspace). La UI edita el scope efectivo con reset
  contextual y badge de procedencia.
- **Extensiones Milestone 2.3**: `contributes.commands` y
  `contributes.keybindings` declarativos de punta a punta — normalización y
  round-trip en main; en el renderer, parser puro de cláusulas `when`
  (`whenClause.ts`), `ContextKeyService` con caché y keys publicadas desde
  el store, `ExtensionCommandService` (handlers + no-op reportado sin
  Extension Host) y `KeybindingService` (chords por plataforma, gana el más
  reciente, sólo consume si un handler corrió). Ownership por extensión con
  un ContributionRegistry de workbench independiente de Monaco; paleta de
  comandos integrada y despacho tras los atajos nativos.
- **Extensiones Milestone 2.4**: `contributes.grammars` con TextMate real —
  vscode-textmate + vscode-oniguruma (WASM inline como data URL para
  file://), `FileGrammarContributionReader` que envía la fuente cruda
  (JSON/plist) al renderer, `TextmateGrammarService` con ownership por
  scopeName, compilación bajo demanda, invalidación de caché al retirar,
  inyecciones y estado multi-línea; applier `grammars` asíncrono amarrado
  al ContributionRegistry de Monaco. Probado contra el motor WASM real con
  cinco lenguajes fixture.
- **Extensiones Milestone 2.5**: `contributes.menus` declarativos — record
  aplanado en main, helpers puros en `menus.ts` (títulos resueltos entre
  extensiones, orden de grupos de VS Code con `navigation` primero y `@N`,
  empates estables), overlay de keys transitorias en
  `ContextKeyService.match` y `explorerResourceContext` con las keys de
  recurso de VS Code. El menú contextual del explorador muestra los items
  de `explorer/context` gateados por `when` para el nodo clicado y ejecuta
  con la ruta como argumento. Derivado de payloads: sin registros
  huérfanos por construcción.
- **Extensiones Milestone 2.6**: `editor/context` sobre Monaco —
  `EditorMenuService` registra los items como acciones globales
  (`monaco.editor.addEditorAction`) con ids namespaciados por dueño y
  traduce `group@order` a `contextMenuGroupId`/`contextMenuOrder`. Como
  Monaco no admite predicados de visibilidad, el conjunto registrado se
  reconcilia por diff ante cambios del set de extensiones y de context keys
  (coalescidos en microtask). `editorResourceContext` publica las keys
  `resource*` del tab activo y la ejecución pasa por el
  `ExtensionCommandService` con la ruta como argumento.

Actualmente `store.ts` ha delegado Layout, Terminal, Git, Remote y Extensiones a
slices específicos.

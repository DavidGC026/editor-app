# Contrato y matriz de compatibilidad de extensiones

Esta matriz es la fuente de verdad del estado funcional. “Instalada” no
significa “compatible”. Un capability sólo avanza de nivel cuando cumple la
Definition of Done de la arquitectura.

## Niveles

| Nivel | Significado |
| --- | --- |
| `unsupported` | Forge reconoce la necesidad, pero no ofrece implementación |
| `metadata` | El manifiesto se conserva y se muestra; no se activa |
| `declarative` | La contribución se interpreta sin ejecutar código |
| `partial` | Existe una parte útil de la API, con limitaciones conocidas |
| `compatible` | Casos representativos y suite contractual pasan |
| `degraded` | Normalmente compatible, pero limitada por host/workspace/plataforma |
| `blocked` | Política, seguridad, engine, API proposed o dependencia impiden activar |

La UI debe mostrar nivel, razones y evidencia; nunca reducirlo a un badge
genérico “Active”.

## Estado real al 2026-08-15

Actualizada al cierre del Milestone 2
([extensions-phase2-progress.md](./extensions-phase2-progress.md)).

| Área | Estado | Observaciones |
| --- | --- | --- |
| Open VSX search/detail | `partial` | Búsqueda, detalle y README; sin paginación rica ni selector de versiones |
| Instalación Open VSX | `compatible` | Transaccional con staging, hash y provenance; deps resueltas por adelantado |
| VSIX local | `partial` | Valida estructura y zip-slip; falta Workspace Trust (Milestone 3.0) |
| Uninstall | `partial` | Elimina paquete/registry con sweep de huérfanos; falta lifecycle del host |
| Update/rollback | `compatible` | Update por extensión y rollback a la versión previa conservada |
| Registry local | `compatible` | Puerto/adaptador tipado, escritura atómica y decoder tolerante con legacy |
| IPC de tienda | `partial` | Preload tipado, handshake list v1 y canales `ext:config:*`; envelope RPC general pendiente |
| Color themes | `partial` | Conversión aproximada TextMate → tokens Monaco; Monaco no permite retirar un tema |
| Snippets | `declarative` | Providers por extensión con ownership y cleanup |
| Languages | `declarative` | Registro y configuración con ownership; algunos campos sin cubrir |
| Icon themes | `metadata` | Se parsean y seleccionan en UI, pero no se aplican al explorer |
| Recursos declarativos | `partial` | Readers aislados y path traversal bloqueado; falta package validation completa |
| Analyzer | `partial` | Estado y familias soportadas por carga real; reporte rico de blockers pendiente |
| Grammars | `declarative` | TextMate real (vscode-textmate + oniguruma WASM) con estado multi-línea e inyecciones |
| Configuration | `declarative` | Scopes default < override < user < workspace, validación y settings UI |
| Commands | `declarative` | Metadata, paleta y `enablement`; sin handler hasta el Extension Host |
| Keybindings | `declarative` | Chords single-stroke por plataforma, gated por `when`, tras los atajos nativos |
| Menus | `declarative` | `explorer/context` y `editor/context` con `when` y grupos de VS Code |
| Context keys / `when` | `declarative` | Parser propio con la precedencia de VS Code y keys publicadas por el workbench |
| Extension `main` | `metadata` | No se ejecuta código Node — Milestone 3, ver [extensions-phase3-design.md](./extensions-phase3-design.md) |
| Extension `browser` | `metadata` | No existe Web Extension Host |
| Activation events | `metadata` | Se muestran, no se despachan |
| VS Code API | `unsupported` | No existe módulo `vscode` compatible |
| LSP/DAP/tasks/testing | `unsupported` | Forge tiene piezas nativas, aún sin bridge de extensiones |
| Views/webviews/notebooks | `unsupported` | Sin workbench contribution hosts |
| Remote extension host | `unsupported` | Remote SSH no ejecuta extensiones junto al workspace |
| Workspace Trust | `partial` | Trust por workspace y Restricted Mode con política de activación; falta la mitad runtime (el host aún no ejecuta nada) |
| Extension Host (kernel) | `partial` | `utilityProcess` con handshake, envelope RPC, heartbeat, backoff y circuit breaker; todavía no carga extensiones (3.2) |

## Matriz objetivo por contribution point

La lista oficial evoluciona; el analyzer conservará claves desconocidas y las
reportará. Prioridad inicial:

| Grupo | Contribution points | Fase |
| --- | --- | --- |
| Apariencia/lenguaje básico | themes, snippets, languages, grammars, iconThemes, productIconThemes, colors, icons | M2 |
| Configuración/contexto | configuration, configurationDefaults, commands, keybindings, menus | M2 |
| Validación/build | jsonValidation, problemPatterns, problemMatchers, breakpoints | M2/M7 |
| Workbench | views, viewsContainers, viewsWelcome, walkthroughs | M6 |
| Lenguaje runtime | semanticTokenScopes y providers vía API | M5 |
| Debug/tasks/tests | debuggers, taskDefinitions y APIs runtime | M7 |
| UI avanzada | customEditors, notebooks, notebookRenderer | M8 |
| Auth/SCM | authentication y APIs runtime | M6 |
| Chat/LM | chatAgents, languageModelTools/providers y relacionados | Posterior a M8; diseño separado |

Referencia completa: [Contribution Points](https://code.visualstudio.com/api/references/contribution-points).

## Matriz objetivo por namespace API

| Orden | API | Alcance inicial |
| --- | --- | --- |
| 1 | Primitivas | Disposable, EventEmitter, Uri, Position, Range, Selection, Cancellation |
| 2 | commands | register/execute/getCommands y activación on-demand |
| 3 | workspace | folders, documents, fs, configuration, edits, watchers, trust |
| 4 | window | editors, messages, output, progress, status, quick input |
| 5 | languages | diagnostics y providers de lenguaje |
| 6 | env/extensions | identidad, host, clipboard, URIs, extension inventory |
| 7 | tasks/debug/tests | workflows de ejecución y DAP |
| 8 | scm/authentication | providers con consentimiento y storage seguro |
| 9 | notebooks/webviews | superficies aisladas y mensajería |

La referencia contractual se derivará de `vscode.d.ts` para la versión de API
objetivo publicada por Forge. No se copiará de memoria:
[VS Code API](https://code.visualstudio.com/api/references/vscode-api).

## Compatibility report por extensión

El analyzer producirá como mínimo:

```ts
interface CompatibilityReport {
  extensionId: string;
  extensionVersion: string;
  targetApiVersion: string;
  engineSatisfied: boolean;
  selectedHost: 'node-local' | 'node-remote' | 'web' | null;
  level: 'metadata' | 'declarative' | 'partial' | 'compatible' | 'degraded' | 'blocked';
  supportedContributions: string[];
  unsupportedContributions: string[];
  observedApiCalls: string[];
  unsupportedApiCalls: string[];
  activationEvents: string[];
  blockers: { code: string; message: string }[];
  lastVerifiedAt: string | null;
}
```

El análisis estático del manifiesto es una predicción. La evidencia runtime y las
pruebas contractuales son las que permiten elevar una extensión a `compatible`.

## Corpus de compatibilidad

Se mantendrán dos grupos:

### Fixtures controlados

Extensiones mínimas dentro del repositorio, una por capability y caso de error.
Son deterministas y forman la suite obligatoria de CI.

### Extensiones públicas representativas

Un corpus fijado por ID y versión desde Open VSX para themes, grammars,
formatters, linters, language servers, tree views, tasks, debuggers, webviews y
web extensions. No se actualizará automáticamente en CI sin revisar cambios.

## Reglas para comunicar compatibilidad

- No mostrar “compatible” por reconocer `main` o `contributes`.
- No sustituir una extensión por un CLI y presentarla como la misma extensión.
- Las integraciones especiales de agentes se etiquetan como integración Forge,
  no como ejecución de la extensión VS Code.
- Toda limitación por remoto, virtual workspace, trust, SO o arquitectura debe
  aparecer antes de activar.
- APIs unknown/proposed se muestran por nombre cuando sea seguro hacerlo.

# Milestone 3 — Diseño del kernel del Extension Host

Documento de diseño previo a la implementación, en la línea de los
milestones anteriores: fija el runtime, el protocolo, el ciclo de
activación, el subconjunto de la API `vscode` y el modelo de fallos antes
de escribir código, para que los incrementos se puedan revisar contra algo.

Contexto: el Milestone 2 dejó el motor declarativo completo
([extensions-phase2-progress.md](./extensions-phase2-progress.md)). Todas
las superficies de usuario — paleta de comandos, keybindings,
`explorer/context`, `editor/context` — ya despachan por el
`ExtensionCommandService`, que hoy responde con un no-op reportado. Este
milestone pone código de extensión real detrás de ese punto y **de ningún
otro**: si el diseño obliga a tocar más superficies, es señal de que algo
se está colando fuera del seam.

## 1. Decisiones de arquitectura

### 1.1 Runtime: `utilityProcess` de Electron

El host corre en un `utilityProcess` (Electron ≥ 22), no en el proceso main
ni en el renderer.

- **Aislamiento real**: una extensión que lanza una excepción, entra en
  bucle o agota memoria se lleva por delante su propio proceso; main y
  renderer sobreviven. Es el criterio de salida "una extensión que lanza
  excepción no derriba Electron ni React".
- **Node completo sin DOM**: los entrypoints `main` de VS Code esperan
  `require`, `process` y el runtime de Node; el renderer con
  `contextIsolation` no puede ofrecerlos sin abrir agujeros.
- **Ciclo de vida gestionado**: Electron mata el proceso al cerrar la app,
  así que un host colgado no deja huérfanos como haría un `fork` mal
  supervisado.
- **Transporte**: `MessagePortMain` entre main y host. Es un canal
  dedicado, no el bus `ipcMain` compartido con el renderer, así que el
  tráfico del host no compite con el IPC de la UI ni puede suplantarlo.

Descartadas: `child_process.fork` (mismo aislamiento pero ciclo de vida y
transporte a mano, sin ventaja compensatoria) y un `Worker` en main (una
extensión bloqueante congelaría la ventana, que es justo lo que el
milestone debe impedir).

### 1.2 El renderer nunca habla con el host

`renderer → main → host` en las dos direcciones. El renderer sigue viendo
sólo canales `ext:*` tipados; main es el broker que valida, enruta y aplica
timeouts. Un canal directo renderer↔host duplicaría la validación y dejaría
la política de seguridad en dos sitios.

### 1.3 Una generación de host por sesión de extensiones

El conjunto de extensiones activas se materializa en una **generación** del
host. Reiniciar el host (manual, por crash o por cambio del conjunto que
requiera recarga) incrementa la generación; los mensajes de una generación
anterior se descartan por id, lo que evita que un `activate` tardío de un
host muerto registre handlers en el nuevo.

## 2. Topología

```text
┌──────────────┐   ext:* (ipcMain)   ┌──────────────┐   MessagePortMain   ┌──────────────┐
│   renderer   │ ──────────────────► │     main     │ ──────────────────► │ extension    │
│  (workbench) │ ◄────────────────── │   (broker)   │ ◄────────────────── │ host (node)  │
└──────────────┘                     └──────────────┘                     └──────────────┘
  ExtensionCommandService              HostManager                         bootstrap.ts
  ContextKeyService                    RpcBroker                           require('vscode')
  contribution registries              policy/timeouts                     ExtensionContext
```

Estructura de archivos prevista (extiende la ya fijada en
[extensions-architecture.md](./extensions-architecture.md) §7):

```text
electron/extensions/
  application/
    extension-host-service.ts      # casos de uso: start, activate, execute, restart
    ports/extension-host.ts        # puerto: lo que el workbench necesita del host
  infrastructure/hosts/
    utility-process-host.ts        # adaptador utilityProcess + MessagePort
    rpc-broker.ts                  # envelope, correlación, timeouts, backpressure
electron/extension-host/
  bootstrap.ts                     # entrypoint del utilityProcess
  lifecycle.ts                     # activate/deactivate, subscriptions
  module-loader.ts                 # interceptación de require('vscode')
  rpc/                             # cliente del envelope, del lado host
  vscode-api/                      # namespaces segregados
```

La separación domain/application/infrastructure se mantiene: el caso de uso
depende del **puerto** `ExtensionHost`, y `utility-process-host.ts` es un
adaptador reemplazable (un host remoto o un web worker implementarán el
mismo puerto, como anticipa la arquitectura §16).

## 3. Protocolo RPC

### 3.1 Envelope

Un único sobre versionado para las dos direcciones:

```ts
interface RpcEnvelope {
  v: 1;                    // versión de protocolo, negociada en el handshake
  gen: number;             // generación del host; los desfasados se descartan
  id: number;              // correlación; 0 en notificaciones
  kind: 'request' | 'response' | 'event' | 'error';
  method: string;          // 'lifecycle.activate', 'commands.execute', …
  extensionId?: string;    // dueño, cuando aplica
  payload: unknown;        // validado contra el schema del método
}
```

- **Correlación**: `id` monótono por emisor; una respuesta repite el `id`
  de su request. Las notificaciones (`event`) van con `id: 0`.
- **Errores tipados**: `kind: 'error'` con `{ code, message, data? }`.
  Códigos iniciales: `UNSUPPORTED_API`, `ACTIVATION_FAILED`, `TIMEOUT`,
  `CANCELLED`, `HOST_UNAVAILABLE`, `INVALID_PAYLOAD`. El stack sólo viaja
  al log local, nunca a la UI por defecto (arquitectura §10).
- **Validación en el borde**: main valida todo envelope entrante contra el
  schema del método antes de enrutarlo. Un payload inválido responde
  `INVALID_PAYLOAD` y se registra; no se reenvía.

### 3.2 Handshake

Al arrancar: main envía `lifecycle.initialize` con `{ protocol: 1,
apiVersion, extensions: [...], workspace, trust }`; el host responde
`{ protocol, nodeVersion, ready: true }`. Un desajuste de protocolo aborta
el arranque con `HOST_UNAVAILABLE` y lo reporta en la UI — nunca degrada en
silencio.

### 3.3 Familias de métodos (Milestone 3)

| Familia | Métodos | Dirección |
| --- | --- | --- |
| `lifecycle` | `initialize`, `activate`, `deactivate`, `shutdown`, `heartbeat` | main → host |
| `commands` | `register`, `unregister` | host → main |
| `commands` | `execute` | main → host |
| `configuration` | `get` | host → main |
| `window` | `showMessage` (info/warn/error) | host → main |
| `diagnostics` | `log`, `unsupportedApi`, `activationMetrics` | host → main |

El resto de familias (workspace, documentos, providers) es Milestone 4+;
hasta entonces sus llamadas producen `UNSUPPORTED_API`, no stubs
silenciosos (arquitectura §11).

### 3.4 Timeouts, cancelación y backpressure

- **Timeout por request**, configurable por familia: `activate` 10 s,
  `commands.execute` 5 s, `deactivate` 3 s. Al vencer se responde `TIMEOUT`
  al llamante y se marca la extensión como no responsiva; el host **no** se
  mata por un solo timeout (ver §6).
- **Cancelación**: `commands.execute` acepta un token; main envía
  `CANCELLED` y deja de esperar. La extensión puede ignorarlo — por eso el
  timeout es la garantía dura, no la cancelación.
- **Backpressure**: los `diagnostics.log` se agregan en ventanas de 100 ms
  y se recortan por extensión (N líneas/segundo); superado el límite se
  emite un único "log rate exceeded". Sin esto, una extensión con un
  `console.log` en bucle satura el broker y el disco.

## 4. Carga y `require('vscode')`

El bootstrap instala un hook en `Module._load` que intercepta `'vscode'` y
devuelve la facade construida **por extensión** (cada una recibe su propio
objeto: los disposables, el output channel y el storage cuelgan de su
identidad, no de un singleton compartido).

- El entrypoint se resuelve desde `main` del manifest, restringido al
  directorio instalado por la misma política de rutas que ya impide
  escapar del store (arquitectura §7, Milestone 0.3).
- `ExtensionContext` inicial: `subscriptions`, `extensionPath`,
  `extensionUri`, `globalState`/`workspaceState` (clave-valor persistido
  por extensión), `asAbsolutePath`, `extensionMode`. `secrets` llega con el
  storage cifrado, no antes.
- Una API no implementada **lanza `UnsupportedApiError`**, se registra vía
  `diagnostics.unsupportedApi` y alimenta el reporte de compatibilidad que
  la vista de detalle ya muestra. Un stub que devuelve `undefined`
  produciría fallos incomprensibles tres capas más abajo.

## 5. Activación

Estados y transiciones son los ya fijados en arquitectura §9. Lo que este
milestone concreta:

- **Eventos soportados**: `onStartupFinished`, `onCommand:<id>`,
  `onLanguage:<id>`, `workspaceContains:<glob>` y activación implícita por
  contribuciones modernas.
- **Índice de eventos**: se construye un índice evento → extensiones al
  sincronizar el conjunto activo. Disparar un comando no puede recorrer
  todas las extensiones instaladas (arquitectura §9).
- **`activate()` una vez por generación**: las activaciones concurrentes
  del mismo id comparten la misma promesa; un segundo `onCommand` mientras
  la primera activación está en vuelo espera, no re-activa.
- **Activación bajo demanda desde el seam existente**: cuando el
  `ExtensionCommandService` recibe un comando sin handler, en vez de
  reportar el no-op actual pedirá a main que active a quien declare
  `onCommand:<id>` y reintentará una vez. Ése es el único cambio de
  comportamiento visible en el renderer.
- **`deactivate()` con timeout**: vencido, se descartan las subscriptions
  y se fuerza el cierre del contexto; los disposables de contribuciones ya
  los gobierna el `ContributionRegistry` del renderer.

## 6. Modelo de fallos

| Fallo | Detección | Respuesta |
| --- | --- | --- |
| Excepción en `activate` | rechazo de la promesa | extensión → `failed`, resto del host intacto, error en la vista de detalle |
| Comando que lanza | rechazo de `commands.execute` | error tipado al llamante; la extensión sigue activa |
| Request colgada | timeout por familia | `TIMEOUT` al llamante, extensión marcada no responsiva |
| Host colgado | heartbeat cada 2 s, 3 fallos seguidos | matar y reiniciar el host (nueva generación), re-activar por evento |
| Host caído | `exit` del utilityProcess | reinicio automático con backoff |
| Crash loop | 3 reinicios en 60 s | circuit breaker: host detenido, banner "Extension Host disabled", opción de reiniciar a mano |
| Extensión culpable identificable | crashes correlacionados con una activación | se sugiere deshabilitarla; nunca se deshabilita sola sin avisar |

Comandos de usuario previstos: **Restart Extension Host** y **Start With
Extensions Disabled** (safe mode), ambos requisitos del gate de seguridad.

## 7. Seguridad

El gate de [extensions-security-and-testing.md](./extensions-security-and-testing.md)
§9 es explícito: no se ejecuta código de terceros hasta cumplirlo. Estado:

| Requisito del gate | Estado |
| --- | --- |
| Instalación transaccional | hecho (Milestone 1) |
| Enable/disable fuera del host | hecho (Milestone 1) |
| RPC schema/timeout/heartbeat | este milestone, incremento 3.1 |
| Crash isolation demostrado | este milestone, incremento 3.5 |
| Logs y reporte de activation failure | este milestone, incremento 3.4 |
| Safe Mode | este milestone, incremento 3.5 |
| **Workspace Trust básico** | **pendiente — bloquea la ejecución real** |
| **Fixtures maliciosos de package y runtime** | **pendiente** |

Los dos últimos son prerrequisitos, no consecuencias: **el incremento 3.0
empieza por Workspace Trust**, y hasta que exista, el host sólo se arranca
contra el workspace de fixtures del propio repositorio. Otras decisiones:

- Storage por extensión aislado en su propio directorio, con el id
  saneado (nunca la ruta del publisher tal cual).
- El host hereda el trust del workspace: en Restricted Mode sólo se activan
  extensiones que declaren `capabilities.untrustedWorkspaces.supported`.
- Sin `secrets` ni webviews en este milestone: ambos amplían la superficie
  de ataque y pertenecen a fases posteriores del roadmap.

## 8. Plan de incrementos

| # | Alcance | Criterio de salida |
| --- | --- | --- |
| 3.0 | Workspace Trust básico + Restricted Mode + fixtures maliciosos mínimos | El gate de seguridad queda cerrado salvo lo que los propios incrementos aportan |
| 3.1 | `utilityProcess`, handshake, envelope, timeouts, heartbeat — sin cargar extensiones | Host arranca, responde `heartbeat`, muere y reinicia limpio bajo prueba |
| 3.2 | Loader, `require('vscode')`, `ExtensionContext`, primitivas (`Disposable`, `EventEmitter`, `Uri`, enums) | Una extensión fixture carga y expone `activate` sin ejecutar lógica de workbench |
| 3.3 | `commands.register`/`execute` de punta a punta + activación `onCommand` desde el seam del renderer | Un comando de extensión ejecuta desde la paleta, el menú del editor y un keybinding |
| 3.4 | Activation service completo, `window.showMessage`, `configuration.get`, diagnostics y métricas | Hello World sin modificar: instala, activa por comando, muestra mensaje, desactiva limpio |
| 3.5 | Restart host, safe mode, crash-loop breaker, aislamiento demostrado | Extensión que revienta y extensión colgada, ambas diagnosticadas sin derribar Forge |
| 3.6 | Superficie de usuario: estado del host, activation failures y tiempos en la vista de detalle | La vista de detalle deja de decir "needs the Extension Host" para lo que ya corre |

## 9. Estrategia de pruebas

Siguiendo la pirámide del documento de seguridad §7, y manteniendo lo que
ya funciona: **`node --test` sin bundler**, con type stripping para los
módulos del renderer y `dist-electron` para los de main.

- **Unitarias**: envelope y correlación, validación de payloads, índice de
  eventos de activación, política de reinicio y circuit breaker, resolución
  de entrypoints. Todo con relojes y procesos falsos — sin arrancar Electron.
- **Contract tests**: el puerto `ExtensionHost` se prueba contra dos
  adaptadores, el real y uno en proceso, con la misma batería; así el host
  remoto futuro hereda las pruebas.
- **Integración**: `utilityProcess` real contra extensiones fixture del
  repositorio (una sana, una que lanza en `activate`, una que se cuelga,
  una que usa una API no soportada). Sin descargar nada de la red.
- **Robustez**: matar el host a mitad de un request, activación concurrente
  del mismo id, generación desfasada respondiendo tarde, tormenta de logs.

Las fixtures viven en el repo con versión fijada; el documento de seguridad
prohíbe expresamente depender de `latest` de un registro externo.

## 10. Riesgos conocidos

- **Compatibilidad de la facade**: las extensiones reales usan más API de
  la que se documenta. Mitigación: `UnsupportedApiError` con telemetría
  local, para que el reporte de compatibilidad se base en uso medido y no
  en suposiciones.
- **Alcance del milestone**: `workspace` y documentos son un imán de
  scope creep. Se quedan fuera por decisión explícita; una extensión que
  los necesite fallará con un error claro, que es información útil.
- **Coste de arranque**: activar en `onStartupFinished` puede degradar el
  arranque percibido. Se medirá por extensión desde 3.4 (`activationMetrics`)
  antes de fijar presupuestos, como pide arquitectura §15.

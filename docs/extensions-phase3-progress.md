# Extensiones: progreso del Milestone 3 (kernel del Extension Host)

Última actualización: 2026-08-15

Diseño: [extensions-phase3-design.md](./extensions-phase3-design.md) · Milestone
anterior: [extensions-phase2-progress.md](./extensions-phase2-progress.md)

## Incremento 3.1 — utilityProcess, handshake, envelope, timeouts y heartbeat

Completado (2026-08-15). Criterio de salida del diseño §8: *«Host arranca,
responde heartbeat, muere y reinicia limpio bajo prueba»*. **Este incremento
no carga extensiones**: cualquier método fuera de `lifecycle` responde
`UNSUPPORTED_API`, que es exactamente lo que debe hacer hasta el 3.2.

- **Vocabulario del protocolo** (`electron/extensions/domain/rpc-protocol.ts`):
  el `RpcEnvelope` del diseño §3.1 (`v`, `gen`, `id`, `kind`, `method`,
  `extensionId?`, `payload`), los seis códigos de error tipados
  (`UNSUPPORTED_API`, `ACTIVATION_FAILED`, `TIMEOUT`, `CANCELLED`,
  `HOST_UNAVAILABLE`, `INVALID_PAYLOAD`), la clase `RpcError` con
  `toPayload()`/`fromPayload()` y el guard `isRpcEnvelope`. La serialización
  **nunca incluye el stack**: viaja `{ code, message, data? }` y nada más
  (arquitectura §10).
- **Puerto `ExtensionHost`**
  (`application/ports/extension-host.ts`): `start`, `stop`, `restart`,
  `request`, `onEvent` y un estado observable
  (`stopped | starting | running | restarting | disabled` + `generation`,
  `restartsInWindow`, `lastError`). Es implementable tanto por el
  `utilityProcess` como por un doble en proceso, que es lo que exige la
  batería de contract tests del diseño §9 y lo que heredará el host remoto
  (arquitectura §16).
- **`RpcBroker`** (`infrastructure/hosts/rpc-broker.ts`): correlación por `id`
  monótono, notificaciones con `id: 0`, timeouts resueltos
  método → familia → default (`lifecycle.activate` 10 s,
  `commands.execute` 5 s, `lifecycle.deactivate` 3 s, `lifecycle.heartbeat`
  2 s, familia `configuration` 2 s, default 5 s), cancelación, validación en
  el borde (un envelope inválido responde `INVALID_PAYLOAD` y **no** se
  enruta), descarte de generaciones desfasadas y agregación de
  `diagnostics.log` en ventanas de 100 ms con límite por extensión
  (200 líneas/s por defecto) que emite una única línea *log rate exceeded*.
  El broker **no importa Electron**: recibe un `RpcTransport`
  (`send`/`onMessage`/`close`) y un `RpcTimers` (`now`/`setTimer`/
  `clearTimer`) como colaboradores.
- **`UtilityProcessExtensionHost`**
  (`infrastructure/hosts/utility-process-host.ts`): la política de ciclo de
  vida completa, sin Electron a la vista. Arranca una generación por spawn,
  hace el handshake §3.2 (`lifecycle.initialize` con
  `{ protocol, apiVersion, extensions, workspace, trust }`; se exige
  `protocol === 1` y `ready === true`), mantiene el heartbeat cada 2 s con
  3 fallos consecutivos ⇒ matar y reiniciar, reinicia por `exit` con backoff
  creciente (500 ms, 1 s, 2 s… tope 8 s) y aplica el circuit breaker de crash
  loop (3 reinicios en 60 s ⇒ `disabled`, sin respawn automático). El
  `HostProcessLauncher` es el único punto donde vive Electron:
  `createUtilityProcessLauncher` hace `utilityProcess.fork` + `MessageChannelMain`
  con un `require('electron')` perezoso, para que el módulo se pueda cargar
  en el runner de pruebas.
- **`electron/extension-host/bootstrap.ts`**: entrypoint del utilityProcess.
  Recibe el `MessagePortMain` por `process.parentPort`, responde
  `lifecycle.initialize` (`{ protocol, nodeVersion, ready: true }`),
  `lifecycle.heartbeat` (`{ ok, uptimeMs }`) y `lifecycle.shutdown`, y
  contesta `UNSUPPORTED_API` a todo lo demás. La lógica está en
  `createBootstrapResponder`, una función pura envelope→envelope; el wiring
  de I/O queda aparte y sólo se ejecuta si `process.parentPort` existe, así
  que el módulo es cargable desde `node --test`.

Pruebas añadidas (43 casos nuevos; la suite pasa de 98 a 141 tests):

- `tests/extensions/rpc-broker.test.cjs` (24): forma exacta del envelope,
  correlación con respuestas fuera de orden, guard del envelope (versión,
  kind, `id` de eventos y requests, `extensionId`), resolución de timeouts
  por método/familia/default, expiración con `TIMEOUT` y evento
  `request-timeout` con su dueño, respuesta tardía descartada, los seis
  códigos de error, código desconocido degradado a `INVALID_PAYLOAD`,
  serialización sin stack, cancelación, fallo de envío, descarte por
  generación desfasada (respuesta, evento y request), envelope malformado
  respondido `INVALID_PAYLOAD` sin enrutar, `UNSUPPORTED_API` sin handler,
  round-trip del handler, agregación de logs por ventana, recorte del
  storm con una sola línea de aviso y presupuesto por extensión, ventana
  deslizante, payloads de log malformados y `dispose` que rechaza todo lo
  pendiente con `HOST_UNAVAILABLE`.
- `tests/extensions/extension-host.test.cjs` (19): handshake completo,
  desajuste de protocolo que aborta sin degradar, handshake sin respuesta,
  requests rechazados fuera de `running`, `UNSUPPORTED_API` de punta a
  punta, heartbeat cada 2 s, dos fallos tolerados y el tercero matando y
  respawneando, contador que se resetea con un latido bueno, reinicio por
  `exit` con backoff creciente, tráfico dirigido sólo a la generación viva,
  circuit breaker (3 reinicios ⇒ `disabled`, `start()` rechazado), ventana
  que desliza, `restart()` explícito que limpia el breaker, `stop()` con
  `shutdown` y sin respawn, host que ignora `shutdown`, logs reenviados con
  su generación, generación muerta que no reporta nada, suscriptor que
  lanza sin romper la máquina de estados, y el responder real del bootstrap
  (orden handshake→heartbeat, eco de `gen` e `id`, `UNSUPPORTED_API`,
  `shutdown` que responde antes de salir).
- `tests/extensions/helpers/rpc-harness.cjs`: reloj y timers falsos,
  transporte falso y un launcher falso cuyos «procesos» ejecutan el
  responder **real** del bootstrap.

Pendiente en este incremento: **la prueba de integración con un
`utilityProcess` real**. Requiere `app.whenReady()` y en este entorno
Electron aborta sin display (`--ozone-platform=headless` vuelca core y no hay
`Xvfb`), así que ejecutarla obligaría a abrir una ventana. Queda anotada para
correrse junto a las fixtures del 3.2/3.5, donde ya habrá extensiones reales
que cargar; el sustituto actual es la mitad en proceso de la batería de
contrato: el mismo `RpcBroker` y el mismo `createBootstrapResponder` que se
empaquetan, hablando por un transporte de prueba.

### Decisiones del incremento 3.1

- **El envelope vive en `domain/rpc-protocol.ts`, no dentro del broker.** Es
  vocabulario compartido por los dos extremos: si lo definiera la
  infraestructura, el puerto de aplicación tendría que importar
  infraestructura para nombrar un código de error, justo la dependencia que
  la arquitectura §4 prohíbe. `rpc-broker.ts` lo **re-exporta**, así que
  para cualquier consumidor (y para las pruebas) el broker sigue siendo el
  módulo del protocolo.
- **El launcher es un puerto, no un detalle interno.** Todo lo específico de
  Electron (`utilityProcess.fork`, `MessageChannelMain`) cabe en
  `createUtilityProcessLauncher`; la política —handshake, heartbeat, backoff,
  breaker— es código puro sobre `HostProcessLauncher` + `RpcTimers`. Por eso
  las pruebas de reinicio y crash loop corren en milisegundos y sin Electron,
  y por eso el host remoto del futuro reutilizará la política entera.
- **Un fallo de handshake no reintenta; un crash sí.** El desajuste de
  protocolo o un entrypoint roto son determinísticos: reintentar sólo
  produciría un bucle con la misma causa, así que el host queda `stopped` con
  `lastError` y la UI podrá explicarlo (diseño §3.2, «nunca degrada en
  silencio»). El `exit` inesperado, en cambio, sí reintenta con backoff.
- **El breaker cuenta reinicios ya realizados, no crashes.** Se permiten 3
  reinicios dentro de la ventana de 60 s; el crash que sigue al tercero
  deshabilita. Contar crashes habría dejado sólo 2 reinicios efectivos, que
  no es lo que dice la tabla del diseño §6.
- **`restart()` explícito limpia el breaker.** Un humano (o el comando
  *Restart Extension Host* del 3.5) pidiendo reinicio es intención nueva, no
  otro síntoma del bucle que disparó el breaker; el reinicio automático, en
  cambio, respeta el presupuesto.
- **El timeout de `lifecycle.heartbeat` es de 2 s, igual que el intervalo.**
  Un presupuesto mayor detectaría un host colgado varios latidos tarde; con
  éste, tres fallos consecutivos se confirman en ~12 s.
- **El host echo de la generación, nunca la inventa.** `main` es su única
  fuente y descarta lo que vuelva con una desfasada; así un `activate` tardío
  de un host muerto no puede registrar nada en el nuevo (diseño §1.3).
- **El límite de logs es por extensión y por ventana de un segundo**, con una
  única línea *log rate exceeded* por ventana: una extensión ruidosa se
  recorta a sí misma sin silenciar a las demás ni inundar el broker.
- **`request()` devuelve `Promise<unknown>`.** El casteo cómodo a un tipo
  esperado escondería que el payload viene del otro lado del proceso; la
  validación por método llega con los schemas del 3.2.

## Próximo incremento

3.2 — loader, `require('vscode')`, `ExtensionContext` y primitivas. El seam
está listo: `onRequest` del host ya recibe las peticiones host→main y hoy
responde `UNSUPPORTED_API`, que es el hueco exacto donde entran
`commands.register` y compañía.

# Extensiones: Milestone 3.0 — Workspace Trust y Restricted Mode

Última actualización: 2026-08-15

Diseño: [extensions-phase3-design.md](./extensions-phase3-design.md) §7 y §8 ·
Especificación de seguridad:
[extensions-security-and-testing.md](./extensions-security-and-testing.md)
§3, §5 y §9 · Milestone anterior:
[extensions-phase2-progress.md](./extensions-phase2-progress.md)

Este incremento es el **prerrequisito del gate**: hasta que exista Workspace
Trust no se puede ejecutar código de terceros, así que se implementa antes
que el propio Extension Host (incrementos 3.1+).

## Incremento 3.0 — Workspace Trust básico + Restricted Mode + fixtures maliciosas

Completado:

- **Dominio** (`domain/workspace-trust.ts`): `WorkspaceTrustState`
  (`trusted` / `restricted`), `WorkspaceTrustDecision` (workspace, trusted,
  decidedAt), `WorkspaceTrustStatus` (estado + si el usuario ya decidió +
  si es remoto + si puede concederse) y la política
  `resolveExtensionTrust(extension, state)`, que devuelve
  `allowed` / `limited` / `blocked` junto con los settings que la propia
  extensión declara restringidos. En Restricted Mode sólo son activables
  las extensiones que declaran `capabilities.untrustedWorkspaces`.
- **Capacidades del manifiesto** (`domain/extension-manifest.ts`):
  `ExtensionCapabilitiesManifest` con `untrustedWorkspaces`
  (`supported` ∈ {`supported`, `limited`, `unsupported`}, `description`,
  `restrictedConfigurations`) y `virtualWorkspaces`.
  `defaultExtensionCapabilities()` fija los defaults seguros: sin
  declaración, **no** se activa en un workspace no confiable; los virtual
  workspaces se asumen soportados, como en VS Code.
- **Reader** (`VscodeManifestReader`): normaliza `capabilities` aceptando
  las tres formas que usa VS Code — booleano suelto, `"limited"` y el
  objeto `{ supported, description, restrictedConfigurations }` —,
  deduplica `restrictedConfigurations` y cae al default seguro ante
  cualquier valor desconocido (un typo nunca amplía permisos).
- **Registry** (`JsonExtensionRegistry`): `capabilities` viaja en el
  registro con round-trip exacto; los registros previos al incremento y los
  bloques corruptos decodifican a los defaults seguros.
- **Servicio** (`application/workspace-trust-service.ts`) + puerto
  (`application/ports/workspace-trust-store.ts`) + adaptador
  (`infrastructure/forge-workspace-trust-store.ts`): el estado se persiste
  bajo la clave propia `workspaceTrust` de `forge-config.json` —separada
  del registry de extensiones—, con lectura tolerante (una entrada
  ilegible se descarta, lo que degrada a Restricted Mode, nunca al revés) y
  escritura atómica heredada del `saveConfig` tmp+rename de la fachada, el
  mismo patrón de `ForgeWorkspaceSettingsStore`. El servicio expone
  `status()`, `isTrusted()`, `grant()`, `revoke()`, `onDidChange()` y
  `evaluate(records)`.
- **Precedencia de decisiones**: decisión explícita del propio workspace >
  ancestro más cercano con decisión (si es "no confiable", protege todo su
  subárbol aunque un abuelo esté confiado) > sin decisión ⇒ restringido.
  Las carpetas nuevas y los workspaces remotos empiezan **sin** confianza; a
  un workspace remoto ni siquiera se le puede conceder (`canGrant: false`,
  `WorkspaceTrustError` si se intenta).
- **IPC** (`ext:trust:status`, `ext:trust:grant`, `ext:trust:revoke` +
  broadcast `ext:trust:changed`), calcado de `ext:config:*`: main es el
  único que decide, y cada decisión —o cambio de workspace desde
  `fs:watch`— se emite a todas las ventanas. `preload.ts` expone
  `ext.trustStatus/grantWorkspaceTrust/revokeWorkspaceTrust/onTrustChanged`
  tipados contra el DTO.
- **DTO**: `InstalledExtensionPayload` gana `capabilities` y `trust`
  (`activation` + `restrictedConfigurations`) y `ExtensionListPayload` gana
  `workspaceTrust`, de modo que la lista de extensiones y el estado de
  confianza contra el que se calculó viajan juntos y nunca se muestran
  desincronizados.
- **UI**: `WorkspaceTrustBanner` (componente propio, clases Tailwind ya
  existentes: `forge-input`, `forge-border`, `forge-text`, `forge-accent`)
  avisa en el panel de extensiones cuando el workspace está en Restricted
  Mode y ofrece la acción de confiar; el badge de runtime muestra
  `Restricted` para lo que la confianza bloquea, y la vista de detalle añade
  una sección "Workspace Trust" que explica si la extensión queda bloqueada
  o limitada y qué settings ignora. En un workspace confiado no se pinta
  nada: un aviso permanente dejaría de significar algo.
- **Store**: el slice gana `workspaceTrust`, `workspaceTrustError`,
  `refreshWorkspaceTrust`, `applyWorkspaceTrust` y `setWorkspaceTrusted`;
  `App.tsx` se suscribe a `ext:trust:changed` y re-lista las extensiones al
  cambiar la confianza, porque la política de activación depende de ella.

### Controles de package endurecidos (fixtures maliciosas)

Las fixtures viven en `tests/fixtures/extensions/malicious/packages.json`
con versión fijada; los VSIX se construyen en el propio test con el helper
`stored-zip.cjs`, sin red ni dependencias de archivado.

| Fixture | ¿Ya se rechazaba? | Resultado |
| --- | --- | --- |
| Zip-slip (`extension/../../pwned.txt`) | Sí (Milestone 1) | La prueba lo documenta: `unsafe-path`, sin restos en staging |
| Symlink que apunta fuera del paquete | **No** | **Arreglo**: `zip.ts` expone `isSymlink` (S_IFLNK en los atributos externos) y `VsixPackageStore.extract` rechaza la entrada con `unsafe-path` |
| Manifest con identidad inconsistente (`publisher: "../../../tmp/evil"`) | **No** | **Arreglo**: nueva validación `invalid-field-format` sobre `name`/`publisher`; el paquete se rechaza con `invalid-manifest` |
| Capacidades contradictorias (`untrustedWorkspaces.supported: true` + `restrictedConfigurations`) | **No** (el campo ni se leía) | **Arreglo**: issue `contradictory-capabilities`, fatal en el package store |

Dos arreglos merecen ser explícitos porque eran vulnerabilidades reales,
no endurecimientos teóricos:

1. **Escape del almacén por el identificador**: el id se construye como
   `<publisher>.<name>` y se usa como segmento de ruta tanto en staging
   (`<root>/.staging/<id>-<version>-…`) como en la instalación
   (`<root>/<id>/<version>`). Con `publisher: "../../../tmp/evil"`, ambos
   caían fuera del root del almacén (comprobado: `<root>/.staging/…` →
   `…/.config/tmp/evil.…`). Ahora el reader rechaza el manifiesto y, como
   segunda cerradura, `versionDir` valida el id antes de tocar el
   filesystem.
2. **Symlinks del VSIX**: el lector de ZIP ignoraba los atributos externos,
   así que un enlace se extraía como archivo regular cuyo contenido era la
   ruta destino. No había escape inmediato, pero sí una entrada bajo control
   del paquete que cualquier lector posterior podía resolver; se rechaza en
   la extracción.

También se cerró un hueco de supply chain adyacente: `InstallExtensionById`
verifica que el VSIX descargado declare **el id que se pidió**; si no,
retira el registro y falla con el nuevo código `identity-mismatch`
(confusión de publisher).

## Pruebas añadidas

- `tests/extensions/workspace-trust.test.cjs` (21 casos): estado inicial
  restringido y sin decidir; persistencia y relectura con un servicio nuevo;
  revocación; claves de configuración ajenas intactas; notificación a
  suscriptores; precedencia completa (herencia a subcarpetas, decisión
  explícita que gana al padre, ancestro no confiable que protege su
  subárbol, prefijo compartido que no es subcarpeta); remoto y "sin
  workspace" no conceden; documento corrupto o store que lanza degradan a
  Restricted Mode; política de activación `allowed`/`limited`/`blocked` y su
  colapso a `allowed` en workspace confiado; normalización de
  `capabilities` (booleano, `"limited"`, objeto, valores desconocidos,
  dedup) y round-trip por el decoder del registry, incluidos registros
  legacy y bloques corruptos.
- `tests/extensions/malicious-packages.test.cjs` (6 casos): las cuatro
  fixtures maliciosas rechazadas con su código exacto y sin dejar registro
  ni staging, el diagnóstico del reader para identidad y capacidades, y el
  rollback del install por marketplace cuando la identidad descargada no es
  la pedida.

Resultado de la suite: `node --test tests/extensions/*.test.cjs` →
**125 pruebas, 124 pass, 1 fail** (antes de este incremento: 98/97). El
único fallo es `grammars.test.cjs`, que ni siquiera carga porque requiere
`vscode-textmate` y `vscode-oniguruma`, no instalados en este entorno; es
previo a este incremento.

### Decisiones

- **`limited` activa, y lo dice**: la especificación pide activar sólo lo
  que declare `capabilities.untrustedWorkspaces.supported`. Un
  `"limited"` es precisamente eso —una declaración— así que se activa, pero
  el veredicto viaja como `limited` con la lista de
  `restrictedConfigurations` para que la UI muestre la limitación en vez de
  ocultarla. Tratarlo como bloqueado sería más restrictivo que VS Code sin
  ganar seguridad; tratarlo como `allowed` mentiría sobre lo que hace.
- **Contradicción = rechazo, no saneamiento**: un manifiesto que declara
  soporte completo en workspaces no confiables y a la vez restringe settings
  ahí no tiene una interpretación correcta; elegir una sería adivinar en un
  campo que gobierna ejecución. Se rechaza la instalación con el motivo
  exacto. Un valor *desconocido* (por ejemplo `supported: "maybe"`) sí es
  tolerado y cae al default seguro: eso es una extensión escrita para una
  versión futura, no una contradicción.
- **La confianza es del workspace, no de la extensión**: se persiste en
  `forge-config.json` bajo su propia clave y no en `.forge/settings.json`
  del proyecto. Un workspace no puede declararse confiable a sí mismo, que
  es justo la amenaza "workspace malicioso" del modelo (§1).
- **Los workspaces remotos no se pueden confiar todavía**: el estado remoto
  se reporta (`remote: true`, `canGrant: false`) en vez de fingir una
  decisión. Confiar en un host remoto exige identidad del host, y eso
  pertenece al milestone remoto, no a éste.
- **Herencia por carpeta padre, con corte explícito**: confiar en la raíz de
  un proyecto y que cada subcarpeta vuelva a preguntar sería ruido que
  entrena al usuario a aceptar sin leer. Se hereda hacia abajo, pero la
  decisión negativa más cercana corta la herencia.
- **Hoy Restricted Mode no apaga contribuciones declarativas**: el
  documento de seguridad §3 las permite explícitamente ("contribuciones
  puramente declarativas seguras pueden continuar") y no hay todavía código
  de terceros que apagar. El veredicto `trust.activation` ya viaja en el
  payload, así que el host de 3.1+ nace consultándolo en lugar de tener que
  ser adaptado después. La UI dice exactamente eso — "no se activa" — y no
  simula un apagado que no ocurre.
- **El estado de confianza viaja con la lista de extensiones**: `ext:list`
  devuelve `workspaceTrust` además de los payloads, para que el panel no
  pueda pintar extensiones evaluadas con un estado y un banner con otro.
- **Verificación de identidad en el install por marketplace**: el usuario
  aprueba un id concreto; que el paquete descargado declare otro es
  confusión de publisher, así que se deshace la instalación en vez de
  registrarla con el nombre que traiga.

## Qué queda pendiente del gate

Cerrado en este incremento: **Workspace Trust básico** y **fixtures
maliciosas mínimas de package**. Siguen pendientes, y son alcance de los
incrementos 3.1–3.5: RPC con schema/timeout/heartbeat, aislamiento de
crashes demostrado, logs y reporte de activation failure, Safe Mode y las
fixtures maliciosas de **runtime** (CPU loop, crash loop, event flood), que
requieren un host que las ejecute.

# Modal de conexión "Open Remote SSH"

Nota histórica del bug de `window.prompt()`. El contrato del motor
remoto (URI `ssh://`, FS, PTY y lo que **no** corre en remoto) está en
[remote-workspaces.md](./remote-workspaces.md).

**Fecha:** 2026-07-11

## Problema

La opción *Open Remote SSH...* (menú de `TitleBar` y botón del `ExplorerPanel`)
fallaba siempre con el error:

```
prompt() is and will not be supported
```

La causa es que **Electron no implementa `window.prompt()`** (decisión
deliberada del proyecto Electron, no un bug). `openRemoteWorkspace` en
`src/store.ts` usaba dos `window.prompt()` para pedir el host SSH y la ruta
remota, por lo que la función se rompía antes de intentar conectar. Además,
el manejo de errores usaba `window.alert()`, que en Electron bloquea el foco
de la ventana.

> **Regla derivada:** en el renderer de Electron nunca usar `window.prompt()`
> ni `window.alert()`/`window.confirm()`. Toda entrada de usuario debe pasar
> por un modal/componente propio.

## Solución

Se reemplazaron los `prompt()` por un modal dedicado, siguiendo el patrón ya
existente de `ApiKeyModal` (estado de apertura en el store + componente
overlay montado a nivel de `App`). El flujo se amplió para asemejarse a un
editor remoto: primero se establece la conexión al host y después se navega o
se escribe la ruta de la carpeta que se desea abrir.

### Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/store/slices/remoteSlice.ts` | **Nuevo.** Slice de Zustand con el estado remoto/SSH: `remoteSSHModalOpen` + `setRemoteSSHModalOpen`, `openRemoteWorkspace` (abre el modal) y `connectRemoteWorkspace(target, path)` con la lógica de conexión (lanza el error en vez de hacer `alert`). |
| `src/store.ts` | Se eliminó el `openRemoteWorkspace` basado en `prompt()`; ahora solo combina el nuevo `RemoteSlice` (mismo patrón que `gitSlice`/`layoutSlice`/`terminalSlice`). |
| `src/components/ui/Modal.tsx` | **Nuevo.** Modal base genérico (backdrop, header con icono/título/cierre, body con scroll, footer opcional, `closeDisabled` para acciones en curso). |
| `src/components/RemoteSSHModal.tsx` | **Nuevo.** Usa el `Modal` base. Implementa las vistas de conexión y navegación, filtro local de carpetas, entrada directa de ruta y errores en línea. |
| `src/components/AIPanel/ApiKeyModal.tsx` | Refactorizado para usar el `Modal` base (se eliminó el envoltorio overlay/header/footer duplicado y un `style` inline). |
| `src/App.tsx` | Monta `<RemoteSSHModal />` junto a los demás overlays. |
| `electron/main.ts` / `electron/preload.ts` | Añaden `remote:browse`, que resuelve una ruta en el host y lista únicamente sus subcarpetas a través de OpenSSH. |
| `src/store.ts` | Reconoce URI con esquema como rutas absolutas. Esto evita convertir `ssh://host/ruta/archivo` en `ssh://host/raiz/ssh://host/ruta/archivo` al abrir un documento remoto. |

### Flujo actual

1. El usuario elige *Open Remote SSH...* → `openRemoteWorkspace()` pone
   `remoteSSHModalOpen = true`.
2. El modal recoge `target` (ej. `usuario@servidor` o un alias de
   `~/.ssh/config`) y conecta inicialmente al directorio home.
3. Ya conectado, el usuario puede entrar en subcarpetas con doble clic,
   filtrar las visibles o escribir una ruta absoluta/directa.
4. Al abrir llama a `connectRemoteWorkspace(target, path)`, que invoca
   `window.electronAPI.remote.connect(...)` y abre la URI resultante con
   `openFolder`.
5. Si la conexión falla, el error se muestra dentro del modal y el usuario
   puede corregir y reintentar sin perder lo escrito.

La ruta inicial `~` y las rutas con prefijo `~/` se expanden contra `$HOME`
en el servidor. No se envían entre comillas simples como texto literal; de
ese modo `root@host` abre `/root` sin exigir una carpeta en el primer paso.

## Apertura de documentos remotos

Los nodos del árbol remoto ya contienen una URI completa `ssh://`. La
resolución de rutas del editor debe conservar cualquier URI absoluta y solo
concatenar rutas realmente relativas. El proceso principal recibe así la URI
original, ejecuta `cat` en el host correcto y entrega el contenido a Monaco.

## Cumplimiento de CODING_GUIDELINES

- **§1 (slices):** el estado remoto/SSH vive en `src/store/slices/remoteSlice.ts`,
  no en el monolito `store.ts`.
- **§2 (DRY):** los futuros modales deben construirse sobre
  `src/components/ui/Modal.tsx` en lugar de duplicar overlay/header/footer.
  `ApiKeyModal` y `RemoteSSHModal` ya lo usan.
- **§5 (estilos):** sin CSS inline; el backdrop usa `bg-black/55`.

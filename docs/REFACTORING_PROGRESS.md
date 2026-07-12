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
- [ ] Construir un pequeño `store/index.ts` unificado usando el combinador de slices de Zustand.

## Progreso Reciente
- **TerminalSlice**: Se ha extraído exitosamente `terminalSlice.ts`, moviendo el manejo de terminales nativas, PTY y agentes.
- **GitSlice**: Se ha extraído exitosamente `gitSlice.ts`, moviendo todo el control de cambios de git.

Actualmente `store.ts` ha delegado Layout, Terminal y Git a slices específicos.

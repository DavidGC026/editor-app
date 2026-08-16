# Documentación de Forge

Índice de los documentos de `docs/`. Cada uno declara su propio alcance; la
regla general es que **el roadmap y la matriz de compatibilidad mandan**
sobre cualquier nota de implementación histórica.

## Empezar por aquí

| Documento | Para qué sirve |
| --- | --- |
| [CODING_GUIDELINES.md](./CODING_GUIDELINES.md) | Reglas de arquitectura y estilo obligatorias para cualquier cambio (límites de tamaño, división por responsabilidad, anti-monolitos). |
| [REFACTORING_PROGRESS.md](./REFACTORING_PROGRESS.md) | Bitácora acumulada del refactor: qué se ha delegado del `store.ts` a slices y qué milestones de extensiones están cerrados. |

## Sistema de extensiones

El trabajo grande del proyecto. Se lee en este orden:

| Documento | Para qué sirve |
| --- | --- |
| [extensions-architecture.md](./extensions-architecture.md) | Arquitectura objetivo: capas, estructura de archivos, lifecycle, protocolo RPC, API `vscode`, seguridad y rendimiento. Es el marco al que se ajustan todos los milestones. |
| [extensions-roadmap.md](./extensions-roadmap.md) | Milestones 0–6 con objetivos y criterios de salida, y el estado de cada uno. **Fuente de verdad del plan.** |
| [extensions-compatibility.md](./extensions-compatibility.md) | Matriz de compatibilidad por capability. **Fuente de verdad de qué funciona de verdad**: "instalada" no significa "compatible". |
| [extensions-security-and-testing.md](./extensions-security-and-testing.md) | Modelo de amenazas, límites de confianza, controles de install y runtime, pirámide de pruebas y el **gate** que hay que cerrar antes de ejecutar código de terceros. |

### Progreso por milestone

| Documento | Milestone |
| --- | --- |
| [extensions-phase0-progress.md](./extensions-phase0-progress.md) | 0 — contratos, manifest reader, DTOs y readers segregados. |
| [extensions-phase1-progress.md](./extensions-phase1-progress.md) | 1 — package store transaccional, instalación, updates y rollback. |
| [extensions-phase2-progress.md](./extensions-phase2-progress.md) | 2 — motor declarativo completo (2.0–2.7): configuration, ContributionRegistry, grammars TextMate, commands/keybindings, menus y la superficie de la vista de detalle. |
| [extensions-phase3-design.md](./extensions-phase3-design.md) | 3 — **diseño** del kernel del Extension Host: runtime, protocolo, activación, modelo de fallos y plan de incrementos. |

### Notas históricas

| Documento | Estado |
| --- | --- |
| [extensions-marketplace.md](./extensions-marketplace.md) | Descripción de la tienda tal como está implementada. Complementa, no sustituye, al roadmap. |
| [extensions-phase2-implementation.md](./extensions-phase2-implementation.md) | Nota histórica de una fase 2 anterior a la numeración actual de milestones. No es el roadmap vigente. |

## Funcionalidades concretas

| Documento | Para qué sirve |
| --- | --- |
| [terminal-session-persistence.md](./terminal-session-persistence.md) | Por qué las sesiones de terminal sobreviven a los cambios de pestaña y cómo se separó el ciclo de vida del PTY del de React. |
| [remote-ssh-modal.md](./remote-ssh-modal.md) | Diagnóstico y solución del modal "Open Remote SSH". |

## Convenciones de esta carpeta

- Los documentos de progreso se escriben **por incremento**, con una
  sección de decisiones que explica el porqué de lo no obvio. El objetivo
  es que dentro de seis meses se pueda reconstruir el razonamiento, no sólo
  el resultado.
- Un incremento no se da por cerrado sin actualizar su documento de
  progreso, el roadmap y —si cambia lo que un usuario puede hacer— la
  matriz de compatibilidad.

# Guía de Desarrollo y Buenas Prácticas (Agent & Developer Guidelines)

Este documento define las reglas estrictas de desarrollo para este proyecto. Cualquier desarrollador o Agente de IA que trabaje en este código DEBE seguir estas directrices para mantener la calidad, escalabilidad y orden del proyecto.

## 1. Arquitectura y Modularidad (Anti-Spaghetti)
- **Cero Monolitos:** Ningún componente de React (`.tsx`) o archivo de estado (`.ts`) debe superar las 300-400 líneas de código (~15 KB máximo recomendado). Si crece más, divídelo.
- **División por Responsabilidad:**
  - Si un componente tiene demasiada lógica, extrae esa lógica a un *Custom Hook* en `src/hooks/`.
  - Si un componente tiene muchos sub-elementos (ej. `SideBar` tiene explorador, búsqueda, etc.), crea una carpeta para el componente y separa cada sub-elemento en su propio archivo (`src/components/Sidebar/SearchPanel.tsx`).
- **Estado Global Dividido:** El estado global (Zustand) debe dividirse en "slices" (porciones lógicas) y combinarse en un store principal, nunca todo en un solo archivo gigante.

## 2. Reutilización de Código (DRY - Don't Repeat Yourself)
- **Componentes Base (UI):** Antes de crear un botón, input o modal desde cero, verifica si ya existe uno genérico en `src/components/ui/` o similar.
- **Utilidades Comunes:** Funciones puras repetitivas (formateo de fechas, manejo de strings, cálculos matemáticos) deben ir en `src/utils/` o `src/lib/`. No escribas la misma lógica de cálculo dos veces en distintos componentes.

## 3. Manejo de Tipos (TypeScript)
- Evita archivos `types.ts` gigantes. Los tipos e interfaces que son exclusivos de un componente o dominio deben estar en el mismo archivo o en una carpeta de tipos por dominio (ej. `src/types/editor.ts`).
- Evita usar `any`. Siempre define interfaces claras.

## 4. Documentación Continua
- **Siempre documenta:** Por cada nueva funcionalidad importante o refactorización masiva (ej. Sistema de extensiones, nuevo motor de búsqueda), DEBES crear o actualizar un archivo en la carpeta `docs/`.
- **Comentarios en el código:** Usa JSDoc (`/** ... */`) para explicar el *por qué* de lógicas complejas, no el *qué* (el código bien nombrado ya explica el qué).
- **Mantener actualizado el README:** Si agregas un nuevo comando o cambias la forma de ejecutar el proyecto, el [README de la raíz](../README.md) debe reflejarlo. Un sistema de producto nuevo (IA, Git, LSP, remoto, …) tiene doc propio en esta carpeta y entra al [índice](./README.md).

## 5. Estilos y CSS
- Usar TailwindCSS para estilos. Evitar CSS inline `style={{...}}`.
- Mantén las clases limpias. Si un componente tiene demasiadas clases que oscurecen la lectura del JSX, considera usar librerías como `clsx` o `tailwind-merge`, o extrae las clases en variables.

## 🚀 Flujo de Trabajo para el Agente (IA)
1. **Analizar antes de actuar:** Leer archivos relacionados antes de modificar.
2. **Pequeños Pasos:** No intentes refactorizar 1000 líneas en un solo intento. Haz cambios iterativos, reemplazando pequeños fragmentos comprobables.
3. **Actualizar docs:** Al terminar una tarea, revisa si es necesario registrar el cambio en un archivo de la carpeta `docs/`.

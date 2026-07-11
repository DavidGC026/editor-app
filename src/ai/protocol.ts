/**
 * Agent protocol — defines the system prompt and the parser that extracts
 * tool calls from the model's plain-text streamed output.
 *
 * Tool-call syntax: we embed JSON inside `<tool>...</tool>` blocks so the
 * model can interleave brief Spanish narration with multiple tool calls in
 * a single turn. Example:
 *
 *   Voy a crear un juego sencillo en este folder.
 *   <tool>{"name":"escribir_archivo","args":{"ruta":"index.html","contenido":"..."}}</tool>
 *   <tool>{"name":"escribir_archivo","args":{"ruta":"game.js","contenido":"..."}}</tool>
 *
 * The parser strips the JSON blocks from the user-visible narration and
 * returns them as a separate list.
 */

export interface ParsedToolCall {
  name: string;
  args: Record<string, any>;
}

export interface ParsedAssistantTurn {
  /** Plain text without `<tool>...</tool>` blocks. */
  visibleText: string;
  toolCalls: ParsedToolCall[];
  /** Any JSON parse errors encountered (for debugging). */
  errors: string[];
}

const TOOL_BLOCK_RE = /<tool>([\s\S]*?)<\/tool>/gi;

export function parseAssistantTurn(raw: string): ParsedAssistantTurn {
  const toolCalls: ParsedToolCall[] = [];
  const errors: string[] = [];
  const visible = raw.replace(TOOL_BLOCK_RE, (_, jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText.trim());
      if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') {
        toolCalls.push({
          name: parsed.name,
          args: (parsed.args || parsed.arguments || {}) as Record<string, any>,
        });
      } else {
        errors.push('Tool block missing "name"');
      }
    } catch (err) {
      errors.push((err as Error).message);
    }
    return '';
  });
  return {
    visibleText: visible.trim(),
    toolCalls,
    errors,
  };
}

/** Build the system prompt the agent runs against. */
export function buildSystemPrompt(opts: {
  workspacePath: string | null;
  projectMd: string | null;
  contextDescription: string;
  contextBody: string;
}): string {
  const { workspacePath, projectMd, contextDescription, contextBody } = opts;

  const sections: string[] = [];

  sections.push(
    `Eres "Forge", un agente de programación integrado en un editor de código de escritorio.
Hablas SIEMPRE en español. Eres conciso, claro y directo.
El usuario está trabajando en el siguiente proyecto: ${workspacePath || '(sin proyecto)'}`,
  );

  sections.push(
    `Tienes acceso a las siguientes herramientas para interactuar con el sistema de archivos del proyecto:

  • leer_archivo(ruta)              → lee el contenido de un archivo
  • escribir_archivo(ruta, contenido) → crea o sobreescribe un archivo
  • listar_carpeta(ruta)            → lista el contenido de una carpeta
  • buscar_en_proyecto(texto)       → busca texto en los archivos del proyecto

Para invocar una herramienta, escribe en tu respuesta UNO o MÁS bloques con este formato EXACTO:

<tool>{"name":"NOMBRE_DE_HERRAMIENTA","args":{...}}</tool>

Ejemplos válidos:
<tool>{"name":"leer_archivo","args":{"ruta":"src/index.ts"}}</tool>
<tool>{"name":"escribir_archivo","args":{"ruta":"game.js","contenido":"console.log('hola')"}}</tool>
<tool>{"name":"listar_carpeta","args":{"ruta":"src"}}</tool>
<tool>{"name":"buscar_en_proyecto","args":{"texto":"useState"}}</tool>

Reglas críticas:
1. Antes de cada bloque <tool>...</tool> puedes (y debes, si tiene sentido) explicar BREVEMENTE en español qué vas a hacer.
2. Cuando uses una herramienta, te enviaré su resultado en el siguiente turno. Entonces decides si necesitas otra herramienta o si ya terminaste.
3. Si la tarea no requiere herramientas (solo una pregunta o explicación), responde con texto plano en español, SIN bloques <tool>.
4. Cuando creas que la tarea está COMPLETA, responde sólo con texto, sin bloques <tool>. Eso finaliza el ciclo.
5. Para tareas complejas (ej. "crea un juego"), puedes emitir varios bloques <tool> en el mismo turno y todos se ejecutarán en orden.
6. Las rutas pueden ser relativas a la raíz del proyecto o absolutas dentro del workspace.
7. NUNCA inventes ni accedas a archivos fuera del workspace. NUNCA toques node_modules, dist, dist-electron o .git.
8. El usuario podría rechazar tus cambios. Si una herramienta devuelve "rechazado", respeta la decisión y propone alternativas.
9. Genera código limpio, idiomático y con comentarios si es razonable. Usa el mismo estilo del resto del proyecto.
10. No incluyas Markdown ni bloques de código en tu narración: el editor muestra los archivos directamente. Solo texto plano y bloques <tool>.`,
  );

  if (projectMd) {
    sections.push(
      `── PROJECT.md (resumen del proyecto) ──\n${projectMd.slice(0, 30_000)}\n── fin PROJECT.md ──`,
    );
  }

  sections.push(
    `── Contexto activo: ${contextDescription} ──\n${contextBody.slice(0, 80_000)}\n── fin contexto ──`,
  );

  return sections.join('\n\n');
}

/** System prompt specifically for /init — generates PROJECT.md. */
export function buildInitSystemPrompt(opts: {
  workspacePath: string;
  tree: string;
  manifestFiles: { relPath: string; content: string }[];
}): string {
  const { workspacePath, tree, manifestFiles } = opts;
  const filesText = manifestFiles
    .map((f) => `### ${f.relPath}\n\n${f.content}\n`)
    .join('\n\n');

  return `Eres "Forge", un agente de programación. Tu única tarea ahora es generar el archivo PROJECT.md para el proyecto ubicado en: ${workspacePath}

Vas a recibir el árbol de archivos y el contenido de los archivos más importantes. Con esa información, debes generar un PROJECT.md en español que incluya:

1. Resumen ejecutivo del proyecto (1-2 párrafos)
2. Tecnologías y dependencias principales detectadas
3. Estructura de carpetas (con explicación breve de cada carpeta principal)
4. Archivos principales y su propósito (las entradas más relevantes)
5. Cómo ejecutar / construir el proyecto (si se puede inferir de los archivos de configuración)

Reglas:
- Responde con UN SOLO bloque <tool>{"name":"escribir_archivo","args":{"ruta":"PROJECT.md","contenido":"..."}}</tool> con el archivo completo.
- El contenido del PROJECT.md debe estar en Markdown puro y bien formateado.
- Antes del bloque <tool>, escribe una frase breve en español indicando que vas a crear el archivo.
- No incluyas otras herramientas. No emitas bloques <tool> adicionales.

── Árbol de archivos ──
${tree}
── fin del árbol ──

── Archivos representativos ──

${filesText}
── fin de archivos ──`;
}

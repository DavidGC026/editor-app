/**
 * Quick AI actions — one-shot LLM calls that don't need the full agent
 * loop (no tools, no /init requirement): commit-message generation and
 * editor actions over the current selection (explain / refactor /
 * document / fix-with-diagnostics).
 */

import { useStore } from '../store';
import { AIMessage, ChatRole, Problem, ProviderId } from '../types';

function makeId(prefix = 'q'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Resolve the active provider/model or push a notice into the chat. */
function requireProvider(): { provider: ProviderId; model: string } | null {
  const s = useStore.getState();
  if (!s.aiActiveProvider || !s.aiActiveModel) {
    return null;
  }
  return { provider: s.aiActiveProvider as ProviderId, model: s.aiActiveModel };
}

/** Stream a single completion. Resolves with the full text; rejects on a
 *  stream error. `onDelta` fires per chunk for live UI updates. */
export function askAIOnce(args: {
  provider: ProviderId;
  model: string;
  messages: ChatRole[];
  onDelta?: (text: string) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const streamId = makeId('qs');
    let collected = '';
    let settled = false;

    const disposable = window.electronAPI.ai.onStream(streamId, (event, data) => {
      if (event === 'delta') {
        collected += String(data);
        args.onDelta?.(String(data));
      } else if (event === 'done') {
        if (!settled) {
          settled = true;
          disposable.dispose();
          resolve(collected);
        }
      } else if (event === 'error') {
        if (!settled) {
          settled = true;
          disposable.dispose();
          reject(new Error(String(data)));
        }
      }
    });

    window.electronAPI.ai
      .chatStream({
        streamId,
        provider: args.provider,
        model: args.model,
        messages: args.messages,
      })
      .catch((err: Error) => {
        if (!settled) {
          settled = true;
          disposable.dispose();
          reject(err);
        }
      });
  });
}

// ─── Commit message generation ───────────────────────────────────────────

const COMMIT_SYSTEM_PROMPT = `Eres un asistente que redacta mensajes de commit de git.
Recibirás un diff y responderás ÚNICAMENTE con el mensaje de commit, sin comillas, sin markdown y sin explicaciones.
Reglas:
- Primera línea: resumen imperativo de máximo 72 caracteres (opcionalmente con prefijo convencional como "feat:", "fix:", "refactor:", "docs:"…).
- Si el cambio es grande, añade una línea en blanco y de 1 a 4 viñetas breves con "- ".
- Escribe en español.`;

/** Strip decorations models sometimes add despite the instructions. */
function cleanCommitMessage(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('«') && text.endsWith('»'))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

/** Generate a commit message from the pending diff. Throws with a readable
 *  message when there's no provider, no workspace or nothing to commit. */
export async function generateCommitMessage(): Promise<string> {
  const ws = useStore.getState().workspacePath;
  if (!ws) throw new Error('Abre primero una carpeta de proyecto.');
  const pm = requireProvider();
  if (!pm) {
    throw new Error(
      'Configura primero una clave de API y un modelo en el panel de IA.',
    );
  }

  const summary = await window.electronAPI.git.diffSummary(ws);
  if (!summary.text) throw new Error('No hay cambios para describir.');

  const scope = summary.staged
    ? 'Cambios preparados (staged):'
    : 'Cambios del árbol de trabajo:';
  const raw = await askAIOnce({
    provider: pm.provider,
    model: pm.model,
    messages: [
      { role: 'system', content: COMMIT_SYSTEM_PROMPT },
      { role: 'user', content: `${scope}\n\n${summary.text}` },
    ],
  });

  const message = cleanCommitMessage(raw);
  if (!message) throw new Error('El modelo no devolvió un mensaje utilizable.');
  return message;
}

// ─── Editor actions over the current selection ───────────────────────────

export type EditorAIActionKind = 'explain' | 'refactor' | 'document' | 'fix';

export interface EditorAIPayload {
  /** Workspace-relative path (or file name) shown to the model. */
  relPath: string;
  language: string;
  code: string;
  /** True when `code` is the whole file (empty selection). */
  wholeFile: boolean;
  startLine?: number;
  endLine?: number;
}

const ACTION_LABEL: Record<EditorAIActionKind, string> = {
  explain: 'Explica este código',
  refactor: 'Refactoriza este código',
  document: 'Documenta este código',
  fix: 'Corrige los problemas de este código',
};

const ACTION_INSTRUCTIONS: Record<EditorAIActionKind, string> = {
  explain:
    'Explica qué hace este código de forma clara y concisa: propósito general primero, luego los detalles no obvios. No repitas el código.',
  refactor:
    'Propón una versión refactorizada de este código (más clara, idiomática y eficiente sin cambiar su comportamiento). Devuelve el código completo resultante en un bloque de código y resume los cambios en 2-4 viñetas.',
  document:
    'Devuelve el mismo código con documentación añadida (docstrings/JSDoc según el lenguaje y comentarios solo donde aporten). No cambies el comportamiento. Devuelve el código completo en un bloque de código.',
  fix:
    'Corrige los problemas indicados por los diagnósticos (y cualquier bug evidente). Devuelve el código corregido completo en un bloque de código y explica brevemente cada corrección.',
};

const EDITOR_SYSTEM_PROMPT = `Eres un asistente de programación integrado en un editor de código.
Responde en español, de forma directa y sin relleno. Usa bloques de código con el lenguaje correcto cuando devuelvas código.`;

/** Diagnostics of the given file, formatted for the prompt ('' if none). */
function diagnosticsFor(relPath: string, fullPath: string): string {
  const problems: Problem[] = useStore
    .getState()
    .problems.filter((p) => p.filePath === fullPath);
  if (problems.length === 0) return '';
  const lines = problems
    .slice(0, 30)
    .map(
      (p) =>
        `- L${p.startLine}:${p.startColumn} [${p.severity === 1 ? 'error' : 'warning'}] ${p.message}${p.code ? ` (${p.code})` : ''}`,
    );
  return `\n\nDiagnósticos actuales de ${relPath}:\n${lines.join('\n')}`;
}

/**
 * Run a quick AI action over editor code: opens the AI panel and streams
 * the answer into the chat as a normal conversation turn (no tools).
 */
export async function runEditorAIAction(
  kind: EditorAIActionKind,
  payload: EditorAIPayload,
  fullPath?: string,
): Promise<void> {
  const store = useStore.getState();
  if (!store.aiPanelVisible) store.toggleAIPanel();

  const pm = requireProvider();
  if (!pm) {
    store.addAIMessage({
      id: makeId('sys'),
      role: 'system',
      content: 'Configura primero una clave de API y selecciona un modelo.',
    });
    return;
  }
  if (!payload.code.trim()) {
    store.addAIMessage({
      id: makeId('sys'),
      role: 'system',
      content: 'No hay código seleccionado ni archivo activo.',
    });
    return;
  }

  const where = payload.wholeFile
    ? payload.relPath
    : `${payload.relPath} (líneas ${payload.startLine}-${payload.endLine})`;

  // Visible user turn: short label + the code being discussed.
  const userMessage: AIMessage = {
    id: makeId('u'),
    role: 'user',
    content: `${ACTION_LABEL[kind]} — ${where}\n\n\`\`\`${payload.language}\n${payload.code}\n\`\`\``,
  };
  store.addAIMessage(userMessage);

  const diagnostics =
    kind === 'fix' && fullPath ? diagnosticsFor(payload.relPath, fullPath) : '';

  const assistantId = makeId('a');
  useStore.getState().addAIMessage({
    id: assistantId,
    role: 'assistant',
    content: '',
    streaming: true,
  });
  useStore.getState().setAIStatus('streaming', 'Generando respuesta…');

  try {
    await askAIOnce({
      provider: pm.provider,
      model: pm.model,
      messages: [
        { role: 'system', content: EDITOR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${ACTION_INSTRUCTIONS[kind]}\n\nArchivo: ${where}\n\n\`\`\`${payload.language}\n${payload.code}\n\`\`\`${diagnostics}`,
        },
      ],
      onDelta: (text) => useStore.getState().appendToAIMessage(assistantId, text),
    });
    useStore.getState().updateAIMessage(assistantId, { streaming: false });
  } catch (err) {
    useStore.getState().updateAIMessage(assistantId, {
      streaming: false,
      error: (err as Error).message,
    });
  } finally {
    useStore.getState().setAIStatus('idle');
  }
}

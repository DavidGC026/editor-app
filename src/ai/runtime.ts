/**
 * Agent runtime — owns the user-message → tool-execution → response loop.
 *
 * The runtime runs entirely in the renderer (it talks to the main process
 * via the `window.electronAPI.ai` and `.agent` namespaces). It is invoked
 * from the AI panel input area.
 */

import { useStore } from '../store';
import {
  AIMessage,
  AIToolCall,
  ChatRole,
  PendingDiff,
  ProviderId,
} from '../types';
import {
  buildInitSystemPrompt,
  buildSystemPrompt,
  parseAssistantTurn,
  ParsedToolCall,
} from './protocol';
import { AssistantStreamRouter } from './streamRouter';

const MAX_STEPS = 20;

/** Generate a short id for messages / streams. */
function makeId(prefix = 'm'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Convert an absolute path to a workspace-relative one when possible. */
function relativize(workspacePath: string | null, full: string): string {
  if (!workspacePath) return full;
  if (full === workspacePath) return '.';
  const ws = workspacePath.endsWith('/') || workspacePath.endsWith('\\') ? workspacePath : workspacePath + (workspacePath.includes('\\') && !workspacePath.includes('/') ? '\\' : '/');
  return full.startsWith(ws) ? full.slice(ws.length) : full;
}

/**
 * Stream a single assistant turn. Returns the raw assistant text once the
 * stream completes (or the stream errors).
 */
async function streamSingleTurn(args: {
  provider: ProviderId;
  model: string;
  chatMessages: ChatRole[];
  assistantMessageId: string;
  onDelta: (text: string) => void;
}): Promise<{ raw: string; error?: string }> {
  return new Promise((resolve) => {
    const streamId = makeId('s');
    let collected = '';
    let resolved = false;

    const disposable = window.electronAPI.ai.onStream(
      streamId,
      (event, data) => {
        if (event === 'delta') {
          collected += String(data);
          args.onDelta(String(data));
        } else if (event === 'done') {
          if (!resolved) {
            resolved = true;
            disposable.dispose();
            resolve({ raw: collected });
          }
        } else if (event === 'error') {
          if (!resolved) {
            resolved = true;
            disposable.dispose();
            resolve({ raw: collected, error: String(data) });
          }
        }
      },
    );

    console.debug(
      '[forge:ai] runtime → chatStream provider=%s model=%s messages=%d',
      args.provider,
      args.model,
      args.chatMessages.length,
    );
    window.electronAPI.ai
      .chatStream({
        streamId,
        provider: args.provider,
        model: args.model,
        messages: args.chatMessages,
      })
      .catch((err: Error) => {
        if (!resolved) {
          resolved = true;
          disposable.dispose();
          resolve({ raw: collected, error: err.message });
        }
      });
  });
}

/** Translate a parsed tool call into the user-facing status label. */
function statusLabelFor(toolCall: ParsedToolCall): string {
  switch (toolCall.name) {
    case 'leer_archivo':
      return `Leyendo archivo ${toolCall.args.ruta || ''}…`;
    case 'escribir_archivo':
      return `Editando archivo ${toolCall.args.ruta || ''}…`;
    case 'listar_carpeta':
      return `Listando carpeta ${toolCall.args.ruta || '.'}…`;
    case 'buscar_en_proyecto':
      return `Buscando "${toolCall.args.texto || ''}" en el proyecto…`;
    default:
      return `Ejecutando ${toolCall.name}…`;
  }
}

/** Execute a single tool call. Returns a stringified result + UI metadata. */
async function executeTool(
  workspacePath: string,
  toolCall: ParsedToolCall,
): Promise<{ result: string; paths?: string[]; rejected?: boolean; error?: string }> {
  const api = window.electronAPI.agent;

  try {
    switch (toolCall.name) {
      case 'leer_archivo': {
        const ruta = String(toolCall.args.ruta || '');
        if (!ruta) throw new Error('Falta argumento "ruta".');
        const r = await api.leerArchivo(workspacePath, ruta);
        return {
          result: `Contenido de ${ruta} (${r.bytes} bytes):\n${r.content}`,
          paths: [r.path],
        };
      }

      case 'escribir_archivo': {
        const ruta = String(toolCall.args.ruta || '');
        const contenido = String(toolCall.args.contenido ?? '');
        if (!ruta) throw new Error('Falta argumento "ruta".');

        const exists = await api.fileExists(workspacePath, ruta);
        if (exists) {
          // Existing file: present a diff and wait for the user's decision.
          const before = (await api.readFileSafe(workspacePath, ruta)) ?? '';
          const accepted = await requestDiffDecision({
            before,
            after: contenido,
            ruta,
            workspacePath,
          });
          if (!accepted) {
            return {
              result: `El usuario RECHAZÓ los cambios en ${ruta}. No se modificó el archivo.`,
              paths: [],
              rejected: true,
            };
          }
        }
        const r = await api.escribirArchivo(workspacePath, ruta, contenido);
        return {
          result: r.existed
            ? `Archivo ${ruta} actualizado (${r.bytes} bytes).`
            : `Archivo ${ruta} creado (${r.bytes} bytes).`,
          paths: [r.path],
        };
      }

      case 'listar_carpeta': {
        const ruta = String(toolCall.args.ruta || '.');
        const r = await api.listarCarpeta(workspacePath, ruta);
        const lines = r.entries.map(
          (e) => `${e.type === 'directory' ? '[D]' : '   '} ${e.name}`,
        );
        return {
          result: `Contenido de ${ruta}:\n${lines.join('\n')}`,
        };
      }

      case 'buscar_en_proyecto': {
        const texto = String(toolCall.args.texto || '');
        if (!texto) throw new Error('Falta argumento "texto".');
        const r = await api.buscarEnProyecto(workspacePath, texto);
        const lines = r.matches.map(
          (m) => `${m.path}:${m.line}  ${m.preview}`,
        );
        const suffix = r.truncated ? '\n(resultados truncados, hay más coincidencias)' : '';
        return {
          result:
            r.matches.length === 0
              ? `Sin coincidencias para "${texto}".`
              : `Resultados para "${texto}":\n${lines.join('\n')}${suffix}`,
        };
      }

      default:
        return {
          result: `Herramienta desconocida: ${toolCall.name}. Las disponibles son: leer_archivo, escribir_archivo, listar_carpeta, buscar_en_proyecto.`,
          error: 'unknown_tool',
        };
    }
  } catch (err) {
    const message = (err as Error).message || String(err);
    return { result: `ERROR ejecutando ${toolCall.name}: ${message}`, error: message };
  }
}

/** Pushes a PendingDiff into the store and resolves when the user clicks
 *  accept or reject. */
function requestDiffDecision(args: {
  before: string;
  after: string;
  ruta: string;
  workspacePath: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const diff: PendingDiff = {
      before: args.before,
      after: args.after,
      filePath: args.ruta, // resolved fully below
      relPath: args.ruta,
    };
    const { setAIPendingDiff, setAIStatus } = useStore.getState();
    setAIPendingDiff(diff, (accepted) => {
      setAIPendingDiff(null, null);
      resolve(accepted);
    });
    setAIStatus('awaiting_diff', 'Esperando decisión del usuario sobre los cambios…');
  });
}

/**
 * Build the messages array that's sent to the LLM provider, given the
 * current renderer-side conversation history.
 */
function buildLLMMessages(
  systemPrompt: string,
  uiMessages: AIMessage[],
  pendingToolResults: { toolCallId?: string; resultText: string }[],
): ChatRole[] {
  const out: ChatRole[] = [{ role: 'system', content: systemPrompt }];

  for (const m of uiMessages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      // The assistant's "content" stored in our UI is the visible narration
      // only; to make the model aware of its previous tool calls we
      // re-serialise them.
      let serialized = m.content;
      if (m.toolCalls && m.toolCalls.length > 0) {
        const toolBlocks = m.toolCalls
          .map(
            (tc) =>
              `<tool>${JSON.stringify({ name: tc.name, args: tc.args })}</tool>`,
          )
          .join('\n');
        serialized = (serialized ? serialized + '\n' : '') + toolBlocks;
      }
      if (serialized.length > 0) {
        out.push({ role: 'assistant', content: serialized });
      }
    }
  }

  if (pendingToolResults.length > 0) {
    const body = pendingToolResults
      .map(
        (r, i) =>
          `Resultado de la herramienta #${i + 1}:\n${r.resultText}`,
      )
      .join('\n\n');
    out.push({
      role: 'user',
      content: `[RESULTADOS DE HERRAMIENTAS]\n${body}\n\nContinúa con la tarea o responde al usuario si has terminado.`,
    });
  }

  return out;
}

/** Build the context body string that becomes the active context. */
async function buildActiveContext(): Promise<{
  description: string;
  body: string;
  projectMd: string | null;
}> {
  const state = useStore.getState();
  const ws = state.workspacePath;
  if (!ws) {
    return { description: 'Sin proyecto abierto.', body: '', projectMd: null };
  }

  // PROJECT.md
  let projectMd: string | null = null;
  try {
    projectMd = await window.electronAPI.agent.readFileSafe(ws, 'PROJECT.md');
  } catch {
    projectMd = null;
  }

  const selectedPath = state.selectedPath;
  const selectedKind = state.selectedKind;

  // No selection → use the project root as context (folder snapshot).
  let description: string;
  let body: string;

  if (!selectedPath || !selectedKind) {
    description = `Raíz del proyecto: ${ws}`;
    const snapshot = await window.electronAPI.agent.snapshotFolder(ws, ws);
    body = snapshot
      .map((f) => `### ${f.relPath}\n${f.content}`)
      .join('\n\n');
  } else if (selectedKind === 'file') {
    description = `Archivo seleccionado: ${relativize(ws, selectedPath)}`;
    const content =
      (await window.electronAPI.agent.readFileSafe(ws, selectedPath)) ?? '';
    body = `### ${relativize(ws, selectedPath)}\n${content}`;
  } else {
    description = `Carpeta seleccionada: ${relativize(ws, selectedPath)}`;
    const snapshot = await window.electronAPI.agent.snapshotFolder(ws, selectedPath);
    body = snapshot
      .map((f) => `### ${f.relPath}\n${f.content}`)
      .join('\n\n');
  }

  return { description, body, projectMd };
}

// ─── Public entry: runUserPrompt ─────────────────────────────────────────

/**
 * Main entry point invoked when the user submits a message in the AI panel.
 * Handles commands (/init, /clear) and the agentic loop.
 */
export async function runUserPrompt(prompt: string): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) return;

  const store = useStore.getState();
  const ws = store.workspacePath;
  const provider = store.aiActiveProvider;
  const model = store.aiActiveModel;

  if (!provider || !model) {
    pushSystemNotice('Configura primero una clave de API y selecciona un modelo.');
    return;
  }
  if (!ws) {
    pushSystemNotice('Abre primero una carpeta de proyecto.');
    return;
  }

  // ── Slash commands ──────────────────────────────────────────────────
  if (trimmed === '/clear') {
    store.clearAIConversation();
    return;
  }
  if (trimmed === '/init') {
    await runInit();
    return;
  }
  // Block normal prompts if /init hasn't been run
  if (!store.aiInitDone) {
    pushSystemNotice(
      'Para usar el agente debes ejecutar primero el comando /init para generar PROJECT.md.',
    );
    return;
  }

  // ── Normal user prompt ──────────────────────────────────────────────
  const userMessage: AIMessage = {
    id: makeId('u'),
    role: 'user',
    content: trimmed,
  };
  store.addAIMessage(userMessage);

  // Re-read provider/model from the latest store snapshot in case the user
  // changed the selection between the captured snapshot above and this point.
  const fresh = useStore.getState();
  await runAgentLoop({
    provider: (fresh.aiActiveProvider || provider) as ProviderId,
    model: fresh.aiActiveModel || model,
    workspacePath: ws,
  });
}

/** Pushes a synthetic system message into the chat. */
function pushSystemNotice(text: string): void {
  const { addAIMessage } = useStore.getState();
  addAIMessage({
    id: makeId('sys'),
    role: 'system',
    content: text,
  });
}

/** Run the multi-step agent loop until the model produces no tool calls
 *  (or we hit MAX_STEPS). */
async function runAgentLoop(opts: {
  provider: ProviderId;
  model: string;
  workspacePath: string;
}): Promise<void> {
  const { provider, model, workspacePath } = opts;

  const ctx = await buildActiveContext();
  const systemPrompt = buildSystemPrompt({
    workspacePath,
    projectMd: ctx.projectMd,
    contextDescription: ctx.description,
    contextBody: ctx.body,
  });

  let pendingResults: { resultText: string }[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    // Build the messages array from the latest snapshot of the conversation.
    const snapshot = useStore.getState().aiMessages;
    const messages = buildLLMMessages(systemPrompt, snapshot, pendingResults);
    pendingResults = [];

    // Create assistant message placeholder
    const assistantId = makeId('a');
    useStore.getState().addAIMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    });
    useStore.getState().setAIStatus('streaming', 'Generando respuesta…');

    // ── Real-time streaming router ──────────────────────────────────
    // Intercept `<tool>…escribir_archivo…</tool>` blocks so the file
    // content gets piped into the matching editor tab character-by-
    // character, while only the visible narration is appended to the
    // chat message bubble.
    const streamedRutas = new Set<string>();
    const rutaToFullPath = new Map<string, string>();

    const router = new AssistantStreamRouter({
      onVisibleText: (text) => {
        useStore.getState().appendToAIMessage(assistantId, text);
      },
      onWriteStart: (ruta) => {
        const full = useStore.getState().agentStreamOpenTab(ruta);
        if (full) {
          rutaToFullPath.set(ruta, full);
          streamedRutas.add(ruta);
        }
        useStore
          .getState()
          .agentLiveWriteUpdate(assistantId, ruta, { done: false });
        useStore
          .getState()
          .setAIStatus('streaming', `Escribiendo en ${ruta}…`);
      },
      onWriteChunk: (ruta, chunk) => {
        const full = rutaToFullPath.get(ruta);
        if (full) useStore.getState().agentStreamAppendTab(full, chunk);
      },
      onWriteEnd: (ruta) => {
        const full = rutaToFullPath.get(ruta);
        if (full) {
          void useStore.getState().agentStreamFinalizeTab(full);
        }
        useStore
          .getState()
          .agentLiveWriteUpdate(assistantId, ruta, { done: true });
      },
    });

    // Always read the latest provider/model right before we send. This way,
    // if the user switches model between agent steps, the next request uses
    // the new selection without waiting for the loop to restart.
    const live = useStore.getState();
    const liveProvider = (live.aiActiveProvider || provider) as ProviderId;
    const liveModel = live.aiActiveModel || model;

    const { raw, error } = await streamSingleTurn({
      provider: liveProvider,
      model: liveModel,
      chatMessages: messages,
      assistantMessageId: assistantId,
      onDelta: (text) => router.push(text),
    });
    router.finish();

    if (error) {
      useStore.getState().updateAIMessage(assistantId, {
        streaming: false,
        error,
      });
      useStore.getState().setAIStatus('idle');
      return;
    }

    // Parse the assistant's raw text into visible narration + tool calls
    const parsed = parseAssistantTurn(raw);

    // Replace the streamed content with the cleaned visible text and attach
    // the tool calls so we can later re-serialise them when building the
    // next LLM messages array.
    useStore.getState().updateAIMessage(assistantId, {
      streaming: false,
      content: parsed.visibleText,
      toolCalls: parsed.toolCalls.map(
        (tc): AIToolCall => ({
          name: tc.name,
          args: tc.args,
          statusLabel: statusLabelFor(tc),
          done: false,
        }),
      ),
    });

    // No tool calls? We're done.
    if (parsed.toolCalls.length === 0) {
      useStore.getState().setAIStatus('idle');
      return;
    }

    // Execute tool calls sequentially so the diff modal works one-at-a-time.
    for (let i = 0; i < parsed.toolCalls.length; i++) {
      const tc = parsed.toolCalls[i];

      // Mark this tool call as "running" in the UI by updating the
      // corresponding entry in toolCalls[].
      const refreshTool = (patch: Partial<AIToolCall>) => {
        const msg = useStore.getState().aiMessages.find((m) => m.id === assistantId);
        if (!msg || !msg.toolCalls) return;
        const next = msg.toolCalls.map((t, idx) =>
          idx === i ? { ...t, ...patch } : t,
        );
        useStore.getState().updateAIMessage(assistantId, { toolCalls: next });
      };

      useStore.getState().setAIStatus('running_tool', statusLabelFor(tc));

      // If this `escribir_archivo` was already streamed live into the
      // editor (and saved by `agentStreamFinalizeTab`), skip the redundant
      // write but still push a synthetic result so the model loop
      // continues coherently.
      const ruta = String(tc.args.ruta || '');
      if (
        tc.name === 'escribir_archivo' &&
        ruta &&
        streamedRutas.has(ruta)
      ) {
        refreshTool({ done: true, paths: [ruta] });
        pendingResults.push({
          resultText: `Archivo ${ruta} escrito mediante streaming en tiempo real (${(
            String(tc.args.contenido ?? '')
          ).length} bytes).`,
        });
        continue;
      }

      const exec = await executeTool(workspacePath, tc);
      refreshTool({
        done: true,
        paths: exec.paths,
        rejected: exec.rejected,
        error: exec.error,
      });
      pendingResults.push({ resultText: exec.result });
    }

    useStore.getState().setAIStatus('streaming', 'Procesando resultados…');
  }

  pushSystemNotice(`Se alcanzó el límite de ${MAX_STEPS} pasos.`);
  useStore.getState().setAIStatus('idle');
}

/** /init — generate PROJECT.md by asking the model to summarise the project. */
async function runInit(): Promise<void> {
  const store = useStore.getState();
  const ws = store.workspacePath;
  const provider = store.aiActiveProvider;
  const model = store.aiActiveModel;
  if (!ws || !provider || !model) {
    pushSystemNotice('Falta workspace, proveedor o modelo.');
    return;
  }

  store.addAIMessage({
    id: makeId('u'),
    role: 'user',
    content: '/init',
  });
  const initMsgId = makeId('a');
  store.addAIMessage({
    id: initMsgId,
    role: 'assistant',
    content: '',
    streaming: true,
  });
  store.setAIStatus('initializing', 'Inspeccionando el proyecto y generando PROJECT.md…');

  // 1) Gather initial context for the model.
  let init: { tree: string; manifestFiles: { relPath: string; content: string }[] };
  try {
    init = await window.electronAPI.agent.initContext(ws);
  } catch (err) {
    store.updateAIMessage(initMsgId, {
      streaming: false,
      error: (err as Error).message,
    });
    store.setAIStatus('idle');
    return;
  }

  const systemPrompt = buildInitSystemPrompt({
    workspacePath: ws,
    tree: init.tree,
    manifestFiles: init.manifestFiles,
  });

  // 2) Stream the model.
  const { raw, error } = await streamSingleTurn({
    provider,
    model,
    chatMessages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: 'Genera ahora el archivo PROJECT.md usando la herramienta escribir_archivo.',
      },
    ],
    assistantMessageId: initMsgId,
    onDelta: (text) => useStore.getState().appendToAIMessage(initMsgId, text),
  });

  if (error) {
    store.updateAIMessage(initMsgId, { streaming: false, error });
    store.setAIStatus('idle');
    return;
  }

  const parsed = parseAssistantTurn(raw);
  store.updateAIMessage(initMsgId, {
    streaming: false,
    content: parsed.visibleText || 'Voy a generar PROJECT.md.',
    toolCalls: parsed.toolCalls.map(
      (tc): AIToolCall => ({
        name: tc.name,
        args: tc.args,
        statusLabel: statusLabelFor(tc),
        done: false,
      }),
    ),
  });

  // 3) Find the escribir_archivo tool call for PROJECT.md and apply it
  //    directly (no diff confirmation needed during /init — the user
  //    explicitly asked for it).
  const writeCalls = parsed.toolCalls.filter(
    (t) => t.name === 'escribir_archivo',
  );
  if (writeCalls.length === 0) {
    pushSystemNotice('El modelo no devolvió un PROJECT.md. Intenta /init de nuevo.');
    store.setAIStatus('idle');
    return;
  }

  // Force the destination to PROJECT.md at the workspace root to keep things
  // predictable.
  const writeCall = writeCalls[0];
  const contenido = String(writeCall.args.contenido ?? '');
  try {
    await window.electronAPI.agent.escribirArchivo(ws, 'PROJECT.md', contenido);
    // Create `.forge/` directory and an empty `history.json` so the
    // per-project conversation persistence kicks in immediately.
    try {
      await window.electronAPI.forge.ensureForgeDir(ws);
    } catch (err) {
      console.warn(
        '[forge] ensureForgeDir failed during /init:',
        (err as Error)?.message,
      );
    }
    store.updateAIMessage(initMsgId, {
      toolCalls: parsed.toolCalls.map(
        (tc, idx): AIToolCall => ({
          name: tc.name,
          args: tc.args,
          statusLabel: statusLabelFor(tc),
          done: true,
          paths: idx === 0 ? ['PROJECT.md'] : undefined,
        }),
      ),
    });
    store.setAIInitDone(true);
    pushSystemNotice(
      'PROJECT.md generado. Ya puedes pedir al agente cualquier tarea sobre este proyecto.',
    );
    // Persist the /init conversation immediately so the user sees their
    // history on the next session.
    try {
      await useStore.getState().saveProjectHistory();
    } catch (err) {
      console.debug(
        '[forge] saveProjectHistory after /init failed:',
        (err as Error)?.message,
      );
    }
  } catch (err) {
    pushSystemNotice(`No se pudo crear PROJECT.md: ${(err as Error).message}`);
  }
  store.setAIStatus('idle');
}

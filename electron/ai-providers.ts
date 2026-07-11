/**
 * AI providers — main-process HTTP wrappers for listing models and streaming
 * chat completions for the supported LLM vendors.
 *
 * All network calls live in the main process to bypass the renderer's
 * built-in CORS enforcement. The renderer talks to us exclusively via the
 * IPC handlers wired up in main.ts.
 */

import * as https from 'https';
import { URL } from 'url';

// ─── Friendly error translation ──────────────────────────────────────────
//
// Vendors return JSON error bodies with status codes that we want to
// surface to the user as concise Spanish messages, *not* as raw JSON.
function friendlyHttpError(
  providerName: string,
  status: number,
  rawBody: string,
): Error {
  // Try to parse the error body, but never crash on malformed payloads.
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    /* keep raw */
  }
  const errObj = parsed?.error || parsed?.message ? parsed.error || parsed : null;
  const errCode: string = (errObj?.code || errObj?.type || '').toString().toLowerCase();
  const errMsg: string = (errObj?.message || '').toString();

  // Detect quota/billing exhaustion. OpenAI uses `insufficient_quota`,
  // Anthropic returns 429 with overloaded_error, etc.
  const isQuota =
    status === 429 ||
    errCode.includes('insufficient_quota') ||
    errCode.includes('quota') ||
    /quota|billing|exceeded/i.test(errMsg);
  if (isQuota) {
    return new Error(
      `Sin créditos disponibles en ${providerName}. Revisá tu plan y facturación en la página del proveedor.`,
    );
  }

  // Invalid API key — 401 / invalid_api_key / authentication_error.
  if (
    status === 401 ||
    status === 403 ||
    errCode.includes('invalid_api_key') ||
    errCode.includes('authentication') ||
    /api key|unauthorized|authentication/i.test(errMsg)
  ) {
    return new Error(
      `La clave de API de ${providerName} no es válida o ha expirado. Revisala en la configuración.`,
    );
  }

  // Model not found / not supported on this endpoint.
  if (
    status === 404 ||
    errCode.includes('model_not_found') ||
    /not.*chat model|not.*supported.*endpoint|model.*does not exist/i.test(errMsg)
  ) {
    return new Error(
      `El modelo seleccionado no está disponible en ${providerName}. Elegí otro modelo de la lista.`,
    );
  }

  // Rate limit (without quota exhaustion).
  if (status === 429) {
    return new Error(
      `Demasiadas solicitudes a ${providerName}. Esperá unos segundos antes de intentar de nuevo.`,
    );
  }

  // Server errors.
  if (status >= 500) {
    return new Error(
      `${providerName} tuvo un problema del servidor (HTTP ${status}). Intentá de nuevo en unos minutos.`,
    );
  }

  // Generic fallback — keep it short and human readable.
  const short = errMsg || rawBody.slice(0, 240);
  return new Error(`${providerName} respondió con un error (HTTP ${status}): ${short}`);
}

function providerDisplayName(provider: ProviderId): string {
  const found = PROVIDERS.find((p) => p.id === provider);
  return found ? found.name : provider;
}

// ─── Types ────────────────────────────────────────────────────────────────

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'qwen'
  | 'kimi';

export interface ProviderInfo {
  id: ProviderId;
  /** Human-readable name (Spanish UI). */
  name: string;
  /** Endpoint hint shown in the API-key modal. */
  hint?: string;
  /** If true, model listing is unavailable and we return a hard-coded list. */
  staticModels?: string[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    hint: 'api.openai.com',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    hint: 'api.anthropic.com',
    // Anthropic does expose GET /v1/models, but we keep a static list of
    // canonical aliases so the dropdown stays predictable across plans and
    // regions where the API may return different snapshots.
    staticModels: [
      'claude-opus-4-1-20250805',
      'claude-opus-4-20250514',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-20250514',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307',
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    hint: 'generativelanguage.googleapis.com',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    hint: 'api.deepseek.com',
  },
  {
    id: 'qwen',
    name: 'Qwen (Alibaba DashScope)',
    hint: 'dashscope.aliyuncs.com',
    staticModels: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    hint: 'api.moonshot.cn',
  },
];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamHandlers {
  /** Called with each delta of plain text content. */
  onDelta: (text: string) => void;
  /** Called when the stream ends successfully. */
  onDone: () => void;
  /** Called on any error (network, HTTP, parse). */
  onError: (error: Error) => void;
}

export interface StreamHandle {
  /** Abort the request and stop emitting deltas. */
  abort: () => void;
}

// ─── HTTPS helpers ────────────────────────────────────────────────────────

interface JsonRequestOpts {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Fail with an error after `timeoutMs` of total wall time. */
  timeoutMs?: number;
}

function jsonRequest(url: string, opts: JsonRequestOpts = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const req = https.request(
      {
        method: opts.method || 'GET',
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        headers: opts.headers || {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (opts.timeoutMs) {
      req.setTimeout(opts.timeoutMs, () => {
        req.destroy(new Error('Tiempo de espera agotado.'));
      });
    }
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * Lower-level streaming POST. Calls `onChunk` with raw text fragments as
 * they arrive. Returns a handle with `abort()`.
 */
function streamRequest(
  url: string,
  opts: {
    method?: 'POST' | 'GET';
    headers: Record<string, string>;
    body?: string;
    /** Human-readable provider label used to format error messages. */
    providerName: string;
    onChunk: (chunk: string) => void;
    onEnd: () => void;
    onError: (err: Error) => void;
  },
): StreamHandle {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    opts.onError(err as Error);
    return { abort: () => undefined };
  }

  const req = https.request(
    {
      method: opts.method || 'POST',
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      headers: opts.headers,
    },
    (res) => {
      const status = res.statusCode || 0;
      if (status < 200 || status >= 300) {
        // Collect the error body and produce a friendly Spanish message.
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          opts.onError(friendlyHttpError(opts.providerName, status, body));
        });
        return;
      }
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => {
        opts.onChunk(chunk);
      });
      res.on('end', () => opts.onEnd());
      res.on('error', (err) => opts.onError(err));
    },
  );

  req.on('error', (err) => opts.onError(err));
  if (opts.body) req.write(opts.body);
  req.end();

  return {
    abort: () => {
      try {
        req.destroy();
      } catch {
        /* noop */
      }
    },
  };
}

// ─── SSE helper ───────────────────────────────────────────────────────────
//
// All providers use Server-Sent Events for streaming. We accumulate raw
// chunks into a buffer and emit completed "data: <json>" lines to the
// caller.
function makeSseParser(onEvent: (data: string) => void) {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let idx: number;
    // SSE events are delimited by a blank line (\n\n). We process each
    // complete event and keep the trailing partial in the buffer.
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      // Each event can contain multiple "data:" lines; concatenate them.
      const dataLines = event
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart());
      if (dataLines.length > 0) {
        onEvent(dataLines.join('\n'));
      }
    }
  };
}

// ─── Model listing ────────────────────────────────────────────────────────

export async function listModels(
  provider: ProviderId,
  apiKey: string,
): Promise<string[]> {
  if (!apiKey) throw new Error('Falta la clave de API.');

  switch (provider) {
    case 'openai': {
      const { status, body } = await jsonRequest(
        'https://api.openai.com/v1/models',
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeoutMs: 20000,
        },
      );
      if (status !== 200) throw friendlyHttpError('OpenAI', status, body);
      const parsed = JSON.parse(body);
      const ids: string[] = (parsed.data || []).map((m: any) => m.id).filter(Boolean);

      // ── BLACKLIST APPROACH ─────────────────────────────────────────────
      //
      // The `/v1/models` endpoint returns *every* model the key has access
      // to. Rather than maintaining a strict whitelist (which hides valid
      // new chat models the moment OpenAI releases them), we allow every
      // model by default and only exclude known non-chat families:
      // embeddings, audio (whisper/tts/realtime), images (dall-e),
      // moderation, search, legacy completion (babbage/curie/davinci/ada),
      // and the `-instruct` suffix that marks completion-only models.
      //
      // All comparisons are case-insensitive via `.toLowerCase()`.
      const chat = ids.filter((id) => {
        const lower = id.toLowerCase();

        // Embedding models — `text-embedding-3-large`, `…-ada-002`, etc.
        // Checking for "embed" already covers "embedding".
        if (lower.includes('embed')) return false;

        // Audio / speech models.
        if (lower.includes('whisper')) return false;
        if (lower.includes('tts')) return false;
        if (lower.includes('audio')) return false;
        if (lower.includes('transcrib')) return false;
        if (lower.includes('realtime')) return false;

        // Image generation models — `dall-e-3`, `dall-e-2`, `gpt-image-1`.
        if (lower.includes('dall')) return false;
        if (lower.includes('image')) return false;

        // Moderation models — `text-moderation-007`, `omni-moderation-…`.
        if (lower.includes('moderation')) return false;

        // Web-search / browsing variants — `gpt-4o-search-preview`.
        if (lower.includes('search')) return false;

        // Legacy edit-only models — `code-davinci-edit-001`, etc.
        if (lower.includes('-edit')) return false;

        // Legacy completion-only base models.
        if (lower.includes('babbage')) return false;
        if (lower.includes('davinci')) return false;
        if (lower.includes('curie')) return false;
        // `ada` must match only as a standalone token (separated by `-`,
        // `_`, `.` or string boundaries) so we don't accidentally trip on
        // a future model that contains "ada" inside another word.
        if (/(^|[-_.])ada([-_.]|$)/.test(lower)) return false;

        // Instruction-tuned non-chat completion models — e.g.
        // `gpt-3.5-turbo-instruct`.
        if (lower.endsWith('-instruct')) return false;

        return true;
      });

      // Rank with the newest / canonical models on top so the dropdown
      // shows the most useful options first.
      // Priority order: gpt-4o > gpt-4 > o4 > o3 > o1 > chatgpt > gpt-3.5.
      // The `gpt-4o` check must come before `gpt-4` because `gpt-4o`
      // also starts with `gpt-4`.
      const ranked = chat.sort((a, b) => {
        const score = (id: string): number => {
          const lower = id.toLowerCase();
          if (lower.startsWith('gpt-4o')) return 1;
          if (lower.startsWith('gpt-4')) return 2;
          if (lower.startsWith('o4')) return 3;
          if (lower.startsWith('o3')) return 4;
          if (lower.startsWith('o1')) return 5;
          if (lower.startsWith('chatgpt')) return 6;
          if (lower.startsWith('gpt-3.5')) return 7;
          return 10;
        };
        const sa = score(a);
        const sb = score(b);
        if (sa !== sb) return sa - sb;
        return a.localeCompare(b);
      });
      return ranked;
    }

    case 'anthropic': {
      // Anthropic doesn't expose a public /v1/models endpoint.
      return PROVIDERS.find((p) => p.id === 'anthropic')!.staticModels!;
    }

    case 'google': {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const { status, body } = await jsonRequest(url, { timeoutMs: 20000 });
      if (status !== 200) throw friendlyHttpError('Google Gemini', status, body);
      const parsed = JSON.parse(body);
      // Whitelist only models that support `generateContent` AND belong to
      // the chat-capable Gemini families (1.5, 2.0, 2.5 — flash, pro and
      // their dated variants). Exclude embedding, aqa, image generation,
      // tts, and any other specialised model.
      const GEMINI_CHAT = /^gemini-(1\.5|2\.0|2\.5)-(flash|pro)/i;
      const GEMINI_BLOCKLIST = /(embedding|aqa|image|tts|live|vision-only)/i;
      const models: string[] = (parsed.models || [])
        .filter((m: any) =>
          Array.isArray(m.supportedGenerationMethods)
            ? m.supportedGenerationMethods.includes('generateContent')
            : true,
        )
        .map((m: any) => {
          const name = (m.name || '') as string;
          return name.startsWith('models/') ? name.slice('models/'.length) : name;
        })
        .filter(Boolean)
        .filter((id: string) => !GEMINI_BLOCKLIST.test(id) && GEMINI_CHAT.test(id));
      return models.sort();
    }

    case 'deepseek': {
      const { status, body } = await jsonRequest(
        'https://api.deepseek.com/models',
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeoutMs: 20000,
        },
      );
      if (status !== 200) throw friendlyHttpError('DeepSeek', status, body);
      const parsed = JSON.parse(body);
      // DeepSeek currently exposes `deepseek-chat` (V3) and `deepseek-reasoner` (R1).
      // Both are chat-compatible. Future-proof with a prefix whitelist.
      const ids: string[] = (parsed.data || []).map((m: any) => m.id).filter(Boolean);
      return ids
        .filter((id: string) => /^deepseek-(chat|reasoner|coder|v\d|r\d)/i.test(id))
        .sort();
    }

    case 'qwen': {
      return PROVIDERS.find((p) => p.id === 'qwen')!.staticModels!;
    }

    case 'kimi': {
      const { status, body } = await jsonRequest(
        'https://api.moonshot.cn/v1/models',
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeoutMs: 20000,
        },
      );
      if (status !== 200) throw friendlyHttpError('Kimi (Moonshot)', status, body);
      const parsed = JSON.parse(body);
      // Moonshot's models are all chat-compatible (moonshot-v1-{8k,32k,128k},
      // kimi-k1-*, kimi-k2-*, etc.). Exclude any future embedding/audio
      // variants defensively.
      const ids: string[] = (parsed.data || []).map((m: any) => m.id).filter(Boolean);
      const KIMI_BLOCKLIST = /(embedding|audio|tts|whisper|image|vision-only)/i;
      return ids
        .filter((id: string) => !KIMI_BLOCKLIST.test(id))
        .filter((id: string) => /^(moonshot-|kimi-)/i.test(id))
        .sort();
    }
  }
}

// ─── Streaming chat ───────────────────────────────────────────────────────

/** Splits a flat ChatMessage array into Anthropic/Gemini system + history. */
function splitSystem(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
  const sys: string[] = [];
  const rest: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') sys.push(m.content);
    else rest.push(m);
  }
  return { system: sys.join('\n\n'), rest };
}

export function streamChat(opts: {
  provider: ProviderId;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  handlers: StreamHandlers;
}): StreamHandle {
  const { provider, apiKey, model, messages, handlers } = opts;
  if (!apiKey) {
    handlers.onError(new Error('Falta la clave de API.'));
    return { abort: () => undefined };
  }
  if (!model) {
    handlers.onError(new Error('No se ha seleccionado ningún modelo.'));
    return { abort: () => undefined };
  }

  // OpenAI-compatible providers (OpenAI, DeepSeek, Qwen, Kimi).
  if (provider === 'openai' || provider === 'deepseek' || provider === 'qwen' || provider === 'kimi') {
    const url =
      provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : provider === 'deepseek'
        ? 'https://api.deepseek.com/chat/completions'
        : provider === 'qwen'
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
        : 'https://api.moonshot.cn/v1/chat/completions';

    const body = JSON.stringify({
      model,
      messages,
      stream: true,
    });

    const parser = makeSseParser((data) => {
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          handlers.onDelta(delta);
        }
      } catch {
        /* ignore malformed sse fragments */
      }
    });

    return streamRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      providerName: providerDisplayName(provider),
      onChunk: parser,
      onEnd: () => handlers.onDone(),
      onError: (err) => handlers.onError(err),
    });
  }

  if (provider === 'anthropic') {
    const { system, rest } = splitSystem(messages);
    const body = JSON.stringify({
      model,
      max_tokens: 4096,
      system: system || undefined,
      messages: rest.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      stream: true,
    });

    const parser = makeSseParser((data) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta') {
          const delta = parsed.delta?.text;
          if (typeof delta === 'string' && delta.length > 0) handlers.onDelta(delta);
        } else if (parsed.type === 'message_stop') {
          // handled at SSE end
        } else if (parsed.type === 'error' && parsed.error?.message) {
          handlers.onError(new Error(parsed.error.message));
        }
      } catch {
        /* ignore */
      }
    });

    return streamRequest('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
      providerName: 'Anthropic',
      onChunk: parser,
      onEnd: () => handlers.onDone(),
      onError: (err) => handlers.onError(err),
    });
  }

  if (provider === 'google') {
    const { system, rest } = splitSystem(messages);
    // Gemini expects `contents` (user/model turns).
    const contents = rest.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const body: any = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    const parser = makeSseParser((data) => {
      try {
        const parsed = JSON.parse(data);
        const parts = parsed.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (typeof p.text === 'string' && p.text.length > 0) {
              handlers.onDelta(p.text);
            }
          }
        }
      } catch {
        /* ignore */
      }
    });

    return streamRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
      providerName: 'Google Gemini',
      onChunk: parser,
      onEnd: () => handlers.onDone(),
      onError: (err) => handlers.onError(err),
    });
  }

  handlers.onError(new Error(`Proveedor desconocido: ${provider}`));
  return { abort: () => undefined };
}

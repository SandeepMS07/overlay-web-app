import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ProviderId } from '@/lib/providers';

export const SYSTEM_PROMPT = [
  'You are a fast assistant living in a small always-on-top overlay window on the',
  "user's desktop. Answer the question directly: lead with the answer, then add only",
  'the detail that changes what the reader would do next.',
  'The window is small, so keep responses short enough to read without scrolling —',
  'short paragraphs, no headers unless the answer genuinely is a list, and minimal code.',
  'If you are unsure of something, say so plainly rather than padding the answer.',
].join(' ');

const MAX_TOKENS = 8192;

type StreamOptions = {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
};

// ---------------------------------------------------------------- Anthropic

/**
 * Claude via the official SDK. Thinking is left on (its default on Opus 5) at
 * low effort — disabling it can leak `<thinking>` tags into the visible reply.
 */
async function* runAnthropic(opts: StreamOptions, withFallbacks: boolean): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: opts.apiKey });

  const params = {
    model: opts.model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    output_config: { effort: 'low' },
    // Claude's safety classifiers can decline a request outright; the server-side
    // fallback re-runs it on another model instead of returning nothing.
    ...(withFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  };

  // The SDK's types lag the newest beta parameters, so the params object is
  // built untyped and checked by the API instead.
  const stream = client.beta.messages.stream(params as never, { signal: opts.signal });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }

  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') {
    throw new Error('Claude declined to answer this one.');
  }
}

async function* streamAnthropic(opts: StreamOptions): AsyncGenerator<string> {
  let produced = false;
  try {
    for await (const chunk of runAnthropic(opts, true)) {
      produced = true;
      yield chunk;
    }
    return;
  } catch (err) {
    // A 400 is what an account or SDK that doesn't accept the fallback beta
    // returns, so retry that once without it. Anything else — bad key, rate
    // limit, unknown model — would fail identically the second time, and
    // retrying would just bill the request twice.
    // An abort is the user pressing stop — pass it through untouched so the
    // route stays silent instead of reporting a failure.
    if (isAbort(err)) throw err;
    const retryable = err instanceof Anthropic.BadRequestError && !produced;
    if (!retryable) throw new Error(describeAnthropicError(err));
  }

  try {
    for await (const chunk of runAnthropic(opts, false)) yield chunk;
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new Error(describeAnthropicError(err));
  }
}

function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Claude rejected the API key (401). Check it in settings.';
  }
  if (err instanceof Anthropic.NotFoundError) {
    return 'Claude does not recognise that model name.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Claude rate limit reached. Wait a moment and try again.';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach Claude. Check your connection.';
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// ------------------------------------------------------------------- OpenAI

/**
 * OPENAI_BASE_URL points this at any OpenAI-compatible endpoint — a local
 * model server, Azure OpenAI, OpenRouter — without changing the code.
 */
const OPENAI_BASE = process.env.OPENAI_BASE_URL?.replace(/\/+$/, '') || 'https://api.openai.com/v1';

async function* streamOpenAI(opts: StreamOptions): AsyncGenerator<string> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      max_completion_tokens: MAX_TOKENS,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...opts.messages],
    }),
  });

  if (!res.ok || !res.body) throw new Error(await describeHttpError(res, 'OpenAI'));

  for await (const data of sseData(res.body)) {
    if (data === '[DONE]') return;
    const delta = safeJson<{ choices?: { delta?: { content?: string } }[] }>(data)?.choices?.[0]
      ?.delta?.content;
    if (delta) yield delta;
  }
}

// ------------------------------------------------------------------- Gemini

async function* streamGemini(opts: StreamOptions): AsyncGenerator<string> {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`;

  const res = await fetch(endpoint, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      // Gemini calls the assistant role "model".
      contents: opts.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
  });

  if (!res.ok || !res.body) throw new Error(await describeHttpError(res, 'Gemini'));

  type GeminiChunk = { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  for await (const data of sseData(res.body)) {
    const parts = safeJson<GeminiChunk>(data)?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.text) yield part.text;
    }
  }
}

// ------------------------------------------------------------------ helpers

/** Yields the payload of each `data:` line in an SSE response body. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are newline-delimited; the last element may be a partial line.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function describeHttpError(res: Response, label: string): Promise<string> {
  const body = await res.text().catch(() => '');
  const message = safeJson<{ error?: { message?: string } }>(body)?.error?.message;
  if (res.status === 401 || res.status === 403) {
    return `${label} rejected the API key (${res.status}). Check it in settings.`;
  }
  if (res.status === 404) {
    return `${label} does not recognise that model name.`;
  }
  if (res.status === 429) {
    return `${label} rate limit reached. Wait a moment and try again.`;
  }
  return message ? `${label}: ${message}` : `${label} request failed (${res.status}).`;
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError');
}

export function streamChat(provider: ProviderId, opts: StreamOptions): AsyncGenerator<string> {
  if (provider === 'anthropic') return streamAnthropic(opts);
  if (provider === 'openai') return streamOpenAI(opts);
  return streamGemini(opts);
}

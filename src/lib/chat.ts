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
  /** Rendered reference documents, prepended to the system prompt. */
  documents?: string;
  /** Let the model search the web before answering. */
  webSearch?: boolean;
  /** Apply the hard length ceiling; used for local models. */
  brief?: boolean;
  /** Answer in the first person as the user. */
  speakAsMe?: boolean;
  /**
   * Passed straight through to the endpoint. Ollama uses it to switch a
   * reasoning model's thinking off — 'none' is the only value that works, and
   * `think: false` / `chat_template_kwargs` are both ignored there.
   */
  reasoningEffort?: string;
  signal?: AbortSignal;
};

/**
 * Local models are chattier than the hosted ones and ignore a general "be
 * brief" hint, so they get an explicit ceiling. Headings and rules are banned
 * because they waste vertical space in a window a few hundred pixels tall.
 */
const BREVITY_NOTE =
  'Answer in at most 120 words unless the user asks for more. Never use headings, ' +
  'horizontal rules, or bold section titles — plain sentences and, at most, a short list.';

/**
 * First-person mode. The anti-fabrication clause is the important half: without
 * it a model asked to speak as someone will invent plausible detail, and a
 * confident invention about your own history is worse than an admission.
 */
const PERSONA_NOTE =
  'Answer in the first person as the user themselves, treating the background material ' +
  'as your own experience: "I built…", never "Sandeep built…" and never "the documents say". ' +
  'Lead with the direct answer in one or two sentences. ' +
  'Never invent a fact about yourself. Contact details, employers, dates, numbers, ' +
  'links and names must be quoted exactly from the background material and nowhere else. ' +
  'If the material does not contain the answer, say "I would need to check that" — ' +
  'a wrong detail stated confidently is far worse than admitting you do not have it.';

const WEB_SEARCH_NOTE =
  'You can search the web. Do so when the question depends on current information ' +
  'or on anything you are not sure of, and name the source in your answer.';

function systemPrompt(opts: StreamOptions): string {
  return [
    SYSTEM_PROMPT,
    opts.speakAsMe ? PERSONA_NOTE : '',
    opts.brief ? BREVITY_NOTE : '',
    opts.webSearch ? WEB_SEARCH_NOTE : '',
    opts.documents ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * OpenAI's regular chat models cannot search at all — web search lives either in
 * the Responses API or in these dedicated Chat Completions models, which always
 * search before answering. Swapping the model keeps the streaming path that is
 * already in use here rather than introducing a second response format.
 */
const OPENAI_SEARCH_MODEL = process.env.OPENAI_SEARCH_MODEL || 'gpt-5-search-api';

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
    system: systemPrompt(opts),
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    output_config: { effort: 'low' },
    // Server-side tool: Anthropic runs the search, so there is no tool loop to
    // implement here. Non-text blocks in the stream are simply not yielded.
    ...(opts.webSearch ? { tools: [{ type: 'web_search_20260209', name: 'web_search' }] } : {}),
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

/**
 * Ollama speaks the OpenAI chat-completions dialect, so a local model needs a
 * different base URL rather than a different implementation. It ignores the
 * Authorization header, but the header has to be present.
 */
export const LOCAL_BASE =
  process.env.OLLAMA_BASE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:11434/v1';

async function* streamOpenAI(
  opts: StreamOptions,
  base = OPENAI_BASE,
  label = 'OpenAI'
): AsyncGenerator<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.webSearch ? OPENAI_SEARCH_MODEL : opts.model,
      stream: true,
      max_completion_tokens: MAX_TOKENS,
      ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
      messages: [{ role: 'system', content: systemPrompt(opts) }, ...opts.messages],
    }),
  });

  if (!res.ok || !res.body) throw new Error(await describeHttpError(res, label));

  for await (const data of sseData(res.body)) {
    if (data === '[DONE]') return;
    const delta = safeJson<{ choices?: { delta?: { content?: string } }[] }>(data)?.choices?.[0]
      ?.delta?.content;
    if (delta) yield delta;
  }
}

/** The models actually present on this machine, for use in error messages. */
async function installedModels(): Promise<string[]> {
  try {
    const res = await fetch(`${LOCAL_BASE.replace(/\/v1\/?$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name?: string }[] };
    return (data.models ?? []).map((m) => m.name ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

async function* streamLocal(opts: StreamOptions): AsyncGenerator<string> {
  try {
    yield* streamOpenAI(
      // No reasoning_effort override. On a reasoning model such as qwen3,
      // asking Ollama to switch thinking off does not remove the reasoning —
      // it moves it out of the hidden field and into the visible answer, which
      // is measurably worse. Left alone, thinking stays hidden; the real fix
      // for latency is to point this at an instruct model that does not reason.
      { ...opts, webSearch: false, brief: true },
      LOCAL_BASE,
      'Ollama'
    );
  } catch (err) {
    const message = (err as Error)?.message ?? '';

    // A refused connection means the daemon is not up, which is by far the most
    // common local failure and deserves better than "fetch failed".
    if (err instanceof TypeError || message.includes('fetch failed')) {
      throw new Error(`No local model server on ${LOCAL_BASE}. Start it with: ollama serve`);
    }

    // "unknown model" is the other common one, and it usually means the pull has
    // not finished rather than that the name is wrong — so say what is actually
    // installed instead of leaving the user to guess.
    if (message.includes('does not recognise that model name')) {
      const have = await installedModels();
      throw new Error(
        `Ollama has no model named "${opts.model}". ` +
          (have.length ? `Installed: ${have.join(', ')}. ` : 'Nothing is installed yet. ') +
          `Pull it with: ollama pull ${opts.model}`
      );
    }

    throw err;
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
      systemInstruction: { parts: [{ text: systemPrompt(opts) }] },
      ...(opts.webSearch ? { tools: [{ google_search: {} }] } : {}),
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
  const parsed = safeJson<{ error?: { message?: string; code?: string; type?: string } }>(body);
  const message = parsed?.error?.message;
  const code = parsed?.error?.code ?? parsed?.error?.type ?? '';

  if (res.status === 401 || res.status === 403) {
    return `${label} rejected the API key (${res.status}). Check it in settings.`;
  }
  if (res.status === 404) {
    return `${label} does not recognise that model name.`;
  }
  if (res.status === 429) {
    // An exhausted balance also comes back as 429, but "wait a moment" is the
    // wrong advice for it — no amount of waiting adds credit.
    if (/insufficient_quota|billing|credit/i.test(`${code} ${message ?? ''}`)) {
      return `Your ${label} account is out of credit. Add billing on the provider's dashboard, or switch to a local model.`;
    }
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
  if (provider === 'local') return streamLocal(opts);
  return streamGemini(opts);
}

import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ProviderId } from '@/lib/providers';

/**
 * How to write, with nothing about who is writing. First-person mode replaces
 * the identity line below but keeps this — an answer given as yourself still
 * has to fit the window.
 */
const STYLE_NOTE = [
  'Answer the question directly: lead with the answer, then add only',
  'the detail that changes what the reader would do next.',
  'The window is small, so keep responses short enough to read without scrolling —',
  'short paragraphs, no headers unless the answer genuinely is a list, and minimal code.',
  'If you are unsure of something, say so plainly rather than padding the answer.',
].join(' ');

const ASSISTANT_NOTE =
  'You are a fast assistant living in a small always-on-top overlay window on the ' +
  "user's desktop.";

export const SYSTEM_PROMPT = `${ASSISTANT_NOTE} ${STYLE_NOTE}`;

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
  /** The user's own name, for first-person mode. */
  me?: string;
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
 * First-person mode.
 *
 * The name is stated outright rather than left to be retrieved. Told to speak
 * as "the user" with no name in the prompt, a model does not say it does not
 * know its own name — it takes the most name-shaped token nearby, which in
 * testing meant answering with the name of one of the user's own projects.
 * Retrieval cannot fix that: "what is your name" is a poor search query, and
 * identity has to be right on the first token of every answer, not only when
 * the right passage happens to rank.
 *
 * The anti-fabrication clause is the other half. A model asked to speak as
 * someone will invent plausible detail, and a confident invention about your
 * own history is worse than an admission.
 */
function personaNote(name?: string): string {
  const who = (name ?? '').trim();
  return [
    who
      ? `Your name is ${who}. You are a person, not an AI assistant, and asked who ` +
        'you are you give that name and nothing about being a model.'
      : 'You are the user themselves, not an AI assistant. Your name appears in the ' +
        'background material — use that one and never invent one.',
    'Answer in the first person, treating the background material as your own experience: ' +
      '"I built…", never "he built…" and never "the documents say".',
    'Lead with the direct answer in one or two sentences.',
    'Never invent a fact about yourself. Contact details, employers, dates, numbers, ' +
      'links and names must be quoted exactly from the background material and nowhere else. ' +
      'If the material does not contain the answer, say "I would need to check that" — ' +
      'a wrong detail stated confidently is far worse than admitting you do not have it.',
  ].join(' ');
}

const WEB_SEARCH_NOTE =
  'You can search the web. Do so when the question depends on current information ' +
  'or on anything you are not sure of, and name the source in your answer.';

function systemPrompt(opts: StreamOptions): string {
  return [
    // Mutually exclusive on purpose. Left in, "you are an assistant" and "you
    // are the user" are two identities in one prompt, and the model picks —
    // usually the assistant one, because that is what it was trained to be.
    opts.speakAsMe ? personaNote(opts.me) : ASSISTANT_NOTE,
    STYLE_NOTE,
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

/**
 * Attached images.
 *
 * All three hosted providers accept the same bytes and disagree only about the
 * envelope, so the data URL is split once here and re-wrapped per provider
 * below. Anything that is not a base64 image data URL is dropped rather than
 * forwarded — the route validates too, but a malformed URL reaching a provider
 * turns a paste into an opaque 400.
 */
function splitDataUrl(url: string): { mediaType: string; data: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(url.trim());
  return match ? { mediaType: match[1].toLowerCase(), data: match[2] } : null;
}

function imagesOf(message: ChatMessage): { mediaType: string; data: string }[] {
  return (message.images ?? [])
    .map(splitDataUrl)
    .filter((img): img is { mediaType: string; data: string } => img !== null);
}

/**
 * The text sent when a screenshot is pasted with nothing typed. Something has
 * to be there — every provider rejects an image-only turn with an empty text
 * block — and in an overlay used during a call, "answer what is on screen" is
 * what the paste meant.
 */
const IMAGE_ONLY_PROMPT = 'Answer the question in this screenshot.';

function textOf(message: ChatMessage): string {
  const text = message.content.trim();
  if (text) return message.content;
  return message.images?.length ? IMAGE_ONLY_PROMPT : message.content;
}

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
    messages: opts.messages.map((m) => {
      const images = imagesOf(m);
      if (images.length === 0) return { role: m.role, content: m.content };
      // Images before text: Claude reads a question about a picture better
      // when it has already seen the picture.
      return {
        role: m.role,
        content: [
          ...images.map((img) => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.data },
          })),
          { type: 'text', text: textOf(m) },
        ],
      };
    }),
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
      messages: [
        { role: 'system', content: systemPrompt(opts) },
        // Mapped rather than spread: ChatMessage carries an `images` field that
        // the endpoint does not know, and a stray key is a 400.
        ...opts.messages.map((m) => {
          const images = imagesOf(m);
          if (images.length === 0) return { role: m.role, content: m.content };
          return {
            role: m.role,
            content: [
              { type: 'text', text: textOf(m) },
              ...images.map((img) => ({
                type: 'image_url',
                image_url: { url: `data:${img.mediaType};base64,${img.data}` },
              })),
            ],
          };
        }),
      ],
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
        parts: [
          ...imagesOf(m).map((img) => ({
            inline_data: { mime_type: img.mediaType, data: img.data },
          })),
          { text: textOf(m) },
        ],
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

  const outOfCredit =
    `Your ${label} account is out of credit. ` +
    `Add billing on the provider's dashboard, or switch to a local model.`;

  if (res.status === 401 || res.status === 403) {
    // A disabled billing account is a 403 on Google, and "check your key" would
    // send the user to look at a key that is perfectly valid.
    if (/billing|payment|disabled/i.test(message ?? '')) return outOfCredit;
    return `${label} rejected the API key (${res.status}). Check it in settings.`;
  }
  if (res.status === 404) {
    return `${label} does not recognise that model name.`;
  }
  if (res.status === 429) {
    // An exhausted balance also comes back as 429, so the two have to be told
    // apart — but only by the machine-readable code, never by the prose.
    // Google's free-tier rate limit says "check your plan and billing details"
    // and means "wait a minute"; matching the word `billing` in a message
    // turned every free-tier throttle into "you are out of credit", which sent
    // people to a billing page to fix a problem that clears itself.
    if (/insufficient_quota/i.test(code)) return outOfCredit;
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

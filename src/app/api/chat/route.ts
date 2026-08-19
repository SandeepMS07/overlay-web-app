import { isAbort, streamChat } from '@/lib/chat';
import { docsContext } from '@/lib/docs';
import { isProviderId, PROVIDERS, type ChatMessage } from '@/lib/providers';
import { getKey } from '@/lib/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ChatRequest = {
  provider?: string;
  model?: string;
  messages?: ChatMessage[];
  webSearch?: boolean;
  speakAsMe?: boolean;
  me?: string;
};

/** Roughly 4 MB of decoded image, which is every provider's per-image ceiling. */
const MAX_IMAGE_CHARS = 6_000_000;
const MAX_IMAGES = 4;

/** Keep only well-formed base64 image data URLs, and not too many of them. */
function cleanImages(images: unknown): string[] | undefined {
  if (!Array.isArray(images)) return undefined;
  const kept = images
    .filter((url): url is string => typeof url === 'string')
    .filter((url) => /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(url))
    .filter((url) => url.length <= MAX_IMAGE_CHARS)
    .slice(0, MAX_IMAGES);
  return kept.length ? kept : undefined;
}

/**
 * Streams a reply as newline-delimited JSON events so the client can tell text
 * from failure mid-stream — a plain text stream has nowhere to put an error
 * that happens after the first token.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest;

  if (!isProviderId(body.provider)) {
    return jsonError('Pick a provider first.', 400);
  }

  const messages = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content, images: cleanImages(m.images) }));
  if (messages.length === 0) {
    return jsonError('Nothing to send.', 400);
  }

  const apiKey = await getKey(body.provider);
  if (!apiKey) {
    return jsonError(`Add your ${PROVIDERS[body.provider].label} API key in settings.`, 400);
  }

  const model = (body.model || '').trim() || PROVIDERS[body.provider].defaultModel;
  // Read once per turn rather than per token. An unreadable docs directory must
  // not take the whole answer down, so failures fall back to no context.
  // The latest user turn is the retrieval query — retrieval is about what was
  // just asked, not the whole conversation.
  const query = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const documents = await docsContext(query).catch(() => '');
  // A local model has no internet, so the flag is meaningless there.
  const webSearch = body.webSearch === true && !PROVIDERS[body.provider].offline;
  const speakAsMe = body.speakAsMe === true;
  const me = typeof body.me === 'string' ? body.me.trim().slice(0, 80) : '';
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        for await (const text of streamChat(body.provider as never, {
          apiKey,
          model,
          messages,
          documents,
          webSearch,
          speakAsMe,
          me,
          signal: request.signal,
        })) {
          send({ type: 'delta', text });
        }
        send({ type: 'done' });
      } catch (err) {
        if (!isAbort(err)) {
          send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Streaming through any intermediary should not be buffered.
      'X-Accel-Buffering': 'no',
    },
  });
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

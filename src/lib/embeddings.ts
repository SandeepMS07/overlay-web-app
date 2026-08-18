/**
 * Local embeddings via Ollama.
 *
 * An embedding turns a piece of text into a vector, so that "closeness" between
 * two texts becomes arithmetic. That is what lets a question retrieve only the
 * passages that actually bear on it, instead of sending whole documents every
 * turn.
 *
 * Every function here returns null rather than throwing when the daemon is not
 * running: retrieval is an optimisation, and losing it must never take the
 * answer down with it. lib/docs.ts falls back to sending the raw text.
 */
const OLLAMA_BASE =
  process.env.OLLAMA_BASE_URL?.replace(/\/v1\/?$/, '').replace(/\/+$/, '') ||
  'http://127.0.0.1:11434';

export const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

/**
 * Nomic's models are documented to take a task prefix, so we send one.
 *
 * Measured, though: on a 21-query retrieval check against this app's own
 * document format, prefixes changed nothing — 81% top-1 and 90% top-3 either
 * way, with the same misses. They do raise the absolute cosine scores, which is
 * easy to mistake for better retrieval; it is not, since only the ordering
 * matters. Kept because it is the model's documented contract, not because it
 * was shown to help. Other embedding models take no prefix.
 */
function withPrefix(texts: string[], kind: 'query' | 'document'): string[] {
  if (!/nomic/i.test(EMBED_MODEL)) return texts;
  const prefix = kind === 'query' ? 'search_query: ' : 'search_document: ';
  return texts.map((t) => prefix + t);
}

export async function embed(
  texts: string[],
  kind: 'query' | 'document' = 'document'
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: withPrefix(texts, kind) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    const vectors = data.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) return null;
    return vectors;
  } catch {
    return null;
  }
}

/**
 * Cosine similarity. The vectors nomic-embed-text returns are not unit length,
 * so the magnitudes have to be divided out rather than assumed away.
 */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Splits text into overlapping windows. The overlap matters: a fact that
 * straddles a boundary would otherwise be cut in half and match nothing.
 */
export function chunkText(text: string, size = 1200, overlap = 200): string[] {
  const clean = text.replace(/\s+\n/g, '\n').trim();
  if (clean.length <= size) return clean ? [clean] : [];

  const chunks: string[] = [];
  const stride = Math.max(1, size - overlap);
  for (let start = 0; start < clean.length; start += stride) {
    const piece = clean.slice(start, start + size).trim();
    if (piece) chunks.push(piece);
    if (start + size >= clean.length) break;
  }
  return chunks;
}

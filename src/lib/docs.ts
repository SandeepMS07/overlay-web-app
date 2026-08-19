import fs from 'node:fs/promises';
import path from 'node:path';
import { chunkText, cosine, embed } from '@/lib/embeddings';
import { bm25, interleave } from '@/lib/lexical';

/**
 * Reference documents the assistant can draw on — a CV, a project brief, notes.
 *
 * Text is extracted once at upload and stored as plain text next to a small
 * index. Nothing re-parses a PDF on every question, and every provider gets the
 * same plain-text context regardless of what each one's native file support
 * happens to be.
 */
const dataDir = process.env.APP_DATA_DIR || path.join(process.cwd(), '.data');
const DOCS_DIR = path.join(/* turbopackIgnore: true */ dataDir, 'docs');
const INDEX = path.join(DOCS_DIR, 'index.json');

export type DocMeta = {
  id: string;
  name: string;
  /** Size of the uploaded file. */
  bytes: number;
  /** Length of the extracted text, which is what actually reaches the model. */
  chars: number;
  addedAt: string;
  /** How many embedded chunks exist; 0 means this document is stuffed whole. */
  chunks?: number;
};

/** One embedded passage. */
type Chunk = { text: string; vec: number[] };

/** How many retrieved passages to send when retrieval is available. */
const TOP_K = 5;

/**
 * Retrieval gets a much smaller budget than the whole-document fallback. Every
 * character here is prompt the model must read before it can start answering,
 * and on a local model that is seconds of latency — the point of retrieving is
 * to send less, not to fill the same 80k with better-chosen text.
 */
const RETRIEVAL_CHARS = 6000;

/**
 * Storage ceiling per document. Generous on purpose: with retrieval, only a
 * handful of passages are ever sent, so a large reference document costs disk
 * rather than context. The limits that matter are the send-time ones below.
 */
const MAX_DOC_CHARS = 400_000;
/** Total ceiling across all documents for a single question. */
export const MAX_CONTEXT_CHARS = 80_000;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export class DocError extends Error {}

async function readIndex(): Promise<DocMeta[]> {
  try {
    const raw = await fs.readFile(INDEX, 'utf8');
    const parsed = JSON.parse(raw) as DocMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(docs: DocMeta[]): Promise<void> {
  await fs.mkdir(DOCS_DIR, { recursive: true });
  const tmp = `${INDEX}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(docs, null, 2), 'utf8');
  await fs.rename(tmp, INDEX);
}

export async function listDocs(): Promise<DocMeta[]> {
  return readIndex();
}

// --------------------------------------------------------------- extraction

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.rtf']);

function looksLikeText(name: string, type: string): boolean {
  if (type.startsWith('text/') || type === 'application/json') return true;
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function isPdf(name: string, type: string): boolean {
  return type === 'application/pdf' || path.extname(name).toLowerCase() === '.pdf';
}

async function extractText(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());

  if (isPdf(file.name, file.type)) {
    // unpdf bundles a serverless build of pdf.js, so there is no worker to set
    // up and nothing native to compile.
    const { extractText: extractPdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractPdfText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join('\n\n') : text;
    if (!merged.trim()) {
      throw new DocError(
        `"${file.name}" has no selectable text. If it is a scan, it needs OCR first.`
      );
    }
    return merged;
  }

  if (looksLikeText(file.name, file.type)) {
    // fatal:true so a mislabelled binary fails here rather than reaching the
    // model as a screenful of replacement characters.
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new DocError(`"${file.name}" is not valid UTF-8 text.`);
    }
  }

  throw new DocError(
    `Cannot read "${file.name}". Supported: PDF, and plain text such as .txt, .md, .csv or .json. ` +
      'For a .doc/.docx, export it to PDF first.'
  );
}

// ------------------------------------------------------------------ mutation

export async function addDoc(file: File): Promise<DocMeta> {
  if (file.size === 0) throw new DocError(`"${file.name}" is empty.`);
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new DocError(`"${file.name}" is larger than 10 MB.`);
  }

  const raw = await extractText(file);
  const text = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new DocError(`"${file.name}" contained no text.`);

  const clipped = text.slice(0, MAX_DOC_CHARS);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.writeFile(path.join(DOCS_DIR, `${id}.txt`), clipped, 'utf8');

  // Index for retrieval if a local embedding model is reachable. When it is
  // not, the document still works — docsContext() falls back to sending it
  // whole — so a missing daemon costs relevance, not function.
  const chunks = await indexDoc(id, clipped);

  const meta: DocMeta = {
    id,
    name: file.name,
    bytes: file.size,
    chars: clipped.length,
    addedAt: new Date().toISOString(),
    chunks,
  };

  await writeIndex([...(await readIndex()), meta]);
  return meta;
}

/**
 * Embeds one document's text and writes its vectors. Returns the chunk count,
 * or 0 when no embedder is reachable.
 */
async function indexDoc(id: string, text: string): Promise<number> {
  const pieces = chunkText(text);
  const vectors = await embed(pieces, 'document');
  if (!vectors) return 0;
  const payload: Chunk[] = pieces.map((t, i) => ({ text: t, vec: vectors[i] }));
  await fs.writeFile(path.join(DOCS_DIR, `${id}.vec.json`), JSON.stringify(payload), 'utf8');
  return payload.length;
}

/**
 * Re-chunks and re-embeds every stored document from its extracted text.
 *
 * Needed whenever the chunking or the embedding model changes: vectors written
 * by an older scheme are not comparable with new query vectors, and mixing them
 * silently degrades ranking rather than failing.
 */
export async function reindexAll(): Promise<DocMeta[]> {
  const docs = await readIndex();
  const next: DocMeta[] = [];
  for (const doc of docs) {
    try {
      const text = await fs.readFile(path.join(DOCS_DIR, `${doc.id}.txt`), 'utf8');
      next.push({ ...doc, chunks: await indexDoc(doc.id, text) });
    } catch {
      next.push(doc);
    }
  }
  await writeIndex(next);
  return next;
}

export async function removeDoc(id: string): Promise<void> {
  const docs = await readIndex();
  const next = docs.filter((doc) => doc.id !== id);
  if (next.length === docs.length) return;
  await writeIndex(next);
  await fs.rm(path.join(DOCS_DIR, `${id}.txt`), { force: true });
  await fs.rm(path.join(DOCS_DIR, `${id}.vec.json`), { force: true });
}

// ------------------------------------------------------------------- context

/**
 * Retrieval: embed the question, score every stored chunk against it, and keep
 * the closest few. Returns null when nothing is indexed or the embedder is
 * unreachable, which tells docsContext to fall back to sending whole documents.
 */
async function retrieve(query: string): Promise<string | null> {
  const docs = await readIndex();
  const indexed = docs.filter((doc) => (doc.chunks ?? 0) > 0);
  if (indexed.length === 0) return null;

  const queryVec = (await embed([query], 'query'))?.[0];
  if (!queryVec) return null;

  const pool: { name: string; text: string; dense: number }[] = [];
  for (const doc of indexed) {
    let chunks: Chunk[];
    try {
      chunks = JSON.parse(
        await fs.readFile(path.join(DOCS_DIR, `${doc.id}.vec.json`), 'utf8')
      ) as Chunk[];
    } catch {
      continue;
    }
    for (const chunk of chunks) {
      pool.push({ name: doc.name, text: chunk.text, dense: cosine(queryVec, chunk.vec) });
    }
  }
  if (pool.length === 0) return null;

  // Hybrid: the embedding ranking and a keyword ranking take turns. Dense alone
  // misses exact-term lookups — an address, a product name — because those
  // carry far more signal literally than they do in vector space.
  const lexicalScores = bm25(query, pool.map((p) => p.text));
  const order = interleave([pool.map((p) => p.dense), lexicalScores], TOP_K);
  const hits = order.map((i) => pool[i]);

  const sections: string[] = [];
  let budget = RETRIEVAL_CHARS;
  for (const hit of hits) {
    if (budget <= 0) break;
    const slice = hit.text.slice(0, budget);
    budget -= slice.length;
    sections.push(`<passage from="${hit.name}">\n${slice}\n</passage>`);
  }

  return [
    'Background material: passages from the user\'s own documents, most relevant',
    'first. They are authoritative about the user and their work. Use them when',
    'the question touches on the user or these documents; otherwise ignore them',
    'and answer normally from your own knowledge. Never refuse a question merely',
    'because these passages do not cover it. Never mention these passages, their',
    'filenames, or that you were given any context — answer as if you simply know.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

/**
 * The documents rendered for the system prompt.
 *
 * With a query and a reachable embedder this retrieves only the relevant
 * passages; otherwise it sends the documents whole, oldest first, truncated at
 * MAX_CONTEXT_CHARS so a large library cannot blow the context window.
 */
export async function docsContext(query?: string): Promise<string> {
  if (query?.trim()) {
    const retrieved = await retrieve(query).catch(() => null);
    if (retrieved) return retrieved;
  }

  const docs = await readIndex();
  if (docs.length === 0) return '';

  const sections: string[] = [];
  let budget = MAX_CONTEXT_CHARS;

  for (const doc of docs) {
    if (budget <= 0) break;
    let body: string;
    try {
      body = await fs.readFile(path.join(DOCS_DIR, `${doc.id}.txt`), 'utf8');
    } catch {
      continue; // index and files drifted apart; skip rather than fail the turn
    }
    const slice = body.slice(0, budget);
    budget -= slice.length;
    sections.push(`<document name="${doc.name}">\n${slice}\n</document>`);
  }

  if (sections.length === 0) return '';

  return [
    'Background material: documents the user has attached about themselves and',
    'their work. They are authoritative about the user. Use them when the question',
    'touches on the user or these documents; otherwise ignore them and answer',
    'normally from your own knowledge. Never refuse a question merely because',
    'these documents do not cover it. Never mention these documents, their',
    'filenames, or that you were given any context — answer as if you simply know.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

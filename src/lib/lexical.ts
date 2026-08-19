/**
 * BM25 keyword scoring, to sit alongside embedding search.
 *
 * Dense vectors match meaning and are poor at exact terms: "what is your email"
 * embeds nowhere near a line reading "Email: someone@example.com", and a proper
 * noun like Keycloak or Razorpay carries far more signal than its vector does.
 * BM25 is the opposite — it only matches literal terms — so the two are
 * complementary rather than redundant.
 */
const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','of','to','in','on','at','for','with','is','are','was',
  'were','be','been','do','does','did','you','your','yours','my','me','i','we','it','its','as',
  'that','this','these','those','what','which','who','how','when','where','why','can','could',
  'would','should','have','has','had','about','from','tell','give',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9@.+-]+/)
    .map((t) => t.replace(/^[.+-]+|[.+-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const K1 = 1.5;
const B = 0.75;

/**
 * Scores every document against the query. Returns one score per input, in
 * order, so the caller can fuse it with a dense ranking.
 */
export function bm25(query: string, documents: string[]): number[] {
  const terms = tokenize(query);
  if (terms.length === 0 || documents.length === 0) return documents.map(() => 0);

  const tokenized = documents.map(tokenize);
  const lengths = tokenized.map((t) => t.length);
  const avgLen = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1) || 1;

  // Document frequency per query term.
  const df = new Map<string, number>();
  for (const term of new Set(terms)) {
    let count = 0;
    for (const doc of tokenized) if (doc.includes(term)) count++;
    df.set(term, count);
  }

  const n = documents.length;
  return tokenized.map((doc, i) => {
    const counts = new Map<string, number>();
    for (const t of doc) counts.set(t, (counts.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of terms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      const documentFreq = df.get(term) ?? 0;
      const idf = Math.log(1 + (n - documentFreq + 0.5) / (documentFreq + 0.5));
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * lengths[i]) / avgLen)));
    }
    return score;
  });
}

/**
 * Merges rankings by taking from each in turn — first place from every ranker,
 * then second place from every ranker, and so on, skipping duplicates.
 *
 * Reciprocal rank fusion was tried first and was wrong for this: RRF rewards
 * consensus, so a passage placed mid-table by *both* rankers outscores one that
 * a single ranker puts first. That is exactly backwards for an exact-term
 * lookup — "what is your email" has one right answer, BM25 ranks it first, and
 * RRF buried it outside the top five. Round-robin guarantees each ranker its
 * pick.
 *
 * A zero score means the ranker found nothing, so it forfeits its turn rather
 * than injecting an unmatched passage.
 */
export function interleave(rankings: number[][], take: number): number[] {
  const orders = rankings.map((scores) =>
    scores
      .map((score, index) => ({ score, index }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.index)
  );

  const picked: number[] = [];
  const seen = new Set<number>();
  const deepest = Math.max(0, ...orders.map((o) => o.length));

  for (let position = 0; position < deepest && picked.length < take; position++) {
    for (const order of orders) {
      const index = order[position];
      if (index === undefined || seen.has(index)) continue;
      seen.add(index);
      picked.push(index);
      if (picked.length >= take) break;
    }
  }
  return picked;
}

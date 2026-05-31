/**
 * Lightweight text similarity for near-duplicate / repetition detection.
 *
 * Dependency-free and deterministic so it runs under `npm run verify:core`.
 * Uses word-level n-gram "shingles" + Jaccard similarity, which is robust to
 * small edits and reordering while staying cheap. (A production system might
 * swap in embeddings via pgvector; the interface here would not change.)
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "with",
  "is", "are", "be", "this", "that", "it", "as", "at", "by", "your", "you",
]);

/** Lowercase, strip punctuation, split into word tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ") // drop URLs
    .replace(/[#@]/g, " ") // hashtags/mentions -> words
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Build the set of word-level n-gram shingles. Falls back to the unigram set
 * when the text is shorter than `n` tokens, so short posts still compare.
 */
export function shingles(text: string, n = 3): Set<string> {
  const tokens = tokenize(text);
  if (tokens.length < n) {
    return new Set(tokens);
  }
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    out.add(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

/** Jaccard similarity (|A∩B| / |A∪B|) of two sets. Returns 0..1. */
export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Similarity of two texts (0..1). Blends 3-gram shingle Jaccard (phrasing) with
 * content-word unigram Jaccard (topic overlap) so it catches both near-verbatim
 * reposts and "same idea, reworded" repetition.
 */
export function textSimilarity(a: string, b: string): number {
  const shingleSim = jaccard(shingles(a, 3), shingles(b, 3));
  const wordSim = jaccard(contentWords(a), contentWords(b));
  return 0.7 * shingleSim + 0.3 * wordSim;
}

function contentWords(text: string): Set<string> {
  return new Set(tokenize(text).filter((t) => t.length > 2 && !STOPWORDS.has(t)));
}

export interface SimilarityMatch {
  /** Highest similarity found against any prior text (0..1). */
  score: number;
  /** Index of the most similar prior text, or -1 if none provided. */
  index: number;
}

/** Find the prior text most similar to `candidate`. */
export function maxSimilarity(candidate: string, priors: string[]): SimilarityMatch {
  let best: SimilarityMatch = { score: 0, index: -1 };
  for (let i = 0; i < priors.length; i++) {
    const score = textSimilarity(candidate, priors[i]!);
    if (score > best.score) {
      best = { score, index: i };
    }
  }
  return best;
}

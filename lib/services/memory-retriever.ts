/**
 * Memory Retriever Service
 *
 * BM25-based semantic retrieval for secretary memory system.
 * Replaces full memory injection with relevance-based retrieval.
 */

import type { MemoryEntry, MemoryDataV2 } from './secretary-memory';

// ========== Types ==========

export interface RetrievalResult {
  entry: MemoryEntry;
  score: number;
  layer: 'long_term';
}

export interface BM25Config {
  k1: number;
  b: number;
}

// ========== Tokenizer ==========

const CJK_REGEX = /[\u4e00-\u9fff]/;

/**
 * Tokenize text for BM25 indexing.
 * Chinese: character-level n-grams. English: whitespace-split lowercased words.
 */
export function tokenize(text: string, ngramSize: number = 2): string[] {
  if (!text || !text.trim()) {
    return [];
  }

  const tokens: string[] = [];
  let cjkBuffer = '';
  let asciiBuffer = '';

  for (const char of text) {
    if (CJK_REGEX.test(char)) {
      if (asciiBuffer) {
        tokens.push(...tokenizeAscii(asciiBuffer));
        asciiBuffer = '';
      }
      cjkBuffer += char;
    } else {
      if (cjkBuffer) {
        tokens.push(...generateNgrams(cjkBuffer, ngramSize));
        cjkBuffer = '';
      }
      asciiBuffer += char;
    }
  }

  if (cjkBuffer) tokens.push(...generateNgrams(cjkBuffer, ngramSize));
  if (asciiBuffer) tokens.push(...tokenizeAscii(asciiBuffer));

  return tokens;
}

function generateNgrams(text: string, n: number): string[] {
  const chars = [...text];
  if (chars.length < n) {
    return chars.length > 0 ? [chars.join('')] : [];
  }
  const ngrams: string[] = [];
  for (let i = 0; i <= chars.length - n; i++) {
    ngrams.push(chars.slice(i, i + n).join(''));
  }
  return ngrams;
}

function tokenizeAscii(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

// ========== BM25 Index ==========

export interface BM25Index {
  df: Map<string, number>;
  tf: Map<string, number>[];
  docLengths: number[];
  avgDocLen: number;
  totalDocs: number;
}

export function buildBM25Index(documents: string[]): BM25Index {
  const totalDocs = documents.length;
  const df = new Map<string, number>();
  const tf: Map<string, number>[] = [];
  const docLengths: number[] = [];

  for (const doc of documents) {
    const tokens = tokenize(doc);
    docLengths.push(tokens.length);

    const termFreq = new Map<string, number>();
    const seenTerms = new Set<string>();

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      seenTerms.add(token);
    }

    for (const term of seenTerms) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }

    tf.push(termFreq);
  }

  const avgDocLen =
    totalDocs > 0
      ? docLengths.reduce((sum, len) => sum + len, 0) / totalDocs
      : 0;

  return { df, tf, docLengths, avgDocLen, totalDocs };
}

export function scoreBM25(
  query: string,
  docIndex: number,
  index: BM25Index,
  config?: BM25Config,
): number {
  const k1 = config?.k1 ?? 1.5;
  const b = config?.b ?? 0.75;
  const { df, tf, docLengths, avgDocLen, totalDocs } = index;

  if (totalDocs === 0 || docIndex < 0 || docIndex >= totalDocs) return 0;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const docTf = tf[docIndex];
  const docLen = docLengths[docIndex];
  let score = 0;

  for (const term of queryTokens) {
    const termDf = df.get(term) ?? 0;
    const termTf = docTf.get(term) ?? 0;
    if (termTf === 0) continue;

    const idf = Math.log((totalDocs - termDf + 0.5) / (termDf + 0.5) + 1);
    const tfNorm =
      (termTf * (k1 + 1)) /
      (termTf + k1 * (1 - b + b * (docLen / (avgDocLen || 1))));

    score += idf * tfNorm;
  }

  return score;
}

/**
 * Compute composite score combining BM25 relevance with confidence and recency.
 */
export function computeCompositeScore(
  bm25Score: number,
  entry: MemoryEntry,
  _layer: 'long_term' = 'long_term',
): number {
  const confidence = entry.confidence ?? 0.8;

  let recencyFactor = 0.5;
  const dateStr = entry.lastAccessedAt || entry.createdAt;
  if (dateStr) {
    const daysSinceAccess =
      (Date.now() - Date.parse(dateStr)) / (1000 * 60 * 60 * 24);
    recencyFactor = 1 / (1 + daysSinceAccess / 30);
  }

  return bm25Score * (0.5 + 0.3 * confidence + 0.2 * recencyFactor);
}

/**
 * Search across long-term memory categories using BM25 scoring.
 */
export function searchMemory(
  query: string,
  memory: MemoryDataV2,
  topK: number,
  config?: BM25Config,
): RetrievalResult[] {
  if (!query || !query.trim() || topK <= 0) return [];

  const candidates: { entry: MemoryEntry; layer: 'long_term' }[] = [];

  for (const e of memory.user_profile) {
    candidates.push({ entry: e, layer: 'long_term' });
  }
  for (const e of memory.learned_preference) {
    candidates.push({ entry: e, layer: 'long_term' });
  }
  for (const e of memory.interaction_pattern) {
    candidates.push({ entry: e, layer: 'long_term' });
  }
  for (const e of (memory.work_events || [])) {
    candidates.push({ entry: e, layer: 'long_term' });
  }
  for (const e of (memory.dispatch_learnings || [])) {
    candidates.push({ entry: e, layer: 'long_term' });
  }

  if (candidates.length === 0) return [];

  const documents = candidates.map((c) => c.entry.key + ' ' + c.entry.value);
  const index = buildBM25Index(documents);

  const scored: RetrievalResult[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const bm25Score = scoreBM25(query, i, index, config);
    if (bm25Score > 0) {
      const compositeScore = computeCompositeScore(bm25Score, candidates[i].entry);
      scored.push({
        entry: candidates[i].entry,
        score: compositeScore,
        layer: 'long_term',
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

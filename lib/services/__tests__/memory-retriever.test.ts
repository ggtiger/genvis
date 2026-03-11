/**
 * Unit tests for memory-retriever.
 */

import { describe, it, expect } from 'vitest';
import { tokenize, buildBM25Index, scoreBM25, searchMemory, computeCompositeScore } from '../memory-retriever';
import type { MemoryDataV2 } from '../secretary-memory';

describe('tokenize', () => {
  describe('empty / whitespace input', () => {
    it('returns empty array for empty string', () => {
      expect(tokenize('')).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      expect(tokenize('   ')).toEqual([]);
    });

    it('returns empty array for null-ish input', () => {
      expect(tokenize(undefined as unknown as string)).toEqual([]);
    });
  });

  describe('Chinese text (CJK n-grams)', () => {
    it('generates bigrams by default', () => {
      expect(tokenize('你好世界')).toEqual(['你好', '好世', '世界']);
    });

    it('generates trigrams when ngramSize=3', () => {
      expect(tokenize('你好世界啊', 3)).toEqual(['你好世', '好世界', '世界啊']);
    });

    it('returns single token when text shorter than ngramSize', () => {
      expect(tokenize('你', 2)).toEqual(['你']);
    });

    it('returns single bigram for two-char input', () => {
      expect(tokenize('你好')).toEqual(['你好']);
    });
  });

  describe('English text', () => {
    it('splits by whitespace and lowercases', () => {
      expect(tokenize('Hello World')).toEqual(['hello', 'world']);
    });

    it('strips punctuation', () => {
      expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
    });

    it('handles multiple spaces', () => {
      expect(tokenize('hello   world')).toEqual(['hello', 'world']);
    });

    it('handles mixed case', () => {
      expect(tokenize('TypeScript JavaScript')).toEqual(['typescript', 'javascript']);
    });
  });

  describe('mixed Chinese and English', () => {
    it('processes Chinese and English segments separately', () => {
      const result = tokenize('你好world');
      expect(result).toEqual(['你好', 'world']);
    });

    it('handles interleaved Chinese and English', () => {
      const result = tokenize('hello你好世界test');
      expect(result).toEqual(['hello', '你好', '好世', '世界', 'test']);
    });

    it('handles Chinese with punctuation between', () => {
      const result = tokenize('你好，世界');
      expect(result).toEqual(['你好', '世界']);
    });
  });

  describe('special characters and punctuation', () => {
    it('strips all punctuation', () => {
      expect(tokenize('a.b,c!d?e')).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('handles only punctuation', () => {
      expect(tokenize('...,,,!!!')).toEqual([]);
    });
  });
});

describe('buildBM25Index', () => {
  it('returns empty index for empty documents array', () => {
    const index = buildBM25Index([]);
    expect(index.totalDocs).toBe(0);
    expect(index.avgDocLen).toBe(0);
    expect(index.df.size).toBe(0);
    expect(index.tf).toEqual([]);
    expect(index.docLengths).toEqual([]);
  });

  it('builds index for a single English document', () => {
    const index = buildBM25Index(['hello world hello']);
    expect(index.totalDocs).toBe(1);
    expect(index.docLengths).toEqual([3]);
    expect(index.avgDocLen).toBe(3);
    expect(index.tf[0].get('hello')).toBe(2);
    expect(index.tf[0].get('world')).toBe(1);
    expect(index.df.get('hello')).toBe(1);
    expect(index.df.get('world')).toBe(1);
  });

  it('computes document frequency across multiple documents', () => {
    const index = buildBM25Index(['hello world', 'hello test', 'world test']);
    expect(index.totalDocs).toBe(3);
    expect(index.df.get('hello')).toBe(2);
    expect(index.df.get('world')).toBe(2);
    expect(index.df.get('test')).toBe(2);
  });

  it('computes average document length correctly', () => {
    const index = buildBM25Index(['hello world', 'one two three']);
    expect(index.avgDocLen).toBe(2.5);
  });

  it('handles Chinese text with bigram tokenization', () => {
    const index = buildBM25Index(['你好世界']);
    expect(index.totalDocs).toBe(1);
    expect(index.docLengths).toEqual([3]);
    expect(index.tf[0].get('你好')).toBe(1);
    expect(index.tf[0].get('好世')).toBe(1);
    expect(index.tf[0].get('世界')).toBe(1);
  });

  it('handles documents with empty strings', () => {
    const index = buildBM25Index(['', 'hello']);
    expect(index.totalDocs).toBe(2);
    expect(index.docLengths).toEqual([0, 1]);
    expect(index.tf[0].size).toBe(0);
    expect(index.tf[1].get('hello')).toBe(1);
  });
});

describe('scoreBM25', () => {
  it('returns 0 for empty index', () => {
    const index = buildBM25Index([]);
    expect(scoreBM25('hello', 0, index)).toBe(0);
  });

  it('returns 0 for out-of-range docIndex', () => {
    const index = buildBM25Index(['hello world']);
    expect(scoreBM25('hello', -1, index)).toBe(0);
    expect(scoreBM25('hello', 1, index)).toBe(0);
  });

  it('returns 0 for empty query', () => {
    const index = buildBM25Index(['hello world']);
    expect(scoreBM25('', 0, index)).toBe(0);
  });

  it('returns 0 when query has no matching terms', () => {
    const index = buildBM25Index(['hello world']);
    expect(scoreBM25('foo bar', 0, index)).toBe(0);
  });

  it('returns positive score for matching terms', () => {
    const index = buildBM25Index(['hello world', 'foo bar']);
    const score = scoreBM25('hello', 0, index);
    expect(score).toBeGreaterThan(0);
  });

  it('scores document with more matching terms higher', () => {
    const docs = ['hello world', 'hello world hello'];
    const index = buildBM25Index(docs);
    const score0 = scoreBM25('hello', 0, index);
    const score1 = scoreBM25('hello', 1, index);
    expect(score1).toBeGreaterThan(score0);
  });

  it('gives higher IDF to rarer terms', () => {
    const docs = ['common rare', 'common only', 'common only'];
    const index = buildBM25Index(docs);
    const scoreRare = scoreBM25('rare', 0, index);
    const scoreCommon = scoreBM25('common', 0, index);
    expect(scoreRare).toBeGreaterThan(scoreCommon);
  });

  it('uses default k1=1.5 and b=0.75 when no config provided', () => {
    const index = buildBM25Index(['hello world']);
    const scoreDefault = scoreBM25('hello', 0, index);
    const scoreExplicit = scoreBM25('hello', 0, index, { k1: 1.5, b: 0.75 });
    expect(scoreDefault).toBe(scoreExplicit);
  });

  it('works with Chinese queries and documents', () => {
    const docs = ['用户喜欢喝咖啡', '用户偏好深色主题'];
    const index = buildBM25Index(docs);
    const score0 = scoreBM25('咖啡', 0, index);
    const score1 = scoreBM25('咖啡', 1, index);
    expect(score0).toBeGreaterThan(0);
    expect(score1).toBe(0);
  });
});

// ========== Helpers for searchMemory tests ==========

function makeEmptyMemory(): MemoryDataV2 {
  return {
    version: 2,
    user_profile: [],
    learned_preference: [],
    interaction_pattern: [],
    work_events: [],
    dispatch_learnings: [],
    intent_examples: [],
    updatedAt: new Date().toISOString(),
  };
}

function makeLongTermEntry(key: string, value: string): any {
  const now = new Date().toISOString();
  return {
    key,
    value,
    source: 'test',
    createdAt: now,
    updatedAt: now,
    confidence: 0.8,
    lastAccessedAt: now,
    accessCount: 0,
    channel: 'web',
  };
}

describe('searchMemory', () => {
  it('returns empty array for empty query', () => {
    const mem = makeEmptyMemory();
    expect(searchMemory('', mem, 5)).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    const mem = makeEmptyMemory();
    expect(searchMemory('   ', mem, 5)).toEqual([]);
  });

  it('returns empty array when topK <= 0', () => {
    const mem = makeEmptyMemory();
    mem.user_profile.push(makeLongTermEntry('coffee', '用户喜欢咖啡'));
    expect(searchMemory('咖啡', mem, 0)).toEqual([]);
    expect(searchMemory('咖啡', mem, -1)).toEqual([]);
  });

  it('returns empty array when all categories are empty', () => {
    const mem = makeEmptyMemory();
    expect(searchMemory('hello', mem, 5)).toEqual([]);
  });

  it('retrieves matching entries', () => {
    const mem = makeEmptyMemory();
    mem.user_profile.push(makeLongTermEntry('coffee', '用户喜欢喝咖啡'));
    mem.learned_preference.push(makeLongTermEntry('theme', '偏好深色主题'));

    const results = searchMemory('咖啡', mem, 5);
    expect(results.length).toBe(1);
    expect(results[0].entry.key).toBe('coffee');
    expect(results[0].layer).toBe('long_term');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('filters out entries with score = 0', () => {
    const mem = makeEmptyMemory();
    mem.user_profile.push(makeLongTermEntry('coffee', '用户喜欢喝咖啡'));
    mem.user_profile.push(makeLongTermEntry('music', '用户喜欢听音乐'));

    const results = searchMemory('咖啡', mem, 10);
    expect(results.every((r) => r.score > 0)).toBe(true);
    expect(results.some((r) => r.entry.key === 'coffee')).toBe(true);
  });

  it('results are sorted by score descending', () => {
    const mem = makeEmptyMemory();
    mem.user_profile.push(makeLongTermEntry('coffee_lover', '咖啡咖啡咖啡'));
    mem.learned_preference.push(makeLongTermEntry('coffee_once', '偶尔喝咖啡'));

    const results = searchMemory('咖啡', mem, 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('respects topK limit', () => {
    const mem = makeEmptyMemory();
    for (let i = 0; i < 10; i++) {
      mem.user_profile.push(makeLongTermEntry(`item_${i}`, `coffee item ${i}`));
    }

    const results = searchMemory('coffee', mem, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('searches across all three categories', () => {
    const mem = makeEmptyMemory();
    mem.user_profile.push(makeLongTermEntry('profile_coffee', 'likes coffee'));
    mem.learned_preference.push(makeLongTermEntry('pref_coffee', 'prefers coffee'));
    mem.interaction_pattern.push(makeLongTermEntry('pattern_coffee', 'orders coffee daily'));

    const results = searchMemory('coffee', mem, 10);
    expect(results.length).toBe(3);
    const keys = results.map((r) => r.entry.key);
    expect(keys).toContain('profile_coffee');
    expect(keys).toContain('pref_coffee');
    expect(keys).toContain('pattern_coffee');
  });
});

describe('computeCompositeScore', () => {
  const baseEntry = {
    key: 'test',
    value: 'test value',
    source: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    confidence: 0.8,
    lastAccessedAt: new Date().toISOString(),
    accessCount: 5,
    channel: 'web',
  };

  it('returns 0 when bm25Score is 0', () => {
    expect(computeCompositeScore(0, baseEntry)).toBe(0);
  });

  it('higher confidence yields higher score', () => {
    const highConf = { ...baseEntry, confidence: 1.0 };
    const lowConf = { ...baseEntry, confidence: 0.2 };

    const scoreHigh = computeCompositeScore(1.0, highConf);
    const scoreLow = computeCompositeScore(1.0, lowConf);

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it('defaults confidence to 0.8 when missing', () => {
    const noConf = { ...baseEntry, confidence: undefined } as any;
    const withConf = { ...baseEntry, confidence: 0.8 };

    const scoreNoConf = computeCompositeScore(1.0, noConf);
    const scoreWithConf = computeCompositeScore(1.0, withConf);

    expect(scoreNoConf).toBeCloseTo(scoreWithConf, 5);
  });

  it('more recent access yields higher score', () => {
    const recent = { ...baseEntry, lastAccessedAt: new Date().toISOString() };
    const old = {
      ...baseEntry,
      lastAccessedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const scoreRecent = computeCompositeScore(1.0, recent);
    const scoreOld = computeCompositeScore(1.0, old);

    expect(scoreRecent).toBeGreaterThan(scoreOld);
  });

  it('falls back to createdAt when lastAccessedAt is missing', () => {
    const noAccess = { ...baseEntry, lastAccessedAt: undefined, createdAt: new Date().toISOString() } as any;
    const score = computeCompositeScore(1.0, noAccess);
    expect(score).toBeGreaterThan(0);
  });

  it('uses recency_factor=0.5 when both dates are missing', () => {
    const noDates = { ...baseEntry, lastAccessedAt: undefined, createdAt: undefined } as any;
    // Formula: 1.0 * (0.5 + 0.3*0.8 + 0.2*0.5) = 0.84
    const score = computeCompositeScore(1.0, noDates);
    expect(score).toBeCloseTo(0.84, 2);
  });
});

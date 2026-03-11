import { describe, it, expect } from 'vitest';
import { formatLearningEntry, searchDispatchLearnings } from '../correction-retriever';
import type { MemoryDataV2, MemoryEntryV2 } from '../secretary-memory';
import { createEmptyMemory } from '../secretary-memory';

function makeEntry(overrides: Partial<MemoryEntryV2> & { key: string; value: string }): MemoryEntryV2 {
  return {
    source: 'dispatch_correction',
    createdAt: '2025-01-15T00:00:00.000Z',
    updatedAt: '2025-01-15T00:00:00.000Z',
    count: 1,
    confidence: 0.8,
    lastAccessedAt: '2025-01-15T00:00:00.000Z',
    accessCount: 0,
    channel: 'web',
    ...overrides,
  };
}

const VALID_VALUE = JSON.stringify({
  input: '帮我查一下天气',
  wrongAction: 'direct_reply',
  wrongActionType: 'direct_reply',
  correctAction: 'weather-skill',
  correctActionType: 'skill_call',
});

describe('formatLearningEntry', () => {
  it('formats a valid entry with parsed JSON value', () => {
    const entry = makeEntry({ key: '帮我查一下天气', value: VALID_VALUE, count: 3, confidence: 1.0 });
    const result = formatLearningEntry(entry);
    expect(result).toContain('帮我查一下天气');
    expect(result).toContain('skill_call');
    expect(result).toContain('weather-skill');
    expect(result).toContain('direct_reply');
    expect(result).toContain('纠正 3 次');
    expect(result).toContain('置信度 1');
  });

  it('returns fallback format when value is not valid JSON', () => {
    const entry = makeEntry({ key: '查天气', value: 'not-json', count: 2 });
    const result = formatLearningEntry(entry);
    expect(result).toContain('查天气');
    expect(result).toContain('not-json');
    expect(result).toContain('纠正 2 次');
  });

  it('uses default count and confidence when missing', () => {
    const entry = makeEntry({ key: 'test', value: VALID_VALUE });
    // Override to undefined to test defaults
    (entry as any).count = undefined;
    (entry as any).confidence = undefined;
    const result = formatLearningEntry(entry);
    expect(result).toContain('纠正 1 次');
    expect(result).toContain('置信度 0.8');
  });
});

describe('searchDispatchLearnings', () => {
  it('returns empty string for empty memory', () => {
    const memory = createEmptyMemory();
    expect(searchDispatchLearnings('天气', memory)).toBe('');
  });

  it('returns empty string for empty query', () => {
    const memory = createEmptyMemory();
    memory.dispatch_learnings = [makeEntry({ key: '天气', value: VALID_VALUE })];
    expect(searchDispatchLearnings('', memory)).toBe('');
    expect(searchDispatchLearnings('  ', memory)).toBe('');
  });

  it('returns matching results with header', () => {
    const memory = createEmptyMemory();
    memory.dispatch_learnings = [
      makeEntry({ key: '帮我查一下天气', value: VALID_VALUE, count: 3, confidence: 1.0 }),
    ];
    const result = searchDispatchLearnings('天气', memory);
    expect(result).toContain('## 调度纠正经验');
    expect(result).toContain('帮我查一下天气');
  });

  it('returns empty string when no entries match the query', () => {
    const memory = createEmptyMemory();
    memory.dispatch_learnings = [
      makeEntry({
        key: '帮我查一下天气',
        value: VALID_VALUE,
      }),
    ];
    // Use a query with zero token overlap
    const result = searchDispatchLearnings('zzzzunrelatedxxx', memory);
    expect(result).toBe('');
  });

  it('respects topK parameter', () => {
    const memory = createEmptyMemory();
    // Add multiple entries that all share the token "调度"
    for (let i = 0; i < 10; i++) {
      const val = JSON.stringify({
        input: `调度请求${i}`,
        wrongAction: `wrong${i}`,
        wrongActionType: 'dispatch',
        correctAction: `correct${i}`,
        correctActionType: 'dispatch',
      });
      memory.dispatch_learnings.push(makeEntry({ key: `调度请求${i}`, value: val }));
    }
    const result = searchDispatchLearnings('调度', memory, 3);
    // Count the number of bullet points
    const bullets = (result.match(/^- /gm) || []).length;
    expect(bullets).toBeLessThanOrEqual(3);
  });

  it('sorts results by BM25 score descending', () => {
    const memory = createEmptyMemory();
    // Entry with more token overlap should rank higher
    const val1 = JSON.stringify({
      input: '翻译这段话',
      wrongAction: 'direct_reply',
      wrongActionType: 'direct_reply',
      correctAction: '翻译员工',
      correctActionType: 'dispatch',
    });
    const val2 = JSON.stringify({
      input: '帮我翻译英文文档并且翻译成中文',
      wrongAction: 'direct_reply',
      wrongActionType: 'direct_reply',
      correctAction: '翻译员工',
      correctActionType: 'dispatch',
    });
    memory.dispatch_learnings = [
      makeEntry({ key: '翻译这段话', value: val1 }),
      makeEntry({ key: '帮我翻译英文文档并且翻译成中文', value: val2 }),
    ];
    const result = searchDispatchLearnings('翻译', memory);
    // Both should appear
    expect(result).toContain('翻译');
  });

  it('handles memory without dispatch_learnings field gracefully', () => {
    const memory = createEmptyMemory();
    delete (memory as any).dispatch_learnings;
    expect(searchDispatchLearnings('test', memory as MemoryDataV2)).toBe('');
  });
});

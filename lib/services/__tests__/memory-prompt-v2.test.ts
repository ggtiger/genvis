/**
 * Unit tests for buildMemoryPromptBlockFromResults.
 */

import { describe, it, expect } from 'vitest';
import { buildMemoryPromptBlockFromResults, formatEntryWithConfidence } from '../secretary-memory-prompt';
import type { RetrievalResult } from '../memory-retriever';
import type { MemoryEntry } from '../secretary-memory';

// ========== Helpers ==========

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    key: 'test_key',
    value: '测试值',
    source: '对话',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeResult(
  overrides: Omit<Partial<RetrievalResult>, 'entry'> & { entry?: Partial<MemoryEntry> } = {},
): RetrievalResult {
  const { entry: entryOverrides, ...rest } = overrides;
  return {
    entry: makeEntry(entryOverrides),
    score: 1.0,
    layer: 'long_term',
    ...rest,
  };
}

// ========== Tests ==========

describe('buildMemoryPromptBlockFromResults', () => {
  it('returns empty string for empty results array', () => {
    expect(buildMemoryPromptBlockFromResults([])).toBe('');
  });

  it('formats a single long_term result correctly', () => {
    const results: RetrievalResult[] = [
      makeResult({ entry: { key: 'job_title', value: '软件工程师' } }),
    ];

    const output = buildMemoryPromptBlockFromResults(results);

    expect(output).toContain('## 用户记忆');
    expect(output).toContain('### 长期记忆');
    expect(output).toContain('- job_title：软件工程师');
    expect(output).toContain('请根据以上用户信息个性化你的回复和操作');
  });

  it('includes count display for entries with count > 0', () => {
    const results: RetrievalResult[] = [
      makeResult({ entry: { key: 'morning_meeting', value: '每周一开会', count: 5 } }),
    ];

    const output = buildMemoryPromptBlockFromResults(results);
    expect(output).toContain('- morning_meeting：每周一开会（使用 5 次）');
  });

  it('handles multiple entries', () => {
    const results: RetrievalResult[] = [
      makeResult({ entry: { key: 'name', value: '张三' } }),
      makeResult({ entry: { key: 'role', value: '工程师' } }),
      makeResult({ entry: { key: 'city', value: '北京' } }),
    ];

    const output = buildMemoryPromptBlockFromResults(results);

    const matches = output.match(/### 长期记忆/g);
    expect(matches).toHaveLength(1);

    expect(output).toContain('- name：张三');
    expect(output).toContain('- role：工程师');
    expect(output).toContain('- city：北京');
  });

  it('always includes personalization instructions when results are non-empty', () => {
    const results: RetrievalResult[] = [
      makeResult({ entry: { key: 'k', value: 'v' } }),
    ];

    const output = buildMemoryPromptBlockFromResults(results);
    expect(output).toContain('请根据以上用户信息个性化你的回复和操作');
  });
});

describe('formatEntryWithConfidence', () => {
  it('adds low-confidence marker when confidence < default threshold (0.6)', () => {
    const entry = makeEntry({ key: 'job', value: '工程师', confidence: 0.3 });
    const output = formatEntryWithConfidence(entry);
    expect(output).toContain('⚠️ 低置信度');
    expect(output).toContain('- job：工程师');
  });

  it('does not add marker when confidence >= default threshold', () => {
    const entry = makeEntry({ key: 'job', value: '工程师', confidence: 0.8 });
    const output = formatEntryWithConfidence(entry);
    expect(output).not.toContain('⚠️ 低置信度');
    expect(output).toBe('- job：工程师');
  });

  it('does not add marker when confidence is undefined', () => {
    const entry = makeEntry({ key: 'job', value: '工程师' });
    const output = formatEntryWithConfidence(entry);
    expect(output).not.toContain('⚠️ 低置信度');
  });

  it('respects custom threshold parameter', () => {
    const entry = makeEntry({ key: 'pref', value: '深色模式', confidence: 0.7 });
    expect(formatEntryWithConfidence(entry, 0.8)).toContain('⚠️ 低置信度');
    expect(formatEntryWithConfidence(entry, 0.5)).not.toContain('⚠️ 低置信度');
  });

  it('includes both count display and low-confidence marker', () => {
    const entry = makeEntry({ key: 'meeting', value: '每周一开会', count: 3, confidence: 0.2 });
    const output = formatEntryWithConfidence(entry);
    expect(output).toContain('（使用 3 次）');
    expect(output).toContain('⚠️ 低置信度');
  });
});

describe('buildMemoryPromptBlockFromResults with confidence annotation', () => {
  it('annotates low-confidence entries in the output', () => {
    const results: RetrievalResult[] = [
      makeResult({ entry: { key: 'low_conf', value: '不确定的偏好', confidence: 0.3 } }),
      makeResult({ entry: { key: 'high_conf', value: '确定的偏好', confidence: 0.9 } }),
    ];

    const output = buildMemoryPromptBlockFromResults(results);

    expect(output).toContain('- low_conf：不确定的偏好 ⚠️ 低置信度');
    expect(output).toContain('- high_conf：确定的偏好');
    expect(output).not.toMatch(/high_conf.*⚠️ 低置信度/);
  });
});

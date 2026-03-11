/**
 * Unit tests for secretary-memory-extractor.
 *
 * Tests the extractMemoryFromConversation function (single-turn extraction).
 * Multi-turn extraction (extractMemoryFromMessages) was removed — secretary
 * operates as a dispatcher, not a chatbot.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractMemoryFromConversation } from '../secretary-memory-extractor';

// ========== Helpers ==========

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

function makeAIResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

const defaultConfig = {
  baseUrl: 'https://api.example.com',
  apiKey: 'test-key',
  model: 'test-model',
};

// ========== Tests ==========

describe('extractMemoryFromConversation', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('extracts valid memory items from AI response', async () => {
    const aiResult = JSON.stringify([
      {
        category: 'user_profile',
        key: 'job_title',
        value: '设计师',
        source: '用户自述职业',
      },
    ]);

    globalThis.fetch = mockFetchResponse(makeAIResponse(aiResult));

    const result = await extractMemoryFromConversation(
      '我是一名设计师',
      '好的，了解了',
      defaultConfig,
    );

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('user_profile');
    expect(result[0].key).toBe('job_title');
  });

  it('returns empty array on API failure', async () => {
    globalThis.fetch = mockFetchResponse({}, false, 500);

    const result = await extractMemoryFromConversation('test', 'reply', defaultConfig);
    expect(result).toEqual([]);
  });

  it('returns empty array on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await extractMemoryFromConversation('test', 'reply', defaultConfig);
    expect(result).toEqual([]);
  });
});

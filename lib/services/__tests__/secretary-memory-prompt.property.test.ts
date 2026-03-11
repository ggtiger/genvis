/**
 * Property-based tests for secretary memory prompt builder.
 *
 * Tests the buildMemoryPromptBlock function using fast-check property-based testing.
 * Validates that the prompt builder correctly formats memory entries and handles
 * empty memory data.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildMemoryPromptBlock } from '../secretary-memory-prompt';
import type { MemoryData, MemoryEntry } from '../secretary-memory';

// ========== Constants ==========

const CATEGORY_HEADERS: Record<string, string> = {
  user_profile: '用户档案',
  learned_preference: '学习偏好',
  interaction_pattern: '交互模式',
};

// ========== Arbitraries ==========

/** Arbitrary for an ISO timestamp string */
const isoTimestampArb = fc
  .integer({
    min: new Date('2020-01-01T00:00:00.000Z').getTime(),
    max: new Date('2030-01-01T00:00:00.000Z').getTime(),
  })
  .map((ts) => new Date(ts).toISOString());

/**
 * Arbitrary for a non-empty alphanumeric key.
 * Uses simple alphanumeric strings to avoid regex special characters.
 */
const memoryKeyArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,29}$/);

/**
 * Arbitrary for a memory value string.
 * Uses alphanumeric + Chinese characters to avoid characters that could
 * cause false substring matches (no newlines, no markdown syntax).
 */
const memoryValueArb = fc.stringMatching(/^[a-zA-Z0-9\u4e00-\u9fff]{1,50}$/);

/** Arbitrary for a source string */
const memorySourceArb = fc.string({ minLength: 1, maxLength: 100 });

/** Arbitrary for a full MemoryEntry with safe value strings */
const fullMemoryEntryArb: fc.Arbitrary<MemoryEntry> = fc.record({
  key: memoryKeyArb,
  value: memoryValueArb,
  source: memorySourceArb,
  createdAt: isoTimestampArb,
  updatedAt: isoTimestampArb,
  count: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
});

/**
 * Arbitrary for a MemoryData object with at least one entry across all categories.
 * Uses uniqueArray to ensure unique keys per category (matching real data constraints).
 */
const nonEmptyMemoryDataArb: fc.Arbitrary<MemoryData> = fc
  .record({
    user_profile: fc.uniqueArray(fullMemoryEntryArb, {
      maxLength: 5,
      selector: (e) => e.key,
    }),
    learned_preference: fc.uniqueArray(fullMemoryEntryArb, {
      maxLength: 5,
      selector: (e) => e.key,
    }),
    interaction_pattern: fc.uniqueArray(
      fullMemoryEntryArb.map((e) => ({ ...e, count: e.count ?? 1 })),
      { maxLength: 5, selector: (e) => e.key },
    ),
    updatedAt: isoTimestampArb,
  })
  .filter(
    (data) =>
      data.user_profile.length +
        data.learned_preference.length +
        data.interaction_pattern.length >
      0,
  )
  .map((data) => ({
    version: 1 as const,
    work_events: [] as MemoryEntry[],
    dispatch_learnings: [] as MemoryEntry[],
    intent_examples: [] as MemoryEntry[],
    ...data,
  }));

/**
 * Arbitrary for a MemoryData object where all three category arrays are empty.
 */
const emptyMemoryDataArb: fc.Arbitrary<MemoryData> = isoTimestampArb.map((ts) => ({
  version: 1 as const,
  user_profile: [] as MemoryEntry[],
  learned_preference: [] as MemoryEntry[],
  interaction_pattern: [] as MemoryEntry[],
  work_events: [] as MemoryEntry[],
  dispatch_learnings: [] as MemoryEntry[],
  intent_examples: [] as MemoryEntry[],
  updatedAt: ts,
}));

// ========== Tests ==========

/**
 * **Feature: secretary-memory, Property 4: Prompt builder contains all memory entries**
 * **Validates: Requirements 5.1, 5.4**
 *
 * For any MemoryData with at least one entry, the output of buildMemoryPromptBlock
 * SHALL contain the value string of every MemoryEntry across all categories, and
 * SHALL contain the Chinese category headers ("用户档案", "学习偏好", "交互模式")
 * for each non-empty category.
 */
describe('Property 4: Prompt builder contains all memory entries', () => {
  it('output contains every entry value and the correct Chinese category headers for non-empty categories', () => {
    fc.assert(
      fc.property(nonEmptyMemoryDataArb, (memory) => {
        const result = buildMemoryPromptBlock(memory);

        // Result should be non-empty since memory has at least one entry
        expect(result.length).toBeGreaterThan(0);

        // Check that every entry's value appears in the output
        const categories = ['user_profile', 'learned_preference', 'interaction_pattern'] as const;
        for (const category of categories) {
          const entries = memory[category];
          for (const entry of entries) {
            expect(result).toContain(entry.value);
          }

          // Check category header presence for non-empty categories
          if (entries.length > 0) {
            expect(result).toContain(CATEGORY_HEADERS[category]);
          }
        }

        // Check that category headers for empty categories are NOT present
        for (const category of categories) {
          if (memory[category].length === 0) {
            expect(result).not.toContain(CATEGORY_HEADERS[category]);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * **Feature: secretary-memory, Property 5: Empty memory produces empty prompt block**
 * **Validates: Requirements 5.3**
 *
 * For any MemoryData where all three category arrays are empty, the output of
 * buildMemoryPromptBlock SHALL be an empty string.
 */
describe('Property 5: Empty memory produces empty prompt block', () => {
  it('returns empty string for any MemoryData with all empty category arrays', () => {
    fc.assert(
      fc.property(emptyMemoryDataArb, (memory) => {
        const result = buildMemoryPromptBlock(memory);
        expect(result).toBe('');
      }),
      { numRuns: 100 },
    );
  });
});

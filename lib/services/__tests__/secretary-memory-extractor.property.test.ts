/**
 * Property-based tests for secretary memory extractor apply logic.
 *
 * Tests that ExtractedMemory items can be correctly applied to a MemoryData
 * via upsertEntry, verifying the integration between the extractor's output
 * format and the memory store's upsert logic.
 *
 * **Feature: secretary-memory, Property 6: Extracted memory items produce valid entries**
 * **Validates: Requirements 6.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ExtractedMemory } from '../secretary-memory-extractor';
import { createEmptyMemory, upsertEntry } from '../secretary-memory';
import type { MemoryCategory, MemoryDataV2 } from '../secretary-memory';

// ========== Arbitraries ==========

/** Valid memory category values */
const memoryCategoryArb = fc.constantFrom<MemoryCategory>(
  'user_profile',
  'learned_preference',
  'interaction_pattern',
);

/** Arbitrary for a non-empty alphanumeric key (valid key names) */
const memoryKeyArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,29}$/);

/** Arbitrary for a non-empty string value */
const memoryValueArb = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary for a source string */
const memorySourceArb = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary for a single ExtractedMemory item */
const extractedMemoryArb: fc.Arbitrary<ExtractedMemory> = fc.record({
  category: memoryCategoryArb,
  key: memoryKeyArb,
  value: memoryValueArb,
  source: memorySourceArb,
});

/** Arbitrary for a list of ExtractedMemory items (1–20 items) */
const extractedMemoryListArb = fc.array(extractedMemoryArb, {
  minLength: 1,
  maxLength: 20,
});

// ========== Tests ==========

/**
 * **Feature: secretary-memory, Property 6: Extracted memory items produce valid entries**
 * **Validates: Requirements 6.3**
 *
 * For any list of ExtractedMemory items with valid category, key, value, and
 * source fields, applying them to an empty MemoryData via upsert SHALL produce
 * a MemoryData where each item's key exists in the correct category with
 * matching value and source.
 */
describe('Property 6: Extracted memory items produce valid entries', () => {
  it('applying ExtractedMemory items via upsertEntry produces entries with correct category, value, and source', () => {
    fc.assert(
      fc.property(extractedMemoryListArb, (items: ExtractedMemory[]) => {
        // 1. Start with an empty memory
        let memory: MemoryDataV2 = createEmptyMemory();

        // 2. Apply each ExtractedMemory item via upsertEntry
        for (const item of items) {
          memory = upsertEntry(memory, item.category, {
            key: item.key,
            value: item.value,
            source: item.source,
          }) as MemoryDataV2;
        }

        // 3. Build a map of the last applied value/source for each unique (category, key) pair
        const lastApplied = new Map<string, ExtractedMemory>();
        for (const item of items) {
          lastApplied.set(`${item.category}::${item.key}`, item);
        }

        // 4. Verify that for each unique (category, key), the entry exists
        //    in the correct category with the last applied value and source
        for (const item of lastApplied.values()) {
          const categoryEntries = memory[item.category];
          const entry = categoryEntries.find((e) => e.key === item.key);

          // Entry must exist in the correct category
          expect(entry).toBeDefined();

          // Value must match the last applied value
          expect(entry!.value).toBe(item.value);

          // Source must match the last applied source
          expect(entry!.source).toBe(item.source);

          // Timestamps must be valid ISO strings
          expect(typeof entry!.createdAt).toBe('string');
          expect(new Date(entry!.createdAt).toISOString()).toBe(entry!.createdAt);
          expect(typeof entry!.updatedAt).toBe('string');
          expect(new Date(entry!.updatedAt).toISOString()).toBe(entry!.updatedAt);
        }

        // 5. Verify that the total number of entries across all categories
        //    equals the number of unique (category, key) pairs
        const totalEntries =
          memory.user_profile.length +
          memory.learned_preference.length +
          memory.interaction_pattern.length;
        expect(totalEntries).toBe(lastApplied.size);
      }),
      { numRuns: 100 },
    );
  });
});

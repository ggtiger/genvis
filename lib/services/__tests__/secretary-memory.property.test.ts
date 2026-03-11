/**
 * Property-based tests for secretary memory store service.
 *
 * Tests the core Memory Store functions: createEmptyMemory, upsertEntry,
 * deleteEntry, loadMemory, and saveMemory using fast-check property-based testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// ========== Arbitraries ==========

/** Valid memory category values */
const memoryCategoryArb = fc.constantFrom(
  'user_profile' as const,
  'learned_preference' as const,
  'interaction_pattern' as const,
);

/** Arbitrary for a non-empty alphanumeric key (valid key names) */
const memoryKeyArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,29}$/);

/** Arbitrary for a non-empty string value */
const memoryValueArb = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary for a source string */
const memorySourceArb = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary for a partial MemoryEntry (without timestamps, as used by upsertEntry) */
const partialEntryArb = fc.record({
  key: memoryKeyArb,
  value: memoryValueArb,
  source: memorySourceArb,
});

/** Arbitrary for a partial entry with optional count (for interaction_pattern) */
const partialEntryWithCountArb = fc.record({
  key: memoryKeyArb,
  value: memoryValueArb,
  source: memorySourceArb,
  count: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
});

/** Arbitrary for an ISO timestamp string */
const isoTimestampArb = fc
  .integer({
    min: new Date('2020-01-01T00:00:00.000Z').getTime(),
    max: new Date('2030-01-01T00:00:00.000Z').getTime(),
  })
  .map((ts) => new Date(ts).toISOString());

/** Arbitrary for a full MemoryEntry (with timestamps) */
const fullMemoryEntryArb = fc.record({
  key: memoryKeyArb,
  value: memoryValueArb,
  source: memorySourceArb,
  createdAt: isoTimestampArb,
  updatedAt: isoTimestampArb,
  count: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
});

/**
 * Arbitrary for a MemoryData object with unique keys per category.
 * Generates arrays of entries with unique keys to simulate realistic data.
 */
const memoryDataArb = fc
  .record({
    user_profile: fc.uniqueArray(fullMemoryEntryArb, {
      maxLength: 10,
      selector: (e) => e.key,
    }),
    learned_preference: fc.uniqueArray(fullMemoryEntryArb, {
      maxLength: 10,
      selector: (e) => e.key,
    }),
    interaction_pattern: fc.uniqueArray(
      fullMemoryEntryArb.map((e) => ({ ...e, count: e.count ?? 1 })),
      { maxLength: 10, selector: (e) => e.key },
    ),
    updatedAt: isoTimestampArb,
  })
  .map((data) => ({
    version: 1 as const,
    work_events: [] as import('../secretary-memory').MemoryEntry[],
    dispatch_learnings: [] as import('../secretary-memory').MemoryEntry[],
    intent_examples: [] as import('../secretary-memory').MemoryEntry[],
    ...data,
  }));

/**
 * Arbitrary for a non-empty MemoryData (at least one entry in some category).
 */
const nonEmptyMemoryDataArb = memoryDataArb.filter(
  (m) => m.user_profile.length + m.learned_preference.length + m.interaction_pattern.length > 0,
);

// ========== Tests ==========


/**
 * **Feature: secretary-memory, Property 1: Memory save/load round-trip**
 * **Validates: Requirements 1.1, 1.4**
 *
 * For any valid MemoryData object, saving it to the Memory_Store and then
 * loading it back SHALL produce an equivalent MemoryData object (with the
 * exception of the top-level `updatedAt` field which may be updated on save).
 */
describe('Property 1: Memory save/load round-trip', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saving and loading any valid MemoryData produces equivalent data (except updatedAt)', async () => {
    await fc.assert(
      fc.asyncProperty(memoryDataArb, async (memoryData) => {
        // We need to mock fs/promises for each iteration since these are unit tests
        let storedContent: string | null = null;

        vi.doMock('fs/promises', () => ({
          default: {
            mkdir: vi.fn().mockResolvedValue(undefined),
            writeFile: vi.fn().mockImplementation((_path: string, content: string) => {
              storedContent = content;
              return Promise.resolve();
            }),
            readFile: vi.fn().mockImplementation(() => {
              if (storedContent === null) {
                const err = new Error('ENOENT') as NodeJS.ErrnoException;
                err.code = 'ENOENT';
                return Promise.reject(err);
              }
              return Promise.resolve(storedContent);
            }),
          },
        }));

        // Dynamically import to pick up the mock
        const { saveMemory, loadMemory } = await import('../secretary-memory');

        // Save the memory
        await saveMemory(memoryData);

        // Load it back
        const loaded = await loadMemory();

        // Verify structural equivalence
        // loadMemory auto-migrates V1 to V2, so version will be 2
        // and entries will have V2 default fields added
        if (memoryData.version === 1) {
          expect(loaded.version).toBe(2);
          // Entries should have V2 fields added with defaults
          for (const cat of ['user_profile', 'learned_preference', 'interaction_pattern'] as const) {
            expect(loaded[cat]).toHaveLength(memoryData[cat].length);
            for (let i = 0; i < memoryData[cat].length; i++) {
              const original = memoryData[cat][i];
              const migrated = loaded[cat][i];
              // Original fields preserved
              expect(migrated.key).toBe(original.key);
              expect(migrated.value).toBe(original.value);
              expect(migrated.source).toBe(original.source);
              expect(migrated.createdAt).toBe(original.createdAt);
              expect(migrated.updatedAt).toBe(original.updatedAt);
            }
          }
        } else {
          expect(loaded.version).toBe(memoryData.version);
          expect(loaded.user_profile).toEqual(memoryData.user_profile);
          expect(loaded.learned_preference).toEqual(memoryData.learned_preference);
          expect(loaded.interaction_pattern).toEqual(memoryData.interaction_pattern);
        }

        // updatedAt should be a valid ISO string (it gets updated on save)
        expect(typeof loaded.updatedAt).toBe('string');
        expect(new Date(loaded.updatedAt).toISOString()).toBe(loaded.updatedAt);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * **Feature: secretary-memory, Property 2: Upsert key uniqueness with required fields**
 * **Validates: Requirements 1.6, 2.3**
 *
 * For any sequence of upsert operations on a MemoryData object using the same
 * category and key, the resulting category array SHALL contain exactly one entry
 * with that key, and that entry SHALL have non-empty value, source, createdAt,
 * and updatedAt fields.
 */
describe('Property 2: Upsert key uniqueness with required fields', () => {
  it('upserting the same key N times results in exactly one entry with all required fields', async () => {
    // Import directly — upsertEntry is a pure function, no mocking needed
    const { createEmptyMemory, upsertEntry } = await import('../secretary-memory');

    fc.assert(
      fc.property(
        memoryCategoryArb,
        memoryKeyArb,
        fc.array(
          fc.record({ value: memoryValueArb, source: memorySourceArb }),
          { minLength: 1, maxLength: 20 },
        ),
        (category, key, updates) => {
          let memory: import('../secretary-memory').MemoryDataV2 = createEmptyMemory();

          // Apply N upserts with the same key but different values
          for (const update of updates) {
            memory = upsertEntry(memory, category, {
              key,
              value: update.value,
              source: update.source,
            }) as import('../secretary-memory').MemoryDataV2;
          }

          // Check: exactly one entry with this key in the category
          const entries = memory[category].filter((e) => e.key === key);
          expect(entries).toHaveLength(1);

          const entry = entries[0];

          // Check: all required fields are non-empty strings
          expect(entry.value).toBeTruthy();
          expect(typeof entry.value).toBe('string');
          expect(entry.source).toBeTruthy();
          expect(typeof entry.source).toBe('string');
          expect(entry.createdAt).toBeTruthy();
          expect(typeof entry.createdAt).toBe('string');
          expect(entry.updatedAt).toBeTruthy();
          expect(typeof entry.updatedAt).toBe('string');

          // Check: the value and source match the last upsert
          const lastUpdate = updates[updates.length - 1];
          expect(entry.value).toBe(lastUpdate.value);
          expect(entry.source).toBe(lastUpdate.source);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * **Feature: secretary-memory, Property 3: Interaction pattern count increment**
 * **Validates: Requirements 4.2**
 *
 * For any interaction_pattern entry, when upserted N times with the same key,
 * the resulting entry's count field SHALL equal N (or the sum of the initial
 * count plus the number of subsequent upserts).
 */
describe('Property 3: Interaction pattern count increment', () => {
  it('upserting an interaction_pattern key N times results in count equal to N', async () => {
    const { createEmptyMemory, upsertEntry } = await import('../secretary-memory');

    fc.assert(
      fc.property(
        memoryKeyArb,
        fc.integer({ min: 1, max: 50 }),
        memoryValueArb,
        memorySourceArb,
        (key, n, value, source) => {
          let memory: import('../secretary-memory').MemoryDataV2 = createEmptyMemory();

          // Upsert the same interaction_pattern key N times
          for (let i = 0; i < n; i++) {
            memory = upsertEntry(memory, 'interaction_pattern', {
              key,
              value,
              source,
            }) as import('../secretary-memory').MemoryDataV2;
          }

          // Find the entry
          const entry = memory.interaction_pattern.find((e) => e.key === key);
          expect(entry).toBeDefined();

          // The count should equal N (first upsert creates with count=1, each subsequent adds 1)
          expect(entry!.count).toBe(n);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * **Feature: secretary-memory, Property 7: Delete removes exactly the targeted entry**
 * **Validates: Requirements 7.3**
 *
 * For any MemoryData with entries and any valid category/key pair that exists
 * in the data, calling deleteEntry SHALL remove that entry and leave all other
 * entries unchanged.
 */
describe('Property 7: Delete removes exactly the targeted entry', () => {
  it('deleting an entry removes only that entry and preserves all others', async () => {
    const { deleteEntry } = await import('../secretary-memory');

    fc.assert(
      fc.property(
        nonEmptyMemoryDataArb.chain((memory) => {
          // Pick a random category that has entries
          const nonEmptyCategories = (
            ['user_profile', 'learned_preference', 'interaction_pattern'] as const
          ).filter((cat) => memory[cat].length > 0);

          return fc
            .constantFrom(...nonEmptyCategories)
            .chain((category) => {
              // Pick a random entry from that category
              return fc
                .integer({ min: 0, max: memory[category].length - 1 })
                .map((idx) => ({
                  memory,
                  category,
                  targetKey: memory[category][idx].key,
                }));
            });
        }),
        ({ memory, category, targetKey }) => {
          // Snapshot all entries before deletion
          const allEntriesBefore = {
            user_profile: [...memory.user_profile],
            learned_preference: [...memory.learned_preference],
            interaction_pattern: [...memory.interaction_pattern],
          };

          // Delete the target entry
          const result = deleteEntry(memory, category, targetKey) as import('../secretary-memory').MemoryData;

          // The target entry should be gone from its category
          const targetEntryAfter = result[category].find((e) => e.key === targetKey);
          expect(targetEntryAfter).toBeUndefined();

          // The category should have one fewer entry
          expect(result[category].length).toBe(allEntriesBefore[category].length - 1);

          // All other entries in the same category should be unchanged
          const otherEntriesBefore = allEntriesBefore[category].filter((e) => e.key !== targetKey);
          const otherEntriesAfter = result[category];
          expect(otherEntriesAfter).toEqual(otherEntriesBefore);

          // All entries in other categories should be completely unchanged
          const otherCategories = (
            ['user_profile', 'learned_preference', 'interaction_pattern'] as const
          ).filter((cat) => cat !== category);

          for (const otherCat of otherCategories) {
            expect(result[otherCat]).toEqual(allEntriesBefore[otherCat]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * **Feature: secretary-memory, Property 8: Three-category structural invariant**
 * **Validates: Requirements 1.5**
 *
 * For any MemoryData produced by createEmptyMemory, upsertEntry, or deleteEntry,
 * the object SHALL always contain exactly the three category arrays: user_profile,
 * learned_preference, and interaction_pattern, each being a valid array.
 */
describe('Property 8: Three-category structural invariant', () => {
  it('any sequence of createEmptyMemory, upsertEntry, and deleteEntry operations preserves the three-category structure', async () => {
    const { createEmptyMemory, upsertEntry, deleteEntry } = await import('../secretary-memory');

    /** Verify the structural invariant holds for a MemoryData object */
    function assertStructuralInvariant(memory: ReturnType<typeof createEmptyMemory>) {
      // Must have version 2 (V2 format)
      expect(memory.version).toBe(2);

      // Must have exactly three category arrays
      expect(Array.isArray(memory.user_profile)).toBe(true);
      expect(Array.isArray(memory.learned_preference)).toBe(true);
      expect(Array.isArray(memory.interaction_pattern)).toBe(true);

      // Must have updatedAt string
      expect(typeof memory.updatedAt).toBe('string');
    }

    // Define an operation arbitrary: either upsert or delete
    const operationArb = fc.oneof(
      // Upsert operation
      fc.record({
        type: fc.constant('upsert' as const),
        category: memoryCategoryArb,
        entry: partialEntryArb,
      }),
      // Delete operation
      fc.record({
        type: fc.constant('delete' as const),
        category: memoryCategoryArb,
        key: memoryKeyArb,
      }),
    );

    fc.assert(
      fc.property(
        fc.array(operationArb, { minLength: 0, maxLength: 30 }),
        (operations) => {
          // Start with an empty memory
          let memory = createEmptyMemory();
          assertStructuralInvariant(memory);

          // Apply each operation and verify the invariant holds after each one
          for (const op of operations) {
            if (op.type === 'upsert') {
              memory = upsertEntry(memory, op.category, op.entry) as ReturnType<typeof createEmptyMemory>;
            } else {
              memory = deleteEntry(memory, op.category, op.key) as ReturnType<typeof createEmptyMemory>;
            }
            assertStructuralInvariant(memory);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

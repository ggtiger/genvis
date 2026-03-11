/**
 * Unit tests for secretary-memory V2 migration and core functions.
 */

import { describe, it, expect } from 'vitest';
import {
  migrateV1ToV2,
  type MemoryData,
  type MemoryEntry,
} from '../secretary-memory';

/** Create a V1 memory structure for testing migration */
function createV1Memory(): MemoryData {
  return {
    version: 1,
    user_profile: [],
    learned_preference: [],
    interaction_pattern: [],
    work_events: [],
    dispatch_learnings: [],
    intent_examples: [],
    updatedAt: new Date().toISOString(),
  };
}

function makeV1Entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    key: 'test_key',
    value: 'test value',
    source: 'test source',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-16T10:00:00.000Z',
    ...overrides,
  };
}

describe('migrateV1ToV2', () => {
  it('should set version to 2', () => {
    const v1 = createV1Memory();
    const v2 = migrateV1ToV2(v1);
    expect(v2.version).toBe(2);
  });

  it('should preserve updatedAt from V1', () => {
    const v1 = createV1Memory();
    const v2 = migrateV1ToV2(v1);
    expect(v2.updatedAt).toBe(v1.updatedAt);
  });

  it('should add default fields to user_profile entries', () => {
    const v1: MemoryData = {
      ...createV1Memory(),
      user_profile: [makeV1Entry({ key: 'name', value: 'Alice' })],
    };
    const v2 = migrateV1ToV2(v1);

    expect(v2.user_profile).toHaveLength(1);
    const entry = v2.user_profile[0];
    expect(entry.confidence).toBe(0.8);
    expect(entry.lastAccessedAt).toBe('2024-01-15T10:00:00.000Z');
    expect(entry.accessCount).toBe(0);
    expect(entry.channel).toBe('web');
  });

  it('should handle empty V1 data', () => {
    const v1 = createV1Memory();
    const v2 = migrateV1ToV2(v1);

    expect(v2.version).toBe(2);
    expect(v2.user_profile).toEqual([]);
    expect(v2.learned_preference).toEqual([]);
    expect(v2.interaction_pattern).toEqual([]);
  });

  it('should handle multiple entries across all categories', () => {
    const v1: MemoryData = {
      ...createV1Memory(),
      user_profile: [makeV1Entry({ key: 'a' }), makeV1Entry({ key: 'b' })],
      learned_preference: [makeV1Entry({ key: 'c' })],
      interaction_pattern: [makeV1Entry({ key: 'd' }), makeV1Entry({ key: 'e' }), makeV1Entry({ key: 'f' })],
    };
    const v2 = migrateV1ToV2(v1);

    expect(v2.user_profile).toHaveLength(2);
    expect(v2.learned_preference).toHaveLength(1);
    expect(v2.interaction_pattern).toHaveLength(3);

    const allEntries = [...v2.user_profile, ...v2.learned_preference, ...v2.interaction_pattern];
    for (const entry of allEntries) {
      expect(entry.confidence).toBe(0.8);
      expect(entry.accessCount).toBe(0);
      expect(entry.channel).toBe('web');
    }
  });
});

import { vi, beforeEach, afterEach } from 'vitest';

describe('loadMemory auto-migration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should auto-migrate V1 data to V2 and save', async () => {
    const v1Data: MemoryData = {
      ...createV1Memory(),
      user_profile: [makeV1Entry({ key: 'name', value: 'Alice' })],
    };
    let savedContent: string | null = null;

    vi.doMock('fs/promises', () => ({
      default: {
        readFile: vi.fn().mockResolvedValue(JSON.stringify(v1Data)),
        writeFile: vi.fn().mockImplementation((_p: string, content: string) => {
          savedContent = content;
          return Promise.resolve();
        }),
        mkdir: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const { loadMemory } = await import('../secretary-memory');
    const result = await loadMemory();

    expect(result.version).toBe(2);
    expect(result.user_profile).toHaveLength(1);
    expect(result.user_profile[0].confidence).toBe(0.8);
    expect(result.user_profile[0].channel).toBe('web');
    expect(savedContent).not.toBeNull();
    const saved = JSON.parse(savedContent!);
    expect(saved.version).toBe(2);
  });

  it('should return V2 data as-is without re-saving', async () => {
    const v2Data = {
      version: 2,
      user_profile: [],
      learned_preference: [],
      interaction_pattern: [],
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const writeFileMock = vi.fn();

    vi.doMock('fs/promises', () => ({
      default: {
        readFile: vi.fn().mockResolvedValue(JSON.stringify(v2Data)),
        writeFile: writeFileMock,
        mkdir: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const { loadMemory } = await import('../secretary-memory');
    const result = await loadMemory();

    expect(result.version).toBe(2);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('should return empty V2 memory when file does not exist', async () => {
    vi.doMock('fs/promises', () => ({
      default: {
        readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        writeFile: vi.fn(),
        mkdir: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const { loadMemory } = await import('../secretary-memory');
    const result = await loadMemory();

    expect(result.version).toBe(2);
    expect(result.user_profile).toEqual([]);
  });

  it('should return empty V2 memory for invalid JSON', async () => {
    vi.doMock('fs/promises', () => ({
      default: {
        readFile: vi.fn().mockResolvedValue('not valid json{{{'),
        writeFile: vi.fn(),
        mkdir: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const { loadMemory } = await import('../secretary-memory');
    const result = await loadMemory();

    expect(result.version).toBe(2);
    expect(result.user_profile).toEqual([]);
  });
});

describe('createEmptyMemory returns V2', () => {
  it('should return V2 format', async () => {
    const { createEmptyMemory } = await import('../secretary-memory');
    const empty = createEmptyMemory();

    expect(empty.version).toBe(2);
    expect(empty.user_profile).toEqual([]);
    expect(empty.learned_preference).toEqual([]);
    expect(empty.interaction_pattern).toEqual([]);
    expect(typeof empty.updatedAt).toBe('string');
  });
});

// ========== recordAccess Tests ==========

import { recordAccess, type MemoryEntryV2, type MemoryDataV2 } from '../secretary-memory';

function makeV2Entry(overrides: Partial<MemoryEntryV2> = {}): MemoryEntryV2 {
  return {
    key: 'test_key',
    value: 'test value',
    source: 'test source',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-16T10:00:00.000Z',
    confidence: 0.8,
    lastAccessedAt: '2024-01-15T10:00:00.000Z',
    accessCount: 0,
    channel: 'web',
    ...overrides,
  };
}

function makeV2Memory(overrides: Partial<MemoryDataV2> = {}): MemoryDataV2 {
  return {
    version: 2,
    user_profile: [],
    learned_preference: [],
    interaction_pattern: [],
    work_events: [],
    dispatch_learnings: [],
    intent_examples: [],
    updatedAt: '2024-01-16T10:00:00.000Z',
    ...overrides,
  };
}

describe('recordAccess', () => {
  it('should increment accessCount by 1 for a found entry', () => {
    const entry = makeV2Entry({ key: 'job_title', accessCount: 3 });
    const memory = makeV2Memory({ user_profile: [entry] });

    const result = recordAccess(memory, 'user_profile', 'job_title');
    expect(result.user_profile[0].accessCount).toBe(4);
  });

  it('should update lastAccessedAt to current time', () => {
    const entry = makeV2Entry({ key: 'job_title', lastAccessedAt: '2020-01-01T00:00:00.000Z' });
    const memory = makeV2Memory({ user_profile: [entry] });

    const before = new Date().toISOString();
    const result = recordAccess(memory, 'user_profile', 'job_title');
    const after = new Date().toISOString();

    expect(result.user_profile[0].lastAccessedAt >= before).toBe(true);
    expect(result.user_profile[0].lastAccessedAt <= after).toBe(true);
  });

  it('should return memory unchanged when key is not found', () => {
    const memory = makeV2Memory({ user_profile: [makeV2Entry({ key: 'existing' })] });
    const result = recordAccess(memory, 'user_profile', 'nonexistent');
    expect(result).toBe(memory);
  });

  it('should not mutate the original memory', () => {
    const entry = makeV2Entry({ key: 'pref', accessCount: 0 });
    const memory = makeV2Memory({ learned_preference: [entry] });

    const result = recordAccess(memory, 'learned_preference', 'pref');

    expect(memory.learned_preference[0].accessCount).toBe(0);
    expect(result.learned_preference[0].accessCount).toBe(1);
    expect(result).not.toBe(memory);
  });
});

// ========== upsertEntry Channel Merge Tests ==========

import { upsertEntry } from '../secretary-memory';

describe('upsertEntry channel merge logic', () => {
  it('should merge same-key entries from different channels', () => {
    const memory = makeV2Memory({
      user_profile: [
        makeV2Entry({ key: 'job_title', value: '工程师', channel: 'web' }),
      ],
    });

    const result = upsertEntry(memory, 'user_profile', {
      key: 'job_title',
      value: '高级工程师',
      source: '飞书对话',
      channel: 'feishu',
    });

    expect(result.user_profile).toHaveLength(1);
    expect(result.user_profile[0].channel).toBe('feishu');
    expect(result.user_profile[0].value).toBe('高级工程师');
  });

  it('should set channel on new entry creation', () => {
    const memory = makeV2Memory();

    const result = upsertEntry(memory, 'user_profile', {
      key: 'name',
      value: '张三',
      source: '飞书对话',
      channel: 'feishu',
    }) as MemoryDataV2;

    expect(result.user_profile).toHaveLength(1);
    expect(result.user_profile[0].channel).toBe('feishu');
  });

  it('should not mutate the original memory when merging channels', () => {
    const original = makeV2Entry({ key: 'pref', value: 'old', channel: 'web' });
    const memory = makeV2Memory({ learned_preference: [original] });

    const result = upsertEntry(memory, 'learned_preference', {
      key: 'pref',
      value: 'new',
      source: '飞书',
      channel: 'feishu',
    }) as MemoryDataV2;

    expect(memory.learned_preference[0].channel).toBe('web');
    expect(memory.learned_preference[0].value).toBe('old');
    expect(result.learned_preference[0].channel).toBe('feishu');
    expect(result.learned_preference[0].value).toBe('new');
    expect(result).not.toBe(memory);
  });
});

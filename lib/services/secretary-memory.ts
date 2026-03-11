/**
 * Secretary Memory Store Service
 *
 * Manages persistent memory data for the secretary employee.
 * Stores user profile, learned preferences, and interaction patterns
 * as a JSON file, following the same storage pattern as secretary-session.ts.
 *
 * Storage location:
 * - Production (Electron): {userData}/settings/secretary-memory.json
 * - Development: {cwd}/data/secretary-memory.json
 */

import fs from 'fs/promises';
import path from 'path';

// ========== Interfaces ==========

export interface MemoryEntry {
  key: string;
  value: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  count?: number;
  confidence?: number;
  lastAccessedAt?: string;
  accessCount?: number;
  channel?: string;
}

export interface MemoryEntryV2 extends MemoryEntry {
  confidence: number;
  lastAccessedAt: string;
  accessCount: number;
  channel: string;
}

export type MemoryCategory = 'user_profile' | 'learned_preference' | 'interaction_pattern' | 'work_events' | 'dispatch_learnings' | 'intent_examples';

export interface MemoryData {
  version: 1;
  user_profile: MemoryEntry[];
  learned_preference: MemoryEntry[];
  interaction_pattern: MemoryEntry[];
  work_events: MemoryEntry[];
  dispatch_learnings: MemoryEntry[];
  intent_examples: MemoryEntry[];
  updatedAt: string;
}

export interface MemoryDataV2 {
  version: 2;
  user_profile: MemoryEntryV2[];
  learned_preference: MemoryEntryV2[];
  interaction_pattern: MemoryEntryV2[];
  work_events: MemoryEntryV2[];
  dispatch_learnings: MemoryEntryV2[];
  intent_examples: MemoryEntryV2[];
  updatedAt: string;
}

// ========== Internal Helpers ==========

function getMemoryDir(): string {
  return process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
}

function getMemoryFilePath(): string {
  return path.join(getMemoryDir(), 'secretary-memory.json');
}

/** Safe accessor for category entries from either V1 or V2 memory */
function getCategoryEntries(memory: MemoryData | MemoryDataV2, category: MemoryCategory): MemoryEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (memory as any)[category] || [];
}

// ========== Migration ==========

/**
 * Migrate V1 memory data to V2 format.
 * Adds confidence, lastAccessedAt, accessCount, channel to each entry.
 */
export function migrateV1ToV2(v1: MemoryData): MemoryDataV2 {
  function upgradeEntry(entry: MemoryEntry): MemoryEntryV2 {
    return {
      ...entry,
      confidence: entry.confidence ?? 0.8,
      lastAccessedAt: entry.lastAccessedAt ?? entry.createdAt,
      accessCount: entry.accessCount ?? 0,
      channel: entry.channel ?? 'web',
    };
  }

  return {
    version: 2,
    user_profile: v1.user_profile.map(upgradeEntry),
    learned_preference: v1.learned_preference.map(upgradeEntry),
    interaction_pattern: v1.interaction_pattern.map(upgradeEntry),
    work_events: [],
    dispatch_learnings: [],
    intent_examples: [],
    updatedAt: v1.updatedAt,
  };
}

// ========== Public API ==========

/**
 * Create a new empty V2 memory structure.
 */
export function createEmptyMemory(): MemoryDataV2 {
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

/**
 * Load memory data from the JSON file.
 * Auto-migrates V1 data to V2 on load.
 */
export async function loadMemory(): Promise<MemoryDataV2> {
  const filePath = getMemoryFilePath();

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (isValidMemoryDataV2(parsed)) {
      // Ensure work_events and dispatch_learnings exist (backward compat with older V2 data)
      const data = parsed as MemoryDataV2;
      if (!Array.isArray(data.work_events)) {
        data.work_events = [];
      }
      if (!Array.isArray(data.dispatch_learnings)) {
        data.dispatch_learnings = [];
      }
      if (!Array.isArray(data.intent_examples)) {
        data.intent_examples = [];
      }
      return data;
    }

    if (isValidMemoryDataV1(parsed)) {
      const migrated = migrateV1ToV2(parsed);
      await saveMemory(migrated);
      return migrated;
    }

    console.warn('[SecretaryMemory] Invalid memory data, returning empty memory');
    return createEmptyMemory();
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return createEmptyMemory();
    }
    console.warn('[SecretaryMemory] Failed to load memory, returning empty memory:', error);
    return createEmptyMemory();
  }
}

/**
 * Save memory data to the JSON file.
 */
export async function saveMemory(memory: MemoryData | MemoryDataV2): Promise<void> {
  const filePath = getMemoryFilePath();
  const dir = getMemoryDir();
  await fs.mkdir(dir, { recursive: true });

  const memoryToSave = {
    ...memory,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(filePath, JSON.stringify(memoryToSave, null, 2), 'utf-8');
}

export function getEntriesByCategory(
  memory: MemoryData | MemoryDataV2,
  category: MemoryCategory,
): MemoryEntry[] {
  return getCategoryEntries(memory, category);
}

/**
 * Insert or update a memory entry within a category.
 * Returns a new memory object (immutable update).
 */
export function upsertEntry(
  memory: MemoryData | MemoryDataV2,
  category: MemoryCategory,
  entry: Omit<MemoryEntry, 'createdAt' | 'updatedAt'>,
): MemoryData | MemoryDataV2 {
  const now = new Date().toISOString();
  const existingEntries = getCategoryEntries(memory, category);
  const existingIndex = existingEntries.findIndex((e: MemoryEntry) => e.key === entry.key);

  let updatedEntries: MemoryEntry[];

  if (existingIndex >= 0) {
    const existing = existingEntries[existingIndex];
    const updatedEntry: MemoryEntry = {
      ...existing,
      value: entry.value,
      source: entry.source,
      updatedAt: now,
    };

    if (category === 'interaction_pattern') {
      updatedEntry.count = (existing.count || 0) + (entry.count || 1);
    }

    // Merge V2 fields if provided
    if (entry.channel !== undefined) updatedEntry.channel = entry.channel;
    if (entry.confidence !== undefined) updatedEntry.confidence = entry.confidence;
    if (entry.lastAccessedAt !== undefined) updatedEntry.lastAccessedAt = entry.lastAccessedAt;
    if (entry.accessCount !== undefined) updatedEntry.accessCount = entry.accessCount;

    updatedEntries = [...existingEntries];
    updatedEntries[existingIndex] = updatedEntry;
  } else {
    const newEntry: MemoryEntry = {
      key: entry.key,
      value: entry.value,
      source: entry.source,
      createdAt: now,
      updatedAt: now,
    };

    if (category === 'interaction_pattern') {
      newEntry.count = entry.count || 1;
    }

    // Carry over V2 fields if provided
    if (entry.channel !== undefined) newEntry.channel = entry.channel;
    if (entry.confidence !== undefined) newEntry.confidence = entry.confidence;
    if (entry.lastAccessedAt !== undefined) newEntry.lastAccessedAt = entry.lastAccessedAt;
    if (entry.accessCount !== undefined) newEntry.accessCount = entry.accessCount;

    updatedEntries = [...existingEntries, newEntry];
  }

  return {
    ...memory,
    [category]: updatedEntries,
    updatedAt: now,
  };
}

/**
 * Delete a memory entry by key within a category.
 */
export function deleteEntry(
  memory: MemoryData | MemoryDataV2,
  category: MemoryCategory,
  key: string,
): MemoryData | MemoryDataV2 {
  const existingEntries = getCategoryEntries(memory, category);
  const filteredEntries = existingEntries.filter((e: MemoryEntry) => e.key !== key);

  if (filteredEntries.length === existingEntries.length) {
    return memory;
  }

  return {
    ...memory,
    [category]: filteredEntries,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Clear all memory entries, returning a fresh empty V2 memory.
 */
export function clearAllEntries(): MemoryDataV2 {
  return createEmptyMemory();
}

/**
 * Record an access to a specific entry (increment accessCount, update lastAccessedAt).
 */
export function recordAccess(
  memory: MemoryDataV2,
  category: MemoryCategory,
  key: string,
): MemoryDataV2 {
  const entries = memory[category];
  const idx = entries.findIndex((e) => e.key === key);
  if (idx < 0) return memory;

  const entry = entries[idx];
  const updatedEntry: MemoryEntryV2 = {
    ...entry,
    accessCount: (entry.accessCount ?? 0) + 1,
    lastAccessedAt: new Date().toISOString(),
  };

  const updatedEntries = [...entries];
  updatedEntries[idx] = updatedEntry;

  return {
    ...memory,
    [category]: updatedEntries,
  };
}

// ========== Validation Helpers ==========

function isValidMemoryDataV1(obj: unknown): obj is MemoryData {
  if (!obj || typeof obj !== 'object') return false;
  const m = obj as Record<string, unknown>;
  return (
    m.version === 1 &&
    Array.isArray(m.user_profile) &&
    Array.isArray(m.learned_preference) &&
    Array.isArray(m.interaction_pattern) &&
    typeof m.updatedAt === 'string'
  );
}

function isValidMemoryDataV2(obj: unknown): obj is MemoryDataV2 {
  if (!obj || typeof obj !== 'object') return false;
  const m = obj as Record<string, unknown>;
  return (
    m.version === 2 &&
    Array.isArray(m.user_profile) &&
    Array.isArray(m.learned_preference) &&
    Array.isArray(m.interaction_pattern) &&
    typeof m.updatedAt === 'string'
  );
}

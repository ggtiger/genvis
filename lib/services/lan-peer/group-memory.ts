/**
 * LAN Peer Chat — Group Memory Service
 *
 * Each group has independent memory, isolated from the secretary main session.
 * Stored at data/lan-peer/groups/{groupId}/memory.json
 * Max 100 entries, FIFO eviction.
 *
 * Requirements: 2.6.1, 2.6.2, 2.6.3, 2.6.4
 */

import fs from 'fs/promises';
import path from 'path';
import type { GroupMemory, GroupMemoryEntry } from './types';

const DATA_DIR = path.join(process.cwd(), 'data', 'lan-peer', 'groups');
const MAX_ENTRIES = 100;

function memoryFile(groupId: string): string {
  return path.join(DATA_DIR, groupId, 'memory.json');
}

function emptyMemory(groupId: string): GroupMemory {
  return { groupId, entries: [], updatedAt: Date.now() };
}

export async function loadMemory(groupId: string): Promise<GroupMemory> {
  try {
    const raw = await fs.readFile(memoryFile(groupId), 'utf8');
    const parsed = JSON.parse(raw) as GroupMemory;
    if (parsed && parsed.groupId === groupId && Array.isArray(parsed.entries)) {
      return parsed;
    }
    return emptyMemory(groupId);
  } catch {
    return emptyMemory(groupId);
  }
}

export async function saveMemory(memory: GroupMemory): Promise<void> {
  const dir = path.join(DATA_DIR, memory.groupId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(memoryFile(memory.groupId), JSON.stringify(memory, null, 2), 'utf8');
}

export async function appendMessage(groupId: string, entry: GroupMemoryEntry): Promise<void> {
  const memory = await loadMemory(groupId);
  memory.entries.push(entry);
  // FIFO eviction
  if (memory.entries.length > MAX_ENTRIES) {
    memory.entries = memory.entries.slice(-MAX_ENTRIES);
  }
  memory.updatedAt = Date.now();
  await saveMemory(memory);
}

export function getRecentContext(memory: GroupMemory, limit: number = 20): GroupMemoryEntry[] {
  return memory.entries.slice(-limit);
}

export async function clearMemory(groupId: string): Promise<void> {
  await saveMemory(emptyMemory(groupId));
}

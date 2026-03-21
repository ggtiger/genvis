/**
 * LAN Peer Chat — Chat Service
 *
 * Manages group CRUD, message storage, and history sync.
 * Data stored as JSON files under data/lan-peer/groups/{groupId}/
 *
 * Requirements: 2.4, 2.6, 2.7, 2.8
 */

import fs from 'fs/promises';
import path from 'path';
import type { ChatGroup, ChatMessage } from './types';

const DATA_DIR = path.join(process.cwd(), 'data', 'lan-peer', 'groups');
const HISTORY_SYNC_LIMIT = 50;

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function groupDir(groupId: string): string {
  return path.join(DATA_DIR, groupId);
}

function groupFile(groupId: string): string {
  return path.join(groupDir(groupId), 'group.json');
}

function messagesFile(groupId: string): string {
  return path.join(groupDir(groupId), 'messages.json');
}

// ========== Group CRUD ==========

export async function createGroup(
  id: string,
  name: string,
  creatorId: string,
  members: string[],
  enabledSkills: string[] = [],
  systemPrompt?: string,
): Promise<ChatGroup> {
  const now = Date.now();
  const group: ChatGroup = {
    id,
    name,
    creatorId,
    members,
    enabledSkills,
    ...(systemPrompt ? { systemPrompt } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const dir = groupDir(id);
  await ensureDir(dir);
  await fs.writeFile(groupFile(id), JSON.stringify(group, null, 2), 'utf8');
  await fs.writeFile(messagesFile(id), '[]', 'utf8');
  return group;
}

export async function getGroup(groupId: string): Promise<ChatGroup | null> {
  try {
    const raw = await fs.readFile(groupFile(groupId), 'utf8');
    return JSON.parse(raw) as ChatGroup;
  } catch {
    return null;
  }
}

export async function getGroups(): Promise<ChatGroup[]> {
  try {
    await ensureDir(DATA_DIR);
    const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
    const groups: ChatGroup[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const g = await getGroup(entry.name);
      if (g) groups.push(g);
    }
    return groups;
  } catch {
    return [];
  }
}

export async function updateGroup(groupId: string, partial: Partial<Pick<ChatGroup, 'name' | 'members' | 'enabledSkills' | 'systemPrompt' | 'scheduledMessages'>>): Promise<ChatGroup | null> {
  const group = await getGroup(groupId);
  if (!group) return null;
  if (partial.name !== undefined) group.name = partial.name;
  if (partial.members !== undefined) group.members = partial.members;
  if (partial.enabledSkills !== undefined) group.enabledSkills = partial.enabledSkills;
  if (partial.systemPrompt !== undefined) group.systemPrompt = partial.systemPrompt;
  if (partial.scheduledMessages !== undefined) group.scheduledMessages = partial.scheduledMessages;
  group.updatedAt = Date.now();
  await fs.writeFile(groupFile(groupId), JSON.stringify(group, null, 2), 'utf8');
  return group;
}

/** Update the Claude SDK session ID for a group (for conversation context continuity). */
export async function updateGroupSession(groupId: string, sessionId: string): Promise<void> {
  const group = await getGroup(groupId);
  if (!group) return;
  group.activeSessionId = sessionId;
  group.updatedAt = Date.now();
  await fs.writeFile(groupFile(groupId), JSON.stringify(group, null, 2), 'utf8');
}

export async function deleteGroup(groupId: string): Promise<boolean> {
  try {
    await fs.rm(groupDir(groupId), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// ========== Messages ==========

export async function getMessages(groupId: string, limit?: number, before?: number): Promise<ChatMessage[]> {
  try {
    const raw = await fs.readFile(messagesFile(groupId), 'utf8');
    let msgs: ChatMessage[] = JSON.parse(raw);
    if (before) {
      msgs = msgs.filter((m) => m.timestamp < before);
    }
    if (limit && limit > 0) {
      msgs = msgs.slice(-limit);
    }
    return msgs;
  } catch {
    return [];
  }
}

export async function addMessage(groupId: string, message: ChatMessage): Promise<void> {
  const msgs = await getMessages(groupId);
  msgs.push(message);
  await ensureDir(groupDir(groupId));
  await fs.writeFile(messagesFile(groupId), JSON.stringify(msgs, null, 2), 'utf8');
}

/** Get the latest N messages for history sync */
export async function getHistoryForSync(groupId: string): Promise<ChatMessage[]> {
  const msgs = await getMessages(groupId);
  return msgs.slice(-HISTORY_SYNC_LIMIT);
}

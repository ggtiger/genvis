/**
 * LAN Peer Chat — Database Message Service
 *
 * CRUD operations for LAN chat messages stored in SQLite via Drizzle ORM.
 * Replaces the previous JSON file storage for messages.
 */

import { db } from '@/lib/db/client';
import { lanMessages } from '@/lib/db/schema';
import { eq, asc, desc, lt, count, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

// ========== Types ==========

export interface CreateLanMessageInput {
  id?: string;
  groupId: string;
  role: 'user' | 'assistant' | 'tool';
  messageType: string;
  content: string;
  senderId?: string;
  senderName?: string;
  interactionMode?: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
  requestId?: string;
}

export interface LanMessage {
  id: string;
  groupId: string;
  role: string;
  messageType: string;
  content: string;
  senderId: string | null;
  senderName: string | null;
  interactionMode: string | null;
  metadataJson: string | null;
  sessionId: string | null;
  requestId: string | null;
  createdAt: string;
}

// ========== Helpers ==========

function mapRow(row: typeof lanMessages.$inferSelect): LanMessage {
  return {
    id: row.id,
    groupId: row.groupId,
    role: row.role,
    messageType: row.messageType,
    content: row.content,
    senderId: row.senderId ?? null,
    senderName: row.senderName ?? null,
    interactionMode: row.interactionMode ?? null,
    metadataJson: row.metadataJson ?? null,
    sessionId: row.sessionId ?? null,
    requestId: row.requestId ?? null,
    createdAt: row.createdAt,
  };
}

// ========== CRUD ==========

/**
 * Insert a LAN chat message with retry logic.
 */
export async function createLanMessage(input: CreateLanMessageInput): Promise<LanMessage> {
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const [row] = await db.insert(lanMessages).values({
        id: input.id || randomUUID(),
        groupId: input.groupId,
        role: input.role,
        messageType: input.messageType,
        content: input.content,
        senderId: input.senderId ?? null,
        senderName: input.senderName ?? null,
        interactionMode: input.interactionMode ?? null,
        metadataJson,
        sessionId: input.sessionId ?? null,
        requestId: input.requestId ?? null,
        createdAt: new Date().toISOString(),
      }).returning();

      return mapRow(row);
    } catch (error) {
      lastError = error as Error;
      console.error(`[LanMessageService] Attempt ${attempt} failed:`, error);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));
      }
    }
  }

  throw lastError || new Error('Failed to create LAN message after 3 attempts');
}

/**
 * Get messages for a group, ordered by creation time.
 */
export async function getLanMessagesByGroup(
  groupId: string,
  limit: number = 100,
  beforeId?: string,
): Promise<LanMessage[]> {
  let rows: (typeof lanMessages.$inferSelect)[];

  if (beforeId) {
    // Get the createdAt of the cursor message
    const [cursorRow] = await db.select({ createdAt: lanMessages.createdAt })
      .from(lanMessages)
      .where(eq(lanMessages.id, beforeId))
      .limit(1);

    if (cursorRow) {
      // Get messages BEFORE the cursor, ordered newest-first, then reverse
      rows = await db.select()
        .from(lanMessages)
        .where(and(eq(lanMessages.groupId, groupId), lt(lanMessages.createdAt, cursorRow.createdAt)))
        .orderBy(desc(lanMessages.createdAt))
        .limit(limit);
      // Reverse to chronological order
      rows.reverse();
    } else {
      rows = [];
    }
  } else {
    // Get the LATEST N messages: order DESC to pick newest, then reverse to chronological
    rows = await db.select()
      .from(lanMessages)
      .where(eq(lanMessages.groupId, groupId))
      .orderBy(desc(lanMessages.createdAt))
      .limit(limit);
    // Reverse to chronological order (oldest → newest)
    rows.reverse();
  }

  return rows.map(mapRow);
}

/**
 * Get the message count for a group.
 */
export async function getLanMessageCount(groupId: string): Promise<number> {
  const [result] = await db.select({ value: count() })
    .from(lanMessages)
    .where(eq(lanMessages.groupId, groupId));
  return result?.value ?? 0;
}

/**
 * Delete all messages for a group (used when dissolving a group).
 */
export async function deleteLanMessagesByGroup(groupId: string): Promise<number> {
  try {
    const result = await db.delete(lanMessages).where(eq(lanMessages.groupId, groupId));
    return (result as unknown as { changes?: number })?.changes ?? 0;
  } catch (error) {
    console.error(`[LanMessageService] Failed to delete messages for group ${groupId}:`, error);
    return 0;
  }
}

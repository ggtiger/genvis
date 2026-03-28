/**
 * Secretary — Database Message Service
 *
 * CRUD operations for Secretary chat messages stored in SQLite via Drizzle ORM.
 * Replaces the previous JSON file storage for messages.
 */

import { db } from '@/lib/db/client';
import { secretaryMessages } from '@/lib/db/schema';
import { eq, desc, lt, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';

// ========== Types ==========

export interface CreateSecretaryMessageInput {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  messageType: string;
  content: string;
  senderId?: string;
  senderName?: string;
  interactionMode?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

export interface SecretaryMessage {
  id: string;
  role: string;
  messageType: string;
  content: string;
  senderId: string;
  senderName: string;
  interactionMode: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
  createdAt: string;
  // Top-level fields extracted from metadata for UI compatibility
  actions?: Array<{
    type: 'dispatch' | 'skill_call' | 'info';
    employeeId?: string;
    employeeName?: string;
    projectId?: string;
    skillName?: string;
    endpoint?: string;
    result?: unknown;
    confidence?: number;
  }>;
  images?: string[];
  attachments?: Array<{
    name: string;
    mimeType: string;
    size: number;
    url?: string;
    absolutePath?: string;
  }>;
}

export interface GetSecretaryMessagesOptions {
  limit?: number;
  offset?: number;
  before?: string; // message ID for cursor-based pagination
}

// ========== Helpers ==========

function mapRow(row: typeof secretaryMessages.$inferSelect): SecretaryMessage {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadataJson) {
    try {
      metadata = JSON.parse(row.metadataJson);
    } catch {
      console.warn('[SecretaryMessageService] Failed to parse metadataJson:', row.metadataJson);
    }
  }

  // Extract common fields from metadata to top level for frontend compatibility
  const actions = metadata?.actions as SecretaryMessage['actions'];
  const images = metadata?.images as SecretaryMessage['images'];
  const attachments = metadata?.attachments as SecretaryMessage['attachments'];

  return {
    id: row.id,
    role: row.role,
    messageType: row.messageType,
    content: row.content,
    senderId: row.senderId || 'user',
    senderName: row.senderName || '用户',
    interactionMode: row.interactionMode || 'plain',
    metadata,
    requestId: row.requestId || undefined,
    createdAt: row.createdAt,
    ...(actions ? { actions } : {}),
    ...(images ? { images } : {}),
    ...(attachments ? { attachments } : {}),
  };
}

// ========== CRUD ==========

/**
 * Insert a secretary message with retry logic.
 * Enhanced retry strategy:
 * - 5 retry attempts (increased from 3)
 * - DB lock errors (SQLITE_BUSY, database is locked): longer delay with 500ms base
 * - Other errors: shorter delay with 100ms base
 */
export async function createSecretaryMessage(input: CreateSecretaryMessageInput): Promise<SecretaryMessage> {
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  let lastError: Error | null = null;
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const [row] = await db.insert(secretaryMessages).values({
        id: input.id || randomUUID(),
        role: input.role,
        messageType: input.messageType,
        content: input.content,
        senderId: input.senderId ?? null,
        senderName: input.senderName ?? null,
        interactionMode: input.interactionMode ?? null,
        metadataJson,
        requestId: input.requestId ?? null,
        createdAt: new Date().toISOString(),
      }).returning();

      return mapRow(row);
    } catch (error) {
      lastError = error as Error;
      const errMsg = lastError.message || '';
      
      // Check if it's a DB lock error
      const isDbLockError = errMsg.includes('SQLITE_BUSY') || errMsg.includes('database is locked');
      const errorType = isDbLockError ? 'DB_LOCKED' : 'OTHER';
      
      console.error(`[SecretaryMessageService] Attempt ${attempt}/${MAX_ATTEMPTS} failed [${errorType}]:`, errMsg);
      
      if (attempt < MAX_ATTEMPTS) {
        // DB lock errors: longer delay (500ms base, exponential backoff)
        // Other errors: shorter delay (100ms base, exponential backoff)
        const baseDelay = isDbLockError ? 500 : 100;
        const delay = Math.pow(2, attempt - 1) * baseDelay;
        console.log(`[SecretaryMessageService] Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error(`Failed to create secretary message after ${MAX_ATTEMPTS} attempts`);
}

/**
 * Get secretary messages, ordered by creation time (newest last).
 * Supports limit, offset, and cursor-based pagination (before).
 */
export async function getSecretaryMessages(
  options: GetSecretaryMessagesOptions = {}
): Promise<SecretaryMessage[]> {
  const { limit = 100, offset, before } = options;
  let rows: (typeof secretaryMessages.$inferSelect)[];

  if (before) {
    // Cursor-based pagination: get messages before the specified message ID
    const [cursorRow] = await db.select({ createdAt: secretaryMessages.createdAt })
      .from(secretaryMessages)
      .where(eq(secretaryMessages.id, before))
      .limit(1);

    if (cursorRow) {
      // Get messages BEFORE the cursor, ordered newest-first, then reverse
      rows = await db.select()
        .from(secretaryMessages)
        .where(lt(secretaryMessages.createdAt, cursorRow.createdAt))
        .orderBy(desc(secretaryMessages.createdAt))
        .limit(limit);
      // Reverse to chronological order
      rows.reverse();
    } else {
      rows = [];
    }
  } else if (offset !== undefined) {
    // Offset-based pagination: skip offset messages
    rows = await db.select()
      .from(secretaryMessages)
      .orderBy(desc(secretaryMessages.createdAt))
      .limit(limit)
      .offset(offset);
    // Reverse to chronological order
    rows.reverse();
  } else {
    // Get the LATEST N messages: order DESC to pick newest, then reverse to chronological
    rows = await db.select()
      .from(secretaryMessages)
      .orderBy(desc(secretaryMessages.createdAt))
      .limit(limit);
    // Reverse to chronological order (oldest → newest)
    rows.reverse();
  }

  return rows.map(mapRow);
}

/**
 * Get the total count of secretary messages.
 */
export async function getSecretaryMessageCount(): Promise<number> {
  const [result] = await db.select({ value: count() })
    .from(secretaryMessages);
  return result?.value ?? 0;
}

/**
 * Delete all secretary messages (used for clearing history).
 */
export async function deleteSecretaryMessages(): Promise<number> {
  try {
    const result = await db.delete(secretaryMessages);
    return (result as unknown as { changes?: number })?.changes ?? 0;
  } catch (error) {
    console.error('[SecretaryMessageService] Failed to delete all messages:', error);
    return 0;
  }
}

/**
 * Delete a single secretary message by ID.
 */
export async function deleteSecretaryMessage(id: string): Promise<boolean> {
  try {
    const result = await db.delete(secretaryMessages).where(eq(secretaryMessages.id, id));
    const changes = (result as unknown as { changes?: number })?.changes ?? 0;
    return changes > 0;
  } catch (error) {
    console.error(`[SecretaryMessageService] Failed to delete message ${id}:`, error);
    return false;
  }
}

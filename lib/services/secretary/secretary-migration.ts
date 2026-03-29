/**
 * Secretary — Data Migration Service
 *
 * Migrates old JSON-based secretary messages to new SQLite storage.
 * Ensures smooth transition with backward compatibility.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createSecretaryMessage, getSecretaryMessageCount } from './secretary-message-service';

// ========== Constants ==========

const DATA_DIR = process.env.SETTINGS_DIR || join(process.cwd(), 'data');
const OLD_SESSION_FILE = join(DATA_DIR, 'secretary-session.json');
const LOG_PREFIX = '[Secretary Migration]';

// Module-level flag to ensure migration runs only once per process
let migrationChecked = false;
let migrationPromise: Promise<void> | null = null;

// ========== Types ==========

interface OldMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  source?: string;
  actions?: Array<{
    type: string;
    [key: string]: unknown;
  }>;
  images?: string[];
}

interface OldSessionData {
  id?: string;
  messages?: OldMessage[];
  createdAt?: string;
  updatedAt?: string;
  scheduledMessages?: unknown[];
  summary?: unknown;
  _migrated?: boolean;
}

// ========== Migration Functions ==========

/**
 * Main migration function: migrates old JSON messages to SQLite.
 * This function is idempotent - safe to call multiple times.
 */
export async function migrateSecretaryData(): Promise<{ migrated: number; skipped: number; errors: number }> {
  const result = { migrated: 0, skipped: 0, errors: 0 };

  // 1. Check if old session file exists
  if (!existsSync(OLD_SESSION_FILE)) {
    console.log(`${LOG_PREFIX} No old session file found at ${OLD_SESSION_FILE}, skipping migration.`);
    return result;
  }

  // 2. Read and parse old session data
  let oldData: OldSessionData;
  try {
    const rawData = readFileSync(OLD_SESSION_FILE, 'utf-8');
    oldData = JSON.parse(rawData);
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to read/parse old session file:`, err);
    return result;
  }

  // 3. Check if already migrated (via _migrated flag)
  if (oldData._migrated === true) {
    console.log(`${LOG_PREFIX} Old session file already marked as migrated, skipping.`);
    return result;
  }

  // 4. Check if SQLite already has data (avoid duplicate migration)
  const existingCount = await getSecretaryMessageCount();
  if (existingCount > 0) {
    console.log(`${LOG_PREFIX} SQLite already has ${existingCount} messages, skipping migration.`);
    // Mark as migrated since DB already has data
    markAsMigrated(oldData);
    return result;
  }

  // 5. Validate messages array
  const messages = oldData.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    console.log(`${LOG_PREFIX} No messages to migrate.`);
    markAsMigrated(oldData);
    return result;
  }

  console.log(`${LOG_PREFIX} Starting migration of ${messages.length} messages...`);

  // 6. Migrate each message
  for (let i = 0; i < messages.length; i++) {
    const oldMsg = messages[i];
    
    try {
      // Validate message structure
      if (!oldMsg || typeof oldMsg.content !== 'string' || !oldMsg.role) {
        console.warn(`${LOG_PREFIX} Skipping invalid message at index ${i}:`, oldMsg);
        result.skipped++;
        continue;
      }

      // Map old format to new format
      const newMessage = mapOldToNewMessage(oldMsg);
      
      // Insert into database
      await createSecretaryMessage(newMessage);
      result.migrated++;

      // Log progress every 50 messages
      if ((i + 1) % 50 === 0) {
        console.log(`${LOG_PREFIX} Progress: ${i + 1}/${messages.length} messages processed.`);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Error migrating message at index ${i}:`, err);
      result.errors++;
    }
  }

  // 7. Mark migration complete
  markAsMigrated(oldData);

  console.log(`${LOG_PREFIX} Migration complete. Migrated: ${result.migrated}, Skipped: ${result.skipped}, Errors: ${result.errors}`);
  return result;
}

/**
 * Maps an old JSON message to the new CreateSecretaryMessageInput format.
 */
function mapOldToNewMessage(oldMsg: OldMessage): {
  role: 'user' | 'assistant' | 'system';
  messageType: string;
  content: string;
  senderId: string;
  senderName: string;
  interactionMode: string;
  metadata?: Record<string, unknown>;
} {
  const isUser = oldMsg.role === 'user';
  
  // Build metadata from actions and images
  const metadata: Record<string, unknown> = {};
  
  if (oldMsg.actions && oldMsg.actions.length > 0) {
    metadata.actions = oldMsg.actions;
  }
  
  if (oldMsg.images && oldMsg.images.length > 0) {
    metadata.images = oldMsg.images;
  }
  
  if (oldMsg.source) {
    metadata.source = oldMsg.source;
  }
  
  if (oldMsg.timestamp) {
    metadata.originalTimestamp = oldMsg.timestamp;
  }

  return {
    role: oldMsg.role,
    messageType: 'text',
    content: oldMsg.content,
    senderId: isUser ? 'user' : 'ai-assistant',
    senderName: isUser ? '我' : '秘书',
    interactionMode: oldMsg.source || 'web',
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

/**
 * Marks the old JSON file as migrated by adding _migrated flag.
 */
function markAsMigrated(oldData: OldSessionData): void {
  try {
    oldData._migrated = true;
    writeFileSync(OLD_SESSION_FILE, JSON.stringify(oldData, null, 2), 'utf-8');
    console.log(`${LOG_PREFIX} Marked old session file as migrated.`);
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to mark migration status:`, err);
  }
}

/**
 * Ensures migration is run exactly once per process lifetime.
 * This function is idempotent and safe to call from multiple places.
 */
export async function ensureSecretaryMigration(): Promise<void> {
  // Fast path: already checked this process
  if (migrationChecked) {
    return;
  }

  // Use a shared promise to prevent concurrent migrations
  if (!migrationPromise) {
    migrationPromise = (async () => {
      try {
        await migrateSecretaryData();
      } catch (err) {
        console.error(`${LOG_PREFIX} Migration failed:`, err);
      } finally {
        migrationChecked = true;
      }
    })();
  }

  await migrationPromise;
}

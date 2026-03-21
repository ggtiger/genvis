/**
 * Secretary Session Service
 *
 * Manages the secretary's conversation session using a JSON file.
 * Single session mode: one session file for the homepage secretary.
 *
 * Storage location:
 * - Production (Electron): {userData}/settings/secretary-session.json
 * - Development: {cwd}/data/secretary-session.json
 *
 * Validates: Requirements 5.3
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

// ========== Interfaces ==========

export interface SecretaryAction {
  type: 'dispatch' | 'skill_call' | 'info';
  employeeId?: string;
  employeeName?: string;
  projectId?: string;
  skillName?: string;
  endpoint?: string;
  result?: any;
  /** AI 决策置信度 0-1 */
  confidence?: number;
}

/** 消息来源渠道 */
export type MessageSource = 'web' | 'dingtalk' | 'feishu' | 'wechat' | 'wecom' | 'qq' | 'skill';

export interface SecretaryAttachment {
  name: string;
  mimeType: string;
  size: number;
  url?: string;        // public URL or path for opening
  absolutePath?: string;
}

export interface SecretaryMessage {
  role: 'user' | 'assistant';
  content: string;
  actions?: SecretaryAction[];
  timestamp: string;
  /** 消息来源渠道，web 表示网页端，其他为 IM 渠道名 */
  source?: MessageSource;
  /** 附带的图片 URL 列表（用于聊天中预览） */
  images?: string[];
  /** 附带的文件附件（非图片） */
  attachments?: SecretaryAttachment[];
}

/** 秘书定时消息配置 */
export interface SecretaryScheduledMessage {
  id: string;
  content: string;
  scheduleType: 'interval' | 'daily';
  intervalMinutes: number;
  scheduledTime?: string;    // HH:MM format for daily mode
  aiReply: boolean;          // whether AI should process the message
  enabled: boolean;
  lastSentAt?: number;       // epoch ms
}

export interface SecretarySession {
  id: string;
  messages: SecretaryMessage[];
  createdAt: string;
  updatedAt: string;
  /** Compressed summary of older messages */
  summary?: {
    text: string;
    messageCount: number;
    fromDate: string;
    toDate: string;
    updatedAt: string;
  };
  /** 定时消息配置列表 */
  scheduledMessages?: SecretaryScheduledMessage[];
}

// ========== Internal Helpers ==========

/**
 * Resolve the data directory for storing the session file.
 * Follows the same pattern as settings.ts:
 * - Uses SETTINGS_DIR env var if set (production Electron sets this)
 * - Falls back to {cwd}/data (development)
 */
function getSessionDir(): string {
  return process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
}

function getSessionFilePath(): string {
  return path.join(getSessionDir(), 'secretary-session.json');
}

/** 定时消息使用独立文件，避免与会话文件的并发写冲突 */
function getScheduledMessagesFilePath(): string {
  return path.join(getSessionDir(), 'secretary-scheduled-messages.json');
}

/**
 * Create a new empty session with a fresh UUID and current timestamps.
 */
function createEmptySession(): SecretarySession {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Validate that a parsed object conforms to the SecretarySession shape.
 * Returns true if the object has the required fields with correct types.
 */
function isValidSession(obj: unknown): obj is SecretarySession {
  if (!obj || typeof obj !== 'object') return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    Array.isArray(s.messages) &&
    typeof s.createdAt === 'string' &&
    typeof s.updatedAt === 'string'
  );
}

// ========== Public API ==========

/**
 * Load the secretary session from the JSON file.
 * Returns an empty session if the file doesn't exist or is corrupted.
 */
export async function loadSession(): Promise<SecretarySession> {
  const filePath = getSessionFilePath();

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (isValidSession(parsed)) {
      return parsed;
    }

    // File exists but content is invalid – reset to empty
    console.warn('[SecretarySession] Invalid session data, resetting to empty session');
    return createEmptySession();
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File does not exist – normal first-run case
      return createEmptySession();
    }

    // JSON parse error or other read error – reset gracefully
    console.warn('[SecretarySession] Failed to load session, resetting to empty session:', error);
    return createEmptySession();
  }
}

/**
 * Save the secretary session to the JSON file.
 * Automatically updates the `updatedAt` timestamp.
 */
export async function saveSession(session: SecretarySession): Promise<void> {
  const filePath = getSessionFilePath();
  const dir = getSessionDir();

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  // Update the updatedAt timestamp
  const sessionToSave: SecretarySession = {
    ...session,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(filePath, JSON.stringify(sessionToSave, null, 2), 'utf-8');
}

/**
 * Clear the secretary session by deleting the session file.
 * If the file doesn't exist, this is a no-op.
 */
export async function clearSession(): Promise<void> {
  const filePath = getSessionFilePath();

  try {
    await fs.unlink(filePath);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist – nothing to clear
      return;
    }
    throw error;
  }
}

/**
 * Load scheduled messages from independent file.
 * Uses a separate file from session to avoid race conditions
 * between scheduler writes and session writes.
 */
export async function loadScheduledMessages(): Promise<SecretaryScheduledMessage[]> {
  const filePath = getScheduledMessagesFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    if (!raw.trim()) throw new Error('empty file');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    // File missing, empty, or corrupt — try to migrate from session file
    try {
      const session = await loadSession();
      if (session.scheduledMessages && session.scheduledMessages.length > 0) {
        const migrated = session.scheduledMessages;
        await saveScheduledMessages(migrated);
        console.log(`[SecretarySession] Migrated ${migrated.length} scheduled messages to independent file`);
        return migrated;
      }
    } catch { /* ignore migration errors */ }
    return [];
  }
}

/**
 * Save scheduled messages to independent file.
 * Never touches the session file — no race condition risk.
 */
export async function saveScheduledMessages(messages: SecretaryScheduledMessage[]): Promise<void> {
  const filePath = getScheduledMessagesFilePath();
  const dir = getSessionDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(messages, null, 2), 'utf-8');
}

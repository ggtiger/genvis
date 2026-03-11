/**
 * IM Session Service
 *
 * Manages per-platform, per-user conversation sessions for IM channels.
 * Each (platform, senderId) pair gets an independent session file.
 *
 * Storage location:
 * - Production (Electron): {userData}/settings/im-sessions/{platform}/{senderId}.json
 * - Development: {cwd}/data/im-sessions/{platform}/{senderId}.json
 *
 * Validates: Requirements 7.1, 7.2, 7.3
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { IMPlatform } from './types';
import type { SecretaryMessage } from '../secretary-session';

// ========== Interfaces ==========

export interface IMSession {
  id: string;
  platform: IMPlatform;
  senderId: string;
  messages: SecretaryMessage[];
  createdAt: string;
  updatedAt: string;
}

// ========== Internal Helpers ==========

/**
 * Resolve the base data directory.
 * Follows the same pattern as secretary-session.ts and settings.ts.
 */
function getDataDir(): string {
  return process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
}

/**
 * Build the session file path for a given platform and sender.
 */
function getSessionFilePath(platform: IMPlatform, senderId: string): string {
  return path.join(getDataDir(), 'im-sessions', platform, `${senderId}.json`);
}

/**
 * Create a new empty session.
 */
function createEmptySession(platform: IMPlatform, senderId: string): IMSession {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    platform,
    senderId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Validate that a parsed object conforms to the IMSession shape.
 */
function isValidSession(obj: unknown): obj is IMSession {
  if (!obj || typeof obj !== 'object') return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.platform === 'string' &&
    typeof s.senderId === 'string' &&
    Array.isArray(s.messages) &&
    typeof s.createdAt === 'string' &&
    typeof s.updatedAt === 'string'
  );
}

// ========== Public API ==========

/**
 * Load an IM session for the given platform and sender.
 * Returns an empty session if the file doesn't exist or is corrupted.
 */
export async function loadIMSession(platform: IMPlatform, senderId: string): Promise<IMSession> {
  const filePath = getSessionFilePath(platform, senderId);

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (isValidSession(parsed)) {
      return parsed;
    }

    console.warn('[IMSession] Invalid session data, resetting to empty session');
    return createEmptySession(platform, senderId);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptySession(platform, senderId);
    }

    console.warn('[IMSession] Failed to load session, resetting to empty session:', error);
    return createEmptySession(platform, senderId);
  }
}

/**
 * Save an IM session to disk.
 * Automatically updates the `updatedAt` timestamp and creates directories as needed.
 */
export async function saveIMSession(session: IMSession): Promise<void> {
  const filePath = getSessionFilePath(session.platform, session.senderId);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  const sessionToSave: IMSession = {
    ...session,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(filePath, JSON.stringify(sessionToSave, null, 2), 'utf-8');
}

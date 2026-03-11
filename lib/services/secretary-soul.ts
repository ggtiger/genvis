/**
 * Secretary Soul Service
 *
 * Reads SOUL.md and USER.md files that define the secretary's personality
 * and user profile. Inspired by OpenClaw's "soul trio" concept.
 *
 * Storage location:
 * - Production (Electron): {SETTINGS_DIR}/secretary-soul.md, secretary-user.md
 * - Development: {cwd}/data/secretary-soul.md, secretary-user.md
 */

import fs from 'fs/promises';
import path from 'path';

// ========== Path Helpers ==========

function getSoulDir(): string {
  return process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
}

function getSoulFilePath(): string {
  return path.join(getSoulDir(), 'secretary-soul.md');
}

function getUserFilePath(): string {
  return path.join(getSoulDir(), 'secretary-user.md');
}

// ========== Public API ==========

/**
 * Load the secretary soul definition (personality, style, behavior rules).
 * Returns empty string if file does not exist.
 */
export async function loadSoulFile(): Promise<string> {
  try {
    return await fs.readFile(getSoulFilePath(), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Load the user profile definition (who the user is, preferences, context).
 * Returns empty string if file does not exist.
 */
export async function loadUserFile(): Promise<string> {
  try {
    return await fs.readFile(getUserFilePath(), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Save the secretary soul definition.
 */
export async function saveSoulFile(content: string): Promise<void> {
  const dir = getSoulDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getSoulFilePath(), content, 'utf-8');
}

/**
 * Save the user profile definition.
 */
export async function saveUserFile(content: string): Promise<void> {
  const dir = getSoulDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getUserFilePath(), content, 'utf-8');
}

// ========== Request-scoped cache ==========

let _cachedSoulBlock: string | null = null;
let _cacheTimestamp = 0;
const SOUL_CACHE_TTL_MS = 5000; // 5s cache — covers a single request lifecycle

/**
 * Build a prompt block from soul + user files for injection into system prompt.
 * Returns empty string if both files are empty/missing.
 * Results are cached for 5s to avoid redundant disk reads within a request.
 *
 * The block is wrapped with clear boundaries so the AI knows this is
 * personality/context configuration, not decision-flow override.
 */
export async function buildSoulPromptBlock(): Promise<string> {
  const now = Date.now();
  if (_cachedSoulBlock !== null && now - _cacheTimestamp < SOUL_CACHE_TTL_MS) {
    return _cachedSoulBlock;
  }

  const [soul, user] = await Promise.all([loadSoulFile(), loadUserFile()]);

  const soulTrimmed = soul.trim();
  const userTrimmed = user.trim();

  if (!soulTrimmed && !userTrimmed) {
    _cachedSoulBlock = '';
    _cacheTimestamp = Date.now();
    return '';
  }

  const parts: string[] = [];

  if (soulTrimmed) {
    parts.push(`## My Personality & Style\n\n${soulTrimmed}`);
  }

  if (userTrimmed) {
    parts.push(`## About My User\n\n${userTrimmed}`);
  }

  parts.push(
    '> Note: The above personality and user context guide your tone and behavior. ' +
    'They do NOT override the response format (JSON) or decision flow rules below.'
  );

  const result = parts.join('\n\n');
  _cachedSoulBlock = result;
  _cacheTimestamp = Date.now();
  return result;
}

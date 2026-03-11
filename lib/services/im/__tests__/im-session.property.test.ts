/**
 * Property-based tests for im-session.
 *
 * **Feature: im-channel-integration, Property 8: 会话隔离性**
 * **Feature: im-channel-integration, Property 9: 会话历史持久化**
 * **Validates: Requirements 7.1, 7.2, 7.3**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadIMSession, saveIMSession } from '../im-session';
import type { IMPlatform } from '../types';
import type { SecretaryMessage } from '../../secretary-session';

// ---------------------------------------------------------------------------
// Test environment setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let originalSettingsDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-session-prop-'));
  originalSettingsDir = process.env.SETTINGS_DIR;
  process.env.SETTINGS_DIR = tmpDir;
});

afterEach(async () => {
  if (originalSettingsDir === undefined) {
    delete process.env.SETTINGS_DIR;
  } else {
    process.env.SETTINGS_DIR = originalSettingsDir;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const allPlatforms: IMPlatform[] = ['wechat', 'feishu', 'dingtalk', 'qq', 'wecom'];
const platformArb = fc.constantFrom<IMPlatform>(...allPlatforms);

/**
 * Generate a safe sender ID: alphanumeric, 1-20 chars.
 * Avoids filesystem-unsafe characters.
 */
const senderIdArb = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/);

/** Generate a single SecretaryMessage */
const messageArb: fc.Arbitrary<SecretaryMessage> = fc.record({
  role: fc.constantFrom<'user' | 'assistant'>('user', 'assistant'),
  content: fc.string({ minLength: 0, maxLength: 200 }),
  timestamp: fc.integer({ min: 1577836800000, max: 1893456000000 }).map((ms) => new Date(ms).toISOString()),
});

/** Generate a list of messages (0 to 20) */
const messagesArb = fc.array(messageArb, { minLength: 0, maxLength: 20 });

/**
 * Generate two distinct (platform, senderId) pairs.
 * Ensures they differ in at least one component.
 */
const distinctPairArb = fc
  .tuple(platformArb, senderIdArb, platformArb, senderIdArb)
  .filter(
    ([p1, s1, p2, s2]) => p1 !== p2 || s1 !== s2,
  );

// ---------------------------------------------------------------------------
// Property 8: 会话隔离性
// ---------------------------------------------------------------------------

describe('会话隔离性 (Property 8)', () => {
  /**
   * **Feature: im-channel-integration, Property 8: 会话隔离性**
   * **Validates: Requirements 7.1, 7.2**
   *
   * For any two different (platform, senderId) combinations (including the
   * same user on different platforms), loaded sessions should have different
   * session IDs, and messages added to one session should not appear in the
   * other session.
   */
  it('different (platform, senderId) pairs produce isolated sessions with different IDs and no message leakage', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctPairArb,
        messagesArb,
        messagesArb,
        async ([platform1, sender1, platform2, sender2], msgs1, msgs2) => {
          // Load fresh sessions for both pairs
          const session1 = await loadIMSession(platform1, sender1);
          const session2 = await loadIMSession(platform2, sender2);

          // Sessions should have different IDs
          expect(session1.id).not.toBe(session2.id);

          // Add messages to session 1 and save
          session1.messages = msgs1;
          await saveIMSession(session1);

          // Add different messages to session 2 and save
          session2.messages = msgs2;
          await saveIMSession(session2);

          // Reload both sessions
          const reloaded1 = await loadIMSession(platform1, sender1);
          const reloaded2 = await loadIMSession(platform2, sender2);

          // Verify IDs are still different
          expect(reloaded1.id).not.toBe(reloaded2.id);

          // Verify message counts match what was saved
          expect(reloaded1.messages).toHaveLength(msgs1.length);
          expect(reloaded2.messages).toHaveLength(msgs2.length);

          // Verify no message leakage: session1's messages match msgs1
          for (let i = 0; i < msgs1.length; i++) {
            expect(reloaded1.messages[i].role).toBe(msgs1[i].role);
            expect(reloaded1.messages[i].content).toBe(msgs1[i].content);
          }

          // Verify no message leakage: session2's messages match msgs2
          for (let i = 0; i < msgs2.length; i++) {
            expect(reloaded2.messages[i].role).toBe(msgs2[i].role);
            expect(reloaded2.messages[i].content).toBe(msgs2[i].content);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: 会话历史持久化
// ---------------------------------------------------------------------------

describe('会话历史持久化 (Property 9)', () => {
  /**
   * **Feature: im-channel-integration, Property 9: 会话历史持久化**
   * **Validates: Requirements 7.3**
   *
   * For any IM session, after saving N messages and reloading, the loaded
   * session should contain those N messages with the same order and content
   * as when saved (round-trip property).
   */
  it('saving N messages and reloading preserves message count, order, and content', async () => {
    await fc.assert(
      fc.asyncProperty(
        platformArb,
        senderIdArb,
        messagesArb,
        async (platform, senderId, messages) => {
          // Load a fresh session
          const session = await loadIMSession(platform, senderId);

          // Add messages
          session.messages = messages;

          // Save
          await saveIMSession(session);

          // Reload
          const reloaded = await loadIMSession(platform, senderId);

          // Verify same session identity
          expect(reloaded.id).toBe(session.id);
          expect(reloaded.platform).toBe(platform);
          expect(reloaded.senderId).toBe(senderId);

          // Verify message count
          expect(reloaded.messages).toHaveLength(messages.length);

          // Verify message order and content
          for (let i = 0; i < messages.length; i++) {
            expect(reloaded.messages[i].role).toBe(messages[i].role);
            expect(reloaded.messages[i].content).toBe(messages[i].content);
            expect(reloaded.messages[i].timestamp).toBe(messages[i].timestamp);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

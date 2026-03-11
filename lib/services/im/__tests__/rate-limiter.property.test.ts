/**
 * Property-based tests for rate-limiter.
 *
 * **Feature: im-channel-integration, Property 10: 限流正确性**
 * **Validates: Requirements 8.3**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  isRateLimited,
  recordMessage,
  setNowFn,
  resetNowFn,
  clearRecords,
  WINDOW_SIZE_MS,
  MAX_MESSAGES,
} from '../rate-limiter';
import type { IMPlatform } from '../types';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const allPlatforms: IMPlatform[] = ['wechat', 'feishu', 'dingtalk', 'qq', 'wecom'];
const platformArb = fc.constantFrom<IMPlatform>(...allPlatforms);
const senderIdArb = fc.stringMatching(/^[a-zA-Z0-9_]{1,20}$/);

/** Message count in range [0, 20] for testing around the threshold */
const messageCountArb = fc.integer({ min: 0, max: 20 });

// ---------------------------------------------------------------------------
// Property 10: 限流正确性
// ---------------------------------------------------------------------------

describe('限流正确性 (Property 10)', () => {
  let currentTime: number;

  beforeEach(() => {
    clearRecords();
    currentTime = 1_000_000;
    setNowFn(() => currentTime);
  });

  afterEach(() => {
    resetNowFn();
    clearRecords();
  });

  /**
   * **Feature: im-channel-integration, Property 10: 限流正确性**
   * **Validates: Requirements 8.3**
   *
   * For any user identifier, the first 10 messages within a 60-second window
   * should not be rate-limited, and the 11th message onward should be rate-limited.
   */
  it('first MAX_MESSAGES messages are not limited, subsequent ones are limited', () => {
    fc.assert(
      fc.property(platformArb, senderIdArb, messageCountArb, (platform, senderId, count) => {
        clearRecords();
        currentTime = 1_000_000;

        for (let i = 0; i < count; i++) {
          // Check BEFORE recording: first 10 should not be limited
          const limited = isRateLimited(platform, senderId);
          if (i < MAX_MESSAGES) {
            expect(limited).toBe(false);
          } else {
            expect(limited).toBe(true);
          }
          recordMessage(platform, senderId);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('different (platform, senderId) pairs are isolated', () => {
    fc.assert(
      fc.property(
        platformArb,
        senderIdArb,
        platformArb,
        senderIdArb,
        (platform1, sender1, platform2, sender2) => {
          // Skip when both keys are identical
          if (platform1 === platform2 && sender1 === sender2) return;

          clearRecords();
          currentTime = 1_000_000;

          // Exhaust the limit for user 1
          for (let i = 0; i < MAX_MESSAGES; i++) {
            recordMessage(platform1, sender1);
          }
          expect(isRateLimited(platform1, sender1)).toBe(true);

          // User 2 should be unaffected
          expect(isRateLimited(platform2, sender2)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('messages outside the window do not count toward the limit', () => {
    fc.assert(
      fc.property(
        platformArb,
        senderIdArb,
        fc.integer({ min: 1, max: MAX_MESSAGES }),
        (platform, senderId, oldCount) => {
          clearRecords();
          currentTime = 1_000_000;

          // Record some messages in the past
          for (let i = 0; i < oldCount; i++) {
            recordMessage(platform, senderId);
          }

          // Advance time past the window so all old messages expire
          currentTime += WINDOW_SIZE_MS + 1;

          // User should not be limited — old messages are outside the window
          expect(isRateLimited(platform, senderId)).toBe(false);

          // Should be able to send MAX_MESSAGES fresh messages without being limited
          for (let i = 0; i < MAX_MESSAGES; i++) {
            expect(isRateLimited(platform, senderId)).toBe(false);
            recordMessage(platform, senderId);
          }
          // Now the 11th should be limited
          expect(isRateLimited(platform, senderId)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('sliding window: partial expiry frees up capacity', () => {
    fc.assert(
      fc.property(
        platformArb,
        senderIdArb,
        fc.integer({ min: 1, max: MAX_MESSAGES }),
        (platform, senderId, firstBatch) => {
          clearRecords();
          const baseTime = 1_000_000;
          currentTime = baseTime;

          const secondBatch = MAX_MESSAGES - firstBatch;

          // Send firstBatch messages at t=0
          for (let i = 0; i < firstBatch; i++) {
            recordMessage(platform, senderId);
          }

          // Advance 30s, send remaining to fill the limit
          currentTime = baseTime + 30_000;
          for (let i = 0; i < secondBatch; i++) {
            recordMessage(platform, senderId);
          }

          // Now at the limit
          expect(isRateLimited(platform, senderId)).toBe(true);

          // Advance just past 60s from start — firstBatch messages expire
          currentTime = baseTime + WINDOW_SIZE_MS + 1;

          // Should have freed firstBatch slots
          expect(isRateLimited(platform, senderId)).toBe(false);

          // Can send firstBatch more messages
          for (let i = 0; i < firstBatch; i++) {
            expect(isRateLimited(platform, senderId)).toBe(false);
            recordMessage(platform, senderId);
          }

          // Now at the limit again
          expect(isRateLimited(platform, senderId)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

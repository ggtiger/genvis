import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isRateLimited,
  recordMessage,
  setNowFn,
  resetNowFn,
  clearRecords,
  WINDOW_SIZE_MS,
  MAX_MESSAGES,
} from '../rate-limiter';

describe('rate-limiter', () => {
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

  it('should export correct constants', () => {
    expect(WINDOW_SIZE_MS).toBe(60_000);
    expect(MAX_MESSAGES).toBe(10);
  });

  it('should not rate limit a new user', () => {
    expect(isRateLimited('wechat', 'user1')).toBe(false);
  });

  it('should not rate limit after fewer than 10 messages', () => {
    for (let i = 0; i < 9; i++) {
      recordMessage('feishu', 'user1');
    }
    expect(isRateLimited('feishu', 'user1')).toBe(false);
  });

  it('should rate limit after exactly 10 messages', () => {
    for (let i = 0; i < 10; i++) {
      recordMessage('dingtalk', 'user1');
    }
    expect(isRateLimited('dingtalk', 'user1')).toBe(true);
  });

  it('should isolate users on the same platform', () => {
    for (let i = 0; i < 10; i++) {
      recordMessage('qq', 'userA');
    }
    expect(isRateLimited('qq', 'userA')).toBe(true);
    expect(isRateLimited('qq', 'userB')).toBe(false);
  });

  it('should isolate the same user across different platforms', () => {
    for (let i = 0; i < 10; i++) {
      recordMessage('wechat', 'user1');
    }
    expect(isRateLimited('wechat', 'user1')).toBe(true);
    expect(isRateLimited('wecom', 'user1')).toBe(false);
  });

  it('should allow messages again after the window expires', () => {
    for (let i = 0; i < 10; i++) {
      recordMessage('feishu', 'user1');
    }
    expect(isRateLimited('feishu', 'user1')).toBe(true);

    // Advance time past the window
    currentTime += WINDOW_SIZE_MS + 1;
    expect(isRateLimited('feishu', 'user1')).toBe(false);
  });

  it('should use sliding window — partial expiry', () => {
    // Send 5 messages at t=0
    for (let i = 0; i < 5; i++) {
      recordMessage('dingtalk', 'user1');
    }

    // Advance 30s, send 5 more
    currentTime += 30_000;
    for (let i = 0; i < 5; i++) {
      recordMessage('dingtalk', 'user1');
    }
    expect(isRateLimited('dingtalk', 'user1')).toBe(true);

    // Advance to 61s from start — first 5 expire, only 5 remain
    currentTime = 1_000_000 + 60_001;
    expect(isRateLimited('dingtalk', 'user1')).toBe(false);
  });

  it('should clean up expired entries on recordMessage', () => {
    for (let i = 0; i < 10; i++) {
      recordMessage('wechat', 'user1');
    }
    expect(isRateLimited('wechat', 'user1')).toBe(true);

    // Advance past window, record a new message
    currentTime += WINDOW_SIZE_MS + 1;
    recordMessage('wechat', 'user1');

    // Should not be limited — only 1 message in the new window
    expect(isRateLimited('wechat', 'user1')).toBe(false);
  });
});

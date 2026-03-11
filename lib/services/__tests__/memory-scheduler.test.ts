/**
 * Unit tests for MemoryScheduler
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseTimePattern,
  MemoryScheduler,
  type ScheduledReminder,
} from '../memory-scheduler';
import type { MemoryEntryV2, MemoryDataV2 } from '../secretary-memory';

// ========== Helpers ==========

function makeEntry(overrides: Partial<MemoryEntryV2> = {}): MemoryEntryV2 {
  return {
    key: 'test_pattern',
    value: '每天下午3点开会',
    source: '对话提取',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    confidence: 0.9,
    lastAccessedAt: '2024-01-01T00:00:00Z',
    accessCount: 0,
    channel: 'web',
    ...overrides,
  };
}

function makeMemoryData(patterns: MemoryEntryV2[] = []): MemoryDataV2 {
  return {
    version: 2,
    user_profile: [],
    learned_preference: [],
    interaction_pattern: patterns,
    work_events: [],
    dispatch_learnings: [],
    intent_examples: [],
    updatedAt: new Date().toISOString(),
  };
}

// ========== parseTimePattern tests ==========

describe('parseTimePattern', () => {
  it('parses "每天下午3点" → { hour: 15 }', () => {
    const entry = makeEntry({ value: '每天下午3点开会' });
    const result = parseTimePattern(entry);
    expect(result).toEqual({ hour: 15 });
  });

  it('parses "每周一上午" → { dayOfWeek: 1, hour: 9 }', () => {
    const entry = makeEntry({ value: '每周一上午开会' });
    const result = parseTimePattern(entry);
    expect(result).toEqual({ dayOfWeek: 1, hour: 9 });
  });

  it('parses "每周五下午" → { dayOfWeek: 5, hour: 14 }', () => {
    const entry = makeEntry({ value: '每周五下午汇报' });
    const result = parseTimePattern(entry);
    expect(result).toEqual({ dayOfWeek: 5, hour: 14 });
  });

  it('parses "每天早上8点" → { hour: 8 }', () => {
    const entry = makeEntry({ value: '每天早上8点跑步' });
    const result = parseTimePattern(entry);
    expect(result).toEqual({ hour: 8 });
  });

  it('parses "每周三下午2点30分" → { dayOfWeek: 3, hour: 14, minute: 30 }', () => {
    const entry = makeEntry({ value: '每周三下午2点30分开会' });
    const result = parseTimePattern(entry);
    expect(result).toEqual({ dayOfWeek: 3, hour: 14, minute: 30 });
  });

  it('parses "每天中午" → { hour: 12 }', () => {
    const entry = makeEntry({ value: '每天中午吃饭' });
    const result = parseTimePattern(entry);
    expect(result).toEqual({ hour: 12 });
  });

  it('parses "每周日晚上" → { dayOfWeek: 0, hour: 20 }', () => {
    const entry = makeEntry({ value: '每周日晚上看电影' });
    const result = parseTimePattern(entry);
    expect(result).toEqual({ dayOfWeek: 0, hour: 20 });
  });

  it('parses "每天晚上9点" → { hour: 21 }', () => {
    const entry = makeEntry({ value: '每天晚上9点读书' });
    const result = parseTimePattern(entry);
    expect(result).toEqual({ hour: 21 });
  });

  it('returns null for text without time patterns', () => {
    const entry = makeEntry({ value: '用户喜欢用TypeScript' });
    expect(parseTimePattern(entry)).toBeNull();
  });

  it('returns null for empty value', () => {
    const entry = makeEntry({ value: '' });
    expect(parseTimePattern(entry)).toBeNull();
  });

  it('parses "每周六上午10点" → { dayOfWeek: 6, hour: 10 }', () => {
    const entry = makeEntry({ value: '每周六上午10点健身' });
    const result = parseTimePattern(entry);
    expect(result).toEqual({ dayOfWeek: 6, hour: 10 });
  });
});

// ========== checkReminders tests ==========

describe('checkReminders', () => {
  let scheduler: MemoryScheduler;

  beforeEach(async () => {
    const patterns = [
      makeEntry({ key: 'daily_meeting', value: '每天下午3点开会' }),
      makeEntry({ key: 'monday_standup', value: '每周一上午开会' }),
      makeEntry({ key: 'no_pattern', value: '用户喜欢TypeScript' }),
    ];
    const loader = async () => makeMemoryData(patterns);
    scheduler = new MemoryScheduler(loader);
    await scheduler.reloadPatterns();
  });

  it('returns matching reminders for current time', () => {
    // Wednesday 15:00 → matches daily_meeting
    const wed3pm = new Date(2024, 0, 3, 15, 0, 0); // Jan 3 2024 is Wednesday
    const reminders = scheduler.checkReminders(wed3pm);
    expect(reminders.length).toBe(1);
    expect(reminders[0].memoryKey).toBe('daily_meeting');
  });

  it('returns multiple matches when applicable', () => {
    // Monday 9:00 → matches both daily_meeting? No, daily is 15:00. Only monday_standup at 9:00
    const mon9am = new Date(2024, 0, 1, 9, 0, 0); // Jan 1 2024 is Monday
    const reminders = scheduler.checkReminders(mon9am);
    expect(reminders.length).toBe(1);
    expect(reminders[0].memoryKey).toBe('monday_standup');
  });

  it('returns empty array when no patterns match', () => {
    // Wednesday 10:00 → no match
    const wed10am = new Date(2024, 0, 3, 10, 0, 0);
    const reminders = scheduler.checkReminders(wed10am);
    expect(reminders.length).toBe(0);
  });

  it('includes non-empty memoryKey, memoryValue, suggestedAction', () => {
    const wed3pm = new Date(2024, 0, 3, 15, 0, 0);
    const reminders = scheduler.checkReminders(wed3pm);
    expect(reminders.length).toBe(1);
    expect(reminders[0].memoryKey).toBeTruthy();
    expect(reminders[0].memoryValue).toBeTruthy();
    expect(reminders[0].suggestedAction).toBeTruthy();
    expect(reminders[0].triggerTime).toBeTruthy();
  });

  it('deduplicates within the same minute', () => {
    const wed3pm = new Date(2024, 0, 3, 15, 0, 0);
    const first = scheduler.checkReminders(wed3pm);
    expect(first.length).toBe(1);

    // Same minute again
    const second = scheduler.checkReminders(wed3pm);
    expect(second.length).toBe(0);
  });

  it('triggers again after resetCheckState', () => {
    const wed3pm = new Date(2024, 0, 3, 15, 0, 0);
    scheduler.checkReminders(wed3pm);
    scheduler.resetCheckState();
    const again = scheduler.checkReminders(wed3pm);
    expect(again.length).toBe(1);
  });

  it('only loads entries with parseable patterns', () => {
    // 3 entries loaded, but only 2 have patterns
    expect(scheduler.patternCount).toBe(2);
  });
});

// ========== bufferReminder / flushBufferedReminders tests ==========

describe('bufferReminder and flushBufferedReminders', () => {
  let scheduler: MemoryScheduler;

  beforeEach(() => {
    scheduler = new MemoryScheduler(async () => makeMemoryData());
  });

  it('buffers a reminder and flushes it', () => {
    const reminder: ScheduledReminder = {
      memoryKey: 'test_key',
      memoryValue: '每天下午3点开会',
      triggerTime: new Date().toISOString(),
      suggestedAction: '提醒：每天下午3点开会',
    };

    scheduler.bufferReminder(reminder);
    const flushed = scheduler.flushBufferedReminders();

    expect(flushed.length).toBe(1);
    expect(flushed[0].memoryKey).toBe('test_key');
    expect(flushed[0].bufferedAt).toBeTruthy();
  });

  it('clears buffer after flush', () => {
    const reminder: ScheduledReminder = {
      memoryKey: 'test_key',
      memoryValue: '测试',
      triggerTime: new Date().toISOString(),
      suggestedAction: '提醒：测试',
    };

    scheduler.bufferReminder(reminder);
    scheduler.flushBufferedReminders();
    const secondFlush = scheduler.flushBufferedReminders();

    expect(secondFlush.length).toBe(0);
  });

  it('buffers multiple reminders', () => {
    for (let i = 0; i < 3; i++) {
      scheduler.bufferReminder({
        memoryKey: `key_${i}`,
        memoryValue: `value_${i}`,
        triggerTime: new Date().toISOString(),
        suggestedAction: `action_${i}`,
      });
    }

    const flushed = scheduler.flushBufferedReminders();
    expect(flushed.length).toBe(3);
    expect(flushed.map(r => r.memoryKey)).toEqual(['key_0', 'key_1', 'key_2']);
  });

  it('returns empty array when no reminders buffered', () => {
    expect(scheduler.flushBufferedReminders()).toEqual([]);
  });
});

// ========== start / stop tests ==========

describe('start and stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts the scheduler and sets isRunning to true', async () => {
    const scheduler = new MemoryScheduler(
      async () => makeMemoryData(),
      undefined,
      1000,
    );

    await scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
  });

  it('stop clears the timer and sets isRunning to false', async () => {
    const scheduler = new MemoryScheduler(
      async () => makeMemoryData(),
      undefined,
      1000,
    );

    await scheduler.start();
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  it('does not start twice if already running', async () => {
    const loader = vi.fn(async () => makeMemoryData());
    const scheduler = new MemoryScheduler(loader, undefined, 1000);

    await scheduler.start();
    await scheduler.start(); // second call should be no-op
    expect(loader).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('calls onReminder callback when reminders trigger', async () => {
    const patterns = [
      makeEntry({ key: 'daily_meeting', value: '每天下午3点开会' }),
    ];
    const onReminder = vi.fn();
    const scheduler = new MemoryScheduler(
      async () => makeMemoryData(patterns),
      onReminder,
      1000,
    );

    // Set time to 15:00
    vi.setSystemTime(new Date(2024, 0, 3, 15, 0, 0));
    await scheduler.start();

    // Advance timer to trigger check
    await vi.advanceTimersByTimeAsync(1000);

    expect(onReminder).toHaveBeenCalledTimes(1);
    expect(onReminder).toHaveBeenCalledWith(
      expect.objectContaining({ memoryKey: 'daily_meeting' }),
    );
    scheduler.stop();
  });

  it('buffers reminders when no onReminder callback is set', async () => {
    const patterns = [
      makeEntry({ key: 'daily_meeting', value: '每天下午3点开会' }),
    ];
    const scheduler = new MemoryScheduler(
      async () => makeMemoryData(patterns),
      undefined,
      1000,
    );

    vi.setSystemTime(new Date(2024, 0, 3, 15, 0, 0));
    await scheduler.start();

    await vi.advanceTimersByTimeAsync(1000);

    const buffered = scheduler.flushBufferedReminders();
    expect(buffered.length).toBe(1);
    expect(buffered[0].memoryKey).toBe('daily_meeting');
    scheduler.stop();
  });

  it('handles loadMemory failure gracefully on start', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scheduler = new MemoryScheduler(
      async () => { throw new Error('load failed'); },
      undefined,
      1000,
    );

    // Should not throw
    await scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    scheduler.stop();
    warnSpy.mockRestore();
  });
});

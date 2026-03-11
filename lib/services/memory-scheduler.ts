/**
 * Memory Scheduler - 主动提醒服务
 *
 * 定期扫描 interaction_pattern 类型的记忆，检测具有时间规律的条目，
 * 在触发时间到达时通过回调推送主动提醒。
 *
 * 支持的中文时间模式：
 * - "每天下午3点" → { hour: 15 }
 * - "每周一上午" → { dayOfWeek: 1, hour: 9 }
 * - "每周五下午" → { dayOfWeek: 5, hour: 14 }
 * - "每天早上8点" → { hour: 8 }
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */

import type { MemoryEntryV2, MemoryDataV2 } from './secretary-memory';

// ========== Interfaces ==========

export interface CronLikePattern {
  dayOfWeek?: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  hour?: number;      // 0-23
  minute?: number;    // 0-59
}

export interface ScheduledReminder {
  memoryKey: string;
  memoryValue: string;
  triggerTime: string;
  suggestedAction: string;
}

export interface PendingReminder extends ScheduledReminder {
  bufferedAt: string;
}

interface ParsedEntry {
  entry: MemoryEntryV2;
  pattern: CronLikePattern;
}

export type MemoryLoader = () => Promise<MemoryDataV2>;
export type ReminderCallback = (reminder: ScheduledReminder) => void;

// ========== Chinese time pattern maps ==========

const DAY_OF_WEEK_MAP: Record<string, number> = {
  '日': 0, '天': 0,
  '一': 1,
  '二': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
};

const TIME_PERIOD_MAP: Record<string, number> = {
  '早上': 8,
  '上午': 9,
  '中午': 12,
  '下午': 14,
  '傍晚': 17,
  '晚上': 20,
};

// ========== parseTimePattern ==========

/**
 * 解析记忆条目中的中文时间规律。
 *
 * Supported patterns:
 * - 每天 + 时间段/具体时间: "每天下午3点", "每天早上"
 * - 每周X + 时间段/具体时间: "每周一上午", "每周五下午3点"
 * - 时间段 + 具体时间: "下午3点", "上午10点"
 *
 * Returns null if no recognizable time pattern is found.
 */
export function parseTimePattern(entry: MemoryEntryV2): CronLikePattern | null {
  const text = entry.value;
  if (!text) return null;

  const result: CronLikePattern = {};
  let matched = false;

  // Match 每周X pattern
  const weekdayMatch = text.match(/每周([一二三四五六日天])/);
  if (weekdayMatch) {
    const day = DAY_OF_WEEK_MAP[weekdayMatch[1]];
    if (day !== undefined) {
      result.dayOfWeek = day;
      matched = true;
    }
  }

  // Match time period (上午/下午/早上/晚上 etc.)
  const periodMatch = text.match(/(早上|上午|中午|下午|傍晚|晚上)/);
  const periodHour = periodMatch ? TIME_PERIOD_MAP[periodMatch[1]] : undefined;

  // Match specific hour: X点 or X:XX
  const hourMatch = text.match(/(\d{1,2})\s*[点:：]/);
  if (hourMatch) {
    let hour = parseInt(hourMatch[1], 10);
    // Adjust for 下午/晚上 if hour <= 12
    if (periodMatch && hour <= 12) {
      const period = periodMatch[1];
      if (period === '下午' || period === '傍晚' || period === '晚上') {
        if (hour < 12) hour += 12;
      }
    }
    if (hour >= 0 && hour <= 23) {
      result.hour = hour;
      matched = true;
    }
  } else if (periodHour !== undefined) {
    // No specific hour, use period default
    result.hour = periodHour;
    matched = true;
  }

  // Match specific minute: X点X分 or X:XX
  const minuteMatch = text.match(/[点:：]\s*(\d{1,2})\s*分?/);
  if (minuteMatch) {
    const minute = parseInt(minuteMatch[1], 10);
    if (minute >= 0 && minute <= 59) {
      result.minute = minute;
    }
  }

  // 每天 pattern (no specific weekday)
  if (text.includes('每天') && !weekdayMatch) {
    matched = true;
    // dayOfWeek stays undefined → matches every day
  }

  return matched ? result : null;
}

// ========== MemoryScheduler class ==========

const DEFAULT_CHECK_INTERVAL = 60_000; // 1 minute

export class MemoryScheduler {
  private loadMemory: MemoryLoader;
  private onReminder?: ReminderCallback;
  private checkInterval: number;

  private parsedEntries: ParsedEntry[] = [];
  private pendingReminders: PendingReminder[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCheckMinute = -1;

  constructor(
    loadMemory: MemoryLoader,
    onReminder?: ReminderCallback,
    checkInterval: number = DEFAULT_CHECK_INTERVAL,
  ) {
    this.loadMemory = loadMemory;
    this.onReminder = onReminder;
    this.checkInterval = checkInterval;
  }

  /**
   * Start the scheduler: load interaction_pattern entries, parse time patterns,
   * and begin periodic checking via setInterval.
   */
  async start(): Promise<void> {
    if (this.timer) return; // already running

    try {
      await this.loadPatterns();
    } catch (err) {
      console.warn('[MemoryScheduler] 启动时加载记忆失败，将延迟重试:', err);
    }

    this.timer = setInterval(async () => {
      try {
        const reminders = this.checkReminders();
        for (const reminder of reminders) {
          if (this.onReminder) {
            this.onReminder(reminder);
          } else {
            this.bufferReminder(reminder);
          }
        }
      } catch (err) {
        console.warn('[MemoryScheduler] checkReminders 异常:', err);
      }
    }, this.checkInterval);
  }

  /**
   * Stop the scheduler and clear the interval timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastCheckMinute = -1;
  }

  /**
   * Load interaction_pattern entries from memory and parse their time patterns.
   */
  private async loadPatterns(): Promise<void> {
    const memory = await this.loadMemory();
    const patterns = memory.interaction_pattern || [];
    this.parsedEntries = [];

    for (const entry of patterns) {
      const pattern = parseTimePattern(entry);
      if (pattern) {
        this.parsedEntries.push({ entry, pattern });
      }
    }
  }

  /**
   * Check current time against all parsed patterns.
   * Returns reminders for entries whose pattern matches the current time.
   *
   * Deduplicates by only triggering once per minute (avoids repeated triggers
   * within the same check interval).
   */
  checkReminders(now?: Date): ScheduledReminder[] {
    const currentTime = now || new Date();
    const currentMinute = currentTime.getHours() * 60 + currentTime.getMinutes();

    // Avoid duplicate triggers within the same minute
    if (currentMinute === this.lastCheckMinute) {
      return [];
    }
    this.lastCheckMinute = currentMinute;

    const reminders: ScheduledReminder[] = [];

    for (const { entry, pattern } of this.parsedEntries) {
      if (this.matchesPattern(currentTime, pattern)) {
        reminders.push({
          memoryKey: entry.key,
          memoryValue: entry.value,
          triggerTime: currentTime.toISOString(),
          suggestedAction: this.generateSuggestedAction(entry),
        });
      }
    }

    return reminders;
  }

  /**
   * Check if a given time matches a cron-like pattern.
   */
  private matchesPattern(time: Date, pattern: CronLikePattern): boolean {
    // Check day of week
    if (pattern.dayOfWeek !== undefined && time.getDay() !== pattern.dayOfWeek) {
      return false;
    }

    // Check hour
    if (pattern.hour !== undefined && time.getHours() !== pattern.hour) {
      return false;
    }

    // Check minute (default to 0 if pattern has hour but no minute)
    const targetMinute = pattern.minute ?? 0;
    if (pattern.hour !== undefined && time.getMinutes() !== targetMinute) {
      return false;
    }

    return true;
  }

  /**
   * Generate a suggested action string from a memory entry.
   */
  private generateSuggestedAction(entry: MemoryEntryV2): string {
    return `提醒：${entry.value}`;
  }

  /**
   * Buffer a reminder when no active SSE connection is available.
   */
  bufferReminder(reminder: ScheduledReminder): void {
    this.pendingReminders.push({
      ...reminder,
      bufferedAt: new Date().toISOString(),
    });
  }

  /**
   * Flush and return all buffered reminders, clearing the buffer.
   */
  flushBufferedReminders(): PendingReminder[] {
    const flushed = [...this.pendingReminders];
    this.pendingReminders = [];
    return flushed;
  }

  /**
   * Get the current parsed entries count (for testing/debugging).
   */
  get patternCount(): number {
    return this.parsedEntries.length;
  }

  /**
   * Get whether the scheduler is currently running.
   */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Reload patterns from memory (can be called to refresh after memory changes).
   */
  async reloadPatterns(): Promise<void> {
    await this.loadPatterns();
  }

  /**
   * Reset the last check minute tracker (useful for testing).
   */
  resetCheckState(): void {
    this.lastCheckMinute = -1;
  }
}

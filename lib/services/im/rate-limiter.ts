import type { IMPlatform } from './types';

/** 滑动窗口大小（毫秒） */
export const WINDOW_SIZE_MS = 60_000;

/** 窗口内允许的最大消息数 */
export const MAX_MESSAGES = 10;

/** 时间戳记录表：key = `${platform}:${senderId}`，value = 消息时间戳数组 */
const records = new Map<string, number[]>();

/** 可注入的时间源，默认 Date.now */
let nowFn: () => number = Date.now;

/** 设置自定义时间源（用于测试） */
export function setNowFn(fn: () => number): void {
  nowFn = fn;
}

/** 重置为默认时间源 */
export function resetNowFn(): void {
  nowFn = Date.now;
}

/** 清除所有限流记录（用于测试） */
export function clearRecords(): void {
  records.clear();
}

function makeKey(platform: IMPlatform, senderId: string): string {
  return `${platform}:${senderId}`;
}

/** 清理窗口外的过期时间戳 */
function pruneExpired(timestamps: number[], now: number): number[] {
  const cutoff = now - WINDOW_SIZE_MS;
  // 找到第一个在窗口内的索引
  let i = 0;
  while (i < timestamps.length && timestamps[i] <= cutoff) {
    i++;
  }
  return i > 0 ? timestamps.slice(i) : timestamps;
}

/**
 * 检查用户是否被限流
 * 在 60 秒滑动窗口内，消息数 >= MAX_MESSAGES 时返回 true
 */
export function isRateLimited(platform: IMPlatform, senderId: string): boolean {
  const key = makeKey(platform, senderId);
  const timestamps = records.get(key);
  if (!timestamps) return false;

  const now = nowFn();
  const valid = pruneExpired(timestamps, now);
  // 更新记录（清理过期条目）
  if (valid.length !== timestamps.length) {
    if (valid.length === 0) {
      records.delete(key);
    } else {
      records.set(key, valid);
    }
  }
  return valid.length >= MAX_MESSAGES;
}

/**
 * 记录一条消息
 * 同时清理窗口外的过期时间戳
 */
export function recordMessage(platform: IMPlatform, senderId: string): void {
  const key = makeKey(platform, senderId);
  const now = nowFn();
  let timestamps = records.get(key);

  if (timestamps) {
    timestamps = pruneExpired(timestamps, now);
    timestamps.push(now);
  } else {
    timestamps = [now];
  }

  records.set(key, timestamps);
}

/**
 * Conversation Context Service
 *
 * 管理每个 IM 用户的会话上下文：当前会话目标（秘书或项目）和待切换队列。
 * 用于实现交互式反馈时的消息路由决策。
 *
 * 存储路径：data/im-contexts/{platform}/{senderId}.json
 *
 * Requirements: 2.3, 3.1, 3.4, 7.2
 */

import fs from 'fs/promises';
import path from 'path';

// ========== Interfaces ==========

export interface ConversationTarget {
  type: 'secretary' | 'project';
  projectId?: string;
  employeeName?: string;
}

export interface PendingFeedback {
  projectId: string;
  employeeName: string;
  questionContent: string;
  enqueuedAt: number;
  imSenderId: string;
  imPlatform: string;
  imRawPayload?: unknown;
}

export interface ConversationContextData {
  currentTarget: ConversationTarget;
  pendingQueue: PendingFeedback[];
  updatedAt: string;
}

// ========== Internal Helpers ==========

function getDataDir(): string {
  return process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
}

function getContextFilePath(platform: string, senderId: string): string {
  return path.join(getDataDir(), 'im-contexts', platform, `${senderId}.json`);
}

function createDefaultContext(): ConversationContextData {
  return {
    currentTarget: { type: 'secretary' },
    pendingQueue: [],
    updatedAt: new Date().toISOString(),
  };
}

function isValidContext(obj: unknown): obj is ConversationContextData {
  if (!obj || typeof obj !== 'object') return false;
  const c = obj as Record<string, unknown>;
  if (!c.currentTarget || typeof c.currentTarget !== 'object') return false;
  const target = c.currentTarget as Record<string, unknown>;
  if (target.type !== 'secretary' && target.type !== 'project') return false;
  if (!Array.isArray(c.pendingQueue)) return false;
  return true;
}

// ========== Public API ==========

/**
 * 获取 IM 用户的当前会话上下文。
 * 如果不存在，返回默认的秘书目标。
 */
export async function getConversationContext(
  platform: string,
  senderId: string
): Promise<ConversationContextData> {
  const filePath = getContextFilePath(platform, senderId);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (isValidContext(parsed)) return parsed;
    return createDefaultContext();
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createDefaultContext();
    }
    console.warn('[ConversationContext] Failed to load context:', error);
    return createDefaultContext();
  }
}

async function saveContext(platform: string, senderId: string, ctx: ConversationContextData): Promise<void> {
  const filePath = getContextFilePath(platform, senderId);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  ctx.updatedAt = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(ctx, null, 2), 'utf-8');
}

/**
 * 将 IM 用户的会话目标切换到指定项目。
 */
export async function switchToProject(
  platform: string,
  senderId: string,
  projectId: string,
  employeeName: string
): Promise<void> {
  const ctx = await getConversationContext(platform, senderId);
  ctx.currentTarget = { type: 'project', projectId, employeeName };
  await saveContext(platform, senderId, ctx);
}

/**
 * 将 IM 用户的会话目标重置为秘书。
 */
export async function switchToSecretary(
  platform: string,
  senderId: string
): Promise<void> {
  const ctx = await getConversationContext(platform, senderId);
  ctx.currentTarget = { type: 'secretary' };
  await saveContext(platform, senderId, ctx);
}

/**
 * 将反馈请求加入待切换队列末尾。
 */
export async function enqueuePendingFeedback(
  platform: string,
  senderId: string,
  feedback: PendingFeedback
): Promise<void> {
  const ctx = await getConversationContext(platform, senderId);
  ctx.pendingQueue.push(feedback);
  await saveContext(platform, senderId, ctx);
}

/**
 * 从待切换队列头部取出下一个反馈请求。
 * 如果队列为空返回 null。
 */
export async function dequeuePendingFeedback(
  platform: string,
  senderId: string
): Promise<PendingFeedback | null> {
  const ctx = await getConversationContext(platform, senderId);
  if (ctx.pendingQueue.length === 0) return null;
  const next = ctx.pendingQueue.shift()!;
  await saveContext(platform, senderId, ctx);
  return next;
}

/**
 * 清理队列中超时的反馈请求（超过 timeoutMs 毫秒）。
 * 返回被清理的请求列表。
 */
export async function cleanupExpiredFeedbacks(
  platform: string,
  senderId: string,
  timeoutMs: number
): Promise<PendingFeedback[]> {
  const ctx = await getConversationContext(platform, senderId);
  const now = Date.now();
  const expired: PendingFeedback[] = [];
  ctx.pendingQueue = ctx.pendingQueue.filter(f => {
    if (now - f.enqueuedAt > timeoutMs) {
      expired.push(f);
      return false;
    }
    return true;
  });
  if (expired.length > 0) {
    await saveContext(platform, senderId, ctx);
  }
  return expired;
}

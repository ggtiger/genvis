/**
 * Secretary Scheduled Message Service
 *
 * Runs on the server side, periodically checks scheduled messages
 * and sends them to the secretary chat when due.
 * Integrates with the secretary SSE stream for real-time notifications.
 */

import {
  loadScheduledMessages,
  saveScheduledMessages,
  type SecretaryScheduledMessage,
} from './secretary-session';
import { createSecretaryMessage } from './secretary/secretary-message-service';
import { secretaryStream } from './secretary-stream';

const CHECK_INTERVAL_MS = 30_000; // 30 seconds

// Persist timer to globalThis to survive Next.js HMR
const GLOBAL_TIMER_KEY = '__secretary_scheduler_timer__';
const GLOBAL_EXECUTING_KEY = '__secretary_scheduler_executing__';

function getTimer(): ReturnType<typeof setInterval> | null {
  return (globalThis as any)[GLOBAL_TIMER_KEY] || null;
}

function setTimer(timer: ReturnType<typeof setInterval> | null): void {
  (globalThis as any)[GLOBAL_TIMER_KEY] = timer;
}

// Track messages currently executing to prevent duplicate runs
function getExecutingSet(): Set<string> {
  if (!(globalThis as any)[GLOBAL_EXECUTING_KEY]) {
    (globalThis as any)[GLOBAL_EXECUTING_KEY] = new Set<string>();
  }
  return (globalThis as any)[GLOBAL_EXECUTING_KEY];
}

function markExecuting(messageId: string): boolean {
  const set = getExecutingSet();
  if (set.has(messageId)) return false; // Already executing
  set.add(messageId);
  return true;
}

function unmarkExecuting(messageId: string): void {
  getExecutingSet().delete(messageId);
}

// ========== Public API ==========

export function startSecretaryScheduler(): void {
  if (getTimer()) {
    console.log('[SecretaryScheduler] Already running, skip');
    return;
  }

  const timer = setInterval(() => {
    tickScheduler().catch((err) => {
      console.error('[SecretaryScheduler] Tick error:', err);
    });
  }, CHECK_INTERVAL_MS);

  setTimer(timer);

  // Run immediately on start
  tickScheduler().catch((err) => {
    console.error('[SecretaryScheduler] Initial tick error:', err);
  });
  console.log('[SecretaryScheduler] Scheduler started');
}

export function stopSecretaryScheduler(): void {
  const timer = getTimer();
  if (timer) {
    clearInterval(timer);
    setTimer(null);
    console.log('[SecretaryScheduler] Scheduler stopped');
  }
}

export function isSecretarySchedulerRunning(): boolean {
  return getTimer() !== null;
}

/**
 * Trigger a single scheduled message manually.
 * Returns true if the message was found and sent.
 */
export async function triggerOneSecretaryMessage(messageId: string): Promise<boolean> {
  // Check if already executing
  if (!markExecuting(messageId)) {
    console.log(`[SecretaryScheduler] triggerOne: ${messageId} already executing, skip`);
    return false;
  }

  try {
    const messages = await loadScheduledMessages();
    const sm = messages.find((m) => m.id === messageId);
    if (!sm || !sm.content.trim()) {
      console.log(`[SecretaryScheduler] triggerOne: message ${messageId} not found or empty`);
      return false;
    }

    // Mark as executing immediately to prevent tickScheduler from re-executing
    const now = Date.now();
    sm.lastSentAt = now;
    await saveScheduledMessages(messages);

    await sendScheduledMessage(sm);
    console.log(`[SecretaryScheduler] Manual trigger OK: ${messageId}`);
    return true;
  } finally {
    unmarkExecuting(messageId);
  }
}

// ========== Internal ==========

async function tickScheduler(): Promise<void> {
  const messages = await loadScheduledMessages();
  if (messages.length === 0) return;

  const now = Date.now();
  let dirty = false;

  for (const sm of messages) {
    if (!sm.enabled || !sm.content.trim()) continue;

    // Skip if already executing (triggered manually)
    if (getExecutingSet().has(sm.id)) continue;

    if (isDue(sm, now)) {
      // Mark as executing before sending
      if (!markExecuting(sm.id)) continue;

      try {
        await sendScheduledMessage(sm);
        sm.lastSentAt = now;
        dirty = true;
      } finally {
        unmarkExecuting(sm.id);
      }
    }
  }

  if (dirty) {
    await saveScheduledMessages(messages);
  }
}

/**
 * Determine whether a scheduled message is due to send.
 * Supports two modes: 'interval' (every N minutes) and 'daily' (at specific HH:MM each day).
 */
function isDue(sm: SecretaryScheduledMessage, now: number): boolean {
  const lastSent = sm.lastSentAt || 0;

  if (sm.scheduleType === 'daily' && sm.scheduledTime) {
    const [h, m] = sm.scheduledTime.split(':').map(Number);
    const todayTarget = new Date();
    todayTarget.setHours(h, m, 0, 0);
    const targetMs = todayTarget.getTime();
    return now >= targetMs && lastSent < targetMs;
  }

  // Interval mode (default)
  const intervalMs = sm.intervalMinutes * 60_000;
  return now - lastSent >= intervalMs;
}

/**
 * Send a scheduled message to the secretary chat.
 * If aiReply is true, uses the new Claude Agent SDK via executeSecretaryClaude().
 * If sendToIM is true, sends the result to the configured IM channel.
 */
async function sendScheduledMessage(sm: SecretaryScheduledMessage): Promise<void> {
  const { secretaryStream } = await import('./secretary-stream');
  let aiReplyContent: string | null = null;

  if (sm.aiReply) {
    // Use the new Claude Agent SDK for AI processing
    try {
      const { executeSecretaryClaude } = await import('./secretary/secretary-claude');
      const { createSecretaryMessage } = await import('./secretary/secretary-message-service');
      const { randomUUID } = await import('crypto');

      const requestId = randomUUID();
      const messageContent = `[定时任务] ${sm.content}`;

      // Create and persist user message
      const userMessage = await createSecretaryMessage({
        role: 'user',
        messageType: 'text',
        content: messageContent,
        senderId: 'scheduled-task',
        senderName: '定时任务',
        interactionMode: 'ai_chat',
        requestId,
      });

      // Publish new message event
      secretaryStream.publish({
        type: 'new_message',
        data: { message: userMessage },
      });

      // Notify frontend that AI streaming is starting
      secretaryStream.publish({
        type: 'ai_stream_start',
        data: { requestId, timestamp: new Date().toISOString() },
      });

      // Execute Claude Agent SDK
      const result = await executeSecretaryClaude({
        message: messageContent,
        enabledSkills: [],
        requestId,
      });

      // If we have a reply, persist to database
      if (result.reply && result.reply.trim()) {
        aiReplyContent = result.reply.trim();
        const aiMessage = await createSecretaryMessage({
          role: 'assistant',
          messageType: 'text',
          content: aiReplyContent,
          senderId: 'secretary-ai',
          senderName: '秘书',
          interactionMode: 'ai_chat',
          requestId,
          metadata: result.conversationStats ? { conversationStats: result.conversationStats } : undefined,
        });

        // Publish the final AI message
        secretaryStream.publish({
          type: 'new_message',
          data: { message: aiMessage },
        });
      }

      // Always send ai_stream_end
      secretaryStream.publish({
        type: 'ai_stream_end',
        data: { requestId, timestamp: new Date().toISOString() },
      });

      console.log(`[SecretaryScheduler] AI message processed via Agent SDK: ${sm.content.slice(0, 50)}`);
    } catch (err) {
      console.error('[SecretaryScheduler] AI send failed:', err);
      await appendDirectly(sm.content, '定时消息已触发，AI处理失败，请稍后重试。');
    }
  } else {
    // No AI: just append to session
    await appendDirectly(sm.content);
  }

  // Send to IM if configured
  if (sm.sendToIM) {
    const contentToSend = aiReplyContent || sm.content;
    const platform = sm.imPlatform || 'wechat_personal'; // Default to wechat_personal

    // If no conversationId specified, auto-detect from recent senders
    let conversationId: string | undefined = sm.imConversationId;
    if (!conversationId) {
      const lastSenderId = await getLastIMSenderId(platform);
      conversationId = lastSenderId || undefined;
      if (conversationId) {
        console.log(`[SecretaryScheduler] Auto-detected conversationId: ${conversationId}`);
      }
    }

    if (conversationId) {
      console.log(`[SecretaryScheduler] Sending to IM: platform=${platform}, conversationId=${conversationId}, contentLen=${contentToSend.length}`);
      await sendToIMChannel(platform, conversationId, contentToSend);
    } else {
      console.warn(`[SecretaryScheduler] IM send skipped: no recent sender found for platform=${platform}`);
    }
  }

  // Notify frontend via SSE to refresh
  secretaryStream.publish({
    type: 'dashboard_refresh',
    data: {
      reason: 'scheduled_message_triggered',
      content: sm.content.slice(0, 100),
    },
  });
}

/**
 * Send a message to an IM channel.
 */
async function sendToIMChannel(
  platform: string,
  conversationId: string,
  content: string
): Promise<void> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/im/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, conversationId, content }),
    });

    const result = await response.json();
    if (result.success) {
      console.log(`[SecretaryScheduler] Message sent to ${platform}/${conversationId}`);
    } else {
      console.error(`[SecretaryScheduler] Failed to send to IM: ${result.error}`);
    }
  } catch (err) {
    console.error('[SecretaryScheduler] IM send error:', err);
  }
}

/**
 * Get API base URL for internal fetch calls.
 */
function getApiBaseUrl(): string {
  // In development, use localhost
  // In production, use the internal server address
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

/**
 * Get the last sender ID from IM adapter cache.
 * Returns the most recent user who sent a message to the bot.
 */
async function getLastIMSenderId(platform: string): Promise<string | null> {
  try {
    if (platform === 'wechat_personal') {
      const adapter = await import('./im/adapters/wechat-personal/adapter');
      const lastSenderId = adapter.default.getLastSenderId?.();
      return lastSenderId;
    }
    // TODO: Add support for other platforms
    return null;
  } catch (err) {
    console.warn('[SecretaryScheduler] Failed to get last IM sender:', err);
    return null;
  }
}

/**
 * Append a scheduled message directly to the database (no AI processing).
 */
async function appendDirectly(content: string, assistantReply?: string): Promise<void> {
  try {
    const userMsg = await createSecretaryMessage({
      role: 'user',
      messageType: 'text',
      content: `[定时任务] ${content}`,
      senderId: 'scheduled-task',
      senderName: '定时任务',
      interactionMode: 'plain',
    });

    // SSE push
    secretaryStream.publish({ type: 'new_message', data: { message: userMsg } });

    if (assistantReply) {
      const asstMsg = await createSecretaryMessage({
        role: 'assistant',
        messageType: 'text',
        content: `⏰ ${assistantReply}`,
        senderId: 'secretary',
        senderName: '秘书',
        interactionMode: 'plain',
      });
      secretaryStream.publish({ type: 'new_message', data: { message: asstMsg } });
    }
  } catch (err) {
    console.warn('[SecretaryScheduler] appendDirectly failed:', err);
  }
}

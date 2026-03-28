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

let timer: ReturnType<typeof setInterval> | null = null;

// ========== Public API ==========

export function startSecretaryScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    tickScheduler().catch((err) => {
      console.error('[SecretaryScheduler] Tick error:', err);
    });
  }, CHECK_INTERVAL_MS);
  // Run immediately on start
  tickScheduler().catch((err) => {
    console.error('[SecretaryScheduler] Initial tick error:', err);
  });
  console.log('[SecretaryScheduler] Scheduler started');
}

export function stopSecretaryScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  console.log('[SecretaryScheduler] Scheduler stopped');
}

export function isSecretarySchedulerRunning(): boolean {
  return timer !== null;
}

/**
 * Trigger a single scheduled message manually.
 * Returns true if the message was found and sent.
 */
export async function triggerOneSecretaryMessage(messageId: string): Promise<boolean> {
  const messages = await loadScheduledMessages();
  const sm = messages.find((m) => m.id === messageId);
  if (!sm || !sm.content.trim()) {
    console.log(`[SecretaryScheduler] triggerOne: message ${messageId} not found or empty`);
    return false;
  }

  await sendScheduledMessage(sm.content, sm.aiReply);
  sm.lastSentAt = Date.now();
  await saveScheduledMessages(messages);
  console.log(`[SecretaryScheduler] Manual trigger OK: ${messageId}`);
  return true;
}

// ========== Internal ==========

async function tickScheduler(): Promise<void> {
  const messages = await loadScheduledMessages();
  if (messages.length === 0) return;

  const now = Date.now();
  let dirty = false;

  for (const sm of messages) {
    if (!sm.enabled || !sm.content.trim()) continue;

    if (isDue(sm, now)) {
      await sendScheduledMessage(sm.content, sm.aiReply);
      sm.lastSentAt = now;
      dirty = true;
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
 * Otherwise, directly appends to the session.
 */
async function sendScheduledMessage(content: string, aiReply: boolean): Promise<void> {
  const { secretaryStream } = await import('./secretary-stream');

  if (aiReply) {
    // Use the new Claude Agent SDK for AI processing
    try {
      const { executeSecretaryClaude } = await import('./secretary/secretary-claude');
      const { createSecretaryMessage } = await import('./secretary/secretary-message-service');
      const { randomUUID } = await import('crypto');

      const requestId = randomUUID();
      const messageContent = `[定时任务] ${content}`;

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
        const aiMessage = await createSecretaryMessage({
          role: 'assistant',
          messageType: 'text',
          content: result.reply.trim(),
          senderId: 'secretary-ai',
          senderName: '秘书',
          interactionMode: 'ai_chat',
          requestId,
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

      console.log(`[SecretaryScheduler] AI message processed via Agent SDK: ${content.slice(0, 50)}`);
    } catch (err) {
      console.error('[SecretaryScheduler] AI send failed:', err);
      await appendDirectly(content, '定时消息已触发，AI处理失败，请稍后重试。');
    }
  } else {
    // No AI: just append to session
    await appendDirectly(content);
  }

  // Notify frontend via SSE to refresh
  secretaryStream.publish({
    type: 'dashboard_refresh',
    data: {
      reason: 'scheduled_message_triggered',
      content: content.slice(0, 100),
    },
  });
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

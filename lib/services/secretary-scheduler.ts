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
  loadSession,
  saveSession,
  type SecretaryMessage,
  type SecretaryScheduledMessage,
} from './secretary-session';

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
 * If aiReply is true, sends via the secretary API so AI processes it.
 * Otherwise, directly appends to the session.
 */
async function sendScheduledMessage(content: string, aiReply: boolean): Promise<void> {
  const { secretaryStream } = await import('./secretary-stream');

  if (aiReply) {
    // Send through the secretary API so AI processes and responds
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE || '';
      const baseUrl = apiBase || `http://localhost:${process.env.PORT || 3000}`;

      const res = await fetch(`${baseUrl}/api/chat/home/secretary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[定时任务] ${content}`,
        }),
      });

      if (res.ok) {
        console.log(`[SecretaryScheduler] AI message sent: ${content.slice(0, 50)}`);
      } else {
        // Fallback: write directly to session
        await appendDirectly(content, '定时消息已触发，AI处理失败，请稍后重试。');
      }
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
 * Append a scheduled message directly to the session (no AI processing).
 */
async function appendDirectly(content: string, assistantReply?: string): Promise<void> {
  try {
    const session = await loadSession();
    const userMsg: SecretaryMessage = {
      role: 'user',
      content: `[定时任务] ${content}`,
      timestamp: new Date().toISOString(),
      source: 'web',
    };
    session.messages.push(userMsg);

    if (assistantReply) {
      const asstMsg: SecretaryMessage = {
        role: 'assistant',
        content: `⏰ ${assistantReply}`,
        timestamp: new Date().toISOString(),
        source: 'web',
      };
      session.messages.push(asstMsg);
    }

    await saveSession(session);
  } catch (err) {
    console.warn('[SecretaryScheduler] appendDirectly failed:', err);
  }
}

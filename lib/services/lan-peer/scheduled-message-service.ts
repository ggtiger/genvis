/**
 * Scheduled Message Service
 * Runs on the group creator's node, periodically checks all groups
 * for enabled scheduled messages and sends them when due.
 */

import { randomUUID } from 'crypto';
import { getGroups, updateGroup } from './chat-service';
import { createLanMessage } from './lan-message-service';
import { lanPeerStream } from './lan-peer-stream';
import type { ChatMessage } from './types';

const CHECK_INTERVAL_MS = 30_000; // check every 30 seconds

let timer: ReturnType<typeof setInterval> | null = null;
let peerId = '';
let peerName = '';
let getTransport: (() => any) | null = null;

/**
 * Start the scheduled message scheduler.
 * Should be called once from manager.start().
 */
export function startScheduler(id: string, name: string, transportGetter: () => any): void {
  peerId = id;
  peerName = name;
  getTransport = transportGetter;

  if (timer) return;
  timer = setInterval(() => {
    tickScheduler().catch((err) => {
      console.error('[ScheduledMsg] Tick error:', err);
    });
  }, CHECK_INTERVAL_MS);
  console.log(`[ScheduledMsg] Scheduler started (peerId=${peerId})`);
}

/** Stop the scheduler */
export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Update peerId/peerName at runtime (e.g. after name change) */
export function updateSchedulerIdentity(id: string, name: string): void {
  peerId = id;
  peerName = name;
}

/** Trigger an immediate tick (e.g. after saving scheduled messages) */
export function triggerImmediateTick(): void {
  tickScheduler().catch((err) => {
    console.error('[ScheduledMsg] Immediate tick error:', err);
  });
}

/**
 * Manually trigger a single scheduled message to send right now.
 * Returns true if the message was found and sent.
 */
export async function triggerOneMessage(groupId: string, messageId: string): Promise<boolean> {
  const groups = await getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group) {
    console.log(`[ScheduledMsg] triggerOneMessage: group ${groupId} not found`);
    return false;
  }

  // Resolve effective peerId (module-level OR from manager fallback)
  let effectivePeerId = peerId;
  if (!effectivePeerId) {
    try {
      const { getLanPeerManager } = await import('./manager');
      effectivePeerId = getLanPeerManager()?.peerId || '';
    } catch { /* ignore */ }
  }

  // Only allow creator to trigger
  if (group.creatorId !== effectivePeerId && group.creatorId !== 'local') {
    console.log(`[ScheduledMsg] triggerOneMessage denied: creatorId=${group.creatorId}, peerId=${effectivePeerId}`);
    return false;
  }

  const sm = group.scheduledMessages?.find((m) => m.id === messageId);
  if (!sm || !sm.content.trim()) {
    console.log(`[ScheduledMsg] triggerOneMessage: message ${messageId} not found or empty`);
    return false;
  }

  await sendScheduledMessage(groupId, sm.content, group.members, sm.aiReply !== false);
  sm.lastSentAt = Date.now();
  await updateGroup(groupId, { scheduledMessages: group.scheduledMessages });
  console.log(`[ScheduledMsg] Manual trigger OK: group=${groupId}, msg=${messageId}`);
  return true;
}

/** One tick: check all groups and send due messages */
async function tickScheduler(): Promise<void> {
  const groups = await getGroups();
  const now = Date.now();

  // Resolve effective peerId (module-level OR from manager fallback)
  let effectivePeerId = peerId;
  if (!effectivePeerId) {
    try {
      const { getLanPeerManager } = await import('./manager');
      const mgr = getLanPeerManager();
      if (mgr) {
        effectivePeerId = mgr.peerId;
        // Also fix module-level state for future ticks
        peerId = mgr.peerId;
        peerName = mgr.peerName;
        getTransport = () => mgr.transport;
      }
    } catch { /* ignore */ }
  }

  for (const group of groups) {
    // Only the creator node should send scheduled messages
    if (group.creatorId !== effectivePeerId && group.creatorId !== 'local') {
      // Debug: log mismatch to help diagnose
      if (group.scheduledMessages && group.scheduledMessages.length > 0) {
        console.log(`[ScheduledMsg] Skip group ${group.id}: creatorId=${group.creatorId} !== peerId=${peerId}`);
      }
      continue;
    }
    if (!group.scheduledMessages || group.scheduledMessages.length === 0) continue;

    let dirty = false;
    for (const sm of group.scheduledMessages) {
      if (!sm.enabled || !sm.content.trim()) continue;

      const shouldSend = isDue(sm, now);
      if (shouldSend) {
        await sendScheduledMessage(group.id, sm.content, group.members, sm.aiReply !== false);
        sm.lastSentAt = now;
        dirty = true;
      }
    }

    // Persist updated lastSentAt
    if (dirty) {
      await updateGroup(group.id, { scheduledMessages: group.scheduledMessages });
    }
  }
}

/**
 * Determine whether a scheduled message is due to send.
 * Supports two modes: 'interval' (every N minutes) and 'daily' (at specific HH:MM each day).
 */
function isDue(sm: { scheduleType?: string; intervalMinutes: number; scheduledTime?: string; lastSentAt?: number }, now: number): boolean {
  const lastSent = sm.lastSentAt || 0;

  if (sm.scheduleType === 'daily' && sm.scheduledTime) {
    // Daily mode: fire once per day at the specified HH:MM
    const [h, m] = sm.scheduledTime.split(':').map(Number);
    const todayTarget = new Date();
    todayTarget.setHours(h, m, 0, 0);
    const targetMs = todayTarget.getTime();

    // Fire if: current time >= target AND we haven't sent today (lastSent < target)
    return now >= targetMs && lastSent < targetMs;
  }

  // Interval mode (default)
  const intervalMs = sm.intervalMinutes * 60_000;
  return now - lastSent >= intervalMs;
}

/** Send a single scheduled message to a group and optionally trigger AI reply */
async function sendScheduledMessage(groupId: string, content: string, members: string[], aiReply: boolean = true): Promise<void> {
  const messageId = randomUUID();
  const timestamp = Date.now();
  const mode = aiReply ? 'plain' : 'no_ai';

  // Persist to database
  await createLanMessage({
    id: messageId,
    groupId,
    role: 'user',
    messageType: 'text',
    content,
    senderId: 'scheduled',
    senderName: '⏰ 定时消息',
    interactionMode: mode,
  });

  // Build ChatMessage
  const message: ChatMessage = {
    id: messageId,
    groupId,
    senderId: 'scheduled',
    senderName: '⏰ 定时消息',
    content,
    messageType: 'text',
    interactionMode: mode,
    timestamp,
    status: 'sent',
  };

  // Notify local SSE clients
  lanPeerStream.publish({ type: 'new_message', data: { message } });

  // Broadcast to group members via WebSocket
  const transport = getTransport?.();
  if (transport) {
    transport.broadcast({
      type: 'GROUP_MESSAGE',
      senderId: peerId,
      senderName: peerName,
      timestamp,
      payload: { message },
    }, members);
  }

  console.log(`[ScheduledMsg] Sent to group ${groupId}: ${content.slice(0, 50)}`);

  // Trigger AI reply on the creator node (only if aiReply is enabled)
  if (aiReply) {
    try {
      const { getLanPeerManager } = await import('./manager');
      const mgr = getLanPeerManager();
      if (mgr) {
        await mgr.triggerAIReply(groupId, message);
        console.log(`[ScheduledMsg] AI reply triggered for group ${groupId}`);
      }
    } catch (err) {
      console.error(`[ScheduledMsg] AI reply failed for group ${groupId}:`, err);
    }
  }
}

/**
 * GET/POST /api/lan-peer/groups/[groupId]/messages
 *
 * GET  — Retrieve messages from database (replaces JSON file reads)
 * POST — Send a message, persist to DB, trigger Claude SDK AI reply
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getGroup, touchGroupTimestamp } from '@/lib/services/lan-peer/chat-service';
import { createLanMessage, getLanMessagesByGroup } from '@/lib/services/lan-peer/lan-message-service';
import { parseInteractionMode } from '@/lib/services/lan-peer/message-parser';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';
import { lanPeerStream } from '@/lib/services/lan-peer/lan-peer-stream';
import type { ChatMessage } from '@/lib/services/lan-peer/types';

export async function GET(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  const beforeId = url.searchParams.get('beforeId') || undefined;

  const dbMessages = await getLanMessagesByGroup(groupId, limit, beforeId);

  // Map DB rows to ChatMessage shape for frontend compatibility
  const msgs: ChatMessage[] = dbMessages.map((m) => ({
    id: m.id,
    groupId: m.groupId,
    senderId: m.senderId || 'unknown',
    senderName: m.senderName || 'Unknown',
    content: m.content,
    messageType: m.messageType as ChatMessage['messageType'],
    interactionMode: (m.interactionMode || 'plain') as ChatMessage['interactionMode'],
    metadata: m.metadataJson ? JSON.parse(m.metadataJson) : undefined,
    timestamp: new Date(m.createdAt).getTime(),
    status: 'sent',
  }));

  return NextResponse.json({ success: true, data: msgs });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  try {
    const body = await request.json();
    const { content, fileInfo } = body;
    if (!content && !fileInfo) {
      return NextResponse.json({ success: false, error: '消息内容不能为空' }, { status: 400 });
    }

    const manager = getLanPeerManager();
    const senderId = manager?.peerId || 'local';
    const senderName = manager?.peerName || '本机';

    const group = await getGroup(groupId);
    const enabledSkills = group?.enabledSkills || [];
    const interaction = content ? parseInteractionMode(content, enabledSkills) : { mode: 'plain' as const, cleanContent: '' };

    const messageId = randomUUID();
    const timestamp = Date.now();

    // Persist user message to database
    await createLanMessage({
      id: messageId,
      groupId,
      role: 'user',
      messageType: fileInfo ? (fileInfo.mimeType?.startsWith('image/') ? 'image' : 'file') : 'text',
      content: content || '',
      senderId,
      senderName,
      interactionMode: interaction.mode,
      metadata: fileInfo ? { fileInfo, mentionedPeers: interaction.mentionedPeerName ? [interaction.mentionedPeerName] : undefined } : undefined,
    });

    // Build ChatMessage for SSE / WebSocket broadcast
    const message: ChatMessage = {
      id: messageId,
      groupId,
      senderId,
      senderName,
      content: content || '',
      messageType: fileInfo ? (fileInfo.mimeType?.startsWith('image/') ? 'image' : 'file') : 'text',
      interactionMode: interaction.mode,
      mentionedPeers: interaction.mentionedPeerName ? [interaction.mentionedPeerName] : undefined,
      fileInfo,
      timestamp,
      status: 'sent',
    };

    // Notify local SSE clients
    lanPeerStream.publish({ type: 'new_message', data: { message } });

    // Update group timestamp for sorting (most recent message first)
    touchGroupTimestamp(groupId).catch(() => {});

    // Broadcast to group members via WebSocket
    // Star topology: members only have direct connection to creator,
    // so non-creator members must send to creator who relays to others
    if (manager && group) {
      const peerMsg = {
        type: 'GROUP_MESSAGE' as const,
        senderId,
        senderName,
        timestamp: message.timestamp,
        payload: { message },
      };

      if (senderId === group.creatorId) {
        // Creator: broadcast directly to all members
        manager.transport.broadcast(peerMsg, group.members);
      } else {
        // Non-creator member: send only to creator, who will relay to others
        manager.transport.send(group.creatorId, peerMsg);
      }
    }

    // If skill_invoke mode, trigger AI reply with skill plugins loaded (NOT REST API call).
    // Skills like baidu-search, pdf, docx, xlsx are Claude SDK plugins loaded via
    // the `plugins` parameter in executeLanClaude. The AI will use them naturally.
    // Also trigger for plain ai_chat mode.
    const localPeerId = manager?.peerId || 'local';
    const isCreator = group?.creatorId === localPeerId || group?.creatorId === 'local';

    if (message.messageType === 'text' && interaction.mode !== 'no_ai' && isCreator) {
      handleAIReply(groupId, message, interaction.cleanContent, manager, group).catch((err) => {
        console.error('[LanPeer] AI reply failed:', err);
      });
    }

    return NextResponse.json({ success: true, data: message });
  } catch (error) {
    console.error('[LanPeer] POST error:', error);
    return NextResponse.json({ success: false, error: '发送消息失败' }, { status: 500 });
  }
}

/**
 * Handle AI reply using Claude Agent SDK.
 * Streams response tokens via SSE and persists final messages to the database.
 * When the group has enabledSkills, they are loaded as SDK plugins.
 */
async function handleAIReply(
  groupId: string,
  userMessage: ChatMessage,
  cleanContent: string,
  manager: any,
  group: any,
): Promise<void> {
  const { executeLanClaude, AI_SENDER_ID, AI_SENDER_NAME } = await import('@/lib/services/lan-peer/lan-claude');

  const aiRequestId = randomUUID();
  const senderId = userMessage.senderId;

  // Register broadcast callback: forward ai_stream_* events to all peers via WebSocket
  const members = group?.members || [];
  lanPeerStream.setBroadcastCallback(groupId, (event) => {
    if (manager) {
      manager.transport.broadcast({
        type: 'AI_STREAM_EVENT',
        senderId: manager.peerId,
        senderName: manager.peerName,
        timestamp: Date.now(),
        payload: { streamEvent: event },
      }, members);
    }
  });

  // Mark group as actively streaming (returns AbortController for cancellation)
  const abortController = lanPeerStream.markStreamActive(groupId, aiRequestId, senderId);

  // Notify frontend that AI streaming is starting (include senderId so frontend knows who triggered it)
  // (broadcastCallback will forward this to peers)
  lanPeerStream.publish({
    type: 'ai_stream_start',
    data: { groupId, requestId: aiRequestId, senderId, timestamp: new Date().toISOString() },
  });

  try {
    // executeLanClaude handles streaming, DB persistence, and session update internally
    await executeLanClaude({
      groupId,
      instruction: cleanContent || userMessage.content,
      sessionId: group?.activeSessionId,
      requestId: aiRequestId,
      senderName: userMessage.senderName,
      abortSignal: abortController.signal,
    });
  } finally {
    // Clear active stream marker
    lanPeerStream.markStreamDone(groupId);

    // Safety net: always send ai_stream_end (also broadcast to peers via callback)
    lanPeerStream.publish({
      type: 'ai_stream_end',
      data: { groupId, requestId: aiRequestId, timestamp: new Date().toISOString() },
    });

    // Clean up broadcast callback
    lanPeerStream.clearBroadcastCallback(groupId);
  }

  // After SDK completes, broadcast the final AI message to peers
  const { getLanMessagesByGroup } = await import('@/lib/services/lan-peer/lan-message-service');
  const recentMsgs = await getLanMessagesByGroup(groupId, 5);
  const lastAIMsg = recentMsgs.reverse().find((m) => m.senderId === AI_SENDER_ID && m.requestId === aiRequestId && m.messageType === 'text');

  if (lastAIMsg && manager && group) {
    const broadcastMsg: ChatMessage = {
      id: lastAIMsg.id,
      groupId,
      senderId: AI_SENDER_ID,
      senderName: AI_SENDER_NAME,
      content: lastAIMsg.content,
      messageType: 'text',
      interactionMode: 'ai_chat',
      timestamp: new Date(lastAIMsg.createdAt).getTime(),
      status: 'sent',
    };

    manager.transport.broadcast({
      type: 'GROUP_MESSAGE',
      senderId: broadcastMsg.senderId,
      senderName: broadcastMsg.senderName,
      timestamp: broadcastMsg.timestamp,
      payload: { message: broadcastMsg },
    }, group.members);
  }
}

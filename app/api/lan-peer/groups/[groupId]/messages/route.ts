/**
 * GET/POST /api/lan-peer/groups/[groupId]/messages
 *
 * GET  — Retrieve messages from database (replaces JSON file reads)
 * POST — Send a message, persist to DB, trigger Claude SDK AI reply
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getGroup } from '@/lib/services/lan-peer/chat-service';
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

    // Broadcast to group members via WebSocket
    if (manager && group) {
      manager.transport.broadcast({
        type: 'GROUP_MESSAGE',
        senderId,
        senderName,
        timestamp: message.timestamp,
        payload: { message },
      }, group.members);
    }

    // If skill_invoke mode, trigger skill call
    if (interaction.mode === 'skill_invoke' && enabledSkills.length > 0) {
      handleSkillInvoke(groupId, message, enabledSkills, manager).catch((err) => {
        console.error('[LanPeer] Skill invoke failed:', err);
      });
    }

    // Trigger AI reply ONLY if this node is the group creator.
    // Non-creator nodes just send the message; the creator's node will
    // receive it via WebSocket and trigger AI there (see manager.ts handleMessage).
    const localPeerId = manager?.peerId || 'local';
    const isCreator = group?.creatorId === localPeerId || group?.creatorId === 'local';

    if (message.messageType === 'text' && interaction.mode !== 'skill_invoke' && isCreator) {
      handleAIReply(groupId, message, manager, group).catch((err) => {
        console.error('[LanPeer] AI reply failed:', err);
      });
    }

    return NextResponse.json({ success: true, data: message });
  } catch (error) {
    console.error('[LanPeer] POST error:', error);
    return NextResponse.json({ success: false, error: '发送消息失败' }, { status: 500 });
  }
}

async function handleSkillInvoke(
  groupId: string,
  message: ChatMessage,
  enabledSkills: string[],
  manager: any,
): Promise<void> {
  const { handleSkillRequest } = await import('@/lib/services/lan-peer/peer-skill-service');
  const skillName = enabledSkills[0];
  const result = await handleSkillRequest(skillName, 'GET', '/api/todos', undefined, undefined);

  const resultContent = result.success ? `技能 ${skillName} 执行成功` : `技能调用失败: ${result.error}`;

  // Persist to database
  const savedMsg = await createLanMessage({
    groupId,
    role: 'assistant',
    messageType: 'skill_result',
    content: resultContent,
    senderId: manager?.peerId || 'system',
    senderName: '技能助手',
    interactionMode: 'plain',
    metadata: { skillResult: result },
  });

  const resultMessage: ChatMessage = {
    id: savedMsg.id,
    groupId,
    senderId: manager?.peerId || 'system',
    senderName: '技能助手',
    content: resultContent,
    messageType: 'skill_result',
    interactionMode: 'plain',
    skillResult: result,
    timestamp: new Date(savedMsg.createdAt).getTime(),
    status: 'sent',
  };

  // Notify local SSE
  lanPeerStream.publish({ type: 'new_message', data: { message: resultMessage } });

  // Broadcast skill result
  const group = await (await import('@/lib/services/lan-peer/chat-service')).getGroup(groupId);
  if (manager && group) {
    manager.transport.broadcast({
      type: 'GROUP_MESSAGE',
      senderId: resultMessage.senderId,
      senderName: resultMessage.senderName,
      timestamp: resultMessage.timestamp,
      payload: { message: resultMessage },
    }, group.members);
  }
}

/**
 * Handle AI reply using Claude Agent SDK.
 * Streams response tokens via SSE and persists final messages to the database.
 */
async function handleAIReply(
  groupId: string,
  userMessage: ChatMessage,
  manager: any,
  group: any,
): Promise<void> {
  const { executeLanClaude, AI_SENDER_ID, AI_SENDER_NAME } = await import('@/lib/services/lan-peer/lan-claude');

  const aiRequestId = randomUUID();
  const senderId = userMessage.senderId;

  // Mark group as actively streaming (returns AbortController for cancellation)
  const abortController = lanPeerStream.markStreamActive(groupId, aiRequestId, senderId);

  // Notify frontend that AI streaming is starting (include senderId so frontend knows who triggered it)
  lanPeerStream.publish({
    type: 'ai_stream_start',
    data: { groupId, requestId: aiRequestId, senderId, timestamp: new Date().toISOString() },
  });

  try {
    // executeLanClaude handles streaming, DB persistence, and session update internally
    await executeLanClaude({
      groupId,
      instruction: userMessage.content,
      sessionId: group?.activeSessionId,
      requestId: aiRequestId,
      senderName: userMessage.senderName,
      abortSignal: abortController.signal,
    });
  } finally {
    // Clear active stream marker
    lanPeerStream.markStreamDone(groupId);

    // Safety net: always send ai_stream_end to clear the frontend spinner,
    // even if executeLanClaude already sent one (frontend deduplicates via setStreamingMessage(null)).
    lanPeerStream.publish({
      type: 'ai_stream_end',
      data: { groupId, requestId: aiRequestId, timestamp: new Date().toISOString() },
    });
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

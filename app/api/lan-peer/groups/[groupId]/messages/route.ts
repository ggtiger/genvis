/**
 * GET/POST /api/lan-peer/groups/[groupId]/messages
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getMessages, addMessage, getGroup } from '@/lib/services/lan-peer/chat-service';
import { parseInteractionMode } from '@/lib/services/lan-peer/message-parser';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';
import type { ChatMessage } from '@/lib/services/lan-peer/types';

export async function GET(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const before = url.searchParams.get('before') ? parseInt(url.searchParams.get('before')!, 10) : undefined;
  const msgs = await getMessages(groupId, limit, before);
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

    const message: ChatMessage = {
      id: randomUUID(),
      groupId,
      senderId,
      senderName,
      content: content || '',
      messageType: fileInfo ? (fileInfo.mimeType?.startsWith('image/') ? 'image' : 'file') : 'text',
      interactionMode: interaction.mode,
      mentionedPeers: interaction.mentionedPeerName ? [interaction.mentionedPeerName] : undefined,
      fileInfo,
      timestamp: Date.now(),
      status: 'sent',
    };

    await addMessage(groupId, message);

    // Broadcast to group members
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
      // Fire-and-forget skill invocation
      handleSkillInvoke(groupId, message, enabledSkills, manager).catch((err) => {
        console.error('[LanPeer] Skill invoke failed:', err);
      });
    }

    return NextResponse.json({ success: true, data: message });
  } catch (error) {
    return NextResponse.json({ success: false, error: '发送消息失败' }, { status: 500 });
  }
}

async function handleSkillInvoke(
  groupId: string,
  message: ChatMessage,
  enabledSkills: string[],
  manager: any,
): Promise<void> {
  // For now, use the first enabled skill with a simple GET query
  // This can be enhanced with AI-based skill routing later
  const { handleSkillRequest } = await import('@/lib/services/lan-peer/peer-skill-service');
  const skillName = enabledSkills[0];
  const result = await handleSkillRequest(skillName, 'GET', '/api/todos', undefined, undefined);

  const resultMessage: ChatMessage = {
    id: (await import('crypto')).randomUUID(),
    groupId,
    senderId: manager?.peerId || 'system',
    senderName: '技能助手',
    content: result.success ? `技能 ${skillName} 执行成功` : `技能调用失败: ${result.error}`,
    messageType: 'skill_result',
    interactionMode: 'plain',
    skillResult: result,
    timestamp: Date.now(),
    status: 'sent',
  };

  await addMessage(groupId, resultMessage);

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

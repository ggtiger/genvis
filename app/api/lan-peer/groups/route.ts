/**
 * GET /api/lan-peer/groups — list groups
 * POST /api/lan-peer/groups — create group
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getGroups, createGroup } from '@/lib/services/lan-peer/chat-service';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';

export async function GET() {
  try {
    const allGroups = await getGroups();
    // Only return groups where the local peer is a member
    const manager = getLanPeerManager();
    const localPeerId = manager?.peerId || 'local';
    const groups = allGroups.filter(g =>
      g.members.includes(localPeerId) || g.creatorId === localPeerId || g.creatorId === 'local'
    );
    // Sort by updatedAt descending (most recent first)
    groups.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return NextResponse.json({ success: true, data: groups });
  } catch (error) {
    return NextResponse.json({ success: false, error: '获取群组列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, members, enabledSkills, systemPrompt } = await request.json();
    if (!name || !Array.isArray(members)) {
      return NextResponse.json({ success: false, error: '请提供群组名称和成员列表' }, { status: 400 });
    }

    const manager = getLanPeerManager();
    const creatorId = manager?.peerId || 'local';
    const groupId = randomUUID();
    const group = await createGroup(groupId, name, creatorId, members, enabledSkills || [], systemPrompt);

    // Broadcast group creation to members
    if (manager) {
      manager.transport.broadcast({
        type: 'GROUP_CREATE',
        senderId: manager.peerId,
        senderName: manager.peerName,
        timestamp: Date.now(),
        payload: { group },
      }, members);
    }

    return NextResponse.json({ success: true, data: group });
  } catch (error) {
    return NextResponse.json({ success: false, error: '创建群组失败' }, { status: 500 });
  }
}

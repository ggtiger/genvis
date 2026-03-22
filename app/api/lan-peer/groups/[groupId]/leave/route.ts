/**
 * POST /api/lan-peer/groups/[groupId]/leave
 * Member voluntarily leaves a group. Cannot be used by the group creator.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getGroup, deleteGroup } from '@/lib/services/lan-peer/chat-service';
import { deleteLanMessagesByGroup } from '@/lib/services/lan-peer/lan-message-service';
import { lanPeerStream } from '@/lib/services/lan-peer/lan-peer-stream';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const group = await getGroup(groupId);
  const manager = getLanPeerManager();
  const localPeerId = manager?.peerId || 'local';

  if (!group) {
    // Group doesn't exist locally — just clean up any orphan data and remove from UI
    await deleteLanMessagesByGroup(groupId);
    await deleteGroup(groupId);
    lanPeerStream.publish({ type: 'group_deleted', data: { groupId } });
    return NextResponse.json({ success: true });
  }

  // Creator cannot leave — they must dissolve the group instead
  if (group.creatorId === localPeerId || group.creatorId === 'local') {
    return NextResponse.json({ success: false, error: '群主不能退出群组，请解散群组' }, { status: 400 });
  }

  // Remove self from members and broadcast to others
  const newMembers = group.members.filter(id => id !== localPeerId);

  if (manager && newMembers.length > 0) {
    // Update group on creator node via GROUP_UPDATE broadcast
    const updated = { ...group, members: newMembers, updatedAt: Date.now() };
    manager.transport.broadcast({
      type: 'GROUP_UPDATE',
      senderId: manager.peerId,
      senderName: manager.peerName,
      timestamp: Date.now(),
      payload: { group: updated },
    }, [...group.members]); // notify all members including creator
  }

  // Delete local group data
  await deleteLanMessagesByGroup(groupId);
  await deleteGroup(groupId);

  // Notify local SSE clients
  lanPeerStream.publish({ type: 'group_deleted', data: { groupId } });

  return NextResponse.json({ success: true });
}

/**
 * GET/PUT/DELETE /api/lan-peer/groups/[groupId]
 */
import { NextRequest, NextResponse } from 'next/server';
import { getGroup, updateGroup, deleteGroup } from '@/lib/services/lan-peer/chat-service';
import { deleteLanMessagesByGroup } from '@/lib/services/lan-peer/lan-message-service';
import { lanPeerStream } from '@/lib/services/lan-peer/lan-peer-stream';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const group = await getGroup(groupId);
  if (!group) return NextResponse.json({ success: false, error: '群组不存在' }, { status: 404 });
  return NextResponse.json({ success: true, data: group });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const body = await request.json();

  // Get old members before update (for broadcasting to removed members too)
  const oldGroup = await getGroup(groupId);
  const oldMembers = oldGroup?.members || [];

  const updated = await updateGroup(groupId, body);
  if (!updated) return NextResponse.json({ success: false, error: '群组不存在' }, { status: 404 });

  // Broadcast GROUP_UPDATE to all affected peers (old members + new members)
  const manager = getLanPeerManager();
  if (manager && body.members !== undefined) {
    const allAffected = Array.from(new Set([...oldMembers, ...updated.members]));
    manager.transport.broadcast({
      type: 'GROUP_UPDATE',
      senderId: manager.peerId,
      senderName: manager.peerName,
      timestamp: Date.now(),
      payload: { group: updated },
    }, allAffected);
  }

  // Notify local SSE clients
  lanPeerStream.publish({ type: 'group_updated', data: { group: updated } });

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  // Clean up database messages first
  await deleteLanMessagesByGroup(groupId);
  // Delete group files
  await deleteGroup(groupId);
  // Broadcast deletion event so all clients update
  lanPeerStream.publish({ type: 'group_deleted', data: { groupId } });
  return NextResponse.json({ success: true });
}

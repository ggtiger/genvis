/**
 * GET/PUT/DELETE /api/lan-peer/groups/[groupId]
 */
import { NextRequest, NextResponse } from 'next/server';
import { getGroup, updateGroup, deleteGroup } from '@/lib/services/lan-peer/chat-service';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const group = await getGroup(groupId);
  if (!group) return NextResponse.json({ success: false, error: '群组不存在' }, { status: 404 });
  return NextResponse.json({ success: true, data: group });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const body = await request.json();
  const updated = await updateGroup(groupId, body);
  if (!updated) return NextResponse.json({ success: false, error: '群组不存在' }, { status: 404 });
  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  await deleteGroup(groupId);
  return NextResponse.json({ success: true });
}

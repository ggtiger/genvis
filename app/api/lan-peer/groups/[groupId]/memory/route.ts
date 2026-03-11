/**
 * GET/DELETE /api/lan-peer/groups/[groupId]/memory
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadMemory, clearMemory } from '@/lib/services/lan-peer/group-memory';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const memory = await loadMemory(groupId);
  return NextResponse.json({ success: true, data: memory });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  await clearMemory(groupId);
  return NextResponse.json({ success: true });
}

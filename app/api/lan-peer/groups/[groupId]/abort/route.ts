/**
 * POST /api/lan-peer/groups/[groupId]/abort
 *
 * Abort an active AI stream. Only the sender who triggered the AI can abort it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';
import { lanPeerStream } from '@/lib/services/lan-peer/lan-peer-stream';

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { groupId } = await params;

  const manager = getLanPeerManager();
  const requesterId = manager?.peerId || 'local';

  const result = lanPeerStream.abortStream(groupId, requesterId);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  // Publish ai_stream_end to clear frontend state
  lanPeerStream.publish({
    type: 'ai_stream_end',
    data: {
      groupId,
      aborted: true,
      content: '（已终止）',
      timestamp: new Date().toISOString(),
    },
  });

  return NextResponse.json({ success: true });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

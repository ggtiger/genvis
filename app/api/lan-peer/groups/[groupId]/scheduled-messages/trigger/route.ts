/**
 * POST /api/lan-peer/groups/[groupId]/scheduled-messages/trigger
 * Manually trigger a specific scheduled message to send immediately.
 * Body: { messageId: string }
 */
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { messageId } = await request.json();

  if (!messageId) {
    return NextResponse.json({ success: false, error: '请提供 messageId' }, { status: 400 });
  }

  try {
    const { triggerOneMessage } = await import('@/lib/services/lan-peer/scheduled-message-service');
    const sent = await triggerOneMessage(groupId, messageId);

    if (!sent) {
      return NextResponse.json({ success: false, error: '未找到该定时消息或无权执行' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ScheduledMsg] Manual trigger error:', error);
    return NextResponse.json({ success: false, error: '执行失败' }, { status: 500 });
  }
}

/**
 * Secretary Scheduled Messages Trigger API
 * POST /api/chat/home/secretary/scheduled-messages/trigger
 *
 * Manually trigger a single scheduled message.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { messageId } = await request.json();
    if (!messageId) {
      return NextResponse.json({ success: false, error: 'messageId required' }, { status: 400 });
    }

    const { triggerOneSecretaryMessage } = await import('@/lib/services/secretary-scheduler');
    const sent = await triggerOneSecretaryMessage(messageId);

    if (sent) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ success: false, error: 'Message not found or empty' }, { status: 404 });
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

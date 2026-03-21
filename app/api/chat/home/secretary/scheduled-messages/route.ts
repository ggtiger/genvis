/**
 * Secretary Scheduled Messages API
 * GET  /api/chat/home/secretary/scheduled-messages  — list all
 * PUT  /api/chat/home/secretary/scheduled-messages  — save all
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  loadScheduledMessages,
  saveScheduledMessages,
} from '@/lib/services/secretary-session';

export async function GET() {
  try {
    const messages = await loadScheduledMessages();
    return NextResponse.json({ success: true, data: messages });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { scheduledMessages } = body;
    if (!Array.isArray(scheduledMessages)) {
      return NextResponse.json({ success: false, error: 'scheduledMessages must be an array' }, { status: 400 });
    }
    await saveScheduledMessages(scheduledMessages);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/**
 * Secretary Scheduled Messages API
 *
 * GET  /api/secretary/scheduled-messages  - List all scheduled messages
 * POST /api/secretary/scheduled-messages  - Create a new scheduled message
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  loadScheduledMessages,
  saveScheduledMessages,
  type SecretaryScheduledMessage,
} from '@/lib/services/secretary-session';
import { randomUUID } from 'crypto';

export async function GET() {
  try {
    const messages = await loadScheduledMessages();
    return NextResponse.json({ success: true, data: messages });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const messages = await loadScheduledMessages();

    const newMessage: SecretaryScheduledMessage = {
      id: randomUUID(),
      content: body.content || '',
      scheduleType: body.scheduleType || 'interval',
      intervalMinutes: body.intervalMinutes || 60,
      scheduledTime: body.scheduledTime,
      aiReply: body.aiReply !== false,
      enabled: body.enabled === true,
      sendToIM: body.sendToIM || false,
      imPlatform: body.imPlatform,
      imConversationId: body.imConversationId,
      imConversationName: body.imConversationName,
    };

    messages.push(newMessage);
    await saveScheduledMessages(messages);

    return NextResponse.json({ success: true, data: newMessage });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

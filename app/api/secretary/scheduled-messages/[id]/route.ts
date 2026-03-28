/**
 * Secretary Scheduled Message API (Single Item)
 *
 * PATCH /api/secretary/scheduled-messages/[id] - Update a scheduled message
 * DELETE /api/secretary/scheduled-messages/[id] - Delete a scheduled message
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  loadScheduledMessages,
  saveScheduledMessages,
  type SecretaryScheduledMessage,
} from '@/lib/services/secretary-session';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const messages = await loadScheduledMessages();

    const index = messages.findIndex((m) => m.id === id);
    if (index === -1) {
      return NextResponse.json(
        { success: false, error: 'Scheduled message not found' },
        { status: 404 }
      );
    }

    // Update only provided fields
    const existing = messages[index];
    messages[index] = {
      ...existing,
      ...body,
      id: existing.id, // Prevent ID change
    };

    await saveScheduledMessages(messages);
    return NextResponse.json({ success: true, data: messages[index] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const messages = await loadScheduledMessages();

    const index = messages.findIndex((m) => m.id === id);
    if (index === -1) {
      return NextResponse.json(
        { success: false, error: 'Scheduled message not found' },
        { status: 404 }
      );
    }

    messages.splice(index, 1);
    await saveScheduledMessages(messages);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

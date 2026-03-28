/**
 * Trigger Scheduled Message API
 *
 * POST /api/secretary/scheduled-messages/[id]/trigger - Immediately execute a scheduled message
 */

import { NextRequest, NextResponse } from 'next/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;

    const { triggerOneSecretaryMessage } = await import('@/lib/services/secretary-scheduler');
    const sent = await triggerOneSecretaryMessage(id);

    if (sent) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { success: false, error: 'Message not found, empty, or already executing' },
        { status: 404 }
      );
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

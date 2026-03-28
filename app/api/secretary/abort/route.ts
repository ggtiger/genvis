/**
 * POST /api/secretary/abort
 * Abort an ongoing AI stream response.
 */

import { NextRequest, NextResponse } from 'next/server';
import { secretaryStream } from '@/lib/services/secretary-stream';

interface AbortBody {
  requestId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: AbortBody = await request.json().catch(() => ({}));
    const { requestId } = body;

    console.log(`[Secretary API] Abort request | requestId=${requestId || 'all'}`);

    const result = secretaryStream.abortStream(requestId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || '中止失败' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      abortedCount: result.abortedCount,
    });
  } catch (error) {
    console.error('[Secretary API] Abort error:', error);
    return NextResponse.json(
      { success: false, error: '中止操作失败' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

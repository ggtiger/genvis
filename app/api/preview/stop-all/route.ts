import { NextResponse } from 'next/server';
import { previewManager } from '@/lib/services/preview';
import { deployManager } from '@/lib/services/deploy-manager';

/**
 * POST /api/preview/stop-all
 * Stop all running preview and deployed processes (used during app shutdown)
 */
export async function POST() {
  try {
    // Stop both preview and deploy processes in parallel
    await Promise.allSettled([
      previewManager.stopAll(),
      deployManager.stopAll(),
    ]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Failed to stop all processes:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

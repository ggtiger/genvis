/**
 * GET /api/permissions/pending?projectId=xxx
 * Get pending permission requests for a project
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPendingPermissions } from '@/lib/services/permissions';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'projectId is required' },
        { status: 400 }
      );
    }

    const pending = getPendingPermissions(projectId);

    return NextResponse.json({
      success: true,
      data: pending,
    });
  } catch (error) {
    console.error('[API] Failed to get pending permissions:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get pending permissions',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

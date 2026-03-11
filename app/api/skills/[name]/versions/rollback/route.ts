/**
 * Skill Version Rollback API
 * POST /api/skills/{name}/versions/rollback - Execute rollback
 */

import { NextRequest, NextResponse } from 'next/server';
import { rollback } from '@/lib/services/skill-qa/version-store';

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { name } = await params;
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Skill name is required' },
        { status: 400 }
      );
    }

    const skillName = decodeURIComponent(name);
    const body = await request.json();
    const { versionNumber } = body as { versionNumber?: number };

    if (
      versionNumber === undefined ||
      typeof versionNumber !== 'number' ||
      !Number.isInteger(versionNumber) ||
      versionNumber < 1
    ) {
      return NextResponse.json(
        { success: false, error: 'versionNumber must be a positive integer' },
        { status: 400 }
      );
    }

    const result = await rollback(skillName, versionNumber);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Rollback API] POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

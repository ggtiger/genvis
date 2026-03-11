/**
 * Skill Deploy Stop API
 * POST /api/skills/{name}/deploy/stop - Stop a locally deployed skill
 */

import { NextRequest, NextResponse } from 'next/server';
import { deployManager } from '@/lib/services/deploy-manager';

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext,
) {
  try {
    const { name } = await params;
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Skill name is required' },
        { status: 400 },
      );
    }

    const skillName = decodeURIComponent(name);
    const result = await deployManager.stop(skillName);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Skills Deploy Stop API] POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

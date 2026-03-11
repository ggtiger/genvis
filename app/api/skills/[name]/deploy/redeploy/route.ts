/**
 * Skill Deploy Redeploy API
 * POST /api/skills/{name}/deploy/redeploy - Rebuild and redeploy a skill
 */

import { NextRequest, NextResponse } from 'next/server';
import { deployManager } from '@/lib/services/deploy-manager';

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function POST(
  _request: NextRequest,
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
    const result = await deployManager.redeploy(skillName);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Skills Deploy Redeploy API] POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

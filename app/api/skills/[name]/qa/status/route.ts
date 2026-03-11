/**
 * QA Pipeline Status API
 * GET /api/skills/{name}/qa/status - Query pipeline status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStatus } from '@/lib/services/skill-qa/pipeline';

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { name } = await params;
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Skill name is required' },
        { status: 400 }
      );
    }

    const skillName = decodeURIComponent(name);
    const state = getStatus(skillName);
    return NextResponse.json({ success: true, data: state });
  } catch (error) {
    console.error('[QA Status API] GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

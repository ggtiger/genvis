/**
 * Skill Versions API
 * GET /api/skills/{name}/versions - Query version history
 */

import { NextRequest, NextResponse } from 'next/server';
import { listVersions } from '@/lib/services/skill-qa/version-store';

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
    const versions = await listVersions(skillName);
    return NextResponse.json({ success: true, data: versions });
  } catch (error) {
    console.error('[Versions API] GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

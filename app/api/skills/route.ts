/**
 * Skills API - List and Import
 * GET /api/skills - Get all skills with enabled status
 * POST /api/skills/import - Import skill from path
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllSkillsWithStatus, importSkill } from '@/lib/services/skill-service';

export async function GET() {
  try {
    const skills = await getAllSkillsWithStatus();
    return NextResponse.json({ success: true, data: skills });
  } catch (error) {
    console.error('[Skills API] Error getting skills:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: sourcePath } = body;

    if (!sourcePath || typeof sourcePath !== 'string') {
      return NextResponse.json(
        { success: false, error: 'path is required' },
        { status: 400 }
      );
    }

    const skill = await importSkill(sourcePath);
    return NextResponse.json({ success: true, data: skill });
  } catch (error) {
    console.error('[Skills API] Error importing skill:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Merge Back to Skill API
 * POST /api/projects/{project_id}/merge-to-skill
 * Merges a forked project's code back to its source skill, skipping data files.
 */

import { NextRequest, NextResponse } from 'next/server';
import { mergeBackToSkill } from '@/lib/services/skill-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ project_id: string }> }
) {
  try {
    const { project_id } = await params;

    if (!project_id) {
      return NextResponse.json(
        { success: false, error: 'Project ID is required' },
        { status: 400 }
      );
    }

    const result = await mergeBackToSkill(project_id);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[Merge to Skill API] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

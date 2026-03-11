/**
 * QA Pipeline Run API
 * POST /api/skills/{name}/qa/run - Start QA pipeline
 */

import { NextRequest, NextResponse } from 'next/server';
import { runPipeline, getStatus } from '@/lib/services/skill-qa/pipeline';

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

    // Start pipeline in background (don't await)
    runPipeline(skillName);

    // Return the initial pipeline state
    const state = getStatus(skillName);
    return NextResponse.json({ success: true, data: state });
  } catch (error) {
    console.error('[QA Run API] POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

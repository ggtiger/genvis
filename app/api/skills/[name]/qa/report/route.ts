/**
 * QA Pipeline Report API
 * GET /api/skills/{name}/qa/report - Get test report
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReport } from '@/lib/services/skill-qa/pipeline';

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
    const report = getReport(skillName);

    if (!report) {
      return NextResponse.json(
        { success: false, error: 'No test report available' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    console.error('[QA Report API] GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

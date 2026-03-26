/**
 * Skill Market API - Get skills list
 *
 * GET /api/skills/market?q=xxx&page=1&limit=20
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchMarketSkills, isSkillHubAvailable } from '@/lib/services/skill-market';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Check if SkillHub is available
    const cliAvailable = await isSkillHubAvailable();

    const result = await searchMarketSkills(query, page, limit);

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        cliAvailable
      }
    });
  } catch (error) {
    console.error('[API] Market search failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search skills'
      },
      { status: 500 }
    );
  }
}

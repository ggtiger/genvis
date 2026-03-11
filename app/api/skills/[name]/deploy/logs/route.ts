/**
 * Skill Deploy Logs API
 * GET /api/skills/{name}/deploy/logs - Get build logs for a skill
 */

import { NextRequest, NextResponse } from 'next/server';
import { deployManager } from '@/lib/services/deploy-manager';

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function GET(
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
    const buildLogs = deployManager.getBuildLogs(skillName);
    const statusInfo = deployManager.getStatus(skillName);
    // Combine build logs and runtime logs for a complete view
    const logs = [...buildLogs, ...statusInfo.logs];

    return NextResponse.json({ success: true, data: { logs, buildLogs, runtimeLogs: statusInfo.logs } });
  } catch (error) {
    console.error('[Skills Deploy Logs API] GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

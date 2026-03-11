/**
 * POST /api/projects/[id]/preview/stop
 * Stops the development server for the project if it is running.
 */

import { NextResponse } from 'next/server';
import { previewManager } from '@/lib/services/preview';
import { deployManager } from '@/lib/services/deploy-manager';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

export async function POST(
  _request: Request,
  { params }: RouteContext
) {
  try {
    const { project_id } = await params;

    // For deployed skill projects, stop via DeployManager
    if (project_id.startsWith('skill-')) {
      const skillName = project_id.replace(/^skill-/, '');
      const deployInfo = deployManager.getStatus(skillName);
      if (deployInfo.status === 'deployed' || deployInfo.status === 'building') {
        const info = await deployManager.stop(skillName);
        return NextResponse.json({
          success: true,
          data: {
            port: info.port,
            url: null,
            status: 'stopped',
            logs: info.logs,
          },
        });
      }
    }

    const preview = await previewManager.stop(project_id);

    return NextResponse.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    console.error('[API] Failed to stop preview:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to stop preview',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

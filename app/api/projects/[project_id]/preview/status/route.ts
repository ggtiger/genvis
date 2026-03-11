/**
 * GET /api/projects/[id]/preview/status
 * Returns the current preview status for the project.
 */

import { NextResponse } from 'next/server';
import { previewManager } from '@/lib/services/preview';
import { deployManager } from '@/lib/services/deploy-manager';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

export async function GET(
  _request: Request,
  { params }: RouteContext
) {
  try {
    const { project_id } = await params;

    // For deployed skill projects, return deploy status mapped to preview format
    if (project_id.startsWith('skill-')) {
      const skillName = project_id.replace(/^skill-/, '');
      const deployInfo = deployManager.getStatus(skillName);
      if (deployInfo.status === 'deployed' || deployInfo.status === 'building' || deployInfo.status === 'stopped') {
        const statusMap: Record<string, string> = {
          deployed: 'running',
          building: 'starting',
          stopped: 'stopped',
        };
        return NextResponse.json({
          success: true,
          data: {
            port: deployInfo.port,
            url: deployInfo.status === 'deployed' && deployInfo.port ? `http://localhost:${deployInfo.port}` : null,
            status: statusMap[deployInfo.status] || deployInfo.status,
            logs: deployInfo.logs,
            instanceId: deployInfo.port ? deployInfo.port : undefined,
          },
        });
      }
    }

    const preview = previewManager.getStatus(project_id);

    return NextResponse.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    console.error('[API] Failed to fetch preview status:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch preview status',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

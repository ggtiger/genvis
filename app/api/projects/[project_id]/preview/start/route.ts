/**
 * POST /api/projects/[id]/preview/start
 * Launches the development server for a project and returns the preview URL.
 */

import { NextResponse } from 'next/server';
import { previewManager } from '@/lib/services/preview';
import { timelineLogger } from '@/lib/services/timeline';
import { deployManager } from '@/lib/services/deploy-manager';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

/**
 * For skill projects that are deployed, delegate to DeployManager
 * instead of PreviewManager.
 */
function isDeployedSkill(projectId: string): { isSkill: boolean; skillName: string | null; deployed: boolean } {
  if (!projectId.startsWith('skill-')) return { isSkill: false, skillName: null, deployed: false };
  const skillName = projectId.replace(/^skill-/, '');
  const status = deployManager.getStatus(skillName);
  const deployed = status.status === 'deployed' || status.status === 'stopped' || status.status === 'building' || status.status === 'build_failed';
  return { isSkill: true, skillName, deployed };
}

export async function POST(
  _request: Request,
  { params }: RouteContext
) {
  try {
    const { project_id } = await params;

    // For deployed skill projects, start via DeployManager
    const { deployed, skillName } = isDeployedSkill(project_id);
    if (deployed && skillName) {
      const info = await deployManager.start(skillName);
      return NextResponse.json({
        success: true,
        data: {
          port: info.port,
          url: info.port ? `http://localhost:${info.port}` : null,
          status: info.status === 'deployed' ? 'running' : info.status,
          logs: info.logs,
          instanceId: info.port ? info.port : undefined,
        },
      });
    }

    await timelineLogger.append({
      type: 'api',
      level: 'info',
      message: 'Preview start request',
      projectId: project_id,
      component: 'api',
      event: 'api.request',
      metadata: { path: '/api/projects/[id]/preview/start', method: 'POST' }
    });
    await timelineLogger.append({
      type: 'api',
      level: 'info',
      message: 'Triggered preview start (api)',
      projectId: project_id,
      component: 'api',
      event: 'trigger.preview.api'
    });
    const preview = await previewManager.start(project_id);

    await timelineLogger.append({
      type: 'api',
      level: 'info',
      message: 'Preview start response',
      projectId: project_id,
      component: 'api',
      event: 'api.response',
      metadata: { code: 0, msg: 'ok', data: preview }
    });
    return NextResponse.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    console.error('[API] Failed to start preview:', error);
    const msg = error instanceof Error ? error.message : 'Failed to start preview';
    const { params } = arguments[1] as RouteContext;
    try {
      const { project_id } = await params;
      await timelineLogger.append({
        type: 'api',
        level: 'error',
        message: 'Preview start response',
        projectId: project_id,
        component: 'api',
        event: 'api.response',
        metadata: { code: -1, msg }
      });
    } catch {}
    return NextResponse.json(
      {
        success: false,
        error: msg,
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

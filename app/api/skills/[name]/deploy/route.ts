/**
 * Skill Deploy API
 * POST /api/skills/{name}/deploy - Deploy a skill (local or aliyun)
 * GET  /api/skills/{name}/deploy - Get deploy status (local + cloud)
 */

import { NextRequest, NextResponse } from 'next/server';
import { deployManager } from '@/lib/services/deploy-manager';
import { runSkill } from '@/lib/services/skill-service';
import { deployToAliyunFC } from '@/lib/services/aliyun';
import { getProjectService } from '@/lib/services/project-services';

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { name } = await params;
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Skill name is required' },
        { status: 400 }
      );
    }

    const skillName = decodeURIComponent(name);
    const body = await request.json();
    const { target, config } = body as { target?: string; config?: any };

    if (!target || (target !== 'local' && target !== 'aliyun')) {
      return NextResponse.json(
        { success: false, error: 'target must be "local" or "aliyun"' },
        { status: 400 }
      );
    }

    if (target === 'local') {
      const action = (body as any).action;
      // "start" = just start the production process (no rebuild)
      // "deploy" or undefined = full deploy (install + build + start)
      if (action === 'start') {
        const result = await deployManager.start(skillName);
        return NextResponse.json({ success: true, data: result });
      }
      const result = await deployManager.deploy(skillName);
      return NextResponse.json({ success: true, data: result });
    }

    // target === 'aliyun'
    // Ensure project record exists before deploying to Aliyun FC
    const { projectId } = await runSkill(skillName);
    const aliyunConfig = {
      region: config?.region || 'cn-hangzhou',
      customDomain: config?.customDomain,
    };
    const result = await deployToAliyunFC(projectId, aliyunConfig);
    return NextResponse.json({
      success: true,
      data: {
        url: result.url,
        functionName: result.functionName,
        region: result.region,
      },
    });
  } catch (error) {
    console.error('[Skills Deploy API] POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { name } = await params;
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Skill name is required' },
        { status: 400 }
      );
    }

    const skillName = decodeURIComponent(name);

    // Local deploy status
    const local = deployManager.getStatus(skillName);

    // Cloud deploy status from projectServiceConnections
    const projectId = `skill-${skillName}`;
    let cloud: { deployed: boolean; url?: string; functionName?: string; region?: string; customDomain?: string; deployedAt?: string } = { deployed: false };

    try {
      const connection = await getProjectService(projectId, 'aliyun-fc');
      if (connection) {
        const serviceData = connection.serviceData as Record<string, any>;
        cloud = {
          deployed: true,
          url: serviceData.deployment_url,
          functionName: serviceData.function_name,
          region: serviceData.region,
          customDomain: serviceData.custom_domain,
          deployedAt: serviceData.deployed_at,
        };
      }
    } catch (err) {
      console.error('[Skills Deploy API] Error fetching cloud status:', err);
    }

    return NextResponse.json({
      success: true,
      data: { local, cloud },
    });
  } catch (error) {
    console.error('[Skills Deploy API] GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

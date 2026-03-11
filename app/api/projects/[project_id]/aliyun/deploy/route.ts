import { NextResponse } from 'next/server';
import { deployToAliyunFC } from '@/lib/services/aliyun';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

interface DeployRequestBody {
  customDomain?: string;
  region: string;
  isDemo?: boolean;
  deployedUrl?: string;
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const body: DeployRequestBody = await request.json();

    // 演示模式：跳过真实部署，直接返回预设 URL
    if (body.isDemo && body.deployedUrl) {
      console.log(`[API] Demo deploy mode for ${project_id}, returning: ${body.deployedUrl}`);

      // 模拟部署延迟
      await new Promise(resolve => setTimeout(resolve, 2000));

      return NextResponse.json({
        success: true,
        url: body.deployedUrl,
        deploymentUrl: body.deployedUrl,
        functionName: `demo-${project_id.slice(-8)}`,
        region: body.region || 'cn-hangzhou',
        isDemo: true,
      });
    }

    const result = await deployToAliyunFC(project_id, body);

    return NextResponse.json({
      success: true,
      url: result.url,
      deploymentUrl: result.url,
      functionName: result.functionName,
      region: result.region,
    });
  } catch (error) {
    console.error('[API] Failed to deploy to Aliyun FC:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to deploy to Aliyun FC',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for deployment

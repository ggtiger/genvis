/**
 * Get Aliyun FC deployment status
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { projectServiceConnections } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { project_id } = await params;

    const connection = await db
      .select()
      .from(projectServiceConnections)
      .where(
        and(
          eq(projectServiceConnections.projectId, project_id),
          eq(projectServiceConnections.provider, 'aliyun-fc')
        )
      )
      .limit(1);

    if (connection.length === 0) {
      return NextResponse.json({
        deployed: false,
      });
    }

    const serviceData = JSON.parse(connection[0].serviceData || '{}');

    return NextResponse.json({
      deployed: true,
      url: serviceData.deployment_url,
      functionName: serviceData.function_name,
      region: serviceData.region,
      customDomain: serviceData.custom_domain,
      deployedAt: serviceData.deployed_at,
    });
  } catch (error: any) {
    // JSON.parse 失败或其他错误
    if (error instanceof SyntaxError) {
      console.error('[Aliyun Status API] Invalid serviceData JSON:', error);
      return NextResponse.json({
        deployed: false,
      });
    }
    console.error('[Aliyun Status API Error]', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get deployment status' },
      { status: 500 }
    );
  }
}

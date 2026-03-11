import { NextResponse } from 'next/server';
import { prepareAliyunDependencies } from '@/lib/services/aliyun';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const body = await request.json();

    const result = await prepareAliyunDependencies(project_id, body);

    return NextResponse.json({
      success: true,
      packageCount: result.packageCount,
      message: result.message,
    });
  } catch (error) {
    console.error('[API] Failed to prepare Aliyun dependencies:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to prepare dependencies',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for dependency installation

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// GET /api/scheduled-tasks/:id/logs - 获取任务执行日志
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const logs = await prisma.taskExecutionLog.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json({ success: true, data: logs });
  } catch (error) {
    console.error('Failed to fetch task logs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}

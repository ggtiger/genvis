import { NextRequest, NextResponse } from 'next/server';
import { manualTriggerTask } from '@/lib/scheduler';

// POST /api/scheduled-tasks/:id/trigger - 手动执行一次任务
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await manualTriggerTask(id);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.error === '任务不存在' ? 404 : 500 }
      );
    }
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Failed to trigger task:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to trigger task' },
      { status: 500 }
    );
  }
}

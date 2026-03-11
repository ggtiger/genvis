import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// GET /api/scheduled-tasks - 获取定时任务列表
export async function GET() {
  try {
    const tasks = await prisma.scheduledTask.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, data: tasks });
  } catch (error) {
    console.error('Failed to fetch scheduled tasks:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch scheduled tasks' },
      { status: 500 }
    );
  }
}

// POST /api/scheduled-tasks - 创建定时任务
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, message, triggerTime, repeatType, cronExpression, enabled, notifyIM } = body;

    if (!name || !message) {
      return NextResponse.json(
        { success: false, error: 'name and message are required' },
        { status: 400 }
      );
    }

    // 计算 nextTriggerAt
    let nextTriggerAt: Date | null = null;
    if (repeatType === 'once' && triggerTime) {
      nextTriggerAt = new Date(triggerTime);
    } else if (triggerTime) {
      nextTriggerAt = new Date(triggerTime);
    }

    const task = await prisma.scheduledTask.create({
      data: {
        name,
        message,
        triggerTime: triggerTime ? new Date(triggerTime) : null,
        repeatType: repeatType || 'once',
        cronExpression: cronExpression || null,
        enabled: enabled !== false,
        notifyIM: notifyIM === true,
        nextTriggerAt,
      },
    });

    return NextResponse.json({ success: true, data: task }, { status: 201 });
  } catch (error) {
    console.error('Failed to create scheduled task:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create scheduled task' },
      { status: 500 }
    );
  }
}

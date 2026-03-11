import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// GET /api/scheduled-tasks/:id
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const task = await prisma.scheduledTask.findUnique({ where: { id } });
    if (!task) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: task });
  } catch (error) {
    console.error('Failed to fetch scheduled task:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch' }, { status: 500 });
  }
}

// PUT /api/scheduled-tasks/:id
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { name, message, triggerTime, repeatType, cronExpression, enabled, notifyIM, lastTriggeredAt, nextTriggerAt: bodyNextTriggerAt } = body;

    // nextTriggerAt 优先使用 body 直接传入的值（调度器用），其次从 triggerTime 推导
    let nextTriggerAt: Date | null | undefined;
    if (bodyNextTriggerAt !== undefined) {
      nextTriggerAt = bodyNextTriggerAt ? new Date(bodyNextTriggerAt) : null;
    } else if (triggerTime !== undefined) {
      nextTriggerAt = triggerTime ? new Date(triggerTime) : null;
    }

    const task = await prisma.scheduledTask.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(message !== undefined && { message }),
        ...(triggerTime !== undefined && { triggerTime: triggerTime ? new Date(triggerTime) : null }),
        ...(repeatType !== undefined && { repeatType }),
        ...(cronExpression !== undefined && { cronExpression }),
        ...(enabled !== undefined && { enabled }),
        ...(notifyIM !== undefined && { notifyIM }),
        ...(lastTriggeredAt !== undefined && { lastTriggeredAt: new Date(lastTriggeredAt) }),
        ...(nextTriggerAt !== undefined && { nextTriggerAt }),
        ...(lastTriggeredAt !== undefined && { triggerCount: { increment: 1 } }),
      },
    });

    return NextResponse.json({ success: true, data: task });
  } catch (error) {
    console.error('Failed to update scheduled task:', error);
    return NextResponse.json({ success: false, error: 'Failed to update' }, { status: 500 });
  }
}

// DELETE /api/scheduled-tasks/:id
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.scheduledTask.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete scheduled task:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/schedules/[id] - 获取单个日程
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const schedule = await prisma.schedule.findUnique({
      where: { id },
    });

    if (!schedule) {
      return NextResponse.json(
        { success: false, error: 'Schedule not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: schedule });
  } catch (error) {
    console.error('Failed to fetch schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch schedule' },
      { status: 500 }
    );
  }
}

// PUT /api/schedules/[id] - 更新日程
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, startTime, endTime, allDay, reminderMinutes, repeatType, color, reminderSent } = body;

    const schedule = await prisma.schedule.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(startTime !== undefined && { startTime: new Date(startTime) }),
        ...(endTime !== undefined && { endTime: endTime ? new Date(endTime) : null }),
        ...(allDay !== undefined && { allDay }),
        ...(reminderMinutes !== undefined && { reminderMinutes }),
        ...(repeatType !== undefined && { repeatType }),
        ...(color !== undefined && { color }),
        ...(reminderSent !== undefined && { reminderSent }),
      },
    });

    return NextResponse.json({ success: true, data: schedule });
  } catch (error) {
    console.error('Failed to update schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update schedule' },
      { status: 500 }
    );
  }
}

// DELETE /api/schedules/[id] - 删除日程
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await prisma.schedule.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: 'Schedule deleted' });
  } catch (error) {
    console.error('Failed to delete schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete schedule' },
      { status: 500 }
    );
  }
}

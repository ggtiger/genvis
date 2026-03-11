import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// GET /api/schedules - 获取日程列表
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const where: any = {};
    if (startDate && endDate) {
      where.startTime = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const schedules = await prisma.schedule.findMany({
      where,
      orderBy: { startTime: 'asc' },
    });

    return NextResponse.json({ success: true, data: schedules });
  } catch (error) {
    console.error('Failed to fetch schedules:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch schedules' },
      { status: 500 }
    );
  }
}

// POST /api/schedules - 创建日程
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, startTime, endTime, allDay, reminderMinutes, repeatType, color } = body;

    if (!title || !startTime) {
      return NextResponse.json(
        { success: false, error: 'Title and startTime are required' },
        { status: 400 }
      );
    }

    const schedule = await prisma.schedule.create({
      data: {
        title,
        description,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        allDay: allDay || false,
        reminderMinutes,
        repeatType,
        color,
      },
    });

    return NextResponse.json({ success: true, data: schedule }, { status: 201 });
  } catch (error) {
    console.error('Failed to create schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create schedule' },
      { status: 500 }
    );
  }
}

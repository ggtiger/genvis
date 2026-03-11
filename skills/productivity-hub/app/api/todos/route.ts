import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// GET /api/todos - 获取待办列表
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const dueBefore = searchParams.get('dueBefore');

    const where: any = {};
    if (status) {
      where.status = status;
    }
    if (priority) {
      where.priority = priority;
    }
    if (dueBefore) {
      where.dueDate = { lte: new Date(dueBefore) };
    }

    const todos = await prisma.todo.findMany({
      where,
      orderBy: [
        { status: 'asc' },
        { priority: 'desc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json({ success: true, data: todos });
  } catch (error) {
    console.error('Failed to fetch todos:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch todos' },
      { status: 500 }
    );
  }
}

// POST /api/todos - 创建待办
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, priority, status, dueDate } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, error: 'Title is required' },
        { status: 400 }
      );
    }

    const todo = await prisma.todo.create({
      data: {
        title,
        description,
        priority: priority || 'medium',
        status: status || 'pending',
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });

    return NextResponse.json({ success: true, data: todo }, { status: 201 });
  } catch (error) {
    console.error('Failed to create todo:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create todo' },
      { status: 500 }
    );
  }
}

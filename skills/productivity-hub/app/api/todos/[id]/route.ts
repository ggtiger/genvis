import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/todos/[id] - 获取单个待办
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const todo = await prisma.todo.findUnique({
      where: { id },
    });

    if (!todo) {
      return NextResponse.json(
        { success: false, error: 'Todo not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: todo });
  } catch (error) {
    console.error('Failed to fetch todo:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch todo' },
      { status: 500 }
    );
  }
}

// PUT /api/todos/[id] - 更新待办
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, priority, status, dueDate } = body;

    const updateData: any = {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(priority !== undefined && { priority }),
      ...(status !== undefined && { status }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
    };

    // 如果状态变为已完成，设置完成时间
    if (status === 'completed') {
      updateData.completedAt = new Date();
    } else if (status && status !== 'completed') {
      updateData.completedAt = null;
    }

    const todo = await prisma.todo.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true, data: todo });
  } catch (error) {
    console.error('Failed to update todo:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update todo' },
      { status: 500 }
    );
  }
}

// DELETE /api/todos/[id] - 删除待办
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await prisma.todo.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: 'Todo deleted' });
  } catch (error) {
    console.error('Failed to delete todo:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete todo' },
      { status: 500 }
    );
  }
}

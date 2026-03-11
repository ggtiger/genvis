import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/notes/[id] - 获取单个笔记
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const note = await prisma.note.findUnique({
      where: { id },
    });

    if (!note) {
      return NextResponse.json(
        { success: false, error: 'Note not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: note });
  } catch (error) {
    console.error('Failed to fetch note:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch note' },
      { status: 500 }
    );
  }
}

// PUT /api/notes/[id] - 更新笔记
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, content, tags, isPinned } = body;

    const note = await prisma.note.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(tags !== undefined && { tags: tags ? JSON.stringify(tags) : null }),
        ...(isPinned !== undefined && { isPinned }),
      },
    });

    return NextResponse.json({ success: true, data: note });
  } catch (error) {
    console.error('Failed to update note:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update note' },
      { status: 500 }
    );
  }
}

// DELETE /api/notes/[id] - 删除笔记
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await prisma.note.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: 'Note deleted' });
  } catch (error) {
    console.error('Failed to delete note:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete note' },
      { status: 500 }
    );
  }
}

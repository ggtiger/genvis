import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// GET /api/notes - 获取笔记列表
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const tag = searchParams.get('tag');
    const pinned = searchParams.get('pinned');

    const where: any = {};
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { content: { contains: search } },
      ];
    }
    if (tag) {
      where.tags = { contains: tag };
    }
    if (pinned === 'true') {
      where.isPinned = true;
    }

    const notes = await prisma.note.findMany({
      where,
      orderBy: [
        { isPinned: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    return NextResponse.json({ success: true, data: notes });
  } catch (error) {
    console.error('Failed to fetch notes:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch notes' },
      { status: 500 }
    );
  }
}

// POST /api/notes - 创建笔记
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, content, tags, isPinned } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, error: 'Title is required' },
        { status: 400 }
      );
    }

    const note = await prisma.note.create({
      data: {
        title,
        content: content || '',
        tags: tags ? JSON.stringify(tags) : null,
        isPinned: isPinned || false,
      },
    });

    return NextResponse.json({ success: true, data: note }, { status: 201 });
  } catch (error) {
    console.error('Failed to create note:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create note' },
      { status: 500 }
    );
  }
}

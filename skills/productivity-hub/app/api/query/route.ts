import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// 意图识别关键词
const INTENT_KEYWORDS = {
  schedule: ['日程', '安排', '会议', '什么时候', '几点', '今天', '明天', '这周', '下周'],
  note: ['笔记', '记录', '备忘', '写过', '关于'],
  todo: ['待办', '任务', '要做', '完成', '没完成', '还有', '剩余'],
};

// 操作意图关键词
const ACTION_KEYWORDS = {
  delete: ['删除', '删掉', '去掉', '移除', '取消'],
  complete: ['完成', '标记完成', '设为完成', '搞定'],
  create: ['创建', '新建', '添加', '增加', '加一个'],
  update: ['修改', '更新', '改一下', '编辑'],
};

// 识别操作意图
function detectAction(query: string): 'delete' | 'complete' | 'create' | 'update' | 'query' {
  for (const [action, keywords] of Object.entries(ACTION_KEYWORDS)) {
    if (keywords.some((keyword) => query.includes(keyword))) {
      return action as 'delete' | 'complete' | 'create' | 'update';
    }
  }
  return 'query';
}

// 时间解析
function parseTimeIntent(query: string): { start: Date; end: Date } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (query.includes('今天')) {
    return {
      start: today,
      end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1),
    };
  }
  if (query.includes('明天')) {
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return {
      start: tomorrow,
      end: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000 - 1),
    };
  }
  if (query.includes('这周') || query.includes('本周')) {
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(today.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
    const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    return { start: startOfWeek, end: endOfWeek };
  }
  if (query.includes('下周')) {
    const dayOfWeek = now.getDay();
    const startOfNextWeek = new Date(today.getTime() + (7 - dayOfWeek) * 24 * 60 * 60 * 1000);
    const endOfNextWeek = new Date(startOfNextWeek.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    return { start: startOfNextWeek, end: endOfNextWeek };
  }
  return null;
}

// 识别意图
function detectIntent(query: string): 'schedule' | 'note' | 'todo' | 'general' {
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (keywords.some((keyword) => query.includes(keyword))) {
      return intent as 'schedule' | 'note' | 'todo';
    }
  }
  return 'general';
}

// 格式化日程响应
function formatScheduleResponse(schedules: any[], timeRange?: { start: Date; end: Date }): string {
  if (schedules.length === 0) {
    return timeRange ? '这个时间段没有日程安排。' : '目前没有日程安排。';
  }

  let response = timeRange
    ? `找到 ${schedules.length} 个日程安排：\n\n`
    : `共有 ${schedules.length} 个日程：\n\n`;

  schedules.forEach((schedule, index) => {
    const startTime = new Date(schedule.startTime);
    const timeStr = schedule.allDay
      ? '全天'
      : startTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = startTime.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

    response += `${index + 1}. ${schedule.title}\n`;
    response += `   时间: ${dateStr} ${timeStr}\n`;
    if (schedule.description) {
      response += `   描述: ${schedule.description}\n`;
    }
    response += '\n';
  });

  return response.trim();
}

// 格式化笔记响应
function formatNoteResponse(notes: any[], searchKeyword?: string): string {
  if (notes.length === 0) {
    return searchKeyword ? `没有找到关于"${searchKeyword}"的笔记。` : '目前没有笔记。';
  }

  let response = searchKeyword
    ? `找到 ${notes.length} 篇相关笔记：\n\n`
    : `共有 ${notes.length} 篇笔记：\n\n`;

  notes.slice(0, 5).forEach((note, index) => {
    const updateTime = new Date(note.updatedAt).toLocaleDateString('zh-CN');
    const preview = note.content.length > 50 ? note.content.slice(0, 50) + '...' : note.content;

    response += `${index + 1}. ${note.isPinned ? '📌 ' : ''}${note.title}\n`;
    response += `   更新于: ${updateTime}\n`;
    response += `   预览: ${preview}\n\n`;
  });

  if (notes.length > 5) {
    response += `... 还有 ${notes.length - 5} 篇笔记\n`;
  }

  return response.trim();
}

// 格式化待办响应
function formatTodoResponse(todos: any[], filterCompleted: boolean = false): string {
  const filtered = filterCompleted
    ? todos.filter((t) => t.status !== 'completed')
    : todos;

  if (filtered.length === 0) {
    return filterCompleted ? '太棒了！所有任务都已完成。' : '目前没有待办事项。';
  }

  const pending = filtered.filter((t) => t.status === 'pending');
  const inProgress = filtered.filter((t) => t.status === 'in_progress');
  const completed = filterCompleted ? [] : filtered.filter((t) => t.status === 'completed');

  let response = '';

  if (filterCompleted) {
    response = `还有 ${filtered.length} 个待完成的任务：\n\n`;
  } else {
    response = `待办统计: ${pending.length} 待办, ${inProgress.length} 进行中, ${completed.length} 已完成\n\n`;
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  filtered
    .sort((a, b) => (priorityOrder[a.priority as keyof typeof priorityOrder] || 1) - (priorityOrder[b.priority as keyof typeof priorityOrder] || 1))
    .slice(0, 10)
    .forEach((todo, index) => {
      const statusIcon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⬜';
      const priorityIcon = todo.priority === 'high' ? '🔴' : todo.priority === 'medium' ? '🟡' : '🟢';

      response += `${statusIcon} ${todo.title} ${priorityIcon}\n`;
      if (todo.dueDate) {
        const dueDate = new Date(todo.dueDate).toLocaleDateString('zh-CN');
        response += `   截止: ${dueDate}\n`;
      }
    });

  return response.trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Query is required' },
        { status: 400 }
      );
    }

    const intent = detectIntent(query);
    let response = '';

    switch (intent) {
      case 'schedule': {
        const timeRange = parseTimeIntent(query);
        const where: any = {};
        if (timeRange) {
          where.startTime = {
            gte: timeRange.start,
            lte: timeRange.end,
          };
        }
        const schedules = await prisma.schedule.findMany({
          where,
          orderBy: { startTime: 'asc' },
          take: 20,
        });
        response = formatScheduleResponse(schedules, timeRange ?? undefined);
        break;
      }

      case 'note': {
        // 提取可能的搜索关键词
        const searchMatch = query.match(/关于(.+?)的/);
        const searchKeyword = searchMatch ? searchMatch[1].trim() : undefined;

        const where: any = {};
        if (searchKeyword) {
          where.OR = [
            { title: { contains: searchKeyword } },
            { content: { contains: searchKeyword } },
          ];
        }

        const notes = await prisma.note.findMany({
          where,
          orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
          take: 20,
        });
        response = formatNoteResponse(notes, searchKeyword);
        break;
      }

      case 'todo': {
        const action = detectAction(query);
        
        // 处理删除操作
        if (action === 'delete') {
          // 提取要删除的待办关键词（如“删除去北京的待办”中的“去北京”）
          const deleteMatch = query.match(/删除|删掉|去掉|移除|取消/);
          if (deleteMatch) {
            const keyword = query.replace(/删除|删掉|去掉|移除|取消|的?待办|任务/g, '').trim();
            if (keyword) {
              // 查找匹配的待办
              const matchingTodos = await prisma.todo.findMany({
                where: {
                  title: { contains: keyword },
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
              });
              
              if (matchingTodos.length === 0) {
                response = `没有找到包含“${keyword}”的待办。`;
              } else if (matchingTodos.length === 1) {
                // 只有一个匹配，直接删除
                await prisma.todo.delete({ where: { id: matchingTodos[0].id } });
                response = `已删除待办：${matchingTodos[0].title}`;
              } else {
                // 多个匹配，删除最近创建的那个
                await prisma.todo.delete({ where: { id: matchingTodos[0].id } });
                response = `已删除待办：${matchingTodos[0].title}\n（共找到 ${matchingTodos.length} 个匹配，已删除最近创建的那个）`;
              }
              break;
            }
          }
        }
        
        // 处理完成操作
        if (action === 'complete') {
          const completeMatch = query.match(/完成|标记完成|设为完成|搞定/);
          if (completeMatch) {
            const keyword = query.replace(/完成|标记完成|设为完成|搞定|的?待办|任务/g, '').trim();
            if (keyword) {
              const matchingTodos = await prisma.todo.findMany({
                where: {
                  title: { contains: keyword },
                  status: { not: 'completed' },
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
              });
              
              if (matchingTodos.length === 0) {
                response = `没有找到包含“${keyword}”的未完成待办。`;
              } else if (matchingTodos.length === 1) {
                await prisma.todo.update({
                  where: { id: matchingTodos[0].id },
                  data: { status: 'completed', completedAt: new Date() },
                });
                response = `已完成待办：${matchingTodos[0].title}`;
              } else {
                await prisma.todo.update({
                  where: { id: matchingTodos[0].id },
                  data: { status: 'completed', completedAt: new Date() },
                });
                response = `已完成待办：${matchingTodos[0].title}\n（共找到 ${matchingTodos.length} 个匹配，已完成最近创建的那个）`;
              }
              break;
            }
          }
        }
        
        // 默认查询逻辑
        const filterCompleted =
          query.includes('没完成') ||
          query.includes('还有') ||
          query.includes('剩余') ||
          query.includes('要做');

        const todos = await prisma.todo.findMany({
          orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
          take: 50,
        });
        response = formatTodoResponse(todos, filterCompleted);
        break;
      }

      default: {
        // 综合查询
        const [schedules, notes, todos] = await Promise.all([
          prisma.schedule.findMany({
            where: {
              startTime: {
                gte: new Date(),
              },
            },
            orderBy: { startTime: 'asc' },
            take: 5,
          }),
          prisma.note.findMany({
            orderBy: { updatedAt: 'desc' },
            take: 3,
          }),
          prisma.todo.findMany({
            where: { status: { not: 'completed' } },
            orderBy: { priority: 'desc' },
            take: 5,
          }),
        ]);

        response = '这是你的效率概览:\n\n';
        response += `📅 即将到来的日程 (${schedules.length}):\n`;
        schedules.forEach((s: { title: string; startTime: Date }) => {
          const date = new Date(s.startTime).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
          response += `  - ${s.title} (${date})\n`;
        });

        response += `\n📝 最近笔记 (${notes.length}):\n`;
        notes.forEach((n: { title: string }) => {
          response += `  - ${n.title}\n`;
        });

        response += `\n✅ 待完成任务 (${todos.length}):\n`;
        todos.forEach((t: { title: string; priority: string }) => {
          const priority = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
          response += `  - ${t.title} ${priority}\n`;
        });
      }
    }

    return NextResponse.json({
      success: true,
      response,
      intent,
    });
  } catch (error) {
    console.error('Query failed:', error);
    return NextResponse.json(
      { success: false, error: 'Query failed' },
      { status: 500 }
    );
  }
}

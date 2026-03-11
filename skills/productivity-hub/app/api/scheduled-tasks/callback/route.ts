import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

/**
 * POST /api/scheduled-tasks/callback
 *
 * 接收主应用 dispatch-tracker 的任务完成回调。
 * 当定时任务触发秘书 dispatch 给员工后，员工完成任务时主应用会回调此端点。
 *
 * 请求体（来自 skill-channel pushToSkillCallback）：
 * {
 *   type: 'task_completed',
 *   projectId: string,
 *   content: string,          // 员工执行结果
 *   resultFiles?: Array<{ name: string; url: string }>,
 *   callbackPayload?: { logId: string; taskId: string },
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, callbackPayload } = body;

    const logId = callbackPayload?.logId;
    const taskId = callbackPayload?.taskId;

    if (!logId) {
      console.warn('[Callback] 缺少 logId，忽略回调');
      return NextResponse.json({ success: false, error: 'missing logId' }, { status: 400 });
    }

    console.log(`[Callback] 收到任务完成回调: logId=${logId}, taskId=${taskId}`);
    console.log(`[Callback] 结果内容 (前200字): ${(content || '').substring(0, 200)}`);

    // 更新执行日志：追加 dispatch 结果
    const log = await prisma.taskExecutionLog.findUnique({ where: { id: logId } });
    if (!log) {
      console.warn(`[Callback] 日志不存在: ${logId}`);
      return NextResponse.json({ success: false, error: 'log not found' }, { status: 404 });
    }

    // 将 dispatch 结果追加到 secretaryReply
    const existingReply = log.secretaryReply || '';
    const dispatchResult = content || '(无结果内容)';
    const updatedReply = existingReply
      ? `${existingReply}\n\n--- 员工执行结果 ---\n${dispatchResult}`
      : dispatchResult;

    await prisma.taskExecutionLog.update({
      where: { id: logId },
      data: {
        secretaryReply: updatedReply,
        // 如果之前是 success（秘书回复了"已派发"），保持 success
        // 如果之前是 pending，更新为 success
        status: log.status === 'failed' ? 'failed' : 'success',
      },
    });

    // 如果任务开启了 IM 通知，推送 dispatch 结果到 IM
    if (taskId) {
      try {
        const task = await prisma.scheduledTask.findUnique({ where: { id: taskId } });
        if (task?.notifyIM) {
          const baseUrl = process.env.MAIN_APP_URL || process.env.GOODABLE_API_BASE || `http://localhost:${process.env.MAIN_APP_PORT || 3000}`;
          const imContent = `📋 定时任务「${task.name}」的员工执行结果：\n\n${dispatchResult}`;
          await fetch(`${baseUrl}/api/skill-channel/im-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: imContent, skillName: 'productivity-hub' }),
          }).catch(err => console.warn('[Callback] IM push 失败:', err));
        }
      } catch (err) {
        console.warn('[Callback] 查询任务或推送 IM 失败:', err);
      }
    }

    console.log(`[Callback] ✅ 日志已更新: ${logId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Callback] 处理回调失败:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process callback' },
      { status: 500 }
    );
  }
}

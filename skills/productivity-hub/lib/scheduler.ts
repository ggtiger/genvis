/**
 * Skill 内部定时任务调度器
 *
 * 在 skill 进程内自行轮询到期任务并执行，完全解耦主应用。
 * 流程：
 * 1. 轮询 DB 中到期的 ScheduledTask
 * 2. 通过 /api/skill-channel/send 发消息给秘书
 * 3. 收到秘书回复后，如果 notifyIM=true，通过 /api/skill-channel/im-push 发给钉钉等
 * 4. 记录执行日志到 TaskExecutionLog
 * 5. 更新任务的 nextTriggerAt / triggerCount
 */

import prisma from './db';

const POLL_INTERVAL = 30_000; // 30 秒
const SKILL_NAME = 'productivity-hub';

/** 主应用的 base URL */
function getMainAppUrl(): string {
  return process.env.MAIN_APP_URL || process.env.GOODABLE_API_BASE || `http://localhost:${process.env.MAIN_APP_PORT || 3000}`;
}

/** 本 skill 自身的 base URL（用于构造 callbackUrl） */
function getSelfUrl(): string {
  const port = process.env.PORT || '3001';
  return `http://localhost:${port}`;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
const processingTasks = new Set<string>();

export function startScheduler() {
  if (running) return;
  running = true;
  console.log('[Scheduler] 启动内部定时任务调度器');
  checkDueTasks().catch(console.warn);
  timer = setInterval(() => {
    checkDueTasks().catch(console.warn);
  }, POLL_INTERVAL);
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
  console.log('[Scheduler] 停止调度器');
}

export function isSchedulerRunning() { return running; }

async function checkDueTasks() {
  const now = new Date();
  try {
    const tasks = await prisma.scheduledTask.findMany({
      where: {
        enabled: true,
        nextTriggerAt: { lte: now },
      },
    });

    for (const task of tasks) {
      if (processingTasks.has(task.id)) continue;
      processingTasks.add(task.id);
      triggerTask(task).finally(() => processingTasks.delete(task.id));
    }
  } catch (err) {
    // DB 可能还没 ready，静默
  }
}

async function triggerTask(task: {
  id: string; name: string; message: string;
  repeatType: string; notifyIM: boolean;
  nextTriggerAt: Date | null;
}) {
  const startTime = Date.now();
  console.log(`[Scheduler] 触发: ${task.name} -> "${task.message.slice(0, 80)}"`);

  // 创建日志记录
  const log = await prisma.taskExecutionLog.create({
    data: { taskId: task.id, status: 'pending' },
  });

  let secretaryReply: string | null = null;
  let imPushResult: string | null = null;
  let error: string | null = null;

  try {
    // 1. 发送给秘书（带 callbackUrl，dispatch 完成后主应用会回调）
    const baseUrl = getMainAppUrl();
    const selfUrl = getSelfUrl();
    const callbackUrl = `${selfUrl}/api/scheduled-tasks/callback`;

    const sendRes = await fetch(`${baseUrl}/api/skill-channel/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillName: SKILL_NAME,
        message: `[定时任务 - ${task.name}] ${task.message}`,
        callbackUrl,
        callbackPayload: { logId: log.id, taskId: task.id },
      }),
    });

    if (sendRes.ok) {
      const data = await sendRes.json();
      secretaryReply = data.data?.reply || data.reply || null;
      console.log(`[Scheduler] 秘书回复: ${(secretaryReply || '').slice(0, 100)}`);
    } else {
      error = `秘书 API 返回 ${sendRes.status}`;
    }

    // 2. 如果开启 IM 通知，推送即时回复到钉钉等（dispatch 结果会由回调端点推送）
    if (task.notifyIM) {
      const imContent = secretaryReply
        ? `⏰ 定时任务「${task.name}」执行结果：\n\n${secretaryReply}`
        : `⏰ 定时任务「${task.name}」已触发：\n${task.message}`;

      try {
        const imRes = await fetch(`${baseUrl}/api/skill-channel/im-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: imContent,
            skillName: SKILL_NAME,
          }),
        });
        if (imRes.ok) {
          const imData = await imRes.json();
          imPushResult = JSON.stringify(imData.data || imData);
        } else {
          imPushResult = JSON.stringify({ error: `IM push 返回 ${imRes.status}` });
        }
      } catch (imErr) {
        imPushResult = JSON.stringify({ error: String(imErr) });
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[Scheduler] 执行失败: ${task.name}`, error);
  }

  // 3. 更新日志
  const durationMs = Date.now() - startTime;
  await prisma.taskExecutionLog.update({
    where: { id: log.id },
    data: {
      status: error ? 'failed' : 'success',
      secretaryReply,
      imPushResult,
      error,
      durationMs,
    },
  });

  // 4. 更新任务状态
  await updateTaskAfterTrigger(task);
}

async function updateTaskAfterTrigger(task: {
  id: string; repeatType: string; nextTriggerAt: Date | null;
}) {
  const now = new Date();
  let nextTriggerAt: Date | null = null;

  if (task.repeatType === 'daily') {
    const next = new Date(task.nextTriggerAt || now);
    next.setDate(next.getDate() + 1);
    if (next <= now) { next.setTime(now.getTime()); next.setDate(next.getDate() + 1); }
    nextTriggerAt = next;
  } else if (task.repeatType === 'weekly') {
    const next = new Date(task.nextTriggerAt || now);
    next.setDate(next.getDate() + 7);
    if (next <= now) { next.setTime(now.getTime()); next.setDate(next.getDate() + 7); }
    nextTriggerAt = next;
  } else if (task.repeatType === 'monthly') {
    const next = new Date(task.nextTriggerAt || now);
    next.setMonth(next.getMonth() + 1);
    if (next <= now) { next.setTime(now.getTime()); next.setMonth(next.getMonth() + 1); }
    nextTriggerAt = next;
  }
  // once: nextTriggerAt = null，任务自动停止

  await prisma.scheduledTask.update({
    where: { id: task.id },
    data: {
      lastTriggeredAt: now,
      nextTriggerAt,
      enabled: task.repeatType !== 'once',
      triggerCount: { increment: 1 },
    },
  });
}

/**
 * 手动触发一次任务（不影响 nextTriggerAt / enabled 状态）
 */
export async function manualTriggerTask(taskId: string): Promise<{
  success: boolean;
  logId?: string;
  secretaryReply?: string | null;
  error?: string;
}> {
  const task = await prisma.scheduledTask.findUnique({ where: { id: taskId } });
  if (!task) return { success: false, error: '任务不存在' };

  const startTime = Date.now();
  console.log(`[Scheduler] 手动触发: ${task.name}`);

  const log = await prisma.taskExecutionLog.create({
    data: { taskId: task.id, status: 'pending' },
  });

  let secretaryReply: string | null = null;
  let imPushResult: string | null = null;
  let error: string | null = null;

  try {
    const baseUrl = getMainAppUrl();
    const selfUrl = getSelfUrl();
    const callbackUrl = `${selfUrl}/api/scheduled-tasks/callback`;

    const sendRes = await fetch(`${baseUrl}/api/skill-channel/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillName: SKILL_NAME,
        message: `[手动执行 - ${task.name}] ${task.message}`,
        callbackUrl,
        callbackPayload: { logId: log.id, taskId: task.id },
      }),
    });

    if (sendRes.ok) {
      const data = await sendRes.json();
      secretaryReply = data.data?.reply || data.reply || null;
    } else {
      error = `秘书 API 返回 ${sendRes.status}`;
    }

    if (task.notifyIM) {
      const imContent = secretaryReply
        ? `🔧 手动执行「${task.name}」结果：\n\n${secretaryReply}`
        : `🔧 手动执行「${task.name}」已触发：\n${task.message}`;
      try {
        const imRes = await fetch(`${baseUrl}/api/skill-channel/im-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: imContent, skillName: SKILL_NAME }),
        });
        if (imRes.ok) {
          const imData = await imRes.json();
          imPushResult = JSON.stringify(imData.data || imData);
        }
      } catch (imErr) {
        imPushResult = JSON.stringify({ error: String(imErr) });
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - startTime;
  await prisma.taskExecutionLog.update({
    where: { id: log.id },
    data: {
      status: error ? 'failed' : 'success',
      secretaryReply,
      imPushResult,
      error,
      durationMs,
    },
  });

  // 手动执行只增加 triggerCount，不改变 nextTriggerAt 和 enabled
  await prisma.scheduledTask.update({
    where: { id: task.id },
    data: { triggerCount: { increment: 1 } },
  });

  return { success: !error, logId: log.id, secretaryReply, error: error || undefined };
}


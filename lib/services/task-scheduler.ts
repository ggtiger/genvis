/**
 * Task Scheduler Service
 *
 * @deprecated 定时任务调度已迁移到 productivity-hub skill 内部（lib/scheduler.ts）。
 * Skill 通过 /api/skill-channel/send 和 /api/skill-channel/im-push 与主应用通信，
 * 不再需要主应用外部轮询。此文件保留用于向后兼容，后续版本将移除。
 *
 * 原功能：后台轮询 productivity-hub 的定时任务，到期时自动发送消息给秘书。
 * 通过 SecretaryStream SSE 推送通知前端，同时写入秘书会话历史。
 * 支持将秘书的执行结果转发到已连接的 IM 渠道（钉钉/飞书等）。
 *
 * 集成方式：在 secretary SSE stream 连接时启动，类似 MemoryScheduler。
 */

import {
  loadSession,
  saveSession,
  type SecretaryMessage,
} from './secretary-session';
import type { SecretaryStreamManager } from './secretary-stream';

const POLL_INTERVAL = 30_000; // 30 秒轮询一次
const SKILL_NAME = 'productivity-hub';

interface ScheduledTask {
  id: string;
  name: string;
  message: string;
  triggerTime: string | null;
  repeatType: string;
  enabled: boolean;
  notifyIM: boolean;
  lastTriggeredAt: string | null;
  nextTriggerAt: string | null;
  triggerCount: number;
}

/** 动态获取 secretaryStream 单例 */
function getSecretaryStream(): SecretaryStreamManager {
  const g = globalThis as unknown as { __secretary_stream_mgr__?: SecretaryStreamManager };
  if (g.__secretary_stream_mgr__) return g.__secretary_stream_mgr__;
  const { secretaryStream } = require('./secretary-stream');
  return secretaryStream;
}

/** 获取 skill 的运行端口 */
async function getSkillPort(): Promise<number | null> {
  try {
    const { deployManager } = await import('./deploy-manager');
    const status = deployManager.getStatus(SKILL_NAME);
    if (status?.status === 'deployed' && status.port) {
      return status.port;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * 将消息发送到所有已连接的 IM 渠道（钉钉/飞书/企微等）
 */
async function sendToConnectedIM(content: string): Promise<void> {
  try {
    const { connectionManager } = await import('./im/connection-manager');
    const { loadGlobalSettings } = await import('./settings');
    const { formatReplyForPlatform, splitMessage } = await import('./im/im-formatter');

    const statuses = connectionManager.getStatus();
    const connectedPlatforms = statuses.filter(s => s.connectionStatus === 'connected');

    if (connectedPlatforms.length === 0) {
      console.log('[TaskScheduler] 没有已连接的 IM 渠道，跳过 IM 通知');
      return;
    }

    const settings = await loadGlobalSettings();

    for (const platformStatus of connectedPlatforms) {
      const platform = platformStatus.platform;
      const config = settings.im_channels?.[platform];
      if (!config?.enabled) continue;

      try {
        const { getStreamAdapter } = await import('./im/adapter-factory');
        const adapter = await getStreamAdapter(platform);

        const formatted = formatReplyForPlatform(content, platform);
        const chunks = splitMessage(formatted, platform);

        for (const chunk of chunks) {
          await adapter.sendReply({
            platform,
            conversationId: '',
            senderId: '',
            content: chunk,
            rawPayload: {},
          }, config);
        }

        console.log(`[TaskScheduler] IM 通知已发送到 ${platform}`);
      } catch (err) {
        console.warn(`[TaskScheduler] 发送 IM 通知到 ${platform} 失败:`, err);
      }
    }
  } catch (err) {
    console.warn('[TaskScheduler] IM 通知发送失败:', err);
  }
}

export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;
  /** 正在处理中的任务 ID 集合，防止重复触发 */
  private processingTasks = new Set<string>();

  get isRunning() { return this._isRunning; }

  async start(): Promise<void> {
    if (this._isRunning) return;
    this._isRunning = true;
    console.log('[TaskScheduler] 启动定时任务调度器');

    // 立即检查一次
    await this.checkDueTasks();

    this.timer = setInterval(() => {
      this.checkDueTasks().catch(err =>
        console.warn('[TaskScheduler] 检查定时任务失败:', err)
      );
    }, POLL_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this._isRunning = false;
    console.log('[TaskScheduler] 停止定时任务调度器');
  }

  private async checkDueTasks(): Promise<void> {
    const port = await getSkillPort();
    if (!port) return; // skill 未运行

    try {
      const res = await fetch(`http://localhost:${port}/api/scheduled-tasks`);
      if (!res.ok) return;

      const json = await res.json();
      const tasks: ScheduledTask[] = json.data || [];
      const now = new Date();

      for (const task of tasks) {
        if (!task.enabled || !task.nextTriggerAt) continue;
        if (this.processingTasks.has(task.id)) continue; // 正在处理中，跳过

        const triggerAt = new Date(task.nextTriggerAt);
        if (triggerAt > now) continue;

        // 立即标记为处理中，防止下一轮轮询重复触发
        this.processingTasks.add(task.id);

        // 任务到期，发送消息给秘书
        this.triggerTask(task, port).finally(() => {
          this.processingTasks.delete(task.id);
        });
      }
    } catch (err) {
      // skill 可能未启动，静默忽略
    }
  }

  private async triggerTask(task: ScheduledTask, port: number): Promise<void> {
    console.log(`[TaskScheduler] 触发定时任务: ${task.name} -> "${task.message}"`);

    let secretaryReply: string | null = null;

    // 1. 发送消息到秘书聊天（模拟用户发送）
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE || '';
      const baseUrl = apiBase || `http://localhost:${process.env.PORT || 3000}`;

      const secretaryRes = await fetch(`${baseUrl}/api/chat/home/secretary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[定时任务 - ${task.name}] ${task.message}`,
        }),
      });

      if (secretaryRes.ok) {
        const resData = await secretaryRes.json();
        secretaryReply = resData.reply || null;
        console.log(`[TaskScheduler] 消息已发送给秘书: ${task.name}`);
      } else {
        // 如果秘书 API 调用失败，直接写入会话
        await this.appendToSession(task);
      }
    } catch {
      // fallback: 直接写入会话
      await this.appendToSession(task);
    }

    // 2. 如果开启了 IM 通知，将秘书的回复转发到已连接的 IM
    if (task.notifyIM) {
      const imContent = secretaryReply
        ? `⏰ 定时任务「${task.name}」执行结果：\n\n${secretaryReply}`
        : `⏰ 定时任务「${task.name}」已触发：\n${task.message}`;
      await sendToConnectedIM(imContent);
    }

    // 3. 通过 SSE 通知前端
    const stream = getSecretaryStream();
    stream.publish({
      type: 'dashboard_refresh',
      data: {
        reason: 'scheduled_task_triggered',
        taskId: task.id,
        taskName: task.name,
      },
    });

    // 4. 更新任务状态
    await this.updateTaskAfterTrigger(task, port);
  }

  private async appendToSession(task: ScheduledTask): Promise<void> {
    try {
      const session = await loadSession();
      const userMsg: SecretaryMessage = {
        role: 'user',
        content: `[定时任务 - ${task.name}] ${task.message}`,
        timestamp: new Date().toISOString(),
        source: 'web',
      };
      const assistantMsg: SecretaryMessage = {
        role: 'assistant',
        content: `⏰ 定时任务「${task.name}」已触发，正在处理您的请求...`,
        timestamp: new Date().toISOString(),
        source: 'web',
      };
      session.messages.push(userMsg, assistantMsg);
      await saveSession(session);
    } catch (err) {
      console.warn('[TaskScheduler] 写入会话失败:', err);
    }
  }

  private async updateTaskAfterTrigger(task: ScheduledTask, port: number): Promise<void> {
    try {
      const now = new Date();
      let nextTriggerAt: string | null = null;

      // 根据重复类型计算下次触发时间
      if (task.repeatType === 'daily') {
        const next = new Date(task.nextTriggerAt!);
        next.setDate(next.getDate() + 1);
        if (next <= now) {
          next.setTime(now.getTime());
          next.setDate(next.getDate() + 1);
        }
        nextTriggerAt = next.toISOString();
      } else if (task.repeatType === 'weekly') {
        const next = new Date(task.nextTriggerAt!);
        next.setDate(next.getDate() + 7);
        if (next <= now) {
          next.setTime(now.getTime());
          next.setDate(next.getDate() + 7);
        }
        nextTriggerAt = next.toISOString();
      } else if (task.repeatType === 'monthly') {
        const next = new Date(task.nextTriggerAt!);
        next.setMonth(next.getMonth() + 1);
        if (next <= now) {
          next.setTime(now.getTime());
          next.setMonth(next.getMonth() + 1);
        }
        nextTriggerAt = next.toISOString();
      }
      // once 类型不设置 nextTriggerAt，任务自动停止

      await fetch(`http://localhost:${port}/api/scheduled-tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lastTriggeredAt: now.toISOString(),
          nextTriggerAt,
          enabled: task.repeatType !== 'once', // 一次性任务触发后禁用
        }),
      });
      console.log(`[TaskScheduler] 任务状态已更新: ${task.name}, nextTriggerAt=${nextTriggerAt || '(disabled)'}`);
    } catch (err) {
      console.warn('[TaskScheduler] 更新任务状态失败:', err);
    }
  }
}

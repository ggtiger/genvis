/**
 * Dispatch Result Tracker
 *
 * 后台轮询已分配的任务状态，当任务完成/失败时：
 * 1. 将结果消息写入秘书主会话（网页端轮询自动获取）
 * 2. 如果任务来源是 IM 渠道，通过 IM 回推结果给用户
 *
 * 交互式反馈支持：
 * 3. 检测 waiting_feedback 状态，通知 IM 用户切换会话
 * 4. 管理 ConversationContext 和 PendingQueue
 */

import { loadSession, saveSession, type SecretaryMessage, type SecretaryAttachment, type MessageSource } from './secretary-session';
import type { SecretaryStreamManager } from './secretary-stream';

/** 动态获取 secretaryStream 单例，避免 HMR 导致引用过期 */
function getSecretaryStream(): SecretaryStreamManager {
  const g = globalThis as unknown as { __secretary_stream_mgr__?: SecretaryStreamManager };
  if (g.__secretary_stream_mgr__) return g.__secretary_stream_mgr__;
  // fallback: 通过 import 获取（会触发模块初始化）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { secretaryStream } = require('./secretary-stream');
  return secretaryStream;
}

const POLL_INTERVAL = 20_000; // 20 秒轮询一次（降低 CPU）
const FEEDBACK_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟超时

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

/**
 * 从结果文本中提取提到的文件路径，然后在项目 assets 目录和项目根目录中查找对应文件。
 * 区分图片和非图片文件，返回可用于 SecretaryMessage 的 images 和 attachments。
 */
async function scanProjectOutputFiles(projectId: string, resultText?: string): Promise<{
  images: string[];
  attachments: SecretaryAttachment[];
}> {
  const images: string[] = [];
  const attachments: SecretaryAttachment[] = [];

  try {
    const { PROJECTS_DIR_ABSOLUTE } = await import('@/lib/config/paths');
    const fs = await import('fs/promises');
    const pathMod = await import('path');
    const projectDir = pathMod.default.join(PROJECTS_DIR_ABSOLUTE, projectId);
    const assetsDir = pathMod.default.join(projectDir, 'assets');

    // 从结果文本中提取提到的文件名
    const mentionedFiles = new Set<string>();
    if (resultText) {
      // 匹配 assets/filename 模式
      const assetPathRegex = /(?:assets\/)([\w.\-]+\.\w+)/g;
      let match;
      while ((match = assetPathRegex.exec(resultText)) !== null) {
        mentionedFiles.add(match[1]);
      }
      // 匹配 backtick 包裹的文件名
      const backtickRegex = /`([\w.\-]+\.(?:png|jpg|jpeg|gif|webp|svg|pdf|zip|tar|gz|txt|csv|json|html|md|docx|xlsx))`/gi;
      while ((match = backtickRegex.exec(resultText)) !== null) {
        mentionedFiles.add(match[1]);
      }
    }

    // 扫描 assets 目录
    let assetFiles: string[] = [];
    try {
      assetFiles = await fs.readdir(assetsDir);
    } catch { /* assets dir may not exist */ }

    const filesToShow = mentionedFiles.size > 0
      ? assetFiles.filter(f => mentionedFiles.has(f))
      : assetFiles;

    const apiBase = process.env.NEXT_PUBLIC_API_BASE || '';
    const seen = new Set<string>();

    for (const file of filesToShow) {
      const ext = pathMod.default.extname(file).toLowerCase();
      const filePath = pathMod.default.join(assetsDir, file);
      let stat;
      try {
        stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
      } catch { continue; }

      seen.add(file);
      const url = `${apiBase}/api/assets/${projectId}/${encodeURIComponent(file)}`;

      if (IMAGE_EXTENSIONS.has(ext)) {
        images.push(url);
      } else {
        attachments.push({
          name: file,
          mimeType: ext === '.pdf' ? 'application/pdf' : 'application/octet-stream',
          size: stat.size,
          url,
          absolutePath: filePath,
        });
      }
    }

    // 如果结果文本中提到了文件但不在 assets 目录中，尝试在项目根目录查找
    if (mentionedFiles.size > 0) {
      for (const fileName of mentionedFiles) {
        if (seen.has(fileName)) continue;
        const filePath = pathMod.default.join(projectDir, fileName);
        let stat;
        try {
          stat = await fs.stat(filePath);
          if (!stat.isFile()) continue;
        } catch { continue; }

        // 复制到 assets 目录以便通过 API 访问
        try {
          await fs.mkdir(assetsDir, { recursive: true });
          await fs.copyFile(filePath, pathMod.default.join(assetsDir, fileName));
        } catch { continue; }

        const ext = pathMod.default.extname(fileName).toLowerCase();
        const url = `${apiBase}/api/assets/${projectId}/${encodeURIComponent(fileName)}`;

        if (IMAGE_EXTENSIONS.has(ext)) {
          images.push(url);
        } else {
          attachments.push({
            name: fileName,
            mimeType: ext === '.pdf' ? 'application/pdf' : 'application/octet-stream',
            size: stat.size,
            url,
            absolutePath: filePath,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[DispatchTracker] 扫描项目输出文件失败:', err);
  }

  return { images, attachments };
}

/** 追踪中的 dispatch 任务 */
interface TrackedDispatch {
  projectId: string;
  employeeName: string;
  /** 消息来源渠道 */
  source: MessageSource;
  /** IM 渠道的发送者信息，用于回推消息 */
  imSenderId?: string;
  imPlatform?: string;
  /** 原始消息的 rawPayload，用于 IM 回复 */
  imRawPayload?: unknown;
  createdAt: number;
  /** 是否已发送过 waiting_feedback 通知 */
  feedbackNotified?: boolean;
  /** Skill channel: 发起请求的 skill 名称 */
  skillChannelName?: string;
  /** Skill channel: 回调 URL（已弃用，改用 skill-channel registry） */
  skillCallbackUrl?: string;
}

/** 活跃的追踪列表（挂载到 globalThis 防止 Next.js HMR 重复创建） */
const _gk = '__dispatch_tracker_state__';
const _state: {
  trackedDispatches: Map<string, TrackedDispatch>;
  pollTimer: ReturnType<typeof setInterval> | null;
} = (globalThis as any)[_gk] ?? ((globalThis as any)[_gk] = {
  trackedDispatches: new Map<string, TrackedDispatch>(),
  pollTimer: null,
});
const trackedDispatches = _state.trackedDispatches;

/**
 * 注册一个需要追踪的 dispatch 任务
 */
export function trackDispatch(info: TrackedDispatch): void {
  trackedDispatches.set(info.projectId, info);
  // 确保轮询已启动
  startPolling();
}

/**
 * 重置某个项目的 feedback 通知标记
 * 当用户回复后调用，允许后续的 feedback 再次通知
 */
export function resetFeedbackNotified(projectId: string): void {
  const tracked = trackedDispatches.get(projectId);
  if (tracked) {
    tracked.feedbackNotified = false;
  }
}

/**
 * 主动通知任务已完成（由 CLI 执行器调用）
 * 不依赖轮询延迟，立即触发完成处理逻辑
 */
export function notifyTaskCompleted(projectId: string): void {
  const tracked = trackedDispatches.get(projectId);
  if (tracked) {
    handleCompletedTask(projectId, tracked).then(() => {
      trackedDispatches.delete(projectId);
      if (trackedDispatches.size === 0) {
        stopPolling();
      }
    }).catch((err: unknown) => {
      console.error(`[DispatchTracker] notifyTaskCompleted 处理失败:`, err);
    });
    return;
  }

  // 追踪列表中没有，检查是否是秘书调度的任务（projectId 以 dispatch- 开头）
  // dev 模式下 HMR/重启可能导致内存 Map 丢失，需要从数据库恢复
  if (!projectId.startsWith('dispatch-')) {
    return;
  }

  recoverAndHandleCompleted(projectId).catch((err: unknown) => {
    console.error(`[DispatchTracker] 数据库恢复处理失败:`, err);
  });
}

/**
 * 从数据库恢复秘书调度任务信息并完成通知（当 trackedDispatches 内存丢失时的降级方案）
 */
async function recoverAndHandleCompleted(projectId: string): Promise<void> {
  const { db: dbClient } = await import('@/lib/db/client');
  const { projects } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');

  const projectRows = await dbClient
    .select({ employeeId: projects.employee_id, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!projectRows[0]) {
    return;
  }

  let employeeName = '员工';
  if (projectRows[0].employeeId) {
    try {
      const { getEmployeeById } = await import('@/lib/services/employee-service');
      const emp = await getEmployeeById(projectRows[0].employeeId);
      if (emp?.name) employeeName = emp.name;
    } catch { /* use default */ }
  }

  const recovered: TrackedDispatch = {
    projectId,
    employeeName,
    source: 'web',
    createdAt: Date.now(),
  };

  await handleCompletedTask(projectId, recovered);
}

/**
 * 启动后台轮询（幂等）
 */
export function startPolling(): void {
  if (_state.pollTimer) return;
  _state.pollTimer = setInterval(pollDispatchStatuses, POLL_INTERVAL);
}

/**
 * 停止后台轮询
 */
export function stopPolling(): void {
  if (_state.pollTimer) {
    clearInterval(_state.pollTimer);
    _state.pollTimer = null;
  }
}

/**
 * 处理已完成的任务：获取结果、发 SSE、写秘书会话、IM 回推、Skill 回调等
 */
async function handleCompletedTask(projectId: string, tracked: TrackedDispatch): Promise<void> {
  const { db: dbClient } = await import('@/lib/db/client');
  const { messages: messagesTable } = await import('@/lib/db/schema');
  const { eq, desc, and } = await import('drizzle-orm');

  // 获取最后一条 assistant 消息作为结果
  let resultText = '';
  try {
    const lastMsgs = await dbClient
      .select({ content: messagesTable.content })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.projectId, projectId),
          eq(messagesTable.role, 'assistant'),
          eq(messagesTable.messageType, 'chat')
        )
      )
      .orderBy(desc(messagesTable.createdAt))
      .limit(1);
    if (lastMsgs[0]?.content) {
      resultText = lastMsgs[0].content;
      if (resultText.length > 2000) resultText = resultText.slice(0, 2000) + '...';
    }
  } catch { /* ignore */ }

  const resultContent = `📢 ${tracked.employeeName} 的任务已完成。${resultText ? `\n\n📄 执行结果：\n${resultText}` : ''}`;

  // Push SSE event for completion
  getSecretaryStream().publish({
    type: 'dispatch_completed',
    data: { projectId, employeeName: tracked.employeeName, resultText: resultText || undefined },
  });

  // 扫描项目输出文件（图片、附件）
  let outputExtras: { images?: string[]; attachments?: SecretaryAttachment[] } | undefined;
  try {
    const outputFiles = await scanProjectOutputFiles(projectId, resultText || undefined);
    if (outputFiles.images.length > 0 || outputFiles.attachments.length > 0) {
      outputExtras = { images: outputFiles.images, attachments: outputFiles.attachments };
    }
  } catch (scanErr) {
    console.warn('[DispatchTracker] 扫描输出文件失败，跳过附件:', scanErr);
  }

  // 写入秘书主会话（附带图片和文件附件）
  await appendToSecretarySession(resultContent, tracked, outputExtras);

  // 记录工作事件到记忆系统（fire-and-forget）
  try {
    const { recordCompletionEvent } = await import('./work-event-recorder');
    const summary = resultText || '任务已完成';
    recordCompletionEvent(tracked.employeeName, summary, tracked.source).catch(() => {});
  } catch { /* ignore */ }

  // 如果来源是 IM 渠道，回推消息
  if (tracked.source !== 'web' && tracked.source !== 'skill' && tracked.imPlatform && tracked.imSenderId) {
    await pushToIMChannel(resultContent, tracked);
    await handleTaskCompletionContext(tracked);
  }

  // 如果来源是 skill channel，通过 callbackUrl 回推结果
  if (tracked.source === 'skill') {
    try {
      const { pushToSkillCallback } = await import('./skill-channel');
      const resultFiles = outputExtras?.attachments?.map(a => ({
        name: a.name,
        url: a.url || '',
      }));
      await pushToSkillCallback(projectId, resultContent, resultFiles);
    } catch (err) {
      console.warn(`[DispatchTracker] Skill 回调失败:`, err);
    }
  }

  // 清理反馈问题内存
  try {
    const { userRequests } = await import('@/lib/db/schema');
    const requestRows = await dbClient
      .select()
      .from(userRequests)
      .where(eq(userRequests.projectId, projectId))
      .orderBy(desc(userRequests.createdAt))
      .limit(1);
    if (requestRows[0]) {
      const { clearFeedbackQuestion } = await import('./user-requests');
      clearFeedbackQuestion(requestRows[0].id);
    }
  } catch { /* ignore */ }

  console.log(`[DispatchTracker] ✅ handleCompletedTask 完成: ${projectId} (${tracked.employeeName})`);
}
/**
 * 轮询所有追踪中的 dispatch 任务状态
 */
async function pollDispatchStatuses(): Promise<void> {
  if (trackedDispatches.size === 0) return;

  try {
    const { db: dbClient } = await import('@/lib/db/client');
    const { userRequests, messages: messagesTable } = await import('@/lib/db/schema');
    const { eq, desc, and } = await import('drizzle-orm');

    const finishedIds: string[] = [];

    for (const [projectId, tracked] of trackedDispatches) {
      try {
        // 超过 30 分钟的任务自动清理（但先尝试获取结果）
        if (Date.now() - tracked.createdAt > FEEDBACK_TIMEOUT_MS) {
          try {
            const lastMsgs = await dbClient
              .select({ content: messagesTable.content })
              .from(messagesTable)
              .where(
                and(
                  eq(messagesTable.projectId, projectId),
                  eq(messagesTable.role, 'assistant'),
                  eq(messagesTable.messageType, 'chat')
                )
              )
              .orderBy(desc(messagesTable.createdAt))
              .limit(1);
            const timeoutResult = lastMsgs[0]?.content;
            if (timeoutResult) {
              const truncated = timeoutResult.length > 2000 ? timeoutResult.slice(0, 2000) + '...' : timeoutResult;
              await appendToSecretarySession(
                `⏰ ${tracked.employeeName} 的任务追踪已超时，最后的执行结果：\n\n${truncated}`,
                tracked,
              );
            } else {
              await appendToSecretarySession(
                `⏰ ${tracked.employeeName} 的任务追踪已超时，未获取到执行结果。`,
                tracked,
              );
            }
          } catch { /* ignore */ }
          finishedIds.push(projectId);
          continue;
        }

        const requestRows = await dbClient
          .select()
          .from(userRequests)
          .where(eq(userRequests.projectId, projectId))
          .orderBy(desc(userRequests.createdAt))
          .limit(1);

        const latestRequest = requestRows[0];
        if (!latestRequest) continue;

        const status = (latestRequest.status || '').toLowerCase();

        // ========== 判断是否需要用户反馈 ==========
        // 新逻辑：如果不在执行中且未完成，就需要用户反馈
        // 执行中的状态：pending, processing, planning, waiting_approval, implementing, active, running
        const activeStatuses = ['pending', 'processing', 'planning', 'waiting_approval', 'implementing', 'active', 'running'];
        const isExecuting = activeStatuses.includes(status);
        const isCompleted = status === 'completed';
        const isFailed = status === 'failed';
        const needsFeedback = !isExecuting && !isCompleted;

        if (needsFeedback) {
          // 只通知一次
          if (tracked.feedbackNotified) {
            // 如果之前已通知过，且现在是 failed，需要走 failed 逻辑
            if (isFailed) {
              finishedIds.push(projectId);
            }
            continue;
          }
          tracked.feedbackNotified = true;

          // Push SSE event for waiting_feedback
          getSecretaryStream().publish({
            type: 'dispatch_feedback',
            data: { projectId, employeeName: tracked.employeeName, isFailed },
          });

          // 获取反馈问题内容
          const { getFeedbackQuestion } = await import('./user-requests');
          let questionContent = getFeedbackQuestion(latestRequest.id);

          // 如果内存中没有（进程重启），从 DB 最后一条 assistant 消息获取
          if (!questionContent) {
            try {
              const lastMsgs = await dbClient
                .select({ content: messagesTable.content })
                .from(messagesTable)
                .where(
                  and(
                    eq(messagesTable.projectId, projectId),
                    eq(messagesTable.role, 'assistant'),
                    eq(messagesTable.messageType, 'chat')
                  )
                )
                .orderBy(desc(messagesTable.createdAt))
                .limit(1);
              questionContent = lastMsgs[0]?.content || '员工需要你的确认';
            } catch { questionContent = '员工需要你的确认'; }
          }

          // 如果是 failed 状态，在内容前添加失败提示
          if (isFailed) {
            const errorMsg = latestRequest.errorMessage || '未知错误';
            questionContent = `⚠️ 任务执行遇到问题：${errorMsg}\n\n${questionContent}`;
          }

          // 检查 IM 用户是否有活跃项目会话
          if (tracked.imPlatform && tracked.imSenderId) {
            const { getConversationContext, switchToProject, enqueuePendingFeedback } = await import('./im/conversation-context');
            const ctx = await getConversationContext(tracked.imPlatform, tracked.imSenderId);

            if (ctx.currentTarget.type === 'secretary') {
              // 无活跃项目会话 → 发送切换通知 + 问题
              await switchToProject(tracked.imPlatform, tracked.imSenderId, projectId, tracked.employeeName);

              const switchNotice = `🔄 已切换到 ${tracked.employeeName} 的会话`;
              await pushToIMChannel(switchNotice, tracked);
              await pushToIMChannel(questionContent, tracked);
              await appendToSecretarySession(`${switchNotice}\n\n${questionContent}`, tracked);

            } else {
              // 已有活跃项目会话 → 加入 PendingQueue
              await enqueuePendingFeedback(tracked.imPlatform, tracked.imSenderId, {
                projectId,
                employeeName: tracked.employeeName,
                questionContent,
                enqueuedAt: Date.now(),
                imSenderId: tracked.imSenderId,
                imPlatform: tracked.imPlatform,
                imRawPayload: tracked.imRawPayload,
              });

            }
          }

          // 需要反馈的任务不从 trackedDispatches 中移除，继续追踪（除非是 failed）
          if (isFailed) {
            // failed 状态需要最终移除，但先让用户看到反馈
            // 用户回复后会继续执行或者超时后自动移除
          }
          continue;
        }

        // ========== 原有逻辑：completed ==========
        // 到这里说明：要么 isCompleted，要么 isExecuting
        // isExecuting 的情况跳过
        if (!isCompleted) continue;

        // 任务已完成
        finishedIds.push(projectId);
        await handleCompletedTask(projectId, tracked);
        console.log(`[DispatchTracker] 任务 ${projectId} ${status}，已通知`);
      } catch (err) {
        console.error(`[DispatchTracker] 检查任务 ${projectId} 状态失败:`, err);
      }
    }

    // 清理已完成的任务
    for (const id of finishedIds) {
      trackedDispatches.delete(id);
    }

    // 没有追踪任务时停止轮询
    if (trackedDispatches.size === 0) {
      stopPolling();
    }
  } catch (err) {
    console.error('[DispatchTracker] 轮询异常:', err);
  }
}

/**
 * 任务完成后处理会话切回和队列
 */
async function handleTaskCompletionContext(tracked: TrackedDispatch): Promise<void> {
  if (!tracked.imPlatform || !tracked.imSenderId) return;

  try {
    const { getConversationContext, switchToSecretary, dequeuePendingFeedback, switchToProject } = await import('./im/conversation-context');
    const ctx = await getConversationContext(tracked.imPlatform, tracked.imSenderId);

    // 只有当前活跃会话是这个项目时才处理切换
    if (ctx.currentTarget.type !== 'project' || ctx.currentTarget.projectId !== tracked.projectId) return;

    // 检查队列中是否有下一个反馈请求
    const next = await dequeuePendingFeedback(tracked.imPlatform, tracked.imSenderId);

    if (next) {
      // 队列不为空：切换到下一个
      await switchToProject(tracked.imPlatform, tracked.imSenderId, next.projectId, next.employeeName);
      const reminder = `📋 ${next.employeeName} 还在等待你的确认`;
      await pushToIMChannel(reminder, tracked);
      await pushToIMChannel(next.questionContent, tracked);
      await appendToSecretarySession(`${reminder}\n\n${next.questionContent}`, tracked);
      console.log(`[DispatchTracker] 🔄 自动切换到队列中下一个: ${next.employeeName}`);
    } else {
      // 队列为空：切回秘书
      await switchToSecretary(tracked.imPlatform, tracked.imSenderId);
      const switchBack = `✅ ${tracked.employeeName} 的任务已完成，会话已切回秘书`;
      await pushToIMChannel(switchBack, tracked);
      await appendToSecretarySession(switchBack, tracked);
      console.log(`[DispatchTracker] ✅ 会话已切回秘书`);
    }
  } catch (err) {
    console.error(`[DispatchTracker] 处理会话切回失败:`, err);
  }
}

/**
 * 将结果消息追加到秘书主会话
 */
async function appendToSecretarySession(
  content: string,
  tracked: TrackedDispatch,
  extras?: { images?: string[]; attachments?: SecretaryAttachment[] },
): Promise<void> {
  try {
    const session = await loadSession();
    const msg: SecretaryMessage = {
      role: 'assistant',
      content,
      actions: [{
        type: 'dispatch',
        employeeName: tracked.employeeName,
        projectId: tracked.projectId,
      }],
      timestamp: new Date().toISOString(),
      source: tracked.source,
      ...(extras?.images?.length ? { images: extras.images } : {}),
      ...(extras?.attachments?.length ? { attachments: extras.attachments } : {}),
    };
    session.messages.push(msg);
    await saveSession(session);

    // Push new message via SSE so the client doesn't need to poll
    getSecretaryStream().publish({
      type: 'new_message',
      data: { message: msg },
    });
  } catch (err) {
    console.error('[DispatchTracker] 写入秘书会话失败:', err);
  }
}

/**
 * 通过 IM 渠道回推结果消息
 */
async function pushToIMChannel(content: string, tracked: TrackedDispatch): Promise<void> {
  try {
    const { getStreamAdapter } = await import('./im/adapter-factory');
    const { formatReplyForPlatform, splitMessage } = await import('./im/im-formatter');
    const { loadGlobalSettings } = await import('./settings');

    const platform = tracked.imPlatform as keyof import('./im/types').IMChannelsSettings;
    const settings = await loadGlobalSettings();
    const config = settings.im_channels?.[platform];
    if (!config) {
      return;
    }

    const adapter = await getStreamAdapter(platform);
    const formatted = formatReplyForPlatform(content, platform);
    const chunks = splitMessage(formatted, platform);

    for (const chunk of chunks) {
      await adapter.sendReply({
        platform,
        conversationId: '',
        senderId: tracked.imSenderId!,
        content: chunk,
        rawPayload: undefined,
      }, config);
    }
  } catch (err) {
    console.error(`[DispatchTracker] ❌ IM 回推失败 (${tracked.imPlatform}):`, err);
  }
}

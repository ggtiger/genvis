/**
 * Skill Channel Service
 *
 * 让 app 类型的 skill 作为消息发送端（等同于钉钉等 IM 渠道），
 * 发送消息给秘书，秘书处理后将结果回调给 skill。
 *
 * 流程：
 * 1. Skill 通过 /api/skill-channel/send 发送消息
 * 2. 本服务调用 secretary-core 处理消息
 * 3. 秘书执行 dispatch/skill_call/direct_reply
 * 4. 结果通过 callbackUrl 回调给 skill（如果提供了的话）
 * 5. Skill 内部自行调用平台服务（钉钉等）发送消息
 *
 * 同时支持 dispatch-tracker 回推：当 dispatch 任务完成后，
 * 结果会通过 callbackUrl 推送给发起请求的 skill。
 */

import {
  type SecretaryAction,
} from './secretary-session';
import { createSecretaryMessage } from './secretary/secretary-message-service';
import { secretaryStream } from './secretary-stream';
import {
  isSimpleGreeting,
  pickGreetingReply,
  loadClaudeConfig,
  callClaudeAPI,
  parseAIDecision,
  executeDispatch,
  executeSkillCall,
  type AIDecision,
} from './secretary-core';
import { classifyIntent } from './secretary-intent';
import { loadIntentExamples } from './intent-example-store';
import { getAllEmployees } from './employee-service';

// ========== Types ==========

export interface SkillChannelRequest {
  /** 发送消息的 skill 名称 */
  skillName: string;
  /** 消息内容 */
  message: string;
  /** 原始发送者标识（如钉钉用户 ID），用于追踪 */
  senderId?: string;
  /** 原始平台标识（如 dingtalk），用于追踪 */
  platform?: string;
  /** 任务完成后的回调 URL，skill 需要提供一个接收结果的端点 */
  callbackUrl?: string;
  /** 透传给回调的自定义数据 */
  callbackPayload?: Record<string, unknown>;
}

export interface SkillChannelResponse {
  /** 秘书的即时回复 */
  reply: string;
  /** 执行的动作列表 */
  actions?: SecretaryAction[];
  /** 如果是 dispatch 类型，任务完成后会通过 callbackUrl 异步推送结果 */
  async?: boolean;
}

/** 回调追踪信息 */
export interface SkillCallbackInfo {
  skillName: string;
  callbackUrl: string;
  callbackPayload?: Record<string, unknown>;
  senderId?: string;
  platform?: string;
}

// ========== Callback Registry ==========
// 存储 projectId → callbackInfo 的映射，dispatch 完成后用于回推

const _gk = '__skill_channel_callbacks__';
const callbackRegistry: Map<string, SkillCallbackInfo> =
  (globalThis as any)[_gk] ?? ((globalThis as any)[_gk] = new Map());

export function registerCallback(projectId: string, info: SkillCallbackInfo): void {
  callbackRegistry.set(projectId, info);
  console.log(`[SkillChannel] 📝 registerCallback: projectId=${projectId}, callbackUrl=${info.callbackUrl}, registry size=${callbackRegistry.size}`);
}

export function getCallback(projectId: string): SkillCallbackInfo | undefined {
  return callbackRegistry.get(projectId);
}

export function removeCallback(projectId: string): void {
  callbackRegistry.delete(projectId);
}

// ========== Core Logic ==========

/**
 * 处理来自 skill 的消息，调用秘书核心逻辑。
 */
export async function processSkillMessage(
  req: SkillChannelRequest
): Promise<SkillChannelResponse> {
  const { skillName, message, senderId, platform, callbackUrl, callbackPayload } = req;
  const trimmed = message.trim();

  console.log(`[SkillChannel] 收到来自 skill "${skillName}" 的消息: "${trimmed.slice(0, 100)}"`);
  console.log(`[SkillChannel] callbackUrl=${callbackUrl || '(无)'}, callbackPayload=${callbackPayload ? JSON.stringify(callbackPayload) : '(无)'}`);

  // 1. 简单问候快速路径
  if (isSimpleGreeting(trimmed)) {
    const reply = pickGreetingReply(trimmed);
    await appendToSession(trimmed, reply, skillName);
    return { reply };
  }

  // 2. 加载 Claude 配置
  const claudeConfig = await loadClaudeConfig();
  if (!claudeConfig.apiKey) {
    return { reply: 'AI 服务未配置，请在设置中配置 API Key。' };
  }

  // 3. 意图分类
  let intentExamples: import('./intent-example-store').IntentExample[] = [];
  try {
    intentExamples = await loadIntentExamples(15);
  } catch { /* never-throw */ }

  const classification = await classifyIntent(trimmed, undefined, intentExamples, claudeConfig);
  console.log(`[SkillChannel] 意图分类: intent=${classification.intent}, target=${classification.target || 'N/A'}`);

  // 4. Fast-path dispatch
  if (classification.intent === 'dispatch' && classification.target) {
    const allEmps = await getAllEmployees();
    const resolvedId = resolveTarget(classification.target, allEmps);
    if (resolvedId) {
      const decision: AIDecision = {
        action: 'dispatch',
        employeeId: resolvedId,
        instruction: trimmed,
        confidence: 0.9,
      };
      const result = await executeDispatch(decision, undefined, trimmed, classification.target);

      // 注册回调追踪
      if (callbackUrl && result.actions?.[0]?.projectId) {
        registerCallback(result.actions[0].projectId, {
          skillName,
          callbackUrl,
          callbackPayload,
          senderId,
          platform,
        });
      }

      // 注册 dispatch-tracker（用于 SSE 推送和会话写入）
      await registerDispatchTracker(result.actions, skillName, senderId, platform);

      await appendToSession(trimmed, result.reply, skillName, result.actions);
      return {
        reply: result.reply,
        actions: result.actions.length > 0 ? result.actions : undefined,
        async: result.actions.some(a => a.type === 'dispatch'),
      };
    }
  }

  // 5. Skill call fast-path
  if (classification.intent === 'skill_call' && classification.target) {
    // 构建详细 prompt 获取 API 调用参数
    const { buildDetailedPrompt } = await import('./secretary-intent');
    const systemPrompt = await buildDetailedPrompt(
      'skill_call', '', '', classification.target
    );
    const aiResponse = await callClaudeAPI(
      systemPrompt,
      [{ role: 'user', content: trimmed }],
      claudeConfig
    );
    const decision = parseAIDecision(aiResponse);
    if (decision.action === 'skill_call') {
      const result = await executeSkillCall(decision, undefined, trimmed, classification.target);
      await appendToSession(trimmed, result.reply, skillName, result.actions);
      return { reply: result.reply, actions: result.actions.length > 0 ? result.actions : undefined };
    }
  }

  // 6. Direct reply — 需要完整上下文
  const { buildDetailedPrompt } = await import('./secretary-intent');
  const systemPrompt = await buildDetailedPrompt(
    classification.intent,
    '',
    '',
    classification.target,
  );
  const aiResponse = await callClaudeAPI(
    systemPrompt,
    [{ role: 'user', content: trimmed }],
    claudeConfig
  );
  const decision = parseAIDecision(aiResponse);

  let reply: string;
  let actions: SecretaryAction[] = [];

  switch (decision.action) {
    case 'dispatch': {
      const dispatchResult = await executeDispatch(decision, undefined, trimmed, classification.target);
      reply = dispatchResult.reply;
      actions = dispatchResult.actions;
      if (callbackUrl && actions[0]?.projectId) {
        registerCallback(actions[0].projectId, {
          skillName, callbackUrl, callbackPayload, senderId, platform,
        });
      }
      await registerDispatchTracker(actions, skillName, senderId, platform);
      break;
    }
    case 'skill_call': {
      const skillResult = await executeSkillCall(decision, undefined, trimmed, classification.target);
      reply = skillResult.reply;
      actions = skillResult.actions;
      break;
    }
    default: {
      reply = decision.reply || aiResponse;
      break;
    }
  }

  await appendToSession(trimmed, reply, skillName, actions.length > 0 ? actions : undefined);
  return {
    reply,
    actions: actions.length > 0 ? actions : undefined,
    async: actions.some(a => a.type === 'dispatch'),
  };
}

// ========== Helpers ==========

function resolveTarget(target: string, allEmployees: import('@/types/backend/employee').Employee[]): string | null {
  const parenMatch = target.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const id = parenMatch[1];
    if (allEmployees.some(e => e.id === id)) return id;
  }
  const byId = allEmployees.find(e => e.id === target);
  if (byId) return byId.id;
  const byName = allEmployees.find(e => e.name === target);
  if (byName) return byName.id;
  const fuzzy = allEmployees.find(e => target.includes(e.name) || e.name.includes(target));
  if (fuzzy) return fuzzy.id;
  return null;
}

async function appendToSession(
  userContent: string,
  assistantContent: string,
  skillName: string,
  actions?: SecretaryAction[],
): Promise<void> {
  try {
    // Save user message to database
    const userMsg = await createSecretaryMessage({
      role: 'user',
      messageType: 'text',
      content: `[来自技能 ${skillName}] ${userContent}`,
      senderId: skillName,
      senderName: skillName,
      interactionMode: 'skill_invoke',
    });

    // Save assistant message to database
    const assistantMsg = await createSecretaryMessage({
      role: 'assistant',
      messageType: 'text',
      content: assistantContent,
      senderId: 'secretary',
      senderName: '秘书',
      interactionMode: 'skill_invoke',
      metadata: actions ? { actions } : undefined,
    });

    // SSE 推送
    secretaryStream.publish({ type: 'new_message', data: { message: userMsg } });
    secretaryStream.publish({ type: 'new_message', data: { message: assistantMsg } });
  } catch (err) {
    console.warn('[SkillChannel] 写入会话失败:', err);
  }
}

async function registerDispatchTracker(
  actions: SecretaryAction[],
  skillName: string,
  senderId?: string,
  platform?: string,
): Promise<void> {
  try {
    const { trackDispatch } = await import('./dispatch-tracker');
    for (const action of actions) {
      if (action.type === 'dispatch' && action.projectId) {
        trackDispatch({
          projectId: action.projectId,
          employeeName: action.employeeName || action.employeeId || '员工',
          source: 'skill',
          skillChannelName: skillName,
          skillCallbackUrl: undefined, // callback handled by skill-channel registry
          imSenderId: senderId,
          imPlatform: platform,
          createdAt: Date.now(),
        });
      }
    }
  } catch (err) {
    console.warn('[SkillChannel] 注册 dispatch tracker 失败:', err);
  }
}

/**
 * 将结果回调给 skill 的 callbackUrl。
 * 由 dispatch-tracker 在任务完成时调用。
 */
export async function pushToSkillCallback(
  projectId: string,
  content: string,
  resultFiles?: Array<{ name: string; url: string }>,
): Promise<void> {
  const info = getCallback(projectId);
  if (!info) {
    console.warn(`[SkillChannel] ⚠️ pushToSkillCallback: 未找到 projectId=${projectId} 的回调信息 (registry size=${callbackRegistry.size}, keys=[${[...callbackRegistry.keys()].join(', ')}])`);
    return;
  }

  try {
    console.log(`[SkillChannel] 回调 skill "${info.skillName}": ${info.callbackUrl}`);
    const body = {
      type: 'task_completed',
      projectId,
      content,
      resultFiles,
      senderId: info.senderId,
      platform: info.platform,
      callbackPayload: info.callbackPayload,
    };

    await fetch(info.callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    console.log(`[SkillChannel] ✅ 回调成功: ${info.skillName}`);
  } catch (err) {
    console.error(`[SkillChannel] ❌ 回调失败 (${info.skillName}):`, err);
  } finally {
    removeCallback(projectId);
  }
}


// ========== IM Push ==========

export interface IMPushRequest {
  /** 消息内容 */
  content: string;
  /** 发送方 skill 名称（用于日志） */
  skillName?: string;
  /** 指定平台（不指定则广播到所有已连接渠道） */
  platform?: string;
  /** 指定接收者 ID（需配合 platform 使用） */
  senderId?: string;
  /** 平台原始 payload（用于回复特定会话，如钉钉的 sessionWebhook） */
  rawPayload?: unknown;
}

export interface IMPushResult {
  /** 成功发送的平台列表 */
  sent: string[];
  /** 发送失败的平台及原因 */
  failed: Array<{ platform: string; error: string }>;
}

/**
 * 从 im-sessions 目录获取某平台所有已知用户 ID（曾经发过消息的用户）。
 * 用于广播模式下确定发送目标。
 */
async function getKnownSenderIds(platform: import('./im/types').IMPlatform): Promise<string[]> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const dataDir = process.env.SETTINGS_DIR || path.default.join(process.cwd(), 'data');
    const sessionDir = path.default.join(dataDir, 'im-sessions', platform);
    const files = await fs.readdir(sessionDir).catch(() => [] as string[]);
    // 文件名格式: {senderId}.json
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''))
      .filter(id => id.length > 0);
  } catch {
    return [];
  }
}

/**
 * 发送消息到 IM 渠道。
 *
 * - 不指定 platform: 广播到所有已连接的 IM 渠道
 * - 指定 platform + senderId: 定向发送给某个用户
 * - 指定 platform 不指定 senderId: 广播给该平台所有已知用户
 */
export async function sendToIM(req: IMPushRequest): Promise<IMPushResult> {
  const { content, skillName, platform, senderId, rawPayload } = req;
  const label = skillName || 'unknown-skill';

  console.log(`[SkillChannel] IM push from "${label}": platform=${platform || 'all'}, senderId=${senderId || 'broadcast'}, content前50字=${content.substring(0, 50)}`);

  const { connectionManager } = await import('./im/connection-manager');
  const { loadGlobalSettings } = await import('./settings');
  const { formatReplyForPlatform, splitMessage } = await import('./im/im-formatter');
  const { getStreamAdapter } = await import('./im/adapter-factory');

  const settings = await loadGlobalSettings();
  const sent: string[] = [];
  const failed: Array<{ platform: string; error: string }> = [];

  // 确定目标平台列表
  let targetPlatforms: string[];
  if (platform) {
    targetPlatforms = [platform];
  } else {
    // 广播：获取所有已连接的平台
    const statuses = connectionManager.getStatus();
    targetPlatforms = statuses
      .filter(s => s.connectionStatus === 'connected')
      .map(s => s.platform);
  }

  if (targetPlatforms.length === 0) {
    console.log(`[SkillChannel] 没有可用的 IM 渠道`);
    return { sent, failed: [{ platform: platform || 'all', error: '没有已连接的 IM 渠道' }] };
  }

  for (const p of targetPlatforms) {
    const config = settings.im_channels?.[p as keyof typeof settings.im_channels];
    if (!config?.enabled) {
      failed.push({ platform: p, error: '渠道未启用' });
      continue;
    }

    try {
      const adapter = await getStreamAdapter(p as import('./im/types').IMPlatform);
      const formatted = formatReplyForPlatform(content, p as import('./im/types').IMPlatform);
      const chunks = splitMessage(formatted, p as import('./im/types').IMPlatform);

      // 确定目标用户列表
      let targetSenderIds: string[];
      if (senderId) {
        targetSenderIds = [senderId];
      } else {
        // 广播模式：从 im-sessions 中获取该平台所有已知用户
        targetSenderIds = await getKnownSenderIds(p as import('./im/types').IMPlatform);
        if (targetSenderIds.length === 0) {
          failed.push({ platform: p, error: '没有已知的 IM 用户（无历史会话）' });
          continue;
        }
        console.log(`[SkillChannel] 广播模式: 平台 ${p} 找到 ${targetSenderIds.length} 个已知用户`);
      }

      for (const sid of targetSenderIds) {
        for (const chunk of chunks) {
          await adapter.sendReply({
            platform: p as import('./im/types').IMPlatform,
            conversationId: '',
            senderId: sid,
            content: chunk,
            rawPayload: rawPayload ?? {},
          }, config);
        }
      }

      sent.push(p);
      console.log(`[SkillChannel] ✅ IM 消息已发送到 ${p} (${targetSenderIds.length} 个用户)`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      failed.push({ platform: p, error: errMsg });
      console.warn(`[SkillChannel] ❌ 发送到 ${p} 失败:`, errMsg);
    }
  }

  return { sent, failed };
}

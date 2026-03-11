/**
 * IM Channel Message Processor
 *
 * Unified message processing pipeline shared by both Stream and Webhook adapters.
 * Flow: Rate limit check → Unsupported type handling → Load session → Call Secretary core →
 *       Format reply → Send reply → Save session
 *
 * Validates: Requirements 4.1, 4.3, 4.5, 3.7
 */

import type { IMStandardMessage, IMReplyRequest, IMChannelConfig } from './types';
import type { IMAdapterBase } from './adapter';
import type { IMSession } from './im-session';
import { isRateLimited, recordMessage } from './rate-limiter';
import { loadIMSession, saveIMSession } from './im-session';
import { formatReplyForPlatform, splitMessage } from './im-formatter';
import { loadSession, saveSession, type MessageSource } from '@/lib/services/secretary-session';
import { getEmployeeById, getAllEmployees } from '@/lib/services/employee-service';
import { loadMemory } from '@/lib/services/secretary-memory';
import { buildMemoryPromptBlockFromResults } from '@/lib/services/secretary-memory-prompt';
import { searchMemory } from '@/lib/services/memory-retriever';
import {
  isSimpleGreeting,
  pickGreetingReply,
  loadClaudeConfig,
  callClaudeAPI,
  parseAIDecision,
  executeDispatch,
  executeSkillCall,
} from '@/lib/services/secretary-core';
import { classifyIntent, buildDetailedPrompt } from '@/lib/services/secretary-intent';
import { loadIntentExamples, formatIntentExamplesBlock } from '@/lib/services/intent-example-store';
import { searchDispatchLearnings } from '@/lib/services/correction-retriever';
import {
  formatSummaryForPrompt,
} from '@/lib/services/conversation-summarizer';
import {
  getRecentWorkEvents,
} from '@/lib/services/work-event-recorder';

// ========== Helpers ==========

/**
 * Build a base reply request from an incoming message.
 */
function replyBase(message: IMStandardMessage): Omit<IMReplyRequest, 'content'> {
  return {
    platform: message.platform,
    conversationId: message.conversationId,
    senderId: message.senderId,
    rawPayload: message.rawPayload,
  };
}

// ========== Secretary Core Logic ==========

/**
 * Result from calling the Secretary core logic.
 */
export interface SecretaryCoreResult {
  reply: string;
  actions?: Array<{
    type: 'dispatch' | 'skill_call' | 'info';
    employeeId?: string;
    employeeName?: string;
    projectId?: string;
    skillName?: string;
    endpoint?: string;
    result?: unknown;
  }>;
}

/**
 * Call the Secretary core logic to process a user message.
 *
 * Uses shared secretary-core.ts for all AI pipeline logic:
 * 1. Load Claude config
 * 2. Load secretary employee system prompt
 * 3. Build conversation context from IM session history
 * 4. Call Claude API for intent analysis
 * 5. Parse AI decision and execute action (dispatch / skill_call / direct_reply)
 */
export async function callSecretaryCore(
  content: string,
  session: IMSession
): Promise<SecretaryCoreResult> {
  let step = 'init';
  try {
    // 1. Load Claude API config (once for entire request)
    step = 'loadClaudeConfig';
    const claudeConfig = await loadClaudeConfig();

    if (!claudeConfig.apiKey) {
      return { reply: 'AI 服务未配置，请在设置中配置 API Key。' };
    }

    // 1.5 Simple greeting fast-path: skip AI call for trivial messages
    const trimmedContent = content.trim();
    if (isSimpleGreeting(trimmedContent)) {
      return { reply: pickGreetingReply(trimmedContent) };
    }

    // 1.6 Block bare @mention without instruction
    if (trimmedContent.startsWith('@')) {
      const afterAt = trimmedContent.slice(1).trim();
      const allEmps = await getAllEmployees();
      const matchedEmp = allEmps.find((e: any) => e.name === afterAt);
      if (matchedEmp) {
        const hint = matchedEmp.first_prompt || '帮我完成一个任务';
        return {
          reply: `你提到了 ${afterAt}，请告诉我需要分配什么具体任务？例如：@${afterAt} ${hint}`,
        };
      }
    }

    // 2. Load secretary employee
    step = 'getEmployeeById';
    const secretary = await getEmployeeById('builtin-secretary');
    if (!secretary) {
      return { reply: '秘书服务暂时不可用，请稍后重试。' };
    }

    // 3. Load intent examples for Step 1 classification
    step = 'loadIntentExamples';
    let intentExamples: import('@/lib/services/intent-example-store').IntentExample[] = [];
    try {
      intentExamples = await loadIntentExamples(15);
    } catch { /* never-throw */ }

    // ========== Step 1: Lightweight intent classification ==========
    step = 'classifyIntent';
    const classification = await classifyIntent(trimmedContent, undefined, intentExamples, claudeConfig);
    console.log(`[IMChannel] Step1 intent=${classification.intent}, target=${classification.target || 'N/A'}`);

    // ========== Fast-path dispatch: target resolved → skip Step 2 ==========
    if (classification.intent === 'dispatch' && classification.target) {
      // Inline resolve: match target to employee ID
      const allEmps = await getAllEmployees();
      const resolvedId = resolveEmployeeIdFromTarget(classification.target, allEmps);
      if (resolvedId) {
        console.log(`[IMChannel] Fast-path dispatch: ${classification.target} → ${resolvedId}`);
        const fastDecision: import('@/lib/services/secretary-core').AIDecision = {
          action: 'dispatch',
          employeeId: resolvedId,
          instruction: trimmedContent,
          confidence: 0.9,
        };
        const result = await executeDispatch(fastDecision, undefined, trimmedContent, classification.target);
        return { reply: result.reply, actions: result.actions.length > 0 ? result.actions : undefined };
      }
    }

    // ========== Step 2: Build detailed prompt based on intent ==========
    step = 'buildDetailedPrompt';

    // Load memory for personalization
    const memory = await loadMemory();
    let extraContext = '';
    if (classification.intent !== 'skill_call') {
      let memoryBlock = '';
      if (trimmedContent.length > 4) {
        const retrievalResults = searchMemory(trimmedContent, memory, 10);
        memoryBlock = buildMemoryPromptBlockFromResults(retrievalResults);
      }
      const workEventsBlock = await getRecentWorkEvents(7);
      let dispatchLearningsBlock = '';
      try {
        dispatchLearningsBlock = searchDispatchLearnings(trimmedContent, memory);
      } catch { /* never-throw */ }
      // Only inject intent examples for direct_reply
      const intentExamplesBlock = classification.intent === 'direct_reply' ? formatIntentExamplesBlock(intentExamples) : '';
      extraContext = [intentExamplesBlock, memoryBlock, workEventsBlock, dispatchLearningsBlock].filter(Boolean).join('\n\n');
    }

    const systemPrompt = await buildDetailedPrompt(
      classification.intent,
      secretary.system_prompt || '',
      extraContext,
      classification.target,
    );

    // 4. Build conversation messages from IM session history
    step = 'buildMessages';
    const conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Adjust history limit based on intent
    const historyLimit = classification.intent === 'direct_reply' ? 6 : (classification.intent === 'skill_call' ? 0 : 2);
    if (historyLimit > 0) {
      const recentMessages = session.messages.slice(-historyLimit);
      for (const msg of recentMessages) {
        conversationMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add current message with time context
    const now = new Date();
    const datePrefix = `[当前时间: ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]\n`;
    conversationMessages.push({
      role: 'user',
      content: datePrefix + trimmedContent,
    });

    // 5. Call Claude API (Step 2)
    step = 'callClaudeAPI';
    const aiResponseText = await callClaudeAPI(systemPrompt, conversationMessages, claudeConfig);

    // 6. Parse AI decision
    step = 'parseAIDecision';
    const decision = parseAIDecision(aiResponseText);

    // 7. Execute action using shared core functions
    step = `executeAction:${decision.action}`;
    let reply: string;
    let actions: SecretaryCoreResult['actions'] = [];

    switch (decision.action) {
      case 'dispatch': {
        const result = await executeDispatch(decision, undefined, trimmedContent, classification.target);
        reply = result.reply;
        actions = result.actions;
        break;
      }
      case 'skill_call': {
        const result = await executeSkillCall(decision, undefined, trimmedContent, classification.target);
        reply = result.reply;
        actions = result.actions;
        break;
      }
      case 'direct_reply':
      default: {
        reply = decision.reply || aiResponseText;
        break;
      }
    }

    return { reply, actions: actions.length > 0 ? actions : undefined };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : '';
    console.error(`[IMChannel] callSecretaryCore error at step="${step}":`, errMsg, errStack);

    // Also write to log file for easier debugging
    try {
      const { appendClaudeLog } = await import('@/lib/services/secretary-core');
      appendClaudeLog({
        timestamp: new Date().toISOString(),
        model: 'im-channel-error',
        systemPrompt: '',
        messagesCount: 0,
        lastUserMessage: content.slice(0, 500),
        responseLength: 0,
        responseText: '',
        durationMs: 0,
        error: `step=${step}: ${errMsg}`,
      }).catch(() => {});
    } catch { /* ignore */ }

    return { reply: '抱歉，处理您的消息时出现了问题，请稍后重试。' };
  }
}

/**
 * Resolve employee ID from Step 1 classification target string.
 * Matches by ID, name, or fuzzy substring.
 */
function resolveEmployeeIdFromTarget(target: string, allEmployees: import('@/types/backend/employee').Employee[]): string | null {
  // 1. Extract from "名称(id)" format
  const parenMatch = target.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const idCandidate = parenMatch[1];
    if (allEmployees.some(e => e.id === idCandidate)) return idCandidate;
  }
  // 2. Direct ID match
  const byId = allEmployees.find(e => e.id === target);
  if (byId) return byId.id;
  // 3. Name match
  const byName = allEmployees.find(e => e.name === target);
  if (byName) return byName.id;
  // 4. Fuzzy match
  const fuzzy = allEmployees.find(e => target.includes(e.name) || e.name.includes(target));
  if (fuzzy) return fuzzy.id;
  return null;
}

// ========== Main Processing Pipeline ==========

/**
 * Unified message processing pipeline — shared by Stream and Webhook adapters.
 *
 * Flow:
 * 1. Rate limit check
 * 2. Unsupported message type handling
 * 3. Load/create IM session
 * 4. Call Secretary core logic
 * 5. Format reply for platform
 * 6. Send reply (split if needed)
 * 7. Update session with new messages
 */
export async function processIMMessage(
  message: IMStandardMessage,
  adapter: IMAdapterBase,
  config: IMChannelConfig
): Promise<void> {
  const startTime = Date.now();

  // 结构化日志辅助函数
  const emitLog = (fields: {
    action: string;
    success: boolean;
    error?: string;
  }) => {
    const logEntry = {
      type: 'im_message_processing',
      platform: message.platform,
      receiveMode: message.receiveMode,
      senderId: message.senderId,
      processingTime: Date.now() - startTime,
      action: fields.action,
      success: fields.success,
      ...(fields.error ? { error: fields.error } : {}),
    };
    if (fields.success) {
      console.log(JSON.stringify(logEntry));
    } else {
      console.error(JSON.stringify(logEntry));
    }
  };

  try {
    // 1. Rate limit check
    if (isRateLimited(message.platform, message.senderId)) {
      await adapter.sendReply(
        { ...replyBase(message), content: '您发送消息过于频繁，请稍后再试。' },
        config
      );
      emitLog({ action: 'rate_limited', success: true });
      return;
    }

    // Record message for rate limiting
    recordMessage(message.platform, message.senderId);

    // 2. Unsupported message type
    if (message.messageType === 'unsupported') {
      await adapter.sendReply(
        { ...replyBase(message), content: '目前仅支持文本消息，请发送文字内容。' },
        config
      );
      emitLog({ action: 'unsupported_type', success: true });
      return;
    }

    // 3. Load/create IM session
    const session = await loadIMSession(message.platform, message.senderId);

    // 3.1 立即推送用户消息到 SSE，让网页端实时看到 IM 来的消息
    const timestamp = new Date().toISOString();
    const imSource = message.platform as MessageSource;
    const userMsg = { role: 'user' as const, content: message.content, timestamp, source: imSource };
    try {
      const { secretaryStream } = await import('@/lib/services/secretary-stream');
      secretaryStream.publish({ type: 'new_message', data: { message: userMsg } });
    } catch { /* ignore */ }

    // 3.5 检查 ConversationContext，决定路由到项目还是秘书
    try {
      const { getConversationContext } = await import('./conversation-context');
      const convCtx = await getConversationContext(message.platform, message.senderId);
      if (convCtx.currentTarget.type === 'project' && convCtx.currentTarget.projectId) {
        await routeToProject(convCtx.currentTarget.projectId, message, adapter, config, convCtx.currentTarget.employeeName);
        emitLog({ action: 'route_to_project', success: true });
        return;
      }
    } catch (ctxErr) {
      console.warn('[IMChannel] ConversationContext check failed, falling back to secretary:', ctxErr);
    }

    // 4. Call Secretary core logic
    const result = await callSecretaryCore(message.content, session);

    // 4.5 如果有 dispatch 动作，注册追踪以便任务完成后回推结果
    if (result.actions) {
      const { trackDispatch } = await import('@/lib/services/dispatch-tracker');
      for (const act of result.actions) {
        if (act.type === 'dispatch' && act.projectId) {
          trackDispatch({
            projectId: act.projectId,
            employeeName: act.employeeName || act.employeeId || '员工',
            source: message.platform as MessageSource,
            imPlatform: message.platform,
            imSenderId: message.senderId,
            imRawPayload: message.rawPayload,
            createdAt: Date.now(),
          });
        }
      }
    }

    // 5. Format reply for platform
    const formattedReply = formatReplyForPlatform(result.reply, message.platform);

    // 6. Send reply (split if content exceeds platform limit)
    const chunks = splitMessage(formattedReply, message.platform);
    for (const chunk of chunks) {
      await adapter.sendReply({ ...replyBase(message), content: chunk }, config);
    }

    // 7. Update IM session with new messages
    session.messages.push(
      { role: 'user', content: message.content, timestamp },
      { role: 'assistant', content: result.reply, timestamp }
    );
    await saveIMSession(session);

    // 8. 同步写入秘书主会话，保证网页端能看到 IM 渠道的聊天记录
    try {
      const mainSession = await loadSession();
      const assistantMsg = {
        role: 'assistant' as const,
        content: result.reply,
        actions: result.actions,
        timestamp,
        source: imSource,
      };
      mainSession.messages.push(userMsg, assistantMsg);
      await saveSession(mainSession);

      // Push assistant reply via SSE (user message was already pushed in step 3.1)
      const { secretaryStream } = await import('@/lib/services/secretary-stream');
      secretaryStream.publish({ type: 'new_message', data: { message: assistantMsg } });
    } catch (err) {
      console.warn('[IMChannel] 同步秘书主会话失败:', err);
    }

    // 确定执行的动作类型
    const action = result.actions?.[0]?.type ?? 'direct_reply';
    emitLog({ action, success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : '';
    console.error(`[IMChannel] processIMMessage error:`, errMsg, errStack);

    emitLog({
      action: 'error',
      success: false,
      error: errMsg,
    });

    // Try to send error notification to user
    try {
      await adapter.sendReply(
        { ...replyBase(message), content: '抱歉，处理您的消息时出现了问题，请稍后重试。' },
        config
      );
    } catch (sendError) {
      console.error('[IMChannel] Failed to send error notification:', sendError);
    }
  }
}



// ========== Route to Project (交互式反馈) ==========

/**
 * 将 IM 消息路由到项目会话，恢复 Claude SDK 会话继续执行。
 */
async function routeToProject(
  projectId: string,
  message: IMStandardMessage,
  adapter: IMAdapterBase,
  config: IMChannelConfig,
  employeeName?: string
): Promise<void> {
  try {
    const { getProjectById } = await import('@/lib/services/project');
    const { applyChanges } = await import('@/lib/services/cli/claude');
    const { upsertUserRequest, markUserRequestAsRunning } = await import('@/lib/services/user-requests');
    const { generateId } = await import('@/lib/utils/id');
    const { PROJECTS_DIR_ABSOLUTE } = await import('@/lib/config/paths');
    const { getDefaultModelForCli, normalizeModelId } = await import('@/lib/constants/cliModels');
    const path = await import('path');

    const project = await getProjectById(projectId);
    if (!project) {
      throw new Error(`项目不存在: ${projectId}`);
    }

    const sessionId = project.activeClaudeSessionId || undefined;
    const cliPreference = project.preferredCli || 'claude';
    const selectedModel = normalizeModelId(cliPreference, project.selectedModel || getDefaultModelForCli(cliPreference));
    const requestId = generateId();

    const workDirectory = (project as any).work_directory;
    const projectMode = (project as any).mode as string | undefined;
    const projectPath = (projectMode === 'work' || projectMode === 'boss') && workDirectory
      ? workDirectory
      : (project.repoPath || path.join(PROJECTS_DIR_ABSOLUTE, projectId));

    // 创建 user request
    await upsertUserRequest({
      id: requestId,
      projectId,
      instruction: message.content,
      cliPreference,
    });
    await markUserRequestAsRunning(requestId);

    // 通知 IM 用户消息已收到
    const ack = employeeName
      ? `💬 已将你的回复发送给 ${employeeName}，正在继续执行...`
      : `💬 已将你的回复发送到项目，正在继续执行...`;
    await adapter.sendReply(
      { ...replyBase(message), content: ack },
      config
    );

    // 同步写入秘书主会话
    try {
      const mainSession = await loadSession();
      const timestamp = new Date().toISOString();
      const imSource = message.platform as MessageSource;
      mainSession.messages.push(
        { role: 'user', content: `[回复${employeeName || '项目'}] ${message.content}`, timestamp, source: imSource },
        { role: 'assistant', content: ack, timestamp, source: imSource }
      );
      await saveSession(mainSession);
    } catch { /* ignore */ }

    // 注册 dispatch 追踪（以便任务完成后回推结果）
    const { trackDispatch } = await import('@/lib/services/dispatch-tracker');
    trackDispatch({
      projectId,
      employeeName: employeeName || '员工',
      source: message.platform as MessageSource,
      imPlatform: message.platform,
      imSenderId: message.senderId,
      imRawPayload: message.rawPayload,
      createdAt: Date.now(),
    });

    // 异步执行 Claude（不 await，后台运行）
    applyChanges(
      projectId,
      projectPath,
      message.content,
      selectedModel,
      sessionId,
      requestId,
    ).catch(error => {
      console.error(`[IMChannel] routeToProject execution failed for ${projectId}:`, error);
    });

    // 回复已发送给项目，立即切回秘书模式
    // 如果员工再次需要 feedback，dispatch-tracker 会再次切换
    try {
      const { switchToSecretary } = await import('./conversation-context');
      await switchToSecretary(message.platform, message.senderId);
      console.log(`[IMChannel] 🔄 消息已路由到项目 ${projectId} (${employeeName})，已切回秘书模式`);
    } catch {
      console.log(`[IMChannel] 🔄 消息已路由到项目 ${projectId} (${employeeName})`);
    }
  } catch (error) {
    console.error('[IMChannel] routeToProject failed:', error);

    // 路由失败：重置 ConversationContext 到秘书
    try {
      const { switchToSecretary } = await import('./conversation-context');
      await switchToSecretary(message.platform, message.senderId);
    } catch { /* ignore */ }

    // 通知用户
    await adapter.sendReply(
      { ...replyBase(message), content: '⚠️ 消息发送失败，已切回秘书会话。请重新发送你的消息。' },
      config
    );

    // 回退到秘书处理
    const session = await loadIMSession(message.platform, message.senderId);
    const result = await callSecretaryCore(message.content, session);
    const formattedReply = formatReplyForPlatform(result.reply, message.platform);
    const chunks = splitMessage(formattedReply, message.platform);
    for (const chunk of chunks) {
      await adapter.sendReply({ ...replyBase(message), content: chunk }, config);
    }
  }
}

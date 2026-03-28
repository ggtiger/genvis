/**
 * Secretary Chat API Route
 * POST /api/chat/home/secretary
 *
 * Receives user messages, uses AI to analyze intent, and executes actions:
 * - Dispatch tasks to other employees
 * - Call skill REST APIs directly
 * - Reply directly to the user
 *
 * Does NOT create any projects (Requirements 5.1).
 * Maintains conversation state via secretary session (Requirements 5.3).
 *
 * This route is a pure HTTP layer — all AI pipeline logic (config, prompt assembly,
 * API calling, response parsing, action execution) lives in secretary-core.ts.
 *
 * Validates: Requirements 2.3, 5.1, 5.3
 */

import { NextRequest } from 'next/server';
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
} from '@/lib/utils/api-response';
import {
  loadSession,
  saveSession,
  type SecretaryMessage,
  type SecretaryAction,
} from '@/lib/services/secretary-session';
import { getEmployeeById, getAllEmployees } from '@/lib/services/employee-service';
import {
  loadMemory,
  upsertEntry,
  saveMemory,
} from '@/lib/services/secretary-memory';
import { extractMemoryFromConversation } from '@/lib/services/secretary-memory-extractor';
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
import type { DispatchImageFile } from '@/lib/services/secretary-dispatch';
import {
  processSessionForSummarization,
  formatSummaryForPrompt,
} from '@/lib/services/conversation-summarizer';
import {
  recordDispatchEvent,
  recordSkillCallEvent,
  getRecentWorkEvents,
} from '@/lib/services/work-event-recorder';
import { detectCorrection } from '@/lib/services/correction-detector';
import { recordCorrection } from '@/lib/services/correction-recorder';
import { checkAndPromoteRules } from '@/lib/services/rule-promoter';
import { searchDispatchLearnings } from '@/lib/services/correction-retriever';
import { loadIntentExamples, formatIntentExamplesBlock } from '@/lib/services/intent-example-store';
import { timelineLogger } from '@/lib/services/timeline';
import type { Employee } from '@/types/backend/employee';

// ========== Helpers ==========

/**
 * 从 Step1 分类结果的 target 字符串中解析出 employeeId。
 * target 格式可能是：
 *   - "员工名(employee-id)" — 分类 prompt 中的格式
 *   - "employee-id" — 直接 ID
 *   - "员工名" — 仅名称
 */
function resolveEmployeeId(target: string, allEmployees: Employee[]): string | null {
  // 1. 尝试从 "名称(id)" 格式提取
  const parenMatch = target.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const idCandidate = parenMatch[1];
    if (allEmployees.some(e => e.id === idCandidate)) return idCandidate;
  }

  // 2. 直接匹配 ID
  const byId = allEmployees.find(e => e.id === target);
  if (byId) return byId.id;

  // 3. 匹配名称
  const byName = allEmployees.find(e => e.name === target);
  if (byName) return byName.id;

  // 4. 模糊匹配：target 包含员工名或员工名包含 target
  const fuzzy = allEmployees.find(e =>
    target.includes(e.name) || e.name.includes(target)
  );
  if (fuzzy) return fuzzy.id;

  return null;
}

/**
 * Persist base64 image data to disk and build DispatchImageFile array.
 * Returns both disk file references (for dispatch) and public URLs (for session display).
 */
async function persistImagesToDisk(
  images: Array<{ base64: string; mimeType: string }>
): Promise<{ imageFiles: DispatchImageFile[]; imageUrls: string[] }> {
  const fsModule = await import('fs/promises');
  const pathModule = await import('path');
  const { randomUUID } = await import('crypto');

  const uploadsDir = pathModule.default.join(process.cwd(), 'data', 'secretary-uploads');
  const publicDir = pathModule.default.join(process.cwd(), 'public', 'uploads');
  await fsModule.default.mkdir(uploadsDir, { recursive: true });
  await fsModule.default.mkdir(publicDir, { recursive: true });

  const imageFiles: DispatchImageFile[] = [];
  const imageUrls: string[] = [];

  for (const img of images) {
    const base64Match = img.base64.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) continue;

    const ext = img.mimeType.split('/')[1] || 'png';
    const filename = `${randomUUID()}.${ext}`;
    const absolutePath = pathModule.default.join(uploadsDir, filename);
    const publicPath = pathModule.default.join(publicDir, filename);

    const buffer = Buffer.from(base64Match[2], 'base64');
    await fsModule.default.writeFile(absolutePath, buffer);
    // Copy to public for web display
    try { await fsModule.default.copyFile(absolutePath, publicPath); } catch { /* non-critical */ }

    imageFiles.push({ filename, originalName: filename, absolutePath });
    imageUrls.push(`/uploads/${filename}`);
  }

  return { imageFiles, imageUrls };
}

// ========== Interfaces ==========

interface SecretaryChatRequest {
  message: string;
  sessionId?: string;
  /** Image attachments as base64 data URLs for vision */
  images?: Array<{ base64: string; mimeType: string }>;
  /** When provided, skip AI call and use this pre-computed result (for direct @mention dispatch) */
  forceDispatchResult?: {
    reply: string;
    actions: SecretaryAction[];
  };
}

interface SecretaryChatResponseData {
  sessionId: string;
  reply: string;
  actions?: SecretaryAction[];
  /** AI 决策置信度 0-1 */
  confidence?: number;
  /** 低置信度时返回的候选决策列表，供用户选择 */
  candidates?: Array<{
    label: string;
    action: SecretaryAction;
    instruction?: string;
  }>;
}

// ========== Route Handler ==========

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request body
    const body = await request.json() as SecretaryChatRequest;
    const { message, forceDispatchResult, images } = body;
    // sessionId is accepted for API compatibility but not used in single-session mode

    console.log(`\n========== [Secretary] ========== 新请求开始 ==========`);
    console.log(`[Secretary] 📩 收到消息: "${message?.slice(0, 100)}"`);
    console.log(`[Secretary] 📎 图片数量: ${images?.length || 0}`);
    console.log(`[Secretary] 🔄 forceDispatchResult: ${!!forceDispatchResult}`);
    const _secretaryStartTime = Date.now();

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return createErrorResponse('消息内容不能为空', 'message is required', 400);
    }

    // 2. Load session (existing or new)
    // Single session mode: one session per homepage secretary
    const session = await loadSession();
    console.log(`[Secretary] 📂 会话加载完成, id=${session.id}, 历史消息数=${session.messages.length}`);

    timelineLogger.logSystem('secretary', `New request received`, 'info', undefined, { messageLength: message.trim().length, hasImages: !!images?.length, historyCount: session.messages.length }).catch(() => {});

    // Persist images to disk early so we have file refs + URLs for all paths
    let persistedImageFiles: DispatchImageFile[] = [];
    let persistedImageUrls: string[] = [];
    if (images && images.length > 0) {
      try {
        const persisted = await persistImagesToDisk(images);
        persistedImageFiles = persisted.imageFiles;
        persistedImageUrls = persisted.imageUrls;
        console.log(`[Secretary] 🖼️ 图片持久化完成: ${persistedImageFiles.length} 张`);
      } catch (err) {
        console.warn('[Secretary] 图片持久化失败:', err);
      }
    }

    // Fast path: direct @mention dispatch — skip AI call, just save to session
    if (forceDispatchResult) {
      const timestamp = new Date().toISOString();
      const userMessage: SecretaryMessage = { role: 'user', content: message.trim(), timestamp, source: 'web', images: persistedImageUrls.length > 0 ? persistedImageUrls : undefined };
      const assistantMessage: SecretaryMessage = {
        role: 'assistant',
        content: forceDispatchResult.reply,
        actions: forceDispatchResult.actions.length > 0 ? forceDispatchResult.actions : undefined,
        timestamp,
        source: 'web',
      };
      session.messages.push(userMessage, assistantMessage);
      await saveSession(session);

      // 注册 dispatch 追踪，任务完成后自动将结果写入秘书会话
      if (forceDispatchResult.actions?.length > 0) {
        const { trackDispatch } = await import('@/lib/services/dispatch-tracker');
        for (const action of forceDispatchResult.actions) {
          if (action.type === 'dispatch' && action.projectId) {
            trackDispatch({
              projectId: action.projectId,
              employeeName: action.employeeName || action.employeeId || '员工',
              source: 'web',
              createdAt: Date.now(),
            });
          }
        }
      }

      const responseData: SecretaryChatResponseData = {
        sessionId: session.id,
        reply: forceDispatchResult.reply,
        actions: forceDispatchResult.actions.length > 0 ? forceDispatchResult.actions : undefined,
      };
      return createSuccessResponse(responseData);
    }

    // 2.5 Early intercept: if message is just "@员工名" without instruction, skip AI entirely
    const trimmedMsg = message.trim();
    if (trimmedMsg.startsWith('@')) {
      const afterAt = trimmedMsg.slice(1).trim();
      const allEmps = await getAllEmployees();
      const matchedEmp = allEmps.find(e => e.name === afterAt);
      if (matchedEmp) {
        // Save to session and return a helpful prompt, no AI call needed
        const timestamp = new Date().toISOString();
        const userMessage: SecretaryMessage = { role: 'user', content: trimmedMsg, timestamp, source: 'web' };
        const hint = matchedEmp.first_prompt || '帮我完成一个任务';
        const replyText = `你提到了 ${afterAt}，请告诉我需要分配什么具体任务？例如：@${afterAt} ${hint}`;
        const assistantMessage: SecretaryMessage = { role: 'assistant', content: replyText, timestamp, source: 'web' };
        session.messages.push(userMessage, assistantMessage);
        await saveSession(session);
        return createSuccessResponse({ sessionId: session.id, reply: replyText } as SecretaryChatResponseData);
      }
    }

    // 2.5b Simple greeting fast-path: skip AI call for trivial messages
    if (isSimpleGreeting(trimmedMsg)) {
      const timestamp = new Date().toISOString();
      const greetReply = pickGreetingReply(trimmedMsg);
      const userMessage: SecretaryMessage = { role: 'user', content: trimmedMsg, timestamp, source: 'web' };
      const assistantMessage: SecretaryMessage = { role: 'assistant', content: greetReply, timestamp, source: 'web' };
      session.messages.push(userMessage, assistantMessage);
      await saveSession(session);
      return createSuccessResponse({ sessionId: session.id, reply: greetReply } as SecretaryChatResponseData);
    }

    // 2.6 Load memory for personalization (retrieval-based, not full injection)
    const memory = await loadMemory();

    // 2.7 Search for relevant memory entries
    // For identity-related queries, inject all user_profile entries directly
    // For other queries, use BM25 retrieval (skip only single-char messages)
    let retrievalResults: ReturnType<typeof searchMemory> = [];
    const isIdentityQuery = /^(我是谁|你认识我吗|你知道我是谁|我的信息|我的资料|关于我)/.test(trimmedMsg);

    if (isIdentityQuery) {
      // Directly return all user_profile entries as high-score results
      retrievalResults = (memory.user_profile || []).map(entry => ({
        entry,
        score: 1.0,
        layer: 'long_term' as const,
      }));
    } else if (trimmedMsg.length > 1) {
      retrievalResults = searchMemory(trimmedMsg, memory, 10);
    }

    // 3. Load the secretary employee's system prompt
    const secretary = await getEmployeeById('builtin-secretary');
    if (!secretary) {
      return createErrorResponse(
        '秘书员工未找到',
        'builtin-secretary employee not found',
        500
      );
    }

    // ========== 两步走意图识别 ==========

    // Step 1: 轻量意图分类（只传意图样本 + 用户消息，不传历史/memory/soul）
    let intentExamples: import('@/lib/services/intent-example-store').IntentExample[] = [];
    try {
      intentExamples = await loadIntentExamples(15);
      if (intentExamples.length > 0) {
        console.log(`[Secretary] 📚 加载意图样本 ${intentExamples.length} 条`);
      }
    } catch {
      // never-throw
    }

    const { classifyIntent, buildDetailedPrompt } = await import('@/lib/services/secretary-intent');
    const summaryText = session.summary?.text || '';
    // Load Claude config once for the entire request lifecycle
    const claudeConfig = await loadClaudeConfig();
    const classification = await classifyIntent(trimmedMsg, summaryText || undefined, intentExamples, claudeConfig);
    console.log(`[Secretary] 🏷️ Step1 意图分类: intent=${classification.intent}, target=${classification.target || 'N/A'}`);

    timelineLogger.logSystem('secretary', `Intent classification: ${classification.intent}${classification.target ? ` -> ${classification.target}` : ''}`, 'info', undefined, { intent: classification.intent, target: classification.target, fastPath: false }).catch(() => {});

    // ========== Fast-path: dispatch 且 target 已知 → 跳过 Step 2，直接执行 ==========
    if (classification.intent === 'dispatch' && classification.target) {
      const resolvedId = resolveEmployeeId(classification.target, await getAllEmployees());
      if (resolvedId) {
        console.log(`[Secretary] ⚡ Fast-path dispatch: target="${classification.target}" → employeeId=${resolvedId}, 跳过 Step2`);

        timelineLogger.logSystem('secretary', `Fast-path dispatch: ${classification.target} -> ${resolvedId}`, 'info', undefined, { intent: 'dispatch', target: classification.target, employeeId: resolvedId }).catch(() => {});
        const fastDecision: import('@/lib/services/secretary-core').AIDecision = {
          action: 'dispatch',
          employeeId: resolvedId,
          instruction: message.trim(),
          confidence: 0.9,
        };

        // Forward persisted images to dispatch if available
        const dispatchResult = await executeDispatch(fastDecision, persistedImageFiles.length > 0 ? persistedImageFiles : undefined, message.trim(), classification.target);
        const fastReply = dispatchResult.reply;
        const fastActions = dispatchResult.actions.map(a => ({ ...a, confidence: 0.9 }));

        // 注册 dispatch 追踪
        if (fastActions.length > 0 && fastActions[0].projectId) {
          const { trackDispatch } = await import('@/lib/services/dispatch-tracker');
          trackDispatch({
            projectId: fastActions[0].projectId,
            employeeName: fastActions[0].employeeName || fastActions[0].employeeId || '员工',
            source: 'web',
            createdAt: Date.now(),
          });
        }
        recordDispatchEvent(fastActions[0]?.employeeName || resolvedId, message.trim()).catch(() => {});

        // 保存会话
        const timestamp = new Date().toISOString();
        const userMessage: SecretaryMessage = { role: 'user', content: message.trim(), timestamp, source: 'web', images: persistedImageUrls.length > 0 ? persistedImageUrls : undefined };
        const assistantMessage: SecretaryMessage = {
          role: 'assistant',
          content: fastReply,
          actions: fastActions.length > 0 ? fastActions : undefined,
          timestamp,
          source: 'web',
        };
        session.messages.push(userMessage, assistantMessage);
        await saveSession(session);

        // 触发摘要
        const summarizeResult = processSessionForSummarization(session.messages, session.summary || null);
        if (summarizeResult) {
          session.summary = summarizeResult.summary;
          saveSession(session).catch(() => {});
        }

        console.log(`[Secretary] ========== 请求完成（fast-path dispatch） ==========`);
        console.log(`[Secretary] ⏱️ 总耗时: ${Date.now() - _secretaryStartTime}ms`);
        console.log(`========== [Secretary] ========== 请求结束 ==========\n`);

        return createSuccessResponse({
          sessionId: session.id,
          reply: fastReply,
          actions: fastActions.length > 0 ? fastActions : undefined,
          confidence: 0.9,
        } as SecretaryChatResponseData);
      }
      // resolvedId 为 null → target 无法匹配，fall through 到 Step 2
      console.log(`[Secretary] ⚠️ Fast-path dispatch: 无法解析 target="${classification.target}"，回退到 Step2`);
    }

    // Step 2: 根据意图类型构建详细 prompt
    // skill_call 只需要 API 端点信息，不需要 memory/summary/workEvents 等
    // direct_reply 需要完整上下文（记忆、摘要、工作事件等）
    // dispatch 走到这里说明 fast-path 失败了，也需要完整上下文
    let extraContext = '';
    if (classification.intent !== 'skill_call') {
      const memoryBlock = buildMemoryPromptBlockFromResults(retrievalResults);
      const summaryBlock = formatSummaryForPrompt(session.summary || null);
      const workEventsBlock = await getRecentWorkEvents(7);
      let dispatchLearningsBlock = '';
      try {
        dispatchLearningsBlock = searchDispatchLearnings(trimmedMsg, memory);
      } catch {
        // never-throw
      }
      // Only inject intent examples for direct_reply; dispatch/skill_call have forced instructions from Step 1
      const intentExamplesBlock = classification.intent === 'direct_reply' ? formatIntentExamplesBlock(intentExamples) : '';
      extraContext = [intentExamplesBlock, memoryBlock, summaryBlock, workEventsBlock, dispatchLearningsBlock].filter(Boolean).join('\n\n');
    }

    const systemPrompt = await buildDetailedPrompt(
      classification.intent,
      secretary.system_prompt || '',
      extraContext,
      classification.target,
    );
    console.log(`[Secretary] 📝 Step2 详细 prompt 构建完成, intent=${classification.intent}, 长度=${systemPrompt.length}`);

    // 5. Build messages array — only for Step 2 (detailed execution)
    const conversationMessages: Array<{
      role: 'user' | 'assistant';
      content: string | any[];
    }> = [];

    // skill_call: 不传历史记录，只传用户消息（API 端点信息已在 systemPrompt 中）
    // direct_reply: 需要历史记录保持对话连贯
    // dispatch (fallback): 少量历史即可
    if (classification.intent !== 'skill_call') {
      const historyLimit = classification.intent === 'direct_reply' ? 6 : 2;
      const recentMessages = session.messages.slice(-historyLimit);
      for (const msg of recentMessages) {
        conversationMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Add the new user message with date context prefix
    const currentTime = new Date();
    const datePrefix = `[当前时间: ${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, '0')}-${String(currentTime.getDate()).padStart(2, '0')} ${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}]\n`;

    // Build user message content - support multimodal (text + images)
    if (images && images.length > 0) {
      const contentBlocks: Array<any> = [];
      // Add images first
      for (const img of images) {
        // Extract base64 data from data URL
        const base64Match = img.base64.match(/^data:([^;]+);base64,(.+)$/);
        if (base64Match) {
          contentBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: base64Match[1],
              data: base64Match[2],
            },
          });
        }
      }
      // Add text
      contentBlocks.push({ type: 'text', text: datePrefix + message.trim() });
      conversationMessages.push({ role: 'user', content: contentBlocks as any });
    } else {
      conversationMessages.push({
        role: 'user',
        content: datePrefix + message.trim(),
      });
    }

    // 6. Claude config already loaded above (claudeConfig)

    if (!claudeConfig.apiKey) {
      return createErrorResponse(
        'AI 服务未配置',
        'API key not configured. Please configure Claude API key in settings.',
        500
      );
    }

    // 7. Call Claude API
    console.log(`[Secretary] 🤖 调用 Claude API, model=${claudeConfig.model}, 消息数=${conversationMessages.length}`);
    const _apiStartTime = Date.now();
    const aiResponseText = await callClaudeAPI(
      systemPrompt,
      conversationMessages,
      claudeConfig
    );
    console.log(`[Secretary] ✅ Claude API 返回, 耗时=${Date.now() - _apiStartTime}ms, 响应长度=${aiResponseText.length}`);
    console.log(`[Secretary] 📄 AI 原始响应: ${aiResponseText.slice(0, 300)}`);

    // 8. Parse AI decision
    let decision = parseAIDecision(aiResponseText);
    const confidence = typeof decision.confidence === 'number' ? decision.confidence : 1.0;
    console.log(`[Secretary] 🎯 AI 决策: action=${decision.action}, confidence=${confidence}, employeeId=${(decision as any).employeeId || "N/A"}, skillName=${(decision as any).skillName || "N/A"}`);
    console.log(`[Secretary] 📋 决策详情:`, JSON.stringify(decision, null, 2).slice(0, 500));

    // 8.4 Guard: 如果 Step1 分类为 skill_call，但 AI 输出了 dispatch，重新调用 AI 生成 skill_call
    if (classification.intent === 'skill_call' && decision.action === 'dispatch') {
      console.log(`[Secretary] ⚠️ 检测到意图漂移: Step1=skill_call 但 AI 输出=dispatch，重新生成 skill_call`);
      
      // 构建强制 skill_call 的提示
      const forceSkillCallPrompt = `你之前输出了 dispatch，但这是一个技能接口调用（skill_call），不是员工调度。
目标技能: ${classification.target}

请重新输出 skill_call JSON，包含完整的 method、path、body 等参数。
只返回 JSON，不要任何其他文字。`;
      
      const retryMessages = [
        ...conversationMessages,
        { role: 'assistant' as const, content: aiResponseText },
        { role: 'user' as const, content: forceSkillCallPrompt },
      ];
      
      const retryText = await callClaudeAPI(systemPrompt, retryMessages, claudeConfig);
      decision = parseAIDecision(retryText);
      console.log(`[Secretary] 📋 纠正后决策:`, JSON.stringify(decision, null, 2).slice(0, 300));
    }

    // 8.5 (mention-only interception moved to step 2.5 — before AI call)

    // 8.6 Self-evolution: detect correction signal and record if found
    try {
      const correction = detectCorrection(message.trim(), session.messages);
      if (correction) {
        recordCorrection(correction).catch(() => {});
        checkAndPromoteRules().catch(() => {});
      }
    } catch {
      // never-throw: self-evolution must not affect main flow
    }

    // 8.7 Low confidence threshold — return candidates for user confirmation
    const CONFIDENCE_THRESHOLD = 0.75;
    if (confidence < CONFIDENCE_THRESHOLD && decision.action !== 'direct_reply') {
      console.log(`[Secretary] ⚠️ 置信度 ${confidence} < ${CONFIDENCE_THRESHOLD}，返回候选列表供用户确认`);

      // Build candidate list from the AI's decision + fallback options
      const candidates: SecretaryChatResponseData['candidates'] = [];

      // Primary candidate: the AI's own decision
      if (decision.action === 'dispatch' && decision.employeeId) {
        const emp = await getEmployeeById(decision.employeeId);
        candidates.push({
          label: `调度给 ${emp?.name || decision.employeeId}`,
          action: { type: 'dispatch', employeeId: decision.employeeId, employeeName: emp?.name },
          instruction: decision.instruction,
        });
      } else if (decision.action === 'skill_call' && decision.skillName) {
        candidates.push({
          label: `调用技能 ${decision.skillName}`,
          action: { type: 'skill_call', skillName: decision.skillName, endpoint: `${decision.method} ${decision.path}` },
        });
      }

      // Add alternative candidates: other plausible employees/skills
      const allEmps = await getAllEmployees();
      const dispatchable = allEmps.filter(
        e => e.mode !== 'secretary' && e.mode !== 'boss' && e.mode !== 'cli' && e.id !== 'builtin-boss' && e.id !== decision.employeeId
      );
      for (const emp of dispatchable.slice(0, 3)) {
        candidates.push({
          label: `调度给 ${emp.name}`,
          action: { type: 'dispatch', employeeId: emp.id, employeeName: emp.name },
          instruction: decision.instruction || message.trim(),
        });
      }

      // Save user message to session (but not assistant yet — waiting for confirmation)
      const timestamp = new Date().toISOString();
      const userMessage: SecretaryMessage = { role: 'user', content: message.trim(), timestamp, source: 'web' };
      const pendingReply = `我不太确定该怎么处理这个请求（置信度 ${Math.round(confidence * 100)}%），请选择一个操作：`;
      const assistantMessage: SecretaryMessage = { role: 'assistant', content: pendingReply, timestamp, source: 'web' };
      session.messages.push(userMessage, assistantMessage);
      await saveSession(session);

      const responseData: SecretaryChatResponseData = {
        sessionId: session.id,
        reply: pendingReply,
        confidence,
        candidates,
      };

      console.log(`[Secretary] ========== 请求完成（低置信度） ==========`);
      console.log(`[Secretary] ⏱️ 总耗时: ${Date.now() - _secretaryStartTime}ms`);
      console.log(`[Secretary] 📌 候选数量: ${candidates.length}`);
      console.log(`========== [Secretary] ========== 请求结束 ==========\n`);

      return createSuccessResponse(responseData);
    }

    // 9. Execute the decided action
    let reply: string;
    let actions: SecretaryAction[] = [];

    switch (decision.action) {
      case 'dispatch': {
        console.log(`[Secretary] \u{1F680} dispatch: employeeId=${decision.employeeId}`);
        const dispatchResult = await executeDispatch(decision, persistedImageFiles.length > 0 ? persistedImageFiles : undefined, message.trim(), classification.target);
        reply = dispatchResult.reply;
        actions = dispatchResult.actions.map(a => ({ ...a, confidence }));
        // 注册 dispatch 追踪，任务完成后自动写入会话
        if (actions.length > 0 && actions[0].projectId) {
          const { trackDispatch } = await import('@/lib/services/dispatch-tracker');
          trackDispatch({
            projectId: actions[0].projectId,
            employeeName: actions[0].employeeName || actions[0].employeeId || '员工',
            source: 'web',
            createdAt: Date.now(),
          });
        }
        // 记录工作事件（fire-and-forget）
        const empName = actions[0]?.employeeName || actions[0]?.employeeId || '员工';
        recordDispatchEvent(empName, message.trim()).catch(() => {});
        break;
      }
      case 'skill_call': {
        console.log(`[Secretary] \u{1F527} skill_call: skillName=${(decision as any).skillName}`);
        const MAX_SKILL_RETRIES = 3;
        let skillReply = '';
        let skillActions: SecretaryAction[] = [];
        let currentDecision = decision;
        let retryMessages = [...conversationMessages];
      
        for (let attempt = 1; attempt <= MAX_SKILL_RETRIES; attempt++) {
          const skillResult = await executeSkillCall(currentDecision, persistedImageFiles.length > 0 ? persistedImageFiles : undefined, message.trim(), classification.target);
      
          // Check if the result indicates missing required fields
          if (skillResult.reply.startsWith('__MISSING_FIELDS__:')) {
            const missingFields = skillResult.reply.replace('__MISSING_FIELDS__:', '').split(',');
            console.log(`[Secretary] \u26a0\ufe0f skill_call \u7b2c${attempt}\u6b21\u5c1d\u8bd5\u7f3a\u5c11\u5fc5\u586b\u5b57\u6bb5: ${missingFields.join(', ')}`);
      
            if (attempt < MAX_SKILL_RETRIES) {
              // Append error feedback and re-call AI
              retryMessages = [
                ...retryMessages,
                { role: 'assistant' as const, content: aiResponseText },
                { role: 'user' as const, content: `\u4e0a\u6b21\u751f\u6210\u7684 skill_call body \u7f3a\u5c11\u5fc5\u586b\u5b57\u6bb5: ${missingFields.join(', ')}\u3002\u8bf7\u91cd\u65b0\u751f\u6210\u5b8c\u6574\u7684 JSON\uff0c\u786e\u4fdd body \u4e2d\u5305\u542b\u6240\u6709\u5fc5\u586b\u5b57\u6bb5\u3002` },
              ];
              console.log(`[Secretary] \ud83d\udd04 \u91cd\u65b0\u8c03\u7528 AI \u751f\u6210 (\u7b2c${attempt + 1}\u6b21)...`);
              const retryText = await callClaudeAPI(systemPrompt, retryMessages, claudeConfig);
              currentDecision = parseAIDecision(retryText);
              console.log(`[Secretary] \ud83d\udccb \u91cd\u8bd5\u51b3\u7b56:`, JSON.stringify(currentDecision, null, 2).slice(0, 300));
              continue;
           }

            // Last attempt still failed — hint user to check their input
            skillReply = `抱歉，我尝试了${MAX_SKILL_RETRIES}次都无法正确生成请求（缺少${missingFields.join('、')}）。请检查一下您的输入是否描述清楚了？例如试试："帮我创建一个待办：明天去北京出差"`;
            skillActions = skillResult.actions.map(a => ({ ...a, confidence }));
          } else {
            // Success or other error — use as-is
            skillReply = skillResult.reply;
            skillActions = skillResult.actions.map(a => ({ ...a, confidence }));
            if (attempt > 1) {
              console.log(`[Secretary] \u2705 skill_call \u7b2c${attempt}\u6b21\u5c1d\u8bd5\u6210\u529f`);
            }
          }
          break;
        }
      
        reply = skillReply;
        actions = skillActions;
        // \u8bb0\u5f55\u6280\u80fd\u8c03\u7528\u4e8b\u4ef6\uff08fire-and-forget\uff09
        const sName = actions[0]?.skillName || decision.skillName || '\u6280\u80fd';
        recordSkillCallEvent(sName, message.trim()).catch(() => {});
        break;
      }
      case 'direct_reply':
      default: {
        console.log(`[Secretary] 💬 直接回复, 长度=${(decision.reply || aiResponseText).length}`);
        reply = decision.reply || aiResponseText;
        break;
      }
    }

    // 10. Save updated session with new messages
    const timestamp = new Date().toISOString();

    const userMessage: SecretaryMessage = {
      role: 'user',
      content: message.trim(),
      timestamp,
      source: 'web',
      images: persistedImageUrls.length > 0 ? persistedImageUrls : undefined,
    };

    const assistantMessage: SecretaryMessage = {
      role: 'assistant',
      content: reply,
      actions: actions.length > 0 ? actions : undefined,
      timestamp,
      source: 'web',
    };

    session.messages.push(userMessage, assistantMessage);
    await saveSession(session);

    // 10.5 Extract memory from conversation (fire-and-forget)
    // Analyzes user message + assistant reply to extract user_profile, learned_preference, interaction_pattern
    (async () => {
      try {
        const claudeConfig = await loadClaudeConfig();
        const extractedItems = await extractMemoryFromConversation(message.trim(), reply, claudeConfig);
        if (extractedItems.length > 0) {
          let mem: any = await loadMemory();
          for (const item of extractedItems) {
            mem = upsertEntry(mem, item.category as any, item);
          }
          await saveMemory(mem as any);
          console.log(`[Secretary] 🧠 提取并保存了 ${extractedItems.length} 条记忆`);
        }
      } catch (err) {
        console.warn('[Secretary] 记忆提取失败:', err);
      }
    })();

    // 10.6 Trigger conversation summarization if message count exceeds threshold
    // This compresses old messages into a summary, keeping recent ones intact
    const summarizeResult = processSessionForSummarization(
      session.messages,
      session.summary || null,
    );
    if (summarizeResult) {
      session.summary = summarizeResult.summary;
      // Save again with updated summary (fire-and-forget is fine)
      saveSession(session).catch((err) =>
        console.warn('[Secretary] 保存摘要失败:', err)
      );
    }

    // 11. Return response (does NOT create any projects - Req 5.1)
    const responseData: SecretaryChatResponseData = {
      sessionId: session.id,
      reply,
      actions: actions.length > 0 ? actions : undefined,
      confidence,
    };

    console.log(`[Secretary] ========== 请求完成 ==========`);
    console.log(`[Secretary] ⏱️ 总耗时: ${Date.now() - _secretaryStartTime}ms`);
    console.log(`[Secretary] 🎯 最终动作: ${decision.action}`);
    console.log(`[Secretary] 💬 回复: "${reply.slice(0, 100)}"`);
    console.log(`[Secretary] 📌 actions 数量: ${actions.length}`);
    console.log(`========== [Secretary] ========== 请求结束 ==========\n`);

    timelineLogger.logSystem('secretary', `Request completed: ${decision.action}`, 'info', undefined, {
      action: decision.action,
      durationMs: Date.now() - _secretaryStartTime,
      replyLength: reply.length,
      actionsCount: actions.length,
      confidence,
    }).catch(() => {});

    return createSuccessResponse(responseData);
  } catch (error) {
    return handleApiError(
      error,
      'SecretaryChatAPI',
      '秘书聊天服务出错'
    );
  }
}

/**
 * GET /api/chat/home/secretary
 * Load the existing secretary session (messages history).
 * Supports pagination with query parameters: page (default 1) and limit (default 20).
 * Returns messages in chronological order (oldest to newest), with page 1 being the most recent messages.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const since = searchParams.get('since'); // ISO timestamp — 只返回此时间之后的新消息

    // Validate pagination parameters
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100); // Max 100 messages per page

    const session = await loadSession();

    // 轻量级轮询：只返回 since 之后的新消息
    if (since) {
      const newMessages = session.messages.filter((m) => m.timestamp > since);
      return createSuccessResponse({
        sessionId: session.id,
        messages: newMessages,
        total: session.messages.length,
      });
    }

    const totalMessages = session.messages.length;
    
    // Calculate pagination (page 1 = most recent messages)
    const totalPages = Math.ceil(totalMessages / validLimit);
    
    // Calculate slice indices for reverse pagination
    // Page 1: last 20 messages, Page 2: messages 21-40 from end, etc.
    const endIndex = totalMessages - ((validPage - 1) * validLimit);
    const startIndex = Math.max(0, endIndex - validLimit);
    
    // Get messages for the requested page (in chronological order)
    const paginatedMessages = session.messages.slice(startIndex, endIndex);

    return createSuccessResponse({
      sessionId: session.id,
      messages: paginatedMessages,
      pagination: {
        page: validPage,
        limit: validLimit,
        total: totalMessages,
        totalPages,
        hasMore: validPage < totalPages,
      },
    });
  } catch (error) {
    return handleApiError(error, 'SecretaryChatAPI', '加载秘书会话失败');
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

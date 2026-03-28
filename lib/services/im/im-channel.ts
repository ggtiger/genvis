/**
 * IM Channel Message Processor
 *
 * Unified message processing pipeline shared by both Stream and Webhook adapters.
 * Flow: Rate limit check → Unsupported type handling → Load session →
 *       Check ConversationContext → Route to project OR Save to secretary session + AI processing
 *
 * Messages to secretary are auto-processed by AI with streaming events (ai_stream_start/delta/end).
 *
 * Validates: Requirements 4.1, 4.3, 4.5, 3.7
 */

import type { IMStandardMessage, IMReplyRequest, IMChannelConfig, IMPlatform } from './types';
import type { IMAdapterBase } from './adapter';
import type { IMSession } from './im-session';

// ========== Platform Display Name Mapping ==========
/** 平台友好名称映射 */
const PLATFORM_DISPLAY_NAMES: Record<IMPlatform, string> = {
  wechat_personal: '微信用户',
  wechat: '微信用户',
  dingtalk: '钉钉用户',
  feishu: '飞书用户',
  qq: 'QQ用户',
  wecom: '企微用户',
};

/** 获取消息发送者显示名称 */
function getSenderDisplayName(message: IMStandardMessage): string {
  // 优先使用消息中的 senderName（如用户昵称）
  if (message.senderName) {
    return message.senderName;
  }
  // 其次使用平台友好名称
  return PLATFORM_DISPLAY_NAMES[message.platform] || message.platform;
}
import { isRateLimited, recordMessage } from './rate-limiter';
import { loadIMSession, saveIMSession } from './im-session';
import { createSecretaryMessage } from '@/lib/services/secretary/secretary-message-service';
import { secretaryStream } from '@/lib/services/secretary-stream';
import { executeSecretaryClaude, SECRETARY_SENDER_ID, SECRETARY_SENDER_NAME } from '@/lib/services/secretary/secretary-claude';
import { randomUUID } from 'crypto';
import { downloadAndStoreVoice } from '@/lib/services/voice/voice-storage';
import { downloadAndStoreImage } from '@/lib/services/image/image-storage';
import { downloadAndStoreFile } from '@/lib/services/file/file-storage';
import { getSecretaryMessages, type SecretaryMessage } from '@/lib/services/secretary/secretary-message-service';
// Note: fs/path imports removed - AI has its own tools to read files

/** Format file size for display */
function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '未知大小';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ========== AI Context History Builder ==========

/**
 * Build conversation history string for AI context.
 * Formats file/image/voice messages into meaningful text.
 * File paths are passed to AI so it can read them with its own tools.
 */
async function buildConversationHistoryForAI(limit: number = 20): Promise<string> {
  try {
    const messages = await getSecretaryMessages({ limit });
    if (messages.length === 0) return '';

    const formattedParts: string[] = [];

    for (const msg of messages) {
      const formatted = await formatMessageForAIContext(msg);
      if (formatted) {
        const role = msg.role === 'user' ? '用户' : '秘书';
        formattedParts.push(`[${role}]: ${formatted}`);
      }
    }

    if (formattedParts.length === 0) return '';

    return `\n========== 最近对话历史 ==========\n${formattedParts.join('\n')}\n==================================\n`;
  } catch (err) {
    console.warn('[IMChannel] Failed to build conversation history:', err);
    return '';
  }
}

/**
 * Format a single message for AI context.
 * Handles different message types (text, file, image, voice).
 */
async function formatMessageForAIContext(msg: SecretaryMessage): Promise<string> {
  switch (msg.messageType) {
    case 'text':
      return msg.content;

    case 'file': {
      const fileInfo = msg.metadata?.fileInfo as {
        name?: string;
        fileName?: string;
        localPath?: string;
        size?: number;
        downloadError?: string;
      } | undefined;

      if (fileInfo) {
        const name = fileInfo.name || fileInfo.fileName || '未知文件';
        const size = formatFileSize(fileInfo.size);
        const localPath = fileInfo.localPath;
        if (localPath) {
          return `[收到文件: ${name} (${size}), 本地路径: ${localPath}]`;
        }
        return `[收到文件: ${name} (${size})]`;
      }
      return msg.content || '[收到文件]';
    }

    case 'image': {
      const imageInfo = msg.metadata?.imageInfo as {
        localPath?: string;
        width?: number;
        height?: number;
        downloadError?: string;
      } | undefined;

      if (imageInfo?.localPath) {
        return `[收到图片, 本地路径: ${imageInfo.localPath}]`;
      }
      return '[收到图片]';
    }

    case 'voice': {
      const voiceInfo = msg.metadata?.voiceInfo as {
        duration?: number;
        transcription?: string;
        downloadError?: string;
      } | undefined;

      if (voiceInfo?.transcription) {
        return `[语音消息] ${voiceInfo.transcription}`;
      }
      if (voiceInfo?.duration) {
        return `[收到语音消息 (${voiceInfo.duration}秒)]`;
      }
      return '[收到语音消息]';
    }

    default:
      // Skip system or other types
      if (msg.role === 'system') return '';
      return msg.content;
  }
}

// ========== IM Reply Deduplication Lock ==========
// Prevents duplicate IM replies for the same requestId
const imReplyLocks = new Set<string>();
const MAX_LOCK_ENTRIES = 500;

/** Clean up old locks to prevent memory leak */
function cleanupOldLocks(): void {
  if (imReplyLocks.size > MAX_LOCK_ENTRIES) {
    const iterator = imReplyLocks.values();
    const toDelete = imReplyLocks.size - MAX_LOCK_ENTRIES;
    for (let i = 0; i < toDelete; i++) {
      const val = iterator.next().value;
      if (val) imReplyLocks.delete(val);
    }
  }
}

// ========== Message Processing Deduplication ==========
// Prevents duplicate processing of the same IM message
const processedIMMessages = new Set<string>();
const MAX_PROCESSED_MESSAGES = 500;

/** Generate a unique key for deduplication based on message content and sender */
function getMessageDedupeKey(message: IMStandardMessage): string {
  // Prefer originalMessageId, fallback to content hash
  if (message.originalMessageId) {
    return `${message.platform}:${message.senderId}:${message.originalMessageId}`;
  }
  // Fallback: use content + timestamp (within 5 second window)
  const timestampWindow = Math.floor((message.timestamp || Date.now()) / 5000);
  return `${message.platform}:${message.senderId}:${timestampWindow}:${message.content.slice(0, 100)}`;
}

/** Clean up old processed message records */
function cleanupOldProcessedMessages(): void {
  if (processedIMMessages.size > MAX_PROCESSED_MESSAGES) {
    const iterator = processedIMMessages.values();
    const toDelete = processedIMMessages.size - MAX_PROCESSED_MESSAGES;
    for (let i = 0; i < toDelete; i++) {
      const val = iterator.next().value;
      if (val) processedIMMessages.delete(val);
    }
  }
}

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

// ========== Main Processing Pipeline ==========

/**
 * Unified message processing pipeline — shared by Stream and Webhook adapters.
 *
 * Flow:
 * 1. Rate limit check
 * 2. Unsupported message type handling
 * 3. Load/create IM session
 * 4. Check ConversationContext for project routing
 * 5. If project context exists → route to project
 * 6. Otherwise → save to secretary session (no AI processing)
 */
export async function processIMMessage(
  message: IMStandardMessage,
  adapter: IMAdapterBase,
  config: IMChannelConfig
): Promise<void> {
  const startTime = Date.now();

  // ========== Message-level deduplication ==========
  // Prevent duplicate processing if the same message is received twice
  const dedupeKey = getMessageDedupeKey(message);
  if (processedIMMessages.has(dedupeKey)) {
    console.log(`[IMChannel] Duplicate message ignored | key=${dedupeKey}`);
    return;
  }
  processedIMMessages.add(dedupeKey);
  cleanupOldProcessedMessages();

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

  // Track whether AI reply has been triggered (to avoid duplicate error notifications)
  let aiReplyTriggered = false;

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
        { ...replyBase(message), content: '目前仅支持文本和语音消息，请发送文字或语音内容。' },
        config
      );
      emitLog({ action: 'unsupported_type', success: true });
      return;
    }

    // 2.5 Voice message handling (before session load, as it's not needed for voice)
    if (message.messageType === 'voice' && message.voicePayload) {
      await handleVoiceMessage(message, adapter, config, emitLog);
      return;
    }

    // 2.6 Image message handling (no AI processing, no ACK)
    if (message.messageType === 'image' && message.imagePayload) {
      await handleImageMessage(message, emitLog);
      return;
    }

    // 2.7 File message handling (no AI processing, no ACK)
    if (message.messageType === 'file' && message.filePayload) {
      await handleFileMessage(message, emitLog);
      return;
    }

    // 3. Load/create IM session
    const session = await loadIMSession(message.platform, message.senderId);

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

    // 4. 保存消息到数据库并触发 AI 处理
    const timestamp = new Date().toISOString();
    const requestId = randomUUID();
    const userMsg = await createSecretaryMessage({
      role: 'user',
      messageType: 'text',
      content: message.content,
      senderId: message.senderId,
      senderName: getSenderDisplayName(message),
      interactionMode: 'ai_chat',
      requestId,
    });

    // 4.1 SSE 推送新消息
    secretaryStream.publish({ type: 'new_message', data: { message: userMsg } });
    console.log(`[IMChannel] 消息已保存到数据库: ${userMsg.id}`);

    // 4.2 触发 AI 流式执行（异步，不阻塞 IM 响应）
    // Note: AI processing runs in background; if it fails, it will send error notification
    handleIMSecretaryAIReply(message.content, requestId, adapter, config, message).catch((err: Error) => {
      console.error('[IMChannel] AI reply failed:', err);
      // AI processing failed, send error notification (since catch block below won't send it)
      adapter.sendReply(
        { ...replyBase(message), content: '抱歉，处理您的消息时出现了问题，请稍后重试。' },
        config
      ).catch(sendErr => console.error('[IMChannel] Failed to send AI error notification:', sendErr));
    });
    aiReplyTriggered = true;

    // 5. 更新 IM session
    session.messages.push({ role: 'user', content: message.content, timestamp });
    await saveIMSession(session);

    emitLog({ action: 'saved_to_secretary', success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : '';
    console.error(`[IMChannel] processIMMessage error:`, errMsg, errStack);

    emitLog({
      action: 'error',
      success: false,
      error: errMsg,
    });

    // Only send error notification if AI processing hasn't been triggered yet
    // If AI is already running in background, it will handle the response
    if (!aiReplyTriggered) {
      try {
        await adapter.sendReply(
          { ...replyBase(message), content: '抱歉，处理您的消息时出现了问题，请稍后重试。' },
          config
        );
      } catch (sendError) {
        console.error('[IMChannel] Failed to send error notification:', sendError);
      }
    } else {
      console.log('[IMChannel] AI reply already triggered, skipping error notification to user');
    }
  }
}


// ========== Voice Message Handling ==========

/**
 * Handle voice message: download, store, optionally transcribe, and save to secretary.
 * Prioritizes WeChat's built-in transcription (text field) if available.
 * Voice file download is optional - message is still saved even if download fails.
 */
async function handleVoiceMessage(
  message: IMStandardMessage,
  adapter: IMAdapterBase,
  config: IMChannelConfig,
  emitLog: (fields: { action: string; success: boolean; error?: string }) => void
): Promise<void> {
  try {
    const voicePayload = message.voicePayload;

    // Use content from adapter (may already include WeChat's transcription)
    const transcription = message.content !== '[语音消息]' ? message.content : undefined;
    const duration = voicePayload?.duration;

    console.log(`[IMChannel] Processing voice message: hasTranscription=${!!transcription}, duration=${duration}s, hasUrl=${!!voicePayload?.voiceUrl}`);

    // 1. Try to download voice file (optional, may fail)
    let voiceInfo: { id: string; url: string; duration: number; format: string; size?: number } | undefined;
    let downloadError: string | undefined;

    if (voicePayload?.voiceUrl) {
      try {
        const voiceResult = await downloadAndStoreVoice({
          voiceUrl: voicePayload.voiceUrl,
          format: voicePayload.format || 'silk',
          duration: voicePayload.duration,
          aesKey: voicePayload.aesKey,
        });

        if (voiceResult.success && voiceResult.voiceInfo) {
          voiceInfo = voiceResult.voiceInfo;
          console.log(`[IMChannel] Voice saved: id=${voiceInfo.id}, path=${voiceResult.voiceInfo.localPath}`);
        } else {
          downloadError = voiceResult.error;
          console.warn('[IMChannel] Voice download failed (non-critical):', downloadError);
        }
      } catch (err) {
        downloadError = err instanceof Error ? err.message : String(err);
        console.warn('[IMChannel] Voice download error (non-critical):', downloadError);
      }
    }

    // 2. Build display content
    let displayContent: string;
    if (transcription) {
      displayContent = `🎤 ${transcription}`;
    } else if (duration) {
      displayContent = `🎤 [语音消息] ${duration}秒`;
    } else {
      displayContent = '🎤 [语音消息]';
    }

    // 3. Create secretary message (always save voiceInfo, even if download failed)
    // Always include voiceInfo in metadata so frontend can render VoicePlayer
    const userMsg = await createSecretaryMessage({
      role: 'user',
      messageType: 'voice',
      content: displayContent,
      senderId: message.senderId,
      senderName: getSenderDisplayName(message),
      interactionMode: 'ai_chat',
      metadata: {
        voiceInfo: {
          id: voiceInfo?.id || null,
          url: voiceInfo?.url || null,
          duration: voiceInfo?.duration || duration || null,
          format: voiceInfo?.format || null,
          size: voiceInfo?.size || null,
          transcription: transcription || null,
          downloadError: downloadError || null,
        },
      },
    });

    // 4. Publish to SSE
    secretaryStream.publish({ type: 'new_message', data: { message: userMsg } });
    console.log(`[IMChannel] Voice message saved to database: ${userMsg.id}`);

    // 5. 如果有转录文本，触发 AI 处理；否则发送 ACK
    if (transcription) {
      const requestId = randomUUID();

      // 异步触发 AI 处理（不阻塞）
      handleIMSecretaryAIReply(transcription, requestId, adapter, config, message).catch((err: Error) => {
        console.error('[IMChannel] Voice AI reply failed:', err);
        adapter.sendReply(
          { ...replyBase(message), content: '语音消息处理失败，请稍后重试。' },
          config
        ).catch(sendErr => console.error('[IMChannel] Failed to send voice AI error:', sendErr));
      });

      emitLog({ action: 'voice_ai_triggered', success: true });
    } else {
      // 没有转录文本，发送 ACK
      const ackText = `已收到语音消息${duration ? ` (${duration}秒)` : ''}`;
      await adapter.sendReply(
        { ...replyBase(message), content: ackText },
        config
      );

      emitLog({ action: 'voice_processed', success: true });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[IMChannel] Voice message handling failed:', errMsg);

    await adapter.sendReply(
      { ...replyBase(message), content: '语音消息处理失败，请稍后重试。' },
      config
    );

    emitLog({ action: 'voice_error', success: false, error: errMsg });
  }
}


// ========== Image Message Handling ==========

/**
 * Handle image message: download, store, and save to secretary.
 * NO AI processing, NO ACK reply to IM.
 */
async function handleImageMessage(
  message: IMStandardMessage,
  emitLog: (fields: { action: string; success: boolean; error?: string }) => void
): Promise<void> {
  try {
    const imagePayload = message.imagePayload;

    console.log(`[IMChannel] Processing image message: hasUrl=${!!imagePayload?.imageUrl}, width=${imagePayload?.width}, height=${imagePayload?.height}`);

    // 1. Try to download image file (optional, may fail)
    let imageInfo: { id: string; url: string; localPath: string; width?: number; height?: number; format: string; size: number } | undefined;
    let downloadError: string | undefined;

    if (imagePayload?.imageUrl) {
      try {
        const imageResult = await downloadAndStoreImage({
          imageUrl: imagePayload.imageUrl,
          width: imagePayload.width,
          height: imagePayload.height,
          size: imagePayload.size,
          aesKey: imagePayload.aesKey,
          format: imagePayload.format || 'jpg',
        });

        if (imageResult.success && imageResult.imageInfo) {
          imageInfo = imageResult.imageInfo;
          console.log(`[IMChannel] Image saved: id=${imageInfo.id}, path=${imageResult.imageInfo.localPath}`);
        } else {
          downloadError = imageResult.error;
          console.warn('[IMChannel] Image download failed (non-critical):', downloadError);
        }
      } catch (err) {
        downloadError = err instanceof Error ? err.message : String(err);
        console.warn('[IMChannel] Image download error (non-critical):', downloadError);
      }
    }

    // 2. Build display content
    const displayContent = '🖼️ [图片消息]';

    // 3. Create secretary message with image info in metadata
    const userMsg = await createSecretaryMessage({
      role: 'user',
      messageType: 'image',
      content: displayContent,
      senderId: message.senderId,
      senderName: getSenderDisplayName(message),
      interactionMode: 'plain', // No AI interaction for images
      metadata: {
        imageInfo: {
          id: imageInfo?.id || null,
          url: imageInfo?.url || null,
          localPath: imageInfo?.localPath || null,
          width: imageInfo?.width || imagePayload?.width || null,
          height: imageInfo?.height || imagePayload?.height || null,
          format: imageInfo?.format || imagePayload?.format || null,
          size: imageInfo?.size || imagePayload?.size || null,
          downloadError: downloadError || null,
        },
      },
    });

    // 4. Publish to SSE
    secretaryStream.publish({ type: 'new_message', data: { message: userMsg } });
    console.log(`[IMChannel] Image message saved to database: ${userMsg.id}`);

    // 5. NO AI processing, NO ACK reply (as per requirements)
    emitLog({ action: 'image_processed', success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[IMChannel] Image message handling failed:', errMsg);

    // Still try to save message even if there's an error
    try {
      const fallbackMsg = await createSecretaryMessage({
        role: 'user',
        messageType: 'image',
        content: '🖼️ [图片消息 - 加载失败]',
        senderId: message.senderId,
        senderName: getSenderDisplayName(message),
        interactionMode: 'plain',
        metadata: {
          imageInfo: {
            error: errMsg,
          },
        },
      });
      secretaryStream.publish({ type: 'new_message', data: { message: fallbackMsg } });
    } catch {
      // Ignore secondary errors
    }

    emitLog({ action: 'image_error', success: false, error: errMsg });
  }
}


// ========== File Message Handling ==========

/**
 * Handle file message: download, store, and save to secretary.
 * NO AI processing, NO ACK reply to IM.
 */
async function handleFileMessage(
  message: IMStandardMessage,
  emitLog: (fields: { action: string; success: boolean; error?: string }) => void
): Promise<void> {
  try {
    const filePayload = message.filePayload;
    const fileName = filePayload?.fileName || 'unknown';

    console.log(`[IMChannel] Processing file message: name=${fileName}, hasUrl=${!!filePayload?.fileUrl}, size=${filePayload?.size}`);

    // 1. Try to download file (optional, may fail)
    let fileInfo: { id: string; url: string; localPath: string; fileName: string; fileType: string; size: number; mimeType: string } | undefined;
    let downloadError: string | undefined;

    if (filePayload?.fileUrl) {
      try {
        const fileResult = await downloadAndStoreFile({
          fileUrl: filePayload.fileUrl,
          fileName,
          size: filePayload.size,
          aesKey: filePayload.aesKey,
          fileType: filePayload.fileType,
        });

        if (fileResult.success && fileResult.fileInfo) {
          fileInfo = fileResult.fileInfo;
          console.log(`[IMChannel] File saved: id=${fileInfo.id}, path=${fileResult.fileInfo.localPath}`);
        } else {
          downloadError = fileResult.error;
          console.warn('[IMChannel] File download failed (non-critical):', downloadError);
        }
      } catch (err) {
        downloadError = err instanceof Error ? err.message : String(err);
        console.warn('[IMChannel] File download error (non-critical):', downloadError);
      }
    }

    // 2. Build display content
    const displayContent = `📄 [文件] ${fileName}`;

    // 3. Create secretary message with file info in metadata
    const userMsg = await createSecretaryMessage({
      role: 'user',
      messageType: 'file',
      content: displayContent,
      senderId: message.senderId,
      senderName: getSenderDisplayName(message),
      interactionMode: 'plain', // No AI interaction for files
      metadata: {
        fileInfo: {
          id: fileInfo?.id || null,
          url: fileInfo?.url || null,
          localPath: fileInfo?.localPath || null,
          name: fileInfo?.fileName || fileName,
          fileType: fileInfo?.fileType || filePayload?.fileType || null,
          size: fileInfo?.size || filePayload?.size || null,
          mimeType: fileInfo?.mimeType || null,
          downloadError: downloadError || null,
        },
      },
    });

    // 4. Publish to SSE
    secretaryStream.publish({ type: 'new_message', data: { message: userMsg } });
    console.log(`[IMChannel] File message saved to database: ${userMsg.id}`);

    // 5. NO AI processing, NO ACK reply (as per requirements)
    emitLog({ action: 'file_processed', success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[IMChannel] File message handling failed:', errMsg);

    // Still try to save message even if there's an error
    try {
      const fallbackMsg = await createSecretaryMessage({
        role: 'user',
        messageType: 'file',
        content: '📄 [文件 - 加载失败]',
        senderId: message.senderId,
        senderName: getSenderDisplayName(message),
        interactionMode: 'plain',
        metadata: {
          fileInfo: {
            error: errMsg,
          },
        },
      });
      secretaryStream.publish({ type: 'new_message', data: { message: fallbackMsg } });
    } catch {
      // Ignore secondary errors
    }

    emitLog({ action: 'file_error', success: false, error: errMsg });
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

    // 同步写入秘书数据库
    try {
      const userMsg = await createSecretaryMessage({
        role: 'user',
        messageType: 'text',
        content: `[回复${employeeName || '项目'}] ${message.content}`,
        senderId: message.senderId,
        senderName: getSenderDisplayName(message),
        interactionMode: 'plain',
      });
      const assistantMsg = await createSecretaryMessage({
        role: 'assistant',
        messageType: 'text',
        content: ack,
        senderId: 'secretary',
        senderName: '秘书',
        interactionMode: 'plain',
      });
      secretaryStream.publish({ type: 'new_message', data: { message: userMsg } });
      secretaryStream.publish({ type: 'new_message', data: { message: assistantMsg } });
    } catch { /* ignore */ }

    // 注册 dispatch 追踪（以便任务完成后回推结果）
    const { trackDispatch } = await import('@/lib/services/dispatch-tracker');
    trackDispatch({
      projectId,
      employeeName: employeeName || '员工',
      source: message.platform as import('@/lib/services/secretary-session').MessageSource,
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

    // 回退：将消息保存到数据库，等待用户处理
    try {
      const fallbackMsg = await createSecretaryMessage({
        role: 'user',
        messageType: 'text',
        content: `[路由失败，请重新处理] ${message.content}`,
        senderId: message.senderId,
        senderName: getSenderDisplayName(message),
        interactionMode: 'plain',
      });
      secretaryStream.publish({ type: 'new_message', data: { message: fallbackMsg } });
      console.log(`[IMChannel] 消息已保存到数据库（路由失败回退）: ${fallbackMsg.id}`);
    } catch (saveErr) {
      console.warn('[IMChannel] 回退保存秘书会话失败:', saveErr);
    }
  }
}

// ========== IM Secretary AI Reply Handler ==========

/**
 * 处理 IM 消息的 AI 回复流程
 * 参考 /api/secretary/messages/route.ts 的 handleAIReply 实现
 */
async function handleIMSecretaryAIReply(
  content: string,
  requestId: string,
  adapter: IMAdapterBase,
  config: IMChannelConfig,
  originalMessage: IMStandardMessage
): Promise<void> {
  // Deduplication: Prevent duplicate IM replies for the same requestId
  if (imReplyLocks.has(requestId)) {
    console.log(`[IMChannel] Duplicate AI reply request ignored | request=${requestId}`);
    return;
  }
  imReplyLocks.add(requestId);
  cleanupOldLocks();

  console.log(`[IMChannel] Starting AI reply | request=${requestId}`);

  // 1. 标记流开始并获取 abort controller
  const abortController = secretaryStream.markStreamActive(requestId);

  // 2. 发送 ai_stream_start 事件，通知前端 AI 正在执行
  secretaryStream.publish({
    type: 'ai_stream_start',
    data: { requestId, timestamp: new Date().toISOString() },
  });

  let persistSuccess = false;

  try {
    // 3. 加载启用的技能
    let enabledSkills: string[] = [];
    try {
      const { getSecretaryEnabledSkills } = await import('@/lib/services/secretary/secretary-settings');
      enabledSkills = await getSecretaryEnabledSkills();
    } catch {
      enabledSkills = [];
    }

    // 3.5 构建对话历史（包含文件/图片/语音消息的格式化内容）
    const conversationHistory = await buildConversationHistoryForAI(20);
    console.log(`[IMChannel] Built conversation history: ${conversationHistory.length} chars`);

    // 4. 执行 Claude Agent SDK (isIMMode=true 禁用自动派发)
    // 将对话历史和当前消息组合在一起
    const messageWithHistory = conversationHistory
      ? `${conversationHistory}\n当前用户消息: ${content}`
      : content;

    const result = await executeSecretaryClaude({
      message: messageWithHistory,
      enabledSkills,
      requestId,
      abortSignal: abortController.signal,
      isIMMode: true,
    });

    // 5. 如果有回复，持久化到数据库并推送事件
    if (result.reply && result.reply.trim()) {
      const aiMessage = await createSecretaryMessage({
        role: 'assistant',
        messageType: 'text',
        content: result.reply.trim(),
        senderId: SECRETARY_SENDER_ID,
        senderName: SECRETARY_SENDER_NAME,
        interactionMode: 'ai_chat',
        requestId,
      });

      persistSuccess = true;

      // 5.1 SSE 推送 AI 回复消息
      secretaryStream.publish({
        type: 'new_message',
        data: { message: aiMessage },
      });

      console.log(`[IMChannel] AI reply persisted and published | request=${requestId}`);

      // 5.2 向 IM 用户发送回复
      try {
        await adapter.sendReply(
          {
            platform: originalMessage.platform,
            conversationId: originalMessage.conversationId,
            senderId: originalMessage.senderId,
            rawPayload: originalMessage.rawPayload,
            content: result.reply.trim(),
          },
          config
        );
        console.log(`[IMChannel] AI reply sent to IM user | request=${requestId}`);
      } catch (sendErr) {
        console.error('[IMChannel] Failed to send AI reply to IM:', sendErr);
      }
    } else {
      persistSuccess = true; // No reply to persist is considered success
    }
  } catch (err) {
    console.error(`[IMChannel] handleIMSecretaryAIReply error | request=${requestId}:`, err);
  } finally {
    // 6. 标记流结束
    secretaryStream.markStreamDone(requestId);

    // 7. 发送 ai_stream_end 事件
    secretaryStream.publish({
      type: 'ai_stream_end',
      data: {
        requestId,
        timestamp: new Date().toISOString(),
        persistSuccess,
      },
    });
  }
}

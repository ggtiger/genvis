/**
 * LAN Peer Chat — Claude Agent SDK Service
 *
 * Full Claude Agent SDK integration for LAN group chat, supporting:
 * - Streaming AI responses (token-by-token via SSE)
 * - Tool chain (Read, Write, Edit, Bash, Glob, Grep)
 * - Session-based context continuity (resume)
 * - Database message persistence
 *
 * Modeled after lib/services/cli/claude.ts but adapted for LAN chat context.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { lanPeerStream } from './lan-peer-stream';
import { createLanMessage } from './lan-message-service';
import { updateGroupSession, getGroup } from './chat-service';
import { buildSoulPromptBlock } from '@/lib/services/secretary-soul';
import { getClaudeCodeExecutablePath, getBuiltinNodeDir } from '@/lib/config/paths';
import { CLAUDE_DEFAULT_MODEL, normalizeClaudeModelId } from '@/lib/constants/claudeModels';

// ========== Constants ==========

export const AI_SENDER_ID = 'ai-assistant';
export const AI_SENDER_NAME = '群助理';

// ========== Tool Action Inference (adapted from project chat) ==========

type ToolAction = 'Read' | 'Created' | 'Edited' | 'Deleted' | 'Searched' | 'Executed' | 'Generated';

const TOOL_NAME_ACTION_MAP: Record<string, ToolAction> = {
  Read: 'Read', read: 'Read', read_file: 'Read', 'read-file': 'Read',
  Write: 'Created', write: 'Created', write_file: 'Created', 'write-file': 'Created', create_file: 'Created',
  Edit: 'Edited', edit: 'Edited', edit_file: 'Edited', 'edit-file': 'Edited', update_file: 'Edited', apply_patch: 'Edited', patch_file: 'Edited',
  remove_file: 'Deleted', delete_file: 'Deleted', delete: 'Deleted', remove: 'Deleted',
  list_files: 'Searched', list: 'Searched', ls: 'Searched',
  Glob: 'Searched', glob: 'Searched', glob_files: 'Searched', search_files: 'Searched',
  Grep: 'Searched', grep: 'Searched',
  Bash: 'Executed', bash: 'Executed', run: 'Executed', run_bash: 'Executed', shell: 'Executed',
  todo_write: 'Generated', todo: 'Generated', plan_write: 'Generated',
};

function inferActionFromToolName(toolName: string): ToolAction {
  const normalized = toolName.trim().toLowerCase();
  if (TOOL_NAME_ACTION_MAP[toolName]) return TOOL_NAME_ACTION_MAP[toolName];
  if (TOOL_NAME_ACTION_MAP[normalized]) return TOOL_NAME_ACTION_MAP[normalized];
  const suffix = normalized.split(':').pop() ?? normalized;
  if (suffix && TOOL_NAME_ACTION_MAP[suffix]) return TOOL_NAME_ACTION_MAP[suffix];
  // Fallback heuristics
  if (/read|open|view/i.test(normalized)) return 'Read';
  if (/write|create|add/i.test(normalized)) return 'Created';
  if (/edit|modify|update|patch/i.test(normalized)) return 'Edited';
  if (/delete|remove/i.test(normalized)) return 'Deleted';
  if (/search|find|list|glob|ls|grep/i.test(normalized)) return 'Searched';
  if (/execute|exec|run|bash|shell|command/i.test(normalized)) return 'Executed';
  return 'Executed';
}

function extractPathFromInput(toolInput: Record<string, unknown>): string | undefined {
  const keys = ['file_path', 'filePath', 'path', 'target', 'file', 'filename', 'directory', 'dir', 'pattern', 'command'];
  for (const key of keys) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return undefined;
}

const LAN_DEFAULT_SYSTEM_PROMPT = `你是一个局域网群聊中的 群助理。
你具备完整的工具能力，可以读写文件、执行命令、搜索代码等。
请根据对话上下文自然地参与讨论，回答问题，提供帮助。
当用户需要操作文件或执行代码时，使用你的工具来完成。
保持简洁友好，用中文回复。

重要：你当前在群聊环境中，不支持交互式工具。
- 禁止使用 AskUserQuestion 或任何需要用户实时输入的工具。
- 如果需要用户确认或选择，请直接在聊天消息中用文字提问，等待用户回复。`;

/**
 * Build the final system prompt for a LAN chat group.
 * Priority: group custom prompt > default, always appended with SOUL block.
 */
async function buildLanSystemPrompt(groupId: string): Promise<string> {
  const parts: string[] = [];

  // 1. Per-group custom prompt or default
  const group = await getGroup(groupId);
  const basePrompt = group?.systemPrompt?.trim() || LAN_DEFAULT_SYSTEM_PROMPT;
  parts.push(basePrompt);

  // 2. SOUL block from settings page (personality + user profile)
  try {
    const soulBlock = await buildSoulPromptBlock();
    if (soulBlock) parts.push(soulBlock);
  } catch (err) {
    console.warn('[LanClaude] Failed to load SOUL block:', err);
  }

  return parts.join('\n\n');
}

const DATA_DIR = path.join(process.cwd(), 'data', 'lan-peer', 'groups');

function groupWorkspace(groupId: string): string {
  return path.join(DATA_DIR, groupId, 'workspace');
}

// ========== Config Loader (reuse from project chat) ==========

async function loadAndApplyClaudeConfig(): Promise<string | undefined> {
  let customModel: string | undefined;
  try {
    const { loadGlobalSettings } = await import('@/lib/services/settings');
    const globalSettings = await loadGlobalSettings();
    const claudeSettings = globalSettings.cli_settings?.claude;

    if (claudeSettings) {
      if (typeof claudeSettings.apiUrl === 'string' && claudeSettings.apiUrl.trim()) {
        process.env.ANTHROPIC_BASE_URL = claudeSettings.apiUrl.trim();
      } else if (!process.env.ANTHROPIC_BASE_URL) {
        process.env.ANTHROPIC_BASE_URL = 'https://api.100agent.co';
      }

      if (typeof claudeSettings.apiKey === 'string' && claudeSettings.apiKey.trim()) {
        process.env.ANTHROPIC_AUTH_TOKEN = claudeSettings.apiKey.trim();
      }

      if (typeof claudeSettings.customModel === 'string' && claudeSettings.customModel.trim()) {
        customModel = claudeSettings.customModel.trim();
      }
    }
  } catch (error) {
    console.error('[LanClaude] Failed to load config:', error);
  }
  return customModel;
}

// ========== Stream State ==========

interface AssistantStreamState {
  messageId: string;
  content: string;
  hasSentUpdate: boolean;
  finalized: boolean;
}

// ========== Main Executor ==========

export interface ExecuteLanClaudeParams {
  groupId: string;
  instruction: string;
  sessionId?: string;
  requestId: string;
  senderName: string;
  abortSignal?: AbortSignal;
}

/**
 * Execute Claude Agent SDK query for a LAN chat group.
 *
 * Streams responses via lanPeerStream SSE events.
 * Persists final messages to the database.
 * Updates group session ID for context continuity.
 */
export async function executeLanClaude(params: ExecuteLanClaudeParams): Promise<void> {
  const { groupId, instruction, sessionId, requestId, senderName, abortSignal } = params;

  console.log(`[LanClaude] Starting | group=${groupId} | session=${sessionId || 'new'} | request=${requestId}`);

  const configuredMaxTokens = Number(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS);
  const maxOutputTokens = Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
    ? configuredMaxTokens
    : 16000;

  // stderr buffer — declared outside try so catch can access it
  const stderrBuffer: string[] = [];

  try {
    // Load config and resolve model
    const customModel = await loadAndApplyClaudeConfig();
    const finalModel = customModel || normalizeClaudeModelId(null);
    console.log(`[LanClaude] Model: ${finalModel}`);

    // Ensure workspace directory exists
    const workspace = groupWorkspace(groupId);
    await fs.mkdir(workspace, { recursive: true });

    // Build env with builtin node
    const envWithBuiltinNode = { ...process.env };
    const builtinNodeDir = getBuiltinNodeDir();
    if (builtinNodeDir) {
      envWithBuiltinNode.PATH = `${builtinNodeDir}:${process.env.PATH || ''}`;
    }

    // canUseTool — auto-approve most tools, but deny interactive tools
    // that require real-time user input (not supported in group chat context)
    const DENIED_TOOLS = new Set([
      'AskUserQuestion', 'ask_user_question', 'askUserQuestion',
      'AskFollowupQuestion', 'ask_followup_question',
    ]);
    const canUseTool = async (toolName: string, toolInput: Record<string, unknown>) => {
      if (DENIED_TOOLS.has(toolName)) {
        return {
          behavior: 'deny' as const,
          message: '群聊环境不支持交互式工具，请直接在消息中提问',
        };
      }
      return { behavior: 'allow' as const, updatedInput: toolInput };
    };

    // PostToolUse hook — capture tool execution results and publish to frontend
    const postToolUseHook = async (input: any, toolUseID: string) => {
      try {
        if (input.hook_event_name !== 'PostToolUse') return {};
        const toolName = input.tool_name || 'unknown';
        const toolInput = input.tool_input || {};
        const toolResponse = input.tool_response || '';

        console.log(`[LanClaude] ✅ PostToolUse: ${toolName} | id=${toolUseID}`);

        const action = inferActionFromToolName(toolName);
        const filePath = extractPathFromInput(toolInput);
        const maxLen = 2000;
        const truncatedResponse = typeof toolResponse === 'string' && toolResponse.length > maxLen
          ? toolResponse.slice(0, maxLen) + '\n...(truncated)'
          : (typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse).slice(0, maxLen));

        const metadata: Record<string, unknown> = {
          toolName, toolInput, toolResponse: truncatedResponse,
          toolUseId: toolUseID, action, filePath,
        };

        // Publish ai_tool_result SSE event
        lanPeerStream.publish({
          type: 'ai_tool_result',
          data: {
            groupId, requestId, toolName, action, filePath,
            toolResponse: truncatedResponse,
            messageId: randomUUID(),
            timestamp: new Date().toISOString(),
          },
        });

        // Persist to DB
        await createLanMessage({
          groupId,
          role: 'tool',
          messageType: 'tool_result',
          content: `Tool result: ${toolName}`,
          senderId: AI_SENDER_ID,
          senderName: AI_SENDER_NAME,
          interactionMode: 'ai_chat',
          metadata,
          requestId,
        });

        return {};
      } catch (error) {
        console.warn(`[LanClaude] Error in PostToolUse hook:`, error);
        return {};
      }
    };

    // PostToolUseFailure hook — capture tool execution failures
    const postToolUseFailureHook = async (input: any, toolUseID: string) => {
      try {
        if (input.hook_event_name !== 'PostToolUseFailure') return {};
        const toolName = input.tool_name || 'unknown';
        const toolInput = input.tool_input || {};
        const error = input.error || 'Unknown error';

        console.log(`[LanClaude] ❌ PostToolUseFailure: ${toolName} | id=${toolUseID}`);

        const action = inferActionFromToolName(toolName);
        const filePath = extractPathFromInput(toolInput);
        const metadata: Record<string, unknown> = {
          toolName, toolInput,
          toolError: typeof error === 'string' ? error : JSON.stringify(error),
          toolUseId: toolUseID, action, filePath, isError: true,
        };

        lanPeerStream.publish({
          type: 'ai_tool_result',
          data: {
            groupId, requestId, toolName, action, filePath,
            toolError: metadata.toolError,
            isError: true,
            messageId: randomUUID(),
            timestamp: new Date().toISOString(),
          },
        });

        await createLanMessage({
          groupId,
          role: 'tool',
          messageType: 'tool_result',
          content: `Tool failed: ${toolName}`,
          senderId: AI_SENDER_ID,
          senderName: AI_SENDER_NAME,
          interactionMode: 'ai_chat',
          metadata,
          requestId,
        });

        return {};
      } catch (err) {
        console.warn(`[LanClaude] Error in PostToolUseFailure hook:`, err);
        return {};
      }
    };

    // Build hooks config
    const hooks = {
      PostToolUse: [{ hooks: [postToolUseHook] }],
      PostToolUseFailure: [{ hooks: [postToolUseFailureHook] }],
    };

    // Call Claude Agent SDK
    const response = query({
      prompt: instruction,
      options: {
        cwd: workspace,
        additionalDirectories: [workspace],
        model: finalModel,
        resume: sessionId,
        permissionMode: 'bypassPermissions',
        systemPrompt: await buildLanSystemPrompt(groupId),
        maxOutputTokens,
        pathToClaudeCodeExecutable: getClaudeCodeExecutablePath(),
        env: envWithBuiltinNode,
        canUseTool,
        hooks,
        stderr: (data: string) => {
          const line = String(data).trimEnd();
          if (!line) return;
          if (stderrBuffer.length > 100) stderrBuffer.shift();
          stderrBuffer.push(line);
          console.error(`[LanClaude][stderr] ${line}`);
        },
      } as any,
    });

    // Track assistant stream states (keyed by session key)
    const assistantStreamStates = new Map<string, AssistantStreamState>();
    const completedStreamSessions = new Set<string>();
    let hasPublishedContent = false;

    // Iterate streaming response
    for await (const message of response) {
      // Check abort signal at the start of each iteration
      if (abortSignal?.aborted) {
        console.log(`[LanClaude] Aborted by user | group=${groupId} | request=${requestId}`);
        // Try to close the async iterator gracefully
        try { (response as any).return?.(); } catch {}
        break;
      }

      console.log(`[LanClaude] SDK message: type=${message.type}`);

      // ─── stream_event: real-time streaming chunks ───
      if (message.type === 'stream_event') {
        const event: any = (message as any).event ?? {};
        const sessionKey = ((message as any).session_id ?? (message as any).uuid ?? 'default').toString();

        let streamState = assistantStreamStates.get(sessionKey);

        switch (event.type) {
          case 'message_start': {
            const newState: AssistantStreamState = {
              messageId: randomUUID(),
              content: '',
              hasSentUpdate: false,
              finalized: false,
            };
            assistantStreamStates.set(sessionKey, newState);
            break;
          }

          case 'content_block_start': {
            const contentBlock = event.content_block;
            if (contentBlock && typeof contentBlock === 'object' && contentBlock.type === 'tool_use') {
              const toolName = contentBlock.name || 'unknown';
              const toolInput = contentBlock.input || {};

              const action = inferActionFromToolName(toolName);
              const filePath = extractPathFromInput(typeof toolInput === 'object' ? toolInput as Record<string, unknown> : {});

              lanPeerStream.publish({
                type: 'ai_tool_use',
                data: {
                  groupId,
                  requestId,
                  toolName,
                  action,
                  filePath,
                  toolInput: typeof toolInput === 'object' ? toolInput : {},
                  messageId: streamState?.messageId || randomUUID(),
                  timestamp: new Date().toISOString(),
                },
              });

              await createLanMessage({
                groupId,
                role: 'tool',
                messageType: 'tool_use',
                content: `Using tool: ${toolName}`,
                senderId: AI_SENDER_ID,
                senderName: AI_SENDER_NAME,
                interactionMode: 'ai_chat',
                metadata: { toolName, toolInput, action, filePath },
                requestId,
              });
            }
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta;
            let textChunk = '';
            if (typeof delta === 'string') {
              textChunk = delta;
            } else if (delta && typeof delta === 'object') {
              if (typeof delta.text === 'string') textChunk = delta.text;
              else if (typeof delta.delta === 'string') textChunk = delta.delta;
              else if (typeof delta.partial_json === 'string') {
                break; // Tool input streaming
              }
            }

            if (!textChunk) break;

            // Auto-create streamState if missing (same as project chat)
            if (!streamState || streamState.finalized) {
              streamState = {
                messageId: randomUUID(),
                content: '',
                hasSentUpdate: false,
                finalized: false,
              };
              assistantStreamStates.set(sessionKey, streamState);
            }

            streamState.content += textChunk;
            streamState.hasSentUpdate = true;

            lanPeerStream.publish({
              type: 'ai_stream_delta',
              data: {
                groupId,
                requestId,
                messageId: streamState.messageId,
                content: streamState.content,
                delta: textChunk,
                timestamp: new Date().toISOString(),
              },
            });
            break;
          }

          case 'message_stop': {
            if (streamState && streamState.hasSentUpdate && !streamState.finalized) {
              const trimmedContent = streamState.content.trim();

              if (
                trimmedContent.length === 0 ||
                /^\[Tool:\s*.+\]$/i.test(trimmedContent) ||
                /^Using tool:/i.test(trimmedContent) ||
                /^Tool result:/i.test(trimmedContent)
              ) {
                assistantStreamStates.delete(sessionKey);
                break;
              }

              streamState.finalized = true;
              hasPublishedContent = true;
              completedStreamSessions.add(sessionKey);

              await createLanMessage({
                id: streamState.messageId,
                groupId,
                role: 'assistant',
                messageType: 'text',
                content: trimmedContent,
                senderId: AI_SENDER_ID,
                senderName: AI_SENDER_NAME,
                interactionMode: 'ai_chat',
                requestId,
              });

              lanPeerStream.publish({
                type: 'ai_stream_end',
                data: {
                  groupId,
                  requestId,
                  messageId: streamState.messageId,
                  content: trimmedContent,
                  timestamp: new Date().toISOString(),
                },
              });
            }

            assistantStreamStates.delete(sessionKey);
            break;
          }
        }

        continue;
      }

      // ─── system init: capture session ID ───
      if (message.type === 'system' && (message as any).subtype === 'init') {
        const initSessionId = (message as any).session_id;
        if (initSessionId && typeof initSessionId === 'string') {
          console.log(`[LanClaude] Session initialized: ${initSessionId}`);
          await updateGroupSession(groupId, initSessionId).catch((err) => {
            console.error('[LanClaude] Failed to update session:', err);
          });
        }
        continue;
      }

      // ─── assistant: fallback for non-streaming responses ───
      if (message.type === 'assistant') {
        const sessionKey = ((message as any).session_id ?? (message as any).uuid ?? 'default').toString();

        // Skip if already handled by stream_event
        if (completedStreamSessions.has(sessionKey)) {
          completedStreamSessions.delete(sessionKey);
          continue;
        }

        const assistantMessage = (message as any).message;
        let content = '';

        if (typeof assistantMessage?.content === 'string') {
          content = assistantMessage.content;
        } else if (Array.isArray(assistantMessage?.content)) {
          const parts: string[] = [];
          for (const block of assistantMessage.content) {
            if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
              const trimmed = block.text.trim();
              if (trimmed && !/^\[Tool:\s*/i.test(trimmed) && !/^Using tool:/i.test(trimmed) && !/^Tool result:/i.test(trimmed)) {
                parts.push(block.text);
              }
            }
          }
          content = parts.join('\n');
        }

        if (content.trim()) {
          hasPublishedContent = true;
          const msgId = randomUUID();

          await createLanMessage({
            id: msgId,
            groupId,
            role: 'assistant',
            messageType: 'text',
            content: content.trim(),
            senderId: AI_SENDER_ID,
            senderName: AI_SENDER_NAME,
            interactionMode: 'ai_chat',
            requestId,
          });

          lanPeerStream.publish({
            type: 'ai_stream_end',
            data: {
              groupId,
              requestId,
              messageId: msgId,
              content: content.trim(),
              timestamp: new Date().toISOString(),
            },
          });
        }
        continue;
      }

      // ─── result: completion message ───
      if (message.type === 'result') {
        console.log(`[LanClaude] Task result: ${(message as any).subtype || 'unknown'}`);
        continue;
      }

      // Capture session ID for context continuity (generic fallback)
      const msgSessionId = (message as any).session_id;
      if (msgSessionId && typeof msgSessionId === 'string') {
        await updateGroupSession(groupId, msgSessionId).catch((err) => {
          console.error('[LanClaude] Failed to update session:', err);
        });
      }
    }

    // If no content was published via streaming, send a stream_end to clear the spinner
    if (!hasPublishedContent && !abortSignal?.aborted) {
      console.warn(`[LanClaude] No content published, sending empty stream_end`);
      lanPeerStream.publish({
        type: 'ai_stream_end',
        data: {
          groupId,
          requestId,
          error: 'AI 未产生任何回复内容',
          timestamp: new Date().toISOString(),
        },
      });
    }

    console.log(`[LanClaude] Completed | group=${groupId} | request=${requestId}${abortSignal?.aborted ? ' (aborted)' : ''}`);
  } catch (error) {
    // If aborted, don't treat as error
    if (abortSignal?.aborted) {
      console.log(`[LanClaude] Aborted by user (catch) | group=${groupId} | request=${requestId}`);
      return;
    }
    console.error(`[LanClaude] Error:`, error);
  
    // Surface stderr for debugging
    if (stderrBuffer.length > 0) {
      console.error(`[LanClaude] Last stderr lines:\n${stderrBuffer.slice(-10).join('\n')}`);
    }
  
    // Check if session is invalid and clear it
    const errMsg = (error as Error).message || '';
    if (/No conversation found|session.*not found/i.test(errMsg) || stderrBuffer.some((l: string) => /No conversation found|session.*not found/i.test(l))) {
      try {
        await updateGroupSession(groupId, '');
        console.log(`[LanClaude] Cleared invalid session for group: ${groupId}`);
      } catch {}
    }
  
    // Build user-friendly error message
    let errorContent = 'AI \u56DE\u590D\u5931\u8D25';
    if (/not authenticated|auth/i.test(errMsg) || stderrBuffer.some((l: string) => /auth\s+login|not\s+logged/i.test(l))) {
      errorContent = 'AI \u56DE\u590D\u5931\u8D25: Claude CLI \u672A\u8BA4\u8BC1\uFF0C\u8BF7\u8FD0\u884C claude auth login';
    } else if (/command not found/i.test(errMsg)) {
      errorContent = 'AI \u56DE\u590D\u5931\u8D25: Claude CLI \u672A\u5B89\u88C5\uFF0C\u8BF7\u8FD0\u884C npm install -g @anthropic-ai/claude-code';
    } else if (/No conversation found|session.*not found/i.test(errMsg) || stderrBuffer.some((l: string) => /No conversation found/i.test(l))) {
      errorContent = 'AI \u56DE\u590D\u5931\u8D25: \u4F1A\u8BDD\u8BB0\u5F55\u4E0D\u5B58\u5728\uFF0C\u5DF2\u81EA\u52A8\u6E05\u7406\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u6D88\u606F';
    } else {
      const tail = stderrBuffer.slice(-5).join(' ');
      errorContent = `AI \u56DE\u590D\u5931\u8D25: ${errMsg || tail || '\u672A\u77E5\u9519\u8BEF'}`;
    }

    await createLanMessage({
      groupId,
      role: 'assistant',
      messageType: 'system',
      content: errorContent,
      senderId: AI_SENDER_ID,
      senderName: AI_SENDER_NAME,
      interactionMode: 'ai_chat',
      requestId,
    });

    lanPeerStream.publish({
      type: 'ai_stream_end',
      data: {
        groupId,
        requestId,
        content: errorContent,
        error: errorContent,
        timestamp: new Date().toISOString(),
      },
    });
  }
}

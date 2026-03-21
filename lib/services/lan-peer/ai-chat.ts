/**
 * @deprecated — Replaced by lan-claude.ts which uses the full Claude Agent SDK.
 * This file used the simple callClaudeAPI() from secretary-core.
 * Kept temporarily for reference; safe to delete.
 *
 * LAN Peer Chat — AI Chat Service (LEGACY)
 */

import type { ChatMessage } from './types';

const AI_SENDER_ID = 'ai-assistant';
const AI_SENDER_NAME = '群助理';

const SYSTEM_PROMPT = `你是一个局域网群聊中的 群助理。
请根据对话上下文自然地参与讨论，回答问题，提供帮助。
保持简洁友好，用中文回复。不要使用 Markdown 格式，直接输出纯文本。`;

/**
 * Generate an AI reply for a group chat message.
 *
 * @returns The AI reply text.
 */
export async function generateAIReply(
  groupId: string,
  _userMessage: ChatMessage,
): Promise<string> {
  const { loadClaudeConfig, callClaudeAPI } = await import('@/lib/services/secretary-core');
  const { loadMemory, getRecentContext } = await import('./group-memory');

  // Load model config from global settings
  const config = await loadClaudeConfig();

  // Build message history from group memory (last 20 entries)
  const memory = await loadMemory(groupId);
  const recent = getRecentContext(memory, 20);

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = recent.map((entry) => ({
    role: entry.role === 'assistant' ? 'assistant' : 'user',
    content: entry.source ? `[${entry.source}] ${entry.content}` : entry.content,
  }));

  // Ensure at least one user message exists (the current one is already in memory)
  if (messages.length === 0) {
    messages.push({ role: 'user', content: _userMessage.content });
  }

  const reply = await callClaudeAPI(SYSTEM_PROMPT, messages, config);
  return reply;
}

export { AI_SENDER_ID, AI_SENDER_NAME };

/**
 * Conversation Summarizer Service
 *
 * Compresses old conversation messages into a concise summary,
 * preserving key context while reducing token usage.
 *
 * The summary is stored alongside the session and injected into
 * the system prompt so the secretary retains long-term context.
 */

import type { SecretaryMessage } from './secretary-session';

// ========== Interfaces ==========

export interface ConversationSummary {
  text: string;
  messageCount: number;
  fromDate: string;
  toDate: string;
  updatedAt: string;
}

// ========== Constants ==========

/** When message count exceeds this, trigger summarization */
export const SUMMARIZE_THRESHOLD = 20;

/** Keep this many recent messages unsummarized (for immediate context) */
export const KEEP_RECENT_COUNT = 8;

/** Max summary length in characters */
const MAX_SUMMARY_LENGTH = 2000;

// ========== Summary Builder (local, no AI call) ==========

/**
 * Build a summary from a batch of messages without calling AI.
 * Extracts key events: dispatches, skill calls, user requests.
 * Deduplicates consecutive repeated patterns (e.g. greeting loops, error loops).
 */
export function summarizeMessages(messages: SecretaryMessage[]): ConversationSummary | null {
  if (messages.length === 0) return null;

  const rawEvents: string[] = [];
  const now = new Date().toISOString();

  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content;
      rawEvents.push(`[用户] ${content}`);
    } else if (msg.role === 'assistant') {
      if (msg.actions && msg.actions.length > 0) {
        for (const action of msg.actions) {
          if (action.type === 'dispatch') {
            rawEvents.push(`[派遣] 分配任务给 ${action.employeeName || action.employeeId || '员工'}`);
          } else if (action.type === 'skill_call') {
            rawEvents.push(`[技能] 调用了 ${action.skillName || '技能'}`);
          }
        }
      } else {
        const content = msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content;
        rawEvents.push(`[秘书] ${content}`);
      }
    }
  }

  if (rawEvents.length === 0) return null;

  // Deduplicate: collapse consecutive identical lines into "line（×N）"
  const events = deduplicateEvents(rawEvents);

  let text = events.join('\n');
  if (text.length > MAX_SUMMARY_LENGTH) {
    text = text.slice(0, MAX_SUMMARY_LENGTH) + '\n...（更早的记录已省略）';
  }

  return {
    text,
    messageCount: messages.length,
    fromDate: messages[0].timestamp || now,
    toDate: messages[messages.length - 1].timestamp || now,
    updatedAt: now,
  };
}

/**
 * Collapse consecutive duplicate lines.
 * e.g. ["A","A","A","B","A","A"] → ["A（×3）","B","A（×2）"]
 * Also collapses repeating multi-line patterns (e.g. user-greeting + bot-greeting loops).
 */
export function deduplicateEvents(events: string[]): string[] {
  if (events.length === 0) return [];

  // Phase 1: collapse consecutive identical single lines
  const phase1: { line: string; count: number }[] = [];
  for (const ev of events) {
    const last = phase1[phase1.length - 1];
    if (last && last.line === ev) {
      last.count++;
    } else {
      phase1.push({ line: ev, count: 1 });
    }
  }

  // Phase 2: detect repeating 2-line patterns (e.g. user+assistant loops)
  const phase2: { lines: string[]; count: number }[] = [];
  let i = 0;
  while (i < phase1.length) {
    // Try to match a 2-element repeating pattern starting at i
    if (i + 1 < phase1.length && phase1[i].count === 1 && phase1[i + 1].count === 1) {
      const patA = phase1[i].line;
      const patB = phase1[i + 1].line;
      let repeatCount = 1;
      let j = i + 2;
      while (j + 1 < phase1.length && phase1[j].count === 1 && phase1[j + 1].count === 1
        && phase1[j].line === patA && phase1[j + 1].line === patB) {
        repeatCount++;
        j += 2;
      }
      if (repeatCount >= 2) {
        phase2.push({ lines: [patA, patB], count: repeatCount });
        i = j;
        continue;
      }
    }
    phase2.push({ lines: [phase1[i].line], count: phase1[i].count });
    i++;
  }

  // Format output
  const result: string[] = [];
  for (const item of phase2) {
    if (item.lines.length === 1) {
      result.push(item.count > 1 ? `${item.lines[0]}（×${item.count}）` : item.lines[0]);
    } else {
      // Multi-line repeating pattern
      for (const line of item.lines) {
        result.push(line);
      }
      if (item.count > 1) {
        result.push(`（以上对话重复 ${item.count} 次）`);
      }
    }
  }

  return result;
}

/**
 * Merge an existing summary with a new batch summary.
 * Appends new events to the existing summary text, respecting max length.
 * Deduplicates cross-boundary repeated lines.
 */
export function mergeSummaries(
  existing: ConversationSummary | null,
  newBatch: ConversationSummary
): ConversationSummary {
  if (!existing) return newBatch;

  // Re-deduplicate across the boundary: split both into lines, merge, dedup, rejoin
  const existingLines = existing.text.split('\n').filter(l => l.trim());
  const newLines = newBatch.text.split('\n').filter(l => l.trim());
  const allLines = [...existingLines, ...newLines];
  const deduped = deduplicateEvents(allLines);

  let mergedText = deduped.join('\n');
  if (mergedText.length > MAX_SUMMARY_LENGTH) {
    // Trim from the beginning (oldest events) to stay within limit
    const overflow = mergedText.length - MAX_SUMMARY_LENGTH;
    const firstNewline = mergedText.indexOf('\n', overflow);
    if (firstNewline > 0) {
      mergedText = '...（更早的记录已省略）\n' + mergedText.slice(firstNewline + 1);
    } else {
      mergedText = mergedText.slice(overflow);
    }
  }

  return {
    text: mergedText,
    messageCount: existing.messageCount + newBatch.messageCount,
    fromDate: existing.fromDate,
    toDate: newBatch.toDate,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Process a session's messages: if enough new (unsummarized) messages exist,
 * summarize them and return an updated summary.
 *
 * Messages are NO LONGER trimmed — all messages are kept in the session
 * so the UI can paginate through the full history. The summary is used
 * only for AI context injection.
 *
 * Returns null if no summarization is needed.
 */
export function processSessionForSummarization(
  messages: SecretaryMessage[],
  existingSummary: ConversationSummary | null,
): { summary: ConversationSummary } | null {
  // How many messages have already been summarized?
  const alreadySummarized = existingSummary?.messageCount ?? 0;
  // Count of messages that have not yet been summarized
  const unsummarizedCount = messages.length - alreadySummarized;

  if (unsummarizedCount <= SUMMARIZE_THRESHOLD) return null;

  // Only summarize new messages (from after existing summary to the KEEP_RECENT_COUNT boundary)
  const summarizeEndIndex = messages.length - KEEP_RECENT_COUNT;
  if (summarizeEndIndex <= alreadySummarized) return null;

  const toSummarize = messages.slice(alreadySummarized, summarizeEndIndex);

  const batchSummary = summarizeMessages(toSummarize);
  if (!batchSummary) return null;

  const merged = mergeSummaries(existingSummary, batchSummary);
  // Update messageCount to reflect the total number of messages summarized so far
  merged.messageCount = summarizeEndIndex;

  return { summary: merged };
}

/**
 * Format a conversation summary for injection into the system prompt.
 */
export function formatSummaryForPrompt(summary: ConversationSummary | null): string {
  if (!summary || !summary.text) return '';

  return `## 历史对话摘要（${summary.fromDate.split('T')[0]} 至 ${summary.toDate.split('T')[0]}，共 ${summary.messageCount} 条消息）

${summary.text}

请参考以上历史记录来回答用户关于过去工作内容的问题。`;
}

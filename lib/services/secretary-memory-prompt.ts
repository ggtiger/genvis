/**
 * Secretary Memory Prompt Builder
 *
 * Formats memory entries into a structured Chinese text block
 * for injection into the secretary system prompt.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */

import type { MemoryData, MemoryDataV2, MemoryEntry } from './secretary-memory';
import type { RetrievalResult } from './memory-retriever';

// ========== Constants ==========

const CATEGORY_HEADERS: Record<string, string> = {
  user_profile: '用户档案',
  learned_preference: '学习偏好',
  interaction_pattern: '交互模式',
  work_events: '工作事件',
  dispatch_learnings: '调度纠正经验',
};

const LOW_CONFIDENCE_MARKER = '⚠️ 低置信度';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

const PERSONALIZATION_INSTRUCTIONS = `请根据以上用户信息个性化你的回复和操作。例如：
- 制作PPT时优先使用用户偏好的风格
- 安排会议时考虑用户的时间规律
- 使用符合用户沟通风格的语气`;

const LAYER_HEADERS: Record<'long_term', string> = {
  long_term: '长期记忆',
};

// ========== Public API ==========

/**
 * Build a formatted memory prompt block from memory data.
 *
 * Returns a structured Chinese text block grouped by category,
 * or an empty string when no memory entries exist.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */
export function buildMemoryPromptBlock(memory: MemoryData | MemoryDataV2): string {
  const sections: string[] = [];

  // Build each category section only if it has entries
  for (const category of ['user_profile', 'learned_preference', 'interaction_pattern', 'work_events', 'dispatch_learnings'] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries: MemoryEntry[] = (memory as any)[category] || [];
    if (entries.length === 0) continue;

    const header = CATEGORY_HEADERS[category];
    const lines = entries.map((entry: MemoryEntry) => formatEntry(entry, category));
    sections.push(`### ${header}\n${lines.join('\n')}`);
  }

  // If no sections, return empty string (no injection)
  if (sections.length === 0) {
    return '';
  }

  // Assemble the full block
  return `## 用户记忆\n\n${sections.join('\n\n')}\n\n${PERSONALIZATION_INSTRUCTIONS}`;
}

/**
 * Build a formatted memory prompt block from retrieval results.
 *
 * Groups results by layer (short_term → 短期记忆, working → 工作记忆, long_term → 长期记忆),
 * formats each entry with confidence annotation, and returns a structured Chinese text block.
 * Returns empty string when results array is empty.
 *
 * Validates: Requirements 1.3, 1.4, 6.6
 */
export function buildMemoryPromptBlockFromResults(results: RetrievalResult[]): string {
  if (results.length === 0) {
    return '';
  }

  // All results are long_term now
  const sections: string[] = [];
  const lines = results.map((r) => formatEntryWithConfidence(r.entry));
  sections.push(`### ${LAYER_HEADERS.long_term}\n${lines.join('\n')}`);

  if (sections.length === 0) {
    return '';
  }

  return `## 用户记忆\n\n${sections.join('\n\n')}\n\n${PERSONALIZATION_INSTRUCTIONS}`;
}

/**
 * Format a memory entry with confidence annotation.
 * When entry.confidence < threshold, appends a low-confidence marker.
 * When entry.confidence >= threshold (or is undefined), formats normally.
 *
 * Validates: Requirements 6.6
 */
export function formatEntryWithConfidence(
  entry: MemoryEntry,
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD
): string {
  let display = entry.value;

  if (entry.count != null && entry.count > 0) {
    display = `${entry.value}（使用 ${entry.count} 次）`;
  }

  const base = `- ${entry.key}：${display}`;

  if (entry.confidence !== undefined && entry.confidence < threshold) {
    return `${base} ${LOW_CONFIDENCE_MARKER}`;
  }

  return base;
}

// ========== Internal Helpers ==========

/**
 * Format a single memory entry as a bullet-point line.
 * For interaction_pattern entries with a count, appends the count display.
 */
function formatEntry(
  entry: MemoryEntry,
  category: 'user_profile' | 'learned_preference' | 'interaction_pattern' | 'work_events' | 'dispatch_learnings'
): string {
  let display = entry.value;

  // For interaction_pattern entries, include the count if present
  if (category === 'interaction_pattern' && entry.count != null && entry.count > 0) {
    display = `${entry.value}（使用 ${entry.count} 次）`;
  }

  // For work_events, include the date
  if (category === 'work_events' && entry.createdAt) {
    const date = entry.createdAt.split('T')[0];
    display = `[${date}] ${entry.value}`;
  }

  return `- ${entry.key}：${display}`;
}

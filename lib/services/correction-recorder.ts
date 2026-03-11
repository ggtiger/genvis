/**
 * Correction Recorder
 *
 * Records dispatch correction cases into the dispatch_learnings category
 * of the secretary memory system. Fire-and-forget, never-throw pattern.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

import type { CorrectionResult } from './correction-detector';
import {
  loadMemory,
  saveMemory,
  upsertEntry,
  getEntriesByCategory,
  type MemoryDataV2,
} from './secretary-memory';

// ========== Interfaces ==========

/** 纠正案例的 value 结构 */
export interface DispatchLearningValue {
  /** 用户原始请求 */
  input: string;
  /** 错误的调度动作 */
  wrongAction: string;
  /** 错误的动作类型 */
  wrongActionType: 'dispatch' | 'skill_call' | 'direct_reply';
  /** 正确的调度动作 */
  correctAction: string;
  /** 正确的动作类型 */
  correctActionType: 'dispatch' | 'skill_call' | 'direct_reply' | 'unknown';
  /** 是否已提升为永久规则 */
  promotedToRule?: boolean;
}

// ========== Extraction Patterns ==========

/**
 * Patterns to extract the correct action from a correction message.
 * Each pattern has a regex and a way to determine the actionType.
 */
const EXTRACTION_PATTERNS: Array<{
  regex: RegExp;
  typeHint?: 'dispatch' | 'skill_call' | 'direct_reply';
}> = [
  // Explicit type hints
  { regex: /dispatch[给到]\s*(.+)/i, typeHint: 'dispatch' },
  { regex: /skill_call\s+(.+)/i, typeHint: 'skill_call' },
  { regex: /direct_reply/i, typeHint: 'direct_reply' },
  // Chinese patterns: "应该给XXX", "应该用XXX"
  { regex: /应该[给到]\s*(.+?)(?:[做处理]|$)/ },
  { regex: /应该用\s*(.+?)(?:[来做处理]|$)/ },
  // "给XXX做", "用XXX"
  { regex: /[给到]\s*(.+?)(?:[做处理来]|$)/ },
  { regex: /用\s*(.+?)(?:[来做处理]|$)/ },
  // English patterns
  { regex: /should (?:be|use|go to)\s+(.+)/i },
  { regex: /use\s+(.+)/i },
];

// ========== Public API ==========

/**
 * 从纠正消息中提取用户期望的正确动作。
 * 尝试匹配已知模式提取目标名称。
 * 无法明确提取时返回 { action: correctionMessage, actionType: 'unknown' }。
 */
export function extractCorrectAction(
  correctionMessage: string,
): { action: string; actionType: 'dispatch' | 'skill_call' | 'direct_reply' | 'unknown' } {
  if (!correctionMessage || typeof correctionMessage !== 'string') {
    return { action: '', actionType: 'unknown' };
  }

  const trimmed = correctionMessage.trim();

  // Check for explicit direct_reply pattern
  if (/direct_reply/i.test(trimmed) || /直接回复/.test(trimmed) || /直接回答/.test(trimmed)) {
    return { action: 'direct_reply', actionType: 'direct_reply' };
  }

  for (const pattern of EXTRACTION_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match && match[1]) {
      const action = match[1].trim();
      if (!action) continue;

      // If the pattern has a type hint, use it
      if (pattern.typeHint) {
        return { action, actionType: pattern.typeHint };
      }

      // Heuristic: if action contains "skill" or "技能", it's likely a skill_call
      if (/skill|技能/i.test(action)) {
        return { action, actionType: 'skill_call' };
      }

      // Default to dispatch (most common correction is about employee routing)
      return { action, actionType: 'dispatch' };
    }
  }

  // No pattern matched — return raw message with unknown type
  return { action: trimmed, actionType: 'unknown' };
}

/**
 * 记录一条调度纠正案例。
 * Fire-and-forget，never-throw。
 *
 * 1. Load memory
 * 2. Extract correct action from correction message
 * 3. Build DispatchLearningValue
 * 4. Check existing entry count for manual increment
 * 5. Upsert into dispatch_learnings
 * 6. Save memory
 */
export async function recordCorrection(
  correction: CorrectionResult,
): Promise<void> {
  try {
    let memory = await loadMemory();

    const { action, actionType } = extractCorrectAction(correction.correctionMessage);

    const learningValue: DispatchLearningValue = {
      input: correction.originalInput,
      wrongAction: correction.wrongAction,
      wrongActionType: correction.wrongActionType,
      correctAction: action,
      correctActionType: actionType,
    };

    const key = correction.originalInput;
    const confidence = actionType === 'unknown' ? 0.5 : 0.8;

    // Check existing entry to manually handle count (upsertEntry only auto-increments for interaction_pattern)
    const existingEntries = getEntriesByCategory(memory, 'dispatch_learnings');
    const existing = existingEntries.find((e) => e.key === key);
    const newCount = existing ? (existing.count || 0) + 1 : 1;

    const now = new Date().toISOString();

    memory = upsertEntry(memory, 'dispatch_learnings', {
      key,
      value: JSON.stringify(learningValue),
      source: 'dispatch_correction',
      count: newCount,
      confidence,
      lastAccessedAt: now,
      accessCount: existing ? (existing.accessCount || 0) : 0,
      channel: 'web',
    }) as MemoryDataV2;

    await saveMemory(memory);
  } catch (err) {
    console.warn('[CorrectionRecorder] 记录纠正案例失败:', err);
  }
}

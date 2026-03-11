/**
 * Correction Detector
 *
 * Analyzes user messages for dispatch correction signals.
 * Pure functions, no side effects, never-throw pattern.
 *
 * Validates: Requirements 1.1, 1.4, 1.5, 1.6, 1.7
 */

import type { SecretaryMessage } from './secretary-session';

// ========== Interfaces ==========

/** 纠正检测结果 */
export interface CorrectionResult {
  /** 触发纠正的原始用户请求 */
  originalInput: string;
  /** 错误的调度动作描述（如 "dispatch/builtin-doc-processor"） */
  wrongAction: string;
  /** 错误的动作类型 */
  wrongActionType: 'dispatch' | 'skill_call' | 'direct_reply';
  /** 用户的纠正消息 */
  correctionMessage: string;
}

/** findLastDispatchDecision 的返回结构 */
export interface DispatchDecision {
  userMessage: SecretaryMessage;
  assistantMessage: SecretaryMessage;
  actionType: string;
  actionTarget: string;
}

// ========== Correction Keywords ==========

const CORRECTION_KEYWORDS_CN = [
  '不对', '错了', '搞错', '应该给', '应该用',
  '为什么不用', '为什么不给', '不是这个', '换一个',
  '换个', '不应该', '调度错', '分配错',
];

const CORRECTION_KEYWORDS_EN = [
  'wrong', 'incorrect', 'should be', 'should use', 'not this',
];

const ALL_CORRECTION_KEYWORDS = [...CORRECTION_KEYWORDS_CN, ...CORRECTION_KEYWORDS_EN];

// ========== Public API ==========

/**
 * 检测消息文本是否包含纠正关键词。
 * 支持中英文混合。
 */
export function hasCorrectionSignal(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return ALL_CORRECTION_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * 从会话历史中查找最近一次包含 dispatch/skill_call 动作的 assistant 消息，
 * 以及该消息之前的用户消息（即触发该调度的原始请求）。
 *
 * 从末尾向前遍历，找到第一个含 dispatch/skill_call action 的 assistant 消息。
 */
export function findLastDispatchDecision(
  messages: SecretaryMessage[],
): DispatchDecision | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.actions || msg.actions.length === 0) continue;

    // Find the first dispatch or skill_call action in this message
    const action = msg.actions.find(
      (a) => a.type === 'dispatch' || a.type === 'skill_call',
    );
    if (!action) continue;

    // Determine action target
    const actionTarget =
      action.type === 'dispatch'
        ? action.employeeName || action.employeeId || 'unknown'
        : action.skillName || 'unknown';

    // Find the preceding user message (the original request that triggered this dispatch)
    let userMessage: SecretaryMessage | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (messages[j].role === 'user') {
        userMessage = messages[j];
        break;
      }
    }

    if (!userMessage) return null;

    return {
      userMessage,
      assistantMessage: msg,
      actionType: action.type,
      actionTarget,
    };
  }

  return null;
}

/**
 * 检测用户消息是否为调度纠正信号。
 * 纯函数，不产生副作用。
 *
 * 1. 检查 currentMessage 是否包含纠正关键词
 * 2. 如果是，从 sessionMessages 中查找最近的 dispatch 决策
 * 3. 如果找到，返回 CorrectionResult；否则返回 null
 */
export function detectCorrection(
  currentMessage: string,
  sessionMessages: SecretaryMessage[],
): CorrectionResult | null {
  if (!currentMessage || typeof currentMessage !== 'string') return null;
  if (!Array.isArray(sessionMessages)) return null;

  if (!hasCorrectionSignal(currentMessage)) return null;

  const decision = findLastDispatchDecision(sessionMessages);
  if (!decision) return null;

  return {
    originalInput: decision.userMessage.content,
    wrongAction: `${decision.actionType}/${decision.actionTarget}`,
    wrongActionType: decision.actionType as CorrectionResult['wrongActionType'],
    correctionMessage: currentMessage,
  };
}

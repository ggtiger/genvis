/**
 * Intent Example Store
 *
 * 记录用户确认正确的意图识别样本（通过 👍 反馈）。
 * 在意图识别时作为 few-shot examples 注入 prompt，最高优先级。
 *
 * 数据存储在 secretary-memory 的 intent_examples 分类中。
 * key = 用户消息（截断到 200 字符）
 * value = JSON { action, target, employeeId?, skillName? }
 */

import {
  loadMemory,
  saveMemory,
  upsertEntry,
  type MemoryDataV2,
  type MemoryEntryV2,
} from './secretary-memory';

// ========== Types ==========

export interface IntentExample {
  /** 用户原始消息 */
  userMessage: string;
  /** 意图类型 */
  action: 'dispatch' | 'skill_call' | 'direct_reply';
  /** 目标名称（员工名或技能名） */
  target: string;
  /** 员工 ID（dispatch 时） */
  employeeId?: string;
  /** 技能名（skill_call 时） */
  skillName?: string;
}

// ========== Public API ==========

/**
 * 记录一条正确的意图样本。
 * 如果已存在相同 key，会更新并增加 confidence。
 */
export async function recordIntentExample(example: IntentExample): Promise<void> {
  try {
    const memory = await loadMemory();
    const key = example.userMessage.slice(0, 200);
    const value = JSON.stringify({
      action: example.action,
      target: example.target,
      employeeId: example.employeeId,
      skillName: example.skillName,
    });

    const existing = (memory.intent_examples ?? []).find(e => e.key === key);
    const now = new Date().toISOString();

    const updated = upsertEntry(memory, 'intent_examples', {
      key,
      value,
      source: 'user_feedback',
      count: existing ? (existing.count || 0) + 1 : 1,
      confidence: Math.min((existing?.confidence || 0.8) + 0.1, 1.0),
      lastAccessedAt: now,
      accessCount: (existing?.accessCount || 0) + 1,
      channel: 'web',
    }) as MemoryDataV2;

    await saveMemory(updated);
  } catch (err) {
    console.warn('[IntentExampleStore] 记录意图样本失败:', err);
  }
}

/**
 * 加载所有意图样本，按 confidence 降序排列。
 * 返回最多 topK 条，用于注入 prompt。
 */
export async function loadIntentExamples(topK: number = 20): Promise<IntentExample[]> {
  try {
    const memory = await loadMemory();
    const entries = memory.intent_examples ?? [];
    if (entries.length === 0) return [];

    // 按 confidence 降序 + count 降序
    const sorted = [...entries].sort((a, b) => {
      const confDiff = (b.confidence || 0) - (a.confidence || 0);
      if (confDiff !== 0) return confDiff;
      return (b.count || 0) - (a.count || 0);
    });

    return sorted.slice(0, topK).map(entry => {
      try {
        const val = JSON.parse(entry.value);
        return {
          userMessage: entry.key,
          action: val.action,
          target: val.target,
          employeeId: val.employeeId,
          skillName: val.skillName,
        } as IntentExample;
      } catch {
        return null;
      }
    }).filter((e): e is IntentExample => e !== null);
  } catch {
    return [];
  }
}

/**
 * 将意图样本格式化为 prompt 块，作为 few-shot examples 注入。
 */
export function formatIntentExamplesBlock(examples: IntentExample[]): string {
  if (examples.length === 0) return '';

  const lines = examples.map(ex => {
    if (ex.action === 'dispatch') {
      return `用户: "${ex.userMessage}" → dispatch 给 ${ex.target}(${ex.employeeId})`;
    } else if (ex.action === 'skill_call') {
      return `用户: "${ex.userMessage}" → skill_call ${ex.target}(${ex.skillName})`;
    } else {
      return `用户: "${ex.userMessage}" → direct_reply`;
    }
  });

  return `## ⚠️ 历史正确调度样本（最高优先级）

以下是用户确认正确的调度决策，遇到相似请求时必须优先参考：
${lines.join('\n')}`;
}

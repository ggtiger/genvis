/**
 * Correction Retriever
 *
 * BM25-based retrieval of dispatch correction cases from dispatch_learnings.
 * Formats results as a prompt block for injection into the secretary system prompt.
 * Never-throw pattern — returns empty string on any failure.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.5
 */

import { buildBM25Index, scoreBM25 } from './memory-retriever';
import type { MemoryDataV2, MemoryEntryV2 } from './secretary-memory';
import type { DispatchLearningValue } from './correction-recorder';

const DEFAULT_TOP_K = 5;

const HEADER = `## 调度纠正经验

以下是历史调度纠正案例，请参考避免重复错误：
`;

/**
 * 将单条纠正案例格式化为提示文本。
 * JSON 解析失败时返回简单回退格式。
 */
export function formatLearningEntry(entry: MemoryEntryV2): string {
  try {
    const val: DispatchLearningValue = JSON.parse(entry.value);
    const count = entry.count ?? 1;
    const confidence = entry.confidence ?? 0.8;
    return `- 用户请求"${val.input}"时，应使用 ${val.correctActionType} 调用 ${val.correctAction} 而非 ${val.wrongActionType} ${val.wrongAction}（纠正 ${count} 次，置信度 ${confidence}）`;
  } catch {
    // Fallback: use raw key/value
    const count = entry.count ?? 1;
    return `- ${entry.key}：${entry.value}（纠正 ${count} 次）`;
  }
}

/**
 * 从 dispatch_learnings 中检索与查询相关的纠正案例，
 * 格式化为可注入 system prompt 的文本块。
 * 无结果或出错时返回空字符串。
 */
export function searchDispatchLearnings(
  query: string,
  memory: MemoryDataV2,
  topK: number = DEFAULT_TOP_K,
): string {
  try {
    const learnings = memory.dispatch_learnings ?? [];
    if (learnings.length === 0 || !query || !query.trim()) {
      return '';
    }

    const documents = learnings.map((e) => e.key + ' ' + e.value);
    const index = buildBM25Index(documents);

    const scored: Array<{ entry: MemoryEntryV2; score: number }> = [];
    for (let i = 0; i < learnings.length; i++) {
      const score = scoreBM25(query, i, index);
      if (score > 0) {
        scored.push({ entry: learnings[i], score });
      }
    }

    if (scored.length === 0) {
      return '';
    }

    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, topK);

    const lines = topResults.map((r) => formatLearningEntry(r.entry));
    return HEADER + lines.join('\n');
  } catch {
    return '';
  }
}

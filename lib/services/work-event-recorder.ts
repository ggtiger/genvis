/**
 * Work Event Recorder
 *
 * Records work events (task dispatches, completions, skill calls)
 * into the secretary memory system under the 'work_events' category.
 *
 * This enables the secretary to answer questions like
 * "本周做了哪些事情" by retrieving stored work events.
 */

import { loadMemory, saveMemory, upsertEntry, type MemoryDataV2 } from './secretary-memory';

// ========== Constants ==========

/** Max work events to keep (auto-prune oldest beyond this) */
const MAX_WORK_EVENTS = 200;

// ========== Public API ==========

export interface WorkEvent {
  /** Short key like "dispatch_2024-01-15_设计师" */
  key: string;
  /** Description of what happened */
  value: string;
  /** Source context */
  source: string;
  /** Channel: web, dingtalk, etc. */
  channel?: string;
}

/**
 * Record a work event into memory.
 * Fire-and-forget — never throws.
 */
export async function recordWorkEvent(event: WorkEvent): Promise<void> {
  try {
    let memory = await loadMemory();
    const now = new Date().toISOString();

    memory = upsertEntry(memory, 'work_events', {
      key: event.key,
      value: event.value,
      source: event.source,
      confidence: 1.0,
      lastAccessedAt: now,
      accessCount: 0,
      channel: event.channel || 'web',
    }) as MemoryDataV2;

    // Prune old events if exceeding limit
    if (memory.work_events && memory.work_events.length > MAX_WORK_EVENTS) {
      // Sort by createdAt ascending, remove oldest
      memory.work_events.sort((a, b) =>
        (a.createdAt || '').localeCompare(b.createdAt || '')
      );
      memory.work_events = memory.work_events.slice(-MAX_WORK_EVENTS);
    }

    await saveMemory(memory);
  } catch (err) {
    console.warn('[WorkEventRecorder] 记录工作事件失败:', err);
  }
}

/**
 * Record a task dispatch event.
 * Deduplicates: only keeps the latest dispatch per employee per day.
 */
export async function recordDispatchEvent(
  employeeName: string,
  taskDescription: string,
  channel: string = 'web',
): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  // Use date-only key (no time) to deduplicate same-employee-same-day dispatches
  await recordWorkEvent({
    key: `dispatch_${dateStr}_${employeeName}`,
    value: `分配任务给${employeeName}：${taskDescription}`,
    source: '秘书派遣',
    channel,
  });
}

/**
 * Record a task completion event.
 * Deduplicates: only keeps the latest completion per employee per day.
 */
export async function recordCompletionEvent(
  employeeName: string,
  resultSummary: string,
  channel: string = 'web',
): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  // Truncate long results
  const summary = resultSummary.length > 200
    ? resultSummary.slice(0, 200) + '...'
    : resultSummary;

  // Use date-only key (no time) to deduplicate same-employee-same-day completions
  await recordWorkEvent({
    key: `completed_${dateStr}_${employeeName}`,
    value: `${employeeName}完成任务：${summary}`,
    source: '任务完成',
    channel,
  });
}

/**
 * Record a skill call event.
 * Deduplicates: only keeps the latest call per skill per day.
 */
export async function recordSkillCallEvent(
  skillName: string,
  description: string,
  channel: string = 'web',
): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  // Use date-only key (no time) to deduplicate same-skill-same-day calls
  await recordWorkEvent({
    key: `skill_${dateStr}_${skillName}`,
    value: `调用技能 ${skillName}：${description}`,
    source: '技能调用',
    channel,
  });
}

/**
 * Get recent work events for a given time range.
 * Useful for building "本周工作总结" type queries.
 * Deduplicates events with similar content on the same day.
 */
export async function getRecentWorkEvents(daysBack: number = 7): Promise<string> {
  try {
    const memory = await loadMemory();
    const events = memory.work_events || [];
    if (events.length === 0) return '';

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString();

    const recent = events
      .filter(e => (e.createdAt || '') >= cutoffStr)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    if (recent.length === 0) return '';

    // Deduplicate: for same date + same value prefix (first 50 chars), keep only the latest
    const seen = new Map<string, typeof recent[0]>();
    for (const e of recent) {
      const date = (e.createdAt || '').split('T')[0];
      const valuePrefix = e.value.slice(0, 50);
      const dedupeKey = `${date}:${valuePrefix}`;
      seen.set(dedupeKey, e); // later entries overwrite earlier ones
    }

    const deduped = Array.from(seen.values())
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    const lines = deduped.map(e => {
      const date = (e.createdAt || '').split('T')[0];
      return `- [${date}] ${e.value}`;
    });

    return `## 近${daysBack}天工作事件\n\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

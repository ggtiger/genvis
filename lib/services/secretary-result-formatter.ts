/**
 * Secretary Result Formatter
 *
 * Generic formatting for skill API call results.
 * This module is deliberately business-agnostic — it does NOT know about
 * specific API paths (/todos, /schedules, /notes, etc.) or their data shapes.
 * Formatting is based solely on HTTP method and generic response structures.
 */

// ========== Public API ==========

/**
 * Format a skill API result into a human-readable reply.
 *
 * Uses only the HTTP method and generic response shape to decide formatting.
 * No business-specific path checks — the secretary is a dispatcher, not a
 * domain expert for each skill.
 */
export function formatSkillResult(method: string, data: any): string {
  // Unwrap nested { success: true, data: ... } response shape
  const unwrapped =
    data && data.success === true && data.data !== undefined
      ? data.data
      : data;

  // If the API explicitly returned a failure message, surface it
  if (data && data.success === false && data.message) {
    return data.message;
  }

  // If the response itself carries a human-readable message, prefer it
  if (data && data.message && typeof data.message === 'string') {
    return data.message;
  }

  // ---- Write operations ----
  if (method === 'POST') {
    return formatWriteResult('创建', unwrapped);
  }
  if (method === 'PUT') {
    return formatWriteResult('更新', unwrapped);
  }
  if (method === 'DELETE') {
    return '已删除成功。';
  }

  // ---- Read operations (GET) ----
  return formatReadResult(unwrapped);
}

// ========== Internal Helpers ==========

/**
 * Format a write (POST/PUT) result.
 * Extracts a title from the response object when available.
 */
function formatWriteResult(verb: string, data: any): string {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const title = data.title || data.name;
    if (title) {
      return `已${verb}：「${title}」`;
    }
  }
  return `${verb}成功。`;
}

/**
 * Format a read (GET) result.
 * Handles arrays, nested arrays, and single objects generically.
 */
function formatReadResult(data: any): string {
  // Extract the actual items array from various response shapes
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : null;

  if (items !== null) {
    if (items.length === 0) {
      return '查询结果为空。';
    }

    // Format list items generically — show title/name if available
    const lines = items.slice(0, 15).map((item: any, i: number) => {
      if (typeof item === 'string') return `- ${item}`;
      const label = item.title || item.name || `#${i + 1}`;
      const status = item.status ? `（${item.status}）` : '';
      return `- ${label}${status}`;
    });

    const header = `查询到 ${items.length} 条结果：`;
    const suffix = items.length > 15 ? `\n...还有 ${items.length - 15} 条` : '';
    return `${header}\n${lines.join('\n')}${suffix}`;
  }

  // Single object
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.title) return `${data.title}`;
    if (data.message) return data.message;
  }

  return '操作成功。';
}

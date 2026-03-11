/**
 * Secretary Memory Extractor Service
 *
 * Analyzes conversation content (user message + assistant reply) using the
 * Claude API to extract user profile information, learned preferences, and
 * interaction patterns. Returns structured ExtractedMemory items that can
 * be persisted via the Memory Store.
 *
 * Design principles:
 * - NEVER throws — all errors are caught and result in an empty array return
 * - Uses the same Claude API calling pattern as the secretary route
 * - Parses AI response robustly (handles extra text around JSON)
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */

import type { MemoryCategory } from './secretary-memory';

// ========== Interfaces ==========

export interface ExtractedMemory {
  category: MemoryCategory;
  key: string;
  value: string;
  source: string;
}

// ========== Constants ==========

const VALID_CATEGORIES: ReadonlySet<string> = new Set<MemoryCategory>([
  'user_profile',
  'learned_preference',
  'interaction_pattern',
  'work_events',
]);

/**
 * Dedicated extraction prompt template.
 * Asks the AI to identify user_profile, learned_preference, and
 * interaction_pattern items from a conversation turn.
 */
function buildExtractionPrompt(userMessage: string, assistantReply: string): string {
  return `分析以下对话，提取用户的个人信息、偏好和行为模式。
只提取明确表达的信息，不要推测。

用户消息：${userMessage}
助手回复：${assistantReply}

以 JSON 数组格式返回，每个元素包含：
- category: "user_profile" | "learned_preference" | "interaction_pattern"
- key: 简短的英文键名（如 job_title, ppt_style, frequent_feature）
- value: 中文描述值
- source: 来源对话的简短摘要

如果没有可提取的信息，返回空数组 []。`;
}

// ========== Validation ==========

/**
 * Check whether a single extracted item has all required fields with valid types.
 */
function isValidExtractedMemory(item: unknown): item is ExtractedMemory {
  if (!item || typeof item !== 'object') return false;

  const obj = item as Record<string, unknown>;

  return (
    typeof obj.category === 'string' &&
    VALID_CATEGORIES.has(obj.category) &&
    typeof obj.key === 'string' &&
    obj.key.trim().length > 0 &&
    typeof obj.value === 'string' &&
    obj.value.trim().length > 0 &&
    typeof obj.source === 'string' &&
    obj.source.trim().length > 0
  );
}

// ========== JSON Parsing ==========

/**
 * Attempt to extract a JSON array from a text response that may contain
 * extra prose, markdown code fences, or other non-JSON content.
 *
 * Strategies (tried in order):
 * 1. Strip markdown code block wrappers and parse
 * 2. Parse the entire trimmed string as JSON
 * 3. Find a JSON array embedded in the text via bracket matching
 */
function parseJsonArray(text: string): unknown[] {
  const trimmed = text.trim();

  // Strategy 1: Strip markdown code block wrappers
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }

  // Strategy 2: Parse the whole string directly
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }

  // Strategy 3: Find a JSON array embedded in the text
  const arrayStart = trimmed.indexOf('[');
  if (arrayStart !== -1) {
    // Walk forward to find the matching closing bracket
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = arrayStart; i < trimmed.length; i++) {
      const ch = trimmed[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === '[') depth++;
      if (ch === ']') {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.slice(arrayStart, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) return parsed;
          } catch {
            // fall through
          }
          break;
        }
      }
    }
  }

  // Nothing worked — return empty array
  return [];
}

// ========== Main API ==========

/**
 * Analyze a conversation turn and extract memory items using the Claude API.
 *
 * This function NEVER throws. On any error (network, parsing, invalid response)
 * it returns an empty array so that the caller's normal flow is unaffected.
 *
 * @param userMessage  - The user's message text
 * @param assistantReply - The assistant's reply text
 * @param config - Claude API configuration (baseUrl, apiKey, model)
 * @returns Array of extracted memory items (may be empty)
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */
export async function extractMemoryFromConversation(
  userMessage: string,
  assistantReply: string,
  config: { baseUrl: string; apiKey: string; model: string }
): Promise<ExtractedMemory[]> {
  try {
    // Build the extraction prompt
    const extractionPrompt = buildExtractionPrompt(userMessage, assistantReply);

    // Call Claude API using the same pattern as the secretary route
    const url = `${config.baseUrl}/v1/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        system: '你是一个信息提取助手。只返回 JSON，不要添加任何其他文字。',
        messages: [
          {
            role: 'user',
            content: extractionPrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(
        `[MemoryExtractor] AI request failed (${response.status})`
      );
      return [];
    }

    const data = await response.json();

    // Extract text content from Claude API response (same pattern as secretary route)
    let responseText = '';
    if (data.content && Array.isArray(data.content)) {
      const textBlock = data.content.find(
        (block: any) => block.type === 'text'
      );
      if (textBlock?.text) {
        responseText = textBlock.text;
      }
    }

    if (!responseText) {
      console.warn('[MemoryExtractor] Empty response from AI');
      return [];
    }

    // Parse the response text to find a JSON array
    const rawItems = parseJsonArray(responseText);

    // Filter to only valid extracted memory items
    const validItems: ExtractedMemory[] = rawItems
      .filter(isValidExtractedMemory)
      .map((item) => ({
        category: item.category,
        key: item.key.trim(),
        value: item.value.trim(),
        source: item.source.trim(),
      }));

    return validItems;
  } catch (error) {
    // Requirement 6.4: extraction failure must not affect normal operation
    console.warn('[MemoryExtractor] Failed to extract memory:', error);
    return [];
  }
}



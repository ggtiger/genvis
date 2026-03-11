/**
 * API 技能提示词构建器
 *
 * 将注册表中的 API 技能信息格式化为中文提示词块，
 * 用于注入秘书的系统提示词，使秘书 AI 能自动发现和调用已注册的 API 技能。
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */

import type {
  ApiSkillRegistryData,
  RegisteredApiSkill,
  ApiEndpoint,
  ApiEndpointParam,
  ApiEndpointResponseField,
} from '@/lib/types/api-skill';

// ========== Constants ==========

const PROMPT_HEADER = `### 能力二：直接调用技能 REST API

对于日常操作，你可以直接调用以下技能的 REST API，无需启动其他员工。

**可用的技能 API：**`;

// ========== Public API ==========

/**
 * Build a formatted prompt block listing all registered API skills and their endpoints.
 *
 * Returns a structured Chinese text block for injection into the secretary system prompt,
 * or an empty string when no API skills are registered.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */
export function buildApiSkillPromptBlock(registry: ApiSkillRegistryData): string {
  if (registry.skills.length === 0) {
    return '';
  }

  const skillBlocks = registry.skills.map(formatSkillBlock);

  return `${PROMPT_HEADER}\n\n${skillBlocks.join('\n\n')}`;
}

/**
 * Build a prompt block for a single target skill identified by Step 1 classification.
 * Matches by skillName, displayName, or fuzzy substring match.
 * Falls back to full prompt block if no match found.
 *
 * This implements progressive disclosure: only load endpoint details
 * for the skill that Step 1 already identified as the target.
 */
export function buildTargetSkillPromptBlock(
  registry: ApiSkillRegistryData,
  targetName: string,
): string {
  if (registry.skills.length === 0) return '';

  const normalizedTarget = targetName.toLowerCase();

  // Exact match by skillName or displayName
  let matched = registry.skills.find(
    s => s.skillName.toLowerCase() === normalizedTarget
      || s.displayName.toLowerCase() === normalizedTarget
  );

  // Fuzzy match: target contains skill name or vice versa
  if (!matched) {
    matched = registry.skills.find(
      s => normalizedTarget.includes(s.skillName.toLowerCase())
        || normalizedTarget.includes(s.displayName.toLowerCase())
        || s.skillName.toLowerCase().includes(normalizedTarget)
        || s.displayName.toLowerCase().includes(normalizedTarget)
    );
  }

  if (!matched) {
    // No match — fall back to full prompt block
    return buildApiSkillPromptBlock(registry);
  }

  const skillBlock = formatSkillBlock(matched);
  return `${PROMPT_HEADER}\n\n${skillBlock}`;
}

// ========== Internal Helpers ==========

/**
 * Format a single registered skill as a prompt block.
 */
function formatSkillBlock(skill: RegisteredApiSkill): string {
  const lines: string[] = [];

  // Skill header: #### 显示名（技能名）⚠️ 需要配置
  const needsConfig = !skill.auth.configured && skill.auth.authType !== 'none';
  const configWarning = needsConfig ? ' ⚠️ 需要配置' : '';
  lines.push(`#### ${skill.displayName}（${skill.skillName}）${configWarning}`);

  // Skill description, with config note for unconfigured skills
  const configNote = needsConfig ? '（需要先在设置中配置 API Key）' : '';
  lines.push(`${skill.description}${configNote}`);

  // Format endpoints as numbered list
  const endpointLines = skill.endpoints.map((endpoint, index) => {
    return formatEndpointLine(endpoint, index + 1);
  });

  lines.push('');
  lines.push(endpointLines.join('\n'));

  return lines.join('\n');
}

/**
 * Format a single endpoint as a numbered line.
 *
 * Format: N. METHOD /path — 描述（params）→ 返回: { fields }
 */
function formatEndpointLine(endpoint: ApiEndpoint, index: number): string {
  const parts: string[] = [];

  // Base: "N. METHOD /path — 描述"
  parts.push(`${index}. ${endpoint.method} ${endpoint.path} — ${endpoint.description}`);

  // Parameters
  const paramStr = formatParameters(endpoint.method, endpoint.parameters);
  if (paramStr) {
    parts[0] += `（${paramStr}）`;
  }

  // Response fields
  const responseStr = formatResponseFields(endpoint.responseFields, endpoint.responseDescription);
  if (responseStr) {
    parts[0] += ` → 返回: ${responseStr}`;
  }

  return parts[0];
}

/**
 * Format endpoint parameters based on HTTP method.
 *
 * POST/PUT: body: { param1, param2?, ... }
 * GET/DELETE: query: param1?, param2?
 */
function formatParameters(
  method: ApiEndpoint['method'],
  parameters?: ApiEndpointParam[]
): string {
  if (!parameters || parameters.length === 0) {
    return '';
  }

  const paramNames = parameters.map((p) => {
    const optional = p.required ? '' : '?';
    return `${p.name}${optional}`;
  });

  if (method === 'POST' || method === 'PUT') {
    return `body: { ${paramNames.join(', ')} }`;
  }

  // GET/DELETE: query format
  return `query: ${paramNames.join(', ')}`;
}

/**
 * Format response fields.
 *
 * If responseDescription contains "数组" or "列表", wraps in array notation: [{ field1, field2 }]
 * Otherwise uses object notation: { field1, field2 }
 */
function formatResponseFields(
  responseFields?: ApiEndpointResponseField[],
  responseDescription?: string
): string {
  if (!responseFields || responseFields.length === 0) {
    return '';
  }

  const fieldNames = responseFields.map((f) => f.name).join(', ');
  const isArray =
    responseDescription != null &&
    (responseDescription.includes('数组') || responseDescription.includes('列表'));

  if (isArray) {
    return `[{ ${fieldNames} }]`;
  }

  return `{ ${fieldNames} }`;
}

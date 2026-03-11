/**
 * Secretary Core Service
 *
 * Shared core logic for the secretary AI pipeline.
 * Used by both the web route (route.ts) and IM channel (im-channel.ts).
 *
 * Responsibilities:
 * - AI config loading
 * - System prompt assembly (base prompt + dynamic context)
 * - Claude API calling
 * - AI response parsing
 * - Action execution (dispatch / skill_call / direct_reply)
 * - Greeting detection
 */

import { loadGlobalSettings } from '@/lib/services/settings';
import { getEmployeeById, getAllEmployees } from '@/lib/services/employee-service';
import { dispatchToEmployee } from '@/lib/services/secretary-dispatch';
import { callSkillApi } from '@/lib/services/secretary-skill-caller';
import { loadRegistry, getSkillByName } from '@/lib/services/api-skill-registry';
import { buildApiSkillPromptBlock } from '@/lib/services/api-skill-prompt';
import { formatSkillResult } from '@/lib/services/secretary-result-formatter';
import { getAllSkills } from '@/lib/services/skill-service';
import { buildSoulPromptBlock } from '@/lib/services/secretary-soul';
import type { SecretaryAction } from '@/lib/services/secretary-session';
import fs from 'fs/promises';
import path from 'path';

// ========== Surrogate Sanitizer ==========

/** Strip unpaired Unicode surrogates that break JSON encoding */
function stripSurrogates(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

// ========== Claude API Logger ==========

function getLogDir(): string {
  return process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
}

function getLogFilePath(): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return path.join(getLogDir(), 'logs', `claude-api-${dateStr}.log`);
}

/**
 * Append a Claude API call log entry to the daily log file (fire-and-forget).
 */
export async function appendClaudeLog(entry: {
  timestamp: string;
  model: string;
  systemPrompt: string;
  messagesCount: number;
  lastUserMessage: string;
  responseLength: number;
  responseText: string;
  durationMs: number;
  error?: string;
}): Promise<void> {
  try {
    const logPath = getLogFilePath();
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(logPath, line, 'utf-8');
  } catch {
    // never-throw: logging must not affect main flow
  }
}

// ========== Interfaces ==========

/**
 * The structured JSON format the AI returns.
 */
export interface AIDecision {
  action: 'dispatch' | 'skill_call' | 'direct_reply';
  reply?: string;
  employeeId?: string;
  instruction?: string;
  skillName?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path?: string;
  body?: any;
  queryParams?: Record<string, string>;
  /** AI 自报置信度 0-1，用于判断是否需要用户确认 */
  confidence?: number;
}

/**
 * Result from executing a secretary action.
 */
export interface SecretaryActionResult {
  reply: string;
  actions: SecretaryAction[];
}

/**
 * Claude API configuration.
 */
export interface ClaudeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// ========== Greeting Detection ==========

/** Common greeting patterns — matched messages skip AI call entirely */
const GREETING_PATTERNS =
  /^(你好.{0,3}|您好.{0,3}|hi|hello|hey|嗨.{0,3}|哈喽.{0,3}|在吗|在不在|在么|在嘛|早|早上好|下午好|晚上好|晚安|你好吗|你好呀|你好啊|怎么样|吃了吗|忙吗|忙不忙|干嘛呢|在干嘛|干啥呢|谢谢|感谢|辛苦了|好的|ok|okay|收到|嗯嗯|哦哦|明白了|了解|知道了)[\s!！?？。.~～]*$/i;

export function isSimpleGreeting(text: string): boolean {
  return GREETING_PATTERNS.test(text);
}

/** Pick a contextual reply for simple greetings instead of a generic one */
export function pickGreetingReply(text: string): string {
  const t = text.replace(/[\s!！?？。.~～]+$/g, '').toLowerCase();
  // Acknowledgements
  if (/^(谢谢|感谢|辛苦了)/.test(t)) return '不客气，随时找我 😊';
  if (/^(好的|ok|okay|收到|嗯嗯|哦哦|明白了|了解|知道了)/.test(t)) return '好的，有需要再叫我～';
  // How-are-you style
  if (/^(你好吗|怎么样|吃了吗|忙吗|忙不忙)/.test(t)) return '我挺好的，随时待命！有什么需要帮忙的吗？😊';
  // What-are-you-doing
  if (/^(干嘛呢|在干嘛|干啥呢)/.test(t)) return '在等你派活呢～有什么我可以帮忙的？';
  // Time-based greeting
  const hour = new Date().getHours();
  if (/^晚安/.test(t)) return '晚安，好梦 🌙';
  if (/^早/.test(t) || /^早上好/.test(t)) return '早上好！新的一天，有什么计划？☀️';
  if (/^下午好/.test(t)) return '下午好！需要我帮忙处理什么吗？';
  if (/^晚上好/.test(t)) return '晚上好！还在忙吗？有什么我能帮的？';
  // Default greeting with time awareness
  if (hour < 12) return '早上好！有什么我可以帮你的吗？😊';
  if (hour < 18) return '下午好！有什么我可以帮你的吗？😊';
  return '晚上好！有什么我可以帮你的吗？😊';
}

// ========== AI Config ==========

/**
 * Load Claude API configuration from global settings.
 */
export async function loadClaudeConfig(): Promise<ClaudeConfig> {
  const settings = await loadGlobalSettings();
  const claudeSettings = settings.cli_settings?.claude;

  const baseUrl =
    (claudeSettings?.apiUrl as string)?.trim() ||
    process.env.ANTHROPIC_BASE_URL?.trim() ||
    'https://api.100agent.co';

  const apiKey =
    (claudeSettings?.apiKey as string)?.trim() ||
    process.env.ANTHROPIC_AUTH_TOKEN?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    '';

  const model =
    (claudeSettings?.customModel as string)?.trim() ||
    (claudeSettings?.model as string)?.trim() ||
    'claude-sonnet-4-5-20250929';

  return { baseUrl, apiKey, model };
}

// ========== System Prompt ==========

/**
 * Build the system prompt for the secretary AI.
 *
 * Assembles: base employee prompt + dynamic date context + memory + API skill registry.
 * The base prompt (including response format, decision rules, and capability boundaries)
 * comes from the employee's system_prompt — editable via employee settings.
 * This function only appends runtime-dynamic content that cannot be pre-configured.
 */
export /**
 * Build a dynamic employee list block from all registered employees.
 * Excludes the secretary itself and the boss, since they are not dispatchable targets.
 */
async function buildEmployeeListBlock(): Promise<string> {
  try {
    const allEmployees = await getAllEmployees();
    const dispatchable = allEmployees.filter(
      (e) => e.mode !== 'secretary' && e.mode !== 'boss' && e.mode !== 'cli' && e.id !== 'builtin-boss'
    );

    if (dispatchable.length === 0) return '';

    const lines = dispatchable.map(
      (e) => `- **${e.name}**（${e.id}）：${e.description || e.name}`
    );

    return `\n\n**可调度的员工列表：**\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

/**
 * Build a dynamic skill list block from all registered skills.
 * Lists all skills (both API and Script) with their descriptions,
 * so the secretary AI can match user requests to available skills.
 */
export async function buildSkillListBlock(): Promise<string> {
  try {
    const allSkills = await getAllSkills();
    // Only include skills that have a SKILL.md (hasSkill flag) and a description
    const usableSkills = allSkills.filter(
      (s) => s.hasSkill && s.description
    );

    if (usableSkills.length === 0) return '';

    const lines = usableSkills.map((s) => {
      const type = s.hasApp ? 'API' : 'Script';
      const deployed = s.deployStatus === 'deployed' ? '✅ 已部署' : '';
      const displayName = s.displayName || s.name;
      return `- **${displayName}**（${s.name}，${type}）${deployed ? ` ${deployed}` : ''}：${s.description}`;
    });

    return `\n\n**可用的技能列表：**\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

/**
 * Build the system prompt for the secretary AI.
 *
 * Assembles: base employee prompt + dynamic skill list + dynamic employee list
 *            + dynamic date context + memory + API skill registry.
 * The base prompt (including response format, decision rules, and capability boundaries)
 * comes from the employee's system_prompt — editable via employee settings.
 * This function dynamically injects:
 * - The skill list with descriptions (from all registered skills, API + Script)
 * - The dispatchable employee list (from builtin-employees.json + user employees)
 * - Current date/time context
 * - Memory and dispatch learnings
 * - API skill registry (detailed endpoint info for deployed API skills)
 */
export async function buildSystemPrompt(
  secretarySystemPrompt: string,
  memoryBlock: string = ''
): Promise<string> {
  // Soul block — personality + user profile from SOUL.md / USER.md
  const soulBlock = await buildSoulPromptBlock();

  // Dynamic employee list — built from all registered employees
  const employeeListBlock = await buildEmployeeListBlock();

  // Dynamic skill list — built from all registered skills (API + Script)
  const skillListBlock = await buildSkillListBlock();

  // Dynamic date context — must be computed at runtime
  const now = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（周${weekdays[now.getDay()]}）`;
  const timeStr = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const dateContext = `

## ⚠️ 当前时间（非常重要）

**当前日期和时间：${dateStr} ${timeStr}**
**当前年份：${now.getFullYear()}年**
**时区：UTC+8（中国标准时间）**

你必须使用上述日期作为基准来计算所有相对时间：
- "今天" = ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日
- "明天" = ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate() + 1}日
- 创建待办或日程时，日期必须基于 ${now.getFullYear()} 年，不要使用其他年份。

**⚠️ 时间格式要求（极其重要）：**
- 所有时间必须使用 ISO 8601 格式，并带上 +08:00 时区偏移
- 格式：YYYY-MM-DDTHH:mm:ss+08:00
- 示例：用户说"晚上9点" → "${now.toISOString().split('T')[0]}T21:00:00+08:00"
- 示例：用户说"早上9点" → "${now.toISOString().split('T')[0]}T09:00:00+08:00"
- ❌ 不要使用 Z 结尾（那是 UTC 时间，会导致时间偏差8小时）
- ✅ 必须使用 +08:00 结尾`;

  // Dynamic API skill registry
  const registry = await loadRegistry();
  const apiSkillBlock = buildApiSkillPromptBlock(registry);
  const apiSkillSection = apiSkillBlock ? '\n\n' + apiSkillBlock : '';

  // Memory section
  const memorySection = memoryBlock ? '\n\n' + memoryBlock : '';

  // Soul block injected after base prompt, before dynamic context
  const soulSection = soulBlock ? '\n\n' + soulBlock : '';

  return secretarySystemPrompt + soulSection + skillListBlock + employeeListBlock + dateContext + memorySection + apiSkillSection;
}


// ========== Claude API ==========

/**
 * Call the Claude API to get the AI's decision.
 */
export async function callClaudeAPI(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string | any[] }>,
  config: ClaudeConfig
): Promise<string> {
  const url = `${config.baseUrl}/v1/messages`;
  const startTime = Date.now();
  console.log(`[SecretaryCore] 🌐 callClaudeAPI: model=${config.model}, url=${url}, messages=${messages.length}`);
  console.log(`[SecretaryCore] 📏 systemPrompt 长度=${systemPrompt.length}`);

  // Extract last user message for logging
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  const lastUserText = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content.slice(0, 500)
    : Array.isArray(lastUserMsg?.content)
      ? (lastUserMsg.content.find((b: any) => b.type === 'text')?.text || '').slice(0, 500)
      : '';

  let responseText = '';
  let error: string | undefined;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 4096,
        system: stripSurrogates(systemPrompt),
        messages: messages.map(m => ({
          ...m,
          content: typeof m.content === 'string'
            ? stripSurrogates(m.content)
            : Array.isArray(m.content)
              ? m.content.map((block: any) =>
                  block.type === 'text' ? { ...block, text: stripSurrogates(block.text || '') } : block
                )
              : m.content,
        })),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      error = `HTTP ${response.status}: ${errorText.slice(0, 500)}`;
      throw new Error(`AI 服务请求失败 (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (data.content && Array.isArray(data.content)) {
      const textBlock = data.content.find(
        (block: any) => block.type === 'text'
      );
      if (textBlock?.text) {
        responseText = textBlock.text;
        return responseText;
      }
    }

    error = '无效的响应格式';
    throw new Error('AI 服务返回了无效的响应格式');
  } catch (err) {
    if (!error) error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // Fire-and-forget log
    appendClaudeLog({
      timestamp: new Date().toISOString(),
      model: config.model,
      systemPrompt,
      messagesCount: messages.length,
      lastUserMessage: lastUserText,
      responseLength: responseText.length,
      responseText: responseText.slice(0, 2000),
      durationMs: Date.now() - startTime,
      ...(error ? { error } : {}),
    }).catch(() => {});
  }
}

// ========== AI Response Parsing ==========

/**
 * Parse the AI's response text into a structured decision.
 * Handles cases where the AI might wrap JSON in markdown code blocks,
 * or mix JSON with natural language text.
 */
export function parseAIDecision(responseText: string): AIDecision {
  let jsonStr = responseText.trim();

  // Strategy 1: Strip markdown code block wrappers if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Strategy 2: Try to parse the whole string as JSON
  try {
    const parsed = JSON.parse(jsonStr);
    if (
      parsed.action &&
      ['dispatch', 'skill_call', 'direct_reply'].includes(parsed.action)
    ) {
      return parsed as AIDecision;
    }
  } catch {
    // Not valid JSON, try other strategies
  }

  // Strategy 3: Find a JSON object embedded in the text
  const jsonObjectMatch = jsonStr.match(
    /\{[\s\S]*?"action"\s*:\s*"(dispatch|skill_call|direct_reply)"[\s\S]*?\}(?:\s*$)?/
  );
  if (jsonObjectMatch) {
    try {
      const startIdx = jsonStr.indexOf(jsonObjectMatch[0]);
      const candidate = extractJsonObject(jsonStr, startIdx);
      if (candidate) {
        const parsed = JSON.parse(candidate);
        if (
          parsed.action &&
          ['dispatch', 'skill_call', 'direct_reply'].includes(parsed.action)
        ) {
          return parsed as AIDecision;
        }
      }
    } catch {
      // Fall through
    }
  }

  // Strategy 4: Strip embedded JSON and use remaining text as direct reply
  const cleanedText = cleanJsonFromText(responseText);

  return {
    action: 'direct_reply',
    reply: cleanedText || responseText,
  };
}

/**
 * Extract a balanced JSON object starting at the given index.
 */
function extractJsonObject(text: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

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

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }

  return null;
}

/**
 * Remove JSON blocks from text, keeping only the natural language parts.
 */
function cleanJsonFromText(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/```(?:json)?\s*[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/^\s*\{[\s\S]*?\}\s*$/gm, '');
  cleaned = cleaned.replace(/^\s*"[^"]+"\s*:\s*.+$/gm, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

// ========== Action Executors ==========

/**
 * Execute a dispatch action: send a task to another employee.
 */
export async function executeDispatch(
  decision: AIDecision,
  imageFiles?: import('./secretary-dispatch').DispatchImageFile[],
  userMessage?: string,
  classificationTarget?: string,
): Promise<SecretaryActionResult> {
  const { employeeId, instruction } = decision;
  console.log(`[SecretaryCore] 🚀 executeDispatch: employeeId=${employeeId}, instruction="${instruction?.slice(0, 100)}", 有图片=${!!imageFiles}, classificationTarget=${classificationTarget || 'N/A'}`);

  if (!employeeId || !instruction) {
    return {
      reply: '调度信息不完整，请提供目标员工和任务说明。',
      actions: [],
    };
  }

  const employee = await getEmployeeById(employeeId);
  if (!employee) {
    const allEmployees = await getAllEmployees();
    const availableList = allEmployees
      .filter((e) => e.mode !== 'secretary' && e.id !== 'builtin-boss')
      .map((e) => `- ${e.name}（${e.id}）`)
      .join('\n');

    return {
      reply: `未找到员工 ${employeeId}。可用的员工有：\n${availableList}`,
      actions: [],
    };
  }

  // Prefer the user's original message over AI-generated instruction
  let finalInstruction = userMessage || instruction;

  // When dispatching to generalist and classificationTarget is available,
  // append skill hint so the generalist knows which skill to use.
  // Skip if the instruction already contains the hint (e.g. from dispatchToEmployee image handling).
  if (classificationTarget && employeeId === 'builtin-skill-generalist' && !finalInstruction.includes(`秘书已识别目标技能「${classificationTarget}」`)) {
    finalInstruction = `${finalInstruction}\n\n（提示：秘书已识别目标技能「${classificationTarget}」，请优先使用该技能完成任务）`;
  }

  const result = await dispatchToEmployee(employeeId, finalInstruction, imageFiles);

  if (result.success) {
    return {
      reply: `已将任务分配给 ${result.employeeName}，正在执行中⏳ 完成后会自动通知你结果。`,
      actions: [
        {
          type: 'dispatch',
          employeeId: result.employeeId,
          employeeName: result.employeeName,
          projectId: result.projectId,
        },
      ],
    };
  } else {
    return {
      reply: `调度失败：${result.error}`,
      actions: [],
    };
  }
}

/**
 * Validate that the AI-generated body contains all required fields
 * as defined in the skill's endpoint registry.
 * Returns an array of missing field names (empty if all present).
 */
export function validateSkillCallBody(
  skill: { endpoints?: Array<{ path: string; method: string; parameters?: Array<{ name: string; type: string; required: boolean }> }> },
  method: string,
  apiPath: string,
  body: any,
): string[] {
  if ((method !== 'POST' && method !== 'PUT') || !skill.endpoints) return [];
  const endpoint = skill.endpoints.find(ep => ep.path === apiPath && ep.method === method);
  if (!endpoint?.parameters) return [];
  const required = endpoint.parameters.filter(p => p.required);
  if (required.length === 0) return [];
  const missing: string[] = [];
  for (const param of required) {
    const val = body?.[param.name];
    if (val === undefined || val === null || val === '') {
      missing.push(param.name);
    }
  }
  return missing;
}

/**
 * Execute a skill API call action.
 * Uses generic result formatting — no business-specific path knowledge.
 */
export async function executeSkillCall(
  decision: AIDecision,
  imageFiles?: import('./secretary-dispatch').DispatchImageFile[],
  userMessage?: string,
  classificationTarget?: string,
): Promise<SecretaryActionResult> {
  const { skillName, method, path: apiPath, body, queryParams } = decision;

  // Use classificationTarget (from intent classification) as the actual skillName
  // This is more stable than AI-generated skillName which may be displayName
  const actualSkillName = classificationTarget || skillName;

  if (!actualSkillName || !method || !apiPath) {
    return {
      reply: '技能调用信息不完整，请提供技能名称、方法和路径。',
      actions: [],
    };
  }

  // Check registry for auth configuration status
  const registry = await loadRegistry();
  const registeredSkill = getSkillByName(registry, actualSkillName);

  // If skill doesn't exist in registry, dispatch to generalist employee
  if (!registeredSkill) {
    return executeDispatchToGeneralist(decision, imageFiles, userMessage, classificationTarget);
  }

  if (
    !registeredSkill.auth.configured &&
    registeredSkill.auth.authType !== 'none'
  ) {
    const envVarsList = registeredSkill.auth.envVars?.join(', ') || '';
    return {
      reply: `技能「${registeredSkill.displayName}」需要先配置认证信息才能使用。请在设置中配置以下环境变量：${envVarsList}`,
      actions: [
        {
          type: 'skill_call',
          skillName: actualSkillName,
          endpoint: `${method} ${apiPath}`,
        },
      ],
    };
  }

  // Validate required body fields based on registry definition
  // Returns list of missing required field names (empty if all present)
  const missingFields = validateSkillCallBody(registeredSkill, method, apiPath, body);
  if (missingFields.length > 0) {
    return {
      reply: `__MISSING_FIELDS__:${missingFields.join(',')}`,
      actions: [{
        type: 'skill_call',
        skillName: actualSkillName,
        endpoint: `${method} ${apiPath}`,
      }],
    };
  }

  const result = await callSkillApi(actualSkillName, method, apiPath, body, queryParams);

  if (result.success) {
    const reply = formatSkillResult(method, result.data);
    return {
      reply,
      actions: [
        {
          type: 'skill_call',
          skillName,
          endpoint: `${method} ${apiPath}`,
          result: result.data,
        },
      ],
    };
  } else {
    return {
      reply: `技能调用失败：${result.error}`,
      actions: [
        {
          type: 'skill_call',
          skillName,
          endpoint: `${method} ${apiPath}`,
        },
      ],
    };
  }
}

/**
 * Dispatch to the generalist skill employee when a requested skill doesn't exist.
 * Builds an instruction containing the user's original intent so the generalist
 * can decide whether to create, find, or compose skills to fulfill the request.
 */
async function executeDispatchToGeneralist(
  originalDecision: AIDecision,
  imageFiles?: import('./secretary-dispatch').DispatchImageFile[],
  userMessage?: string,
  classificationTarget?: string,
): Promise<SecretaryActionResult> {
  // Use classificationTarget as fallback when decision.skillName is empty
  const skillName = originalDecision.skillName || classificationTarget;

  // Use the user's original message as the primary instruction,
  // not the technical API analysis (method/path/body).
  // The generalist employee has its own SKILL.md that guides it to
  // scan existing skills, compose, upgrade, or create new ones.
  let instruction = userMessage || originalDecision.instruction || `请完成以下任务：${skillName}`;

  // Always append skill hint when skillName is available,
  // so the generalist knows which skill the secretary identified.
  // Skip if already present (dispatchToEmployee may also append it for image handling).
  if (skillName && !instruction.includes(`秘书已识别目标技能「${skillName}」`)) {
    instruction = `${instruction}\n\n（提示：秘书已识别目标技能「${skillName}」，请优先使用该技能完成任务）`;
  }

  const result = await dispatchToEmployee('builtin-skill-generalist', instruction, imageFiles);

  if (result.success) {
    return {
      reply: `已将任务分配给 ${result.employeeName}，正在执行中⏳ 完成后会自动通知你结果。`,
      actions: [
        {
          type: 'dispatch',
          employeeId: result.employeeId,
          employeeName: result.employeeName,
          projectId: result.projectId,
        },
      ],
    };
  } else {
    return {
      reply: `无法调度通才技能专家：${result.error}`,
      actions: [],
    };
  }
}


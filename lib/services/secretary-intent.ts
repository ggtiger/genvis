/**
 * Secretary Intent Classifier — 两步走意图识别
 *
 * Step 1: classifyIntent — 轻量分类，用极简 prompt 判断意图类型
 * Step 2: buildDetailedPrompt — 按需加载详细 prompt，获取执行参数
 *
 * 目的：减少每次请求的 token 消耗，只在需要时才加载完整上下文。
 */

import { loadClaudeConfig, callClaudeAPI, buildEmployeeListBlock, buildSkillListBlock, type ClaudeConfig } from './secretary-core';
import { loadRegistry } from './api-skill-registry';
import { buildApiSkillPromptBlock, buildTargetSkillPromptBlock } from './api-skill-prompt';
import { buildSoulPromptBlock } from './secretary-soul';
import type { IntentExample } from './intent-example-store';

// ========== Types ==========

export type IntentType = 'dispatch' | 'skill_call' | 'direct_reply';

export interface IntentClassification {
  intent: IntentType;
  /** 初步识别的目标（员工名/技能名），可能为空 */
  target?: string;
  /** 分类阶段的原始响应，用于 direct_reply 直接使用 */
  rawResponse?: string;
}

// ========== Step 1: 轻量分类 ==========

/**
 * 极简分类 prompt — 只需要知道意图类型，不需要完整参数。
 * 动态注入员工名称和技能名称列表（仅名称，不含详细描述和端点信息）。
 */
function buildClassificationPrompt(
  employeeNames: string[],
  skillNames: string[],
  intentExamples?: IntentExample[],
): string {
  const empList = employeeNames.length > 0
    ? `可调度的员工：\n${employeeNames.map(e => `- ${e}`).join('\n')}`
    : '当前没有可调度的员工';

  const skillList = skillNames.length > 0
    ? `可用的技能：\n${skillNames.map(s => `- ${s}`).join('\n')}`
    : '当前没有可用的技能';

  // 意图样本块（最高优先级）
  let examplesBlock = '';
  if (intentExamples && intentExamples.length > 0) {
    const lines = intentExamples.map(ex => {
      if (ex.action === 'dispatch') {
        return `"${ex.userMessage}" → {"intent":"dispatch","target":"${ex.target}"}`;
      } else if (ex.action === 'skill_call') {
        return `"${ex.userMessage}" → {"intent":"skill_call","target":"${ex.target}"}`;
      } else {
        return `"${ex.userMessage}" → {"intent":"direct_reply","target":""}`;
      }
    });
    examplesBlock = `\n历史正确分类（最高优先级，遇到相似请求必须参考）：\n${lines.join('\n')}\n`;
  }

  return `你是意图分类器。根据用户消息，判断应该执行哪种操作。

${empList}
${skillList}
${examplesBlock}
只返回 JSON，格式：
{"intent":"dispatch|skill_call|direct_reply","target":"目标名称或空"}

规则：
- 用户需求匹配某个技能 → skill_call，target 填技能名
- 用户需求需要某个员工完成 → dispatch，target 填员工名
- 用户需求是创建新工具/技能 → dispatch，target 填"通才技能专家"
- 用户需求是工具类任务（图片处理、文件转换、数据处理等）但没有匹配的技能 → dispatch，target 填"通才技能专家"
- 闲聊、问答、翻译、计算等 → direct_reply
- 你没有联网能力，实时信息（天气、新闻、股价）需要 dispatch 给有搜索能力的员工

只返回 JSON，不要任何其他文字。`;
}

/**
 * 从员工列表和技能列表中提取名称（轻量，不含详细信息）
 */
async function getEmployeeNames(): Promise<string[]> {
  try {
    const { getAllEmployees } = await import('./employee-service');
    const allEmployees = await getAllEmployees();
    return allEmployees
      .filter(e => e.mode !== 'secretary' && e.mode !== 'boss' && e.mode !== 'cli' && e.id !== 'builtin-boss')
      .map(e => {
        const desc = e.description ? `: ${e.description}` : '';
        return `${e.name}(${e.id})${desc}`;
      });
  } catch {
    return [];
  }
}

async function getSkillNames(): Promise<string[]> {
  try {
    const { getAllSkills } = await import('./skill-service');
    const allSkills = await getAllSkills();
    return allSkills
      .filter(s => s.hasSkill && s.description)
      .map(s => {
        const type = s.hasApp ? 'API' : 'Script';
        const deployed = s.deployStatus === 'deployed' ? '✅已部署' : '';
        const displayName = s.displayName || s.name;
        return `${displayName}(${s.name},${type})${deployed}: ${s.description}`;
      });
  } catch {
    return [];
  }
}

/**
 * Step 1: 轻量意图分类
 *
 * 用极简 prompt 判断用户消息的意图类型，token 消耗极低。
 */
export async function classifyIntent(
  userMessage: string,
  conversationContext?: string,
  intentExamples?: IntentExample[],
  externalConfig?: ClaudeConfig,
): Promise<IntentClassification> {
  const config = externalConfig ?? await loadClaudeConfig();

  if (!config.apiKey) {
    return { intent: 'direct_reply', rawResponse: 'AI 服务未配置' };
  }

  const [employeeNames, skillNames] = await Promise.all([
    getEmployeeNames(),
    getSkillNames(),
  ]);

  console.log(`[SecretaryIntent] 📋 员工列表(${employeeNames.length}):\n${employeeNames.map(e => `  - ${e}`).join('\n')}`);
  console.log(`[SecretaryIntent] 🧩 技能列表(${skillNames.length}):\n${skillNames.map(s => `  - ${s}`).join('\n')}`);
  if (intentExamples?.length) {
    console.log(`[SecretaryIntent] 📚 意图样本: ${intentExamples.length} 条`);
  }

  const systemPrompt = buildClassificationPrompt(employeeNames, skillNames, intentExamples);

  // 轻量分类：只传用户消息 + 可选的对话摘要，不传历史消息
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // 如果有对话上下文摘要，加入作为背景
  if (conversationContext) {
    messages.push({
      role: 'user',
      content: `[对话背景] ${conversationContext}`,
    });
    messages.push({
      role: 'assistant',
      content: '好的，我了解了对话背景。',
    });
  }

  messages.push({ role: 'user', content: userMessage });

  try {
    const _classifyStart = Date.now();
    const response = await callClaudeAPI(systemPrompt, messages, config);
    console.log(`[SecretaryIntent] ✅ 分类 API 返回, 耗时=${Date.now() - _classifyStart}ms, 响应: ${response.slice(0, 200)}`);
    return parseClassification(response);
  } catch (error) {
    console.error('[SecretaryIntent] Classification failed:', error);
    // 分类失败时 fallback 到 direct_reply
    return { intent: 'direct_reply' };
  }
}

/**
 * 解析分类结果
 */
function parseClassification(response: string): IntentClassification {
  let jsonStr = response.trim();

  // Strip markdown code block
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const intent = parsed.intent;
    if (['dispatch', 'skill_call', 'direct_reply'].includes(intent)) {
      return {
        intent,
        target: parsed.target || undefined,
        rawResponse: response,
      };
    }
  } catch {
    // Not valid JSON
  }

  // Fallback: 无法解析时当作 direct_reply
  return { intent: 'direct_reply', rawResponse: response };
}

// ========== Step 2: 按需加载详细 prompt ==========

/**
 * 根据意图类型，构建只包含必要上下文的详细 prompt。
 *
 * - direct_reply: 只需要基础 prompt + 记忆
 * - dispatch: 需要员工列表详情 + 强制 dispatch 指令
 * - skill_call: 需要 API 技能端点详情 + 强制 skill_call 指令
 *
 * 当 classifiedTarget 有值时，会在 prompt 中注入强制指令，
 * 避免模型在第二步重新决策导致意图漂移。
 */
export async function buildDetailedPrompt(
  intent: IntentType,
  baseSystemPrompt: string,
  extraContext: string = '',
  classifiedTarget?: string,
): Promise<string> {
  const parts: string[] = [baseSystemPrompt];

  // Soul block — personality + user profile (injected right after base prompt)
  const soulBlock = await buildSoulPromptBlock();
  if (soulBlock) parts.push(soulBlock);

  // 日期时间上下文（所有意图都需要）
  parts.push(buildDateContext());

  switch (intent) {
    case 'dispatch': {
      // 只加载员工列表
      const employeeBlock = await buildEmployeeListBlock();
      if (employeeBlock) parts.push(employeeBlock);
      // 也加载技能列表（dispatch 可能需要调度给通才技能专家）
      const skillBlock = await buildSkillListBlock();
      if (skillBlock) parts.push(skillBlock);
      // 注入强制 dispatch 指令，防止模型重新决策
      if (classifiedTarget) {
        parts.push(`## ⚠️ 强制指令

意图已确定为 dispatch，目标为「${classifiedTarget}」。
你必须输出 dispatch JSON，不要输出 direct_reply。
即使你觉得自己无法完成任务，也必须调度给目标员工，由员工来执行。
用户发送的图片等附件会随任务一起传递给员工。`);
      }
      break;
    }
    case 'skill_call': {
      // Progressive disclosure: only load target skill endpoints when target is known
      const registry = await loadRegistry();
      const apiSkillBlock = classifiedTarget
        ? buildTargetSkillPromptBlock(registry, classifiedTarget)
        : buildApiSkillPromptBlock(registry);
      if (apiSkillBlock) parts.push(apiSkillBlock);
      // Also need skill list (to check deploy status)
      const skillBlock = await buildSkillListBlock();
      if (skillBlock) parts.push(skillBlock);
      // 注入强制 skill_call 指令
      if (classifiedTarget) {
        parts.push(`## ⚠️ 强制指令

意图已确定为 skill_call，目标技能为「${classifiedTarget}」。
你必须输出 skill_call JSON，包含完整的 method、path、body 等参数。

禁止输出 dispatch！这是一个技能接口调用，不是员工调度。
即使你对 API 参数不确定，也必须尝试输出 skill_call JSON。`);
      }
      break;
    }
    case 'direct_reply': {
      // 直接回复不需要员工/技能详情，只需要基础能力
      break;
    }
  }

  // 额外上下文（记忆、摘要、工作事件等）
  if (extraContext) {
    parts.push(extraContext);
  }

  return parts.join('\n\n');
}

/**
 * 构建日期时间上下文块
 */
function buildDateContext(): string {
  const now = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（周${weekdays[now.getDay()]}）`;
  const timeStr = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return `## 当前时间

当前：${dateStr} ${timeStr}，UTC+8
- "今天" = ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日
- 时间格式：YYYY-MM-DDTHH:mm:ss+08:00（不要用 Z 结尾）`;
}

/**
 * Translator（翻译器）- 将英文 skill 内容翻译为中文
 *
 * 调用平台已有的 Claude API 进行翻译，保留技术术语。
 * 翻译失败时返回原始内容，不阻断流程。
 */

import type { ParsedManifest, TranslatedMeta } from './types';

/**
 * 简单检测文本是否主要为英文内容。
 * 如果文本中 ASCII 字母占比超过 40%，认为是英文。
 * 空字符串或纯符号返回 false（跳过翻译）。
 */
export function isEnglishText(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  const stripped = text.replace(/\s+/g, '');
  if (stripped.length === 0) return false;
  const asciiLetters = stripped.replace(/[^a-zA-Z]/g, '').length;
  return asciiLetters / stripped.length > 0.4;
}

/**
 * 加载 Claude API 配置
 */
async function loadClaudeConfig(): Promise<{
  baseUrl: string;
  apiKey: string;
  model: string;
}> {
  const { loadGlobalSettings } = await import('@/lib/services/settings');
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

/**
 * 调用 Claude API 进行翻译
 */
async function callTranslateAPI(
  prompt: string,
  config: { baseUrl: string; apiKey: string; model: string },
): Promise<string> {
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
      max_tokens: 4096,
      system:
        '你是一个专业的技术文档翻译助手。将英文内容翻译为中文。' +
        '保留所有技术术语的英文原文（如 API、JSON、Python、TypeScript、Node.js、FastAPI、Next.js、GitHub、npm、pip 等）。' +
        '只输出翻译结果，不要添加任何解释或额外内容。',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`翻译服务请求失败 (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (data.content && Array.isArray(data.content)) {
    const textBlock = data.content.find((block: any) => block.type === 'text');
    if (textBlock?.text) {
      return textBlock.text.trim();
    }
  }

  throw new Error('翻译服务返回了无效的响应格式');
}

/**
 * 翻译 skill 的元数据（displayName、description）
 *
 * - 检测 displayName 和 description 是否为英文
 * - 非英文内容跳过翻译，返回空 TranslatedMeta
 * - 翻译失败时返回空 TranslatedMeta 并记录日志
 * - 保留技术术语
 *
 * @param manifest - 解析后的第三方 skill 配置
 * @returns 翻译后的元数据，字段为空表示无需翻译或翻译失败
 */
export async function translateMeta(
  manifest: ParsedManifest,
): Promise<TranslatedMeta> {
  const result: TranslatedMeta = {};

  const displayName = manifest.displayName || '';
  const description = manifest.description || '';

  const needTranslateDisplayName = isEnglishText(displayName);
  const needTranslateDescription = isEnglishText(description);

  if (!needTranslateDisplayName && !needTranslateDescription) {
    return result;
  }

  try {
    const config = await loadClaudeConfig();

    if (!config.apiKey) {
      console.warn('[Translator] 未配置 API Key，跳过翻译');
      return result;
    }

    if (needTranslateDisplayName && displayName) {
      try {
        const prompt = `将以下 skill 名称翻译为中文（简短精炼）：\n\n${displayName}`;
        result.displayName = await callTranslateAPI(prompt, config);
      } catch (err) {
        console.warn('[Translator] displayName 翻译失败，保留原文:', err);
      }
    }

    if (needTranslateDescription && description) {
      try {
        const prompt = `将以下 skill 描述翻译为中文：\n\n${description}`;
        result.description = await callTranslateAPI(prompt, config);
      } catch (err) {
        console.warn('[Translator] description 翻译失败，保留原文:', err);
      }
    }
  } catch (err) {
    console.warn('[Translator] 翻译服务初始化失败，跳过翻译:', err);
  }

  return result;
}

/**
 * 翻译 SKILL.md 的正文内容
 *
 * - 检测内容是否为英文
 * - 非英文内容直接返回原文
 * - 翻译失败时返回原文并记录日志
 * - 保留技术术语和 Markdown 格式
 *
 * @param content - SKILL.md 正文内容
 * @returns 翻译后的内容，翻译失败时返回原文
 */
export async function translateContent(content: string): Promise<string> {
  if (!content || !isEnglishText(content)) {
    return content;
  }

  try {
    const config = await loadClaudeConfig();

    if (!config.apiKey) {
      console.warn('[Translator] 未配置 API Key，跳过翻译');
      return content;
    }

    const prompt =
      '将以下 Markdown 格式的技术文档翻译为中文，保留 Markdown 格式和所有技术术语：\n\n' +
      content;

    return await callTranslateAPI(prompt, config);
  } catch (err) {
    console.warn('[Translator] 内容翻译失败，保留原文:', err);
    return content;
  }
}

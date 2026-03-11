import { IMPlatform } from './types';

/**
 * 各平台单条消息最大字符数
 */
export const PLATFORM_MAX_LENGTH: Record<IMPlatform, number> = {
  wechat: 2048,
  feishu: 4096,
  dingtalk: 20000,
  qq: 4500,
  wecom: 2048,
};

/**
 * 去除 Markdown 语法标记，返回纯文本
 */
function stripMarkdown(text: string): string {
  let result = text;
  // 图片 ![alt](url) → alt
  result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 链接 [text](url) → text
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 标题 ### heading → heading
  result = result.replace(/^#{1,6}\s+/gm, '');
  // 粗斜体 ***text*** or ___text___
  result = result.replace(/(\*{3}|_{3})(.+?)\1/g, '$2');
  // 粗体 **text** or __text__
  result = result.replace(/(\*{2}|_{2})(.+?)\1/g, '$2');
  // 斜体 *text* or _text_
  result = result.replace(/(\*|_)(.+?)\1/g, '$2');
  // 删除线 ~~text~~
  result = result.replace(/~~(.+?)~~/g, '$1');
  // 行内代码 `code`
  result = result.replace(/`([^`]+)`/g, '$1');
  // 代码块 ```...```
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    // 提取代码块内容（去掉 ``` 和可选的语言标识）
    const inner = match.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    return inner;
  });
  // 无序列表标记 - item / * item / + item → item
  result = result.replace(/^[\s]*[-*+]\s+/gm, '');
  // 有序列表标记 1. item → item
  result = result.replace(/^[\s]*\d+\.\s+/gm, '');
  // 引用 > text → text
  result = result.replace(/^>\s?/gm, '');
  // 水平线 --- / *** / ___
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');

  return result;
}

/**
 * 将 Secretary 回复转换为各平台支持的格式
 * - 微信/企业微信: 纯文本（去除 Markdown 标记）
 * - 飞书: 纯文本（富文本转换由适配器层处理）
 * - 钉钉: 保留 Markdown
 * - QQ: 纯文本
 */
export function formatReplyForPlatform(reply: string, platform: IMPlatform): string {
  switch (platform) {
    case 'dingtalk':
      return reply;
    case 'wechat':
    case 'wecom':
    case 'qq':
    case 'feishu':
      return stripMarkdown(reply);
    default:
      return reply;
  }
}

/**
 * 按平台消息长度限制拆分消息
 * 优先在换行符处拆分，回退到字符限制硬切
 */
export function splitMessage(content: string, platform: IMPlatform): string[] {
  const maxLen = PLATFORM_MAX_LENGTH[platform];

  if (content.length <= maxLen) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // 在 maxLen 范围内找最后一个换行符
    const slice = remaining.slice(0, maxLen);
    const lastNewline = slice.lastIndexOf('\n');

    let splitAt: number;
    if (lastNewline > 0) {
      splitAt = lastNewline + 1; // 包含换行符在当前块
    } else {
      splitAt = maxLen; // 硬切
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

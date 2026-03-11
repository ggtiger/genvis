/**
 * Feedback Detector
 *
 * 分析 Claude SDK 输出的 assistant 消息，判断是"等待用户反馈的提问"还是"任务执行结果的陈述"。
 * 检测策略偏向"宁可多问不可漏问"，避免将提问误判为陈述。
 *
 * Requirements: 1.1, 1.2, 1.3, 8.1, 8.2, 8.3
 */

/** 确认请求关键词（中文） */
const CONFIRMATION_KEYWORDS = [
  '请确认', '请先确认', '请选择', '请问', '请告诉', '请提供', '请输入',
  '你想', '你希望', '你需要', '你觉得', '你认为', '你打算',
  '是否', '是不是', '能否', '可以吗', '好吗', '行吗',
  '哪个', '哪些', '哪种', '哪一', '什么', '怎么', '如何',
  '需要你', '等待你', '等你',
  '确认后', '确认此', '选择方案', '请回复', '请反馈',
  '方案A', '方案B', '方案C', '方案a', '方案b', '方案c','确认开始'
];

/**
 * 分析 assistant 消息内容，判断是否为等待用户反馈的提问。
 *
 * 检测策略：
 * 1. 消息末尾是否以问号结尾（中文 ？ 或英文 ?）
 * 2. 是否包含选项列表模式（1. 2. 3. 或 A. B. C.）
 * 3. 是否包含确认请求关键词
 *
 * 返回 true 表示消息是提问（等待反馈），false 表示是任务结果陈述。
 */
export function isWaitingForFeedback(content: string): boolean {
  if (!content || !content.trim()) return false;

  const trimmed = content.trim();

  // 策略 1：末尾以问号结尾（取最后 200 字符检查，避免长文本中间的问号干扰）
  const tail = trimmed.slice(-200);
  if (/[？?]\s*$/.test(tail)) return true;

  // 策略 2：包含选项列表模式（至少 2 个选项）
  const optionMatches = trimmed.match(/(?:^|\n)\s*(?:[1-9]\d?[.、)）]|[A-Za-z][.、)）])\s*\S/gm);
  if (optionMatches && optionMatches.length >= 2) {
    // 选项列表 + 任意疑问特征 → 高置信度
    if (CONFIRMATION_KEYWORDS.some(kw => trimmed.includes(kw))) return true;
    // 选项列表 + 问号（不限位置）
    if (/[？?]/.test(trimmed)) return true;
  }

  // 策略 3：末尾段落包含确认请求关键词
  // 取最后几段（最后 500 字符），因为确认请求可能不在最后一行
  const tailSection = trimmed.slice(-500);
  if (CONFIRMATION_KEYWORDS.some(kw => tailSection.includes(kw))) {
    return true;
  }

  // 策略 4：包含"确认"+"方案/选择/选项"组合模式
  if (/确认/.test(tailSection) && /方案|选择|选项|技术栈/.test(tailSection)) {
    return true;
  }

  return false;
}

/**
 * 将反馈问题序列化为 JSON 字符串，用于存储到 UserRequest 元数据。
 */
export function serializeFeedbackQuestion(content: string): string {
  return JSON.stringify({ question: content });
}

/**
 * 从序列化的 JSON 字符串中反序列化反馈问题内容。
 */
export function deserializeFeedbackQuestion(serialized: string): string {
  try {
    const parsed = JSON.parse(serialized);
    return parsed.question ?? '';
  } catch {
    return serialized;
  }
}

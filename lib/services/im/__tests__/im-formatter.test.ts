import { describe, it, expect } from 'vitest';
import { formatReplyForPlatform, splitMessage, PLATFORM_MAX_LENGTH } from '../im-formatter';
import { IMPlatform } from '../types';

describe('formatReplyForPlatform', () => {
  const markdownText = '# Title\n\n**bold** and *italic* text\n\n- item1\n- item2\n\n[link](https://example.com)\n\n`code`\n\n```js\nconsole.log("hi")\n```';

  it('should keep Markdown as-is for dingtalk', () => {
    expect(formatReplyForPlatform(markdownText, 'dingtalk')).toBe(markdownText);
  });

  it('should strip Markdown for wechat', () => {
    const result = formatReplyForPlatform(markdownText, 'wechat');
    expect(result).not.toContain('**');
    expect(result).not.toContain('# ');
    expect(result).not.toContain('```');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
  });

  it('should strip Markdown for wecom', () => {
    const result = formatReplyForPlatform('**hello** world', 'wecom');
    expect(result).toBe('hello world');
  });

  it('should strip Markdown for qq', () => {
    const result = formatReplyForPlatform('## Heading\n*emphasis*', 'qq');
    expect(result).not.toContain('##');
    expect(result).not.toContain('*');
    expect(result).toContain('Heading');
    expect(result).toContain('emphasis');
  });

  it('should strip Markdown for feishu', () => {
    const result = formatReplyForPlatform('[click here](https://example.com)', 'feishu');
    expect(result).toBe('click here');
  });

  it('should handle plain text without changes', () => {
    const plain = 'Hello, this is plain text.';
    expect(formatReplyForPlatform(plain, 'wechat')).toBe(plain);
    expect(formatReplyForPlatform(plain, 'dingtalk')).toBe(plain);
  });

  it('should strip image markdown', () => {
    const result = formatReplyForPlatform('![alt text](https://img.png)', 'wechat');
    expect(result).toBe('alt text');
  });

  it('should strip strikethrough', () => {
    const result = formatReplyForPlatform('~~deleted~~', 'qq');
    expect(result).toBe('deleted');
  });

  it('should handle empty string', () => {
    expect(formatReplyForPlatform('', 'wechat')).toBe('');
    expect(formatReplyForPlatform('', 'dingtalk')).toBe('');
  });
});

describe('splitMessage', () => {
  it('should return single chunk when content is within limit', () => {
    const content = 'short message';
    expect(splitMessage(content, 'dingtalk')).toEqual([content]);
  });

  it('should return single chunk when content equals limit', () => {
    const content = 'a'.repeat(PLATFORM_MAX_LENGTH.wechat);
    const chunks = splitMessage(content, 'wechat');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(content);
  });

  it('should split at newline boundaries when possible', () => {
    const line = 'a'.repeat(1000);
    const content = `${line}\n${line}\n${line}`;
    const chunks = splitMessage(content, 'wechat'); // limit 2048
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be within limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(PLATFORM_MAX_LENGTH.wechat);
    }
    // Concatenation should equal original
    expect(chunks.join('')).toBe(content);
  });

  it('should hard-split when no newline found', () => {
    const content = 'a'.repeat(5000);
    const chunks = splitMessage(content, 'wechat'); // limit 2048
    expect(chunks.length).toBe(3); // 2048 + 2048 + 904
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(PLATFORM_MAX_LENGTH.wechat);
    }
    expect(chunks.join('')).toBe(content);
  });

  it('should respect different platform limits', () => {
    const platforms: IMPlatform[] = ['wechat', 'feishu', 'dingtalk', 'qq', 'wecom'];
    const content = 'x'.repeat(25000);

    for (const platform of platforms) {
      const chunks = splitMessage(content, platform);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(PLATFORM_MAX_LENGTH[platform]);
      }
      expect(chunks.join('')).toBe(content);
    }
  });

  it('should handle empty string', () => {
    expect(splitMessage('', 'wechat')).toEqual(['']);
  });
});

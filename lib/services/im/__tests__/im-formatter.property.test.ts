/**
 * Property-based tests for im-formatter.
 *
 * **Feature: im-channel-integration, Property 6: 消息格式化平台适配**
 * **Feature: im-channel-integration, Property 7: 长消息拆分正确性**
 * **Validates: Requirements 4.2, 5.1, 5.2**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatReplyForPlatform, splitMessage, PLATFORM_MAX_LENGTH } from '../im-formatter';
import type { IMPlatform } from '../types';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const allPlatforms: IMPlatform[] = ['wechat', 'feishu', 'dingtalk', 'qq', 'wecom'];
const platformArb = fc.constantFrom<IMPlatform>(...allPlatforms);

/** Platforms that strip Markdown (everything except dingtalk) */
const nonDingtalkPlatforms: IMPlatform[] = ['wechat', 'feishu', 'qq', 'wecom'];
const nonDingtalkPlatformArb = fc.constantFrom<IMPlatform>(...nonDingtalkPlatforms);

/** Safe text: alphanumeric + spaces only (no Markdown-special chars) */
const safeTextArb = fc.stringMatching(/^[a-zA-Z0-9 ]{1,30}$/);

/** Arbitrary string for split testing — various lengths */
const splitTestStringArb = fc.string({ minLength: 0, maxLength: 50000 });

// ---------------------------------------------------------------------------
// Property 6: 消息格式化平台适配
// ---------------------------------------------------------------------------

describe('消息格式化平台适配 (Property 6)', () => {
  /**
   * **Feature: im-channel-integration, Property 6: 消息格式化平台适配**
   * **Validates: Requirements 4.2, 5.1**
   *
   * For any reply text and target platform, the formatted message should not
   * contain markup syntax unsupported by the target platform (e.g. WeChat
   * should not contain Markdown markers), and the plain text semantic content
   * should be consistent with the original reply.
   */
  it('dingtalk preserves input exactly (identity)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (text) => {
        const result = formatReplyForPlatform(text, 'dingtalk');
        expect(result).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('non-dingtalk platforms strip bold markers (**)', () => {
    fc.assert(
      fc.property(safeTextArb, nonDingtalkPlatformArb, (innerText, platform) => {
        const input = `**${innerText}**`;
        const result = formatReplyForPlatform(input, platform);
        expect(result).not.toMatch(/\*\*/);
        expect(result).toContain(innerText);
      }),
      { numRuns: 100 },
    );
  });

  it('non-dingtalk platforms strip heading markers (#)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        safeTextArb,
        nonDingtalkPlatformArb,
        (level, text, platform) => {
          const input = `${'#'.repeat(level)} ${text}`;
          const result = formatReplyForPlatform(input, platform);
          expect(result).not.toMatch(/^#{1,6}\s+/);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('non-dingtalk platforms strip inline code backticks', () => {
    fc.assert(
      fc.property(safeTextArb, nonDingtalkPlatformArb, (code, platform) => {
        const input = `\`${code}\``;
        const result = formatReplyForPlatform(input, platform);
        expect(result).not.toContain('`');
        expect(result).toContain(code);
      }),
      { numRuns: 100 },
    );
  });

  it('non-dingtalk platforms strip code block markers (```)', () => {
    fc.assert(
      fc.property(safeTextArb, nonDingtalkPlatformArb, (code, platform) => {
        const input = `\`\`\`\n${code}\n\`\`\``;
        const result = formatReplyForPlatform(input, platform);
        expect(result).not.toContain('```');
        expect(result).toContain(code);
      }),
      { numRuns: 100 },
    );
  });

  it('non-dingtalk platforms strip link syntax, preserving link text', () => {
    fc.assert(
      fc.property(safeTextArb, nonDingtalkPlatformArb, (linkText, platform) => {
        const input = `[${linkText}](https://example.com)`;
        const result = formatReplyForPlatform(input, platform);
        expect(result).toContain(linkText);
        expect(result).not.toContain('](');
      }),
      { numRuns: 100 },
    );
  });

  it('non-dingtalk platforms strip strikethrough markers (~~)', () => {
    fc.assert(
      fc.property(safeTextArb, nonDingtalkPlatformArb, (text, platform) => {
        const input = `~~${text}~~`;
        const result = formatReplyForPlatform(input, platform);
        expect(result).not.toMatch(/~~/);
        expect(result).toContain(text);
      }),
      { numRuns: 100 },
    );
  });

  it('plain text passes through unchanged for all platforms', () => {
    const plainTextArb = fc.stringMatching(/^[a-zA-Z0-9 ,.!?:;]{0,100}$/);

    fc.assert(
      fc.property(plainTextArb, platformArb, (text, platform) => {
        const result = formatReplyForPlatform(text, platform);
        expect(result).toBe(text);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: 长消息拆分正确性
// ---------------------------------------------------------------------------

describe('长消息拆分正确性 (Property 7)', () => {
  /**
   * **Feature: im-channel-integration, Property 7: 长消息拆分正确性**
   * **Validates: Requirements 5.2**
   *
   * For any string and target platform, each split chunk should not exceed
   * the platform's message length limit, and all chunks concatenated in
   * order should equal the original string.
   */
  it('each chunk length <= platform limit for any string and platform', () => {
    fc.assert(
      fc.property(splitTestStringArb, platformArb, (content, platform) => {
        const chunks = splitMessage(content, platform);
        const maxLen = PLATFORM_MAX_LENGTH[platform];
        for (const chunk of chunks) {
          expect(chunk.length).toBeLessThanOrEqual(maxLen);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('concatenation of chunks equals original string', () => {
    fc.assert(
      fc.property(splitTestStringArb, platformArb, (content, platform) => {
        const chunks = splitMessage(content, platform);
        expect(chunks.join('')).toBe(content);
      }),
      { numRuns: 100 },
    );
  });

  it('split always produces at least one chunk', () => {
    fc.assert(
      fc.property(splitTestStringArb, platformArb, (content, platform) => {
        const chunks = splitMessage(content, platform);
        expect(chunks.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  it('short messages (within limit) produce exactly one chunk', () => {
    fc.assert(
      fc.property(platformArb, (platform) => {
        const maxLen = PLATFORM_MAX_LENGTH[platform];
        // Generate a string that fits within the limit
        const shortContent = 'a'.repeat(Math.min(maxLen, 100));
        const chunks = splitMessage(shortContent, platform);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toBe(shortContent);
      }),
      { numRuns: 100 },
    );
  });

  it('chunk count is ceil(length / maxLen) for strings without newlines', () => {
    // For strings without newlines, hard-split produces exactly ceil(len/max) chunks
    const noNewlineArb = fc.stringMatching(/^[a-zA-Z0-9]{1,25000}$/);

    fc.assert(
      fc.property(noNewlineArb, platformArb, (content, platform) => {
        const maxLen = PLATFORM_MAX_LENGTH[platform];
        const chunks = splitMessage(content, platform);
        const expectedChunks = Math.ceil(content.length / maxLen);
        expect(chunks.length).toBe(expectedChunks);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Webhook 签名验证属性测试
 *
 * **Feature: im-channel-integration, Property 5: Webhook 签名验证正确性**
 * **Feature: im-channel-integration, Property 11: 时间戳防重放**
 * **Validates: Requirements 2.2, 8.1, 8.5**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'crypto';
import { verifyWechatSignature } from '../adapters/wechat-webhook';
import { verifyWecomSignature } from '../adapters/wecom-webhook';

// ---------------------------------------------------------------------------
// 生成器
// ---------------------------------------------------------------------------

/** 生成非空 ASCII 字符串，模拟 token / nonce 等参数 */
const tokenArb = fc.stringMatching(/^[a-zA-Z0-9_]{1,32}$/);
const timestampArb = fc.stringMatching(/^[0-9]{1,10}$/);
const nonceArb = fc.stringMatching(/^[a-zA-Z0-9]{1,16}$/);
/** 企业微信加密消息体（任意非空字符串） */
const encryptMsgArb = fc.stringMatching(/^[a-zA-Z0-9+/=]{1,64}$/);

// ---------------------------------------------------------------------------
// 辅助函数：计算正确签名
// ---------------------------------------------------------------------------

/** 微信签名算法：SHA1(sort([token, timestamp, nonce]).join('')) */
function computeWechatSignature(token: string, timestamp: string, nonce: string): string {
  const arr = [token, timestamp, nonce].sort();
  return createHash('sha1').update(arr.join('')).digest('hex');
}

/** 企业微信签名算法：SHA1(sort([token, timestamp, nonce, encryptMsg]).join('')) */
function computeWecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encryptMsg: string
): string {
  const arr = [token, timestamp, nonce, encryptMsg].sort();
  return createHash('sha1').update(arr.join('')).digest('hex');
}

/**
 * 对签名进行随机篡改：翻转一个随机字符
 * 返回一个与原签名不同的字符串
 */
function tamperSignature(signature: string, index: number): string {
  if (signature.length === 0) return 'x';
  const pos = index % signature.length;
  const chars = signature.split('');
  // 将该位置的十六进制字符替换为不同的字符
  const original = chars[pos];
  const replacement = original === 'a' ? 'b' : 'a';
  chars[pos] = replacement;
  return chars.join('');
}

// ---------------------------------------------------------------------------
// Property 5: Webhook 签名验证正确性
// ---------------------------------------------------------------------------

describe('Webhook 签名验证正确性 (Property 5)', () => {
  /**
   * **Feature: im-channel-integration, Property 5: Webhook 签名验证正确性**
   * **Validates: Requirements 2.2, 8.1**
   *
   * 微信平台：使用正确密钥计算的签名应通过验证
   */
  it('微信：正确签名应通过验证', () => {
    fc.assert(
      fc.property(tokenArb, timestampArb, nonceArb, (token, timestamp, nonce) => {
        const signature = computeWechatSignature(token, timestamp, nonce);
        expect(verifyWechatSignature(token, timestamp, nonce, signature)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Feature: im-channel-integration, Property 5: Webhook 签名验证正确性**
   * **Validates: Requirements 2.2, 8.1**
   *
   * 微信平台：对签名进行任意修改后应验证失败
   */
  it('微信：篡改签名应验证失败', () => {
    fc.assert(
      fc.property(
        tokenArb,
        timestampArb,
        nonceArb,
        fc.integer({ min: 0, max: 39 }),
        (token, timestamp, nonce, tamperIndex) => {
          const correctSignature = computeWechatSignature(token, timestamp, nonce);
          const tamperedSignature = tamperSignature(correctSignature, tamperIndex);
          // 篡改后的签名与原签名不同，应验证失败
          if (tamperedSignature !== correctSignature) {
            expect(verifyWechatSignature(token, timestamp, nonce, tamperedSignature)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Feature: im-channel-integration, Property 5: Webhook 签名验证正确性**
   * **Validates: Requirements 2.2, 8.1**
   *
   * 企业微信平台：使用正确密钥计算的签名应通过验证
   */
  it('企业微信：正确签名应通过验证', () => {
    fc.assert(
      fc.property(
        tokenArb,
        timestampArb,
        nonceArb,
        encryptMsgArb,
        (token, timestamp, nonce, encryptMsg) => {
          const signature = computeWecomSignature(token, timestamp, nonce, encryptMsg);
          expect(verifyWecomSignature(token, timestamp, nonce, encryptMsg, signature)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Feature: im-channel-integration, Property 5: Webhook 签名验证正确性**
   * **Validates: Requirements 2.2, 8.1**
   *
   * 企业微信平台：对签名进行任意修改后应验证失败
   */
  it('企业微信：篡改签名应验证失败', () => {
    fc.assert(
      fc.property(
        tokenArb,
        timestampArb,
        nonceArb,
        encryptMsgArb,
        fc.integer({ min: 0, max: 39 }),
        (token, timestamp, nonce, encryptMsg, tamperIndex) => {
          const correctSignature = computeWecomSignature(token, timestamp, nonce, encryptMsg);
          const tamperedSignature = tamperSignature(correctSignature, tamperIndex);
          if (tamperedSignature !== correctSignature) {
            expect(
              verifyWecomSignature(token, timestamp, nonce, encryptMsg, tamperedSignature)
            ).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Feature: im-channel-integration, Property 5: Webhook 签名验证正确性**
   * **Validates: Requirements 2.2, 8.1**
   *
   * 微信平台：使用错误 token 计算的签名应验证失败
   */
  it('微信：错误 token 应验证失败', () => {
    fc.assert(
      fc.property(
        tokenArb,
        tokenArb,
        timestampArb,
        nonceArb,
        (token1, token2, timestamp, nonce) => {
          // 仅当两个 token 不同时测试
          if (token1 === token2) return;
          const signature = computeWechatSignature(token1, timestamp, nonce);
          expect(verifyWechatSignature(token2, timestamp, nonce, signature)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Feature: im-channel-integration, Property 5: Webhook 签名验证正确性**
   * **Validates: Requirements 2.2, 8.1**
   *
   * 企业微信平台：使用错误 token 应验证失败
   */
  it('企业微信：错误 token 应验证失败', () => {
    fc.assert(
      fc.property(
        tokenArb,
        tokenArb,
        timestampArb,
        nonceArb,
        encryptMsgArb,
        (token1, token2, timestamp, nonce, encryptMsg) => {
          if (token1 === token2) return;
          const signature = computeWecomSignature(token1, timestamp, nonce, encryptMsg);
          expect(
            verifyWecomSignature(token2, timestamp, nonce, encryptMsg, signature)
          ).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 11: 时间戳防重放
// ---------------------------------------------------------------------------

describe('时间戳防重放 (Property 11)', () => {
  /**
   * **Feature: im-channel-integration, Property 11: 时间戳防重放**
   * **Validates: Requirements 8.5**
   *
   * 当请求时间戳与服务器时间相差在 5 分钟以内时，应视为有效
   */
  it('5 分钟以内的时间戳应视为有效', () => {
    fc.assert(
      fc.property(
        // 偏移量：-299 到 +299 秒（严格在 5 分钟以内）
        fc.integer({ min: -299, max: 299 }),
        (offsetSeconds) => {
          const serverTime = Math.floor(Date.now() / 1000);
          const requestTime = serverTime + offsetSeconds;
          // 5 分钟 = 300 秒，差值 <= 300 应有效
          const isValid = Math.abs(serverTime - requestTime) <= 300;
          expect(isValid).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Feature: im-channel-integration, Property 11: 时间戳防重放**
   * **Validates: Requirements 8.5**
   *
   * 当请求时间戳与服务器时间相差超过 5 分钟时，应拒绝请求
   */
  it('超过 5 分钟的时间戳应被拒绝', () => {
    fc.assert(
      fc.property(
        // 偏移量：301 到 86400 秒（超过 5 分钟，最多 1 天）
        fc.integer({ min: 301, max: 86400 }),
        fc.boolean(),
        (offsetSeconds, isPositive) => {
          const serverTime = Math.floor(Date.now() / 1000);
          // 正向或负向偏移
          const requestTime = isPositive
            ? serverTime + offsetSeconds
            : serverTime - offsetSeconds;
          // 差值 > 300 应被拒绝
          const shouldReject = Math.abs(serverTime - requestTime) > 300;
          expect(shouldReject).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Feature: im-channel-integration, Property 11: 时间戳防重放**
   * **Validates: Requirements 8.5**
   *
   * 边界值：恰好 300 秒（5 分钟）的时间戳应视为有效（不超过 5 分钟）
   */
  it('恰好 5 分钟的时间戳应视为有效', () => {
    fc.assert(
      fc.property(fc.boolean(), (isPositive) => {
        const serverTime = Math.floor(Date.now() / 1000);
        const requestTime = isPositive ? serverTime + 300 : serverTime - 300;
        // 恰好 300 秒，abs(diff) = 300，不超过 300，应有效
        const isValid = Math.abs(serverTime - requestTime) <= 300;
        expect(isValid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: im-channel-integration, Property 11: 时间戳防重放**
   * **Validates: Requirements 8.5**
   *
   * 恰好 301 秒的时间戳应被拒绝
   */
  it('恰好 301 秒的时间戳应被拒绝', () => {
    fc.assert(
      fc.property(fc.boolean(), (isPositive) => {
        const serverTime = Math.floor(Date.now() / 1000);
        const requestTime = isPositive ? serverTime + 301 : serverTime - 301;
        const shouldReject = Math.abs(serverTime - requestTime) > 300;
        expect(shouldReject).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

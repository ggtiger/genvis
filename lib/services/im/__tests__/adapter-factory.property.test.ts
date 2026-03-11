/**
 * Property-based tests for adapter factory routing correctness.
 *
 * **Feature: im-channel-integration, Property 1: 适配器工厂路由正确性**
 * **Validates: Requirements 1.1, 2.1, 6.2**
 *
 * For any valid platform identifier, the adapter factory should return the
 * correct adapter type: Stream platforms (dingtalk, feishu, qq) return
 * StreamAdapter, Webhook platforms (wechat, wecom) return WebhookAdapter,
 * and the adapter's `platform` property matches the requested platform.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { IMPlatform, IMStandardMessage, IMReplyRequest, IMChannelConfig } from '../types';
import { STREAM_PLATFORMS, WEBHOOK_PLATFORMS } from '../types';
import type { StreamAdapter, WebhookAdapter } from '../adapter';
import {
  registerStreamAdapter,
  registerWebhookAdapter,
  getStreamAdapter,
  getWebhookAdapter,
  isStreamPlatform,
} from '../adapter-factory';

// ---------------------------------------------------------------------------
// Mock adapter factories
// ---------------------------------------------------------------------------

function createMockStreamAdapter(platform: IMPlatform): StreamAdapter {
  return {
    platform,
    receiveMode: 'stream' as const,
    async connect() {},
    async disconnect() {},
    isConnected: () => false,
    async sendReply() {},
  };
}

function createMockWebhookAdapter(platform: IMPlatform): WebhookAdapter {
  return {
    platform,
    receiveMode: 'webhook' as const,
    async verifySignature() { return { valid: true }; },
    async handleChallenge() { return { isChallenge: false }; },
    async parseMessage() { return null; },
    async sendReply() {},
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const streamPlatformArb = fc.constantFrom<IMPlatform>(...STREAM_PLATFORMS);
const webhookPlatformArb = fc.constantFrom<IMPlatform>(...WEBHOOK_PLATFORMS);
const allPlatformArb = fc.constantFrom<IMPlatform>(...STREAM_PLATFORMS, ...WEBHOOK_PLATFORMS);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('适配器工厂路由正确性 (Property 1)', () => {
  beforeEach(() => {
    // Register mock adapters for all platforms so the factory can resolve them
    for (const p of STREAM_PLATFORMS) {
      registerStreamAdapter(p, async () => createMockStreamAdapter(p));
    }
    for (const p of WEBHOOK_PLATFORMS) {
      registerWebhookAdapter(p, async () => createMockWebhookAdapter(p));
    }
  });

  it('isStreamPlatform returns true for all stream platforms and false for webhook platforms', () => {
    fc.assert(
      fc.property(allPlatformArb, (platform) => {
        const expected = STREAM_PLATFORMS.includes(platform);
        expect(isStreamPlatform(platform)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('getStreamAdapter returns a StreamAdapter with matching platform for stream platforms', async () => {
    await fc.assert(
      fc.asyncProperty(streamPlatformArb, async (platform) => {
        const adapter = await getStreamAdapter(platform);
        expect(adapter.receiveMode).toBe('stream');
        expect(adapter.platform).toBe(platform);
        expect(typeof adapter.connect).toBe('function');
        expect(typeof adapter.disconnect).toBe('function');
        expect(typeof adapter.isConnected).toBe('function');
      }),
      { numRuns: 100 },
    );
  });

  it('getWebhookAdapter returns a WebhookAdapter with matching platform for webhook platforms', async () => {
    await fc.assert(
      fc.asyncProperty(webhookPlatformArb, async (platform) => {
        const adapter = await getWebhookAdapter(platform);
        expect(adapter.receiveMode).toBe('webhook');
        expect(adapter.platform).toBe(platform);
        expect(typeof adapter.verifySignature).toBe('function');
        expect(typeof adapter.handleChallenge).toBe('function');
        expect(typeof adapter.parseMessage).toBe('function');
      }),
      { numRuns: 100 },
    );
  });

  it('stream platforms never resolve as webhook adapters and vice versa', async () => {
    await fc.assert(
      fc.asyncProperty(streamPlatformArb, async (platform) => {
        // Stream platform should not be in webhook registry (getWebhookAdapter should throw
        // unless someone also registered it — but by design only stream adapters are registered
        // for stream platforms). We verify the routing classification is consistent.
        expect(isStreamPlatform(platform)).toBe(true);
        expect(WEBHOOK_PLATFORMS.includes(platform)).toBe(false);
      }),
      { numRuns: 100 },
    );

    await fc.assert(
      fc.asyncProperty(webhookPlatformArb, async (platform) => {
        expect(isStreamPlatform(platform)).toBe(false);
        expect(STREAM_PLATFORMS.includes(platform)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('adapter platform property is always consistent with the requested platform', async () => {
    await fc.assert(
      fc.asyncProperty(allPlatformArb, async (platform) => {
        if (isStreamPlatform(platform)) {
          const adapter = await getStreamAdapter(platform);
          expect(adapter.platform).toBe(platform);
        } else {
          const adapter = await getWebhookAdapter(platform);
          expect(adapter.platform).toBe(platform);
        }
      }),
      { numRuns: 100 },
    );
  });
});

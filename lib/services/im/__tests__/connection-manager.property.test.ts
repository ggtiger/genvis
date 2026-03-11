/**
 * Property-based tests for ConnectionManager.
 *
 * **Feature: im-channel-integration, Property 2: 指数退避计算正确性**
 * **Feature: im-channel-integration, Property 3: 连接状态转换与通知**
 * **Validates: Requirements 1.3, 1.4, 9.1, 9.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { ConnectionManager } from '../connection-manager';
import type { StreamAdapter } from '../adapter';
import type { IMPlatform, IMChannelConfig, ChannelStatus, ConnectionStatus } from '../types';
import { STREAM_PLATFORMS } from '../types';

// ---------------------------------------------------------------------------
// Mock adapter-factory so ConnectionManager.connect() can resolve adapters
// ---------------------------------------------------------------------------

vi.mock('../adapter-factory', () => {
  return {
    getStreamAdapter: vi.fn(),
    isStreamPlatform: (p: IMPlatform) => STREAM_PLATFORMS.includes(p),
  };
});

import { getStreamAdapter } from '../adapter-factory';
const mockedGetStreamAdapter = vi.mocked(getStreamAdapter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStreamAdapter(platform: IMPlatform, opts?: { connectFails?: boolean }): StreamAdapter {
  let connected = false;
  return {
    platform,
    receiveMode: 'stream' as const,
    async connect() {
      if (opts?.connectFails) throw new Error('connection failed');
      connected = true;
    },
    async disconnect() {
      connected = false;
    },
    isConnected: () => connected,
    async sendReply() {},
  };
}

function makeConfig(platform: IMPlatform): IMChannelConfig {
  return {
    enabled: true,
    receiveMode: 'stream',
    appId: `app-${platform}`,
    appSecret: `secret-${platform}`,
    token: `token-${platform}`,
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const streamPlatformArb = fc.constantFrom<IMPlatform>(...STREAM_PLATFORMS);

/** Retry count in a reasonable range: 0..20 covers well beyond maxDelay cap */
const retryCountArb = fc.integer({ min: 0, max: 20 });

/** Generate 1..5 listeners to register */
const listenerCountArb = fc.integer({ min: 1, max: 5 });

// ---------------------------------------------------------------------------
// Property 2: 指数退避计算正确性
// ---------------------------------------------------------------------------

describe('指数退避计算正确性 (Property 2)', () => {
  /**
   * **Feature: im-channel-integration, Property 2: 指数退避计算正确性**
   * **Validates: Requirements 1.3**
   *
   * For any retry count n (0 ≤ n), the reconnect delay should equal
   * min(initialDelay × 2^n, maxDelay) where initialDelay=1000, maxDelay=60000.
   */
  it('delay equals min(1000 * 2^n, 60000) for any retry count n', () => {
    const manager = new ConnectionManager();

    fc.assert(
      fc.property(retryCountArb, (n) => {
        const actual = manager.getReconnectDelay(n);
        const expected = Math.min(1000 * Math.pow(2, n), 60000);
        expect(actual).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('delay is always >= initialDelay for any retry count', () => {
    const manager = new ConnectionManager();

    fc.assert(
      fc.property(retryCountArb, (n) => {
        const delay = manager.getReconnectDelay(n);
        expect(delay).toBeGreaterThanOrEqual(1000);
      }),
      { numRuns: 100 },
    );
  });

  it('delay is always <= maxDelay for any retry count', () => {
    const manager = new ConnectionManager();

    fc.assert(
      fc.property(retryCountArb, (n) => {
        const delay = manager.getReconnectDelay(n);
        expect(delay).toBeLessThanOrEqual(60000);
      }),
      { numRuns: 100 },
    );
  });

  it('delay is monotonically non-decreasing as retry count increases', () => {
    const manager = new ConnectionManager();

    fc.assert(
      fc.property(retryCountArb, (n) => {
        if (n === 0) return; // skip n=0, nothing to compare
        const prev = manager.getReconnectDelay(n - 1);
        const curr = manager.getReconnectDelay(n);
        expect(curr).toBeGreaterThanOrEqual(prev);
      }),
      { numRuns: 100 },
    );
  });

  it('respects custom reconnect config', () => {
    const customInitial = 500;
    const customMax = 10000;
    const manager = new ConnectionManager({ initialDelay: customInitial, maxDelay: customMax });

    fc.assert(
      fc.property(retryCountArb, (n) => {
        const actual = manager.getReconnectDelay(n);
        const expected = Math.min(customInitial * Math.pow(2, n), customMax);
        expect(actual).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: 连接状态转换与通知
// ---------------------------------------------------------------------------

describe('连接状态转换与通知 (Property 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Feature: im-channel-integration, Property 3: 连接状态转换与通知**
   * **Validates: Requirements 1.4, 9.1, 9.2**
   *
   * For any stream platform connection state change (e.g. disconnected →
   * connecting → connected), ConnectionManager should correctly update the
   * platform's status, and all registered status listeners should receive
   * a notification event containing the new status.
   */
  it('listeners receive correct status notifications on successful connect', async () => {
    await fc.assert(
      fc.asyncProperty(streamPlatformArb, listenerCountArb, async (platform, listenerCount) => {
        const manager = new ConnectionManager();
        const adapter = createMockStreamAdapter(platform);
        mockedGetStreamAdapter.mockResolvedValue(adapter);

        const receivedStatuses: ChannelStatus[][] = [];

        // Register N listeners
        const unsubscribes: (() => void)[] = [];
        for (let i = 0; i < listenerCount; i++) {
          const statuses: ChannelStatus[] = [];
          receivedStatuses.push(statuses);
          unsubscribes.push(manager.onStatusChange((s) => statuses.push(s)));
        }

        const config = makeConfig(platform);
        await manager.connect(platform, config);

        // Each listener should have received: connecting, connected
        for (let i = 0; i < listenerCount; i++) {
          const statuses = receivedStatuses[i];
          expect(statuses.length).toBeGreaterThanOrEqual(2);

          // Find the connecting and connected transitions
          const statusValues = statuses.map((s) => s.connectionStatus);
          expect(statusValues).toContain('connecting');
          expect(statusValues).toContain('connected');

          // All notifications should reference the correct platform
          for (const s of statuses) {
            expect(s.platform).toBe(platform);
            expect(s.receiveMode).toBe('stream');
          }
        }

        // Platform status should be 'connected'
        const finalStatus = manager.getPlatformStatus(platform);
        expect(finalStatus).toBeDefined();
        expect(finalStatus!.connectionStatus).toBe('connected');

        // Cleanup
        unsubscribes.forEach((u) => u());
        await manager.disconnectAll();
      }),
      { numRuns: 100 },
    );
  });

  it('listeners receive disconnect notification when disconnect is called', async () => {
    await fc.assert(
      fc.asyncProperty(streamPlatformArb, async (platform) => {
        const manager = new ConnectionManager();
        const adapter = createMockStreamAdapter(platform);
        mockedGetStreamAdapter.mockResolvedValue(adapter);

        const statuses: ChannelStatus[] = [];
        const unsub = manager.onStatusChange((s) => statuses.push(s));

        const config = makeConfig(platform);
        await manager.connect(platform, config);
        await manager.disconnect(platform);

        const statusValues = statuses.map((s) => s.connectionStatus);
        // Should see: connecting → connected → disconnected
        expect(statusValues).toContain('connecting');
        expect(statusValues).toContain('connected');
        expect(statusValues).toContain('disconnected');

        // All notifications for the correct platform
        for (const s of statuses) {
          expect(s.platform).toBe(platform);
        }

        // After disconnect, getPlatformStatus returns undefined (connection removed)
        expect(manager.getPlatformStatus(platform)).toBeUndefined();

        unsub();
      }),
      { numRuns: 100 },
    );
  });

  it('unsubscribed listeners do not receive further notifications', async () => {
    await fc.assert(
      fc.asyncProperty(streamPlatformArb, async (platform) => {
        const manager = new ConnectionManager();
        const adapter = createMockStreamAdapter(platform);
        mockedGetStreamAdapter.mockResolvedValue(adapter);

        const statuses: ChannelStatus[] = [];
        const unsub = manager.onStatusChange((s) => statuses.push(s));

        // Unsubscribe immediately
        unsub();

        const config = makeConfig(platform);
        await manager.connect(platform, config);

        // Should not have received any notifications after unsubscribe
        expect(statuses.length).toBe(0);

        await manager.disconnectAll();
      }),
      { numRuns: 100 },
    );
  });

  it('getStatus reflects correct state for all stream platforms', async () => {
    await fc.assert(
      fc.asyncProperty(streamPlatformArb, async (platform) => {
        const manager = new ConnectionManager();
        const adapter = createMockStreamAdapter(platform);
        mockedGetStreamAdapter.mockResolvedValue(adapter);

        // Before connect: getStatus should show all platforms as disconnected/unconfigured
        const beforeStatuses = manager.getStatus();
        for (const s of beforeStatuses) {
          expect(s.connectionStatus).toBe('disconnected');
          expect(s.configured).toBe(false);
        }

        // Connect one platform
        const config = makeConfig(platform);
        await manager.connect(platform, config);

        const afterStatuses = manager.getStatus();
        const connectedPlatform = afterStatuses.find((s) => s.platform === platform);
        expect(connectedPlatform).toBeDefined();
        expect(connectedPlatform!.connectionStatus).toBe('connected');
        expect(connectedPlatform!.configured).toBe(true);

        await manager.disconnectAll();
      }),
      { numRuns: 100 },
    );
  });
});

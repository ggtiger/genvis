/**
 * ConnectionManager 单元测试
 *
 * - 测试连续重连失败 5 次标记 error 状态 (Requirement 1.5)
 * - 测试优雅关闭连接 (Requirement 1.6)
 * - 测试凭证更新后重连 (Requirement 6.5)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../connection-manager';
import type { StreamAdapter } from '../adapter';
import type { IMPlatform, IMChannelConfig, ChannelStatus } from '../types';
import { STREAM_PLATFORMS } from '../types';

// ---------------------------------------------------------------------------
// Mock adapter-factory
// ---------------------------------------------------------------------------

vi.mock('../adapter-factory', () => ({
  getStreamAdapter: vi.fn(),
  isStreamPlatform: (p: IMPlatform) => STREAM_PLATFORMS.includes(p),
}));

import { getStreamAdapter } from '../adapter-factory';
const mockedGetStreamAdapter = vi.mocked(getStreamAdapter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAdapter(
  platform: IMPlatform,
  opts?: { connectFails?: boolean },
): StreamAdapter {
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

function makeConfig(overrides?: Partial<IMChannelConfig>): IMChannelConfig {
  return {
    enabled: true,
    receiveMode: 'stream',
    appId: 'app-test',
    appSecret: 'secret-test',
    token: 'token-test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 测试：连续重连失败 5 次标记 error 状态 (Requirement 1.5)
// ---------------------------------------------------------------------------

describe('连续重连失败 5 次标记 error 状态', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should transition to error status after 5 consecutive reconnect failures', async () => {
    const manager = new ConnectionManager({ initialDelay: 100, maxDelay: 6400 });
    const adapter = createMockAdapter('dingtalk', { connectFails: true });
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    const statuses: ChannelStatus[] = [];
    manager.onStatusChange((s) => statuses.push(s));

    // Initial connect attempt fails, triggers handleDisconnect
    await manager.connect('dingtalk', makeConfig());

    // The first connect() call fails → retryCount becomes 1, schedules reconnect
    // We need to advance timers to trigger each subsequent reconnect attempt
    // Retries 2..5 happen via setTimeout in handleDisconnect
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(70000); // advance past maxDelay
    }

    // After 5 consecutive failures (retryCount > maxRetries), status should be 'error'
    const statusValues = statuses.map((s) => s.connectionStatus);
    expect(statusValues[statusValues.length - 1]).toBe('error');

    // getPlatformStatus should also reflect error
    const platformStatus = manager.getPlatformStatus('dingtalk');
    expect(platformStatus).toBeDefined();
    expect(platformStatus!.connectionStatus).toBe('error');
  });

  it('should go through reconnecting states before reaching error', async () => {
    const manager = new ConnectionManager({ initialDelay: 100, maxDelay: 6400 });
    const adapter = createMockAdapter('dingtalk', { connectFails: true });
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    const statuses: ChannelStatus[] = [];
    manager.onStatusChange((s) => statuses.push(s));

    await manager.connect('dingtalk', makeConfig());

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(70000);
    }

    const statusValues = statuses.map((s) => s.connectionStatus);

    // Should contain 'connecting' (initial), 'reconnecting' states, and final 'error'
    expect(statusValues).toContain('connecting');
    expect(statusValues).toContain('reconnecting');
    expect(statusValues).toContain('error');
  });

  it('should record lastError on failure', async () => {
    const manager = new ConnectionManager({ initialDelay: 100, maxDelay: 6400 });
    const adapter = createMockAdapter('dingtalk', { connectFails: true });
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    await manager.connect('dingtalk', makeConfig());

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(70000);
    }

    const status = manager.getPlatformStatus('dingtalk');
    expect(status).toBeDefined();
    expect(status!.lastError).toBe('connection failed');
  });

  it('should reset retryCount on successful reconnect', async () => {
    let connectCallCount = 0;
    const manager = new ConnectionManager({ initialDelay: 100, maxDelay: 6400 });

    // Adapter fails first 2 times, then succeeds
    const adapter: StreamAdapter = {
      platform: 'dingtalk',
      receiveMode: 'stream' as const,
      async connect() {
        connectCallCount++;
        if (connectCallCount <= 2) throw new Error('temporary failure');
      },
      async disconnect() {},
      isConnected: () => connectCallCount > 2,
      async sendReply() {},
    };
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    const statuses: ChannelStatus[] = [];
    manager.onStatusChange((s) => statuses.push(s));

    // First connect fails (connectCallCount=1)
    await manager.connect('dingtalk', makeConfig());

    // Advance timer for first retry — fails again (connectCallCount=2)
    await vi.advanceTimersByTimeAsync(70000);

    // Advance timer for second retry — succeeds (connectCallCount=3)
    await vi.advanceTimersByTimeAsync(70000);

    const statusValues = statuses.map((s) => s.connectionStatus);
    expect(statusValues[statusValues.length - 1]).toBe('connected');

    // Platform status should be connected
    const platformStatus = manager.getPlatformStatus('dingtalk');
    expect(platformStatus!.connectionStatus).toBe('connected');
  });
});

// ---------------------------------------------------------------------------
// 测试：优雅关闭连接 (Requirement 1.6)
// ---------------------------------------------------------------------------

describe('优雅关闭连接', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should transition to disconnected status on disconnect', async () => {
    const manager = new ConnectionManager();
    const adapter = createMockAdapter('feishu');
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    const statuses: ChannelStatus[] = [];
    manager.onStatusChange((s) => statuses.push(s));

    await manager.connect('feishu', makeConfig());
    await manager.disconnect('feishu');

    const statusValues = statuses.map((s) => s.connectionStatus);
    expect(statusValues).toContain('connecting');
    expect(statusValues).toContain('connected');
    expect(statusValues).toContain('disconnected');
  });

  it('should remove connection from internal map after disconnect', async () => {
    const manager = new ConnectionManager();
    const adapter = createMockAdapter('feishu');
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    await manager.connect('feishu', makeConfig());
    expect(manager.getPlatformStatus('feishu')).toBeDefined();

    await manager.disconnect('feishu');
    expect(manager.getPlatformStatus('feishu')).toBeUndefined();
  });

  it('should call adapter.disconnect()', async () => {
    const manager = new ConnectionManager();
    const adapter = createMockAdapter('feishu');
    const disconnectSpy = vi.spyOn(adapter, 'disconnect');
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    await manager.connect('feishu', makeConfig());
    await manager.disconnect('feishu');

    expect(disconnectSpy).toHaveBeenCalledOnce();
  });

  it('should clear pending reconnect timer on disconnect', async () => {
    const manager = new ConnectionManager({ initialDelay: 100, maxDelay: 6400 });
    const adapter = createMockAdapter('dingtalk', { connectFails: true });
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    // Connect fails, schedules a reconnect timer
    await manager.connect('dingtalk', makeConfig());

    // Disconnect should clear the timer
    await manager.disconnect('dingtalk');

    // Advance timers — no reconnect should happen
    const connectSpy = vi.spyOn(adapter, 'connect');
    await vi.advanceTimersByTimeAsync(70000);

    // connect should not have been called again after disconnect
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('should be safe to disconnect a platform that is not connected', async () => {
    const manager = new ConnectionManager();
    // Should not throw
    await expect(manager.disconnect('qq')).resolves.toBeUndefined();
  });

  it('disconnectAll should close all active connections', async () => {
    const manager = new ConnectionManager();
    const dingtalkAdapter = createMockAdapter('dingtalk');
    const feishuAdapter = createMockAdapter('feishu');

    mockedGetStreamAdapter
      .mockResolvedValueOnce(dingtalkAdapter)
      .mockResolvedValueOnce(feishuAdapter);

    await manager.connect('dingtalk', makeConfig());
    await manager.connect('feishu', makeConfig());

    expect(manager.getPlatformStatus('dingtalk')).toBeDefined();
    expect(manager.getPlatformStatus('feishu')).toBeDefined();

    await manager.disconnectAll();

    expect(manager.getPlatformStatus('dingtalk')).toBeUndefined();
    expect(manager.getPlatformStatus('feishu')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 测试：凭证更新后重连 (Requirement 6.5)
// ---------------------------------------------------------------------------

describe('凭证更新后重连', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should disconnect old connection and connect with new config', async () => {
    const manager = new ConnectionManager();

    let lastConfigUsed: IMChannelConfig | null = null;
    const adapter: StreamAdapter = {
      platform: 'dingtalk',
      receiveMode: 'stream' as const,
      async connect(config) {
        lastConfigUsed = config;
      },
      async disconnect() {},
      isConnected: () => true,
      async sendReply() {},
    };
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    const configA = makeConfig({ appId: 'old-app-id', appSecret: 'old-secret' });
    const configB = makeConfig({ appId: 'new-app-id', appSecret: 'new-secret' });

    await manager.connect('dingtalk', configA);
    expect(lastConfigUsed!.appId).toBe('old-app-id');

    await manager.reconnect('dingtalk', configB);
    expect(lastConfigUsed!.appId).toBe('new-app-id');
  });

  it('should end up in connected status after successful reconnect', async () => {
    const manager = new ConnectionManager();
    const adapter = createMockAdapter('feishu');
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    const statuses: ChannelStatus[] = [];
    manager.onStatusChange((s) => statuses.push(s));

    await manager.connect('feishu', makeConfig({ appId: 'old' }));
    await manager.reconnect('feishu', makeConfig({ appId: 'new' }));

    const statusValues = statuses.map((s) => s.connectionStatus);
    // Should see: connecting, connected (first), disconnected, connecting, connected (second)
    expect(statusValues[statusValues.length - 1]).toBe('connected');
  });

  it('should call disconnect on old adapter before reconnecting', async () => {
    const manager = new ConnectionManager();
    const adapter = createMockAdapter('qq');
    const disconnectSpy = vi.spyOn(adapter, 'disconnect');
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    await manager.connect('qq', makeConfig());
    await manager.reconnect('qq', makeConfig({ appId: 'updated' }));

    // disconnect is called once during reconnect (disconnect old connection)
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('should handle reconnect when no prior connection exists', async () => {
    const manager = new ConnectionManager();
    const adapter = createMockAdapter('dingtalk');
    mockedGetStreamAdapter.mockResolvedValue(adapter);

    // reconnect on a platform that was never connected — should just connect
    await manager.reconnect('dingtalk', makeConfig());

    const status = manager.getPlatformStatus('dingtalk');
    expect(status).toBeDefined();
    expect(status!.connectionStatus).toBe('connected');
  });
});

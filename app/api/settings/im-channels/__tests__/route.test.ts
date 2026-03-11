import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '../route';

// Mock dependencies
vi.mock('@/lib/services/settings', () => ({
  loadGlobalSettings: vi.fn(),
  saveChannelConfig: vi.fn(),
}));

vi.mock('@/lib/services/im/connection-manager', () => ({
  connectionManager: {
    reconnect: vi.fn(),
  },
}));

vi.mock('@/lib/services/im/adapter-factory', () => ({
  isStreamPlatform: vi.fn((p: string) => ['dingtalk', 'feishu', 'qq'].includes(p)),
}));

import { loadGlobalSettings, saveChannelConfig } from '@/lib/services/settings';
import { connectionManager } from '@/lib/services/im/connection-manager';

const mockLoadGlobalSettings = loadGlobalSettings as ReturnType<typeof vi.fn>;
const mockSaveChannelConfig = saveChannelConfig as ReturnType<typeof vi.fn>;
const mockReconnect = connectionManager.reconnect as ReturnType<typeof vi.fn>;

function makeRequest(method: string, body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost/api/settings/im-channels'), {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/settings/im-channels', () => {
  it('returns empty object when no channels configured', async () => {
    mockLoadGlobalSettings.mockResolvedValue({ im_channels: undefined });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({});
  });

  it('returns channels with masked appSecret', async () => {
    mockLoadGlobalSettings.mockResolvedValue({
      im_channels: {
        dingtalk: {
          enabled: true,
          receiveMode: 'stream',
          appId: 'dingXXX',
          appSecret: 'my-super-secret-key',
          token: 'tok',
        },
      },
    });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.dingtalk.appSecret).toBe('***************-key');
    expect(data.dingtalk.appId).toBe('dingXXX');
    expect(data.dingtalk.enabled).toBe(true);
  });

  it('masks short appSecret correctly', async () => {
    mockLoadGlobalSettings.mockResolvedValue({
      im_channels: {
        wechat: {
          enabled: false,
          receiveMode: 'webhook',
          appId: 'wx123',
          appSecret: 'ab',
          token: '',
        },
      },
    });

    const res = await GET();
    const data = await res.json();

    // Secret <= 4 chars returned as-is
    expect(data.wechat.appSecret).toBe('ab');
  });

  it('returns 500 on internal error', async () => {
    mockLoadGlobalSettings.mockRejectedValue(new Error('disk error'));

    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/settings/im-channels', () => {
  it('saves config for a valid platform', async () => {
    mockSaveChannelConfig.mockResolvedValue(undefined);
    mockReconnect.mockResolvedValue(undefined);

    const config = {
      enabled: true,
      receiveMode: 'stream',
      appId: 'dingXXX',
      appSecret: 'secret123',
      token: 'tok',
    };

    const res = await PUT(makeRequest('PUT', { platform: 'dingtalk', config }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, platform: 'dingtalk' });
    expect(mockSaveChannelConfig).toHaveBeenCalledWith('dingtalk', config);
  });

  it('triggers reconnect for enabled stream platform', async () => {
    mockSaveChannelConfig.mockResolvedValue(undefined);
    mockReconnect.mockResolvedValue(undefined);

    const config = {
      enabled: true,
      receiveMode: 'stream',
      appId: 'cli_xxx',
      appSecret: 'secret',
      token: '',
    };

    await PUT(makeRequest('PUT', { platform: 'feishu', config }));

    expect(mockReconnect).toHaveBeenCalledWith('feishu', config);
  });

  it('does not trigger reconnect for disabled stream platform', async () => {
    mockSaveChannelConfig.mockResolvedValue(undefined);

    const config = {
      enabled: false,
      receiveMode: 'stream',
      appId: 'cli_xxx',
      appSecret: 'secret',
      token: '',
    };

    await PUT(makeRequest('PUT', { platform: 'dingtalk', config }));

    expect(mockReconnect).not.toHaveBeenCalled();
  });

  it('does not trigger reconnect for webhook platform', async () => {
    mockSaveChannelConfig.mockResolvedValue(undefined);

    const config = {
      enabled: true,
      receiveMode: 'webhook',
      appId: 'wx123',
      appSecret: 'secret',
      token: 'tok',
    };

    await PUT(makeRequest('PUT', { platform: 'wechat', config }));

    expect(mockReconnect).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid platform', async () => {
    const res = await PUT(makeRequest('PUT', { platform: 'telegram', config: {} }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing config', async () => {
    const res = await PUT(makeRequest('PUT', { platform: 'dingtalk' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on save error', async () => {
    mockSaveChannelConfig.mockRejectedValue(new Error('write failed'));

    const config = {
      enabled: true,
      receiveMode: 'stream',
      appId: 'x',
      appSecret: 'y',
      token: '',
    };

    const res = await PUT(makeRequest('PUT', { platform: 'dingtalk', config }));
    expect(res.status).toBe(500);
  });
});

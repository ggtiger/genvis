import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

vi.mock('@/lib/services/im/connection-manager', () => ({
  connectionManager: {
    getStatus: vi.fn(),
    reconnect: vi.fn(),
  },
}));

vi.mock('@/lib/services/settings', () => ({
  loadChannelConfig: vi.fn(),
}));

import { connectionManager } from '@/lib/services/im/connection-manager';
import { loadChannelConfig } from '@/lib/services/settings';

const mockGetStatus = connectionManager.getStatus as ReturnType<typeof vi.fn>;
const mockReconnect = connectionManager.reconnect as ReturnType<typeof vi.fn>;
const mockLoadChannelConfig = loadChannelConfig as ReturnType<typeof vi.fn>;

function makeGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/im/status');
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost/api/im/status'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/im/status', () => {
  it('returns all channel statuses', async () => {
    const statuses = [
      {
        platform: 'dingtalk',
        receiveMode: 'stream',
        connectionStatus: 'connected',
        configured: true,
        lastConnectedAt: '2025-01-15T10:00:00.000Z',
      },
      {
        platform: 'feishu',
        receiveMode: 'stream',
        connectionStatus: 'disconnected',
        configured: false,
      },
      {
        platform: 'qq',
        receiveMode: 'stream',
        connectionStatus: 'disconnected',
        configured: false,
      },
    ];
    mockGetStatus.mockReturnValue(statuses);

    const res = await GET(makeGetRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual(statuses);
    expect(mockGetStatus).toHaveBeenCalledOnce();
  });

  it('returns empty array when no connections exist', async () => {
    mockGetStatus.mockReturnValue([]);

    const res = await GET(makeGetRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual([]);
  });

  it('returns 500 on internal error', async () => {
    mockGetStatus.mockImplementation(() => {
      throw new Error('unexpected');
    });

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);
  });
});

describe('POST /api/im/status', () => {
  it('triggers reconnect for a configured stream platform', async () => {
    const config = {
      enabled: true,
      receiveMode: 'stream',
      appId: 'dingXXX',
      appSecret: 'secret',
      token: '',
    };
    mockLoadChannelConfig.mockResolvedValue(config);
    mockReconnect.mockResolvedValue(undefined);

    const res = await POST(makePostRequest({ platform: 'dingtalk' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, platform: 'dingtalk' });
    expect(mockLoadChannelConfig).toHaveBeenCalledWith('dingtalk');
    expect(mockReconnect).toHaveBeenCalledWith('dingtalk', config);
  });

  it('returns 400 for non-stream platform', async () => {
    const res = await POST(makePostRequest({ platform: 'wechat' }));
    expect(res.status).toBe(400);
    expect(mockReconnect).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid platform string', async () => {
    const res = await POST(makePostRequest({ platform: 'telegram' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when platform is missing', async () => {
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when platform is not configured', async () => {
    mockLoadChannelConfig.mockResolvedValue(undefined);

    const res = await POST(makePostRequest({ platform: 'feishu' }));
    expect(res.status).toBe(404);
    expect(mockReconnect).not.toHaveBeenCalled();
  });

  it('returns 500 on reconnect error', async () => {
    mockLoadChannelConfig.mockResolvedValue({
      enabled: true,
      receiveMode: 'stream',
      appId: 'x',
      appSecret: 'y',
      token: '',
    });
    mockReconnect.mockRejectedValue(new Error('connection failed'));

    const res = await POST(makePostRequest({ platform: 'qq' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.message).toBe('connection failed');
  });
});

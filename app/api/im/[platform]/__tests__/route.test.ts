import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock 依赖模块
vi.mock('@/lib/services/im/adapter-factory', () => ({
  isStreamPlatform: vi.fn(),
  getWebhookAdapter: vi.fn(),
}));

vi.mock('@/lib/services/settings', () => ({
  loadChannelConfig: vi.fn(),
}));

vi.mock('@/lib/services/im/im-channel', () => ({
  processIMMessage: vi.fn(),
}));

import { POST, GET } from '../route';
import { isStreamPlatform, getWebhookAdapter } from '@/lib/services/im/adapter-factory';
import { loadChannelConfig } from '@/lib/services/settings';
import { processIMMessage } from '@/lib/services/im/im-channel';

const mockIsStreamPlatform = isStreamPlatform as ReturnType<typeof vi.fn>;
const mockGetWebhookAdapter = getWebhookAdapter as ReturnType<typeof vi.fn>;
const mockLoadChannelConfig = loadChannelConfig as ReturnType<typeof vi.fn>;
const mockProcessIMMessage = processIMMessage as ReturnType<typeof vi.fn>;

/** 构造路由参数 */
function makeParams(platform: string) {
  return { params: Promise.resolve({ platform }) };
}

/** 构造 POST 请求 */
function makePostRequest(platform: string, body = '<xml></xml>'): NextRequest {
  return new NextRequest(
    new URL(`http://localhost/api/im/${platform}?signature=abc&timestamp=123&nonce=xyz`),
    { method: 'POST', body, headers: { 'Content-Type': 'text/xml' } },
  );
}

/** 构造 GET 请求（带 echostr） */
function makeGetRequest(platform: string, query = ''): NextRequest {
  return new NextRequest(
    new URL(`http://localhost/api/im/${platform}${query ? '?' + query : ''}`),
    { method: 'GET' },
  );
}

/** 默认渠道配置 */
const enabledConfig = {
  enabled: true,
  receiveMode: 'webhook' as const,
  appId: 'wx123',
  appSecret: 'secret',
  token: 'my_token',
  encodingAESKey: 'aeskey',
};

/** 模拟 Webhook 适配器 */
function createMockAdapter() {
  return {
    platform: 'wechat' as const,
    receiveMode: 'webhook' as const,
    verifySignature: vi.fn(),
    handleChallenge: vi.fn(),
    parseMessage: vi.fn(),
    sendReply: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/im/[platform]', () => {
  it('返回 400：无效的平台标识', async () => {
    const req = makePostRequest('telegram');
    const res = await POST(req, makeParams('telegram'));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('telegram');
  });

  it('返回 400：Stream 平台请求被拒绝', async () => {
    mockIsStreamPlatform.mockReturnValue(true);

    const req = makePostRequest('dingtalk');
    const res = await POST(req, makeParams('dingtalk'));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Stream');
  });

  it('返回 503：渠道未配置', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(undefined);

    const req = makePostRequest('wechat');
    const res = await POST(req, makeParams('wechat'));
    expect(res.status).toBe(503);
  });

  it('返回 503：渠道已配置但未启用', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue({ ...enabledConfig, enabled: false });

    const req = makePostRequest('wechat');
    const res = await POST(req, makeParams('wechat'));
    expect(res.status).toBe(503);
  });

  it('处理 challenge 验证请求', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(enabledConfig);

    const adapter = createMockAdapter();
    adapter.handleChallenge.mockResolvedValue({
      isChallenge: true,
      response: new Response('echostr_value', { status: 200 }),
    });
    mockGetWebhookAdapter.mockResolvedValue(adapter);

    const req = makePostRequest('wechat');
    const res = await POST(req, makeParams('wechat'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('echostr_value');
    // challenge 请求不应继续验证签名或解析消息
    expect(adapter.verifySignature).not.toHaveBeenCalled();
    expect(adapter.parseMessage).not.toHaveBeenCalled();
  });

  it('返回 401：签名验证失败', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(enabledConfig);

    const adapter = createMockAdapter();
    adapter.handleChallenge.mockResolvedValue({ isChallenge: false });
    adapter.verifySignature.mockResolvedValue({ valid: false, error: '签名不匹配' });
    mockGetWebhookAdapter.mockResolvedValue(adapter);

    const req = makePostRequest('wechat');
    const res = await POST(req, makeParams('wechat'));
    expect(res.status).toBe(401);
    expect(adapter.parseMessage).not.toHaveBeenCalled();
  });

  it('返回 200：消息解析为 null（事件消息等）', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(enabledConfig);

    const adapter = createMockAdapter();
    adapter.handleChallenge.mockResolvedValue({ isChallenge: false });
    adapter.verifySignature.mockResolvedValue({ valid: true });
    adapter.parseMessage.mockResolvedValue(null);
    mockGetWebhookAdapter.mockResolvedValue(adapter);

    const req = makePostRequest('wechat');
    const res = await POST(req, makeParams('wechat'));
    expect(res.status).toBe(200);
    expect(mockProcessIMMessage).not.toHaveBeenCalled();
  });

  it('完整流程：签名验证 → 解析消息 → 处理消息', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(enabledConfig);

    const mockMessage = {
      platform: 'wechat',
      receiveMode: 'webhook',
      senderId: 'user123',
      content: '你好',
      messageType: 'text',
      originalMessageId: 'msg001',
      conversationId: 'user123',
      timestamp: Date.now(),
      rawPayload: {},
    };

    const adapter = createMockAdapter();
    adapter.handleChallenge.mockResolvedValue({ isChallenge: false });
    adapter.verifySignature.mockResolvedValue({ valid: true });
    adapter.parseMessage.mockResolvedValue(mockMessage);
    mockGetWebhookAdapter.mockResolvedValue(adapter);
    mockProcessIMMessage.mockResolvedValue(undefined);

    const req = makePostRequest('wechat');
    const res = await POST(req, makeParams('wechat'));
    expect(res.status).toBe(200);
    expect(mockProcessIMMessage).toHaveBeenCalledWith(mockMessage, adapter, enabledConfig);
  });

  it('返回 500：适配器抛出异常', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(enabledConfig);
    mockGetWebhookAdapter.mockRejectedValue(new Error('适配器加载失败'));

    const req = makePostRequest('wecom');
    const res = await POST(req, makeParams('wecom'));
    expect(res.status).toBe(500);
  });

  it('企业微信平台也能正常处理', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(enabledConfig);

    const adapter = createMockAdapter();
    adapter.platform = 'wecom' as any;
    adapter.handleChallenge.mockResolvedValue({ isChallenge: false });
    adapter.verifySignature.mockResolvedValue({ valid: true });
    adapter.parseMessage.mockResolvedValue(null);
    mockGetWebhookAdapter.mockResolvedValue(adapter);

    const req = makePostRequest('wecom');
    const res = await POST(req, makeParams('wecom'));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/im/[platform]', () => {
  it('返回 400：无效的平台标识', async () => {
    const req = makeGetRequest('slack');
    const res = await GET(req, makeParams('slack'));
    expect(res.status).toBe(400);
  });

  it('返回 400：Stream 平台请求被拒绝', async () => {
    mockIsStreamPlatform.mockReturnValue(true);

    const req = makeGetRequest('feishu');
    const res = await GET(req, makeParams('feishu'));
    expect(res.status).toBe(400);
  });

  it('返回 503：渠道未配置', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(undefined);

    const req = makeGetRequest('wechat');
    const res = await GET(req, makeParams('wechat'));
    expect(res.status).toBe(503);
  });

  it('处理微信 echostr 验证', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(enabledConfig);

    const adapter = createMockAdapter();
    adapter.handleChallenge.mockResolvedValue({
      isChallenge: true,
      response: new Response('echo_test_123', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    });
    mockGetWebhookAdapter.mockResolvedValue(adapter);

    const req = makeGetRequest('wechat', 'signature=abc&timestamp=123&nonce=xyz&echostr=echo_test_123');
    const res = await GET(req, makeParams('wechat'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('echo_test_123');
  });

  it('处理企业微信 echostr 验证', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(enabledConfig);

    const adapter = createMockAdapter();
    adapter.platform = 'wecom' as any;
    adapter.handleChallenge.mockResolvedValue({
      isChallenge: true,
      response: new Response('decrypted_echostr', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    });
    mockGetWebhookAdapter.mockResolvedValue(adapter);

    const req = makeGetRequest('wecom', 'msg_signature=abc&timestamp=123&nonce=xyz&echostr=encrypted');
    const res = await GET(req, makeParams('wecom'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('decrypted_echostr');
  });

  it('非 challenge 的 GET 请求返回 200', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(enabledConfig);

    const adapter = createMockAdapter();
    adapter.handleChallenge.mockResolvedValue({ isChallenge: false });
    mockGetWebhookAdapter.mockResolvedValue(adapter);

    const req = makeGetRequest('wechat');
    const res = await GET(req, makeParams('wechat'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('OK');
  });

  it('返回 500：处理异常', async () => {
    mockIsStreamPlatform.mockReturnValue(false);
    mockLoadChannelConfig.mockResolvedValue(enabledConfig);
    mockGetWebhookAdapter.mockRejectedValue(new Error('加载失败'));

    const req = makeGetRequest('wechat', 'echostr=test');
    const res = await GET(req, makeParams('wechat'));
    expect(res.status).toBe(500);
  });
});

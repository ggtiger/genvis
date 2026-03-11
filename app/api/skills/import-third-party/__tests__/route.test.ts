import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Unit tests for POST /api/skills/import-third-party
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */

vi.mock('@/lib/services/third-party-converter', () => ({
  convertThirdPartySkill: vi.fn(),
}));

import { convertThirdPartySkill } from '@/lib/services/third-party-converter';
import { POST } from '../route';

const mockConvert = vi.mocked(convertThirdPartySkill);

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/skills/import-third-party', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/skills/import-third-party', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 when url is missing', async () => {
    const response = await POST(createRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ success: false, error: 'url 参数为必填项' });
    expect(mockConvert).not.toHaveBeenCalled();
  });

  it('should return 400 when url is empty string', async () => {
    const response = await POST(createRequest({ url: '  ' }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ success: false, error: 'url 参数为必填项' });
  });

  it('should return 400 when url is not a string', async () => {
    const response = await POST(createRequest({ url: 123 }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ success: false, error: 'url 参数为必填项' });
  });

  it('should return skill data on successful conversion', async () => {
    const skillMeta = { name: 'test-skill', displayName: 'Test Skill' };
    mockConvert.mockResolvedValue({ success: true, skill: skillMeta as any });

    const response = await POST(createRequest({ url: 'https://clawhub.ai/user/test-skill' }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, data: skillMeta });
    expect(mockConvert).toHaveBeenCalledWith('https://clawhub.ai/user/test-skill', {
      translate: undefined,
      overwrite: undefined,
    });
  });

  it('should pass translate and overwrite options', async () => {
    mockConvert.mockResolvedValue({ success: true, skill: { name: 's' } as any });

    await POST(createRequest({ url: 'https://clawhub.ai/u/s', translate: false, overwrite: true }));

    expect(mockConvert).toHaveBeenCalledWith('https://clawhub.ai/u/s', {
      translate: false,
      overwrite: true,
    });
  });

  it('should return 502 when fetch step fails', async () => {
    mockConvert.mockResolvedValue({
      success: false,
      error: '抓取失败: Network error',
      failedStep: 'fetch',
    });

    const response = await POST(createRequest({ url: 'https://clawhub.ai/u/s' }));
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({ success: false, error: '抓取失败: Network error', step: 'fetch' });
  });

  it('should return 422 when parse step fails', async () => {
    mockConvert.mockResolvedValue({
      success: false,
      error: '解析失败: 缺少必要字段: name',
      failedStep: 'parse',
    });

    const response = await POST(createRequest({ url: 'https://clawhub.ai/u/s' }));
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data).toEqual({
      success: false,
      error: '解析失败: 缺少必要字段: name',
      step: 'parse',
    });
  });

  it('should return 409 when skill already exists', async () => {
    mockConvert.mockResolvedValue({
      success: false,
      error: '同名 skill "test" 已存在，请使用 overwrite 选项覆盖',
      failedStep: 'register',
    });

    const response = await POST(createRequest({ url: 'https://clawhub.ai/u/s' }));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.success).toBe(false);
    expect(data.step).toBe('register');
  });

  it('should return 500 when transform step fails', async () => {
    mockConvert.mockResolvedValue({
      success: false,
      error: '转换失败: disk full',
      failedStep: 'transform',
    });

    const response = await POST(createRequest({ url: 'https://clawhub.ai/u/s' }));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ success: false, error: '转换失败: disk full', step: 'transform' });
  });

  it('should return 500 when convertThirdPartySkill throws', async () => {
    mockConvert.mockRejectedValue(new Error('Unexpected crash'));

    const response = await POST(createRequest({ url: 'https://clawhub.ai/u/s' }));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ success: false, error: 'Unexpected crash' });
  });

  it('should trim whitespace from url', async () => {
    mockConvert.mockResolvedValue({ success: true, skill: { name: 's' } as any });

    await POST(createRequest({ url: '  https://clawhub.ai/u/s  ' }));

    expect(mockConvert).toHaveBeenCalledWith('https://clawhub.ai/u/s', expect.any(Object));
  });
});

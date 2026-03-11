import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getAccessToken,
  clearTokenCache,
  isTokenExpiredError,
  handleTokenExpiredError,
  _getTokenCacheEntry,
  _setTokenCacheEntry,
  _hasRefreshLock,
  TOKEN_EXPIRED_CODES,
} from '../token-manager';
import type { IMChannelConfig } from '../types';

/** 测试用配置 */
const mockWechatConfig: IMChannelConfig = {
  enabled: true,
  receiveMode: 'webhook',
  appId: 'wx_test_app_id',
  appSecret: 'wx_test_app_secret',
  token: 'wx_test_token',
};

const mockWecomConfig: IMChannelConfig = {
  enabled: true,
  receiveMode: 'webhook',
  appId: 'wk_test_corp_id',
  appSecret: 'wk_test_corp_secret',
  token: 'wk_test_token',
};

const mockFeishuConfig: IMChannelConfig = {
  enabled: true,
  receiveMode: 'stream',
  appId: 'cli_test_app_id',
  appSecret: 'fs_test_app_secret',
  token: 'fs_test_token',
};

describe('Token 管理器', () => {
  beforeEach(() => {
    clearTokenCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAccessToken - 缓存命中', () => {
    it('缓存有效时直接返回缓存的 token', async () => {
      // 设置一个 1 小时后过期的缓存（远超 5 分钟缓冲）
      _setTokenCacheEntry('wechat', {
        token: 'cached_token_123',
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const token = await getAccessToken('wechat', mockWechatConfig);

      expect(token).toBe('cached_token_123');
      // 不应发起网络请求
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('缓存即将过期（5 分钟内）时触发刷新', async () => {
      // 设置一个 4 分钟后过期的缓存（在 5 分钟缓冲内）
      _setTokenCacheEntry('wechat', {
        token: 'old_token',
        expiresAt: Date.now() + 4 * 60 * 1000,
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          access_token: 'new_token_456',
          expires_in: 7200,
        }), { status: 200 })
      );

      const token = await getAccessToken('wechat', mockWechatConfig);
      expect(token).toBe('new_token_456');
    });
  });

  describe('getAccessToken - 微信平台', () => {
    it('成功获取微信 access_token', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          access_token: 'wx_token_abc',
          expires_in: 7200,
        }), { status: 200 })
      );

      const token = await getAccessToken('wechat', mockWechatConfig);
      expect(token).toBe('wx_token_abc');

      // 验证缓存已更新
      const cached = _getTokenCacheEntry('wechat');
      expect(cached).toBeDefined();
      expect(cached!.token).toBe('wx_token_abc');
    });

    it('微信 API 返回错误时抛出异常', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          errcode: 40013,
          errmsg: 'invalid appid',
        }), { status: 200 })
      );

      await expect(getAccessToken('wechat', mockWechatConfig))
        .rejects.toThrow('获取 access_token 失败');
    });

    it('微信 API HTTP 错误时抛出异常', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 })
      );

      await expect(getAccessToken('wechat', mockWechatConfig))
        .rejects.toThrow('获取 access_token 失败');
    });
  });

  describe('getAccessToken - 企业微信平台', () => {
    it('成功获取企业微信 access_token', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          access_token: 'wk_token_xyz',
          expires_in: 7200,
        }), { status: 200 })
      );

      const token = await getAccessToken('wecom', mockWecomConfig);
      expect(token).toBe('wk_token_xyz');
    });
  });

  describe('getAccessToken - 飞书平台', () => {
    it('成功获取飞书 tenant_access_token', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          code: 0,
          tenant_access_token: 'fs_token_123',
          expire: 7200,
        }), { status: 200 })
      );

      const token = await getAccessToken('feishu', mockFeishuConfig);
      expect(token).toBe('fs_token_123');

      // 验证请求方式为 POST
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      // 已经调用过了，检查第一次调用
    });

    it('飞书 API 返回非零 code 时抛出异常', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          code: 99991668,
          msg: 'token expired',
        }), { status: 200 })
      );

      await expect(getAccessToken('feishu', mockFeishuConfig))
        .rejects.toThrow('获取 tenant_access_token 失败');
    });
  });

  describe('getAccessToken - 不支持的平台', () => {
    it('钉钉平台抛出不支持错误', async () => {
      await expect(getAccessToken('dingtalk', mockWechatConfig))
        .rejects.toThrow('不需要或不支持 access_token 管理');
    });

    it('QQ 平台抛出不支持错误', async () => {
      await expect(getAccessToken('qq', mockWechatConfig))
        .rejects.toThrow('不需要或不支持 access_token 管理');
    });
  });

  describe('getAccessToken - 并发刷新保护', () => {
    it('并发请求共享同一个刷新 Promise', async () => {
      let resolveCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        resolveCount++;
        // 模拟网络延迟
        await new Promise(r => setTimeout(r, 50));
        return new Response(JSON.stringify({
          access_token: 'shared_token',
          expires_in: 7200,
        }), { status: 200 });
      });

      // 同时发起 3 个请求
      const [t1, t2, t3] = await Promise.all([
        getAccessToken('wechat', mockWechatConfig),
        getAccessToken('wechat', mockWechatConfig),
        getAccessToken('wechat', mockWechatConfig),
      ]);

      // 所有请求应返回相同 token
      expect(t1).toBe('shared_token');
      expect(t2).toBe('shared_token');
      expect(t3).toBe('shared_token');

      // fetch 只应被调用一次
      expect(resolveCount).toBe(1);
    });

    it('刷新失败后锁被释放，后续请求可重试', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // 第一次失败
      fetchSpy.mockResolvedValueOnce(
        new Response('error', { status: 500 })
      );

      await expect(getAccessToken('wechat', mockWechatConfig)).rejects.toThrow();

      // 锁应已释放
      expect(_hasRefreshLock('wechat')).toBe(false);

      // 第二次成功
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          access_token: 'retry_token',
          expires_in: 7200,
        }), { status: 200 })
      );

      const token = await getAccessToken('wechat', mockWechatConfig);
      expect(token).toBe('retry_token');
    });
  });

  describe('clearTokenCache', () => {
    it('清除指定平台缓存', () => {
      _setTokenCacheEntry('wechat', { token: 'wx', expiresAt: Date.now() + 3600000 });
      _setTokenCacheEntry('wecom', { token: 'wk', expiresAt: Date.now() + 3600000 });

      clearTokenCache('wechat');

      expect(_getTokenCacheEntry('wechat')).toBeUndefined();
      expect(_getTokenCacheEntry('wecom')).toBeDefined();
    });

    it('不传参数时清除所有缓存', () => {
      _setTokenCacheEntry('wechat', { token: 'wx', expiresAt: Date.now() + 3600000 });
      _setTokenCacheEntry('wecom', { token: 'wk', expiresAt: Date.now() + 3600000 });
      _setTokenCacheEntry('feishu', { token: 'fs', expiresAt: Date.now() + 3600000 });

      clearTokenCache();

      expect(_getTokenCacheEntry('wechat')).toBeUndefined();
      expect(_getTokenCacheEntry('wecom')).toBeUndefined();
      expect(_getTokenCacheEntry('feishu')).toBeUndefined();
    });
  });

  describe('isTokenExpiredError', () => {
    it('微信 errcode 42001 识别为 token 过期', () => {
      expect(isTokenExpiredError('wechat', 42001)).toBe(true);
    });

    it('企业微信 errcode 42001 识别为 token 过期', () => {
      expect(isTokenExpiredError('wecom', 42001)).toBe(true);
    });

    it('飞书 code 99991668 识别为 token 过期', () => {
      expect(isTokenExpiredError('feishu', 99991668)).toBe(true);
    });

    it('非过期错误码返回 false', () => {
      expect(isTokenExpiredError('wechat', 40013)).toBe(false);
      expect(isTokenExpiredError('feishu', 10003)).toBe(false);
    });

    it('不支持的平台返回 false', () => {
      expect(isTokenExpiredError('dingtalk', 42001)).toBe(false);
    });
  });

  describe('handleTokenExpiredError', () => {
    it('清除缓存并重新获取 token', async () => {
      // 先设置一个旧缓存
      _setTokenCacheEntry('wechat', {
        token: 'expired_token',
        expiresAt: Date.now() + 3600000,
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          access_token: 'fresh_token',
          expires_in: 7200,
        }), { status: 200 })
      );

      const token = await handleTokenExpiredError('wechat', mockWechatConfig);
      expect(token).toBe('fresh_token');

      // 缓存应已更新为新 token
      const cached = _getTokenCacheEntry('wechat');
      expect(cached!.token).toBe('fresh_token');
    });
  });
});

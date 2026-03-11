/**
 * Token 管理器 — 集中管理各 IM 平台的 access_token
 *
 * 功能：
 * - 各平台 access_token 缓存（内存）
 * - 自动刷新：过期前 5 分钟提前刷新
 * - 并发刷新保护：同一平台同时只有一个刷新请求
 * - Token 过期错误处理：微信 errcode 42001、飞书 99991668
 *
 * 支持平台：
 * - 微信：GET https://api.weixin.qq.com/cgi-bin/token
 * - 企业微信：GET https://qyapi.weixin.qq.com/cgi-bin/gettoken
 * - 飞书：POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/
 */

import type { IMPlatform, IMChannelConfig } from './types';

/** Token 缓存条目 */
export interface TokenCacheEntry {
  token: string;
  expiresAt: number; // 毫秒时间戳
}

/** 提前刷新缓冲时间（5 分钟） */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Token 过期错误码 */
export const TOKEN_EXPIRED_CODES: Record<string, number[]> = {
  wechat: [42001],
  wecom: [42001],
  feishu: [99991668],
};

/** 各平台 token 缓存 */
const tokenCache = new Map<IMPlatform, TokenCacheEntry>();

/** 并发刷新锁：存储正在进行的刷新 Promise */
const refreshLocks = new Map<IMPlatform, Promise<string>>();

/**
 * 检查缓存的 token 是否仍然有效（含提前刷新缓冲）
 */
function isCacheValid(entry: TokenCacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() < entry.expiresAt - REFRESH_BUFFER_MS;
}

/**
 * 从微信平台获取 access_token
 */
async function fetchWechatToken(config: IMChannelConfig): Promise<TokenCacheEntry> {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(config.appId)}&secret=${encodeURIComponent(config.appSecret)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[WeChat] 获取 access_token 失败: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };

  if (data.errcode || !data.access_token) {
    throw new Error(`[WeChat] 获取 access_token 失败: ${data.errcode} ${data.errmsg}`);
  }

  return {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
  };
}

/**
 * 从企业微信平台获取 access_token
 */
async function fetchWecomToken(config: IMChannelConfig): Promise<TokenCacheEntry> {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(config.appId)}&corpsecret=${encodeURIComponent(config.appSecret)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[WeCom] 获取 access_token 失败: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };

  if (data.errcode || !data.access_token) {
    throw new Error(`[WeCom] 获取 access_token 失败: ${data.errcode} ${data.errmsg}`);
  }

  return {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
  };
}

/**
 * 从飞书平台获取 tenant_access_token
 */
async function fetchFeishuToken(config: IMChannelConfig): Promise<TokenCacheEntry> {
  const response = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: config.appId,
        app_secret: config.appSecret,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[Feishu] 获取 tenant_access_token 失败: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    tenant_access_token?: string;
    expire?: number;
    code?: number;
    msg?: string;
  };

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`[Feishu] 获取 tenant_access_token 失败: ${data.code} ${data.msg}`);
  }

  return {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire || 7200) * 1000,
  };
}

/** 各平台 token 获取函数映射 */
const tokenFetchers: Partial<Record<IMPlatform, (config: IMChannelConfig) => Promise<TokenCacheEntry>>> = {
  wechat: fetchWechatToken,
  wecom: fetchWecomToken,
  feishu: fetchFeishuToken,
};

/**
 * 获取指定平台的 access_token（核心导出函数）
 *
 * - 优先返回缓存中有效的 token
 * - 缓存失效时自动刷新
 * - 并发请求共享同一个刷新 Promise，避免重复请求
 */
export async function getAccessToken(platform: IMPlatform, config: IMChannelConfig): Promise<string> {
  const fetcher = tokenFetchers[platform];
  if (!fetcher) {
    throw new Error(`平台 ${platform} 不需要或不支持 access_token 管理`);
  }

  // 检查缓存
  const cached = tokenCache.get(platform);
  if (isCacheValid(cached)) {
    return cached!.token;
  }

  // 检查是否已有正在进行的刷新
  const existingLock = refreshLocks.get(platform);
  if (existingLock) {
    return existingLock;
  }

  // 创建刷新 Promise 并加锁
  const refreshPromise = (async () => {
    try {
      const entry = await fetcher(config);
      tokenCache.set(platform, entry);
      return entry.token;
    } finally {
      // 无论成功失败都释放锁
      refreshLocks.delete(platform);
    }
  })();

  refreshLocks.set(platform, refreshPromise);
  return refreshPromise;
}

/**
 * 清除 token 缓存
 *
 * @param platform - 指定平台则只清除该平台缓存，不指定则清除所有
 */
export function clearTokenCache(platform?: IMPlatform): void {
  if (platform) {
    tokenCache.delete(platform);
  } else {
    tokenCache.clear();
  }
}

/**
 * 判断错误码是否为 token 过期错误
 * 用于适配器在 API 调用失败时判断是否需要刷新 token 并重试
 */
export function isTokenExpiredError(platform: IMPlatform, errcode: number): boolean {
  const codes = TOKEN_EXPIRED_CODES[platform];
  return codes ? codes.includes(errcode) : false;
}

/**
 * 处理 token 过期错误：清除缓存并重新获取
 * 适配器在收到 token 过期错误时调用此函数
 */
export async function handleTokenExpiredError(
  platform: IMPlatform,
  config: IMChannelConfig
): Promise<string> {
  // 清除旧缓存
  clearTokenCache(platform);
  // 重新获取 token
  return getAccessToken(platform, config);
}

// ============ 以下为测试辅助函数 ============

/**
 * 获取当前缓存条目（仅用于测试）
 */
export function _getTokenCacheEntry(platform: IMPlatform): TokenCacheEntry | undefined {
  return tokenCache.get(platform);
}

/**
 * 手动设置缓存条目（仅用于测试）
 */
export function _setTokenCacheEntry(platform: IMPlatform, entry: TokenCacheEntry): void {
  tokenCache.set(platform, entry);
}

/**
 * 检查是否有正在进行的刷新（仅用于测试）
 */
export function _hasRefreshLock(platform: IMPlatform): boolean {
  return refreshLocks.has(platform);
}

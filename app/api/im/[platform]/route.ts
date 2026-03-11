/**
 * Webhook 动态路由
 *
 * 处理微信和企业微信平台的 Webhook 回调请求。
 * - POST：签名验证 → challenge 处理 → 消息解析 → 消息处理
 * - GET：处理微信/企业微信 echostr 接入验证
 *
 * Stream 平台（钉钉、飞书、QQ）不使用此路由，返回 400。
 * 未配置/未启用的渠道返回 503。
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 6.4
 */

import { NextRequest } from 'next/server';
import type { IMPlatform } from '@/lib/services/im/types';
import { isStreamPlatform, getWebhookAdapter } from '@/lib/services/im/adapter-factory';
import { loadChannelConfig } from '@/lib/services/settings';
import { processIMMessage } from '@/lib/services/im/im-channel';

/** 路由参数类型 */
interface RouteParams {
  params: Promise<{ platform: string }>;
}

/** 校验平台标识是否为有效的 IM 平台 */
function isValidPlatform(platform: string): platform is IMPlatform {
  const ALL_PLATFORMS: string[] = ['wechat', 'feishu', 'dingtalk', 'qq', 'wecom'];
  return ALL_PLATFORMS.includes(platform);
}

/**
 * POST handler：处理 Webhook 回调消息
 *
 * 流程：
 * 1. 校验平台标识有效性
 * 2. 检查是否为 Stream 平台（拒绝）
 * 3. 加载渠道配置（未配置返回 503）
 * 4. 获取 Webhook 适配器
 * 5. 处理 challenge 验证请求
 * 6. 验证请求签名
 * 7. 解析消息
 * 8. 处理消息
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { platform } = await params;

  // 1. 校验平台标识
  if (!isValidPlatform(platform)) {
    return new Response(`不支持的平台: ${platform}`, { status: 400 });
  }

  // 2. Stream 平台不接受 Webhook 请求
  if (isStreamPlatform(platform)) {
    return new Response('此平台使用 Stream 模式，不接受 Webhook', { status: 400 });
  }

  // 3. 加载渠道配置
  const config = await loadChannelConfig(platform);
  if (!config?.enabled) {
    console.warn(`[Webhook] 平台 ${platform} 未配置或未启用`);
    return new Response('渠道未配置或未启用', { status: 503 });
  }

  try {
    // 4. 获取 Webhook 适配器
    const adapter = await getWebhookAdapter(platform);

    // 5. 处理 challenge 验证（部分平台 POST 请求也可能是 challenge）
    const challenge = await adapter.handleChallenge(request, config);
    if (challenge.isChallenge) {
      return challenge.response!;
    }

    // 6. 验证请求签名
    const verify = await adapter.verifySignature(request, config);
    if (!verify.valid) {
      console.warn(`[Webhook] 平台 ${platform} 签名验证失败: ${verify.error}`);
      return new Response('Unauthorized', { status: 401 });
    }

    // 7. 解析消息
    const message = await adapter.parseMessage(request, config);
    if (!message) {
      // 非用户消息（如事件通知），返回 OK
      return new Response('OK', { status: 200 });
    }

    // 8. 处理消息（异步，不阻塞响应）
    await processIMMessage(message, adapter, config);

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error(`[Webhook] 平台 ${platform} 处理请求失败:`, error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * GET handler：处理微信/企业微信 echostr 接入验证
 *
 * 微信：验证签名后直接返回 echostr 明文
 * 企业微信：验证签名后解密 echostr 并返回明文
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { platform } = await params;

  // 校验平台标识
  if (!isValidPlatform(platform)) {
    return new Response(`不支持的平台: ${platform}`, { status: 400 });
  }

  // Stream 平台不接受 Webhook 请求
  if (isStreamPlatform(platform)) {
    return new Response('此平台使用 Stream 模式，不接受 Webhook', { status: 400 });
  }

  // 加载渠道配置
  const config = await loadChannelConfig(platform);
  if (!config?.enabled) {
    console.warn(`[Webhook] 平台 ${platform} 未配置或未启用`);
    return new Response('渠道未配置或未启用', { status: 503 });
  }

  try {
    // 获取 Webhook 适配器并处理 challenge 验证
    const adapter = await getWebhookAdapter(platform);
    const challenge = await adapter.handleChallenge(request, config);

    if (challenge.isChallenge) {
      return challenge.response!;
    }

    // GET 请求如果不是 challenge，返回 OK
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error(`[Webhook] 平台 ${platform} GET 请求处理失败:`, error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

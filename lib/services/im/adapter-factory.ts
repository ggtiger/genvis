import type { IMPlatform } from './types';
import { STREAM_PLATFORMS } from './types';
import type { StreamAdapter, WebhookAdapter } from './adapter';

// 挂载到 globalThis 防止 Next.js HMR 重建丢失注册
const _gk = '__im_adapter_registries__';
const _registries: {
  stream: Map<IMPlatform, () => Promise<StreamAdapter>>;
  webhook: Map<IMPlatform, () => Promise<WebhookAdapter>>;
} = (globalThis as any)[_gk] ?? ((globalThis as any)[_gk] = {
  stream: new Map<IMPlatform, () => Promise<StreamAdapter>>(),
  webhook: new Map<IMPlatform, () => Promise<WebhookAdapter>>(),
});
const streamAdapterRegistry = _registries.stream;
const webhookAdapterRegistry = _registries.webhook;

export function registerStreamAdapter(platform: IMPlatform, factory: () => Promise<StreamAdapter>): void {
  streamAdapterRegistry.set(platform, factory);
}

export function registerWebhookAdapter(platform: IMPlatform, factory: () => Promise<WebhookAdapter>): void {
  webhookAdapterRegistry.set(platform, factory);
}

export async function getStreamAdapter(platform: IMPlatform): Promise<StreamAdapter> {
  const factory = streamAdapterRegistry.get(platform);
  if (!factory) throw new Error(`平台 ${platform} 不支持 Stream 模式`);
  return factory();
}

export async function getWebhookAdapter(platform: IMPlatform): Promise<WebhookAdapter> {
  const factory = webhookAdapterRegistry.get(platform);
  if (!factory) throw new Error(`平台 ${platform} 不支持 Webhook 模式`);
  return factory();
}

export function isStreamPlatform(platform: IMPlatform): boolean {
  return STREAM_PLATFORMS.includes(platform);
}

// 注册 Stream 适配器（懒加载）
registerStreamAdapter('dingtalk', () => import('./adapters/dingtalk-stream').then(m => m.default));
registerStreamAdapter('feishu', () => import('./adapters/feishu-stream').then(m => m.default));
registerStreamAdapter('qq', () => import('./adapters/qq-stream').then(m => m.default));
registerStreamAdapter('wechat_personal', () => import('./adapters/wechat-personal/adapter').then(m => m.default));

// 注册 Webhook 适配器（懒加载）
registerWebhookAdapter('wechat', () => import('./adapters/wechat-webhook').then(m => m.default));
registerWebhookAdapter('wecom', () => import('./adapters/wecom-webhook').then(m => m.default));

import { NextRequest, NextResponse } from 'next/server';
import { loadGlobalSettings, saveChannelConfig } from '@/lib/services/settings';
import { connectionManager } from '@/lib/services/im/connection-manager';
import { isStreamPlatform } from '@/lib/services/im/adapter-factory';
import type { IMPlatform, IMChannelConfig, IMChannelsSettings } from '@/lib/services/im/types';

const VALID_PLATFORMS: IMPlatform[] = ['wechat', 'feishu', 'dingtalk', 'qq', 'wecom'];

function isValidPlatform(value: unknown): value is IMPlatform {
  return typeof value === 'string' && VALID_PLATFORMS.includes(value as IMPlatform);
}

/** 脱敏 appSecret：仅显示最后 4 位 */
function maskSecret(secret: string): string {
  if (!secret || secret.length <= 4) return secret;
  return '*'.repeat(secret.length - 4) + secret.slice(-4);
}

/** 对单个渠道配置进行脱敏处理 */
function maskChannelConfig(config: IMChannelConfig): IMChannelConfig {
  return {
    ...config,
    appSecret: maskSecret(config.appSecret),
  };
}

/** GET：返回所有渠道配置（脱敏显示 appSecret） */
export async function GET() {
  try {
    const settings = await loadGlobalSettings();
    const channels: IMChannelsSettings = settings.im_channels ?? {};

    const masked: IMChannelsSettings = {};
    for (const platform of VALID_PLATFORMS) {
      const config = channels[platform];
      if (config) {
        masked[platform] = maskChannelConfig(config);
      }
    }

    return NextResponse.json(masked);
  } catch (error) {
    console.error('[API] Failed to load IM channel settings:', error);
    return NextResponse.json(
      { error: 'Failed to load IM channel settings' },
      { status: 500 },
    );
  }
}

/** PUT：更新指定平台的渠道配置 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { platform, config } = body as { platform: unknown; config: unknown };

    if (!isValidPlatform(platform)) {
      return NextResponse.json(
        { error: `Invalid platform. Must be one of: ${VALID_PLATFORMS.join(', ')}` },
        { status: 400 },
      );
    }

    if (!config || typeof config !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid config object' },
        { status: 400 },
      );
    }

    const channelConfig = config as IMChannelConfig;
    await saveChannelConfig(platform, channelConfig);

    // Stream 平台更新后触发 ConnectionManager 重连
    if (isStreamPlatform(platform) && channelConfig.enabled) {
      await connectionManager.reconnect(platform, channelConfig);
    }

    return NextResponse.json({ success: true, platform });
  } catch (error) {
    console.error('[API] Failed to update IM channel config:', error);
    return NextResponse.json(
      {
        error: 'Failed to update IM channel config',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

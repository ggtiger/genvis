import { NextRequest, NextResponse } from 'next/server';
import { getQRCode, pollQRStatus } from '@/lib/services/im/adapters/wechat-personal/api';
import { DEFAULT_BASE_URL } from '@/lib/services/im/adapters/wechat-personal/types';
import { loadChannelConfig, saveChannelConfig } from '@/lib/services/settings';
import { connectionManager } from '@/lib/services/im/connection-manager';

/**
 * 个人微信 QR 码登录 API
 *
 * POST body: { action: 'start' | 'poll' | 'save', ... }
 *
 * action=start: 获取 QR 码登录链接
 *   返回: { qrcodeUrl: string }
 *
 * action=poll: 轮询扫码状态
 *   body: { qrcode: string }
 *   返回: { status: 'wait' | 'scaned' | 'confirmed', botToken?, accountId? }
 *
 * action=save: 保存 botToken 并启动连接
 *   body: { botToken: string, accountId?: string }
 *   返回: { success: true }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };

    // 读取当前配置以获取 baseUrl
    const currentConfig = await loadChannelConfig('wechat_personal');
    const baseUrl = currentConfig?.baseUrl || DEFAULT_BASE_URL;

    switch (action) {
      case 'start': {
        const result = await getQRCode(baseUrl);
        // 返回 qrcode（用于轮询）和 qrcodeUrl（图片 URL）
        return NextResponse.json({ qrcode: result.qrcode, qrcodeUrl: result.qrcodeUrl });
      }

      case 'poll': {
        const { qrcode } = body as { qrcode: string };
        if (!qrcode) {
          return NextResponse.json({ error: '缺少 qrcode 参数' }, { status: 400 });
        }

        const result = await pollQRStatus({ baseUrl, qrcode });
        return NextResponse.json({
          status: result.status || 'wait',
          botToken: result.bot_token,
          accountId: result.ilink_bot_id,
        });
      }

      case 'save': {
        const { botToken, accountId } = body as { botToken: string; accountId?: string };
        if (!botToken) {
          return NextResponse.json({ error: '缺少 botToken 参数' }, { status: 400 });
        }

        // 合并保存到渠道配置
        const config = currentConfig || {
          enabled: true,
          receiveMode: 'stream' as const,
          appId: accountId || '',
          appSecret: '',
          token: '',
        };

        const updatedConfig = {
          ...config,
          enabled: true,
          receiveMode: 'stream' as const,
          botToken,
          baseUrl,
          appId: accountId || config.appId || '',
        };

        await saveChannelConfig('wechat_personal', updatedConfig);

        // 触发 ConnectionManager 连接
        try {
          await connectionManager.reconnect('wechat_personal', updatedConfig);
        } catch (err) {
          console.error('[WechatPersonal] 登录后启动连接失败:', err);
          // 不影响保存结果
        }

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: `未知 action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[WechatPersonal] 登录 API 错误:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { connectionManager } from '@/lib/services/im/connection-manager';
import { loadChannelConfig } from '@/lib/services/settings';
import type { IMPlatform } from '@/lib/services/im/types';
import { STREAM_PLATFORMS } from '@/lib/services/im/types';
import { TOPIC_ROBOT } from 'dingtalk-stream-sdk-nodejs';

/** GET：返回所有渠道连接状态 */
export async function GET(request: NextRequest) {
  try {
    const debug = request.nextUrl.searchParams.get('debug') === '1';
    const statuses = connectionManager.getStatus();

    if (debug) {
      // 诊断模式：返回更详细的 SDK 内部状态
      const diagnostics: Record<string, unknown> = {};
      for (const platform of STREAM_PLATFORMS) {
        try {
          const adapter = await (await import(`@/lib/services/im/adapters/${platform}-stream`)).default;
          const client = (adapter as any).client;
          if (client) {
            diagnostics[platform] = {
              adapterConnected: (adapter as any).connected,
              sdkConnected: client.connected,
              sdkRegistered: client.registered,
              sdkReconnecting: client.reconnecting,
              socketReadyState: client.socket?.readyState,
              autoReconnect: client.config?.autoReconnect,
              lastMessageAt: (adapter as any).lastMessageAt
                ? new Date((adapter as any).lastMessageAt).toISOString()
                : null,
              listenerCount: typeof client.listenerCount === 'function'
                ? client.listenerCount(TOPIC_ROBOT)
                : 'unknown',
            };
          } else {
            diagnostics[platform] = { client: null };
          }
        } catch (e) {
          diagnostics[platform] = { error: String(e) };
        }
      }
      return NextResponse.json({ statuses, diagnostics });
    }

    return NextResponse.json(statuses);
  } catch (error) {
    console.error('[API] Failed to get IM connection status:', error);
    return NextResponse.json(
      { error: 'Failed to get connection status' },
      { status: 500 },
    );
  }
}

/** POST：手动触发指定平台重连 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { platform } = body as { platform: unknown };

    if (
      typeof platform !== 'string' ||
      !STREAM_PLATFORMS.includes(platform as IMPlatform)
    ) {
      return NextResponse.json(
        { error: `Invalid platform. Must be one of: ${STREAM_PLATFORMS.join(', ')}` },
        { status: 400 },
      );
    }

    const config = await loadChannelConfig(platform as IMPlatform);
    if (!config) {
      return NextResponse.json(
        { error: `Platform ${platform} is not configured` },
        { status: 404 },
      );
    }

    await connectionManager.reconnect(platform as IMPlatform, config);
    return NextResponse.json({ success: true, platform });
  } catch (error) {
    console.error('[API] Failed to reconnect IM platform:', error);
    return NextResponse.json(
      {
        error: 'Failed to reconnect',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

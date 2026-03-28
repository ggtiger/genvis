/**
 * IM Message Send API
 * POST /api/im/send
 *
 * Unified API to send messages to connected IM channels.
 * Supports: wechat_personal, dingtalk, feishu, qq
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadChannelConfig } from '@/lib/services/settings';
import type { IMPlatform, IMChannelConfig } from '@/lib/services/im/types';
import { STREAM_PLATFORMS } from '@/lib/services/im/types';

interface SendRequest {
  platform: string;
  conversationId: string;
  content: string;
}

/**
 * Send a text message to the specified IM platform and conversation.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SendRequest;
    const { platform, conversationId, content } = body;

    // Validate inputs
    if (!platform || !conversationId || !content) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: platform, conversationId, content' },
        { status: 400 }
      );
    }

    // Validate platform
    if (!STREAM_PLATFORMS.includes(platform as IMPlatform)) {
      return NextResponse.json(
        { success: false, error: `Unsupported platform: ${platform}. Supported: ${STREAM_PLATFORMS.join(', ')}` },
        { status: 400 }
      );
    }

    // Load channel config
    const config = await loadChannelConfig(platform as IMPlatform);
    if (!config?.enabled) {
      return NextResponse.json(
        { success: false, error: `Platform ${platform} is not configured or not enabled` },
        { status: 400 }
      );
    }

    // Send message based on platform
    let sendResult: { success: boolean; error?: string };

    switch (platform) {
      case 'wechat_personal':
        sendResult = await sendToWechatPersonal(config, conversationId, content);
        break;
      case 'dingtalk':
        sendResult = await sendToDingTalk(config, conversationId, content);
        break;
      case 'feishu':
        sendResult = await sendToFeishu(config, conversationId, content);
        break;
      case 'qq':
        sendResult = await sendToQQ(config, conversationId, content);
        break;
      default:
        return NextResponse.json(
          { success: false, error: `Platform ${platform} sender not implemented` },
          { status: 501 }
        );
    }

    if (!sendResult.success) {
      return NextResponse.json(
        { success: false, error: sendResult.error || 'Send failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[IM Send API] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Send message to WeChat Personal via ilink API
 * Uses the same format as adapter.ts sendReply method.
 */
async function sendToWechatPersonal(
  config: { botToken?: string; baseUrl?: string },
  conversationId: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { sendMessage } = await import('@/lib/services/im/adapters/wechat-personal/api');
    const wechatAdapter = await import('@/lib/services/im/adapters/wechat-personal/adapter');
    const { randomUUID } = await import('crypto');

    // Get context_token from adapter cache (required by ilink protocol)
    const contextToken = wechatAdapter.default.getContextToken?.(conversationId);
    if (!contextToken) {
      console.warn(`[IM Send] No context_token found for ${conversationId}, message may fail`);
    }

    // Generate unique client_id (required by ilink API to prevent deduplication)
    const clientId = `genvis-im-${randomUUID()}`;

    await sendMessage({
      baseUrl: config.baseUrl,
      token: config.botToken,
      body: {
        msg: {
          to_user_id: conversationId,
          from_user_id: '',  // Must be empty string (per ilink protocol)
          client_id: clientId,
          message_type: 2, // BOT = 2 (not USER = 1)
          message_state: 2, // FINISH = 2
          context_token: contextToken || undefined,
          item_list: [
            {
              type: 1, // TEXT
              text_item: { text: content },
            },
          ],
        },
      },
    });

    console.log(`[IM Send] WeChat Personal message sent to ${conversationId}`);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[IM Send] WeChat Personal send failed:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Send message to DingTalk
 * Note: DingTalk Stream SDK doesn't support proactive messaging directly.
 * This is a placeholder for future implementation.
 */
async function sendToDingTalk(
  config: IMChannelConfig,
  conversationId: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  // DingTalk Stream SDK primarily receives messages, sending requires webhook or API
  // TODO: Implement using DingTalk API if available
  console.warn('[IM Send] DingTalk proactive send not implemented yet');
  return { success: false, error: 'DingTalk proactive messaging not implemented' };
}

/**
 * Send message to Feishu
 * Note: Feishu Stream SDK doesn't support proactive messaging directly.
 * This is a placeholder for future implementation.
 */
async function sendToFeishu(
  config: IMChannelConfig,
  conversationId: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement using Feishu API
  console.warn('[IM Send] Feishu proactive send not implemented yet');
  return { success: false, error: 'Feishu proactive messaging not implemented' };
}

/**
 * Send message to QQ
 * Note: QQ (NapCat/go-cqhttp) WebSocket API for sending messages.
 */
async function sendToQQ(
  config: { extra?: Record<string, string> },
  conversationId: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // QQ adapter uses WebSocket, need to get the adapter instance
    // For now, return not implemented
    // TODO: Implement QQ message sending via adapter
    console.warn('[IM Send] QQ proactive send not implemented yet');
    return { success: false, error: 'QQ proactive messaging not implemented' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[IM Send] QQ send failed:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

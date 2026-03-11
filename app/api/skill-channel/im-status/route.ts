/**
 * Skill Channel IM Status API
 * GET /api/skill-channel/im-status
 *
 * 让 skill 查询当前已连接的 IM 渠道状态。
 * Skill 可以据此决定是否/向哪个渠道发送消息。
 *
 * 响应：
 * {
 *   channels: Array<{
 *     platform: string;
 *     connected: boolean;
 *     receiveMode: string;
 *   }>
 * }
 */

import {
  createSuccessResponse,
  handleApiError,
} from '@/lib/utils/api-response';
import { connectionManager } from '@/lib/services/im/connection-manager';

export async function GET() {
  try {
    const statuses = connectionManager.getStatus();
    const channels = statuses.map(s => ({
      platform: s.platform,
      connected: s.connectionStatus === 'connected',
      receiveMode: s.receiveMode,
    }));

    return createSuccessResponse({ channels });
  } catch (error) {
    return handleApiError(error, 'SkillChannelIMStatus', '获取 IM 状态失败');
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Skill Channel Send API
 * POST /api/skill-channel/send
 *
 * 让 app 类型的 skill 作为消息发送端，发送消息给秘书。
 * 等同于钉钉等 IM 渠道的角色，但发送方是部署的 skill 应用。
 *
 * 请求体：
 * {
 *   skillName: string;       // 发送消息的 skill 名称（必填）
 *   message: string;         // 消息内容（必填）
 *   senderId?: string;       // 原始发送者标识
 *   platform?: string;       // 原始平台标识
 *   callbackUrl?: string;    // 任务完成后的回调 URL
 *   callbackPayload?: object; // 透传给回调的自定义数据
 * }
 *
 * 响应：
 * {
 *   reply: string;           // 秘书的即时回复
 *   actions?: SecretaryAction[];
 *   async?: boolean;         // true 表示有异步任务，结果会通过 callbackUrl 推送
 * }
 */

import { NextRequest } from 'next/server';
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
} from '@/lib/utils/api-response';
import {
  processSkillMessage,
  type SkillChannelRequest,
} from '@/lib/services/skill-channel';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SkillChannelRequest;

    if (!body.skillName || typeof body.skillName !== 'string') {
      return createErrorResponse('skillName 不能为空', 'skillName is required', 400);
    }
    if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
      return createErrorResponse('message 不能为空', 'message is required', 400);
    }

    console.log(`[SkillChannelAPI] 收到来自 "${body.skillName}" 的消息: "${body.message.slice(0, 100)}"`);

    const result = await processSkillMessage(body);

    return createSuccessResponse(result);
  } catch (error) {
    return handleApiError(error, 'SkillChannelAPI', 'Skill 消息处理失败');
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

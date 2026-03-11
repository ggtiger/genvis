/**
 * Skill Channel IM Push API
 * POST /api/skill-channel/im-push
 *
 * 让 app 类型的 skill 直接发送消息到当前已连接的 IM 渠道（钉钉/飞书/企微等）。
 * Skill 处理完业务逻辑后，通过此端点将结果推送给 IM 用户。
 *
 * 支持三种模式：
 * 1. broadcast: 广播到所有已连接的 IM 渠道（默认）
 * 2. platform: 发送到指定平台的所有用户
 * 3. targeted: 发送到指定平台的指定用户
 *
 * 请求体：
 * {
 *   content: string;          // 消息内容（必填）
 *   skillName?: string;       // 发送方 skill 名称（用于日志）
 *   platform?: string;        // 指定平台（dingtalk/feishu/wechat/wecom/qq）
 *   senderId?: string;        // 指定接收者 ID（需配合 platform 使用）
 *   rawPayload?: unknown;     // 平台原始 payload（用于回复特定会话）
 * }
 */

import { NextRequest } from 'next/server';
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
} from '@/lib/utils/api-response';
import { sendToIM, type IMPushRequest } from '@/lib/services/skill-channel';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as IMPushRequest;

    if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
      return createErrorResponse('content 不能为空', 'content is required', 400);
    }

    const result = await sendToIM(body);
    return createSuccessResponse(result);
  } catch (error) {
    return handleApiError(error, 'SkillChannelIMPush', 'IM 消息推送失败');
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

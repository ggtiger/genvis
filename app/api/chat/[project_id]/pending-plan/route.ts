import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { userRequests, messages } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

/**
 * 获取项目的 plan 内容
 * 返回 { hasPlan, planContent, isApproved, requestId }
 *
 * 注意：只返回 ExitPlanMode 工具调用中的计划内容，
 * 而非所有带 planning: true 的消息（那些可能只是询问阶段）
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;

    // 查询 ExitPlanMode 工具调用消息
    const toolMessages = await db.select()
      .from(messages)
      .where(and(
        eq(messages.projectId, project_id),
        eq(messages.role, 'tool'),
        eq(messages.messageType, 'tool_use')
      ))
      .orderBy(desc(messages.createdAt));

    // 找到最后一条 ExitPlanMode 工具调用
    let planContent: string | null = null;
    let planRequestId: string | null = null;
    for (const msg of toolMessages) {
      if (msg.metadataJson) {
        try {
          const meta = JSON.parse(msg.metadataJson);
          const toolName = (meta.toolName ?? '').toString().toLowerCase();
          if (toolName === 'exitplanmode') {
            const planText = typeof meta.toolInput?.plan === 'string' ? meta.toolInput.plan.trim() : '';
            if (planText.length > 0) {
              planContent = planText;
              planRequestId = msg.requestId;
              break;
            }
          }
        } catch {}
      }
    }

    if (!planContent) {
      return NextResponse.json({ hasPlan: false });
    }

    // 查询该 requestId 对应的 userRequest 状态
    let isApproved = true; // 默认已确认
    if (planRequestId) {
      const requests = await db.select()
        .from(userRequests)
        .where(eq(userRequests.id, planRequestId))
        .limit(1);

      if (requests.length > 0) {
        isApproved = requests[0].status !== 'waiting_approval';
      }
    }

    return NextResponse.json({
      hasPlan: true,
      planContent,
      requestId: planRequestId,
      isApproved,
    });
  } catch (error) {
    console.error('[API] Failed to get plan:', error);
    return NextResponse.json({ hasPlan: false, error: 'Failed to get plan' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

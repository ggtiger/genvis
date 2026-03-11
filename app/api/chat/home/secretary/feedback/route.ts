/**
 * Secretary Feedback API Route
 * POST /api/chat/home/secretary/feedback
 *
 * Handles thumbs_up / thumbs_down feedback on secretary dispatch decisions.
 * - thumbs_down: locates the dispatch decision, builds a CorrectionResult,
 *   then fire-and-forget calls recordCorrection + checkAndPromoteRules.
 * - thumbs_up: locates the dispatch decision, finds the matching
 *   dispatch_learnings entry, and increases its confidence.
 *
 * Validates: Requirements 7.2, 7.3, 7.4
 */

import { NextRequest } from 'next/server';
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
} from '@/lib/utils/api-response';
import { loadSession } from '@/lib/services/secretary-session';
import {
  loadMemory,
  saveMemory,
  upsertEntry,
  type MemoryDataV2,
} from '@/lib/services/secretary-memory';
import type { CorrectionResult } from '@/lib/services/correction-detector';
import { recordCorrection } from '@/lib/services/correction-recorder';
import { checkAndPromoteRules } from '@/lib/services/rule-promoter';
import { recordIntentExample } from '@/lib/services/intent-example-store';

// ========== Interfaces ==========

interface FeedbackRequest {
  /** 消息时间戳，用于定位具体的调度决策 */
  messageTimestamp: string;
  /** 反馈类型 */
  type: 'thumbs_up' | 'thumbs_down';
  /** 踩时可选的补充说明 */
  comment?: string;
}

// ========== POST Handler ==========

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request body
    const body = (await request.json()) as FeedbackRequest;
    const { messageTimestamp, type, comment } = body;

    if (!messageTimestamp || typeof messageTimestamp !== 'string') {
      return createErrorResponse('messageTimestamp is required', undefined, 400);
    }

    if (type !== 'thumbs_up' && type !== 'thumbs_down') {
      return createErrorResponse('type must be thumbs_up or thumbs_down', undefined, 400);
    }

    // 2. Load session and find the assistant message by timestamp
    const session = await loadSession();
    const assistantMessage = session.messages.find(
      (m) => m.role === 'assistant' && m.timestamp === messageTimestamp,
    );

    if (!assistantMessage) {
      return createErrorResponse('Message not found', undefined, 404);
    }

    // 3. Find the preceding user message (the original request)
    const assistantIndex = session.messages.indexOf(assistantMessage);
    let userMessage = null;
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        userMessage = session.messages[i];
        break;
      }
    }

    if (!userMessage) {
      return createErrorResponse('Preceding user message not found', undefined, 404);
    }

    // 4. Process based on feedback type
    if (type === 'thumbs_down') {
      // Build CorrectionResult from the dispatch decision
      const actions = assistantMessage.actions || [];
      const dispatchAction = actions.find(
        (a) => a.type === 'dispatch' || a.type === 'skill_call',
      );

      const actionType = dispatchAction?.type || 'direct_reply';
      const actionTarget =
        dispatchAction?.type === 'dispatch'
          ? dispatchAction.employeeName || dispatchAction.employeeId || 'unknown'
          : dispatchAction?.type === 'skill_call'
            ? dispatchAction.skillName || 'unknown'
            : 'direct_reply';

      const correctionResult: CorrectionResult = {
        originalInput: userMessage.content,
        wrongAction: `${actionType}/${actionTarget}`,
        wrongActionType: actionType as CorrectionResult['wrongActionType'],
        correctionMessage: comment || '用户反馈：调度错误',
      };

      // Fire-and-forget: record correction + check promotion
      recordCorrection(correctionResult).catch(() => {});
      checkAndPromoteRules().catch(() => {});
    } else {
      // thumbs_up: increase confidence of matching dispatch_learnings entry
      // AND record as a confirmed intent example for future few-shot
      try {
        const memory = await loadMemory();
        const learnings = memory.dispatch_learnings ?? [];
        const matchingEntry = learnings.find(
          (e) => e.key === userMessage!.content,
        );

        if (matchingEntry) {
          const newConfidence = Math.min((matchingEntry.confidence || 0) + 0.1, 1.0);
          const now = new Date().toISOString();

          const updated = upsertEntry(memory, 'dispatch_learnings', {
            key: matchingEntry.key,
            value: matchingEntry.value,
            source: matchingEntry.source,
            count: matchingEntry.count,
            confidence: newConfidence,
            lastAccessedAt: now,
            accessCount: (matchingEntry.accessCount || 0) + 1,
            channel: matchingEntry.channel || 'web',
          }) as MemoryDataV2;

          await saveMemory(updated);
        }

        // Record confirmed intent example (fire-and-forget)
        const actions = assistantMessage.actions || [];
        const primaryAction = actions.find(
          (a) => a.type === 'dispatch' || a.type === 'skill_call',
        );
        if (primaryAction) {
          recordIntentExample({
            userMessage: userMessage!.content,
            action: primaryAction.type as 'dispatch' | 'skill_call',
            target: primaryAction.type === 'dispatch'
              ? (primaryAction.employeeName || primaryAction.employeeId || '')
              : (primaryAction.skillName || ''),
            employeeId: primaryAction.employeeId,
            skillName: primaryAction.skillName,
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('[FeedbackAPI] 正向反馈处理失败:', err);
      }
    }

    return createSuccessResponse({ status: 'ok' });
  } catch (error) {
    return handleApiError(error, 'SecretaryFeedbackAPI', '反馈处理失败');
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Secretary Reply to Project API Route
 * POST /api/chat/home/reply-to-project
 *
 * Allows the secretary to send a reply to a specific project (employee).
 * Used when an employee task is in waiting_feedback state and the user
 * wants to respond directly from the secretary chat panel.
 *
 * Also supports GET to fetch the feedback question content.
 */

import { NextRequest } from 'next/server';
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
} from '@/lib/utils/api-response';
import { getProjectById, updateProjectActivity } from '@/lib/services/project';
import { createMessage } from '@/lib/services/message';
import { streamManager } from '@/lib/services/stream';
import { serializeMessage } from '@/lib/serializers/chat';
import { generateProjectId } from '@/lib/utils';
import {
  upsertUserRequest,
  markUserRequestAsProcessing,
  getUserRequestById,
} from '@/lib/services/user-requests';
import { db } from '@/lib/db/client';
import { userRequests, messages } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

interface FeedbackQuestionResponse {
  projectId: string;
  employeeName: string;
  questionContent: string;
  requestId: string;
}

/**
 * GET /api/chat/home/reply-to-project?projectId=xxx
 * Fetch the feedback question for a project in waiting_feedback state.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return createErrorResponse('projectId is required', 'missing projectId', 400);
    }

    // Get the latest waiting_feedback request for this project
    const requestRows = await db
      .select()
      .from(userRequests)
      .where(
        and(
          eq(userRequests.projectId, projectId),
          eq(userRequests.status, 'waiting_feedback')
        )
      )
      .orderBy(desc(userRequests.createdAt))
      .limit(1);

    const latestRequest = requestRows[0];
    if (!latestRequest) {
      return createErrorResponse('No waiting_feedback request found for this project', 'not found', 404);
    }

    // Get the feedback question from memory or from the last assistant message
    let questionContent = latestRequest.instruction || '员工需要你的确认';

    // Try to get the last assistant message as the question content
    const lastMsgs = await db
      .select({ content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.projectId, projectId),
          eq(messages.role, 'assistant'),
          eq(messages.messageType, 'chat')
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    if (lastMsgs[0]?.content) {
      questionContent = lastMsgs[0].content;
    }

    // Get project info for employee name
    const project = await getProjectById(projectId);
    // Try to get employee name from employee_id
    let employeeName = project?.name || '员工';
    if (project?.employee_id) {
      try {
        const { getEmployeeById } = await import('@/lib/services/employee-service');
        const employee = await getEmployeeById(project.employee_id);
        if (employee?.name) employeeName = employee.name;
      } catch { /* ignore */ }
    }

    const responseData: FeedbackQuestionResponse = {
      projectId,
      employeeName,
      questionContent,
      requestId: latestRequest.id,
    };

    return createSuccessResponse(responseData);
  } catch (error) {
    return handleApiError(error, 'ReplyToProject', 'Failed to get feedback question');
  }
}

/**
 * POST /api/chat/home/reply-to-project
 * Send a reply message to a project (employee) from the secretary panel.
 *
 * Body: { projectId: string, message: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, message } = body as { projectId: string; message: string };

    if (!projectId || !message?.trim()) {
      return createErrorResponse('projectId and message are required', 'missing parameters', 400);
    }

    const project = await getProjectById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 'project not found', 404);
    }

    // Get the current waiting_feedback request
    const requestRows = await db
      .select()
      .from(userRequests)
      .where(
        and(
          eq(userRequests.projectId, projectId),
          eq(userRequests.status, 'waiting_feedback')
        )
      )
      .orderBy(desc(userRequests.createdAt))
      .limit(1);

    const latestRequest = requestRows[0];
    if (!latestRequest) {
      return createErrorResponse('No waiting_feedback request found', 'not found', 404);
    }

    // Create user message in DB
    const requestId = latestRequest.id;
    const userMessage = await createMessage({
      projectId,
      role: 'user',
      messageType: 'chat',
      content: message.trim(),
      cliSource: project.preferredCli || 'claude',
      requestId,
    });

    // Publish message via WebSocket so the chat page sees it
    streamManager.publish(projectId, {
      type: 'message',
      data: serializeMessage(userMessage, { requestId }),
    });

    // Update request status to processing
    await markUserRequestAsProcessing(requestId);

    await updateProjectActivity(projectId);

    // Dynamically import the CLI executor and continue the task
    const cliPreference = project.preferredCli || 'claude';
    const { applyChanges: applyClaudeChanges } = await import('@/lib/services/cli/claude');

    let executor: typeof applyClaudeChanges;

    if (cliPreference === 'codex') {
      const { applyChanges } = await import('@/lib/services/cli/codex');
      executor = applyChanges;
    } else if (cliPreference === 'cursor') {
      const { applyChanges } = await import('@/lib/services/cli/cursor');
      executor = applyChanges;
    } else if (cliPreference === 'qwen') {
      const { applyChanges } = await import('@/lib/services/cli/qwen');
      executor = applyChanges;
    } else if (cliPreference === 'glm') {
      const { applyChanges } = await import('@/lib/services/cli/glm');
      executor = applyChanges;
    } else {
      executor = applyClaudeChanges;
    }

    // Get project working directory
    const { PROJECTS_DIR_ABSOLUTE } = await import('@/lib/config/paths');
    const path = await import('path');
    const workDirectory = (project as any).work_directory;
    const projectPath = (project.mode === 'work' || project.mode === 'boss') && workDirectory
      ? workDirectory
      : (project.repoPath || path.join(PROJECTS_DIR_ABSOLUTE, projectId));

    // Get selected model
    const { getDefaultModelForCli, normalizeModelId } = await import('@/lib/constants/cliModels');
    const selectedModel = normalizeModelId(cliPreference, project.selectedModel || getDefaultModelForCli(cliPreference));

    // Reset feedback notification flag so subsequent feedbacks can notify again
    try {
      const { resetFeedbackNotified } = await import('@/lib/services/dispatch-tracker');
      resetFeedbackNotified(projectId);
    } catch { /* ignore */ }

    // Execute in background (fire and forget)
    executor(
      projectId,
      projectPath,
      message.trim(),
      selectedModel,
      undefined, // sessionId
      requestId,
    ).catch((err) => {
      console.error(`[ReplyToProject] Executor failed for ${projectId}:`, err);
    });

    console.log(`[ReplyToProject] ✅ Reply sent to project ${projectId}, task resumed`);

    return createSuccessResponse({
      success: true,
      message: 'Reply sent to project',
      projectId,
      userMessageId: userMessage.id,
    });
  } catch (error) {
    return handleApiError(error, 'ReplyToProject', 'Failed to send reply to project');
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

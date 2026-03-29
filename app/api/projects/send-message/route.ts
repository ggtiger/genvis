/**
 * POST /api/projects/send-message
 *
 * Send a message to a specific project and trigger AI execution.
 * If the project has an active task (busy), returns busy status.
 *
 * This endpoint can be called by the secretary AI to dispatch work to projects,
 * or by any external integration that needs to send instructions to a project.
 *
 * Body: {
 *   projectId: string      — Target project ID (required)
 *   message: string        — Instruction/message content (required)
 *   cliPreference?: string — CLI preference: claude, codex, cursor, qwen, glm
 *   selectedModel?: string — Model to use
 * }
 *
 * Returns:
 *   { success: true, requestId, userMessageId }  — Message sent and AI execution started
 *   { success: true, busy: true, busyMessage }   — Project is busy with an active task
 *   { success: false, error }                     — Error (project not found, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProjectById } from '@/lib/services/project';
import { getActiveTaskForProject } from '@/lib/services/user-requests';
import { trackDispatch } from '@/lib/services/dispatch-tracker';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE || '';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, message, cliPreference, selectedModel } = body;

    // Validate required fields
    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'projectId is required' },
        { status: 400 }
      );
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { success: false, error: 'message is required' },
        { status: 400 }
      );
    }

    // Check project existence
    const project = await getProjectById(projectId);
    if (!project) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${projectId}` },
        { status: 404 }
      );
    }

    // Busy detection: check if the project has an active task
    const activeTask = await getActiveTaskForProject(projectId, 10);
    if (activeTask) {
      return NextResponse.json({
        success: true,
        busy: true,
        busyMessage: `项目正在执行中，请稍后再发送`,
        activeTask: {
          requestId: activeTask.requestId,
          status: activeTask.status,
        },
      });
    }

    // Forward to the act endpoint to trigger AI execution
    // Build internal request to /api/chat/[projectId]/act
    const actUrl = new URL(`/api/chat/${encodeURIComponent(projectId)}/act`, request.url);

    const actBody: Record<string, unknown> = {
      instruction: message.trim(),
    };
    if (cliPreference) actBody.cliPreference = cliPreference;
    if (selectedModel) actBody.selectedModel = selectedModel;

    const actResponse = await fetch(actUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(actBody),
    });

    const actData = await actResponse.json();

    if (!actResponse.ok || !actData.success) {
      return NextResponse.json(
        {
          success: false,
          error: actData.error || actData.message || 'Failed to send message to project',
        },
        { status: actResponse.status }
      );
    }

    // 注册 dispatch 追踪：任务完成后自动将结果发送给秘书
    let employeeName = '员工';
    if ((project as any).employee_id) {
      try {
        const { getEmployeeById } = await import('@/lib/services/employee-service');
        const emp = await getEmployeeById((project as any).employee_id);
        if (emp?.name) employeeName = emp.name;
      } catch { /* use default */ }
    }

    trackDispatch({
      projectId,
      employeeName,
      source: 'web',
      createdAt: Date.now(),
    });
    console.log(`[API] send-message: registered dispatch tracking for ${projectId} (${employeeName})`);

    return NextResponse.json({
      success: true,
      projectId,
      projectName: project.name,
      requestId: actData.requestId,
      userMessageId: actData.userMessageId,
      message: actData.message || 'AI execution started',
    });
  } catch (error) {
    console.error('[API] Send message to project failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send message',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dispatch Status API Route
 * POST /api/chat/home/dispatch-status
 *
 * Checks the status of dispatched projects (tasks assigned by the secretary).
 * Accepts an array of projectIds and returns their current task status.
 * When a task is completed, also returns the final result text from the
 * last assistant message in that project.
 *
 * Used by HomeChatPanel to poll for task completion notifications.
 */

import { NextRequest, NextResponse } from 'next/server';

interface ProjectStatus {
  projectId: string;
  status: 'active' | 'completed' | 'failed' | 'unknown';
  projectName?: string;
  completedAt?: string;
  errorMessage?: string;
  /** The final result text from the last assistant message */
  resultText?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectIds } = body as { projectIds: string[] };

    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const { db: dbClient } = await import('@/lib/db/client');
    const { projects: projectsTable, userRequests, messages: messagesTable } = await import('@/lib/db/schema');
    const { eq, desc, and } = await import('drizzle-orm');

    const results: ProjectStatus[] = [];

    for (const projectId of projectIds) {
      try {
        // Get project name
        const projectRows = await dbClient
          .select()
          .from(projectsTable)
          .where(eq(projectsTable.id, projectId))
          .limit(1);

        const project = projectRows[0];
        if (!project) {
          results.push({ projectId, status: 'unknown' });
          continue;
        }

        // Get the latest user request for this project
        const requestRows = await dbClient
          .select()
          .from(userRequests)
          .where(eq(userRequests.projectId, projectId))
          .orderBy(desc(userRequests.createdAt))
          .limit(1);

        const latestRequest = requestRows[0];
        if (!latestRequest) {
          // No requests yet — still pending
          results.push({
            projectId,
            status: 'active',
            projectName: (project as any).name,
          });
          continue;
        }

        const reqStatus = (latestRequest.status || '').toLowerCase();

        if (reqStatus === 'completed') {
          // Extract the last assistant message as the result
          let resultText: string | undefined;
          try {
            const lastAssistantMsgs = await dbClient
              .select({ content: messagesTable.content })
              .from(messagesTable)
              .where(
                and(
                  eq(messagesTable.projectId, projectId),
                  eq(messagesTable.role, 'assistant'),
                  eq(messagesTable.messageType, 'chat')
                )
              )
              .orderBy(desc(messagesTable.createdAt))
              .limit(1);

            if (lastAssistantMsgs[0]?.content) {
              resultText = lastAssistantMsgs[0].content;
              // Truncate very long results
              if (resultText.length > 2000) {
                resultText = resultText.slice(0, 2000) + '...';
              }
            }
          } catch (err) {
            console.error(`[DispatchStatus] Failed to get result text for ${projectId}:`, err);
          }

          results.push({
            projectId,
            status: 'completed',
            projectName: (project as any).name,
            completedAt: latestRequest.completedAt ?? undefined,
            resultText,
          });
        } else if (reqStatus === 'failed') {
          results.push({
            projectId,
            status: 'failed',
            projectName: (project as any).name,
            errorMessage: latestRequest.errorMessage ?? undefined,
          });
        } else {
          results.push({
            projectId,
            status: 'active',
            projectName: (project as any).name,
          });
        }
      } catch (err) {
        console.error(`[DispatchStatus] Error checking project ${projectId}:`, err);
        results.push({ projectId, status: 'unknown' });
      }
    }

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    console.error('[DispatchStatus] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check dispatch status' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

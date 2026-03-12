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
    const { eq, desc, and, inArray } = await import('drizzle-orm');

    // Batch query 1: Get all projects at once
    const projectRows = await dbClient
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(inArray(projectsTable.id, projectIds));
    const projectMap = new Map(projectRows.map(p => [p.id, p]));

    // Batch query 2: Get latest user request per project
    // SQLite doesn't support DISTINCT ON, so we query all and deduplicate in JS
    const allRequests = await dbClient
      .select()
      .from(userRequests)
      .where(inArray(userRequests.projectId, projectIds))
      .orderBy(desc(userRequests.createdAt));
    const latestRequestMap = new Map<string, typeof allRequests[0]>();
    for (const req of allRequests) {
      if (!latestRequestMap.has(req.projectId)) {
        latestRequestMap.set(req.projectId, req);
      }
    }

    // Find which projects are completed and need result text
    const completedProjectIds = projectIds.filter(pid => {
      const req = latestRequestMap.get(pid);
      return req && (req.status || '').toLowerCase() === 'completed';
    });

    // Batch query 3: Get last assistant message for completed projects only
    const resultMap = new Map<string, string>();
    if (completedProjectIds.length > 0) {
      const assistantMsgs = await dbClient
        .select({ projectId: messagesTable.projectId, content: messagesTable.content, createdAt: messagesTable.createdAt })
        .from(messagesTable)
        .where(
          and(
            inArray(messagesTable.projectId, completedProjectIds),
            eq(messagesTable.role, 'assistant'),
            eq(messagesTable.messageType, 'chat')
          )
        )
        .orderBy(desc(messagesTable.createdAt));
      // Deduplicate: keep first (latest) per project
      for (const msg of assistantMsgs) {
        if (!resultMap.has(msg.projectId) && msg.content) {
          const text = msg.content.length > 2000 ? msg.content.slice(0, 2000) + '...' : msg.content;
          resultMap.set(msg.projectId, text);
        }
      }
    }

    // Build results
    const results: ProjectStatus[] = projectIds.map(projectId => {
      const project = projectMap.get(projectId);
      if (!project) return { projectId, status: 'unknown' as const };

      const latestRequest = latestRequestMap.get(projectId);
      if (!latestRequest) {
        return { projectId, status: 'active' as const, projectName: project.name ?? undefined };
      }

      const reqStatus = (latestRequest.status || '').toLowerCase();
      if (reqStatus === 'completed') {
        return {
          projectId,
          status: 'completed' as const,
          projectName: project.name ?? undefined,
          completedAt: latestRequest.completedAt ?? undefined,
          resultText: resultMap.get(projectId),
        };
      } else if (reqStatus === 'failed') {
        return {
          projectId,
          status: 'failed' as const,
          projectName: project.name ?? undefined,
          errorMessage: latestRequest.errorMessage ?? undefined,
        };
      } else {
        return {
          projectId,
          status: 'active' as const,
          projectName: project.name ?? undefined,
        };
      }
    });

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

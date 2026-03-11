/**
 * POST /api/repo/[project_id]/git/undo-commit
 * Undo the last commit (git reset --soft HEAD~1)
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getProjectById } from '@/lib/services/project';
import { undoLastCommit } from '@/lib/services/git';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

async function resolveProjectRoot(projectId: string): Promise<string> {
  const project = await getProjectById(projectId);
  if (!project) throw new Error('Project not found');
  if ((project as any).work_directory) {
    return path.resolve((project as any).work_directory);
  }
  const repoPath = project.repoPath || path.join('data', 'projects', project.id);
  return path.isAbsolute(repoPath) ? repoPath : path.resolve(process.cwd(), repoPath);
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const root = await resolveProjectRoot(project_id);
    const result = undoLastCommit(root);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[Git undo-commit]', error);
    return NextResponse.json(
      { error: error.message || 'Undo commit failed' },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

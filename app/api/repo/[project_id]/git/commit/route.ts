/**
 * POST /api/repo/[project_id]/git/commit
 * Commit staged changes
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getProjectById } from '@/lib/services/project';
import { commitStaged } from '@/lib/services/git';

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
    const body = await request.json();
    const { message } = body;

    if (!message) {
      return NextResponse.json({ error: 'commit message is required' }, { status: 400 });
    }

    const result = commitStaged(root, message);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[Git commit]', error);
    return NextResponse.json(
      { error: error.message || 'Git commit failed' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

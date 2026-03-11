/**
 * GET /api/repo/[project_id]/git/branches
 * List branches and current branch
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getProjectById } from '@/lib/services/project';
import { getCurrentBranch, listBranches } from '@/lib/services/git';

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

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const root = await resolveProjectRoot(project_id);
    const current = getCurrentBranch(root);
    const branches = listBranches(root);
    return NextResponse.json({ current, branches });
  } catch (error: any) {
    console.error('[Git branches]', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get branches' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

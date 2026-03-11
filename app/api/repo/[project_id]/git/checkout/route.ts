/**
 * POST /api/repo/[project_id]/git/checkout
 * Switch or create a branch
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getProjectById } from '@/lib/services/project';
import { checkoutBranch } from '@/lib/services/git';

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
    const { branch, create } = body;

    if (!branch) {
      return NextResponse.json({ error: 'branch name is required' }, { status: 400 });
    }

    checkoutBranch(root, branch, create);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Git checkout]', error);
    return NextResponse.json(
      { error: error.message || 'Git checkout failed' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/repo/[project_id]/git/stage
 * Stage, restore, or unstage a single file
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getProjectById } from '@/lib/services/project';
import { gitStage, gitRestore, gitRestoreStaged } from '@/lib/services/git';

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
    const { path: filePath, action } = body;

    if (!filePath || !action) {
      return NextResponse.json({ error: 'path and action are required' }, { status: 400 });
    }

    switch (action) {
      case 'stage':
        gitStage(root, filePath);
        break;
      case 'restore':
        gitRestore(root, filePath);
        break;
      case 'restore-staged':
        gitRestoreStaged(root, filePath);
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Git stage]', error);
    return NextResponse.json(
      { error: error.message || 'Git stage operation failed' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/repo/[project_id]/git/diff
 * Get file diff (unified diff parsed into structured result)
 * 
 * Query params:
 *   path    - file relative path (optional, omit for summary of all changes)
 *   from    - source version (default: HEAD)
 *   to      - target version (default: working; 'staged' for staging area)
 *   staged  - shorthand: 'true' means diff --cached HEAD
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getProjectById } from '@/lib/services/project';
import { getGitFileDiff, getGitDiff, parseUnifiedDiff, getGitDiffSummary } from '@/lib/services/git';

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
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');
    const from = searchParams.get('from') || 'HEAD';
    const to = searchParams.get('to') || 'working';
    const staged = searchParams.get('staged') === 'true';
    const fullContext = searchParams.get('fullContext') === 'true';
    const contextLines = fullContext ? 99999 : undefined;

    // No path: return summary of all changed files
    if (!filePath) {
      const summary = getGitDiffSummary(root);
      return NextResponse.json({ summary });
    }

    // Single file diff
    let rawDiff: string;

    if (staged || to === 'staged') {
      // Diff staged changes vs HEAD
      rawDiff = getGitFileDiff(root, filePath, true, contextLines);
    } else if (from === 'HEAD' && to === 'working') {
      // Diff working tree vs HEAD
      rawDiff = getGitFileDiff(root, filePath, false, contextLines);
    } else {
      // Diff between two commits/branches
      rawDiff = getGitDiff(root, from, to, filePath, contextLines);
    }

    const parsed = parseUnifiedDiff(rawDiff, filePath, from, to);
    return NextResponse.json(parsed);
  } catch (error: any) {
    console.error('[Git diff]', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get diff' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

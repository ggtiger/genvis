/**
 * POST /api/repo/[project_id]/git/generate-commit-msg
 * Use AI to generate a commit message based on staged diff
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getProjectById } from '@/lib/services/project';
import { loadClaudeConfig, callClaudeAPI } from '@/lib/services/secretary-core';
import { spawnSync } from 'child_process';

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

function getStagedDiff(cwd: string): string {
  const result = spawnSync('git', ['-c', 'core.quotePath=false', 'diff', '--cached', '--stat'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 5,
  });
  const stat = result.stdout?.trim() || '';

  // Also get a truncated patch for context
  const patchResult = spawnSync('git', ['-c', 'core.quotePath=false', 'diff', '--cached', '-U3'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 5,
  });
  let patch = patchResult.stdout?.trim() || '';
  // Truncate if too long to save tokens
  if (patch.length > 8000) {
    patch = patch.substring(0, 8000) + '\n... (diff truncated)';
  }

  return `--- Stat ---\n${stat}\n\n--- Diff ---\n${patch}`;
}

function getUnstagedStatus(cwd: string): string {
  const result = spawnSync('git', ['-c', 'core.quotePath=false', 'status', '--short'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024,
  });
  return result.stdout?.trim() || '';
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const root = await resolveProjectRoot(project_id);

    // Get staged diff
    const diff = getStagedDiff(root);
    if (!diff || diff.trim() === '--- Stat ---\n\n\n--- Diff ---\n') {
      return NextResponse.json({ error: '没有暂存的更改' }, { status: 400 });
    }

    const config = await loadClaudeConfig();
    if (!config.apiKey) {
      return NextResponse.json({ error: 'AI 服务未配置 API Key' }, { status: 400 });
    }

    const systemPrompt = `你是一个 Git commit message 生成器。根据提供的 git diff，生成一条简洁、规范的 commit message。

规则：
1. 使用英文，遵循 Conventional Commits 格式：type(scope): description
2. type 可选：feat, fix, refactor, style, docs, test, chore, perf, ci, build
3. scope 可选，表示修改范围
4. description 用简洁英文描述本次修改的核心内容
5. 如果修改涉及多个方面，可以用多行 body 补充说明
6. 只返回 commit message 本身，不要任何解释或 markdown 格式`;

    const userMessage = `请根据以下 git diff 生成 commit message：\n\n${diff}`;

    const commitMsg = await callClaudeAPI(
      systemPrompt,
      [{ role: 'user', content: userMessage }],
      config,
    );

    return NextResponse.json({ success: true, message: commitMsg.trim() });
  } catch (error: any) {
    console.error('[Git generate-commit-msg]', error);
    return NextResponse.json(
      { error: error.message || '生成提交信息失败' },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

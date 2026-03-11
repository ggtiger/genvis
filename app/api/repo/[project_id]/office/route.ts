/**
 * /api/repo/[project_id]/office
 * Read and write Office documents (docx, xlsx, pptx)
 *
 * GET  ?path=xxx           → returns JSON with parsed content
 * POST { path, content }   → saves edited content back to file
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getProjectById } from '@/lib/services/project';
import { FileBrowserError } from '@/lib/services/file-browser';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

async function resolveProjectFilePath(projectId: string, filePath: string): Promise<string> {
  const project = await getProjectById(projectId);
  if (!project) throw new FileBrowserError('Project not found', 404);

  let repoRoot: string;
  if ((project as any).work_directory) {
    repoRoot = path.resolve((project as any).work_directory);
  } else {
    const repoPath = project.repoPath || path.join('data', 'projects', project.id);
    repoRoot = path.isAbsolute(repoPath) ? repoPath : path.resolve(process.cwd(), repoPath);
  }

  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.?\/?/, '');
  const absolutePath = path.resolve(repoRoot, normalizedPath);

  if (!absolutePath.startsWith(repoRoot + path.sep) && absolutePath !== repoRoot) {
    throw new FileBrowserError('Path traversal not allowed', 400);
  }

  return absolutePath;
}

const MIME_TYPES: Record<string, string> = {
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { project_id } = await context.params;
    const filePath = request.nextUrl.searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
    }

    let absolutePath: string;
    try {
      absolutePath = await resolveProjectFilePath(project_id, filePath);
    } catch (err) {
      if (err instanceof FileBrowserError) {
        if (err.status === 404) {
          return NextResponse.json({ error: '项目不存在' }, { status: 404 });
        }
        return NextResponse.json({ error: '路径不合法' }, { status: 400 });
      }
      throw err;
    }

    try {
      const buffer = await fs.readFile(absolutePath);
      const ext = path.extname(absolutePath).toLowerCase();
      const fileName = path.basename(absolutePath);

      return NextResponse.json({
        content: buffer.toString('base64'),
        fileName,
        fileSize: buffer.length,
        mimeType: MIME_TYPES[ext] || 'application/octet-stream',
      });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return NextResponse.json({ error: '文件不存在' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `文件操作失败: ${err.message}` },
        { status: 500 }
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: `文件操作失败: ${err.message}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { project_id } = await context.params;
    const body = await request.json();
    const { path: filePath, content } = body;

    if (!filePath || content === undefined || content === null) {
      return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
    }

    let absolutePath: string;
    try {
      absolutePath = await resolveProjectFilePath(project_id, filePath);
    } catch (err) {
      if (err instanceof FileBrowserError) {
        if (err.status === 404) {
          return NextResponse.json({ error: '项目不存在' }, { status: 404 });
        }
        return NextResponse.json({ error: '路径不合法' }, { status: 400 });
      }
      throw err;
    }

    try {
      const buffer = Buffer.from(content, 'base64');
      await fs.writeFile(absolutePath, buffer);
      return NextResponse.json({ success: true });
    } catch (err: any) {
      return NextResponse.json(
        { error: `文件操作失败: ${err.message}` },
        { status: 500 }
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: `文件操作失败: ${err.message}` },
      { status: 500 }
    );
  }
}

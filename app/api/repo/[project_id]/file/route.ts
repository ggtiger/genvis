/**
 * /api/repo/[project_id]/file
 * Retrieve and update file content
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import {
  readProjectFileContent,
  writeProjectFileContent,
  FileBrowserError,
} from '@/lib/services/file-browser';
import { getProjectById } from '@/lib/services/project';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

// Infer content type from file extension
function inferContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    // Images
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    // Videos
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    // PDF
    '.pdf': 'application/pdf',
    // Office Documents
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    // Text
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.md': 'text/markdown',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Resolve safe file path within project
async function resolveProjectFilePath(
  projectId: string,
  filePath: string
): Promise<string> {
  const project = await getProjectById(projectId);
  if (!project) {
    throw new FileBrowserError('Project not found', 404);
  }

  // Get repo root
  let repoRoot: string;
  if ((project as any).work_directory) {
    repoRoot = path.resolve((project as any).work_directory);
  } else {
    const repoPath = project.repoPath || path.join('data', 'projects', project.id);
    repoRoot = path.isAbsolute(repoPath) ? repoPath : path.resolve(process.cwd(), repoPath);
  }

  // Normalize and resolve path
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.?\/?/, '');
  const absolutePath = path.resolve(repoRoot, normalizedPath);

  // Security check: ensure path is within repo root
  if (!absolutePath.startsWith(repoRoot + path.sep) && absolutePath !== repoRoot) {
    throw new FileBrowserError('Path traversal not allowed', 400);
  }

  return absolutePath;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');
    const raw = searchParams.get('raw') === 'true';

    console.log('[API GET] 收到请求:', { project_id, filePath, raw });

    if (!filePath) {
      return NextResponse.json(
        { error: 'path query parameter is required' },
        { status: 400 }
      );
    }

    // Raw mode: return binary file directly
    if (raw) {
      const absolutePath = await resolveProjectFilePath(project_id, filePath);
      console.log('[API GET] 解析绝对路径:', absolutePath);

      // Check file exists
      let stats;
      try {
        stats = await fs.stat(absolutePath);
        console.log('[API GET] 文件状态:', { isFile: stats.isFile(), size: stats.size });
      } catch (err) {
        console.error('[API GET] 文件状态检查失败:', err);
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      if (!stats.isFile()) {
        console.error('[API GET] 不是文件:', absolutePath);
        return NextResponse.json({ error: 'Not a file' }, { status: 400 });
      }

      // Read file as binary
      const fileBuffer = await fs.readFile(absolutePath);
      const contentType = inferContentType(absolutePath);

      const response = new NextResponse(fileBuffer as unknown as BodyInit);
      response.headers.set('Content-Type', contentType);
      response.headers.set('Content-Length', stats.size.toString());
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }

    // Text mode: return JSON with content
    const file = await readProjectFileContent(project_id, filePath);
    const response = NextResponse.json(file);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof FileBrowserError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error('[API] Failed to read file:', error);
    return NextResponse.json(
      { error: 'Failed to read file' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const body = await request.json();
    const path = body?.path;
    const content = body?.content;
    const encoding = body?.encoding; // 'base64' | 'utf8' | undefined

    console.log('[API PUT] 接收到保存请求:', {
      project_id,
      path,
      encoding,
      contentLength: content?.length || 0,
    });

    if (!path || typeof path !== 'string') {
      return NextResponse.json(
        { error: 'path is required' },
        { status: 400 }
      );
    }

    if (typeof content !== 'string') {
      return NextResponse.json(
        { error: 'content must be a string' },
        { status: 400 }
      );
    }

    // 如果是 base64 编码，直接写入二进制数据
    if (encoding === 'base64') {
      console.log('[API PUT] 使用 base64 模式保存');
      try {
        const absolutePath = await resolveProjectFilePath(project_id, path);
        console.log('[API PUT] 解析绝对路径:', absolutePath);
        
        const buffer = Buffer.from(content, 'base64');
        console.log('[API PUT] Buffer 长度:', buffer.length);
        
        await fs.writeFile(absolutePath, buffer);
        console.log('[API PUT] 文件写入成功');
        
        // 验证文件是否真的写入了
        const stats = await fs.stat(absolutePath);
        console.log('[API PUT] 文件验证:', { size: stats.size, path: absolutePath });
        
        return NextResponse.json({ success: true, path, fileSize: stats.size });
      } catch (error) {
        console.error('[API PUT] base64 保存失败:', error);
        throw error;
      }
    }

    // 否则使用原有的文本写入逻辑
    console.log('[API PUT] 使用文本模式保存');
    await writeProjectFileContent(project_id, path, content);
    return NextResponse.json({ success: true, path });
  } catch (error) {
    if (error instanceof FileBrowserError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error('[API] Failed to write file:', error);
    return NextResponse.json(
      { error: 'Failed to write file' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

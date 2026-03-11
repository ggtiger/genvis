/**
 * /api/repo/[project_id]/files
 * File management operations: mkdir, delete, rename/move, upload, create file
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getProjectById } from '@/lib/services/project';
import { isOfficeOrPdf, addContextFile } from '@/lib/services/context-files';

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

function safePath(root: string, rel: string): string {
  const abs = path.resolve(root, rel.replace(/\\/g, '/').replace(/^\.?\/?/, ''));
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error('Path traversal not allowed');
  }
  return abs;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const root = await resolveProjectRoot(project_id);
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'mkdir': {
        const abs = safePath(root, body.path);
        await fs.mkdir(abs, { recursive: true });
        return NextResponse.json({ success: true });
      }

      case 'createFile': {
        const abs = safePath(root, body.path);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, body.content || '', 'utf-8');
        // Auto-record Office/PDF to context
        if (isOfficeOrPdf(body.path)) {
          try { const stat = await fs.stat(abs); await addContextFile({ name: path.basename(body.path), absolutePath: abs, mimeType: '', size: stat.size }); } catch { /* non-critical */ }
        }
        return NextResponse.json({ success: true });
      }

      case 'delete': {
        const abs = safePath(root, body.path);
        const stat = await fs.stat(abs);
        if (stat.isDirectory()) {
          await fs.rm(abs, { recursive: true, force: true });
        } else {
          await fs.unlink(abs);
        }
        return NextResponse.json({ success: true });
      }

      case 'rename': {
        const oldAbs = safePath(root, body.oldPath);
        const newAbs = safePath(root, body.newPath);
        await fs.mkdir(path.dirname(newAbs), { recursive: true });
        await fs.rename(oldAbs, newAbs);
        return NextResponse.json({ success: true });
      }

      case 'move': {
        const src = safePath(root, body.sourcePath);
        const destDir = safePath(root, body.destDir);
        const fileName = path.basename(src);
        const dest = path.join(destDir, fileName);
        await fs.mkdir(destDir, { recursive: true });
        await fs.rename(src, dest);
        return NextResponse.json({ success: true });
      }

      case 'copy': {
        const src = safePath(root, body.sourcePath);
        const dest = safePath(root, body.destPath);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const stat = await fs.stat(src);
        if (stat.isDirectory()) {
          await fs.cp(src, dest, { recursive: true });
        } else {
          await fs.copyFile(src, dest);
        }
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error('[File ops]', error);
    return NextResponse.json(
      { error: error.message || 'File operation failed' },
      { status: error.message?.includes('not found') ? 404 : 500 }
    );
  }
}

// Upload files via multipart form data
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const root = await resolveProjectRoot(project_id);
    const formData = await request.formData();
    const dir = (formData.get('dir') as string) || '.';
    const files = formData.getAll('files') as File[];

    if (!files.length) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const results: string[] = [];
    for (const file of files) {
      const relPath = dir === '.' ? file.name : `${dir}/${file.name}`;
      const abs = safePath(root, relPath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(abs, buffer);
      results.push(relPath);
      // Auto-record Office/PDF to context
      if (isOfficeOrPdf(file.name)) {
        try { await addContextFile({ name: file.name, absolutePath: abs, mimeType: file.type, size: file.size }); } catch { /* non-critical */ }
      }
    }

    return NextResponse.json({ success: true, files: results });
  } catch (error: any) {
    console.error('[File upload]', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

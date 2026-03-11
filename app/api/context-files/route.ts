/**
 * /api/context-files
 * GET  — list all context files
 * POST — add a new context file record
 * DELETE — remove a record (body: { id })
 * PATCH — toggle pin (body: { id })
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import {
  listContextFiles,
  addContextFile,
  removeContextFile,
  togglePinContextFile,
} from '@/lib/services/context-files';
import { getProjectById } from '@/lib/services/project';

export async function GET() {
  try {
    const files = await listContextFiles();
    return NextResponse.json({ success: true, files });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { name, absolutePath, mimeType, size } = body;
    const { projectId, relativePath } = body;

    // Resolve absolutePath from projectId + relativePath if not provided directly
    if (!absolutePath && projectId && relativePath) {
      const project = await getProjectById(projectId);
      if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
      const root = (project as any).work_directory
        ? path.resolve((project as any).work_directory)
        : path.resolve(process.cwd(), project.repoPath || path.join('data', 'projects', project.id));
      absolutePath = path.resolve(root, relativePath);
      if (!name) name = path.basename(relativePath);
      // Get file size if not provided
      if (!size) {
        try { const stat = await fs.stat(absolutePath); size = stat.size; } catch { size = 0; }
      }
    }

    if (!name || !absolutePath) {
      return NextResponse.json({ success: false, error: 'name and absolutePath (or projectId+relativePath) required' }, { status: 400 });
    }
    const record = await addContextFile({ name, absolutePath, mimeType: mimeType || '', size: size || 0 });
    return NextResponse.json({ success: true, file: record });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const ok = await removeContextFile(body.id);
    return NextResponse.json({ success: ok });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const ok = await togglePinContextFile(body.id);
    return NextResponse.json({ success: ok });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

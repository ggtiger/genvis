import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECTS_DIR_ABSOLUTE } from '@/lib/config/paths';

const SECRETARY_UPLOADS_DIR = path.join(process.cwd(), 'data', 'secretary-uploads');

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

interface CopyRequest {
  files: Array<{
    filename: string;
    originalName: string;
    absolutePath?: string;
  }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const body: CopyRequest = await request.json();

    if (!body.files || body.files.length === 0) {
      return NextResponse.json({ success: true, copied: 0 });
    }

    // Target: project's assets directory
    const projectAssetsDir = path.join(PROJECTS_DIR_ABSOLUTE, project_id, 'assets');
    await fs.mkdir(projectAssetsDir, { recursive: true });

    const results: Array<{ name: string; projectPath: string }> = [];

    for (const file of body.files) {
      try {
        // Determine source path
        const sourcePath = file.absolutePath || path.join(SECRETARY_UPLOADS_DIR, file.filename);

        // Verify source exists
        await fs.access(sourcePath);

        // Copy to project assets with original name
        const destPath = path.join(projectAssetsDir, file.originalName);
        await fs.copyFile(sourcePath, destPath);

        results.push({ name: file.originalName, projectPath: destPath });
      } catch (err) {
        console.warn(`[CopyFromSecretary] Failed to copy ${file.originalName}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      copied: results.length,
      files: results,
    });
  } catch (error) {
    console.error('[CopyFromSecretary] Failed:', error);
    return NextResponse.json(
      { success: false, error: 'Copy failed' },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

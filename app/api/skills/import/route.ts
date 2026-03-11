/**
 * POST /api/skills/import - Import skill from uploaded zip file
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { importSkill } from '@/lib/services/skill-service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file uploaded' },
        { status: 400 }
      );
    }

    if (!file.name.endsWith('.zip')) {
      return NextResponse.json(
        { success: false, error: 'Only .zip files are supported' },
        { status: 400 }
      );
    }

    // Save to temp file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    tempFilePath = path.join(os.tmpdir(), `skill-import-${Date.now()}.zip`);
    await fs.writeFile(tempFilePath, buffer);

    // Import skill using existing service
    const skill = await importSkill(tempFilePath);

    return NextResponse.json({
      success: true,
      data: skill,
    });
  } catch (error) {
    console.error('[Skills Import API] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    );
  } finally {
    // Cleanup temp file
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  }
}

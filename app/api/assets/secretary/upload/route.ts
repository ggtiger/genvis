import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { isOfficeOrPdf, addContextFile } from '@/lib/services/context-files';

const SECRETARY_UPLOADS_DIR = path.join(process.cwd(), 'data', 'secretary-uploads');

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'File field is required' }, { status: 400 });
    }

    // Create secretary uploads directory
    await fs.mkdir(SECRETARY_UPLOADS_DIR, { recursive: true });

    const originalName = file.name || 'file';
    const extension = path.extname(originalName) || '';
    const uniqueName = `${randomUUID()}${extension}`;
    const absolutePath = path.join(SECRETARY_UPLOADS_DIR, uniqueName);

    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(absolutePath, Buffer.from(arrayBuffer));

    // Also copy to public/uploads for web access
    let publicUrl: string | null = null;
    try {
      const publicDir = path.join(process.cwd(), 'public', 'uploads');
      await fs.mkdir(publicDir, { recursive: true });
      const publicPath = path.join(publicDir, uniqueName);
      await fs.copyFile(absolutePath, publicPath);
      publicUrl = `/uploads/${uniqueName}`;
    } catch {
      // fallback: no public URL
    }

    // For images, generate base64 data URL for inline display
    let base64: string | undefined;
    if (file.type.startsWith('image/')) {
      const buf = Buffer.from(arrayBuffer);
      base64 = `data:${file.type};base64,${buf.toString('base64')}`;
    }

    // Auto-record Office/PDF files to context
    if (isOfficeOrPdf(originalName)) {
      try { await addContextFile({ name: originalName, absolutePath, mimeType: file.type, size: file.size }); } catch { /* non-critical */ }
    }

    return NextResponse.json({
      success: true,
      filename: uniqueName,
      originalName,
      absolutePath,
      publicUrl,
      base64,
      mimeType: file.type,
      size: file.size,
    });
  } catch (error) {
    console.error('[Secretary Upload] Failed:', error);
    return NextResponse.json(
      { success: false, error: 'Upload failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

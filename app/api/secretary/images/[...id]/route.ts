/**
 * Image File API Route
 *
 * Serves stored image files for secretary messages.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getImageDir } from '@/lib/services/image/image-storage';

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string[] }> }
) {
  try {
    const { id } = await params;
    const fileName = id.join('/');

    if (!fileName) {
      return NextResponse.json({ error: 'Image ID required' }, { status: 400 });
    }

    const imageDir = getImageDir();
    const filePath = path.join(imageDir, fileName);

    // Security check: ensure the path is within image directory
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(imageDir)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({ error: 'Image file not found' }, { status: 404 });
    }

    const stat = fs.statSync(resolvedPath);
    const ext = path.extname(resolvedPath).slice(1).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'image/jpeg';

    // Full file response
    const fileBuffer = fs.readFileSync(resolvedPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('[ImageAPI] Error serving image file:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

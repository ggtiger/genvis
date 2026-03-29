import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_TYPES));

/**
 * GET /api/local-file?path=/absolute/path/to/image.png
 * Serves local image files for inline preview in the chat panel.
 * Only allows image file types for security.
 */
export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');

  if (!filePath) {
    return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
  }

  // Security: only allow absolute paths
  if (!path.isAbsolute(filePath)) {
    return NextResponse.json({ error: 'Path must be absolute' }, { status: 400 });
  }

  // Security: only allow image file extensions
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: 'Only image files are allowed' }, { status: 403 });
  }

  // Security: prevent path traversal
  const resolved = path.resolve(filePath);
  if (resolved !== filePath) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    const buffer = fs.readFileSync(resolved);
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[local-file] Failed to serve file:', error);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}

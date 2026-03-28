/**
 * File Attachment API Route
 *
 * Serves stored file attachments for secretary messages.
 * Supports download with original filename.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getFileDir } from '@/lib/services/file/file-storage';

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  js: 'application/javascript',
  ts: 'application/typescript',
  py: 'text/x-python',
  java: 'text/x-java-source',
  md: 'text/markdown',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string[] }> }
) {
  try {
    const { id } = await params;
    const fileName = id.join('/');

    if (!fileName) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 });
    }

    const fileDir = getFileDir();
    const filePath = path.join(fileDir, fileName);

    // Security check: ensure the path is within file directory
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(fileDir)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stat = fs.statSync(resolvedPath);
    const ext = path.extname(resolvedPath).slice(1).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Extract original filename (after UUID_)
    const originalName = fileName.includes('_') ? fileName.substring(fileName.indexOf('_') + 1) : fileName;

    // Read file
    const fileBuffer = fs.readFileSync(resolvedPath);
    
    // Check if download is requested
    const download = request.nextUrl.searchParams.get('download');
    
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=31536000',
    };

    if (download === 'true') {
      headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`;
    }

    return new NextResponse(fileBuffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('[FileAPI] Error serving file:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

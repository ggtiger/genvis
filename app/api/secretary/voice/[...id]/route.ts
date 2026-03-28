/**
 * Voice File API Route
 *
 * Serves stored voice files for secretary messages.
 * Supports range requests for audio streaming.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getVoiceDir } from '@/lib/services/voice/voice-storage';

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  webm: 'audio/webm',
  amr: 'audio/amr',
  silk: 'audio/silk',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string[] }> }
) {
  try {
    const { id } = await params;
    const fileName = id.join('/');

    if (!fileName) {
      return NextResponse.json({ error: 'Voice ID required' }, { status: 400 });
    }

    const voiceDir = getVoiceDir();
    const filePath = path.join(voiceDir, fileName);

    // Security check: ensure the path is within voice directory
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(voiceDir)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({ error: 'Voice file not found' }, { status: 404 });
    }

    const stat = fs.statSync(resolvedPath);
    const ext = path.extname(resolvedPath).slice(1).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Handle range request for audio streaming
    const range = request.headers.get('range');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      const fileHandle = fs.openSync(resolvedPath, 'r');
      const buffer = Buffer.alloc(chunkSize);
      fs.readSync(fileHandle, buffer, 0, chunkSize, start);
      fs.closeSync(fileHandle);

      return new NextResponse(buffer, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    // Full file response
    const fileBuffer = fs.readFileSync(resolvedPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('[VoiceAPI] Error serving voice file:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

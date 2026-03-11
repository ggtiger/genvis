/**
 * GET /api/lan-peer/files/[fileId]
 * Download a received file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReceivedFilePath } from '@/lib/services/lan-peer/file-transfer';
import fs from 'fs/promises';
import path from 'path';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const filePath = await getReceivedFilePath(fileId);
  if (!filePath) {
    return NextResponse.json({ success: false, error: '文件不存在' }, { status: 404 });
  }

  const data = await fs.readFile(filePath);
  const name = path.basename(filePath).replace(/^[^_]+_/, ''); // strip UUID prefix

  return new NextResponse(data, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}

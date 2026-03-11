/**
 * POST /api/lan-peer/files/upload
 * Receives a file from a remote peer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { receiveFile } from '@/lib/services/lan-peer/file-transfer';
import type { FileTransferInfo } from '@/lib/services/lan-peer/types';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    const fileInfoStr = formData.get('fileInfo') as string | null;

    if (!file || !fileInfoStr) {
      return NextResponse.json({ success: false, error: '缺少文件或文件信息' }, { status: 400 });
    }

    const fileInfo: FileTransferInfo = JSON.parse(fileInfoStr);
    const buffer = Buffer.from(await file.arrayBuffer());
    const localPath = await receiveFile(fileInfo, buffer);

    return NextResponse.json({
      success: true,
      data: { fileId: fileInfo.id, localPath, name: fileInfo.name },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '文件接收失败';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

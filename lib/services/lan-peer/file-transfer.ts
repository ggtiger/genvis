/**
 * LAN Peer Chat — File Transfer Service
 *
 * Handles file sending/receiving between peers via HTTP.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { FileTransferInfo } from './types';

const RECEIVE_DIR = path.join(process.cwd(), 'data', 'lan-peer', 'files');
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

async function ensureReceiveDir(): Promise<void> {
  await fs.mkdir(RECEIVE_DIR, { recursive: true });
}

/**
 * Build a FileTransferInfo for a local file about to be sent.
 */
export async function prepareFileForSend(
  filePath: string,
  senderId: string,
  senderName: string,
): Promise<FileTransferInfo> {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`文件大小超过限制 (${(stat.size / 1024 / 1024).toFixed(1)}MB > 100MB)`);
  }

  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  const mimeType = guessMimeType(ext);

  return {
    id: randomUUID(),
    name,
    mimeType,
    size: stat.size,
    senderId,
    senderName,
    status: 'pending',
    progress: 0,
  };
}

/**
 * Send a file to a remote peer via HTTP POST.
 */
export async function sendFileToPeer(
  filePath: string,
  fileInfo: FileTransferInfo,
  targetIp: string,
  targetHttpPort: number,
): Promise<void> {
  const data = await fs.readFile(filePath);
  const url = `http://${targetIp}:${targetHttpPort}/api/lan-peer/files/upload`;

  const formData = new FormData();
  formData.append('file', new Blob([data], { type: fileInfo.mimeType }), fileInfo.name);
  formData.append('fileInfo', JSON.stringify(fileInfo));

  const res = await fetch(url, { method: 'POST', body: formData });
  if (!res.ok) {
    throw new Error(`文件传输失败: ${res.status}`);
  }
}

/**
 * Receive and save a file from a remote peer.
 * Returns the local file path.
 */
export async function receiveFile(
  fileInfo: FileTransferInfo,
  data: Buffer,
): Promise<string> {
  await ensureReceiveDir();
  // Use fileId + original name to avoid collisions
  const safeName = `${fileInfo.id}_${fileInfo.name}`;
  const filePath = path.join(RECEIVE_DIR, safeName);
  await fs.writeFile(filePath, data);
  return filePath;
}

/**
 * Get the local path for a received file by ID.
 */
export async function getReceivedFilePath(fileId: string): Promise<string | null> {
  await ensureReceiveDir();
  const entries = await fs.readdir(RECEIVE_DIR);
  const match = entries.find((e) => e.startsWith(fileId));
  return match ? path.join(RECEIVE_DIR, match) : null;
}

function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip', '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json', '.csv': 'text/csv',
  };
  return map[ext] || 'application/octet-stream';
}

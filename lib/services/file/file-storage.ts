/**
 * File Storage Service
 *
 * Handles downloading, decrypting, and storing file attachments.
 * Supports AES decryption for WeChat ilink encrypted files.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID, createDecipheriv } from 'crypto';
import https from 'https';
import http from 'http';

// ========== Types ==========

export interface FileInfo {
  id: string;
  localPath: string;
  url: string;
  fileName: string;
  fileType: string;
  size: number;
  mimeType: string;
}

export interface FileDownloadResult {
  success: boolean;
  fileInfo?: FileInfo;
  error?: string;
}

export interface FileDownloadOptions {
  fileUrl: string;
  fileName?: string;
  size?: number;
  /** AES key for decryption (base64) - WeChat ilink encrypted file */
  aesKey?: string;
  fileType?: string;
}

// ========== Constants ==========

const FILE_DIR = path.join(process.env.SETTINGS_DIR || path.join(process.cwd(), 'data'), 'secretary-uploads', 'files');

// MIME type mapping
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

// ========== Public API ==========

/**
 * Ensure file directory exists
 */
export async function ensureFileDir(): Promise<string> {
  await fs.mkdir(FILE_DIR, { recursive: true });
  return FILE_DIR;
}

/**
 * Download file from URL and save locally.
 * Supports AES decryption for encrypted files (WeChat ilink).
 */
export async function downloadAndStoreFile(
  options: FileDownloadOptions
): Promise<FileDownloadResult> {
  const { fileUrl, fileName = 'unknown', size, aesKey, fileType } = options;
  
  try {
    await ensureFileDir();

    const fileId = randomUUID();
    // Extract extension from filename or use provided fileType
    const ext = fileType || fileName.split('.').pop()?.toLowerCase() || 'bin';
    const safeFileName = `${fileId}_${sanitizeFileName(fileName)}`;
    const localPath = path.join(FILE_DIR, safeFileName);

    // Download the file
    console.log(`[FileStorage] Downloading file from: ${fileUrl.substring(0, 100)}...`);
    let buffer = await downloadFile(fileUrl);
    console.log(`[FileStorage] Downloaded ${buffer.length} bytes`);

    // Decrypt if AES key provided (WeChat ilink encrypted file)
    if (aesKey) {
      console.log(`[FileStorage] Decrypting file with AES key...`);
      buffer = decryptAes(buffer, aesKey);
      console.log(`[FileStorage] Decrypted to ${buffer.length} bytes`);
    }

    // Save the file
    await fs.writeFile(localPath, buffer);

    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    return {
      success: true,
      fileInfo: {
        id: fileId,
        localPath,
        url: `/api/secretary/files/${safeFileName}`,
        fileName,
        fileType: ext,
        size: buffer.length,
        mimeType,
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[FileStorage] Download and store file failed:', errMsg);
    return {
      success: false,
      error: errMsg,
    };
  }
}

/**
 * Get file by ID or filename
 */
export async function getFile(fileNameOrId: string): Promise<Buffer | null> {
  try {
    const files = await fs.readdir(FILE_DIR);
    const targetFile = files.find(f => f.includes(fileNameOrId));

    if (!targetFile) {
      return null;
    }

    const filePath = path.join(FILE_DIR, targetFile);
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Get file directory path
 */
export function getFileDir(): string {
  return FILE_DIR;
}

/**
 * Clean up old files (older than specified days)
 */
export async function cleanupOldFiles(daysToKeep: number = 30): Promise<number> {
  try {
    await ensureFileDir();
    const files = await fs.readdir(FILE_DIR);
    const now = Date.now();
    const cutoffTime = now - daysToKeep * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(FILE_DIR, file);
      try {
        const stats = await fs.stat(filePath);
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      } catch {
        // Ignore files we can't stat or delete
      }
    }

    if (deletedCount > 0) {
      console.log(`[FileStorage] Cleaned up ${deletedCount} old files`);
    }

    return deletedCount;
  } catch (error) {
    console.error('[FileStorage] Cleanup failed:', error);
    return 0;
  }
}

// ========== Internal Helpers ==========

/**
 * Sanitize filename to prevent path traversal
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\.{2,}/g, '_')
    .substring(0, 100);
}

/**
 * Parse aes_key from CDNMedia into a raw 16-byte Buffer.
 * Two encodings exist in WeChat ilink:
 *   - base64(raw 16 bytes) → images
 *   - base64(hex string of 16 bytes) → file/voice/video
 */
function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, 'base64');
  if (decoded.length === 16) {
    // Images: base64 decodes directly to 16 raw bytes
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    // Voice/file/video: base64 decodes to 32 hex chars, then hex to 16 bytes
    return Buffer.from(decoded.toString('ascii'), 'hex');
  }
  throw new Error(`Invalid aes_key: expected 16 raw bytes or 32 hex chars, got ${decoded.length} bytes`);
}

/**
 * Decrypt AES-128-ECB encrypted file data (WeChat ilink format)
 * No IV needed for ECB mode
 */
function decryptAes(encryptedBuffer: Buffer, aesKeyBase64: string): Buffer {
  const key = parseAesKey(aesKeyBase64);

  const decipher = createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(true); // PKCS7 padding

  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ]);

  return decrypted;
}

/**
 * Download file from URL with redirect support and proper headers
 */
function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity', // Disable compression for binary files
      },
    };

    protocol.get(url, options, (response) => {
      // Handle redirects (301, 302, 307, 308)
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          console.log(`[FileStorage] Following redirect to: ${redirectUrl}`);
          downloadFile(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode && response.statusCode >= 400) {
        const errorMsg = `HTTP ${response.statusCode} - ${response.statusMessage}`;
        console.error(`[FileStorage] Download failed: ${errorMsg} for URL: ${url}`);
        reject(new Error(errorMsg));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`[FileStorage] Downloaded ${buffer.length} bytes from ${url.substring(0, 80)}...`);
        resolve(buffer);
      });
      response.on('error', (err) => {
        console.error(`[FileStorage] Download error:`, err);
        reject(err);
      });
    }).on('error', (err) => {
      console.error(`[FileStorage] Request error:`, err);
      reject(err);
    });
  });
}

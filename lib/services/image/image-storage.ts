/**
 * Image Storage Service
 *
 * Handles downloading, decrypting, and storing image messages.
 * Supports AES decryption for WeChat ilink encrypted images.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID, createDecipheriv } from 'crypto';
import https from 'https';
import http from 'http';

// ========== Types ==========

export interface ImageInfo {
  id: string;
  localPath: string;
  url: string;
  width?: number;
  height?: number;
  format: string;
  size: number;
}

export interface ImageDownloadResult {
  success: boolean;
  imageInfo?: ImageInfo;
  error?: string;
}

export interface ImageDownloadOptions {
  imageUrl: string;
  width?: number;
  height?: number;
  size?: number;
  /** AES key for decryption (base64) - WeChat ilink encrypted image */
  aesKey?: string;
  format?: string;
}

// ========== Constants ==========

const IMAGE_DIR = path.join(process.env.SETTINGS_DIR || path.join(process.cwd(), 'data'), 'secretary-uploads', 'images');

// ========== Public API ==========

/**
 * Ensure image directory exists
 */
export async function ensureImageDir(): Promise<string> {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  return IMAGE_DIR;
}

/**
 * Download image file from URL and save locally.
 * Supports AES decryption for encrypted images (WeChat ilink).
 */
export async function downloadAndStoreImage(
  options: ImageDownloadOptions
): Promise<ImageDownloadResult> {
  const { imageUrl, width, height, size, aesKey, format = 'jpg' } = options;
  
  try {
    await ensureImageDir();

    const imageId = randomUUID();
    const fileName = `${imageId}.${format}`;
    const localPath = path.join(IMAGE_DIR, fileName);

    // Download the image file
    console.log(`[ImageStorage] Downloading image from: ${imageUrl.substring(0, 100)}...`);
    let buffer = await downloadFile(imageUrl);
    console.log(`[ImageStorage] Downloaded ${buffer.length} bytes`);

    // Decrypt if AES key provided (WeChat ilink encrypted image)
    if (aesKey) {
      console.log(`[ImageStorage] Decrypting image with AES key...`);
      buffer = decryptAes(buffer, aesKey);
      console.log(`[ImageStorage] Decrypted to ${buffer.length} bytes`);
    }

    // Save the image file
    await fs.writeFile(localPath, buffer);

    return {
      success: true,
      imageInfo: {
        id: imageId,
        localPath,
        url: `/api/secretary/images/${fileName}`,
        width,
        height,
        format,
        size: buffer.length,
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[ImageStorage] Download and store image failed:', errMsg);
    return {
      success: false,
      error: errMsg,
    };
  }
}

/**
 * Get image file by ID
 */
export async function getImageFile(imageId: string): Promise<Buffer | null> {
  try {
    const files = await fs.readdir(IMAGE_DIR);
    const targetFile = files.find(f => f.startsWith(imageId));

    if (!targetFile) {
      return null;
    }

    const filePath = path.join(IMAGE_DIR, targetFile);
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Get image directory path
 */
export function getImageDir(): string {
  return IMAGE_DIR;
}

/**
 * Clean up old image files (older than specified days)
 */
export async function cleanupOldImageFiles(daysToKeep: number = 7): Promise<number> {
  try {
    await ensureImageDir();
    const files = await fs.readdir(IMAGE_DIR);
    const now = Date.now();
    const cutoffTime = now - daysToKeep * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(IMAGE_DIR, file);
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
      console.log(`[ImageStorage] Cleaned up ${deletedCount} old image files`);
    }

    return deletedCount;
  } catch (error) {
    console.error('[ImageStorage] Cleanup failed:', error);
    return 0;
  }
}

// ========== Internal Helpers ==========

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
 * Decrypt AES-128-ECB encrypted image data (WeChat ilink format)
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
        'Accept': 'image/*,*/*',
        'Accept-Encoding': 'identity', // Disable compression for binary files
      },
    };

    protocol.get(url, options, (response) => {
      // Handle redirects (301, 302, 307, 308)
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          console.log(`[ImageStorage] Following redirect to: ${redirectUrl}`);
          downloadFile(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode && response.statusCode >= 400) {
        const errorMsg = `HTTP ${response.statusCode} - ${response.statusMessage}`;
        console.error(`[ImageStorage] Download failed: ${errorMsg} for URL: ${url}`);
        reject(new Error(errorMsg));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`[ImageStorage] Downloaded ${buffer.length} bytes from ${url.substring(0, 80)}...`);
        resolve(buffer);
      });
      response.on('error', (err) => {
        console.error(`[ImageStorage] Download error:`, err);
        reject(err);
      });
    }).on('error', (err) => {
      console.error(`[ImageStorage] Request error:`, err);
      reject(err);
    });
  });
}

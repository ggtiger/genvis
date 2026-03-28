/**
 * Voice Storage Service
 *
 * Handles downloading, converting, and storing voice messages.
 * Supports multiple audio formats: silk, amr, mp3, webm, etc.
 * Supports AES decryption for WeChat ilink encrypted voice.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID, createDecipheriv } from 'crypto';
import https from 'https';
import http from 'http';

// ========== Types ==========

export interface VoiceInfo {
  id: string;
  localPath: string;
  url: string;
  duration: number;
  format: string;
  size: number;
  originalFormat?: string;
}

export interface VoiceDownloadResult {
  success: boolean;
  voiceInfo?: VoiceInfo;
  error?: string;
}

export interface VoiceDownloadOptions {
  voiceUrl: string;
  format?: string;
  duration?: number;
  /** AES key for decryption (base64) - WeChat ilink encrypted voice */
  aesKey?: string;
}

// ========== Constants ==========

const VOICE_DIR = path.join(process.env.SETTINGS_DIR || path.join(process.cwd(), 'data'), 'secretary-uploads', 'voice');

// ========== Public API ==========

/**
 * Ensure voice directory exists
 */
export async function ensureVoiceDir(): Promise<string> {
  await fs.mkdir(VOICE_DIR, { recursive: true });
  return VOICE_DIR;
}

/**
 * Download voice file from URL and save locally.
 * Converts silk/amr to mp3 for web compatibility.
 * Supports AES decryption for encrypted voice (WeChat ilink).
 */
export async function downloadAndStoreVoice(
  voiceUrlOrOptions: string | VoiceDownloadOptions,
  originalFormat: string = 'mp3',
  duration?: number
): Promise<VoiceDownloadResult> {
  // Support both old signature (string) and new signature (options object)
  const options: VoiceDownloadOptions = typeof voiceUrlOrOptions === 'string'
    ? { voiceUrl: voiceUrlOrOptions, format: originalFormat, duration }
    : voiceUrlOrOptions;

  const { voiceUrl, format = 'mp3', duration: voiceDuration, aesKey } = options;
  try {
    await ensureVoiceDir();

    const voiceId = randomUUID();
    const targetFormat = 'mp3'; // Always convert to mp3 for web compatibility
    const fileName = `${voiceId}.${targetFormat}`;
    const localPath = path.join(VOICE_DIR, fileName);

    // Download the voice file
    console.log(`[VoiceStorage] Downloading voice from: ${voiceUrl.substring(0, 100)}...`);
    let buffer = await downloadFile(voiceUrl);
    console.log(`[VoiceStorage] Downloaded ${buffer.length} bytes`);

    // Decrypt if AES key provided (WeChat ilink encrypted voice)
    if (aesKey) {
      console.log(`[VoiceStorage] Decrypting voice with AES key...`);
      buffer = decryptAes(buffer, aesKey);
      console.log(`[VoiceStorage] Decrypted to ${buffer.length} bytes`);
    }

    let finalBuffer = buffer;

    // Convert format if needed (silk, amr -> mp3)
    if (format !== 'mp3' && format !== 'webm') {
      try {
        finalBuffer = await convertToMp3(buffer, format);
      } catch (convertErr) {
        console.warn(`[VoiceStorage] Format conversion failed, using original:`, convertErr);
        // Save with original format if conversion fails
        const originalFileName = `${voiceId}.${format}`;
        const originalPath = path.join(VOICE_DIR, originalFileName);
        await fs.writeFile(originalPath, buffer);

        return {
          success: true,
          voiceInfo: {
            id: voiceId,
            localPath: originalPath,
            url: `/api/secretary/voice/${voiceId}.${format}`,
            duration: voiceDuration || 0,
            format: format,
            size: buffer.length,
            originalFormat: format,
          },
        };
      }
    }

    // Save the (possibly converted) file
    await fs.writeFile(localPath, finalBuffer);

    return {
      success: true,
      voiceInfo: {
        id: voiceId,
        localPath,
        url: `/api/secretary/voice/${fileName}`,
        duration: voiceDuration || 0,
        format: targetFormat,
        size: finalBuffer.length,
        originalFormat: format,
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[VoiceStorage] Download and store voice failed:', errMsg);
    return {
      success: false,
      error: errMsg,
    };
  }
}

/**
 * Get voice file by ID
 */
export async function getVoiceFile(voiceId: string): Promise<Buffer | null> {
  try {
    const files = await fs.readdir(VOICE_DIR);
    const targetFile = files.find(f => f.startsWith(voiceId));

    if (!targetFile) {
      return null;
    }

    const filePath = path.join(VOICE_DIR, targetFile);
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Get voice file path by ID
 */
export function getVoiceFilePath(voiceId: string): string | null {
  // This is synchronous for API route use
  const dir = VOICE_DIR;
  // Check common extensions
  const extensions = ['mp3', 'webm', 'amr', 'silk', 'm4a'];
  for (const ext of extensions) {
    const filePath = path.join(dir, `${voiceId}.${ext}`);
    // Note: This is a best-effort check, actual file existence should be verified by caller
    return filePath;
  }
  return null;
}

/**
 * Get voice directory path
 */
export function getVoiceDir(): string {
  return VOICE_DIR;
}

/**
 * Clean up old voice files (older than specified days)
 */
export async function cleanupOldVoiceFiles(daysToKeep: number = 7): Promise<number> {
  try {
    await ensureVoiceDir();
    const files = await fs.readdir(VOICE_DIR);
    const now = Date.now();
    const cutoffTime = now - daysToKeep * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(VOICE_DIR, file);
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
      console.log(`[VoiceStorage] Cleaned up ${deletedCount} old voice files`);
    }

    return deletedCount;
  } catch (error) {
    console.error('[VoiceStorage] Cleanup failed:', error);
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
 * Decrypt AES-128-ECB encrypted voice data (WeChat ilink format)
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
          console.log(`[VoiceStorage] Following redirect to: ${redirectUrl}`);
          downloadFile(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode && response.statusCode >= 400) {
        const errorMsg = `HTTP ${response.statusCode} - ${response.statusMessage}`;
        console.error(`[VoiceStorage] Download failed: ${errorMsg} for URL: ${url}`);
        reject(new Error(errorMsg));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`[VoiceStorage] Downloaded ${buffer.length} bytes from ${url.substring(0, 80)}...`);
        resolve(buffer);
      });
      response.on('error', (err) => {
        console.error(`[VoiceStorage] Download error:`, err);
        reject(err);
      });
    }).on('error', (err) => {
      console.error(`[VoiceStorage] Request error:`, err);
      reject(err);
    });
  });
}

/**
 * Convert audio format to mp3 using ffmpeg (if available)
 * Falls back to original buffer if ffmpeg is not available
 */
async function convertToMp3(buffer: Buffer, fromFormat: string): Promise<Buffer> {
  // Check if ffmpeg is available
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-f', fromFormat,
      '-f', 'mp3',
      '-ab', '128k',
      '-ar', '44100',
      '-ac', '1',
      'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    let errorOutput = '';

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code: number) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${errorOutput}`));
      }
    });

    ffmpeg.on('error', reject);

    // Write input buffer
    ffmpeg.stdin.write(buffer);
    ffmpeg.stdin.end();
  });
}

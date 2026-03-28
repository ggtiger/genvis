/**
 * ASR (Automatic Speech Recognition) Service
 *
 * Provides speech-to-text transcription using ASR Speech Recognition (Wanjie).
 * Supports async transcription with callback notification.
 */

import { randomUUID } from 'crypto';

// ========== Types ==========

export interface ASRConfig {
  /** ASR API endpoint */
  endpoint?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Language for recognition (default: zh-CN) */
  language?: string;
}

export interface ASRRequest {
  /** Voice file path or URL */
  voicePath: string;
  /** Audio format */
  format: string;
  /** Language (optional, uses config default) */
  language?: string;
  /** Callback URL for async result notification */
  callbackUrl?: string;
}

export interface ASRResult {
  success: boolean;
  /** Transcribed text */
  text?: string;
  /** Sentences with timestamps (if available) */
  sentences?: Array<{
    text: string;
    startTime: number;
    endTime: number;
  }>;
  /** Error message if failed */
  error?: string;
  /** Task ID for async queries */
  taskId?: string;
}

export interface ASRTaskStatus {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: ASRResult;
  createdAt: number;
}

// ========== Constants ==========

const DEFAULT_ENDPOINT = 'https://api.wanjie.ai/asr/v1/recognize';
const DEFAULT_LANGUAGE = 'zh-CN';

// In-memory task storage (for async queries)
const asrTasks = new Map<string, ASRTaskStatus>();

// ========== Public API ==========

/**
 * Get ASR configuration from environment or settings
 */
export function getASRConfig(): ASRConfig {
  return {
    endpoint: process.env.ASR_ENDPOINT || DEFAULT_ENDPOINT,
    apiKey: process.env.ASR_API_KEY,
    language: process.env.ASR_LANGUAGE || DEFAULT_LANGUAGE,
  };
}

/**
 * Check if ASR service is configured
 */
export function isASRConfigured(): boolean {
  const config = getASRConfig();
  return !!config.apiKey;
}

/**
 * Transcribe voice file to text (sync mode)
 */
export async function transcribeVoice(request: ASRRequest): Promise<ASRResult> {
  const config = getASRConfig();

  if (!config.apiKey) {
    return {
      success: false,
      error: 'ASR service not configured. Please set ASR_API_KEY environment variable.',
    };
  }

  const taskId = randomUUID();

  try {
    // Read voice file
    const fs = await import('fs/promises');
    const voiceBuffer = await fs.readFile(request.voicePath);

    // Call ASR API
    const response = await fetch(config.endpoint!, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/octet-stream',
        'X-Language': request.language || config.language || DEFAULT_LANGUAGE,
        'X-Format': request.format,
      },
      body: voiceBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `ASR API error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();

    // Parse response based on ASR provider format
    const result = parseASRResponse(data);

    return {
      success: true,
      taskId,
      ...result,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[ASRService] Transcription failed:', errMsg);
    return {
      success: false,
      error: errMsg,
      taskId,
    };
  }
}

/**
 * Submit async transcription task
 */
export async function submitAsyncTranscription(request: ASRRequest): Promise<string> {
  const taskId = randomUUID();

  // Store task status
  asrTasks.set(taskId, {
    taskId,
    status: 'pending',
    createdAt: Date.now(),
  });

  // Process in background
  processAsyncTranscription(taskId, request).catch((err) => {
    console.error(`[ASRService] Async task ${taskId} failed:`, err);
    const task = asrTasks.get(taskId);
    if (task) {
      task.status = 'failed';
      task.result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  return taskId;
}

/**
 * Query async transcription task status
 */
export function getASRTaskStatus(taskId: string): ASRTaskStatus | undefined {
  return asrTasks.get(taskId);
}

/**
 * Clean up old completed tasks (call periodically)
 */
export function cleanupOldTasks(maxAge: number = 24 * 60 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [taskId, task] of asrTasks.entries()) {
    if (
      (task.status === 'completed' || task.status === 'failed') &&
      now - task.createdAt > maxAge
    ) {
      asrTasks.delete(taskId);
      cleaned++;
    }
  }

  return cleaned;
}

// ========== Internal Helpers ==========

/**
 * Process async transcription in background
 */
async function processAsyncTranscription(taskId: string, request: ASRRequest): Promise<void> {
  const task = asrTasks.get(taskId);
  if (!task) return;

  task.status = 'processing';

  const result = await transcribeVoice(request);

  task.status = result.success ? 'completed' : 'failed';
  task.result = result;

  // If callback URL provided, notify the caller
  if (request.callbackUrl && result.success) {
    try {
      await fetch(request.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          status: task.status,
          result,
        }),
      });
    } catch (err) {
      console.warn(`[ASRService] Callback failed for task ${taskId}:`, err);
    }
  }
}

/**
 * Parse ASR API response (provider-specific format)
 */
function parseASRResponse(data: unknown): { text?: string; sentences?: ASRResult['sentences'] } {
  // Handle different ASR provider response formats
  if (!data || typeof data !== 'object') {
    return {};
  }

  const response = data as Record<string, unknown>;

  // Format 1: { text: "transcribed text" }
  if (typeof response.text === 'string') {
    return { text: response.text };
  }

  // Format 2: { result: { text: "..." } }
  if (response.result && typeof response.result === 'object') {
    const result = response.result as Record<string, unknown>;
    if (typeof result.text === 'string') {
      return { text: result.text, sentences: result.sentences as ASRResult['sentences'] };
    }
  }

  // Format 3: { data: { text: "..." } }
  if (response.data && typeof response.data === 'object') {
    const data = response.data as Record<string, unknown>;
    if (typeof data.text === 'string') {
      return { text: data.text, sentences: data.sentences as ASRResult['sentences'] };
    }
  }

  // Format 4: { sentences: [{ text, start, end }] }
  if (Array.isArray(response.sentences)) {
    const sentences = response.sentences as Array<{ text?: string; start?: number; end?: number }>;
    const fullText = sentences.map(s => s.text || '').join('');
    return {
      text: fullText,
      sentences: sentences.map(s => ({
        text: s.text || '',
        startTime: s.start || 0,
        endTime: s.end || 0,
      })),
    };
  }

  return {};
}

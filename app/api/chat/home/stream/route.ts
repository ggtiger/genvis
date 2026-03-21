/**
 * Secretary SSE Stream API
 * GET /api/chat/home/stream
 *
 * Provides real-time push for the secretary home page:
 * - dispatch task status (completed/failed/waiting_feedback)
 * - new IM messages
 * - dashboard refresh signals
 *
 * Replaces client-side polling in HomeChatPanel.
 */

import { NextRequest } from 'next/server';
import { secretaryStream } from '@/lib/services/secretary-stream';
import { MemoryScheduler } from '@/lib/services/memory-scheduler';
import { loadMemory } from '@/lib/services/secretary-memory';
import { startSecretaryScheduler, isSecretarySchedulerRunning } from '@/lib/services/secretary-scheduler';

// Singleton MemoryScheduler (stable across HMR)
const g = globalThis as unknown as { __memory_scheduler__?: MemoryScheduler };
const memoryScheduler: MemoryScheduler =
  g.__memory_scheduler__ ??
  (g.__memory_scheduler__ = new MemoryScheduler(
    loadMemory,
    (reminder) => {
      if (secretaryStream.connectionCount > 0) {
        secretaryStream.publish({
          type: 'memory_reminder',
          data: reminder as unknown as Record<string, unknown>,
        });
      } else {
        memoryScheduler.bufferReminder(reminder);
      }
    },
  ));

// Allow long-running SSE connections (Next.js serverless function timeout)
export const maxDuration = 300; // 5 minutes

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      let ctrl: ReadableStreamDefaultController | null = controller;
      const connectionId = secretaryStream.addConnection(controller);

      // Welcome message
      try {
        const welcome = `data: ${JSON.stringify({
          type: 'connected',
          data: { connectionId, timestamp: new Date().toISOString() },
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(welcome));
      } catch { /* ignore */ }

      // Start memory scheduler if not already running
      if (!memoryScheduler.isRunning) {
        memoryScheduler.start().catch(err =>
          console.warn('[Stream] Failed to start memory scheduler:', err),
        );
      }

      // Start secretary scheduled message scheduler
      if (!isSecretarySchedulerRunning()) {
        startSecretaryScheduler();
      }

      // Flush any buffered reminders to this new connection
      const buffered = memoryScheduler.flushBufferedReminders();
      for (const reminder of buffered) {
        try {
          const msg = `data: ${JSON.stringify({
            type: 'memory_reminder',
            data: reminder,
          })}\n\n`;
          controller.enqueue(new TextEncoder().encode(msg));
        } catch { /* ignore */ }
      }

      // Heartbeat every 8s using SSE comment lines + data event
      // SSE comment lines (": keepalive\n\n") keep the HTTP connection alive
      // even when proxies/frameworks have idle timeouts
      const heartbeat = setInterval(() => {
        try {
          // Send SSE comment (invisible to EventSource.onmessage) to keep connection alive
          controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
          // Also send a data event so the client knows the connection is healthy
          const msg = `data: ${JSON.stringify({
            type: 'heartbeat',
            data: { timestamp: new Date().toISOString(), connectionId },
          })}\n\n`;
          controller.enqueue(new TextEncoder().encode(msg));
        } catch {
          clearInterval(heartbeat);
        }
      }, 8_000);

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        if (ctrl) {
          secretaryStream.removeConnection(ctrl);
          ctrl = null;
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

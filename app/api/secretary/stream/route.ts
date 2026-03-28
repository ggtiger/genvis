/**
 * GET /api/secretary/stream
 * SSE endpoint for secretary chat real-time events.
 *
 * Pushes: new messages, AI streaming chunks, tool usage, errors, dispatch events.
 */

import { NextRequest } from 'next/server';
import { secretaryStream } from '@/lib/services/secretary-stream';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      let ctrl: ReadableStreamDefaultController | null = controller;

      // Register connection (addConnection returns connectionId)
      const connectionId = secretaryStream.addConnection(controller);

      // Send welcome event
      try {
        const welcome = `data: ${JSON.stringify({
          type: 'connected',
          data: { connectionId, timestamp: new Date().toISOString() },
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(welcome));
      } catch { /* ignore */ }

      // Heartbeat every 8 seconds using SSE comment lines + data event
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

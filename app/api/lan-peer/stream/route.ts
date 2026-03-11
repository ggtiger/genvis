/**
 * GET /api/lan-peer/stream
 * SSE endpoint for LAN peer chat real-time events.
 *
 * Pushes: new messages, peer status changes, group updates.
 * Reuses the same pattern as secretary-stream.
 */

import { NextRequest } from 'next/server';
import { lanPeerStream } from '@/lib/services/lan-peer/lan-peer-stream';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      let ctrl: ReadableStreamDefaultController | null = controller;
      const connectionId = lanPeerStream.addConnection(controller);

      // Welcome
      try {
        const welcome = `data: ${JSON.stringify({
          type: 'connected',
          data: { connectionId, timestamp: new Date().toISOString() },
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(welcome));
      } catch { /* ignore */ }

      // Heartbeat every 8s
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 8_000);

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        if (ctrl) {
          lanPeerStream.removeConnection(ctrl);
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

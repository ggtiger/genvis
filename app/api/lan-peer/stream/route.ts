/**
 * GET /api/lan-peer/stream
 * SSE endpoint for LAN peer chat real-time events.
 *
 * Pushes: new messages, peer status changes, group updates.
 * Reuses the same pattern as secretary-stream.
 */

import { NextRequest } from 'next/server';
import { lanPeerStream } from '@/lib/services/lan-peer/lan-peer-stream';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      let ctrl: ReadableStreamDefaultController | null = controller;
      const connectionId = lanPeerStream.addConnection(controller);

      // Welcome — include local peerId so frontend knows who "I" am
      try {
        const manager = getLanPeerManager();
        const localPeerId = manager?.peerId || (globalThis as any).__lan_peer_id__ || 'local';
        const welcome = `data: ${JSON.stringify({
          type: 'connected',
          data: { connectionId, localPeerId, timestamp: new Date().toISOString() },
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(welcome));
      } catch { /* ignore */ }

      // Send active AI stream states so reconnecting clients can restore streaming indicators
      try {
        const activeStreams = lanPeerStream.getActiveStreams();
        for (const [groupId, info] of activeStreams) {
          const resumeEvent = `data: ${JSON.stringify({
            type: 'ai_stream_start',
            data: { groupId, requestId: info.requestId, senderId: info.senderId, timestamp: info.startedAt, resumed: true },
          })}\n\n`;
          controller.enqueue(new TextEncoder().encode(resumeEvent));
        }
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

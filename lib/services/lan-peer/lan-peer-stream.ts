/**
 * LAN Peer Chat — SSE Stream Manager
 *
 * Manages SSE connections for the LAN chat page.
 * Same pattern as secretary-stream.ts.
 */

import { randomUUID } from 'crypto';

export interface LanPeerEvent {
  type: 'connected' | 'new_message' | 'peer_online' | 'peer_offline' | 'group_created' | 'group_updated';
  data: Record<string, unknown>;
}

class LanPeerStreamManager {
  private connections = new Set<ReadableStreamDefaultController>();

  addConnection(controller: ReadableStreamDefaultController): string {
    const id = randomUUID();
    this.connections.add(controller);
    return id;
  }

  removeConnection(controller: ReadableStreamDefaultController): void {
    this.connections.delete(controller);
  }

  publish(event: LanPeerEvent): void {
    if (this.connections.size === 0) return;
    const message = `data: ${JSON.stringify(event)}\n\n`;
    const encoded = new TextEncoder().encode(message);
    const dead: ReadableStreamDefaultController[] = [];
    for (const controller of this.connections) {
      try { controller.enqueue(encoded); } catch { dead.push(controller); }
    }
    for (const c of dead) this.removeConnection(c);
  }

  get connectionCount(): number {
    return this.connections.size;
  }
}

const g = globalThis as unknown as { __lan_peer_stream_mgr__?: LanPeerStreamManager };
export const lanPeerStream: LanPeerStreamManager =
  g.__lan_peer_stream_mgr__ ?? (g.__lan_peer_stream_mgr__ = new LanPeerStreamManager());

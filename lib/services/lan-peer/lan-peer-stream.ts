/**
 * LAN Peer Chat — SSE Stream Manager
 *
 * Manages SSE connections for the LAN chat page.
 * Same pattern as secretary-stream.ts.
 */

import { randomUUID } from 'crypto';

export interface LanPeerEvent {
  type: 'connected' | 'new_message' | 'peer_online' | 'peer_offline'
    | 'group_created' | 'group_updated'
    | 'ai_stream_start' | 'ai_stream_delta' | 'ai_stream_end'
    | 'ai_tool_use' | 'ai_tool_result'
    | 'group_deleted';
  data: Record<string, unknown>;
}

class LanPeerStreamManager {
  private connections = new Set<ReadableStreamDefaultController>();
  /** Currently active AI streams: groupId -> { requestId, startedAt, senderId, abortController } */
  private activeStreams = new Map<string, {
    requestId: string;
    startedAt: string;
    senderId: string;
    abortController: AbortController;
  }>();

  /**
   * Per-group broadcast callbacks.
   * When set, matching ai_stream_* events are forwarded to peers via WebSocket.
   */
  private broadcastCallbacks = new Map<string, (event: LanPeerEvent) => void>();

  /** Register a callback that will be invoked for ai_stream_* events of a specific group */
  setBroadcastCallback(groupId: string, fn: (event: LanPeerEvent) => void): void {
    this.broadcastCallbacks.set(groupId, fn);
  }

  /** Remove broadcast callback for a group */
  clearBroadcastCallback(groupId: string): void {
    this.broadcastCallbacks.delete(groupId);
  }

  addConnection(controller: ReadableStreamDefaultController): string {
    const id = randomUUID();
    this.connections.add(controller);
    return id;
  }

  removeConnection(controller: ReadableStreamDefaultController): void {
    this.connections.delete(controller);
  }

  publish(event: LanPeerEvent): void {
    // Push to local SSE clients
    if (this.connections.size > 0) {
      const message = `data: ${JSON.stringify(event)}\n\n`;
      const encoded = new TextEncoder().encode(message);
      const dead: ReadableStreamDefaultController[] = [];
      for (const controller of this.connections) {
        try { controller.enqueue(encoded); } catch { dead.push(controller); }
      }
      for (const c of dead) this.removeConnection(c);
    }

    // Forward ai_stream_* events to peers via registered broadcast callback
    const groupId = (event.data as any)?.groupId;
    if (groupId && event.type.startsWith('ai_stream_')) {
      const cb = this.broadcastCallbacks.get(groupId);
      if (cb) {
        try { cb(event); } catch (err) {
          console.error('[LanPeerStream] Broadcast callback error:', err);
        }
      }
    }
  }

  /** Mark a group as actively streaming AI content. Returns an AbortController for cancellation. */
  markStreamActive(groupId: string, requestId: string, senderId: string): AbortController {
    const abortController = new AbortController();
    this.activeStreams.set(groupId, { requestId, startedAt: new Date().toISOString(), senderId, abortController });
    return abortController;
  }

  /** Remove active stream marker for a group */
  markStreamDone(groupId: string): void {
    this.activeStreams.delete(groupId);
  }

  /** Abort an active AI stream. Only the original sender can abort. */
  abortStream(groupId: string, requesterId: string): { success: boolean; error?: string } {
    const stream = this.activeStreams.get(groupId);
    if (!stream) return { success: false, error: '没有正在进行的AI响应' };
    if (stream.senderId !== requesterId) return { success: false, error: '只能终止自己发送的消息' };
    stream.abortController.abort();
    return { success: true };
  }

  /** Get all currently active AI streams (for SSE reconnection) */
  getActiveStreams(): Map<string, { requestId: string; startedAt: string; senderId: string }> {
    return new Map(
      Array.from(this.activeStreams.entries()).map(([k, v]) => [k, { requestId: v.requestId, startedAt: v.startedAt, senderId: v.senderId }])
    );
  }

  get connectionCount(): number {
    return this.connections.size;
  }
}

const g = globalThis as unknown as { __lan_peer_stream_mgr__?: LanPeerStreamManager };
export const lanPeerStream: LanPeerStreamManager =
  g.__lan_peer_stream_mgr__ ?? (g.__lan_peer_stream_mgr__ = new LanPeerStreamManager());

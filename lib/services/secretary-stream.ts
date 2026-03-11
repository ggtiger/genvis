/**
 * Secretary SSE Stream Manager
 *
 * Manages SSE connections for the secretary home page.
 * Replaces client-side polling with server-push for:
 * - Dispatch task status updates (completed/failed/waiting_feedback)
 * - New messages from IM channels
 * - Dashboard refresh signals
 *
 * Uses a dedicated channel ID to avoid collision with project streams.
 */

import { randomUUID } from 'crypto';

export interface SecretaryEvent {
  type:
    | 'connected'
    | 'heartbeat'
    | 'dispatch_completed'
    | 'dispatch_failed'
    | 'dispatch_feedback'
    | 'new_message'
    | 'dashboard_refresh'
    | 'memory_reminder';
  data: Record<string, unknown>;
}

export class SecretaryStreamManager {
  private connections = new Set<ReadableStreamDefaultController>();
  private connectionIds = new WeakMap<ReadableStreamDefaultController, string>();
  /** 缓存在无连接时发布的重要事件，等客户端重连后推送 */
  bufferedEvents: SecretaryEvent[] = [];

  addConnection(controller: ReadableStreamDefaultController): string {
    const id = randomUUID();
    this.connections.add(controller);
    this.connectionIds.set(controller, id);
    if (this.connections.size === 1) {
      console.log(`[SecretaryStream] SSE 客户端已连接 (${id})`);
    }

    // 推送缓存的事件给新连接
    if (this.bufferedEvents.length > 0) {
      console.log(`[SecretaryStream] 推送 ${this.bufferedEvents.length} 条缓存事件给新连接`);
      for (const event of this.bufferedEvents) {
        try {
          const message = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(new TextEncoder().encode(message));
        } catch { /* ignore */ }
      }
      this.bufferedEvents = [];
    }

    return id;
  }

  removeConnection(controller: ReadableStreamDefaultController): void {
    this.connections.delete(controller);
    // Don't log individual disconnects — EventSource auto-reconnects cause churn
  }

  publish(event: SecretaryEvent): void {
    if (this.connections.size === 0) {
      console.warn(`[SecretaryStream] publish(${event.type}) 时无活跃连接，消息丢失`);
      // 缓存最近的 new_message 事件，等客户端重连后推送
      if (event.type === 'new_message' || event.type === 'dispatch_completed' || event.type === 'dispatch_failed') {
        this.bufferedEvents.push(event);
        // 最多缓存 50 条
        if (this.bufferedEvents.length > 50) this.bufferedEvents.shift();
      }
      return;
    }

    const message = `data: ${JSON.stringify(event)}\n\n`;
    const encoded = new TextEncoder().encode(message);
    const dead: ReadableStreamDefaultController[] = [];

    for (const controller of this.connections) {
      try {
        controller.enqueue(encoded);
      } catch {
        dead.push(controller);
      }
    }

    for (const c of dead) {
      this.removeConnection(c);
    }

    if (event.type !== 'heartbeat') {
      console.log(`[SecretaryStream] publish(${event.type}) → ${this.connections.size} 个连接`);
    }
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  closeAll(): void {
    for (const controller of this.connections) {
      try { controller.close(); } catch { /* ignore */ }
    }
    this.connections.clear();
  }
}

// Singleton stable across HMR
const g = globalThis as unknown as { __secretary_stream_mgr__?: SecretaryStreamManager };
if (!g.__secretary_stream_mgr__) {
  g.__secretary_stream_mgr__ = new SecretaryStreamManager();
} else if (!g.__secretary_stream_mgr__.bufferedEvents) {
  // HMR: old instance doesn't have bufferedEvents — patch it
  g.__secretary_stream_mgr__.bufferedEvents = [];
}
export const secretaryStream: SecretaryStreamManager = g.__secretary_stream_mgr__;

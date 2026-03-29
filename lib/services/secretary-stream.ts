/**
 * Secretary SSE Stream Manager
 *
 * Manages SSE connections for the secretary chat.
 * Supports:
 * - Dispatch task status updates (completed/failed/feedback)
 * - AI streaming (start/delta/end, tool use/result)
 * - New messages and dashboard refresh
 */

import { randomUUID } from 'crypto';

export interface SecretaryEvent {
  type:
    | 'connected'
    | 'heartbeat'
    | 'new_message'
    | 'ai_stream_start'
    | 'ai_stream_delta'
    | 'ai_stream_end'
    | 'ai_tool_use'
    | 'ai_tool_result'
    | 'error'
    | 'dispatch_completed'
    | 'dispatch_failed'
    | 'dispatch_feedback'
    | 'dashboard_refresh'
    | 'memory_reminder';
  data: Record<string, unknown>;
}

interface ActiveStreamInfo {
  requestId: string;
  startedAt: string;
  abortController: AbortController;
}

export class SecretaryStreamManager {
  private connections = new Set<ReadableStreamDefaultController>();
  private connectionIds = new WeakMap<ReadableStreamDefaultController, string>();
  /** 缓存在无连接时发布的重要事件，等客户端重连后推送 */
  bufferedEvents: SecretaryEvent[] = [];
  /** Currently active AI streams: requestId -> stream info */
  private activeStreams = new Map<string, ActiveStreamInfo>();

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

    // 检测是否有活跃的 AI 流 —— 页面刷新后恢复执行状态
    // ai_stream_start 已经被旧连接消费过，buffer 中没有，需要重新推送
    if (this.activeStreams.size > 0) {
      for (const [reqId, info] of this.activeStreams) {
        try {
          const resumeEvent: SecretaryEvent = {
            type: 'ai_stream_start',
            data: { requestId: reqId, resumed: true, startedAt: info.startedAt },
          };
          const message = `data: ${JSON.stringify(resumeEvent)}\n\n`;
          controller.enqueue(new TextEncoder().encode(message));
          console.log(`[SecretaryStream] 推送 resumed ai_stream_start 给新连接 | requestId=${reqId}`);
        } catch { /* ignore */ }
      }
    }

    return id;
  }

  removeConnection(controller: ReadableStreamDefaultController): void {
    this.connections.delete(controller);
    // Don't log individual disconnects — EventSource auto-reconnects cause churn
  }

  publish(event: SecretaryEvent): void {
    // 当 ai_stream_end 事件发出时，清理对应的 ai_stream_start 缓存（执行已结束，不需要再通知重连客户端）
    if (event.type === 'ai_stream_end') {
      const endRequestId = (event.data as any)?.requestId;
      if (endRequestId) {
        this.bufferedEvents = this.bufferedEvents.filter(e => {
          if (e.type === 'ai_stream_start' && (e.data as any)?.requestId === endRequestId) {
            console.log(`[SecretaryStream] Cleared buffered ai_stream_start for completed request: ${endRequestId}`);
            return false;
          }
          return true;
        });
      }
    }

    if (this.connections.size === 0) {
      console.warn(`[SecretaryStream] publish(${event.type}) 时无活跃连接，消息丢失`);
      // 缓存重要事件，等客户端重连后推送
      // - new_message: 新消息（必须缓存）
      // - dispatch_completed/dispatch_failed: 派发结果（必须缓存）
      // - ai_stream_start: AI 正在执行中（需要缓存，让重连客户端知道状态）
      // - dispatch_feedback: 需要用户确认（必须缓存）
      // 不缓存: ai_stream_delta（增量内容太多）、ai_tool_use/ai_tool_result（中间状态）
      const shouldBuffer = 
        event.type === 'new_message' || 
        event.type === 'dispatch_completed' || 
        event.type === 'dispatch_failed' ||
        event.type === 'ai_stream_start' ||
        event.type === 'dispatch_feedback';
      if (shouldBuffer) {
        this.bufferedEvents.push(event);
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

  // ===== AI Stream Management =====

  markStreamActive(requestId: string): AbortController {
    const abortController = new AbortController();
    this.activeStreams.set(requestId, {
      requestId,
      startedAt: new Date().toISOString(),
      abortController,
    });
    console.log(`[SecretaryStream] Stream active: ${requestId}, total: ${this.activeStreams.size}`);
    return abortController;
  }

  markStreamDone(requestId: string): void {
    this.activeStreams.delete(requestId);
    console.log(`[SecretaryStream] Stream done: ${requestId}, total: ${this.activeStreams.size}`);
  }

  isStreaming(): boolean {
    return this.activeStreams.size > 0;
  }

  getActiveStreams(): string[] {
    return Array.from(this.activeStreams.keys());
  }

  getActiveStreamDetails(): Map<string, { requestId: string; startedAt: string }> {
    return new Map(
      Array.from(this.activeStreams.entries()).map(([k, v]) => [
        k,
        { requestId: v.requestId, startedAt: v.startedAt },
      ])
    );
  }

  abortStream(requestId?: string): { success: boolean; abortedCount: number; error?: string } {
    if (requestId) {
      const stream = this.activeStreams.get(requestId);
      if (!stream) {
        return { success: false, abortedCount: 0, error: 'No active stream found' };
      }
      stream.abortController.abort();
      this.activeStreams.delete(requestId);
      console.log(`[SecretaryStream] Stream aborted: ${requestId}`);
      return { success: true, abortedCount: 1 };
    } else {
      const count = this.activeStreams.size;
      if (count === 0) {
        return { success: false, abortedCount: 0, error: 'No active streams' };
      }
      for (const [, stream] of this.activeStreams) {
        stream.abortController.abort();
      }
      console.log(`[SecretaryStream] All ${count} streams aborted`);
      this.activeStreams.clear();
      return { success: true, abortedCount: count };
    }
  }

  getAbortSignal(requestId: string): AbortSignal | undefined {
    return this.activeStreams.get(requestId)?.abortController.signal;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  get activeStreamCount(): number {
    return this.activeStreams.size;
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

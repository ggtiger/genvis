/**
 * StreamManager - Server-Sent Events (SSE) Connection Management
 * Manages SSE connections per project and sends real-time messages.
 */

import type { RealtimeEvent } from '@/types';
import { randomUUID } from 'crypto';
import { websocketManager } from '@/lib/server/websocket-manager';

/**
 * SSE Stream Manager
 * Supports multiple client connections per project.
 */
export class StreamManager {
  private streams: Map<string, Set<ReadableStreamDefaultController>>;
  private latestController: Map<string, ReadableStreamDefaultController>;
  private connectionIds: WeakMap<ReadableStreamDefaultController, string>;
  private static instance: StreamManager;

  private constructor() {
    this.streams = new Map();
    this.latestController = new Map();
    this.connectionIds = new WeakMap();
  }

  /**
   * Return Singleton instance
   */
  public static getInstance(): StreamManager {
    if (!StreamManager.instance) {
      StreamManager.instance = new StreamManager();
    }
    return StreamManager.instance;
  }

  /**
   * Add SSE connection to project
   */
  public addStream(projectId: string, controller: ReadableStreamDefaultController): string {
    if (!this.streams.has(projectId)) {
      this.streams.set(projectId, new Set());
    }
    this.streams.get(projectId)!.add(controller);
    this.latestController.set(projectId, controller);
    const id = randomUUID();
    this.connectionIds.set(controller, id);
    return id;
  }

  /**
   * Remove SSE connection from project
   */
  public removeStream(projectId: string, controller: ReadableStreamDefaultController): void {
    const projectStreams = this.streams.get(projectId);
    if (projectStreams) {
      projectStreams.delete(controller);
      const id = this.connectionIds.get(controller);

      // 如果移除的是最新连接，回退到仍存活的任意一个连接
      const latest = this.latestController.get(projectId);
      if (latest === controller) {
        const next = projectStreams.values().next().value as ReadableStreamDefaultController | undefined;
        if (next) {
          this.latestController.set(projectId, next);
        } else {
          this.latestController.delete(projectId);
        }
      }

      if (projectStreams.size === 0) {
        this.streams.delete(projectId);
      }
    }
  }

  /**
   * Send event to all clients of a project
   */
  public publish(projectId: string, event: RealtimeEvent): void {
    // WebSocket temporarily disabled due to connection instability
    // TODO: Re-enable after fixing WebSocket disconnect issue
    // websocketManager.broadcast(projectId, event);

    const projectStreams = this.streams.get(projectId);

    // 特别关注 planning_completed 事件丢失
    if (event.type === 'status' && (event.data as any)?.status === 'planning_completed') {
      if (!projectStreams || projectStreams.size === 0) {
        console.error('❌ [StreamManager] planning_completed 事件无法发送：没有活跃的 SSE 连接', { projectId });
        return;
      }
    }

    if (!projectStreams || projectStreams.size === 0) {
      return;
    }

    const message = `data: ${JSON.stringify(event)}\n\n`;
    const encoder = new TextEncoder();
    const encodedMessage = encoder.encode(message);

    const deadControllers: ReadableStreamDefaultController[] = [];
    let sendIndex = 0;

    // Broadcast to all clients (removed latestOnly restriction for multi-window sync)
    const controllersToSend: ReadableStreamDefaultController[] = [];
    projectStreams.forEach((c) => controllersToSend.push(c));

    controllersToSend.forEach((controller) => {
      sendIndex++;
      try {
        controller.enqueue(encodedMessage);
      } catch (error) {
        // Mark for removal after iteration
        deadControllers.push(controller);
      }
    });

    // Remove dead connections after iteration
    deadControllers.forEach((controller) => {
      this.removeStream(projectId, controller);
    });
  }

  /**
   * Return number of connected streams for a project
   */
  public getStreamCount(projectId: string): number {
    const projectStreams = this.streams.get(projectId);
    return projectStreams ? projectStreams.size : 0;
  }

  /**
   * Return total number of streams across all projects
   */
  public getTotalStreamCount(): number {
    let total = 0;
    this.streams.forEach((streams) => {
      total += streams.size;
    });
    return total;
  }

  /**
   * Close all stream connections for a project
   */
  public closeProjectStreams(projectId: string): void {
    const projectStreams = this.streams.get(projectId);
    if (projectStreams) {
      projectStreams.forEach((controller) => {
        try {
          controller.close();
        } catch (error) {
          console.error(`[StreamManager] Failed to close stream:`, error);
        }
      });
      this.streams.delete(projectId);
    }
  }

  /**
   * Close all stream connections
   */
  public closeAllStreams(): void {
    this.streams.forEach((projectStreams, projectId) => {
      this.closeProjectStreams(projectId);
    });
  }
}

// Export Singleton instance (stable across HMR and route module reloads)
const g = globalThis as unknown as { __claudable_stream_mgr__?: StreamManager };
export const streamManager: StreamManager =
  g.__claudable_stream_mgr__ ?? (g.__claudable_stream_mgr__ = StreamManager.getInstance());

/**
 * LAN Peer Chat — WebSocket Transport Layer
 *
 * Manages WebSocket server and client connections between peers.
 * Handles heartbeat, reconnection with exponential backoff, and message routing.
 *
 * Requirements: 7.1, 7.2, 7.4
 */

import type { PeerMessage } from './types';

const HEARTBEAT_INTERVAL = 15_000; // 15s
const HEARTBEAT_TIMEOUT = 30_000;  // 30s
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 2_000; // 2s

type MessageHandler = (peerId: string, message: PeerMessage) => void;

export class PeerTransport {
  private server: any = null; // WebSocket.Server
  private connections = new Map<string, any>(); // peerId → ws
  private reconnectAttempts = new Map<string, number>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  private messageHandler?: MessageHandler;
  private localPeerId: string;
  private localPeerName: string;

  constructor(peerId: string, peerName: string) {
    this.localPeerId = peerId;
    this.localPeerName = peerName;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  private actualPort: number = 0;

  /** Returns the port the WebSocket server is actually listening on */
  getActualPort(): number {
    return this.actualPort;
  }

  async startServer(port: number, maxRetries: number = 10): Promise<number> {
    const { WebSocketServer } = await import('ws');

    // Try binding to the requested port, auto-increment on EADDRINUSE
    let currentPort = port;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const wss = new WebSocketServer({ port: currentPort });
          wss.on('listening', () => {
            this.server = wss;
            resolve();
          });
          wss.on('error', (err: any) => {
            wss.close();
            reject(err);
          });
        });
        break; // success
      } catch (err: any) {
        if (err?.code === 'EADDRINUSE' && attempt < maxRetries) {
          console.log(`[LanPeer Transport] 端口 ${currentPort} 已被占用，尝试 ${currentPort + 1}`);
          currentPort++;
          continue;
        }
        throw err;
      }
    }

    this.actualPort = currentPort;

    this.server.on('connection', (ws: any) => {
      let remotePeerId: string | null = null;

      ws.on('message', (data: any) => {
        try {
          const msg: PeerMessage = JSON.parse(data.toString());

          if (msg.type === 'HANDSHAKE') {
            remotePeerId = msg.senderId;
            this.connections.set(remotePeerId, ws);
            this.startHeartbeat(remotePeerId, ws);
            // Send ACK
            const ack: PeerMessage = {
              type: 'HANDSHAKE_ACK',
              senderId: this.localPeerId,
              senderName: this.localPeerName,
              timestamp: Date.now(),
              payload: {},
            };
            ws.send(JSON.stringify(ack));
          }

          if (msg.type === 'PING') {
            const pong: PeerMessage = {
              type: 'PONG',
              senderId: this.localPeerId,
              senderName: this.localPeerName,
              timestamp: Date.now(),
              payload: {},
            };
            ws.send(JSON.stringify(pong));
            return;
          }

          if (msg.type === 'PONG') return;

          if (this.messageHandler && msg.senderId) {
            this.messageHandler(msg.senderId, msg);
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on('close', () => {
        if (remotePeerId) {
          this.stopHeartbeat(remotePeerId);
          this.connections.delete(remotePeerId);
        }
      });
    });

    console.log(`[LanPeer Transport] WebSocket 服务已启动 (port ${this.actualPort})`);
    return this.actualPort;
  }

  async connectToPeer(peerId: string, peerName: string, ip: string, port: number): Promise<void> {
    if (this.connections.has(peerId)) return;

    const WebSocket = (await import('ws')).default;
    const ws = new WebSocket(`ws://${ip}:${port}`);

    return new Promise((resolve, reject) => {
      ws.on('open', () => {
        this.connections.set(peerId, ws);
        this.reconnectAttempts.set(peerId, 0);
        this.startHeartbeat(peerId, ws);

        // Send handshake
        const handshake: PeerMessage = {
          type: 'HANDSHAKE',
          senderId: this.localPeerId,
          senderName: this.localPeerName,
          timestamp: Date.now(),
          payload: {},
        };
        ws.send(JSON.stringify(handshake));
        resolve();
      });

      ws.on('message', (data: any) => {
        try {
          const msg: PeerMessage = JSON.parse(data.toString());
          if (msg.type === 'PONG') return;
          if (msg.type === 'PING') {
            const pong: PeerMessage = {
              type: 'PONG',
              senderId: this.localPeerId,
              senderName: this.localPeerName,
              timestamp: Date.now(),
              payload: {},
            };
            ws.send(JSON.stringify(pong));
            return;
          }
          if (this.messageHandler) {
            this.messageHandler(msg.senderId, msg);
          }
        } catch { /* ignore */ }
      });

      ws.on('close', () => {
        this.stopHeartbeat(peerId);
        this.connections.delete(peerId);
        this.scheduleReconnect(peerId, peerName, ip, port);
      });

      ws.on('error', (err: Error) => {
        this.connections.delete(peerId);
        reject(err);
      });
    });
  }

  send(peerId: string, message: PeerMessage): boolean {
    const ws = this.connections.get(peerId);
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  /** Broadcast to all connected peers, or only to members of a group */
  broadcast(message: PeerMessage, memberIds?: string[]): void {
    const targets = memberIds
      ? memberIds.filter((id) => id !== this.localPeerId)
      : Array.from(this.connections.keys());

    for (const peerId of targets) {
      this.send(peerId, message);
    }
  }

  disconnect(peerId: string): void {
    const timer = this.reconnectTimers.get(peerId);
    if (timer) { clearTimeout(timer); this.reconnectTimers.delete(peerId); }
    this.stopHeartbeat(peerId);
    const ws = this.connections.get(peerId);
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
    this.connections.delete(peerId);
    this.reconnectAttempts.delete(peerId);
  }

  async stopServer(): Promise<void> {
    // Clear all reconnect timers
    for (const [, timer] of this.reconnectTimers) clearTimeout(timer);
    this.reconnectTimers.clear();

    // Close all connections
    for (const [id] of this.connections) this.disconnect(id);

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
      this.server = null;
    }
  }

  isConnected(peerId: string): boolean {
    const ws = this.connections.get(peerId);
    return ws?.readyState === 1;
  }

  getConnectedPeerIds(): string[] {
    return Array.from(this.connections.keys());
  }

  // ---- Heartbeat ----

  private startHeartbeat(peerId: string, ws: any): void {
    this.stopHeartbeat(peerId);
    const timer = setInterval(() => {
      if (ws.readyState !== 1) { this.stopHeartbeat(peerId); return; }
      const ping: PeerMessage = {
        type: 'PING',
        senderId: this.localPeerId,
        senderName: this.localPeerName,
        timestamp: Date.now(),
        payload: {},
      };
      try { ws.send(JSON.stringify(ping)); } catch { /* ignore */ }
    }, HEARTBEAT_INTERVAL);
    this.heartbeatTimers.set(peerId, timer);
  }

  private stopHeartbeat(peerId: string): void {
    const timer = this.heartbeatTimers.get(peerId);
    if (timer) { clearInterval(timer); this.heartbeatTimers.delete(peerId); }
  }

  // ---- Reconnect ----

  private scheduleReconnect(peerId: string, peerName: string, ip: string, port: number): void {
    const attempts = this.reconnectAttempts.get(peerId) ?? 0;
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts.delete(peerId);
      return;
    }

    const delay = BASE_RECONNECT_DELAY * Math.pow(2, attempts); // 2s, 4s, 8s, 16s, 32s
    this.reconnectAttempts.set(peerId, attempts + 1);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(peerId);
      try {
        await this.connectToPeer(peerId, peerName, ip, port);
      } catch {
        // connectToPeer's close handler will schedule next attempt
      }
    }, delay);
    this.reconnectTimers.set(peerId, timer);
  }
}

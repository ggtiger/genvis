/**
 * LAN Peer Chat — Discovery Service
 *
 * Uses UDP broadcast to discover other peers on the LAN.
 * Also supports manual IP addition.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

import type { PeerInfo, BroadcastPayload } from './types';

const BROADCAST_INTERVAL = 10_000; // 10s
const OFFLINE_TIMEOUT = 30_000;    // 30s

// ========== Broadcast Serialization ==========

export function serializeBroadcast(payload: BroadcastPayload): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

export function parseBroadcast(buf: Buffer): BroadcastPayload | null {
  try {
    const str = buf.toString('utf8');
    const obj = JSON.parse(str);
    if (obj && obj.type === 'PEER_ANNOUNCE' && typeof obj.peerId === 'string') {
      return obj as BroadcastPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ========== Peer List Management ==========

export class PeerRegistry {
  private peers = new Map<string, PeerInfo>();
  private onDiscovered?: (peer: PeerInfo) => void;
  private onLost?: (peerId: string) => void;

  addPeer(info: Omit<PeerInfo, 'status' | 'lastSeen'> & { lastSeen?: number }): PeerInfo {
    const existing = this.peers.get(info.id);
    const peer: PeerInfo = {
      ...info,
      status: 'online',
      lastSeen: info.lastSeen ?? Date.now(),
    };
    this.peers.set(info.id, peer);
    if (!existing && this.onDiscovered) {
      this.onDiscovered(peer);
    }
    return peer;
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  getPeer(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId);
  }

  /** Mark peers as offline if not seen within OFFLINE_TIMEOUT. Returns newly-offline peer IDs. */
  checkOffline(now: number = Date.now()): string[] {
    const lostIds: string[] = [];
    for (const [id, peer] of this.peers) {
      if (peer.status === 'online' && now - peer.lastSeen > OFFLINE_TIMEOUT) {
        peer.status = 'offline';
        lostIds.push(id);
        if (this.onLost) this.onLost(id);
      }
    }
    return lostIds;
  }

  onPeerDiscovered(cb: (peer: PeerInfo) => void): void {
    this.onDiscovered = cb;
  }

  onPeerLost(cb: (peerId: string) => void): void {
    this.onLost = cb;
  }

  clear(): void {
    this.peers.clear();
  }
}

// ========== Discovery Service ==========

export class DiscoveryService {
  private registry = new PeerRegistry();
  private socket: any = null; // dgram.Socket
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private offlineTimer: ReturnType<typeof setInterval> | null = null;
  private localPeerId: string;
  private localPeerName: string;
  private wsPort: number;
  private httpPort: number;
  private udpPort: number;
  private skills: string[];

  constructor(opts: {
    peerId: string;
    peerName: string;
    wsPort: number;
    httpPort: number;
    udpPort: number;
    skills: string[];
  }) {
    this.localPeerId = opts.peerId;
    this.localPeerName = opts.peerName;
    this.wsPort = opts.wsPort;
    this.httpPort = opts.httpPort;
    this.udpPort = opts.udpPort;
    this.skills = opts.skills;
  }

  getRegistry(): PeerRegistry {
    return this.registry;
  }

  async start(): Promise<void> {
    const dgram = await import('dgram');
    const { getPrimaryLanIP } = await import('@/lib/utils/network');

    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('message', (msg: Buffer, rinfo: any) => {
      const payload = parseBroadcast(msg);
      if (!payload || payload.peerId === this.localPeerId) return;

      this.registry.addPeer({
        id: payload.peerId,
        name: payload.peerName,
        ip: payload.ip || rinfo.address,
        port: payload.port,
        httpPort: payload.httpPort,
        skills: payload.skills || [],
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.socket.bind(this.udpPort, () => {
        this.socket.setBroadcast(true);
        resolve();
      });
      this.socket.on('error', reject);
    });

    // Broadcast self periodically
    const broadcast = () => {
      const ip = getPrimaryLanIP() || '0.0.0.0';
      const payload: BroadcastPayload = {
        type: 'PEER_ANNOUNCE',
        peerId: this.localPeerId,
        peerName: this.localPeerName,
        ip,
        port: this.wsPort,
        httpPort: this.httpPort,
        skills: this.skills,
        timestamp: Date.now(),
      };
      const buf = serializeBroadcast(payload);
      this.socket.send(buf, 0, buf.length, this.udpPort, '255.255.255.255');
    };

    broadcast();
    this.broadcastTimer = setInterval(broadcast, BROADCAST_INTERVAL);

    // Periodically check for offline peers
    this.offlineTimer = setInterval(() => {
      this.registry.checkOffline();
    }, OFFLINE_TIMEOUT / 2);

    console.log(`[LanPeer Discovery] 已启动 UDP 广播 (port ${this.udpPort})`);
  }

  async stop(): Promise<void> {
    if (this.broadcastTimer) { clearInterval(this.broadcastTimer); this.broadcastTimer = null; }
    if (this.offlineTimer) { clearInterval(this.offlineTimer); this.offlineTimer = null; }
    if (this.socket) {
      await new Promise<void>((resolve) => {
        this.socket.close(() => resolve());
      });
      this.socket = null;
    }
  }

  /** Manually add a peer by IP. Validates via HTTP GET /api/lan-peer/info */
  async addManualPeer(ip: string, httpPort: number): Promise<PeerInfo> {
    const res = await fetch(`http://${ip}:${httpPort}/api/lan-peer/info`);
    if (!res.ok) throw new Error(`无法连接到 ${ip}:${httpPort}`);
    const data = await res.json();
    if (!data.success || !data.data) throw new Error('节点信息无效');
    const info = data.data as PeerInfo;
    return this.registry.addPeer({ ...info, ip });
  }
}

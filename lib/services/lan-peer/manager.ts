/**
 * LAN Peer Chat — Manager (Singleton)
 *
 * Orchestrates Discovery, Transport, and message routing.
 * Initialized on app startup when lan_peer.enabled is true.
 */

import { randomUUID } from 'crypto';
import { DiscoveryService } from './discovery';
import { PeerTransport } from './transport';
import { lanPeerStream } from './lan-peer-stream';
import { addMessage, getGroup } from './chat-service';
import { appendMessage as appendMemory } from './group-memory';
import type { PeerMessage, ChatMessage, LanPeerSettings } from './types';
import { DEFAULT_LAN_PEER_SETTINGS } from './types';

export class LanPeerManager {
  readonly peerId: string;
  readonly peerName: string;
  readonly discovery: DiscoveryService;
  readonly transport: PeerTransport;

  constructor(peerId: string, peerName: string, discovery: DiscoveryService, transport: PeerTransport) {
    this.peerId = peerId;
    this.peerName = peerName;
    this.discovery = discovery;
    this.transport = transport;
  }

  async start(wsPort: number): Promise<void> {
    // Start WebSocket server
    await this.transport.startServer(wsPort);

    // Wire up message handler
    this.transport.onMessage((peerId, msg) => this.handleMessage(peerId, msg));

    // Start discovery
    await this.discovery.start();

    // When a new peer is discovered, connect via WebSocket
    this.discovery.getRegistry().onPeerDiscovered((peer) => {
      lanPeerStream.publish({ type: 'peer_online', data: { peer } });
      this.transport.connectToPeer(peer.id, peer.name, peer.ip, peer.port).catch(() => {
        // Connection will be retried by transport layer
      });
    });

    this.discovery.getRegistry().onPeerLost((peerId) => {
      lanPeerStream.publish({ type: 'peer_offline', data: { peerId } });
    });

    console.log(`[LanPeer Manager] 已启动 (peerId=${this.peerId}, name=${this.peerName})`);
  }

  async stop(): Promise<void> {
    await this.discovery.stop();
    await this.transport.stopServer();
  }

  private async handleMessage(fromPeerId: string, msg: PeerMessage): Promise<void> {
    switch (msg.type) {
      case 'GROUP_MESSAGE': {
        const chatMsg = msg.payload.message as ChatMessage;
        if (chatMsg && chatMsg.groupId) {
          await addMessage(chatMsg.groupId, chatMsg);
          // Store in group memory
          await appendMemory(chatMsg.groupId, {
            role: 'user',
            content: chatMsg.content,
            timestamp: chatMsg.timestamp,
            source: chatMsg.senderName,
          });
          lanPeerStream.publish({ type: 'new_message', data: { message: chatMsg } });
        }
        break;
      }
      case 'GROUP_CREATE': {
        const group = msg.payload.group;
        if (group) {
          // Save group locally
          const { createGroup } = await import('./chat-service');
          const g = group as any;
          await createGroup(g.id, g.name, g.creatorId, g.members, g.enabledSkills || []);
          lanPeerStream.publish({ type: 'group_created', data: { group } });
        }
        break;
      }
      case 'SKILL_REQUEST': {
        const { skillName, method, path: apiPath, body, queryParams, requestId } = msg.payload as any;
        const { handleSkillRequest } = await import('./peer-skill-service');
        const result = await handleSkillRequest(skillName, method, apiPath, body, queryParams);
        this.transport.send(fromPeerId, {
          type: 'SKILL_RESPONSE',
          senderId: this.peerId,
          senderName: this.peerName,
          timestamp: Date.now(),
          payload: { requestId, result },
        });
        break;
      }
      case 'SKILL_RESPONSE': {
        // Handled by pending skill call promises (future enhancement)
        break;
      }
      default:
        break;
    }
  }
}

// ========== Singleton ==========

const _gk = '__lan_peer_manager__';
const g = globalThis as any;

export function getLanPeerManager(): LanPeerManager | null {
  return g[_gk] ?? null;
}

export async function initLanPeerManager(): Promise<LanPeerManager | null> {
  if (g[_gk]) return g[_gk];

  const { loadGlobalSettings } = await import('@/lib/services/settings');
  const { getPrimaryLanIP } = await import('@/lib/utils/network');

  const settings = await loadGlobalSettings();
  const lanPeer: LanPeerSettings = { ...DEFAULT_LAN_PEER_SETTINGS, ...settings.lan_peer };

  if (!lanPeer.enabled) {
    console.log('[LanPeer Manager] 局域网聊天未启用');
    return null;
  }

  const peerId = g.__lan_peer_id__ ?? (g.__lan_peer_id__ = randomUUID());
  const peerName = lanPeer.nodeName || '未命名节点';
  const httpPort = parseInt(process.env.PORT || '3000', 10);

  const discovery = new DiscoveryService({
    peerId,
    peerName,
    wsPort: lanPeer.wsPort,
    httpPort,
    udpPort: lanPeer.udpPort,
    skills: lanPeer.exposedSkills,
  });

  const transport = new PeerTransport(peerId, peerName);
  const manager = new LanPeerManager(peerId, peerName, discovery, transport);

  await manager.start(lanPeer.wsPort);
  g[_gk] = manager;
  return manager;
}

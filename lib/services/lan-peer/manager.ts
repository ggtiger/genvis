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
import { getGroup } from './chat-service';
import { createLanMessage, getLanMessagesByGroup } from './lan-message-service';
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
    // Start WebSocket server (auto-increments port if occupied)
    const actualWsPort = await this.transport.startServer(wsPort);

    // Update discovery to advertise the actual WS port
    this.discovery.setWsPort(actualWsPort);

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

  /**
   * Trigger AI reply for a message (with abort/senderId support).
   * Called when creator receives a user message (from self or peers).
   */
  async triggerAIReply(groupId: string, userMessage: ChatMessage): Promise<void> {
    const { executeLanClaude, AI_SENDER_ID, AI_SENDER_NAME } = await import('./lan-claude');

    const aiRequestId = randomUUID();
    const senderId = userMessage.senderId;
    const group = await getGroup(groupId);

    // Mark stream active with senderId + AbortController
    const abortController = lanPeerStream.markStreamActive(groupId, aiRequestId, senderId);

    // Notify local SSE that AI streaming is starting (include senderId)
    lanPeerStream.publish({
      type: 'ai_stream_start',
      data: { groupId, requestId: aiRequestId, senderId, timestamp: new Date().toISOString() },
    });

    try {
      // Execute Claude SDK (handles streaming + DB persistence internally)
      await executeLanClaude({
        groupId,
        instruction: userMessage.content,
        sessionId: group?.activeSessionId,
        requestId: aiRequestId,
        senderName: userMessage.senderName,
        abortSignal: abortController.signal,
      });
    } finally {
      // Clear active stream marker
      lanPeerStream.markStreamDone(groupId);

      // Safety net: always send ai_stream_end
      lanPeerStream.publish({
        type: 'ai_stream_end',
        data: { groupId, requestId: aiRequestId, timestamp: new Date().toISOString() },
      });
    }

    // After SDK completes, broadcast final AI message to peers
    const recentMsgs = await getLanMessagesByGroup(groupId, 5);
    const lastAIMsg = recentMsgs.reverse().find(
      (m) => m.senderId === AI_SENDER_ID && m.requestId === aiRequestId && m.messageType === 'text'
    );

    if (lastAIMsg && group) {
      const broadcastMsg: ChatMessage = {
        id: lastAIMsg.id,
        groupId,
        senderId: AI_SENDER_ID,
        senderName: AI_SENDER_NAME,
        content: lastAIMsg.content,
        messageType: 'text',
        interactionMode: 'ai_chat',
        timestamp: new Date(lastAIMsg.createdAt).getTime(),
        status: 'sent',
      };

      this.transport.broadcast({
        type: 'GROUP_MESSAGE',
        senderId: broadcastMsg.senderId,
        senderName: broadcastMsg.senderName,
        timestamp: broadcastMsg.timestamp,
        payload: { message: broadcastMsg },
      }, group.members);
    }
  }

  private async handleMessage(fromPeerId: string, msg: PeerMessage): Promise<void> {
    switch (msg.type) {
      case 'GROUP_MESSAGE': {
        const chatMsg = msg.payload.message as ChatMessage;
        if (chatMsg && chatMsg.groupId) {
          // Store received message in database
          await createLanMessage({
            id: chatMsg.id,
            groupId: chatMsg.groupId,
            role: chatMsg.senderId === 'ai-assistant' ? 'assistant' : 'user',
            messageType: chatMsg.messageType,
            content: chatMsg.content,
            senderId: chatMsg.senderId,
            senderName: chatMsg.senderName,
            interactionMode: chatMsg.interactionMode,
          });

          lanPeerStream.publish({ type: 'new_message', data: { message: chatMsg } });

          // If this node is the group creator and the message is a user text message,
          // trigger AI reply on behalf of the remote sender.
          if (chatMsg.senderId !== 'ai-assistant' && chatMsg.messageType === 'text'
              && chatMsg.interactionMode !== 'skill_invoke') {
            const group = await getGroup(chatMsg.groupId);
            if (group?.creatorId === this.peerId) {
              this.triggerAIReply(chatMsg.groupId, chatMsg).catch((err) => {
                console.error('[LanPeer] AI reply for peer message failed:', err);
              });
            }
          }
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

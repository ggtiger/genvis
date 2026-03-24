/**
 * LAN Peer Chat — Manager (Singleton)
 *
 * Orchestrates Discovery, Transport, and message routing.
 * Initialized on app startup when lan_peer.enabled is true.
 */

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { DiscoveryService } from './discovery';
import { PeerTransport } from './transport';
import { lanPeerStream, type LanPeerEvent } from './lan-peer-stream';
import { getGroup } from './chat-service';
import { createLanMessage, getLanMessagesByGroup } from './lan-message-service';
import { parseInteractionMode } from './message-parser';
import type { PeerMessage, ChatMessage, LanPeerSettings } from './types';
import { DEFAULT_LAN_PEER_SETTINGS } from './types';

export class LanPeerManager {
  readonly peerId: string;
  peerName: string;
  readonly discovery: DiscoveryService;
  readonly transport: PeerTransport;

  constructor(peerId: string, peerName: string, discovery: DiscoveryService, transport: PeerTransport) {
    this.peerId = peerId;
    this.peerName = peerName;
    this.discovery = discovery;
    this.transport = transport;
  }

  /** Update peer display name at runtime (after settings change) */
  updatePeerName(name: string): void {
    this.peerName = name;
    this.discovery.setPeerName(name);
    this.transport.setPeerName(name);
    // Also update scheduler identity
    import('./scheduled-message-service').then(({ updateSchedulerIdentity }) => {
      updateSchedulerIdentity(this.peerId, name);
    }).catch(() => {});
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

    // Start scheduled message scheduler
    const { startScheduler } = await import('./scheduled-message-service');
    startScheduler(this.peerId, this.peerName, () => this.transport);
  }

  async stop(): Promise<void> {
    const { stopScheduler } = await import('./scheduled-message-service');
    stopScheduler();
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

    if (!group) {
      console.warn(`[LanPeer] triggerAIReply: group ${groupId} not found, skipping AI reply`);
      return;
    }

    // Parse content to extract cleanContent (strip @name prefix)
    const enabledSkills = group.enabledSkills || [];
    const interaction = parseInteractionMode(userMessage.content, enabledSkills);
    const instruction = interaction.cleanContent || userMessage.content;

    // Register broadcast callback: forward ai_stream_* events to ALL group members via WebSocket
    // This includes the original message sender so they can see the streaming status
    const members = group.members || [];
    console.log(`[LanPeer] triggerAIReply: groupId=${groupId}, originalSender=${senderId}, broadcastTargets=${members.join(', ')}`);
    lanPeerStream.setBroadcastCallback(groupId, (event) => {
      this.transport.broadcast({
        type: 'AI_STREAM_EVENT',
        senderId: this.peerId,
        senderName: this.peerName,
        timestamp: Date.now(),
        payload: { streamEvent: event },
      }, members);
    });

    // Mark stream active with senderId + AbortController
    const abortController = lanPeerStream.markStreamActive(groupId, aiRequestId, senderId);

    // Notify local SSE that AI streaming is starting (include senderId)
    // (broadcastCallback will forward this to peers)
    lanPeerStream.publish({
      type: 'ai_stream_start',
      data: { groupId, requestId: aiRequestId, senderId, timestamp: new Date().toISOString() },
    });

    try {
      // Execute Claude SDK (handles streaming + DB persistence internally)
      await executeLanClaude({
        groupId,
        instruction,
        sessionId: group?.activeSessionId,
        requestId: aiRequestId,
        senderName: userMessage.senderName,
        abortSignal: abortController.signal,
      });
    } finally {
      // Clear active stream marker
      lanPeerStream.markStreamDone(groupId);

      // Safety net: always send ai_stream_end (also broadcast to peers via callback)
      lanPeerStream.publish({
        type: 'ai_stream_end',
        data: { groupId, requestId: aiRequestId, timestamp: new Date().toISOString() },
      });

      // Clean up broadcast callback after end event is sent
      lanPeerStream.clearBroadcastCallback(groupId);
    }

    // After SDK completes, broadcast final AI message to ALL group members (including original sender)
    const recentMsgs = await getLanMessagesByGroup(groupId, 5);
    const lastAIMsg = recentMsgs.reverse().find(
      (m) => m.senderId === AI_SENDER_ID && m.requestId === aiRequestId && m.messageType === 'text'
    );

    if (lastAIMsg) {
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

      // Broadcast AI reply to ALL members (group.members), not excluding the original sender
      // transport.broadcast will filter out localPeerId (the creator), so all remote members receive it
      console.log(`[LanPeer] Broadcasting AI reply to members: ${members.join(', ')}`);
      this.transport.broadcast({
        type: 'GROUP_MESSAGE',
        senderId: broadcastMsg.senderId,
        senderName: broadcastMsg.senderName,
        timestamp: broadcastMsg.timestamp,
        payload: { message: broadcastMsg },
      }, members);
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

          // Touch group timestamp for sorting
          const { touchGroupTimestamp } = await import('./chat-service');
          touchGroupTimestamp(chatMsg.groupId).catch(() => {});

          // If this node is the group creator, relay the message to other members.
          // Non-group-owners may not have direct WebSocket connections to each other,
          // so the group owner acts as a relay hub to ensure all members receive it.
          const group = await getGroup(chatMsg.groupId);
          if (group?.creatorId === this.peerId) {
            // Relay to all members except the original sender and ourselves
            const relayTargets = (group.members || []).filter(
              (id: string) => id !== this.peerId && id !== fromPeerId && id !== chatMsg.senderId
            );
            if (relayTargets.length > 0) {
              console.log(`[LanPeer] Relaying GROUP_MESSAGE from ${chatMsg.senderId} to ${relayTargets.length} member(s): ${relayTargets.join(', ')}`);
              for (const targetId of relayTargets) {
                const sent = this.transport.send(targetId, msg);
                if (!sent) {
                  console.warn(`[LanPeer] Failed to relay message to ${targetId} (not connected)`);
                }
              }
            }

            // Trigger AI reply for user text messages
            if (chatMsg.senderId !== 'ai-assistant' && chatMsg.messageType === 'text'
                && chatMsg.interactionMode !== 'no_ai') {
              console.log(`[LanPeer] Triggering AI reply for GROUP_MESSAGE from ${chatMsg.senderId}, groupId=${chatMsg.groupId}, messageType=${chatMsg.messageType}, interactionMode=${chatMsg.interactionMode}`);
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
      case 'GROUP_UPDATE': {
        const updatedGroup = msg.payload.group as any;
        if (updatedGroup) {
          const isMember = Array.isArray(updatedGroup.members) && updatedGroup.members.includes(this.peerId);
          if (isMember) {
            // Still a member: update local group data, or create if not yet stored (new member added)
            const { updateGroup, createGroup, getGroup } = await import('./chat-service');
            const existing = await getGroup(updatedGroup.id);
            if (existing) {
              await updateGroup(updatedGroup.id, {
                name: updatedGroup.name,
                members: updatedGroup.members,
                enabledSkills: updatedGroup.enabledSkills,
                systemPrompt: updatedGroup.systemPrompt,
                scheduledMessages: updatedGroup.scheduledMessages,
              });
              lanPeerStream.publish({ type: 'group_updated', data: { group: updatedGroup } });
            } else {
              // New member scenario: group doesn't exist locally yet — create it
              await createGroup(
                updatedGroup.id,
                updatedGroup.name,
                updatedGroup.creatorId,
                updatedGroup.members,
                updatedGroup.enabledSkills || [],
                updatedGroup.systemPrompt,
              );
              lanPeerStream.publish({ type: 'group_created', data: { group: updatedGroup } });
              console.log(`[LanPeer] New group ${updatedGroup.id} created locally (added as member via GROUP_UPDATE)`);
            }
          } else {
            // Removed from group: delete local copy
            const { deleteGroup } = await import('./chat-service');
            await deleteGroup(updatedGroup.id);
            lanPeerStream.publish({ type: 'group_deleted', data: { groupId: updatedGroup.id } });
          }
        }
        break;
      }
      case 'GROUP_DELETE': {
        // Group owner dissolved the group — delete local copy and notify UI
        const deletedGroupId = msg.payload.groupId as string;
        if (deletedGroupId) {
          const { deleteGroup } = await import('./chat-service');
          const { deleteLanMessagesByGroup } = await import('./lan-message-service');
          await deleteLanMessagesByGroup(deletedGroupId);
          await deleteGroup(deletedGroupId);
          lanPeerStream.publish({ type: 'group_deleted', data: { groupId: deletedGroupId } });
          console.log(`[LanPeer] Group ${deletedGroupId} dissolved by owner, local data removed`);
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
      case 'AI_STREAM_EVENT': {
        // Received a streaming event from the creator node — forward to local SSE clients
        const streamEvent = msg.payload.streamEvent as LanPeerEvent | undefined;
        if (streamEvent && streamEvent.type && streamEvent.data) {
          lanPeerStream.publish(streamEvent);
        }
        break;
      }
      default:
        break;
    }
  }
}

// ========== Stable Peer ID (persisted to disk) ==========

const PEER_ID_FILE = path.join(process.cwd(), 'data', 'lan-peer', 'peer-id.txt');

/**
 * Get the base machine peerId (without port suffix).
 * Persisted to data/lan-peer/peer-id.txt.
 */
async function getBasePeerId(): Promise<string> {
  const g = globalThis as any;
  if (g.__lan_base_peer_id__) return g.__lan_base_peer_id__;

  // Try to read from disk
  try {
    const saved = (await fs.readFile(PEER_ID_FILE, 'utf8')).trim();
    if (saved) {
      // Strip any old port suffix if present (migration from old format)
      const base = saved.replace(/-p\d+$/, '');
      g.__lan_base_peer_id__ = base;
      return base;
    }
  } catch {
    // File doesn't exist yet — first run
  }

  // First run: scan existing groups to adopt a creatorId for backward compatibility
  const groupsDir = path.join(process.cwd(), 'data', 'lan-peer', 'groups');
  let adoptedId: string | null = null;
  const oldCreatorIds = new Set<string>();

  try {
    const entries = await fs.readdir(groupsDir);
    for (const entry of entries) {
      try {
        const gFile = path.join(groupsDir, entry, 'group.json');
        const raw = await fs.readFile(gFile, 'utf8');
        const group = JSON.parse(raw);
        if (group.creatorId && group.creatorId !== 'local') {
          // Strip port suffix from old creatorIds
          const baseCreatorId = group.creatorId.replace(/-p\d+$/, '');
          oldCreatorIds.add(group.creatorId);
          if (!adoptedId) adoptedId = baseCreatorId;
        }
      } catch { /* skip invalid groups */ }
    }
  } catch { /* no groups dir yet */ }

  const newId = adoptedId || randomUUID();
  g.__lan_base_peer_id__ = newId;

  // Persist to disk
  try {
    await fs.mkdir(path.dirname(PEER_ID_FILE), { recursive: true });
    await fs.writeFile(PEER_ID_FILE, newId, 'utf8');
  } catch (err) {
    console.error('[LanPeer] Failed to persist peerId:', err);
  }

  return newId;
}

/**
 * Get or create a stable peerId that survives server restarts.
 * Includes HTTP port suffix to support multiple instances on the same machine.
 * Format: {baseMachineId}-p{httpPort}
 */
export async function getStablePeerId(): Promise<string> {
  const httpPort = parseInt(process.env.PORT || '3000', 10);
  const cacheKey = `__lan_peer_id_p${httpPort}__`;
  const g = globalThis as any;
  if (g[cacheKey]) return g[cacheKey];

  const baseId = await getBasePeerId();
  const instanceId = `${baseId}-p${httpPort}`;
  g[cacheKey] = instanceId;

  // Migrate: update groups whose creatorId matches the base ID (without port suffix)
  const groupsDir = path.join(process.cwd(), 'data', 'lan-peer', 'groups');
  try {
    const entries = await fs.readdir(groupsDir);
    for (const entry of entries) {
      try {
        const gFile = path.join(groupsDir, entry, 'group.json');
        const raw = await fs.readFile(gFile, 'utf8');
        const group = JSON.parse(raw);
        // Migrate old creatorId (without port suffix) to new format
        if (group.creatorId && group.creatorId === baseId) {
          group.creatorId = instanceId;
          await fs.writeFile(gFile, JSON.stringify(group, null, 2), 'utf8');
          console.log(`[LanPeer] Migrated group ${entry} creatorId: ${baseId} → ${instanceId}`);
        }
      } catch { /* skip */ }
    }
  } catch { /* no groups dir yet */ }

  return instanceId;
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

  const peerId = await getStablePeerId();
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

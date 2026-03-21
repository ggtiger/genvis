/**
 * LAN Peer Chat — Core Type Definitions
 *
 * Defines all interfaces and enums for the peer-to-peer LAN chat system.
 * Requirements: 1.1, 2.4, 2.5.1, 2.6.1, 4.1, 5.1
 */

// ========== Node / Peer ==========

export interface PeerInfo {
  id: string;
  name: string;
  ip: string;
  port: number;       // WebSocket port
  httpPort: number;    // HTTP file transfer port (same as Next.js port)
  skills: string[];    // exposed skill names
  status: 'online' | 'offline';
  lastSeen: number;    // epoch ms
}

// ========== Discovery ==========

/** UDP broadcast payload */
export interface BroadcastPayload {
  type: 'PEER_ANNOUNCE';
  peerId: string;
  peerName: string;
  ip: string;
  port: number;
  httpPort: number;
  skills: string[];
  timestamp: number;
}

// ========== WebSocket Messages ==========

export type PeerMessageType =
  | 'HANDSHAKE'
  | 'HANDSHAKE_ACK'
  | 'GROUP_MESSAGE'
  | 'GROUP_CREATE'
  | 'GROUP_JOIN'
  | 'GROUP_LEAVE'
  | 'SKILL_REQUEST'
  | 'SKILL_RESPONSE'
  | 'FILE_NOTIFY'
  | 'PEER_UPDATE'
  | 'HISTORY_SYNC'
  | 'PING'
  | 'PONG';

export interface PeerMessage {
  type: PeerMessageType;
  senderId: string;
  senderName: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

// ========== Chat Groups ==========

export interface ChatGroup {
  id: string;
  name: string;
  creatorId: string;
  members: string[];        // peer IDs
  enabledSkills: string[];  // skills open to this group
  systemPrompt?: string;    // custom system prompt for the group AI bot
  activeSessionId?: string; // Claude SDK session ID for context continuity
  createdAt: number;
  updatedAt: number;
}

// ========== Chat Messages ==========

export type ChatMessageType = 'text' | 'file' | 'image' | 'skill_result' | 'system' | 'tool_use' | 'tool_result';
export type InteractionMode = 'skill_invoke' | 'mention' | 'plain' | 'ai_chat';
export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  content: string;
  messageType: ChatMessageType;
  interactionMode: InteractionMode;
  mentionedPeers?: string[];
  fileInfo?: FileTransferInfo;
  skillResult?: SkillCallResult;
  metadata?: Record<string, unknown>;
  isStreaming?: boolean;        // true while AI is still generating
  timestamp: number;
  status: MessageStatus;
}

// ========== Message Interaction Mode Parsing ==========

export interface MessageInteractionMode {
  mode: InteractionMode;
  mentionedPeerName?: string;
  cleanContent: string;
}

// ========== Group Memory ==========

export interface GroupMemoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  source?: string; // sender node name
}

export interface GroupMemory {
  groupId: string;
  entries: GroupMemoryEntry[];
  updatedAt: number;
}

// ========== File Transfer ==========

export type FileTransferStatus = 'pending' | 'transferring' | 'completed' | 'failed';

export interface FileTransferInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  senderId: string;
  senderName: string;
  url?: string;
  thumbnailUrl?: string;
  status: FileTransferStatus;
  progress: number; // 0-100
}

// ========== Skill Invocation ==========

export interface SkillCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
  executionTime: number;
}

// ========== Settings Extension ==========

export interface LanPeerSettings {
  enabled: boolean;
  nodeName: string;
  wsPort: number;
  udpPort: number;
  exposedSkills: string[];
  fileReceiveDir: string;
}

export const DEFAULT_LAN_PEER_SETTINGS: LanPeerSettings = {
  enabled: false,
  nodeName: '',
  wsPort: 41235,
  udpPort: 41234,
  exposedSkills: [],
  fileReceiveDir: 'data/lan-peer/files',
};

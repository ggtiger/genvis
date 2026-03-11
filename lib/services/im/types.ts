/** 支持的 IM 平台 */
export type IMPlatform = 'wechat' | 'feishu' | 'dingtalk' | 'qq' | 'wecom';

/** 消息接收模式 */
export type ReceiveMode = 'stream' | 'webhook';

/** 连接状态 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** Stream 平台列表 */
export const STREAM_PLATFORMS: IMPlatform[] = ['dingtalk', 'feishu', 'qq'];

/** Webhook 平台列表 */
export const WEBHOOK_PLATFORMS: IMPlatform[] = ['wechat', 'wecom'];

/** 标准化消息格式 */
export interface IMStandardMessage {
  platform: IMPlatform;
  receiveMode: ReceiveMode;
  senderId: string;
  content: string;
  messageType: 'text' | 'image' | 'unsupported';
  originalMessageId: string;
  conversationId: string;
  timestamp: number;
  rawPayload: unknown;
}

/** 适配器回复请求 */
export interface IMReplyRequest {
  platform: IMPlatform;
  conversationId: string;
  senderId: string;
  content: string;
  rawPayload: unknown;
}

/** 平台凭证配置 */
export interface IMChannelConfig {
  enabled: boolean;
  receiveMode: ReceiveMode;
  appId: string;
  appSecret: string;
  token: string;
  encodingAESKey?: string;
  extra?: Record<string, string>;
}

/** 所有平台配置 */
export interface IMChannelsSettings {
  wechat?: IMChannelConfig;
  feishu?: IMChannelConfig;
  dingtalk?: IMChannelConfig;
  qq?: IMChannelConfig;
  wecom?: IMChannelConfig;
}

/** 渠道状态信息 */
export interface ChannelStatus {
  platform: IMPlatform;
  receiveMode: ReceiveMode;
  connectionStatus: ConnectionStatus;
  configured: boolean;
  lastConnectedAt?: string;
  lastError?: string;
}

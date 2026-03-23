/** 支持的 IM 平台 */
export type IMPlatform = 'wechat' | 'feishu' | 'dingtalk' | 'qq' | 'wecom' | 'wechat_personal';

/** 消息接收模式 */
export type ReceiveMode = 'stream' | 'webhook';

/** 连接状态 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** Stream 平台列表 */
export const STREAM_PLATFORMS: IMPlatform[] = ['dingtalk', 'feishu', 'qq', 'wechat_personal'];

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
  /** 个人微信 ilink bot_token（QR 码扫码后获取） */
  botToken?: string;
  /** ilink API 基础 URL（默认 https://ilinkai.weixin.qq.com） */
  baseUrl?: string;
  /** ilink 长轮询同步缓冲区（需持久化） */
  syncBuf?: string;
}

/** 所有平台配置 */
export interface IMChannelsSettings {
  wechat?: IMChannelConfig;
  feishu?: IMChannelConfig;
  dingtalk?: IMChannelConfig;
  qq?: IMChannelConfig;
  wecom?: IMChannelConfig;
  wechat_personal?: IMChannelConfig;
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

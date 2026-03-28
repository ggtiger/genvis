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

/** 语音消息载荷 */
export interface VoicePayload {
  /** 语音文件 URL */
  voiceUrl?: string;
  /** 音频格式 (mp3, amr, silk, webm 等) */
  format?: string;
  /** 时长(秒) */
  duration?: number;
  /** 文件大小(字节) */
  size?: number;
  /** AES解密密钥 (base64) - 微信ilink加密语音 */
  aesKey?: string;
  /** 采样率 */
  sampleRate?: number;
}

/** 图片消息载荷 */
export interface ImagePayload {
  /** 图片 CDN URL */
  imageUrl?: string;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
  /** 文件大小(字节) */
  size?: number;
  /** AES解密密钥 (base64) - 微信ilink加密图片 */
  aesKey?: string;
  /** 图片格式 (jpg, png, webp 等) */
  format?: string;
}

/** 文件消息载荷 */
export interface FilePayload {
  /** 文件 URL */
  fileUrl?: string;
  /** 文件名 */
  fileName?: string;
  /** 文件大小(字节) */
  size?: number;
  /** 文件类型 (pdf, docx, xlsx 等) */
  fileType?: string;
  /** AES解密密钥 (base64) */
  aesKey?: string;
}

/** 标准化消息格式 */
export interface IMStandardMessage {
  platform: IMPlatform;
  receiveMode: ReceiveMode;
  senderId: string;
  /** 发送者显示名称（用户昵称等，可选） */
  senderName?: string;
  content: string;
  messageType: 'text' | 'image' | 'voice' | 'file' | 'unsupported';
  originalMessageId: string;
  conversationId: string;
  timestamp: number;
  rawPayload: unknown;
  /** 语音消息专用载荷 */
  voicePayload?: VoicePayload;
  /** 图片消息专用载荷 */
  imagePayload?: ImagePayload;
  /** 文件消息专用载荷 */
  filePayload?: FilePayload;
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

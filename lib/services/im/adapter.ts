import type { NextRequest } from 'next/server';
import type { IMStandardMessage, IMReplyRequest, IMChannelConfig, IMPlatform } from './types';

/** 所有适配器的基础接口 — 定义消息发送能力 */
export interface IMAdapterBase {
  readonly platform: IMPlatform;
  sendReply(reply: IMReplyRequest, config: IMChannelConfig): Promise<void>;
}

/** Stream 适配器接口 — 通过长连接接收消息 */
export interface StreamAdapter extends IMAdapterBase {
  readonly receiveMode: 'stream';
  /** 建立长连接，收到消息时调用 onMessage 回调 */
  connect(config: IMChannelConfig, onMessage: (msg: IMStandardMessage) => Promise<void>): Promise<void>;
  /** 优雅关闭连接 */
  disconnect(): Promise<void>;
  /** 当前是否已连接 */
  isConnected(): boolean;
}

/** Webhook 适配器接口 — 通过 HTTP 回调接收消息 */
export interface WebhookAdapter extends IMAdapterBase {
  readonly receiveMode: 'webhook';
  verifySignature(request: NextRequest, config: IMChannelConfig): Promise<VerifyResult>;
  handleChallenge(request: NextRequest, config: IMChannelConfig): Promise<ChallengeResult>;
  parseMessage(request: NextRequest, config: IMChannelConfig): Promise<IMStandardMessage | null>;
}

/** 签名验证结果 */
export interface VerifyResult {
  valid: boolean;
  error?: string;
}

/** URL 验证（challenge）结果 */
export interface ChallengeResult {
  isChallenge: boolean;
  response?: Response;
}

/** 联合适配器类型 */
export type IMAdapter = StreamAdapter | WebhookAdapter;

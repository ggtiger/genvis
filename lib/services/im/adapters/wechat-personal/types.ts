/**
 * 微信 ilink 协议类型定义
 * 基于 @tencent-weixin/openclaw-weixin 插件协议
 */

/** 默认 ilink API 基础 URL */
export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';

/** 默认 CDN 基础 URL */
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

/** 长轮询默认超时（毫秒） */
export const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;

/** 普通 API 默认超时（毫秒） */
export const DEFAULT_API_TIMEOUT_MS = 15_000;

/** 文本分块限制（字符） */
export const TEXT_CHUNK_LIMIT = 4000;

/** 消息类型 */
export const MessageType = {
  NONE: 0,
  /** 用户消息 */
  USER: 1,
  /** 机器人回复 */
  BOT: 2,
} as const;

/** 消息内容类型 */
export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

/** 消息状态 */
export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

/** 消息内容项 */
export interface MessageItem {
  type?: number;
  text_item?: {
    text?: string;
  };
  image_item?: {
    url?: string;
  };
  file_item?: {
    file_url?: string;
    file_name?: string;
    file_size?: number;
  };
}

/** 微信消息 */
export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

/** base_info 附加在每个 API 请求体中 */
export interface BaseInfo {
  channel_version?: string;
}

/** getUpdates 请求 */
export interface GetUpdatesReq {
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
  base_info?: BaseInfo;
}

/** getUpdates 响应 */
export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

/** sendMessage 请求 */
export interface SendMessageReq {
  msg?: WeixinMessage;
  base_info?: BaseInfo;
}

/** QR 码状态响应 */
export interface QRCodeStatusResp {
  status?: string;
  bot_token?: string;
  ilink_bot_id?: string;
}

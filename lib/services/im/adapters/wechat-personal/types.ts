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
    /** 图片 URL (旧格式) */
    url?: string;
    /** 图片宽度 */
    width?: number;
    /** 图片高度 */
    height?: number;
    /** 文件大小 */
    size?: number;
    /** 加密媒体信息 (ilink 协议) */
    media?: {
      /** 加密查询参数 (CDN 下载用) */
      encrypt_query_param?: string;
      /** AES 解密密钥 (base64) */
      aes_key?: string;
    };
  };
  file_item?: {
    /** 文件 URL */
    file_url?: string;
    /** 文件名 */
    file_name?: string;
    /** 文件大小 */
    file_size?: number;
    /** 加密媒体信息 (ilink 协议) */
    media?: {
      /** 加密查询参数 (CDN 下载用) */
      encrypt_query_param?: string;
      /** AES 解密密钥 (base64) */
      aes_key?: string;
    };
  };
  voice_item?: {
    /** Voice file URL (legacy format) */
    url?: string;
    /** Duration in milliseconds */
    length?: number;
    /** Voice format (silk, amr, etc.) */
    format?: string;
    /** File size in bytes */
    size?: number;
    /** Encrypted media info (ilink protocol) */
    media?: {
      /** Encrypted query parameter for CDN download */
      encrypt_query_param?: string;
      /** AES key for decryption (base64) */
      aes_key?: string;
    };
    /** Encoding type (4 = silk) */
    encode_type?: number;
    /** Bits per sample */
    bits_per_sample?: number;
    /** Sample rate */
    sample_rate?: number;
    /** Play time in milliseconds */
    playtime?: number;
    /** Voice-to-text transcription */
    text?: string;
  };
}

/** 语音消息体（顶层格式） */
export interface VoiceItem {
  /** Voice file URL (legacy format) */
  url?: string;
  /** Duration in milliseconds */
  length?: number;
  /** Voice format (silk, amr, etc.) */
  format?: string;
  /** File size in bytes */
  size?: number;
  /** Encrypted media info (ilink protocol) */
  media?: {
    /** Encrypted query parameter for CDN download */
    encrypt_query_param?: string;
    /** AES key for decryption (base64) */
    aes_key?: string;
  };
  /** Encoding type (4 = silk) */
  encode_type?: number;
  /** Bits per sample */
  bits_per_sample?: number;
  /** Sample rate */
  sample_rate?: number;
  /** Play time in milliseconds */
  playtime?: number;
  /** Voice-to-text transcription */
  text?: string;
}

/** 图片消息体（顶层格式） */
export interface ImageItem {
  /** 图片 URL (旧格式) */
  url?: string;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
  /** 文件大小 */
  size?: number;
  /** 加密媒体信息 (ilink 协议) */
  media?: {
    /** 加密查询参数 (CDN 下载用) */
    encrypt_query_param?: string;
    /** AES 解密密钥 (base64) */
    aes_key?: string;
  };
}

/** 文件消息体（顶层格式） */
export interface FileItem {
  /** 文件 URL */
  url?: string;
  /** 文件名 */
  file_name?: string;
  /** 文件大小 */
  file_size?: number;
  /** 加密媒体信息 (ilink 协议) */
  media?: {
    /** 加密查询参数 (CDN 下载用) */
    encrypt_query_param?: string;
    /** AES 解密密钥 (base64) */
    aes_key?: string;
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
  /** 消息内容类型（顶层格式，用于单条消息如语音/图片） */
  type?: number;
  /** 语音消息内容（顶层格式） */
  voice_item?: VoiceItem;
  /** 图片消息内容（顶层格式） */
  image_item?: ImageItem;
  /** 文件消息内容（顶层格式） */
  file_item?: FileItem;
  /** 是否完成 */
  is_completed?: boolean;
  update_time_ms?: number;
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

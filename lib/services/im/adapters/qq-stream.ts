import WebSocket from 'ws';
import type { StreamAdapter } from '../adapter';
import type {
  IMChannelConfig,
  IMReplyRequest,
  IMStandardMessage,
} from '../types';

/**
 * QQ Bot WebSocket 消息事件数据结构
 */
interface QQBotMessageData {
  id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username?: string;
    bot?: boolean;
  };
  channel_id?: string;
  guild_id?: string;
  group_openid?: string;
  /** 消息类型：0 文本, 1 图文混排, 2 markdown, 7 富媒体 */
  msg_type?: number;
}

/**
 * QQ Bot WebSocket 网关事件载荷
 */
interface QQBotGatewayPayload {
  /** 操作码 */
  op: number;
  /** 事件数据 */
  d: unknown;
  /** 序列号 */
  s?: number;
  /** 事件类型 */
  t?: string;
}

/** QQ Bot WebSocket 操作码 */
const OpCode = {
  /** 服务端推送事件 */
  DISPATCH: 0,
  /** 客户端/服务端心跳 */
  HEARTBEAT: 1,
  /** 客户端鉴权 */
  IDENTIFY: 2,
  /** 客户端恢复连接 */
  RESUME: 6,
  /** 服务端通知客户端重连 */
  RECONNECT: 7,
  /** 鉴权失败 */
  INVALID_SESSION: 9,
  /** 服务端下发 hello，包含心跳间隔 */
  HELLO: 10,
  /** 心跳确认 */
  HEARTBEAT_ACK: 11,
} as const;

/**
 * QQ Bot Stream 适配器
 * 使用 QQ Bot WebSocket API 通过长连接接收机器人消息
 * 参考文档：https://bot.q.qq.com/wiki/develop/api-v2/
 */
class QQBotStreamAdapter implements StreamAdapter {
  readonly platform = 'qq' as const;
  readonly receiveMode = 'stream' as const;

  private ws: WebSocket | null = null;
  private connected = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;

  /**
   * 建立 WebSocket 长连接，注册消息事件回调
   */
  async connect(
    config: IMChannelConfig,
    onMessage: (msg: IMStandardMessage) => Promise<void>
  ): Promise<void> {
    // 如果已有连接，先断开
    if (this.ws) {
      await this.disconnect();
    }

    // 获取 WebSocket 网关地址
    const gatewayUrl = await this.getGatewayUrl(config);

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(gatewayUrl);

      ws.on('open', () => {
        console.log('[QQ] WebSocket 连接已打开，等待 Hello...');
      });

      ws.on('message', (raw: WebSocket.Data) => {
        try {
          const payload: QQBotGatewayPayload = JSON.parse(raw.toString());
          this.handlePayload(payload, ws, config, onMessage, resolve);
        } catch (err) {
          console.error('[QQ] 消息解析失败:', err);
        }
      });

      ws.on('close', (code, reason) => {
        console.log(`[QQ] WebSocket 连接已关闭: code=${code} reason=${reason.toString()}`);
        this.cleanup();
      });

      ws.on('error', (err) => {
        console.error('[QQ] WebSocket 错误:', err);
        this.cleanup();
        reject(err);
      });

      this.ws = ws;
    });
  }

  /**
   * 优雅关闭连接
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close(1000, '主动断开');
      } catch (err) {
        console.error('[QQ] 断开连接时出错:', err);
      }
      this.cleanup();
      console.log('[QQ] Stream 连接已关闭');
    }
  }

  /**
   * 当前是否已连接
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 调用 QQ Bot API 发送回复
   */
  async sendReply(
    reply: IMReplyRequest,
    config: IMChannelConfig
  ): Promise<void> {
    const accessToken = await this.getAccessToken(config.appId, config.appSecret);
    const rawPayload = reply.rawPayload as QQBotMessageData | undefined;

    // 根据消息来源选择回复方式
    if (rawPayload?.group_openid) {
      // 群聊消息回复
      await this.replyToGroup(accessToken, rawPayload.group_openid, rawPayload.id, reply.content);
    } else if (rawPayload?.channel_id) {
      // 频道消息回复
      await this.replyToChannel(accessToken, rawPayload.channel_id, rawPayload.id, reply.content);
    } else {
      // 使用 conversationId 作为 channel_id 回退
      const channelId = reply.conversationId;
      if (!channelId) {
        throw new Error('[QQ] 无法发送消息：缺少 conversationId');
      }
      await this.replyToChannel(accessToken, channelId, '', reply.content);
    }
  }

  /**
   * 处理 WebSocket 网关事件载荷
   */
  private handlePayload(
    payload: QQBotGatewayPayload,
    ws: WebSocket,
    config: IMChannelConfig,
    onMessage: (msg: IMStandardMessage) => Promise<void>,
    onReady: () => void
  ): void {
    // 更新序列号
    if (payload.s !== undefined && payload.s !== null) {
      this.lastSequence = payload.s;
    }

    switch (payload.op) {
      case OpCode.HELLO: {
        // 收到 Hello，开始鉴权
        const hello = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(ws, hello.heartbeat_interval);
        this.sendIdentify(ws, config);
        break;
      }

      case OpCode.DISPATCH: {
        // 事件分发
        if (payload.t === 'READY') {
          // 鉴权成功
          const ready = payload.d as { session_id: string };
          this.sessionId = ready.session_id;
          this.connected = true;
          console.log('[QQ] Stream 连接已建立，session:', this.sessionId);
          onReady();
        } else if (this.isMessageEvent(payload.t)) {
          // 消息事件
          const parsed = parseQQBotMessage(payload.d as QQBotMessageData, payload.t);
          if (parsed) {
            onMessage(parsed).catch((err) => {
              console.error('[QQ] 消息处理失败:', err);
            });
          }
        }
        break;
      }

      case OpCode.HEARTBEAT_ACK:
        // 心跳确认，无需处理
        break;

      case OpCode.RECONNECT:
        // 服务端要求重连
        console.log('[QQ] 服务端要求重连');
        this.cleanup();
        break;

      case OpCode.INVALID_SESSION:
        // 鉴权失败
        console.error('[QQ] 鉴权失败（INVALID_SESSION）');
        this.cleanup();
        break;

      default:
        break;
    }
  }

  /**
   * 判断事件类型是否为消息事件
   */
  private isMessageEvent(eventType?: string): boolean {
    if (!eventType) return false;
    const messageEvents = [
      'AT_MESSAGE_CREATE',       // 频道 @ 消息
      'MESSAGE_CREATE',          // 频道消息（私域）
      'DIRECT_MESSAGE_CREATE',   // 频道私信
      'GROUP_AT_MESSAGE_CREATE', // 群聊 @ 消息
      'C2C_MESSAGE_CREATE',      // 单聊消息
    ];
    return messageEvents.includes(eventType);
  }

  /**
   * 发送鉴权（Identify）
   */
  private sendIdentify(ws: WebSocket, config: IMChannelConfig): void {
    const identify: QQBotGatewayPayload = {
      op: OpCode.IDENTIFY,
      d: {
        token: `QQBot ${config.appSecret}`,
        intents: this.getIntents(),
        shard: [0, 1],
      },
    };
    ws.send(JSON.stringify(identify));
  }

  /**
   * 获取订阅的事件意图（intents）
   * 使用位运算组合多个意图
   */
  private getIntents(): number {
    const GUILDS = 1 << 0;
    const GUILD_MESSAGES = 1 << 9;
    const DIRECT_MESSAGE = 1 << 12;
    const GROUP_AND_C2C_EVENT = 1 << 25;
    const INTERACTION = 1 << 26;
    return GUILDS | GUILD_MESSAGES | DIRECT_MESSAGE | GROUP_AND_C2C_EVENT | INTERACTION;
  }

  /**
   * 启动心跳定时器
   */
  private startHeartbeat(ws: WebSocket, intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const heartbeat: QQBotGatewayPayload = {
          op: OpCode.HEARTBEAT,
          d: this.lastSequence,
        };
        ws.send(JSON.stringify(heartbeat));
      }
    }, intervalMs);
  }

  /**
   * 停止心跳定时器
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 清理连接状态
   */
  private cleanup(): void {
    this.stopHeartbeat();
    this.ws = null;
    this.connected = false;
    this.lastSequence = null;
    this.sessionId = null;
  }

  /**
   * 获取 QQ Bot WebSocket 网关地址
   */
  private async getGatewayUrl(config: IMChannelConfig): Promise<string> {
    const accessToken = await this.getAccessToken(config.appId, config.appSecret);

    const response = await fetch('https://api.sgroup.qq.com/gateway', {
      headers: {
        'Authorization': `QQBot ${accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[QQ] 获取网关地址失败: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { url: string };
    return data.url;
  }

  /**
   * 获取 QQ Bot access_token
   */
  private async getAccessToken(appId: string, appSecret: string): Promise<string> {
    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, clientSecret: appSecret }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[QQ] 获取 access_token 失败: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    return data.access_token;
  }

  /**
   * 回复频道消息
   */
  private async replyToChannel(
    accessToken: string,
    channelId: string,
    msgId: string,
    content: string
  ): Promise<void> {
    const body: Record<string, string> = { content };
    if (msgId) {
      body.msg_id = msgId;
    }

    const response = await fetch(
      `https://api.sgroup.qq.com/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `QQBot ${accessToken}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[QQ] 频道消息发送失败: ${response.status} ${text}`);
    }
  }

  /**
   * 回复群聊消息
   */
  private async replyToGroup(
    accessToken: string,
    groupOpenId: string,
    msgId: string,
    content: string
  ): Promise<void> {
    const body: Record<string, unknown> = {
      content,
      msg_type: 0,
    };
    if (msgId) {
      body.msg_id = msgId;
    }

    const response = await fetch(
      `https://api.sgroup.qq.com/v2/groups/${groupOpenId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `QQBot ${accessToken}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[QQ] 群聊消息发送失败: ${response.status} ${text}`);
    }
  }
}

/**
 * 将 QQ Bot 消息事件数据解析为 IMStandardMessage
 * 导出以便属性测试可以直接验证解析逻辑
 */
export function parseQQBotMessage(
  data: QQBotMessageData,
  _eventType?: string
): IMStandardMessage | null {
  try {
    // 判断消息类型：msg_type 为 0 或未指定时视为文本，其他为不支持
    const msgType = data.msg_type ?? 0;
    const messageType = msgType === 0 ? 'text' : ('unsupported' as const);

    // 提取文本内容（去除可能的 @ 机器人前缀）
    let content = data.content || '';
    // QQ Bot 消息中 @ 机器人的内容格式为 <@!botId> 或 <@botId>
    content = content.replace(/<@!?\d+>\s*/g, '').trim();

    // 会话标识：优先使用 group_openid，其次 channel_id，最后 guild_id
    const conversationId = data.group_openid || data.channel_id || data.guild_id || '';

    return {
      platform: 'qq',
      receiveMode: 'stream',
      senderId: data.author?.id || '',
      content,
      messageType,
      originalMessageId: data.id || '',
      conversationId,
      timestamp: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
      rawPayload: data,
    };
  } catch (err) {
    console.error('[QQ] 消息解析失败:', err);
    return null;
  }
}

export default new QQBotStreamAdapter();

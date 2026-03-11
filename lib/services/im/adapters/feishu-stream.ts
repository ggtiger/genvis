import { Client, WSClient, EventDispatcher, Domain } from '@larksuiteoapi/node-sdk';
import type { StreamAdapter } from '../adapter';
import type {
  IMChannelConfig,
  IMReplyRequest,
  IMStandardMessage,
} from '../types';

/**
 * 飞书事件消息数据结构（im.message.receive_v1 事件）
 */
interface FeishuMessageEvent {
  event_id?: string;
  token?: string;
  create_time?: string;
  event_type?: string;
  tenant_key?: string;
  sender: {
    sender_id?: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
  };
}

/**
 * 飞书 Stream 适配器
 * 使用 @larksuiteoapi/node-sdk 的 WSClient 通过长连接接收机器人消息
 */
class FeishuStreamAdapter implements StreamAdapter {
  readonly platform = 'feishu' as const;
  readonly receiveMode = 'stream' as const;

  private wsClient: WSClient | null = null;
  private apiClient: Client | null = null;
  private connected = false;

  /**
   * 建立 WebSocket 长连接，注册消息事件回调
   */
  async connect(
    config: IMChannelConfig,
    onMessage: (msg: IMStandardMessage) => Promise<void>
  ): Promise<void> {
    // 如果已有连接，先断开
    if (this.wsClient) {
      await this.disconnect();
    }

    // 创建 API 客户端（用于发送消息）
    this.apiClient = new Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: Domain.Feishu,
    });

    // 创建事件分发器，注册消息接收回调
    const eventDispatcher = new EventDispatcher({
      verificationToken: config.token || '',
      encryptKey: config.encodingAESKey || '',
    });

    eventDispatcher.register({
      'im.message.receive_v1': async (data: FeishuMessageEvent) => {
        const parsed = parseFeishuMessageEvent(data);
        if (parsed) {
          await onMessage(parsed).catch((err) => {
            console.error('[Feishu] 消息处理失败:', err);
          });
        }
      },
    });

    // 创建 WSClient 并启动长连接
    const wsClient = new WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: Domain.Feishu,
    });

    try {
      await wsClient.start({ eventDispatcher });
      this.wsClient = wsClient;
      this.connected = true;
      console.log('[Feishu] Stream 连接已建立');
    } catch (err) {
      this.connected = false;
      this.wsClient = null;
      this.apiClient = null;
      throw err;
    }
  }

  /**
   * 优雅关闭连接
   */
  async disconnect(): Promise<void> {
    if (this.wsClient) {
      try {
        this.wsClient.close();
      } catch (err) {
        console.error('[Feishu] 断开连接时出错:', err);
      }
      this.wsClient = null;
      this.apiClient = null;
      this.connected = false;
      console.log('[Feishu] Stream 连接已关闭');
    }
  }

  /**
   * 当前是否已连接
   */
  isConnected(): boolean {
    return this.connected && this.wsClient !== null;
  }

  /**
   * 调用飞书 Bot 消息 API 发送回复
   * 优先使用 reply API（回复原消息），否则使用 create API（主动发送）
   */
  async sendReply(
    reply: IMReplyRequest,
    config: IMChannelConfig
  ): Promise<void> {
    // 确保 API 客户端可用
    const client = this.apiClient || new Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: Domain.Feishu,
    });

    const rawPayload = reply.rawPayload as FeishuMessageEvent | undefined;
    const originalMessageId = rawPayload?.message?.message_id;

    const content = JSON.stringify({ text: reply.content });

    if (originalMessageId) {
      // 回复原消息
      const result = await client.im.message.reply({
        data: {
          content,
          msg_type: 'text',
        },
        path: {
          message_id: originalMessageId,
        },
      });

      if (result.code !== 0) {
        throw new Error(
          `[Feishu] 回复消息失败: code=${result.code} msg=${result.msg}`
        );
      }
    } else {
      // 使用 chat_id 主动发送消息
      const chatId = reply.conversationId;
      if (!chatId) {
        throw new Error('[Feishu] 无法发送消息：缺少 conversationId');
      }

      const result = await client.im.message.create({
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content,
        },
        params: {
          receive_id_type: 'chat_id',
        },
      });

      if (result.code !== 0) {
        throw new Error(
          `[Feishu] 发送消息失败: code=${result.code} msg=${result.msg}`
        );
      }
    }
  }
}

/**
 * 将飞书 im.message.receive_v1 事件数据解析为 IMStandardMessage
 * 导出以便属性测试可以直接验证解析逻辑
 */
export function parseFeishuMessageEvent(
  data: FeishuMessageEvent
): IMStandardMessage | null {
  try {
    const { sender, message } = data;

    // 判断消息类型
    const messageType =
      message.message_type === 'text' ? 'text' : ('unsupported' as const);

    // 提取文本内容（飞书文本消息的 content 是 JSON 字符串，如 '{"text":"你好"}'）
    let content = '';
    if (messageType === 'text') {
      try {
        const parsed = JSON.parse(message.content);
        content = (parsed.text || '').trim();
      } catch {
        content = message.content || '';
      }
    }

    // 提取发送者 ID（优先使用 open_id）
    const senderId =
      sender.sender_id?.open_id ||
      sender.sender_id?.user_id ||
      sender.sender_id?.union_id ||
      '';

    return {
      platform: 'feishu',
      receiveMode: 'stream',
      senderId,
      content,
      messageType,
      originalMessageId: message.message_id || '',
      conversationId: message.chat_id || '',
      timestamp: message.create_time
        ? parseInt(message.create_time, 10)
        : Date.now(),
      rawPayload: data,
    };
  } catch (err) {
    console.error('[Feishu] 消息解析失败:', err);
    return null;
  }
}

export default new FeishuStreamAdapter();

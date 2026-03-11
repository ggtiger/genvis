import {
  DWClient,
  DWClientDownStream,
  EventAck,
  TOPIC_ROBOT,
  type RobotMessage,
} from 'dingtalk-stream-sdk-nodejs';
import type { StreamAdapter } from '../adapter';
import type {
  IMChannelConfig,
  IMReplyRequest,
  IMStandardMessage,
} from '../types';

/**
 * 钉钉 Stream 适配器
 * 使用 dingtalk-stream-sdk-nodejs 通过 WebSocket 长连接接收机器人消息
 */
class DingTalkStreamAdapter implements StreamAdapter {
  readonly platform = 'dingtalk' as const;
  readonly receiveMode = 'stream' as const;

  private client: DWClient | null = null;
  /** 已处理的消息 ID 缓存，防止钉钉重推导致重复处理 */
  private processedMessageIds = new Set<string>();
  private readonly MAX_CACHED_IDS = 500;

  /**
   * 建立 WebSocket 长连接，注册机器人消息回调
   *
   * 关键设计：禁用 SDK 内置的 autoReconnect，由 ConnectionManager 统一管理重连。
   * SDK 的 autoReconnect 会在 socket close 后自动重连，但与 ConnectionManager 的
   * 健康检查重连产生竞争条件，导致网络切换后状态混乱。
   */
  async connect(
    config: IMChannelConfig,
    onMessage: (msg: IMStandardMessage) => Promise<void>
  ): Promise<void> {
    // 如果已有连接，先断开
    if (this.client) {
      await this.disconnect();
    }

    const client = new DWClient({
      clientId: config.appId,
      clientSecret: config.appSecret,
      keepAlive: true, // 启用 WebSocket ping/pong 心跳，检测死连接
    });

    // 禁用 SDK 内置自动重连，避免与 ConnectionManager 重连逻辑冲突
    (client as any).config.autoReconnect = false;
    // 减少 SDK 内部调试日志噪音
    client.debug = false;

    // 钉钉机器人消息通过 CALLBACK 类型推送，需要用 registerCallbackListener
    client.registerCallbackListener(TOPIC_ROBOT, (downstream: DWClientDownStream) => {
      console.log('[DingTalk] 收到 CALLBACK 消息, messageId:', downstream.headers?.messageId);

      const messageId = downstream.headers?.messageId || '';

      // 先发 ACK，防止钉钉重推（使用 SDK 内置 send 方法）
      try {
        client.send(messageId, { status: EventAck.SUCCESS });
      } catch (err) {
        console.warn('[DingTalk] ACK 发送失败:', (err as Error).message);
      }

      // 消息去重 — 用消息体内的 msgId（钉钉重推时 headers.messageId 会变，但 msgId 不变）
      let bodyMsgId = messageId;
      try {
        const body = JSON.parse(downstream.data);
        if (body.msgId) bodyMsgId = body.msgId;
      } catch { /* ignore */ }

      if (this.processedMessageIds.has(bodyMsgId)) {
        console.log('[DingTalk] 重复消息已忽略:', bodyMsgId);
        return;
      }
      this.processedMessageIds.add(bodyMsgId);
      if (this.processedMessageIds.size > this.MAX_CACHED_IDS) {
        const first = this.processedMessageIds.values().next().value;
        if (first) this.processedMessageIds.delete(first);
      }

      const robotMsg = this.parseRobotMessage(downstream);
      if (robotMsg) {
        onMessage(robotMsg).catch((err) => {
          console.error('[DingTalk] 消息处理失败:', err);
        });
      }
    });

    try {
      await client.connect();
      this.client = client;

      // 等待 socket 真正打开（SDK 的 _connect() 在创建 WebSocket 后立即 resolve，不等 open）
      const ready = await this.waitForSocketOpen(client, 5000);
      console.log(`[DingTalk] Stream 连接已建立 (autoReconnect=false), socketReady=${ready}, SDK状态: connected=${(client as any).connected}, registered=${(client as any).registered}, socketReadyState=${(client as any).socket?.readyState}`);
    } catch (err) {
      this.client = null;
      throw err;
    }
  }

  /**
   * 等待 SDK 的 WebSocket 真正打开
   * SDK 的 _connect() 在创建 WebSocket 后立即 resolve，不等 open 事件，
   * 所以需要轮询等待 socket.readyState === 1 (OPEN)。
   * 注意：不等 registered，因为 SDK 在某些环境下 registered 永远为 false。
   */
  private waitForSocketOpen(client: DWClient, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const socket = (client as any).socket;
        if (socket?.readyState === 1) {
          resolve(true);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          console.warn(`[DingTalk] 等待 socket OPEN 超时 (${timeoutMs}ms), socketReadyState=${socket?.readyState}`);
          resolve(false);
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  /**
   * 优雅关闭 SDK 连接
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      const sdkState = `connected=${(this.client as any).connected}, registered=${(this.client as any).registered}, socketReadyState=${(this.client as any).socket?.readyState}`;
      try {
        this.client.disconnect();
      } catch (err) {
        console.error('[DingTalk] 断开连接时出错:', err);
      }
      this.client = null;
      console.log(`[DingTalk] Stream 连接已关闭 (断开前SDK状态: ${sdkState})`);
    }
  }

  /**
   * 当前是否已连接
   *
   * 检查 socket.readyState === OPEN。
   * keepAlive 的 ping/pong（8 秒超时）会在断网后 terminate socket，
   * 使 readyState 变为 CLOSED，从而被检测到。
   */
  isConnected(): boolean {
    if (!this.client) return false;
    const socket = (this.client as any).socket;
    const socketOpen = socket?.readyState === 1;
    if (!socketOpen) {
      console.log(`[DingTalk] isConnected=false: socketReadyState=${socket?.readyState}`);
    }
    return socketOpen;
  }

  /**
   * 调用钉钉机器人消息 API 发送回复
   * 优先使用 sessionWebhook（如果 rawPayload 中包含），否则使用 OpenAPI
   */
  async sendReply(
    reply: IMReplyRequest,
    config: IMChannelConfig
  ): Promise<void> {
    const rawPayload = reply.rawPayload as RobotMessage | undefined;
    const sessionWebhook = rawPayload?.sessionWebhook;

    if (sessionWebhook) {
      // 使用 sessionWebhook 直接回复（更简单，无需 access_token）
      await this.replyViaSessionWebhook(sessionWebhook, reply.content);
    } else {
      // 使用 OpenAPI 发送消息
      await this.replyViaOpenAPI(config, reply);
    }
  }

  /**
   * 通过 sessionWebhook 回复消息
   */
  private async replyViaSessionWebhook(
    webhookUrl: string,
    content: string
  ): Promise<void> {
    const body = {
      msgtype: 'text',
      text: { content },
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `[DingTalk] sessionWebhook 回复失败: ${response.status} ${text}`
      );
    }
  }

  /**
   * 通过钉钉 OpenAPI 发送消息
   */
  private async replyViaOpenAPI(
    config: IMChannelConfig,
    reply: IMReplyRequest
  ): Promise<void> {
    // 获取 access_token
    console.log(`[DingTalk] OpenAPI 发送: senderId=${reply.senderId}, appId=${config.appId}`);
    const accessToken = await this.getAccessToken(
      config.appId,
      config.appSecret
    );
    console.log(`[DingTalk] access_token 获取成功: ${accessToken.substring(0, 20)}...`);

    const robotCode = config.extra?.robotCode || config.appId;

    // senderId 已经是 staffId（在消息解析时优先使用 senderStaffId）
    const body = {
      robotCode,
      userIds: [reply.senderId],
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: reply.content }),
    };

    console.log(`[DingTalk] OpenAPI 请求体: robotCode=${robotCode}, userIds=${JSON.stringify(body.userIds)}`);

    const response = await fetch(
      'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': accessToken,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `[DingTalk] OpenAPI 发送消息失败: ${response.status} ${text}`
      );
    }

    const respData = await response.json().catch(() => ({}));
    console.log(`[DingTalk] OpenAPI 发送成功:`, JSON.stringify(respData));
  }

  /**
   * 获取钉钉 access_token
   */
  private async getAccessToken(
    appId: string,
    appSecret: string
  ): Promise<string> {
    const response = await fetch(
      'https://api.dingtalk.com/v1.0/oauth2/accessToken',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: appId, appSecret }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `[DingTalk] 获取 access_token 失败: ${response.status} ${text}`
      );
    }

    const data = (await response.json()) as { accessToken: string };
    return data.accessToken;
  }

  /**
   * 将钉钉 Stream 下行消息解析为 IMStandardMessage
   * 委托给导出的 parseDingTalkRobotMessage 函数
   */
  private parseRobotMessage(
    downstream: DWClientDownStream
  ): IMStandardMessage | null {
    try {
      const data: RobotMessage = JSON.parse(downstream.data);
      return parseDingTalkRobotMessage(data, downstream.headers?.messageId);
    } catch (err) {
      console.error('[DingTalk] 消息解析失败:', err);
      return null;
    }
  }
}

/**
 * 将钉钉机器人消息数据解析为 IMStandardMessage
 * 导出以便属性测试可以直接验证解析逻辑
 */
export function parseDingTalkRobotMessage(
  data: RobotMessage,
  headersMessageId?: string
): IMStandardMessage | null {
  try {
    // 判断消息类型
    const messageType =
      data.msgtype === 'text' ? 'text' : ('unsupported' as const);

    // 提取文本内容
    const content =
      messageType === 'text' && 'text' in data
        ? (data as { text: { content: string } }).text.content.trim()
        : '';

    return {
      platform: 'dingtalk',
      receiveMode: 'stream',
      // 优先使用 senderStaffId（企业内部 ID），OpenAPI 发送消息需要 staffId
      // senderId（加密 userId）仅在 staffId 不可用时作为 fallback
      senderId: data.senderStaffId || data.senderId || '',
      content,
      messageType,
      originalMessageId: data.msgId || headersMessageId || '',
      conversationId: data.conversationId || '',
      timestamp: data.createAt || Date.now(),
      rawPayload: data,
    };
  } catch (err) {
    console.error('[DingTalk] 消息解析失败:', err);
    return null;
  }
}

const _globalKey = '__dingtalk_stream_adapter__';
const _adapter: DingTalkStreamAdapter =
  (globalThis as any)[_globalKey] ??
  ((globalThis as any)[_globalKey] = new DingTalkStreamAdapter());
export default _adapter;

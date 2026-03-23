/**
 * 个人微信 Stream 适配器
 * 通过 ilink HTTP 长轮询接收消息，实现 StreamAdapter 接口
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { StreamAdapter } from '../../adapter';
import type { IMChannelConfig, IMReplyRequest, IMStandardMessage } from '../../types';
import { getUpdates, sendMessage } from './api';
import {
  MessageType,
  MessageItemType,
  MessageState,
  DEFAULT_BASE_URL,
  type WeixinMessage,
  type SendMessageReq,
} from './types';

/** 生成唯一 client_id（每条发送消息必须有唯一 ID，否则服务端可能去重） */
function generateClientId(): string {
  return `genvis-wx-${crypto.randomBytes(8).toString('hex')}`;
}

/** syncBuf 持久化文件目录 */
const SYNC_BUF_DIR = path.join(process.cwd(), 'data', 'im-sessions', 'wechat_personal');
const SYNC_BUF_FILE = path.join(SYNC_BUF_DIR, '_sync_buf.json');

/** 连续失败 backoff 阈值 */
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;

class WechatPersonalStreamAdapter implements StreamAdapter {
  readonly platform = 'wechat_personal' as const;
  readonly receiveMode = 'stream' as const;

  private abortController: AbortController | null = null;
  private connected = false;
  private syncBuf: string | undefined;
  private pollTimeoutMs: number | undefined;

  /** 缓存 context_token（senderId -> contextToken），回复时需要 */
  private contextTokenCache = new Map<string, string>();
  /** 缓存会话信息（senderId -> { sessionId, toUserId }） */
  private sessionCache = new Map<string, { sessionId?: string; toUserId?: string }>();
  /** 已处理消息 ID 去重缓存 */
  private processedMessageIds = new Set<string>();
  private readonly MAX_CACHED_IDS = 500;

  /**
   * 启动 getUpdates 长轮询循环
   */
  async connect(
    config: IMChannelConfig,
    onMessage: (msg: IMStandardMessage) => Promise<void>
  ): Promise<void> {
    if (this.abortController) {
      await this.disconnect();
    }

    const botToken = config.botToken;
    if (!botToken) {
      throw new Error('[WechatPersonal] 未配置 botToken，请先扫码登录');
    }

    const baseUrl = config.baseUrl || DEFAULT_BASE_URL;

    // 恢复 syncBuf（优先从文件加载，因文件有最新值）
    this.syncBuf = await this.loadSyncBuf() || config.syncBuf;

    this.abortController = new AbortController();
    this.connected = true;

    console.log(`[WechatPersonal] 开始长轮询, baseUrl=${baseUrl}, hasSyncBuf=${!!this.syncBuf}`);

    // 启动轮询循环（不阻塞 connect 返回）
    this.pollLoop(baseUrl, botToken, config, onMessage).catch((err) => {
      if (!this.abortController?.signal.aborted) {
        console.error('[WechatPersonal] 轮询循环异常退出:', err);
      }
      this.connected = false;
    });
  }

  /**
   * 长轮询主循环
   */
  private async pollLoop(
    baseUrl: string,
    token: string,
    config: IMChannelConfig,
    onMessage: (msg: IMStandardMessage) => Promise<void>
  ): Promise<void> {
    let consecutiveFailures = 0;
    let pollCount = 0;

    while (!this.abortController?.signal.aborted) {
      pollCount++;
      try {
        console.log(`[WechatPersonal] 轮询 #${pollCount} 开始, syncBuf=${this.syncBuf ? this.syncBuf.substring(0, 20) + '...' : 'null'}`);

        const resp = await getUpdates({
          baseUrl,
          token,
          get_updates_buf: this.syncBuf,
          longpolling_timeout_ms: this.pollTimeoutMs,
          signal: this.abortController?.signal,
        });

        consecutiveFailures = 0;

        const msgCount = resp.msgs?.length ?? 0;
        console.log(`[WechatPersonal] 轮询 #${pollCount} 返回: ret=${resp.ret}, errcode=${resp.errcode}, msgs=${msgCount}, hasBuf=${!!resp.get_updates_buf}`);

        // 检查错误码
        if (resp.errcode === -14) {
          console.error('[WechatPersonal] 会话已过期 (errcode=-14)，需要重新扫码登录');
          this.connected = false;
          return;
        }

        // 非零 ret 或 errcode 可能表示错误，记录日志但继续轮询
        if ((resp.ret && resp.ret !== 0) || (resp.errcode && resp.errcode !== 0)) {
          console.warn(`[WechatPersonal] 轮询 #${pollCount} 服务端返回异常: ret=${resp.ret}, errcode=${resp.errcode}, errmsg=${resp.errmsg}`);
        }

        // 更新 syncBuf（持久化到文件，不写全局配置避免竞争）
        if (resp.get_updates_buf) {
          this.syncBuf = resp.get_updates_buf;
          await this.saveSyncBuf(resp.get_updates_buf);
        }

        // 动态调整轮询超时
        if (resp.longpolling_timeout_ms) {
          this.pollTimeoutMs = resp.longpolling_timeout_ms;
        }

        // 处理消息
        if (resp.msgs && resp.msgs.length > 0) {
          for (const msg of resp.msgs) {
            // 跳过非用户消息（BOT 回复等）
            if (msg.message_type !== MessageType.USER) {
              console.log(`[WechatPersonal] 跳过非用户消息: type=${msg.message_type}, id=${msg.message_id}`);
              continue;
            }

            // 消息去重
            const msgKey = String(msg.message_id || msg.seq || `${msg.from_user_id}_${msg.create_time_ms}`);
            if (this.processedMessageIds.has(msgKey)) {
              console.log(`[WechatPersonal] 重复消息已忽略: ${msgKey}`);
              continue;
            }
            this.processedMessageIds.add(msgKey);
            if (this.processedMessageIds.size > this.MAX_CACHED_IDS) {
              const first = this.processedMessageIds.values().next().value;
              if (first) this.processedMessageIds.delete(first);
            }

            // 缓存 context_token（回复时必须回传）
            const senderId = msg.from_user_id || '';
            if (msg.context_token && senderId) {
              this.contextTokenCache.set(senderId, msg.context_token);
              console.log(`[WechatPersonal] 缓存 context_token: sender=${senderId}, token=${msg.context_token.substring(0, 20)}...`);
            }
            // 缓存会话信息
            if (senderId) {
              this.sessionCache.set(senderId, {
                sessionId: msg.session_id,
                toUserId: msg.to_user_id,
              });
            }

            const standardMsg = this.parseWeixinMessage(msg);
            if (standardMsg) {
              console.log(`[WechatPersonal] 收到用户消息: sender=${senderId}, content=${standardMsg.content.substring(0, 50)}`);
              onMessage(standardMsg).catch((err) => {
                console.error('[WechatPersonal] 消息处理失败:', err);
              });
            }
          }
        }
      } catch (err) {
        if (this.abortController?.signal.aborted) {
          console.log('[WechatPersonal] 轮询循环被中止');
          break;
        }

        consecutiveFailures++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[WechatPersonal] 轮询 #${pollCount} 失败 (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, errMsg);

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.warn(`[WechatPersonal] 连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，等待 ${BACKOFF_DELAY_MS / 1000}s 后重试`);
          await this.sleep(BACKOFF_DELAY_MS);
          consecutiveFailures = 0;
        } else {
          await this.sleep(2000);
        }
      }
    }

    console.log(`[WechatPersonal] 轮询循环结束, 共执行 ${pollCount} 次`);
    this.connected = false;
  }

  /**
   * 停止轮询
   */
  async disconnect(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.connected = false;
    console.log('[WechatPersonal] 长轮询已停止');
  }

  /**
   * 当前是否已连接
   */
  isConnected(): boolean {
    return this.connected && !!this.abortController && !this.abortController.signal.aborted;
  }

  /**
   * 发送回复消息
   */
  async sendReply(reply: IMReplyRequest, config: IMChannelConfig): Promise<void> {
    const botToken = config.botToken;
    if (!botToken) {
      throw new Error('[WechatPersonal] 未配置 botToken');
    }
    const baseUrl = config.baseUrl || DEFAULT_BASE_URL;

    // 获取缓存的 context_token
    const contextToken = this.contextTokenCache.get(reply.senderId);
    if (!contextToken) {
      console.warn(`[WechatPersonal] 未找到 senderId=${reply.senderId} 的 context_token，尝试发送`);
    }

    // 每条消息生成唯一 client_id（必须，否则服务端可能将后续消息当作重复而丢弃）
    const clientId = generateClientId();

    const msgReq: SendMessageReq = {
      msg: {
        to_user_id: reply.senderId,
        from_user_id: '',  // 必须为空字符串（与原始插件一致）
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: contextToken,
        item_list: [
          {
            type: MessageItemType.TEXT,
            text_item: { text: reply.content },
          },
        ],
      },
    };

    console.log(`[WechatPersonal] 发送消息: to=${reply.senderId}, clientId=${clientId}, hasContextToken=${!!contextToken}, len=${reply.content.length}`);

    await sendMessage({
      baseUrl,
      token: botToken,
      body: msgReq,
    });

    console.log(`[WechatPersonal] 消息发送成功: clientId=${clientId}`);
  }

  /**
   * 解析 WeixinMessage 为 IMStandardMessage
   */
  private parseWeixinMessage(msg: WeixinMessage): IMStandardMessage | null {
    try {
      // 提取文本内容
      let content = '';
      let messageType: 'text' | 'image' | 'unsupported' = 'unsupported';

      if (msg.item_list && msg.item_list.length > 0) {
        for (const item of msg.item_list) {
          if (item.type === MessageItemType.TEXT && item.text_item?.text) {
            content += item.text_item.text;
            messageType = 'text';
          } else if (item.type === MessageItemType.IMAGE) {
            messageType = 'image';
          }
        }
      }

      content = content.trim();
      if (!content && messageType === 'text') return null;

      return {
        platform: 'wechat_personal',
        receiveMode: 'stream',
        senderId: msg.from_user_id || '',
        content,
        messageType,
        originalMessageId: String(msg.message_id || msg.seq || ''),
        conversationId: msg.session_id || '',
        timestamp: msg.create_time_ms || Date.now(),
        rawPayload: msg,
      };
    } catch (err) {
      console.error('[WechatPersonal] 消息解析失败:', err);
      return null;
    }
  }

  /** 加载持久化的 syncBuf */
  private async loadSyncBuf(): Promise<string | undefined> {
    try {
      const data = await fs.readFile(SYNC_BUF_FILE, 'utf8');
      const parsed = JSON.parse(data);
      return parsed.syncBuf;
    } catch {
      return undefined;
    }
  }

  /** 保存 syncBuf 到磁盘 */
  private async saveSyncBuf(buf: string): Promise<void> {
    try {
      await fs.mkdir(SYNC_BUF_DIR, { recursive: true });
      await fs.writeFile(SYNC_BUF_FILE, JSON.stringify({ syncBuf: buf, updatedAt: new Date().toISOString() }), 'utf8');
    } catch (err) {
      console.warn('[WechatPersonal] 保存 syncBuf 失败:', err);
    }
  }

  /** 休眠 */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // 如果 abort 了就提前 resolve
      const onAbort = () => { clearTimeout(timer); resolve(); };
      this.abortController?.signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/** 全局单例（挂载到 globalThis 防止 Next.js HMR 重建丢失） */
const _globalKey = '__wechat_personal_stream_adapter__';
const _adapter: WechatPersonalStreamAdapter =
  (globalThis as any)[_globalKey] ??
  ((globalThis as any)[_globalKey] = new WechatPersonalStreamAdapter());
export default _adapter;

import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import type { NextRequest } from 'next/server';
import type { WebhookAdapter, VerifyResult, ChallengeResult } from '../adapter';
import type { IMChannelConfig, IMReplyRequest, IMStandardMessage } from '../types';

/** 微信 XML 消息结构 */
interface WechatXMLMessage {
  xml: {
    ToUserName: string;
    FromUserName: string;
    CreateTime: number;
    MsgType: string;
    Content?: string;
    MsgId?: string | number;
    PicUrl?: string;
    MediaId?: string;
    Event?: string;
    EventKey?: string;
  };
}

/** access_token 缓存 */
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * 验证微信签名
 * 算法：SHA1(sort([token, timestamp, nonce]).join(''))
 * 导出以便测试可以直接验证
 */
export function verifyWechatSignature(
  token: string,
  timestamp: string,
  nonce: string,
  signature: string
): boolean {
  const arr = [token, timestamp, nonce].sort();
  const str = arr.join('');
  const hash = createHash('sha1').update(str).digest('hex');
  return hash === signature;
}

/**
 * 解析微信 XML 消息
 * 导出以便测试可以直接验证
 */
export function parseWechatXML(xmlString: string): WechatXMLMessage | null {
  try {
    const parser = new XMLParser({
      // 不将数字字符串自动转为数字，保留 MsgId 精度
      parseTagValue: false,
    });
    const result = parser.parse(xmlString);
    if (!result?.xml) return null;
    return result as WechatXMLMessage;
  } catch (err) {
    console.error('[WeChat] XML 解析失败:', err);
    return null;
  }
}

/**
 * 获取微信 access_token（带内存缓存）
 */
async function getAccessToken(appId: string, appSecret: string): Promise<string> {
  // 检查缓存是否有效（提前 5 分钟刷新）
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 5 * 60 * 1000) {
    return cachedAccessToken.token;
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[WeChat] 获取 access_token 失败: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };

  if (data.errcode || !data.access_token) {
    throw new Error(`[WeChat] 获取 access_token 失败: ${data.errcode} ${data.errmsg}`);
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
  };

  return cachedAccessToken.token;
}

/**
 * 微信 Webhook 适配器
 * 实现签名验证、echostr 验证、XML 消息解析和客服消息 API 回复
 */
class WechatWebhookAdapter implements WebhookAdapter {
  readonly platform = 'wechat' as const;
  readonly receiveMode = 'webhook' as const;

  /**
   * 验证微信 Webhook 请求签名
   * 同时检查时间戳防重放（5 分钟窗口）
   */
  async verifySignature(request: NextRequest, config: IMChannelConfig): Promise<VerifyResult> {
    const url = new URL(request.url);
    const signature = url.searchParams.get('signature') || '';
    const timestamp = url.searchParams.get('timestamp') || '';
    const nonce = url.searchParams.get('nonce') || '';

    // 时间戳防重放检查（5 分钟窗口）
    const requestTime = parseInt(timestamp, 10);
    if (!isNaN(requestTime)) {
      const serverTime = Math.floor(Date.now() / 1000);
      if (Math.abs(serverTime - requestTime) > 300) {
        return { valid: false, error: '请求时间戳已过期，可能为重放攻击' };
      }
    }

    if (!verifyWechatSignature(config.token, timestamp, nonce, signature)) {
      return { valid: false, error: '签名验证失败' };
    }

    return { valid: true };
  }

  /**
   * 处理微信 echostr 验证（GET 请求）
   * 微信接入验证：验证签名后返回 echostr
   */
  async handleChallenge(request: NextRequest, config: IMChannelConfig): Promise<ChallengeResult> {
    // 仅 GET 请求为 challenge 验证
    if (request.method !== 'GET') {
      return { isChallenge: false };
    }

    const url = new URL(request.url);
    const echostr = url.searchParams.get('echostr') || '';
    const signature = url.searchParams.get('signature') || '';
    const timestamp = url.searchParams.get('timestamp') || '';
    const nonce = url.searchParams.get('nonce') || '';

    // 没有 echostr 参数则不是 challenge 请求
    if (!echostr) {
      return { isChallenge: false };
    }

    // 验证签名
    if (!verifyWechatSignature(config.token, timestamp, nonce, signature)) {
      return {
        isChallenge: true,
        response: new Response('签名验证失败', { status: 401 }),
      };
    }

    // 签名验证通过，返回 echostr
    return {
      isChallenge: true,
      response: new Response(echostr, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    };
  }

  /**
   * 解析微信 XML 消息为标准消息格式
   */
  async parseMessage(request: NextRequest, _config: IMChannelConfig): Promise<IMStandardMessage | null> {
    try {
      const body = await request.text();
      const parsed = parseWechatXML(body);

      if (!parsed?.xml) {
        console.error('[WeChat] 无法解析消息体');
        return null;
      }

      const msg = parsed.xml;

      // 事件消息不作为用户消息处理
      if (msg.MsgType === 'event') {
        return null;
      }

      // 判断消息类型
      const messageType = msg.MsgType === 'text' ? 'text' as const : 'unsupported' as const;

      return {
        platform: 'wechat',
        receiveMode: 'webhook',
        senderId: msg.FromUserName || '',
        content: messageType === 'text' ? (msg.Content || '').trim() : '',
        messageType,
        originalMessageId: String(msg.MsgId || ''),
        conversationId: msg.FromUserName || '',
        timestamp: Number(msg.CreateTime) * 1000 || Date.now(),
        rawPayload: parsed,
      };
    } catch (err) {
      console.error('[WeChat] 消息解析失败:', err);
      return null;
    }
  }

  /**
   * 通过微信客服消息 API 发送回复
   */
  async sendReply(reply: IMReplyRequest, config: IMChannelConfig): Promise<void> {
    const accessToken = await getAccessToken(config.appId, config.appSecret);

    const body = {
      touser: reply.senderId,
      msgtype: 'text',
      text: {
        content: reply.content,
      },
    };

    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[WeChat] 客服消息发送失败: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { errcode?: number; errmsg?: string };

    // errcode 42001 表示 access_token 过期，清除缓存以便下次刷新
    if (data.errcode === 42001) {
      cachedAccessToken = null;
      throw new Error(`[WeChat] access_token 已过期: ${data.errmsg}`);
    }

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`[WeChat] 客服消息发送失败: ${data.errcode} ${data.errmsg}`);
    }
  }
}

/** 清除 access_token 缓存（用于测试） */
export function clearAccessTokenCache(): void {
  cachedAccessToken = null;
}

export default new WechatWebhookAdapter();

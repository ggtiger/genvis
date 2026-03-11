import { createHash, createDecipheriv } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import type { NextRequest } from 'next/server';
import type { WebhookAdapter, VerifyResult, ChallengeResult } from '../adapter';
import type { IMChannelConfig, IMReplyRequest, IMStandardMessage } from '../types';

/** 企业微信加密 XML 消息结构 */
interface WecomEncryptedXML {
  xml: {
    ToUserName?: string;
    Encrypt: string;
    AgentID?: string;
  };
}

/** 企业微信解密后的消息结构 */
interface WecomDecryptedMessage {
  xml: {
    ToUserName?: string;
    FromUserName?: string;
    CreateTime?: string | number;
    MsgType?: string;
    Content?: string;
    MsgId?: string | number;
    AgentID?: string | number;
    PicUrl?: string;
    MediaId?: string;
    Event?: string;
    EventKey?: string;
  };
}

/** access_token 缓存 */
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * 验证企业微信签名
 * 算法：SHA1(sort([token, timestamp, nonce, encrypt_msg]).join(''))
 * 导出以便测试可以直接验证
 */
export function verifyWecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encryptMsg: string,
  msgSignature: string
): boolean {
  const arr = [token, timestamp, nonce, encryptMsg].sort();
  const str = arr.join('');
  const hash = createHash('sha1').update(str).digest('hex');
  return hash === msgSignature;
}

/**
 * 从 encodingAESKey 派生 AES 密钥
 * encodingAESKey 是 Base64 编码的 43 字符字符串，解码后得到 32 字节密钥
 */
function deriveAESKey(encodingAESKey: string): Buffer {
  return Buffer.from(encodingAESKey + '=', 'base64');
}

/**
 * 解密企业微信消息
 * 使用 AES-256-CBC，密钥由 encodingAESKey 派生，IV 为密钥前 16 字节
 * 解密后格式：16 字节随机串 + 4 字节消息长度（网络字节序）+ 消息明文 + corpId
 * 导出以便测试可以直接验证
 */
export function decryptWecomMessage(encodingAESKey: string, encryptedMsg: string): string {
  const aesKey = deriveAESKey(encodingAESKey);
  const iv = aesKey.subarray(0, 16);

  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);

  const encryptedBuffer = Buffer.from(encryptedMsg, 'base64');
  const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);

  // 去除 PKCS#7 填充
  const padLen = decrypted[decrypted.length - 1];
  const unpadded = decrypted.subarray(0, decrypted.length - padLen);

  // 跳过 16 字节随机串，读取 4 字节消息长度（大端序）
  const msgLen = unpadded.readUInt32BE(16);

  // 提取消息明文（从第 20 字节开始，长度为 msgLen）
  const message = unpadded.subarray(20, 20 + msgLen).toString('utf-8');

  return message;
}

/**
 * 解析企业微信 XML 消息
 * 导出以便测试可以直接验证
 */
export function parseWecomXML(xmlString: string): WecomEncryptedXML | WecomDecryptedMessage | null {
  try {
    const parser = new XMLParser({
      // 不将数字字符串自动转为数字，保留 MsgId 精度
      parseTagValue: false,
    });
    const result = parser.parse(xmlString);
    if (!result?.xml) return null;
    return result as WecomEncryptedXML | WecomDecryptedMessage;
  } catch (err) {
    console.error('[WeCom] XML 解析失败:', err);
    return null;
  }
}

/**
 * 获取企业微信 access_token（带内存缓存）
 */
async function getAccessToken(corpId: string, corpSecret: string): Promise<string> {
  // 检查缓存是否有效（提前 5 分钟刷新）
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 5 * 60 * 1000) {
    return cachedAccessToken.token;
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[WeCom] 获取 access_token 失败: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };

  if (data.errcode || !data.access_token) {
    throw new Error(`[WeCom] 获取 access_token 失败: ${data.errcode} ${data.errmsg}`);
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
  };

  return cachedAccessToken.token;
}

/**
 * 企业微信 Webhook 适配器
 * 实现签名验证（含加解密）、验证请求处理、XML 消息解析和应用消息 API 回复
 */
class WecomWebhookAdapter implements WebhookAdapter {
  readonly platform = 'wecom' as const;
  readonly receiveMode = 'webhook' as const;

  /**
   * 验证企业微信 Webhook 请求签名
   * 同时检查时间戳防重放（5 分钟窗口）
   */
  async verifySignature(request: NextRequest, config: IMChannelConfig): Promise<VerifyResult> {
    const url = new URL(request.url);
    const msgSignature = url.searchParams.get('msg_signature') || '';
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

    // POST 请求需要从 body 中提取 Encrypt 字段参与签名验证
    let encryptMsg = '';
    if (request.method === 'POST') {
      try {
        const body = await request.clone().text();
        const parsed = parseWecomXML(body);
        if (parsed && 'Encrypt' in (parsed as WecomEncryptedXML).xml) {
          encryptMsg = (parsed as WecomEncryptedXML).xml.Encrypt;
        }
      } catch {
        return { valid: false, error: '无法解析请求体' };
      }
    }

    if (!verifyWecomSignature(config.token, timestamp, nonce, encryptMsg, msgSignature)) {
      return { valid: false, error: '签名验证失败' };
    }

    return { valid: true };
  }

  /**
   * 处理企业微信验证请求（GET 请求）
   * 企业微信接入验证：验证签名后解密 echostr 并返回明文
   */
  async handleChallenge(request: NextRequest, config: IMChannelConfig): Promise<ChallengeResult> {
    // 仅 GET 请求为 challenge 验证
    if (request.method !== 'GET') {
      return { isChallenge: false };
    }

    const url = new URL(request.url);
    const msgSignature = url.searchParams.get('msg_signature') || '';
    const timestamp = url.searchParams.get('timestamp') || '';
    const nonce = url.searchParams.get('nonce') || '';
    const echostr = url.searchParams.get('echostr') || '';

    // 没有 echostr 参数则不是 challenge 请求
    if (!echostr) {
      return { isChallenge: false };
    }

    // 验证签名（echostr 参与签名计算）
    if (!verifyWecomSignature(config.token, timestamp, nonce, echostr, msgSignature)) {
      return {
        isChallenge: true,
        response: new Response('签名验证失败', { status: 401 }),
      };
    }

    // 解密 echostr 获取明文
    try {
      if (!config.encodingAESKey) {
        return {
          isChallenge: true,
          response: new Response('缺少 encodingAESKey 配置', { status: 500 }),
        };
      }
      const decrypted = decryptWecomMessage(config.encodingAESKey, echostr);
      return {
        isChallenge: true,
        response: new Response(decrypted, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      };
    } catch (err) {
      console.error('[WeCom] echostr 解密失败:', err);
      return {
        isChallenge: true,
        response: new Response('解密失败', { status: 500 }),
      };
    }
  }

  /**
   * 解析企业微信消息为标准消息格式
   * 企业微信消息体为加密 XML，需先解密再解析
   */
  async parseMessage(request: NextRequest, config: IMChannelConfig): Promise<IMStandardMessage | null> {
    try {
      const body = await request.text();
      const parsed = parseWecomXML(body);

      if (!parsed?.xml) {
        console.error('[WeCom] 无法解析消息体');
        return null;
      }

      // 检查是否为加密消息（含 Encrypt 字段）
      const encryptedXml = parsed as WecomEncryptedXML;
      if (!encryptedXml.xml.Encrypt) {
        console.error('[WeCom] 消息体缺少 Encrypt 字段');
        return null;
      }

      if (!config.encodingAESKey) {
        console.error('[WeCom] 缺少 encodingAESKey 配置，无法解密消息');
        return null;
      }

      // 解密消息
      const decryptedXmlStr = decryptWecomMessage(config.encodingAESKey, encryptedXml.xml.Encrypt);
      const decryptedParsed = parseWecomXML(decryptedXmlStr) as WecomDecryptedMessage | null;

      if (!decryptedParsed?.xml) {
        console.error('[WeCom] 解密后的消息无法解析');
        return null;
      }

      const msg = decryptedParsed.xml;

      // 事件消息不作为用户消息处理
      if (msg.MsgType === 'event') {
        return null;
      }

      // 判断消息类型
      const messageType = msg.MsgType === 'text' ? 'text' as const : 'unsupported' as const;

      return {
        platform: 'wecom',
        receiveMode: 'webhook',
        senderId: msg.FromUserName || '',
        content: messageType === 'text' ? (msg.Content || '').trim() : '',
        messageType,
        originalMessageId: String(msg.MsgId || ''),
        conversationId: msg.FromUserName || '',
        timestamp: Number(msg.CreateTime) * 1000 || Date.now(),
        rawPayload: decryptedParsed,
      };
    } catch (err) {
      console.error('[WeCom] 消息解析失败:', err);
      return null;
    }
  }

  /**
   * 通过企业微信应用消息 API 发送回复
   */
  async sendReply(reply: IMReplyRequest, config: IMChannelConfig): Promise<void> {
    const accessToken = await getAccessToken(config.appId, config.appSecret);

    // 企业微信应用消息 API 需要 agentid
    const agentId = config.extra?.agentId || '';

    const body = {
      touser: reply.senderId,
      msgtype: 'text',
      agentid: agentId,
      text: {
        content: reply.content,
      },
    };

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[WeCom] 应用消息发送失败: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { errcode?: number; errmsg?: string };

    // errcode 42001 表示 access_token 过期，清除缓存以便下次刷新
    if (data.errcode === 42001) {
      cachedAccessToken = null;
      throw new Error(`[WeCom] access_token 已过期: ${data.errmsg}`);
    }

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`[WeCom] 应用消息发送失败: ${data.errcode} ${data.errmsg}`);
    }
  }
}

/** 清除 access_token 缓存（用于测试） */
export function clearAccessTokenCache(): void {
  cachedAccessToken = null;
}

export default new WecomWebhookAdapter();

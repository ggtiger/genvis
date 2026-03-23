/**
 * 微信 ilink HTTP API 客户端
 * 直接调用 ilink API，不依赖 OpenClaw
 */
import crypto from 'crypto';
import {
  DEFAULT_BASE_URL,
  DEFAULT_LONG_POLL_TIMEOUT_MS,
  DEFAULT_API_TIMEOUT_MS,
  type BaseInfo,
  type GetUpdatesReq,
  type GetUpdatesResp,
  type SendMessageReq,
  type QRCodeStatusResp,
} from './types';

/** channel_version 标识（随请求附带） */
const CHANNEL_VERSION = '1.0.0';
function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION };
}

/** 构建 ilink 请求头 */
function buildHeaders(opts: { token?: string; body: string }): Record<string, string> {
  // X-WECHAT-UIN: random uint32 -> 十进制字符串 -> base64（与原始插件保持一致）
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  const wechatUin = Buffer.from(String(uint32), 'utf-8').toString('base64');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(opts.body, 'utf-8')),
    'X-WECHAT-UIN': wechatUin,
  };

  if (opts.token?.trim()) {
    headers['Authorization'] = `Bearer ${opts.token.trim()}`;
  }

  return headers;
}

/** 长轮询获取消息 */
export async function getUpdates(params: {
  baseUrl?: string;
  token?: string;
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
  signal?: AbortSignal;
}): Promise<GetUpdatesResp> {
  const baseUrl = params.baseUrl || DEFAULT_BASE_URL;
  const timeoutMs = params.longpolling_timeout_ms || DEFAULT_LONG_POLL_TIMEOUT_MS;

  const reqBody: GetUpdatesReq = {
    get_updates_buf: params.get_updates_buf ?? '',
    longpolling_timeout_ms: timeoutMs,
    base_info: buildBaseInfo(),
  };

  const bodyStr = JSON.stringify(reqBody);
  const headers = buildHeaders({ token: params.token, body: bodyStr });

  // 长轮询需要更大的超时（比 server 端超时多 10s 的余量）
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), timeoutMs + 10_000);

  // 如果外部传入 signal，监听它来中止
  const onExternalAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onExternalAbort);

  try {
    const resp = await fetch(`${baseUrl}/ilink/bot/getupdates`, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`[WechatPersonal] getUpdates 失败: ${resp.status} ${text}`);
    }

    return (await resp.json()) as GetUpdatesResp;
  } finally {
    clearTimeout(fetchTimeout);
    params.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** 发送消息 */
export async function sendMessage(params: {
  baseUrl?: string;
  token?: string;
  body: SendMessageReq;
}): Promise<void> {
  const baseUrl = params.baseUrl || DEFAULT_BASE_URL;
  // 注入 base_info 到请求体根层
  const fullBody = { ...params.body, base_info: buildBaseInfo() };
  const bodyStr = JSON.stringify(fullBody);
  const headers = buildHeaders({ token: params.token, body: bodyStr });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_API_TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseUrl}/ilink/bot/sendmessage`, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });

    const rawText = await resp.text();

    if (!resp.ok) {
      throw new Error(`[WechatPersonal] sendMessage 失败: ${resp.status} ${rawText}`);
    }

    // 检查响应体中的错误
    try {
      const result = JSON.parse(rawText) as { ret?: number; errcode?: number; errmsg?: string };
      if ((result.ret && result.ret !== 0) || (result.errcode && result.errcode !== 0)) {
        console.warn(`[WechatPersonal] sendMessage 服务端返回异常: ret=${result.ret}, errcode=${result.errcode}, errmsg=${result.errmsg}`);
      }
    } catch {
      // 响应体非 JSON 时忽略
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** 获取 QR 码登录链接 */
export async function getQRCode(baseUrl?: string): Promise<{ qrcode: string; qrcodeUrl: string }> {
  const base = baseUrl || DEFAULT_BASE_URL;
  const url = `${base}/ilink/bot/get_bot_qrcode?bot_type=3`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_API_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`[WechatPersonal] getQRCode 失败: ${resp.status} ${text}`);
    }

    // API 返回 { qrcode: "token...", qrcode_img_content: "https://..." }
    const data = (await resp.json()) as { qrcode?: string; qrcode_img_content?: string };
    const qrcode = data.qrcode || '';
    const qrcodeUrl = data.qrcode_img_content || '';

    if (!qrcode || !qrcodeUrl) {
      throw new Error(`[WechatPersonal] getQRCode 返回不完整: qrcode=${!!qrcode}, qrcodeUrl=${!!qrcodeUrl}`);
    }

    console.log(`[WechatPersonal] QR 码获取成功, qrcode=${qrcode.substring(0, 20)}..., imgUrl=${qrcodeUrl.substring(0, 60)}...`);
    return { qrcode, qrcodeUrl };
  } finally {
    clearTimeout(timeout);
  }
}

/** QR 码长轮询超时（与 ilink 服务端匹配） */
const QR_LONG_POLL_TIMEOUT_MS = 35_000;

/** 轮询 QR 码扫码状态（长轮询，超时返回 wait） */
export async function pollQRStatus(params: {
  baseUrl?: string;
  qrcode: string;
}): Promise<QRCodeStatusResp> {
  const base = params.baseUrl || DEFAULT_BASE_URL;
  const url = `${base}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: { 'iLink-App-ClientVersion': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`[WechatPersonal] pollQRStatus 失败: ${resp.status} ${text}`);
    }

    return (await resp.json()) as QRCodeStatusResp;
  } catch (err) {
    clearTimeout(timer);
    // 长轮询超时是正常现象，返回 wait 继续下一轮
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'wait' };
    }
    throw err;
  }
}

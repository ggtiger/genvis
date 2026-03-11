import { describe, it, expect } from 'vitest';
import { createHash, createCipheriv, randomBytes } from 'crypto';
import {
  verifyWecomSignature,
  decryptWecomMessage,
  parseWecomXML,
} from '../adapters/wecom-webhook';

/**
 * 辅助函数：计算企业微信签名
 * SHA1(sort([token, timestamp, nonce, encrypt_msg]).join(''))
 */
function computeWecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encryptMsg: string
): string {
  const arr = [token, timestamp, nonce, encryptMsg].sort();
  return createHash('sha1').update(arr.join('')).digest('hex');
}

/**
 * 辅助函数：使用企业微信加密算法加密消息
 * 格式：16 字节随机串 + 4 字节消息长度（大端序）+ 消息明文 + corpId + PKCS#7 填充
 */
function encryptWecomMessage(
  encodingAESKey: string,
  message: string,
  corpId: string
): string {
  const aesKey = Buffer.from(encodingAESKey + '=', 'base64');
  const iv = aesKey.subarray(0, 16);

  const randomPrefix = randomBytes(16);
  const msgBuffer = Buffer.from(message, 'utf-8');
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32BE(msgBuffer.length, 0);
  const corpIdBuffer = Buffer.from(corpId, 'utf-8');

  // 拼接：随机串 + 长度 + 消息 + corpId
  const plaintext = Buffer.concat([randomPrefix, msgLen, msgBuffer, corpIdBuffer]);

  // PKCS#7 填充到 32 字节对齐
  const blockSize = 32;
  const padLen = blockSize - (plaintext.length % blockSize);
  const padding = Buffer.alloc(padLen, padLen);
  const padded = Buffer.concat([plaintext, padding]);

  const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

  return encrypted.toString('base64');
}

// 测试用 encodingAESKey（43 字符 base64 安全字符串）
const TEST_ENCODING_AES_KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const TEST_CORP_ID = 'wx1234567890abcdef';

describe('verifyWecomSignature', () => {
  const token = 'test_wecom_token';
  const timestamp = '1234567890';
  const nonce = 'abc123';
  const encryptMsg = 'encrypted_content_here';

  it('正确签名应验证通过', () => {
    const signature = computeWecomSignature(token, timestamp, nonce, encryptMsg);
    expect(verifyWecomSignature(token, timestamp, nonce, encryptMsg, signature)).toBe(true);
  });

  it('错误签名应验证失败', () => {
    expect(verifyWecomSignature(token, timestamp, nonce, encryptMsg, 'wrong_sig')).toBe(false);
  });

  it('空签名应验证失败', () => {
    expect(verifyWecomSignature(token, timestamp, nonce, encryptMsg, '')).toBe(false);
  });

  it('不同 token 应验证失败', () => {
    const signature = computeWecomSignature(token, timestamp, nonce, encryptMsg);
    expect(verifyWecomSignature('other_token', timestamp, nonce, encryptMsg, signature)).toBe(false);
  });

  it('空 encryptMsg 应正确计算签名（用于无加密场景）', () => {
    const signature = computeWecomSignature(token, timestamp, nonce, '');
    expect(verifyWecomSignature(token, timestamp, nonce, '', signature)).toBe(true);
  });

  it('encryptMsg 参与排序应正确', () => {
    const encrypt = 'zzz_encrypt';
    const sig = computeWecomSignature(token, timestamp, nonce, encrypt);
    expect(verifyWecomSignature(token, timestamp, nonce, encrypt, sig)).toBe(true);
  });
});

describe('decryptWecomMessage', () => {
  it('应正确解密加密消息', () => {
    const originalMessage = '你好，这是一条测试消息';
    const encrypted = encryptWecomMessage(TEST_ENCODING_AES_KEY, originalMessage, TEST_CORP_ID);
    const decrypted = decryptWecomMessage(TEST_ENCODING_AES_KEY, encrypted);
    expect(decrypted).toBe(originalMessage);
  });

  it('应正确解密空消息', () => {
    const encrypted = encryptWecomMessage(TEST_ENCODING_AES_KEY, '', TEST_CORP_ID);
    const decrypted = decryptWecomMessage(TEST_ENCODING_AES_KEY, encrypted);
    expect(decrypted).toBe('');
  });

  it('应正确解密长消息', () => {
    const longMessage = '这是一条很长的消息'.repeat(100);
    const encrypted = encryptWecomMessage(TEST_ENCODING_AES_KEY, longMessage, TEST_CORP_ID);
    const decrypted = decryptWecomMessage(TEST_ENCODING_AES_KEY, encrypted);
    expect(decrypted).toBe(longMessage);
  });

  it('应正确解密包含特殊字符的消息', () => {
    const message = '<xml>特殊字符 & "引号" \'单引号\' 换行\n制表\t</xml>';
    const encrypted = encryptWecomMessage(TEST_ENCODING_AES_KEY, message, TEST_CORP_ID);
    const decrypted = decryptWecomMessage(TEST_ENCODING_AES_KEY, encrypted);
    expect(decrypted).toBe(message);
  });

  it('错误的 encodingAESKey 应抛出异常', () => {
    const encrypted = encryptWecomMessage(TEST_ENCODING_AES_KEY, 'test', TEST_CORP_ID);
    const wrongKey = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg';
    expect(() => decryptWecomMessage(wrongKey, encrypted)).toThrow();
  });
});

describe('parseWecomXML', () => {
  it('应正确解析加密消息 XML', () => {
    const xml = `<xml>
      <ToUserName><![CDATA[corp_id]]></ToUserName>
      <Encrypt><![CDATA[encrypted_content]]></Encrypt>
      <AgentID><![CDATA[1000002]]></AgentID>
    </xml>`;

    const result = parseWecomXML(xml);
    expect(result).not.toBeNull();
    expect((result as any).xml.ToUserName).toBe('corp_id');
    expect((result as any).xml.Encrypt).toBe('encrypted_content');
    expect((result as any).xml.AgentID).toBe('1000002');
  });

  it('应正确解析解密后的文本消息 XML', () => {
    const xml = `<xml>
      <ToUserName><![CDATA[corp_id]]></ToUserName>
      <FromUserName><![CDATA[user_id]]></FromUserName>
      <CreateTime>1348831860</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[你好]]></Content>
      <MsgId>1234567890123456</MsgId>
      <AgentID>1000002</AgentID>
    </xml>`;

    const result = parseWecomXML(xml);
    expect(result).not.toBeNull();
    expect((result as any).xml.FromUserName).toBe('user_id');
    expect((result as any).xml.MsgType).toBe('text');
    expect((result as any).xml.Content).toBe('你好');
  });

  it('无效 XML 应返回 null', () => {
    expect(parseWecomXML('not xml at all')).toBeNull();
  });

  it('空字符串应返回 null', () => {
    expect(parseWecomXML('')).toBeNull();
  });

  it('缺少 xml 根节点应返回 null', () => {
    expect(parseWecomXML('<root><data>test</data></root>')).toBeNull();
  });

  it('应保留 MsgId 为字符串（避免精度丢失）', () => {
    const xml = `<xml>
      <ToUserName><![CDATA[corp_id]]></ToUserName>
      <FromUserName><![CDATA[user_id]]></FromUserName>
      <CreateTime>1348831860</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[test]]></Content>
      <MsgId>6305058210572877824</MsgId>
    </xml>`;

    const result = parseWecomXML(xml);
    expect(result).not.toBeNull();
    expect(typeof (result as any).xml.MsgId).toBe('string');
  });
});

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { verifyWechatSignature, parseWechatXML } from '../adapters/wechat-webhook';

/**
 * 辅助函数：根据 token、timestamp、nonce 计算正确的微信签名
 */
function computeSignature(token: string, timestamp: string, nonce: string): string {
  const arr = [token, timestamp, nonce].sort();
  return createHash('sha1').update(arr.join('')).digest('hex');
}

describe('verifyWechatSignature', () => {
  const token = 'test_token';
  const timestamp = '1234567890';
  const nonce = 'abc123';

  it('正确签名应验证通过', () => {
    const signature = computeSignature(token, timestamp, nonce);
    expect(verifyWechatSignature(token, timestamp, nonce, signature)).toBe(true);
  });

  it('错误签名应验证失败', () => {
    expect(verifyWechatSignature(token, timestamp, nonce, 'wrong_signature')).toBe(false);
  });

  it('空签名应验证失败', () => {
    expect(verifyWechatSignature(token, timestamp, nonce, '')).toBe(false);
  });

  it('不同 token 应验证失败', () => {
    const signature = computeSignature(token, timestamp, nonce);
    expect(verifyWechatSignature('other_token', timestamp, nonce, signature)).toBe(false);
  });

  it('排序应正确处理各种输入', () => {
    // 确保 sort 是字典序
    const sig = computeSignature('z_token', '1', 'a_nonce');
    expect(verifyWechatSignature('z_token', '1', 'a_nonce', sig)).toBe(true);
  });
});

describe('parseWechatXML', () => {
  it('应正确解析文本消息', () => {
    const xml = `<xml>
      <ToUserName><![CDATA[gh_test]]></ToUserName>
      <FromUserName><![CDATA[user_openid]]></FromUserName>
      <CreateTime>1348831860</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[你好]]></Content>
      <MsgId>1234567890123456</MsgId>
    </xml>`;

    const result = parseWechatXML(xml);
    expect(result).not.toBeNull();
    expect(result!.xml.ToUserName).toBe('gh_test');
    expect(result!.xml.FromUserName).toBe('user_openid');
    expect(result!.xml.MsgType).toBe('text');
    expect(result!.xml.Content).toBe('你好');
    expect(result!.xml.MsgId).toBeDefined();
  });

  it('应正确解析图片消息', () => {
    const xml = `<xml>
      <ToUserName><![CDATA[gh_test]]></ToUserName>
      <FromUserName><![CDATA[user_openid]]></FromUserName>
      <CreateTime>1348831860</CreateTime>
      <MsgType><![CDATA[image]]></MsgType>
      <PicUrl><![CDATA[http://example.com/pic.jpg]]></PicUrl>
      <MediaId><![CDATA[media_id_123]]></MediaId>
      <MsgId>1234567890123456</MsgId>
    </xml>`;

    const result = parseWechatXML(xml);
    expect(result).not.toBeNull();
    expect(result!.xml.MsgType).toBe('image');
    expect(result!.xml.PicUrl).toBe('http://example.com/pic.jpg');
  });

  it('无效 XML 应返回 null', () => {
    expect(parseWechatXML('not xml at all')).toBeNull();
  });

  it('空字符串应返回 null', () => {
    expect(parseWechatXML('')).toBeNull();
  });

  it('缺少 xml 根节点应返回 null', () => {
    expect(parseWechatXML('<root><data>test</data></root>')).toBeNull();
  });

  it('应保留 MsgId 为字符串（避免精度丢失）', () => {
    const xml = `<xml>
      <ToUserName><![CDATA[gh_test]]></ToUserName>
      <FromUserName><![CDATA[user_openid]]></FromUserName>
      <CreateTime>1348831860</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[test]]></Content>
      <MsgId>6305058210572877824</MsgId>
    </xml>`;

    const result = parseWechatXML(xml);
    expect(result).not.toBeNull();
    // parseTagValue: false 确保数字不被自动转换
    expect(typeof result!.xml.MsgId).toBe('string');
  });
});

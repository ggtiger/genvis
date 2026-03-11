/**
 * Property-based tests for DingTalk Stream message parsing completeness.
 *
 * **Feature: im-channel-integration, Property 4: 消息解析完整性（钉钉 Stream）**
 * **Validates: Requirements 3.1, 3.6**
 *
 * For any valid DingTalk robot message payload received via Stream,
 * the parsed IMStandardMessage should contain all required fields
 * (platform, receiveMode, senderId, content, messageType, originalMessageId,
 * conversationId, timestamp), with platform === 'dingtalk' and
 * receiveMode === 'stream'.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseDingTalkRobotMessage } from '../adapters/dingtalk-stream';
import type { IMStandardMessage } from '../types';
import type { RobotMessage } from 'dingtalk-stream-sdk-nodejs';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Non-empty alphanumeric string for IDs */
const nonEmptyIdArb = fc.string({ minLength: 1, maxLength: 64 }).filter(s => s.trim().length > 0);

/** Arbitrary text content (may include unicode, spaces, etc.) */
const contentArb = fc.string({ minLength: 1, maxLength: 500 });

/** Positive integer timestamp */
const timestampArb = fc.integer({ min: 1_000_000_000_000, max: 9_999_999_999_999 });

/**
 * Generator for a valid DingTalk RobotTextMessage payload.
 * Matches the RobotMessage type from dingtalk-stream-sdk-nodejs.
 */
const dingtalkTextMessageArb = fc.record({
  conversationId: nonEmptyIdArb,
  chatbotCorpId: nonEmptyIdArb,
  chatbotUserId: nonEmptyIdArb,
  msgId: nonEmptyIdArb,
  senderNick: fc.string({ minLength: 1, maxLength: 32 }),
  isAdmin: fc.boolean(),
  senderStaffId: nonEmptyIdArb,
  sessionWebhookExpiredTime: timestampArb,
  createAt: timestampArb,
  senderCorpId: nonEmptyIdArb,
  conversationType: fc.constantFrom('1', '2'),
  senderId: nonEmptyIdArb,
  sessionWebhook: fc.constant('https://oapi.dingtalk.com/robot/sendBySession'),
  robotCode: nonEmptyIdArb,
  msgtype: fc.constant('text' as const),
  text: fc.record({ content: contentArb }),
});

/** Optional headers messageId for fallback */
const headersMessageIdArb: fc.Arbitrary<string | undefined> = fc.oneof(
  nonEmptyIdArb,
  fc.constant(undefined as string | undefined),
);

// ---------------------------------------------------------------------------
// Required fields check helper
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: (keyof IMStandardMessage)[] = [
  'platform',
  'receiveMode',
  'senderId',
  'content',
  'messageType',
  'originalMessageId',
  'conversationId',
  'timestamp',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('消息解析完整性 — 钉钉 Stream (Property 4)', () => {
  it('parsed message contains all required fields for any valid text payload', () => {
    fc.assert(
      fc.property(
        dingtalkTextMessageArb,
        headersMessageIdArb,
        (payload, headersId) => {
          const msg = parseDingTalkRobotMessage(
            payload as unknown as RobotMessage,
            headersId,
          );

          expect(msg).not.toBeNull();
          const parsed = msg!;

          // Every required field must be present and defined
          for (const field of REQUIRED_FIELDS) {
            expect(parsed).toHaveProperty(field);
            expect(parsed[field]).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('platform is always "dingtalk" for DingTalk messages', () => {
    fc.assert(
      fc.property(
        dingtalkTextMessageArb,
        headersMessageIdArb,
        (payload, headersId) => {
          const msg = parseDingTalkRobotMessage(
            payload as unknown as RobotMessage,
            headersId,
          );
          expect(msg).not.toBeNull();
          expect(msg!.platform).toBe('dingtalk');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('receiveMode is always "stream" for DingTalk Stream messages', () => {
    fc.assert(
      fc.property(
        dingtalkTextMessageArb,
        headersMessageIdArb,
        (payload, headersId) => {
          const msg = parseDingTalkRobotMessage(
            payload as unknown as RobotMessage,
            headersId,
          );
          expect(msg).not.toBeNull();
          expect(msg!.receiveMode).toBe('stream');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('senderId is preserved from the original payload', () => {
    fc.assert(
      fc.property(
        dingtalkTextMessageArb,
        headersMessageIdArb,
        (payload, headersId) => {
          const msg = parseDingTalkRobotMessage(
            payload as unknown as RobotMessage,
            headersId,
          );
          expect(msg).not.toBeNull();
          // senderId should come from payload.senderId (primary) or senderStaffId (fallback)
          expect(msg!.senderId).toBe(payload.senderId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('text content is trimmed from the payload', () => {
    fc.assert(
      fc.property(
        dingtalkTextMessageArb,
        headersMessageIdArb,
        (payload, headersId) => {
          const msg = parseDingTalkRobotMessage(
            payload as unknown as RobotMessage,
            headersId,
          );
          expect(msg).not.toBeNull();
          expect(msg!.content).toBe(payload.text.content.trim());
          expect(msg!.messageType).toBe('text');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('originalMessageId uses msgId from payload, falls back to headersMessageId', () => {
    fc.assert(
      fc.property(
        dingtalkTextMessageArb,
        headersMessageIdArb,
        (payload, headersId) => {
          const msg = parseDingTalkRobotMessage(
            payload as unknown as RobotMessage,
            headersId,
          );
          expect(msg).not.toBeNull();
          // msgId is always non-empty in our generator, so it should be used
          expect(msg!.originalMessageId).toBe(payload.msgId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('conversationId is preserved from the payload', () => {
    fc.assert(
      fc.property(
        dingtalkTextMessageArb,
        headersMessageIdArb,
        (payload, headersId) => {
          const msg = parseDingTalkRobotMessage(
            payload as unknown as RobotMessage,
            headersId,
          );
          expect(msg).not.toBeNull();
          expect(msg!.conversationId).toBe(payload.conversationId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('timestamp is preserved from the payload createAt field', () => {
    fc.assert(
      fc.property(
        dingtalkTextMessageArb,
        headersMessageIdArb,
        (payload, headersId) => {
          const msg = parseDingTalkRobotMessage(
            payload as unknown as RobotMessage,
            headersId,
          );
          expect(msg).not.toBeNull();
          expect(msg!.timestamp).toBe(payload.createAt);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rawPayload preserves the original data for downstream use', () => {
    fc.assert(
      fc.property(
        dingtalkTextMessageArb,
        headersMessageIdArb,
        (payload, headersId) => {
          const msg = parseDingTalkRobotMessage(
            payload as unknown as RobotMessage,
            headersId,
          );
          expect(msg).not.toBeNull();
          expect(msg!.rawPayload).toEqual(payload);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ===========================================================================
// 飞书 Stream 消息解析属性测试
// ===========================================================================

/**
 * **Feature: im-channel-integration, Property 4: 消息解析完整性（飞书 Stream）**
 * **Validates: Requirements 3.2, 3.6**
 *
 * For any valid Feishu im.message.receive_v1 event payload received via Stream,
 * the parsed IMStandardMessage should contain all required fields
 * (platform, receiveMode, senderId, content, messageType, originalMessageId,
 * conversationId, timestamp), with platform === 'feishu' and
 * receiveMode === 'stream'.
 */

import { parseFeishuMessageEvent } from '../adapters/feishu-stream';
import { parseQQBotMessage } from '../adapters/qq-stream';

// ---------------------------------------------------------------------------
// 飞书 Generators
// ---------------------------------------------------------------------------

/** 飞书 sender_id 对象生成器（至少包含一个有效 ID） */
const feishuSenderIdArb = fc.record({
  union_id: fc.option(nonEmptyIdArb, { nil: undefined }),
  user_id: fc.option(nonEmptyIdArb, { nil: undefined }),
  open_id: nonEmptyIdArb, // 保证至少有 open_id
});

/** 保证 sender_id 中至少有一个有效 ID 的 sender 生成器 */
const feishuSenderWithIdArb = fc.record({
  sender_id: feishuSenderIdArb,
  sender_type: fc.constantFrom('user', 'app', 'bot'),
  tenant_key: fc.option(nonEmptyIdArb, { nil: undefined }),
});

/** 飞书文本消息内容（JSON 字符串格式） */
const feishuTextContentArb = contentArb.map(text => JSON.stringify({ text }));

/** 飞书 message 对象生成器（文本消息） */
const feishuMessageArb = fc.record({
  message_id: nonEmptyIdArb,
  root_id: fc.option(nonEmptyIdArb, { nil: undefined }),
  parent_id: fc.option(nonEmptyIdArb, { nil: undefined }),
  create_time: timestampArb.map(t => String(t)),
  chat_id: nonEmptyIdArb,
  chat_type: fc.constantFrom('p2p', 'group'),
  message_type: fc.constant('text'),
  content: feishuTextContentArb,
});

/**
 * 飞书 im.message.receive_v1 事件载荷生成器
 */
const feishuMessageEventArb = fc.record({
  event_id: fc.option(nonEmptyIdArb, { nil: undefined }),
  token: fc.option(nonEmptyIdArb, { nil: undefined }),
  create_time: fc.option(timestampArb.map(t => String(t)), { nil: undefined }),
  event_type: fc.option(fc.constant('im.message.receive_v1'), { nil: undefined }),
  tenant_key: fc.option(nonEmptyIdArb, { nil: undefined }),
  sender: feishuSenderWithIdArb,
  message: feishuMessageArb,
});

// ---------------------------------------------------------------------------
// 飞书 Tests
// ---------------------------------------------------------------------------

describe('消息解析完整性 — 飞书 Stream (Property 4)', () => {
  it('parsed message contains all required fields for any valid text payload', () => {
    fc.assert(
      fc.property(
        feishuMessageEventArb,
        (payload) => {
          const msg = parseFeishuMessageEvent(payload as any);

          expect(msg).not.toBeNull();
          const parsed = msg!;

          // 每个必需字段都必须存在且已定义
          for (const field of REQUIRED_FIELDS) {
            expect(parsed).toHaveProperty(field);
            expect(parsed[field]).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('platform is always "feishu" for Feishu messages', () => {
    fc.assert(
      fc.property(
        feishuMessageEventArb,
        (payload) => {
          const msg = parseFeishuMessageEvent(payload as any);
          expect(msg).not.toBeNull();
          expect(msg!.platform).toBe('feishu');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('receiveMode is always "stream" for Feishu Stream messages', () => {
    fc.assert(
      fc.property(
        feishuMessageEventArb,
        (payload) => {
          const msg = parseFeishuMessageEvent(payload as any);
          expect(msg).not.toBeNull();
          expect(msg!.receiveMode).toBe('stream');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('senderId is preserved from the sender_id (open_id preferred)', () => {
    fc.assert(
      fc.property(
        feishuMessageEventArb,
        (payload) => {
          const msg = parseFeishuMessageEvent(payload as any);
          expect(msg).not.toBeNull();
          // 解析逻辑优先使用 open_id → user_id → union_id
          const sid = payload.sender.sender_id;
          const expectedId = sid?.open_id || sid?.user_id || sid?.union_id || '';
          expect(msg!.senderId).toBe(expectedId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('content is extracted from JSON text field in message.content', () => {
    fc.assert(
      fc.property(
        feishuMessageEventArb,
        (payload) => {
          const msg = parseFeishuMessageEvent(payload as any);
          expect(msg).not.toBeNull();
          // 飞书文本消息 content 是 JSON 字符串 '{"text":"xxx"}'
          const parsed = JSON.parse(payload.message.content);
          expect(msg!.content).toBe((parsed.text || '').trim());
          expect(msg!.messageType).toBe('text');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('originalMessageId is preserved from message.message_id', () => {
    fc.assert(
      fc.property(
        feishuMessageEventArb,
        (payload) => {
          const msg = parseFeishuMessageEvent(payload as any);
          expect(msg).not.toBeNull();
          expect(msg!.originalMessageId).toBe(payload.message.message_id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('conversationId is preserved from message.chat_id', () => {
    fc.assert(
      fc.property(
        feishuMessageEventArb,
        (payload) => {
          const msg = parseFeishuMessageEvent(payload as any);
          expect(msg).not.toBeNull();
          expect(msg!.conversationId).toBe(payload.message.chat_id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('timestamp is parsed from message.create_time string', () => {
    fc.assert(
      fc.property(
        feishuMessageEventArb,
        (payload) => {
          const msg = parseFeishuMessageEvent(payload as any);
          expect(msg).not.toBeNull();
          expect(msg!.timestamp).toBe(parseInt(payload.message.create_time, 10));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rawPayload preserves the original event data', () => {
    fc.assert(
      fc.property(
        feishuMessageEventArb,
        (payload) => {
          const msg = parseFeishuMessageEvent(payload as any);
          expect(msg).not.toBeNull();
          expect(msg!.rawPayload).toEqual(payload);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ===========================================================================
// QQ Stream 消息解析属性测试
// ===========================================================================

/**
 * **Feature: im-channel-integration, Property 4: 消息解析完整性（QQ Stream）**
 * **Validates: Requirements 3.3, 3.6**
 *
 * For any valid QQ Bot message data received via WebSocket Stream,
 * the parsed IMStandardMessage should contain all required fields
 * (platform, receiveMode, senderId, content, messageType, originalMessageId,
 * conversationId, timestamp), with platform === 'qq' and
 * receiveMode === 'stream'.
 */

// ---------------------------------------------------------------------------
// QQ Generators
// ---------------------------------------------------------------------------

/** QQ author 对象生成器 */
const qqAuthorArb = fc.record({
  id: nonEmptyIdArb,
  username: fc.option(fc.string({ minLength: 1, maxLength: 32 }), { nil: undefined }),
  bot: fc.option(fc.boolean(), { nil: undefined }),
});

/** ISO 日期字符串生成器（使用时间戳范围确保有效日期） */
const isoDateArb = fc.integer({
  min: new Date('2020-01-01').getTime(),
  max: new Date('2030-12-31').getTime(),
}).map(ts => new Date(ts).toISOString());

/** QQ 纯文本内容（不含 @ 前缀） */
const qqPlainContentArb = contentArb;

/** QQ 带 @ 前缀的内容生成器 */
const qqContentWithAtArb = fc.tuple(
  fc.integer({ min: 100000, max: 999999999 }),
  contentArb,
).map(([botId, text]) => `<@!${botId}> ${text}`);

/** QQ 消息内容生成器（可能带 @ 前缀，也可能不带） */
const qqContentArb = fc.oneof(qqPlainContentArb, qqContentWithAtArb);

/** QQ Bot 消息数据生成器（文本消息） */
const qqTextMessageArb = fc.record({
  id: nonEmptyIdArb,
  content: qqContentArb,
  timestamp: isoDateArb,
  author: qqAuthorArb,
  channel_id: fc.option(nonEmptyIdArb, { nil: undefined }),
  guild_id: fc.option(nonEmptyIdArb, { nil: undefined }),
  group_openid: fc.option(nonEmptyIdArb, { nil: undefined }),
  msg_type: fc.constant(0),
});

/** QQ 事件类型生成器 */
const qqEventTypeArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant('MESSAGE_CREATE' as string | undefined),
  fc.constant('GROUP_AT_MESSAGE_CREATE' as string | undefined),
  fc.constant(undefined as string | undefined),
);

// ---------------------------------------------------------------------------
// QQ Tests
// ---------------------------------------------------------------------------

describe('消息解析完整性 — QQ Stream (Property 4)', () => {
  it('parsed message contains all required fields for any valid text payload', () => {
    fc.assert(
      fc.property(
        qqTextMessageArb,
        qqEventTypeArb,
        (payload, eventType) => {
          const msg = parseQQBotMessage(payload as any, eventType);

          expect(msg).not.toBeNull();
          const parsed = msg!;

          // 每个必需字段都必须存在且已定义
          for (const field of REQUIRED_FIELDS) {
            expect(parsed).toHaveProperty(field);
            expect(parsed[field]).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('platform is always "qq" for QQ messages', () => {
    fc.assert(
      fc.property(
        qqTextMessageArb,
        qqEventTypeArb,
        (payload, eventType) => {
          const msg = parseQQBotMessage(payload as any, eventType);
          expect(msg).not.toBeNull();
          expect(msg!.platform).toBe('qq');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('receiveMode is always "stream" for QQ Stream messages', () => {
    fc.assert(
      fc.property(
        qqTextMessageArb,
        qqEventTypeArb,
        (payload, eventType) => {
          const msg = parseQQBotMessage(payload as any, eventType);
          expect(msg).not.toBeNull();
          expect(msg!.receiveMode).toBe('stream');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('senderId is preserved from author.id', () => {
    fc.assert(
      fc.property(
        qqTextMessageArb,
        qqEventTypeArb,
        (payload, eventType) => {
          const msg = parseQQBotMessage(payload as any, eventType);
          expect(msg).not.toBeNull();
          expect(msg!.senderId).toBe(payload.author.id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('content has @ prefix stripped and is trimmed', () => {
    fc.assert(
      fc.property(
        qqTextMessageArb,
        qqEventTypeArb,
        (payload, eventType) => {
          const msg = parseQQBotMessage(payload as any, eventType);
          expect(msg).not.toBeNull();
          // @ 前缀 <@!botId> 或 <@botId> 应被移除
          const expectedContent = payload.content
            .replace(/<@!?\d+>\s*/g, '')
            .trim();
          expect(msg!.content).toBe(expectedContent);
          expect(msg!.messageType).toBe('text');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('originalMessageId is preserved from payload.id', () => {
    fc.assert(
      fc.property(
        qqTextMessageArb,
        qqEventTypeArb,
        (payload, eventType) => {
          const msg = parseQQBotMessage(payload as any, eventType);
          expect(msg).not.toBeNull();
          expect(msg!.originalMessageId).toBe(payload.id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('conversationId uses group_openid, channel_id, or guild_id', () => {
    fc.assert(
      fc.property(
        qqTextMessageArb,
        qqEventTypeArb,
        (payload, eventType) => {
          const msg = parseQQBotMessage(payload as any, eventType);
          expect(msg).not.toBeNull();
          const expectedConvId =
            payload.group_openid || payload.channel_id || payload.guild_id || '';
          expect(msg!.conversationId).toBe(expectedConvId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('timestamp is parsed from ISO date string', () => {
    fc.assert(
      fc.property(
        qqTextMessageArb,
        qqEventTypeArb,
        (payload, eventType) => {
          const msg = parseQQBotMessage(payload as any, eventType);
          expect(msg).not.toBeNull();
          expect(msg!.timestamp).toBe(new Date(payload.timestamp).getTime());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rawPayload preserves the original message data', () => {
    fc.assert(
      fc.property(
        qqTextMessageArb,
        qqEventTypeArb,
        (payload, eventType) => {
          const msg = parseQQBotMessage(payload as any, eventType);
          expect(msg).not.toBeNull();
          expect(msg!.rawPayload).toEqual(payload);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ===========================================================================
// 微信 Webhook XML 消息解析属性测试
// ===========================================================================

/**
 * **Feature: im-channel-integration, Property 4: 消息解析完整性（微信 Webhook）**
 * **Validates: Requirements 3.4, 3.6**
 *
 * For any valid WeChat XML text message payload received via Webhook,
 * parseWechatXML should correctly extract all fields (ToUserName, FromUserName,
 * CreateTime, MsgType, Content, MsgId), with MsgType === 'text' and
 * Content preserved.
 */

import { parseWechatXML } from '../adapters/wechat-webhook';
import { parseWecomXML } from '../adapters/wecom-webhook';

// ---------------------------------------------------------------------------
// 微信 XML Generators
// ---------------------------------------------------------------------------

/** 生成微信风格的用户 OpenID（字母数字组合） */
const wechatOpenIdArb = fc.stringMatching(/^[a-zA-Z0-9]{8,32}$/);

/** 生成 Unix 时间戳（秒级） */
const unixTimestampArb = fc.integer({ min: 1000000000, max: 2000000000 });

/** 生成微信消息 ID（大整数字符串） */
const wechatMsgIdArb = fc.integer({ min: 100000000, max: 999999999 }).map(n => String(n));

/** 生成不含 XML 特殊字符的消息内容（用于 CDATA 内部，安全起见避免 ]]> 序列） */
const xmlSafeContentArb = fc.stringMatching(/^[a-zA-Z0-9\u4e00-\u9fff ,.!?]{1,200}$/);

/** 构建微信文本消息 XML 字符串 */
function buildWechatTextXML(params: {
  toUserName: string;
  fromUserName: string;
  createTime: number;
  content: string;
  msgId: string;
}): string {
  return `<xml>
<ToUserName><![CDATA[${params.toUserName}]]></ToUserName>
<FromUserName><![CDATA[${params.fromUserName}]]></FromUserName>
<CreateTime>${params.createTime}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${params.content}]]></Content>
<MsgId>${params.msgId}</MsgId>
</xml>`;
}

/** 微信文本消息参数生成器 */
const wechatTextParamsArb = fc.record({
  toUserName: wechatOpenIdArb,
  fromUserName: wechatOpenIdArb,
  createTime: unixTimestampArb,
  content: xmlSafeContentArb,
  msgId: wechatMsgIdArb,
});

// ---------------------------------------------------------------------------
// 微信 Tests
// ---------------------------------------------------------------------------

describe('消息解析完整性 — 微信 Webhook XML (Property 4)', () => {
  it('parseWechatXML 能正确解析任意有效文本消息 XML 的所有字段', () => {
    fc.assert(
      fc.property(
        wechatTextParamsArb,
        (params) => {
          const xml = buildWechatTextXML(params);
          const result = parseWechatXML(xml);

          // 解析不应返回 null
          expect(result).not.toBeNull();
          expect(result!.xml).toBeDefined();

          const msg = result!.xml;

          // 所有必需字段都应存在
          expect(msg.ToUserName).toBeDefined();
          expect(msg.FromUserName).toBeDefined();
          expect(msg.CreateTime).toBeDefined();
          expect(msg.MsgType).toBeDefined();
          expect(msg.Content).toBeDefined();
          expect(msg.MsgId).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ToUserName 和 FromUserName 被正确提取', () => {
    fc.assert(
      fc.property(
        wechatTextParamsArb,
        (params) => {
          const xml = buildWechatTextXML(params);
          const result = parseWechatXML(xml);

          expect(result).not.toBeNull();
          expect(result!.xml.ToUserName).toBe(params.toUserName);
          expect(result!.xml.FromUserName).toBe(params.fromUserName);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('CreateTime 被正确提取（parseTagValue: false 下为字符串）', () => {
    fc.assert(
      fc.property(
        wechatTextParamsArb,
        (params) => {
          const xml = buildWechatTextXML(params);
          const result = parseWechatXML(xml);

          expect(result).not.toBeNull();
          // parseTagValue: false 意味着数值也作为字符串返回
          expect(String(result!.xml.CreateTime)).toBe(String(params.createTime));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('MsgType 始终为 "text" 且 Content 被完整保留', () => {
    fc.assert(
      fc.property(
        wechatTextParamsArb,
        (params) => {
          const xml = buildWechatTextXML(params);
          const result = parseWechatXML(xml);

          expect(result).not.toBeNull();
          expect(result!.xml.MsgType).toBe('text');
          expect(result!.xml.Content).toBe(params.content);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('MsgId 被正确提取', () => {
    fc.assert(
      fc.property(
        wechatTextParamsArb,
        (params) => {
          const xml = buildWechatTextXML(params);
          const result = parseWechatXML(xml);

          expect(result).not.toBeNull();
          expect(String(result!.xml.MsgId)).toBe(params.msgId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('无效 XML 字符串返回 null', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('<xml>')),
        (invalidXml) => {
          const result = parseWechatXML(invalidXml);
          // 无效 XML 应返回 null（没有 xml 根节点）
          if (result !== null) {
            expect(result.xml).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ===========================================================================
// 企业微信 Webhook XML 消息解析属性测试
// ===========================================================================

/**
 * **Feature: im-channel-integration, Property 4: 消息解析完整性（企业微信 Webhook）**
 * **Validates: Requirements 3.5, 3.6**
 *
 * For any valid WeCom decrypted XML text message payload,
 * parseWecomXML should correctly extract all fields (ToUserName, FromUserName,
 * CreateTime, MsgType, Content, MsgId, AgentID), with MsgType === 'text'
 * and Content preserved.
 */

// ---------------------------------------------------------------------------
// 企业微信 XML Generators
// ---------------------------------------------------------------------------

/** 生成企业微信 AgentID */
const wecomAgentIdArb = fc.integer({ min: 1000000, max: 9999999 }).map(n => String(n));

/** 构建企业微信解密后的文本消息 XML 字符串 */
function buildWecomDecryptedTextXML(params: {
  toUserName: string;
  fromUserName: string;
  createTime: number;
  content: string;
  msgId: string;
  agentId: string;
}): string {
  return `<xml>
<ToUserName><![CDATA[${params.toUserName}]]></ToUserName>
<FromUserName><![CDATA[${params.fromUserName}]]></FromUserName>
<CreateTime>${params.createTime}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${params.content}]]></Content>
<MsgId>${params.msgId}</MsgId>
<AgentID>${params.agentId}</AgentID>
</xml>`;
}

/** 构建企业微信加密消息 XML 字符串（仅含 Encrypt 字段） */
function buildWecomEncryptedXML(params: {
  toUserName: string;
  encrypt: string;
  agentId: string;
}): string {
  return `<xml>
<ToUserName><![CDATA[${params.toUserName}]]></ToUserName>
<Encrypt><![CDATA[${params.encrypt}]]></Encrypt>
<AgentID>${params.agentId}</AgentID>
</xml>`;
}

/** 企业微信解密后文本消息参数生成器 */
const wecomDecryptedTextParamsArb = fc.record({
  toUserName: wechatOpenIdArb,
  fromUserName: wechatOpenIdArb,
  createTime: unixTimestampArb,
  content: xmlSafeContentArb,
  msgId: wechatMsgIdArb,
  agentId: wecomAgentIdArb,
});

/** 企业微信加密消息参数生成器（Base64 风格字符串） */
const wecomEncryptedParamsArb = fc.record({
  toUserName: wechatOpenIdArb,
  encrypt: fc.stringMatching(/^[A-Za-z0-9+/=]{16,128}$/),
  agentId: wecomAgentIdArb,
});

// ---------------------------------------------------------------------------
// 企业微信 Tests
// ---------------------------------------------------------------------------

describe('消息解析完整性 — 企业微信 Webhook XML (Property 4)', () => {
  describe('解密后的文本消息解析', () => {
    it('parseWecomXML 能正确解析任意有效解密后文本消息 XML 的所有字段', () => {
      fc.assert(
        fc.property(
          wecomDecryptedTextParamsArb,
          (params) => {
            const xml = buildWecomDecryptedTextXML(params);
            const result = parseWecomXML(xml);

            // 解析不应返回 null
            expect(result).not.toBeNull();
            expect(result!.xml).toBeDefined();

            const msg = result!.xml as any;

            // 所有必需字段都应存在
            expect(msg.ToUserName).toBeDefined();
            expect(msg.FromUserName).toBeDefined();
            expect(msg.CreateTime).toBeDefined();
            expect(msg.MsgType).toBeDefined();
            expect(msg.Content).toBeDefined();
            expect(msg.MsgId).toBeDefined();
            expect(msg.AgentID).toBeDefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('ToUserName 和 FromUserName 被正确提取', () => {
      fc.assert(
        fc.property(
          wecomDecryptedTextParamsArb,
          (params) => {
            const xml = buildWecomDecryptedTextXML(params);
            const result = parseWecomXML(xml);

            expect(result).not.toBeNull();
            const msg = result!.xml as any;
            expect(msg.ToUserName).toBe(params.toUserName);
            expect(msg.FromUserName).toBe(params.fromUserName);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('CreateTime 被正确提取', () => {
      fc.assert(
        fc.property(
          wecomDecryptedTextParamsArb,
          (params) => {
            const xml = buildWecomDecryptedTextXML(params);
            const result = parseWecomXML(xml);

            expect(result).not.toBeNull();
            const msg = result!.xml as any;
            expect(String(msg.CreateTime)).toBe(String(params.createTime));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('MsgType 始终为 "text" 且 Content 被完整保留', () => {
      fc.assert(
        fc.property(
          wecomDecryptedTextParamsArb,
          (params) => {
            const xml = buildWecomDecryptedTextXML(params);
            const result = parseWecomXML(xml);

            expect(result).not.toBeNull();
            const msg = result!.xml as any;
            expect(msg.MsgType).toBe('text');
            expect(msg.Content).toBe(params.content);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('MsgId 和 AgentID 被正确提取', () => {
      fc.assert(
        fc.property(
          wecomDecryptedTextParamsArb,
          (params) => {
            const xml = buildWecomDecryptedTextXML(params);
            const result = parseWecomXML(xml);

            expect(result).not.toBeNull();
            const msg = result!.xml as any;
            expect(String(msg.MsgId)).toBe(params.msgId);
            expect(String(msg.AgentID)).toBe(params.agentId);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('加密消息 XML 解析', () => {
    it('parseWecomXML 能正确解析加密消息 XML 并提取 Encrypt 字段', () => {
      fc.assert(
        fc.property(
          wecomEncryptedParamsArb,
          (params) => {
            const xml = buildWecomEncryptedXML(params);
            const result = parseWecomXML(xml);

            // 解析不应返回 null
            expect(result).not.toBeNull();
            expect(result!.xml).toBeDefined();

            const msg = result!.xml as any;

            // Encrypt 字段必须存在且与输入一致
            expect(msg.Encrypt).toBeDefined();
            expect(msg.Encrypt).toBe(params.encrypt);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('加密消息 XML 中 ToUserName 和 AgentID 被正确提取', () => {
      fc.assert(
        fc.property(
          wecomEncryptedParamsArb,
          (params) => {
            const xml = buildWecomEncryptedXML(params);
            const result = parseWecomXML(xml);

            expect(result).not.toBeNull();
            const msg = result!.xml as any;
            expect(msg.ToUserName).toBe(params.toUserName);
            expect(String(msg.AgentID)).toBe(params.agentId);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('无效输入处理', () => {
    it('无效 XML 字符串返回 null', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('<xml>')),
          (invalidXml) => {
            const result = parseWecomXML(invalidXml);
            // 无效 XML 应返回 null（没有 xml 根节点）
            if (result !== null) {
              expect(result.xml).toBeUndefined();
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

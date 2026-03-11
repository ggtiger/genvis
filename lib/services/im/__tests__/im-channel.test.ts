/**
 * Unit tests for IM Channel Message Processor (processIMMessage)
 *
 * Validates: Requirements 3.7, 8.3, 4.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IMStandardMessage, IMChannelConfig } from '../types';
import type { IMAdapterBase } from '../adapter';

// ========== Mocks ==========

// Mock rate-limiter
vi.mock('../rate-limiter', () => ({
  isRateLimited: vi.fn().mockReturnValue(false),
  recordMessage: vi.fn(),
}));

// Mock im-session
vi.mock('../im-session', () => ({
  loadIMSession: vi.fn(),
  saveIMSession: vi.fn().mockResolvedValue(undefined),
}));

// Mock im-formatter
vi.mock('../im-formatter', () => ({
  formatReplyForPlatform: vi.fn((reply: string) => reply),
  splitMessage: vi.fn((content: string) => [content]),
}));

// Mock all dynamic imports used by callSecretaryCore
vi.mock('@/lib/services/settings', () => ({
  loadGlobalSettings: vi.fn().mockResolvedValue({
    cli_settings: { claude: { apiKey: 'test-key', model: 'test-model' } },
  }),
}));

vi.mock('@/lib/services/employee-service', () => ({
  getEmployeeById: vi.fn().mockResolvedValue({
    id: 'builtin-secretary',
    name: 'Secretary',
    system_prompt: 'You are a secretary.',
  }),
  getAllEmployees: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/services/secretary-dispatch', () => ({
  dispatchToEmployee: vi.fn().mockResolvedValue({
    success: true,
    employeeId: 'emp-001',
    employeeName: '张三',
    projectId: 'proj-001',
  }),
}));

vi.mock('@/lib/services/secretary-skill-caller', () => ({
  callSkillApi: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

vi.mock('@/lib/services/secretary-memory', () => ({
  loadMemory: vi.fn().mockResolvedValue({ entries: [] }),
}));

vi.mock('@/lib/services/secretary-memory-prompt', () => ({
  buildMemoryPromptBlock: vi.fn().mockReturnValue(''),
}));

vi.mock('@/lib/services/api-skill-registry', () => ({
  loadRegistry: vi.fn().mockResolvedValue({ skills: [] }),
  getSkillByName: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/services/api-skill-prompt', () => ({
  buildApiSkillPromptBlock: vi.fn().mockReturnValue(''),
}));

import { processIMMessage } from '../im-channel';
import { isRateLimited, recordMessage } from '../rate-limiter';
import { loadIMSession, saveIMSession } from '../im-session';
import { formatReplyForPlatform, splitMessage } from '../im-formatter';

// ========== Helpers ==========

function createMockAdapter(): IMAdapterBase & { sendReply: ReturnType<typeof vi.fn> } {
  return {
    platform: 'dingtalk',
    sendReply: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockConfig(): IMChannelConfig {
  return {
    enabled: true,
    receiveMode: 'stream',
    appId: 'test-app-id',
    appSecret: 'test-secret',
    token: 'test-token',
  };
}

function createMockMessage(overrides: Partial<IMStandardMessage> = {}): IMStandardMessage {
  return {
    platform: 'dingtalk',
    receiveMode: 'stream',
    senderId: 'user-1',
    content: '你好',
    messageType: 'text',
    originalMessageId: 'msg-001',
    conversationId: 'conv-001',
    timestamp: Date.now(),
    rawPayload: {},
    ...overrides,
  };
}

function createFreshSession() {
  return {
    id: 'test-session-id',
    platform: 'dingtalk' as const,
    senderId: 'user-1',
    messages: [] as any[],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

/**
 * Mock the global fetch to simulate Claude API responses.
 * callSecretaryCore calls fetch internally for the AI API.
 */
function mockClaudeResponse(decision: object) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      content: [{ type: 'text', text: JSON.stringify(decision) }],
    }),
  }));
}

// ========== Tests ==========

describe('processIMMessage', () => {
  let adapter: ReturnType<typeof createMockAdapter>;
  let config: IMChannelConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = createMockAdapter();
    config = createMockConfig();

    // Default: not rate limited
    vi.mocked(isRateLimited).mockReturnValue(false);

    // Default: return a fresh session each time
    vi.mocked(loadIMSession).mockResolvedValue(createFreshSession());

    // Default: passthrough formatters
    vi.mocked(formatReplyForPlatform).mockImplementation((reply: string) => reply);
    vi.mocked(splitMessage).mockImplementation((content: string) => [content]);
  });

  describe('不支持消息类型返回友好提示 (Requirement 3.7)', () => {
    it('should reply with friendly message when messageType is unsupported', async () => {
      const message = createMockMessage({ messageType: 'unsupported' });

      await processIMMessage(message, adapter, config);

      expect(adapter.sendReply).toHaveBeenCalledTimes(1);
      expect(adapter.sendReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '目前仅支持文本消息，请发送文字内容。',
          platform: 'dingtalk',
          senderId: 'user-1',
          conversationId: 'conv-001',
        }),
        config
      );
    });

    it('should not load session for unsupported messages', async () => {
      const message = createMockMessage({ messageType: 'unsupported' });

      await processIMMessage(message, adapter, config);

      expect(loadIMSession).not.toHaveBeenCalled();
    });

    it('should not save session for unsupported messages', async () => {
      const message = createMockMessage({ messageType: 'unsupported' });

      await processIMMessage(message, adapter, config);

      expect(saveIMSession).not.toHaveBeenCalled();
    });
  });

  describe('限流触发后的提示消息 (Requirement 8.3)', () => {
    it('should reply with rate limit message when user is rate limited', async () => {
      vi.mocked(isRateLimited).mockReturnValue(true);
      const message = createMockMessage();

      await processIMMessage(message, adapter, config);

      expect(adapter.sendReply).toHaveBeenCalledTimes(1);
      expect(adapter.sendReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '您发送消息过于频繁，请稍后再试。',
          platform: 'dingtalk',
          senderId: 'user-1',
        }),
        config
      );
    });

    it('should not record message when rate limited', async () => {
      vi.mocked(isRateLimited).mockReturnValue(true);
      const message = createMockMessage();

      await processIMMessage(message, adapter, config);

      expect(recordMessage).not.toHaveBeenCalled();
    });

    it('should not save session when rate limited', async () => {
      vi.mocked(isRateLimited).mockReturnValue(true);
      const message = createMockMessage();

      await processIMMessage(message, adapter, config);

      expect(saveIMSession).not.toHaveBeenCalled();
    });

    it('should check rate limit with correct platform and senderId', async () => {
      vi.mocked(isRateLimited).mockReturnValue(true);
      const message = createMockMessage({ platform: 'feishu', senderId: 'user-xyz' });

      await processIMMessage(message, adapter, config);

      expect(isRateLimited).toHaveBeenCalledWith('feishu', 'user-xyz');
    });
  });

  describe('调度确认消息生成 (Requirement 4.3)', () => {
    it('should send dispatch confirmation when Secretary returns dispatch action', async () => {
      // Mock Claude to return a dispatch decision
      mockClaudeResponse({
        action: 'dispatch',
        employeeId: 'emp-001',
        instruction: '写一份报告',
      });

      const message = createMockMessage({ content: '帮我让张三写个报告' });

      await processIMMessage(message, adapter, config);

      expect(adapter.sendReply).toHaveBeenCalledTimes(1);
      expect(adapter.sendReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('已将任务分配给'),
        }),
        config
      );
    });

    it('should format dispatch reply for the target platform', async () => {
      mockClaudeResponse({
        action: 'dispatch',
        employeeId: 'emp-001',
        instruction: '写报告',
      });

      const message = createMockMessage({ platform: 'wechat' });

      await processIMMessage(message, adapter, config);

      // formatReplyForPlatform should be called with the dispatch reply and target platform
      expect(formatReplyForPlatform).toHaveBeenCalledWith(
        expect.stringContaining('已将任务分配给'),
        'wechat'
      );
    });

    it('should save session with user message and dispatch reply', async () => {
      mockClaudeResponse({
        action: 'dispatch',
        employeeId: 'emp-001',
        instruction: '写报告',
      });

      const message = createMockMessage({ content: '让张三写报告' });

      await processIMMessage(message, adapter, config);

      expect(saveIMSession).toHaveBeenCalledTimes(1);
      const savedSession = vi.mocked(saveIMSession).mock.calls[0][0];
      // Session should have 2 new messages: user + assistant
      expect(savedSession.messages).toHaveLength(2);
      expect(savedSession.messages[0]).toMatchObject({ role: 'user', content: '让张三写报告' });
      expect(savedSession.messages[1]).toMatchObject({
        role: 'assistant',
        content: expect.stringContaining('已将任务分配给'),
      });
    });
  });

  describe('正常文本消息处理流程', () => {
    it('should record message for rate limiting on text messages', async () => {
      mockClaudeResponse({ action: 'direct_reply', reply: '好的' });
      const message = createMockMessage();

      await processIMMessage(message, adapter, config);

      expect(recordMessage).toHaveBeenCalledWith('dingtalk', 'user-1');
    });

    it('should load session with correct platform and senderId', async () => {
      mockClaudeResponse({ action: 'direct_reply', reply: '好的' });
      const message = createMockMessage({ platform: 'feishu', senderId: 'user-abc' });

      await processIMMessage(message, adapter, config);

      expect(loadIMSession).toHaveBeenCalledWith('feishu', 'user-abc');
    });

    it('should split long replies and send each chunk', async () => {
      mockClaudeResponse({ action: 'direct_reply', reply: '很长的回复' });
      vi.mocked(splitMessage).mockReturnValue(['chunk1', 'chunk2', 'chunk3']);

      const message = createMockMessage();

      await processIMMessage(message, adapter, config);

      expect(adapter.sendReply).toHaveBeenCalledTimes(3);
      expect(adapter.sendReply).toHaveBeenNthCalledWith(1, expect.objectContaining({ content: 'chunk1' }), config);
      expect(adapter.sendReply).toHaveBeenNthCalledWith(2, expect.objectContaining({ content: 'chunk2' }), config);
      expect(adapter.sendReply).toHaveBeenNthCalledWith(3, expect.objectContaining({ content: 'chunk3' }), config);
    });
  });

  describe('错误处理', () => {
    it('should send error message when processing throws', async () => {
      // Make loadIMSession throw to trigger the catch block
      vi.mocked(loadIMSession).mockRejectedValue(new Error('session load failed'));
      const message = createMockMessage();

      await processIMMessage(message, adapter, config);

      expect(adapter.sendReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '抱歉，处理您的消息时出现了问题，请稍后重试。',
        }),
        config
      );
    });
  });
});

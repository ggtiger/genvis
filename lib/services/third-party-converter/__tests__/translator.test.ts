import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedManifest } from '../types';

// Mock the settings module (intercepted by dynamic import in translator.ts)
vi.mock('@/lib/services/settings', () => ({
  loadGlobalSettings: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { isEnglishText, translateMeta, translateContent } from '../translator';
import { loadGlobalSettings } from '@/lib/services/settings';

const mockLoadGlobalSettings = vi.mocked(loadGlobalSettings);

function makeManifest(overrides: Partial<ParsedManifest> = {}): ParsedManifest {
  return {
    name: 'test-skill',
    description: 'A test skill for unit testing',
    sourcePlatform: 'openclaw',
    sourceUrl: 'https://clawhub.ai/test/test-skill',
    ...overrides,
  };
}

function mockSettings(apiKey = 'test-key', apiUrl = 'https://api.test.co') {
  mockLoadGlobalSettings.mockResolvedValue({
    default_cli: 'claude',
    cli_settings: {
      claude: { apiUrl, apiKey, model: 'claude-sonnet-4-5-20250929' },
    },
  });
}

function mockTranslateResponse(text: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text }],
    }),
  });
}

describe('isEnglishText', () => {
  it('returns true for English text', () => {
    expect(isEnglishText('Hello world')).toBe(true);
    expect(isEnglishText('A self-improving agent for code generation')).toBe(true);
  });

  it('returns false for Chinese text', () => {
    expect(isEnglishText('这是一个中文描述')).toBe(false);
    expect(isEnglishText('自动化代码生成工具')).toBe(false);
  });

  it('returns false for empty or whitespace-only strings', () => {
    expect(isEnglishText('')).toBe(false);
    expect(isEnglishText('   ')).toBe(false);
  });

  it('returns true for mixed text with mostly English', () => {
    expect(isEnglishText('This is a Python API tool')).toBe(true);
  });

  it('returns false for mixed text with mostly Chinese', () => {
    expect(isEnglishText('这是一个 API 工具描述')).toBe(false);
  });
});

describe('translateMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips translation when displayName and description are Chinese', async () => {
    const manifest = makeManifest({
      displayName: '中文名称',
      description: '这是中文描述',
    });

    const result = await translateMeta(manifest);
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates English displayName and description', async () => {
    mockSettings();
    mockTranslateResponse('自我改进代理');
    mockTranslateResponse('一个用于代码生成的自我改进代理');

    const manifest = makeManifest({
      displayName: 'Self Improving Agent',
      description: 'A self-improving agent for code generation',
    });

    const result = await translateMeta(manifest);
    expect(result.displayName).toBe('自我改进代理');
    expect(result.description).toBe('一个用于代码生成的自我改进代理');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns empty TranslatedMeta when API key is missing', async () => {
    mockSettings('', 'https://api.test.co');

    // Also clear env vars that loadClaudeConfig falls back to
    const origAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const origApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manifest = makeManifest({
      displayName: 'Test Skill',
      description: 'A test skill',
    });

    const result = await translateMeta(manifest);
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    // Restore env vars
    if (origAuthToken) process.env.ANTHROPIC_AUTH_TOKEN = origAuthToken;
    if (origApiKey) process.env.ANTHROPIC_API_KEY = origApiKey;
  });

  it('returns empty TranslatedMeta on API failure, logs warning', async () => {
    mockSettings();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manifest = makeManifest({
      displayName: 'Test Skill',
      description: 'A test skill',
    });

    const result = await translateMeta(manifest);
    expect(result.displayName).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('translates only the English fields, skips Chinese fields', async () => {
    mockSettings();
    mockTranslateResponse('一个测试技能');

    const manifest = makeManifest({
      displayName: '中文名称',
      description: 'A test skill in English',
    });

    const result = await translateMeta(manifest);
    expect(result.displayName).toBeUndefined();
    expect(result.description).toBe('一个测试技能');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('translateContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns original content when it is Chinese', async () => {
    const content = '这是一段中文内容，不需要翻译。';
    const result = await translateContent(content);
    expect(result).toBe(content);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns original content when it is empty', async () => {
    const result = await translateContent('');
    expect(result).toBe('');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates English content to Chinese', async () => {
    mockSettings();
    mockTranslateResponse('# 使用说明\n\n这是一个测试技能。');

    const content = '# Usage\n\nThis is a test skill.';
    const result = await translateContent(content);
    expect(result).toBe('# 使用说明\n\n这是一个测试技能。');
  });

  it('returns original content on API failure', async () => {
    mockSettings();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const content = 'This is English content that should be returned as-is on failure.';
    const result = await translateContent(content);
    expect(result).toBe(content);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('returns original content when API key is missing', async () => {
    mockSettings('');

    const origAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const origApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const content = 'English content without API key configured.';
    const result = await translateContent(content);
    expect(result).toBe(content);

    warnSpy.mockRestore();
    if (origAuthToken) process.env.ANTHROPIC_AUTH_TOKEN = origAuthToken;
    if (origApiKey) process.env.ANTHROPIC_API_KEY = origApiKey;
  });
});

/**
 * converter.test.ts — 抓取器 + 翻译器集成风格单元测试
 *
 * 补充 fetcher.test.ts / translator.test.ts 中已有的模块级测试，
 * 聚焦于：
 *   1. identifyPlatform 的典型示例（Requirements 1.2, 1.3）
 *   2. 翻译失败降级场景（Requirement 4.4）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { identifyPlatform } from '../fetcher';
import type { ParsedManifest } from '../types';

// ---- mocks for translator ----
vi.mock('@/lib/services/settings', () => ({
  loadGlobalSettings: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { translateMeta, translateContent } from '../translator';
import { loadGlobalSettings } from '@/lib/services/settings';

const mockLoadGlobalSettings = vi.mocked(loadGlobalSettings);

// ---- helpers ----
function makeManifest(overrides: Partial<ParsedManifest> = {}): ParsedManifest {
  return {
    name: 'converter-test-skill',
    description: 'An English description for converter tests',
    sourcePlatform: 'openclaw',
    sourceUrl: 'https://clawhub.ai/test/converter-test-skill',
    ...overrides,
  };
}

function mockSettingsWithKey(apiKey = 'test-key') {
  mockLoadGlobalSettings.mockResolvedValue({
    default_cli: 'claude',
    cli_settings: {
      claude: { apiUrl: 'https://api.test.co', apiKey, model: 'claude-sonnet-4-5-20250929' },
    },
  });
}

// ================================================================
// 1. identifyPlatform 具体示例 (Requirements 1.2, 1.3)
// ================================================================
describe('identifyPlatform — 具体示例', () => {
  it('clawhub.ai skill URL → openclaw', () => {
    expect(identifyPlatform('https://clawhub.ai/pskoett/self-improving-agent')).toBe('openclaw');
  });

  it('github.com URL → unknown', () => {
    expect(identifyPlatform('https://github.com/user/repo')).toBe('unknown');
  });

  it('empty string → unknown', () => {
    expect(identifyPlatform('')).toBe('unknown');
  });
});

// ================================================================
// 2. 翻译失败降级场景 (Requirement 4.4)
// ================================================================
describe('翻译失败降级 — LLM 服务不可用', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('translateMeta returns empty TranslatedMeta when LLM returns 503', async () => {
    mockSettingsWithKey();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manifest = makeManifest({
      displayName: 'Self Improving Agent',
      description: 'A self-improving agent for code generation',
    });

    const result = await translateMeta(manifest);

    // 翻译失败 → 返回空对象，不包含翻译后的字段
    expect(result.displayName).toBeUndefined();
    expect(result.description).toBeUndefined();

    warnSpy.mockRestore();
  });

  it('translateContent returns original English content when LLM is unavailable', async () => {
    mockSettingsWithKey();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const original = 'This is the original English content for the skill.';
    const result = await translateContent(original);

    expect(result).toBe(original);

    warnSpy.mockRestore();
  });

  it('translateMeta returns empty TranslatedMeta when fetch throws network error', async () => {
    mockSettingsWithKey();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manifest = makeManifest({
      displayName: 'Network Test Skill',
      description: 'Testing network failure graceful degradation',
    });

    const result = await translateMeta(manifest);

    expect(result.displayName).toBeUndefined();
    expect(result.description).toBeUndefined();

    warnSpy.mockRestore();
  });
});

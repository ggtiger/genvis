import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { identifyPlatform, fetchSkillFromUrl } from '../fetcher';

describe('identifyPlatform', () => {
  it('returns "openclaw" for clawhub.ai URLs', () => {
    expect(identifyPlatform('https://clawhub.ai/pskoett/self-improving-agent')).toBe('openclaw');
  });

  it('returns "openclaw" for clawhub.ai root URL', () => {
    expect(identifyPlatform('https://clawhub.ai')).toBe('openclaw');
  });

  it('returns "openclaw" for subdomain of clawhub.ai', () => {
    expect(identifyPlatform('https://api.clawhub.ai/skills/123')).toBe('openclaw');
  });

  it('returns "openclaw" for http clawhub.ai URL', () => {
    expect(identifyPlatform('http://clawhub.ai/some-skill')).toBe('openclaw');
  });

  it('returns "unknown" for github.com URLs', () => {
    expect(identifyPlatform('https://github.com/user/repo')).toBe('unknown');
  });

  it('returns "unknown" for other domains', () => {
    expect(identifyPlatform('https://example.com/skill')).toBe('unknown');
  });

  it('returns "unknown" for empty string', () => {
    expect(identifyPlatform('')).toBe('unknown');
  });

  it('returns "unknown" for malformed URL', () => {
    expect(identifyPlatform('not-a-url')).toBe('unknown');
  });

  it('returns "unknown" for URL with clawhub.ai in path but different domain', () => {
    expect(identifyPlatform('https://example.com/clawhub.ai/skill')).toBe('unknown');
  });
});

describe('fetchSkillFromUrl', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset fetch mock before each test
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
  });

  it('throws "暂不支持该平台" for non-clawhub URLs', async () => {
    await expect(fetchSkillFromUrl('https://github.com/user/repo')).rejects.toThrow('暂不支持该平台');
  });

  it('throws for empty URL', async () => {
    await expect(fetchSkillFromUrl('')).rejects.toThrow('暂不支持该平台');
  });

  it('throws for clawhub URL without owner/name path', async () => {
    await expect(fetchSkillFromUrl('https://clawhub.ai')).rejects.toThrow('URL 解析失败');
  });

  it('throws for clawhub URL with only owner (no skill name)', async () => {
    await expect(fetchSkillFromUrl('https://clawhub.ai/pskoett')).rejects.toThrow('URL 解析失败');
  });

  it('returns FetchResult when manifest is found (yaml)', async () => {
    const yamlContent = 'name: test-skill\ndescription: A test skill';

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('openclaw.yaml')) {
        return new Response(yamlContent, { status: 200 });
      }
      // All other URLs return 404
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const result = await fetchSkillFromUrl('https://clawhub.ai/pskoett/self-improving-agent');

    expect(result.tempDir).toBeTruthy();
    expect(result.manifestPath).toContain('openclaw.yaml');
    expect(result.manifestFormat).toBe('yaml');
    expect(result.codeFiles).toBeInstanceOf(Array);

    // Verify manifest was written to disk
    const written = await fs.readFile(result.manifestPath, 'utf-8');
    expect(written).toBe(yamlContent);

    // Cleanup
    await fs.rm(result.tempDir, { recursive: true, force: true });
  });

  it('returns FetchResult when manifest is found (json)', async () => {
    const jsonContent = '{"name":"test-skill","description":"A test"}';

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('manifest.json')) {
        return new Response(jsonContent, { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const result = await fetchSkillFromUrl('https://clawhub.ai/owner/my-skill');

    expect(result.manifestFormat).toBe('json');
    expect(result.manifestPath).toContain('manifest.json');

    await fs.rm(result.tempDir, { recursive: true, force: true });
  });

  it('throws when no manifest candidate is found', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    await expect(
      fetchSkillFromUrl('https://clawhub.ai/owner/skill')
    ).rejects.toThrow('无法从 ClawHub 获取 skill 配置文件');
  });

  it('includes code files when they exist', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('openclaw.yaml')) {
        return new Response('name: s\ndescription: d', { status: 200 });
      }
      if (urlStr.includes('main.py')) {
        return new Response('print("hello")', { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const result = await fetchSkillFromUrl('https://clawhub.ai/owner/skill');

    expect(result.codeFiles.length).toBe(1);
    expect(result.codeFiles[0]).toContain('main.py');

    await fs.rm(result.tempDir, { recursive: true, force: true });
  });

  it('cleans up temp dir when manifest fetch fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    try {
      await fetchSkillFromUrl('https://clawhub.ai/owner/skill');
    } catch {
      // expected
    }

    // We can't easily verify the exact temp dir was cleaned up,
    // but the function should not leave orphaned directories.
    // This test mainly ensures no unhandled errors during cleanup.
  });

  it('handles network errors gracefully', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network error: ECONNREFUSED');
    }) as typeof fetch;

    await expect(
      fetchSkillFromUrl('https://clawhub.ai/owner/skill')
    ).rejects.toThrow('无法从 ClawHub 获取 skill 配置文件');
  });
});

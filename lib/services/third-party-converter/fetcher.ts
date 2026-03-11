import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { randomBytes } from 'crypto';
import type { FetchResult } from './types';

/**
 * 识别 URL 对应的平台类型
 * @param url 第三方平台的 skill URL
 * @returns 'openclaw' 如果是 clawhub.ai 域名，否则 'unknown'
 */
export function identifyPlatform(url: string): 'openclaw' | 'unknown' {
  if (!url || typeof url !== 'string') {
    return 'unknown';
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'clawhub.ai' || parsed.hostname.endsWith('.clawhub.ai')) {
      return 'openclaw';
    }
    return 'unknown';
  } catch {
    // Malformed URL
    return 'unknown';
  }
}
/** Known manifest file names to probe on ClawHub */
const MANIFEST_CANDIDATES = [
  'SKILL.md',
  'openclaw.yaml',
  'openclaw.json',
  'manifest.yaml',
  'manifest.json',
];

/**
 * Parse owner and skill name from a ClawHub URL path.
 * Expected format: https://clawhub.ai/{owner}/{skill-name}
 */
function parseClawHubPath(url: string): { owner: string; name: string } {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error(`无效的 ClawHub URL，缺少 owner/skill-name 路径: ${url}`);
  }
  return { owner: segments[0], name: segments[1] };
}

/**
 * Build possible raw content URLs for a file in a ClawHub skill repository.
 * Tries multiple patterns since ClawHub's URL structure may vary:
 * 1. Convex site API: https://clawhub.ai/api/skill/{owner}/{name}/files/{filePath}
 * 2. GitHub-style raw: https://clawhub.ai/{owner}/{name}/raw/main/{filePath}
 * 3. Direct path: https://clawhub.ai/{owner}/{name}/{filePath}
 */
function buildRawUrls(owner: string, name: string, filePath: string): string[] {
  return [
    `https://clawhub.ai/api/skill/${owner}/${name}/files/${filePath}`,
    `https://clawhub.ai/${owner}/${name}/raw/main/${filePath}`,
    `https://clawhub.ai/${owner}/${name}/raw/${filePath}`,
  ];
}

/**
 * Create a unique temporary directory under os.tmpdir().
 */
async function createTempDir(): Promise<string> {
  const suffix = randomBytes(8).toString('hex');
  const dir = path.join(os.tmpdir(), `clawhub-skill-${suffix}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Try to fetch a manifest file from the known candidate paths.
 * For each candidate file, tries multiple URL patterns.
 * Returns the first successful response along with its filename.
 */
async function probeManifest(
  owner: string,
  name: string
): Promise<{ content: string; fileName: string }> {
  const errors: string[] = [];

  for (const candidate of MANIFEST_CANDIDATES) {
    const urls = buildRawUrls(owner, name, candidate);
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const content = await res.text();
          // Sanity check: skip HTML error pages
          if (content.trim().startsWith('<!') || content.trim().startsWith('<html')) {
            errors.push(`${url}: returned HTML instead of raw content`);
            continue;
          }
          return { content, fileName: candidate };
        }
        errors.push(`${url}: HTTP ${res.status}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${url}: ${msg}`);
      }
    }
  }

  throw new Error(
    `无法从 ClawHub 获取 skill 配置文件，已尝试: ${MANIFEST_CANDIDATES.join(', ')}。详情: ${errors.join('; ')}`
  );
}

/**
 * Determine manifest format from file name extension.
 */
function detectManifestFormat(fileName: string): 'yaml' | 'json' | 'markdown' {
  if (fileName.endsWith('.json')) return 'json';
  if (fileName.endsWith('.md')) return 'markdown';
  return 'yaml';
}

/**
 * 从 ClawHub URL 抓取 skill 数据，保存到临时目录
 *
 * 1. 验证平台（必须是 clawhub.ai）
 * 2. 解析 owner / skill-name
 * 3. 探测并下载 manifest 文件
 * 4. 保存到临时目录
 * 5. 返回 FetchResult
 *
 * @param url ClawHub skill 页面 URL
 * @returns FetchResult 包含临时目录路径、manifest 路径和格式
 */
export async function fetchSkillFromUrl(url: string): Promise<FetchResult> {
  // 1. 验证平台
  const platform = identifyPlatform(url);
  if (platform === 'unknown') {
    throw new Error('暂不支持该平台');
  }

  // 2. 解析 owner / skill-name
  let owner: string;
  let name: string;
  try {
    ({ owner, name } = parseClawHubPath(url));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`URL 解析失败: ${msg}`);
  }

  // 3. 创建临时目录
  let tempDir: string;
  try {
    tempDir = await createTempDir();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`创建临时目录失败: ${msg}`);
  }

  try {
    // 4. 探测并下载 manifest
    const { content: manifestContent, fileName: manifestFileName } = await probeManifest(owner, name);

    const manifestPath = path.join(tempDir, manifestFileName);
    await fs.writeFile(manifestPath, manifestContent, 'utf-8');

    const manifestFormat = detectManifestFormat(manifestFileName);

    // 5. Try to fetch common code files (best-effort)
    const codeFiles: string[] = [];
    const commonCodeFiles = ['main.py', 'index.ts', 'index.js', 'app.py', 'server.ts', 'server.js'];

    for (const codeFile of commonCodeFiles) {
      const codeUrls = buildRawUrls(owner, name, codeFile);
      for (const codeUrl of codeUrls) {
        try {
          const res = await fetch(codeUrl);
          if (res.ok) {
            const codeContent = await res.text();
            // Skip HTML error pages
            if (codeContent.trim().startsWith('<!') || codeContent.trim().startsWith('<html')) {
              continue;
            }
            const codePath = path.join(tempDir, codeFile);
            await fs.writeFile(codePath, codeContent, 'utf-8');
            codeFiles.push(codePath);
            break; // Got the file, no need to try other URL patterns
          }
        } catch {
          // Code file not found — skip silently
        }
      }
    }

    return {
      tempDir,
      manifestPath,
      manifestFormat,
      codeFiles,
    };
  } catch (err: unknown) {
    // Clean up temp dir on failure
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

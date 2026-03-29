/**
 * Skill Market Service
 *
 * Integrates with Tencent SkillHub (https://skillhub.tencent.com) for browsing,
 * searching, and installing skills from the online marketplace.
 *
 * Uses SkillHub CLI commands:
 * - skillhub search <query>
 * - skillhub install <skill-name>
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

// Types
export interface MarketSkill {
  name: string;
  displayName: string;
  description: string;
  author?: string;
  version?: string;
  downloads?: number;
  category?: string;
  tags?: string[];
  installed: boolean;
}

export interface MarketSearchResult {
  skills: MarketSkill[];
  total: number;
  hasMore: boolean;
  page: number;
}

export interface InstallResult {
  success: boolean;
  skillName?: string;
  error?: string;
}

export interface CLIInstallResult {
  success: boolean;
  error?: string;
}

// Cache for skill list (5 minutes TTL)
let cachedSkills: MarketSkill[] | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const IS_WIN = process.platform === 'win32';
const PATH_SEP = IS_WIN ? ';' : ':';
const SKILLHUB_BIN = IS_WIN ? 'skillhub.exe' : 'skillhub';

/** Cached resolved path to the skillhub binary */
let _resolvedSkillHubPath: string | null = null;

/** Home directory (works on all platforms) */
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';

/** Common installation paths for skillhub CLI (platform-aware) */
function getCommonPaths(): string[] {
  if (IS_WIN) {
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    return [
      ...(appData ? [`${appData}\\skillhub\\bin\\${SKILLHUB_BIN}`] : []),
      ...(localAppData ? [`${localAppData}\\skillhub\\bin\\${SKILLHUB_BIN}`] : []),
      ...(HOME_DIR ? [
        `${HOME_DIR}\\.skillhub\\bin\\${SKILLHUB_BIN}`,
        `${HOME_DIR}\\.local\\bin\\${SKILLHUB_BIN}`,
      ] : []),
      'C:\\Program Files\\skillhub\\bin\\skillhub.exe',
      'C:\\Program Files (x86)\\skillhub\\bin\\skillhub.exe',
    ];
  }
  return [
    '/usr/local/bin/skillhub',
    '/usr/bin/skillhub',
    ...(HOME_DIR ? [
      `${HOME_DIR}/.local/bin/skillhub`,
      `${HOME_DIR}/.skillhub/bin/skillhub`,
    ] : []),
  ];
}

/**
 * Get the resolved skillhub binary path.
 * Returns the cached path, or falls back to bare command name.
 */
export function getSkillHubBin(): string {
  return _resolvedSkillHubPath || (IS_WIN ? 'skillhub.exe' : 'skillhub');
}

/**
 * Build an exec env that includes common CLI installation dirs in PATH,
 * so `which`/`where` and direct execution work even inside a packaged
 * Electron app where the shell profile hasn't been sourced.
 * Works on Windows, macOS, and Linux.
 */
function getExtendedEnv(): NodeJS.ProcessEnv {
  const extra: string[] = IS_WIN
    ? [
        ...(process.env.APPDATA ? [`${process.env.APPDATA}\\skillhub\\bin`] : []),
        ...(process.env.LOCALAPPDATA ? [`${process.env.LOCALAPPDATA}\\skillhub\\bin`] : []),
        ...(HOME_DIR ? [`${HOME_DIR}\\.skillhub\\bin`] : []),
      ]
    : [
        '/usr/local/bin',
        ...(HOME_DIR ? [`${HOME_DIR}/.local/bin`, `${HOME_DIR}/.skillhub/bin`] : []),
      ];
  const existing = process.env.PATH || '';
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${extra.join(PATH_SEP)}${PATH_SEP}${existing}` };
  if (!IS_WIN) {
    env.LANG = 'en_US.UTF-8';
  }
  return env;
}

/**
 * Check if skillhub CLI is available.
 * First tries `which`/`where`, then falls back to checking common paths.
 * Caches the resolved binary path for subsequent calls.
 * Supports Windows, macOS, and Linux.
 */
export async function isSkillHubAvailable(): Promise<boolean> {
  // Fast path: if we already resolved a valid path, verify it still exists
  if (_resolvedSkillHubPath) {
    try {
      // On Windows, X_OK may not work reliably; use F_OK (file exists) instead
      fs.accessSync(_resolvedSkillHubPath, IS_WIN ? fs.constants.F_OK : fs.constants.X_OK);
      return true;
    } catch {
      _resolvedSkillHubPath = null; // invalidate
    }
  }

  // Try `which` (Unix) or `where` (Windows) with extended PATH
  const whichCmd = IS_WIN ? `where ${SKILLHUB_BIN}` : `which ${SKILLHUB_BIN}`;
  try {
    const { stdout } = await execAsync(whichCmd, {
      timeout: 5000,
      env: getExtendedEnv(),
    });
    // `where` on Windows may return multiple lines; take the first
    const resolved = stdout.trim().split(/\r?\n/)[0]?.trim();
    if (resolved && resolved.length > 0) {
      _resolvedSkillHubPath = resolved;
      return true;
    }
  } catch {
    // fall through to path scan
  }

  // Fallback: check common installation paths directly
  for (const p of getCommonPaths()) {
    try {
      fs.accessSync(p, IS_WIN ? fs.constants.F_OK : fs.constants.X_OK);
      _resolvedSkillHubPath = p;
      return true;
    } catch {
      // continue
    }
  }

  return false;
}

/**
 * Install SkillHub CLI automatically
 * Uses the official installation script from Tencent
 */
export async function installSkillHubCLI(
  onProgress?: (step: string, message: string) => void
): Promise<CLIInstallResult> {
  onProgress?.('check', 'Checking existing installation...');

  // Check if already installed
  const alreadyInstalled = await isSkillHubAvailable();
  if (alreadyInstalled) {
    onProgress?.('done', 'SkillHub CLI is already installed');
    return { success: true };
  }

  onProgress?.('download', 'Downloading SkillHub CLI installer...');

  // Platform-specific install command
  let installCmd: string;
  if (IS_WIN) {
    // Windows: use PowerShell to download and run installer
    const installScriptUrl = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.ps1';
    installCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { Invoke-WebRequest -Uri '${installScriptUrl}' -OutFile '$env:TEMP\\install-skillhub.ps1'; & '$env:TEMP\\install-skillhub.ps1' --cli-only }"`;
  } else {
    const installScriptUrl = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh';
    installCmd = `curl -fsSL ${installScriptUrl} | bash -s -- --cli-only`;
  }

  try {
    const { stdout, stderr } = await execAsync(installCmd, {
      timeout: 180000, // 3 minutes timeout
      env: getExtendedEnv()
    });

    onProgress?.('verify', 'Verifying installation...');

    // Verify installation
    const installed = await isSkillHubAvailable();
    if (installed) {
      onProgress?.('done', 'SkillHub CLI installed successfully!');
      return { success: true };
    } else {
      // CLI might be in PATH but not immediately available
      // Use the platform-aware common paths
      for (const p of getCommonPaths()) {
        try {
          fs.accessSync(p, IS_WIN ? fs.constants.F_OK : fs.constants.X_OK);
          _resolvedSkillHubPath = p;
          onProgress?.('done', 'SkillHub CLI installed successfully!');
          return { success: true };
        } catch {
          // continue
        }
      }

      return {
        success: false,
        error: `CLI installation completed but skillhub command not found in PATH. Output: ${stdout || stderr}`
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[SkillMarket] CLI installation failed:', errorMsg);

    return {
      success: false,
      error: `CLI installation failed: ${errorMsg}`
    };
  }
}

/**
 * Search skills from SkillHub marketplace
 */
export async function searchMarketSkills(
  query?: string,
  page: number = 1,
  limit: number = 20,
): Promise<MarketSearchResult> {
  // Check cache first (only for empty query / first page)
  if (!query && page === 1 && cachedSkills && Date.now() - cacheTime < CACHE_TTL) {
    const start = (page - 1) * limit;
    const end = start + limit;
    return {
      skills: cachedSkills.slice(start, end),
      total: cachedSkills.length,
      hasMore: end < cachedSkills.length,
      page,
    };
  }

  // Try SkillHub CLI first
  const cliAvailable = await isSkillHubAvailable();

  if (cliAvailable) {
    return searchViaCLI(query, page, limit);
  }

  // Fallback: fetch from SkillHub website API
  return searchViaWebAPI(query, page, limit);
}

/**
 * Search using SkillHub CLI
 */
async function searchViaCLI(
  query: string | undefined,
  page: number,
  limit: number,
): Promise<MarketSearchResult> {
  const bin = getSkillHubBin();
  const timeout = 30000; // 30 seconds

  // Try JSON output first for richer data
  const jsonCmd = query ? `${bin} search "${query}" --json` : `${bin} list --json`;
  const textCmd = query ? `${bin} search "${query}"` : `${bin} list`;

  let skills: MarketSkill[] = [];

  try {
    const { stdout } = await execAsync(jsonCmd, {
      timeout,
      maxBuffer: 1024 * 1024,
      env: getExtendedEnv()
    });
    skills = parseSkillHubOutput(stdout);
  } catch {
    // --json flag might not be supported, fall back to text output
    try {
      const { stdout } = await execAsync(textCmd, {
        timeout,
        maxBuffer: 1024 * 1024,
        env: getExtendedEnv()
      });
      skills = parseSkillHubOutput(stdout);
    } catch (error) {
      console.error('[SkillMarket] CLI search failed:', error);
      throw new Error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Update cache
  if (!query && page === 1) {
    cachedSkills = skills;
    cacheTime = Date.now();
  }

  const start = (page - 1) * limit;
  const end = start + limit;

  return {
    skills: skills.slice(start, end),
    total: skills.length,
    hasMore: end < skills.length,
    page
  };
}

/**
 * Fetch skills from SkillHub web API (fallback)
 */
async function searchViaWebAPI(
  query: string | undefined,
  page: number,
  limit: number,
): Promise<MarketSearchResult> {
  // SkillHub API endpoint (if available)
  // Note: This is a placeholder - actual API needs to be discovered
  const baseUrl = 'https://skillhub.tencent.com/api';

  try {
    const params = new URLSearchParams({
      q: query || '',
    page: String(page),
    limit: String(limit)
  });

    const response = await fetch(`${baseUrl}/skills?${params}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Genvis/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();

    // API may return { results: [...], count } or { skills: [...], total }
    const rawSkills: unknown[] = data.results || data.skills || data.data || [];
    const totalCount: number = data.count || data.total || rawSkills.length;

    const skills: MarketSkill[] = rawSkills
      .filter((item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null
      )
      .map(item => ({
        name: String(item.slug || item.name || ''),
        displayName: String(item.displayName || item.display_name || item.name || item.slug || ''),
        description: String(item.description || item.desc || item.summary || ''),
        author: item.author ? String(item.author) : undefined,
        version: item.version ? String(item.version) : undefined,
        downloads: typeof item.downloads === 'number'
          ? item.downloads
          : typeof item.download_count === 'number'
            ? item.download_count
            : undefined,
        category: item.category ? String(item.category) : undefined,
        tags: Array.isArray(item.tags) ? item.tags.map(String) : undefined,
        installed: false,
      }))
      .filter(s => s.name);

    return {
      skills,
      total: totalCount,
      hasMore: (page * limit) < totalCount,
      page
    };
  } catch (error) {
    console.error('[SkillMarket] Web API search failed:', error);

    // Return empty result if API fails
    return {
      skills: [],
      total: 0,
      hasMore: false,
      page
    };
  }
}

/**
 * Parse SkillHub CLI output into structured skill list.
 * Supports JSON output (preferred) and text tabular output (fallback).
 */
function parseSkillHubOutput(output: string): MarketSkill[] {
  const trimmed = output.trim();

  // 1) Try JSON parsing first
  try {
    const parsed = JSON.parse(trimmed);
    const arr: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.results)
        ? parsed.results
        : Array.isArray(parsed?.skills)
          ? parsed.skills
          : Array.isArray(parsed?.data)
            ? parsed.data
            : [];

    if (arr.length > 0) {
      return arr.filter((item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null &&
        (typeof (item as Record<string, unknown>).name === 'string' || typeof (item as Record<string, unknown>).slug === 'string')
      ).map(item => ({
        name: String(item.slug || item.name),
        displayName: String(item.displayName || item.display_name || item.name || item.slug),
        description: String(item.description || item.desc || item.summary || ''),
        author: item.author ? String(item.author) : undefined,
        version: item.version ? String(item.version) : undefined,
        downloads: typeof item.downloads === 'number'
          ? item.downloads
          : typeof item.download_count === 'number'
            ? item.download_count
            : undefined,
        category: item.category ? String(item.category) : undefined,
        tags: Array.isArray(item.tags) ? item.tags.map(String) : undefined,
        installed: false,
      }));
    }
  } catch {
    // Not JSON, fall through to text parsing
  }

  // 2) Text tabular parsing
  const skills: MarketSkill[] = [];
  const lines = trimmed.split('\n').filter(line => line.trim());

  for (const line of lines) {
    // Skip header/separator lines
    if (line.startsWith('#') || line.startsWith('---') || line.startsWith('=')) continue;

    // Parse format: "skill-name  Description text  author  version  downloads"
    const parts = line.split(/\s{2,}/);

    if (parts.length >= 2) {
      const name = parts[0]?.trim();
      if (!name) continue;

      const description = parts[1]?.trim() || '';
      const author = parts.length >= 3 ? parts[2]?.trim() : undefined;
      const versionOrDownloads = parts.length >= 4 ? parts[3]?.trim() : undefined;
      const downloadsStr = parts.length >= 5 ? parts[4]?.trim() : undefined;

      // Heuristic: if a field looks like a version (starts with v or digit.digit), treat as version
      let version: string | undefined;
      let downloads: number | undefined;

      if (versionOrDownloads) {
        if (/^v?\d+\.\d+/.test(versionOrDownloads)) {
          version = versionOrDownloads;
        } else if (/^\d+$/.test(versionOrDownloads)) {
          downloads = parseInt(versionOrDownloads, 10);
        }
      }
      if (downloadsStr && /^\d+$/.test(downloadsStr)) {
        downloads = parseInt(downloadsStr, 10);
      }

      skills.push({
        name,
        displayName: name,
        description,
        author: author || undefined,
        version,
        downloads,
        installed: false,
      });
    }
  }

  return skills;
}

/**
 * Install a skill from the marketplace
 * Automatically installs SkillHub CLI if not available
 */
export async function installFromMarket(
  skillName: string,
  onProgress?: (step: string, message: string) => void
): Promise<InstallResult> {
  let cliAvailable = await isSkillHubAvailable();

  // Auto-install CLI if not available
  if (!cliAvailable) {
    onProgress?.('cli-install', 'SkillHub CLI not found. Installing automatically...');

    const cliResult = await installSkillHubCLI((step, message) => {
      onProgress?.(`cli-${step}`, message);
    });

    if (!cliResult.success) {
      return {
        success: false,
        error: `Failed to install SkillHub CLI: ${cliResult.error}`
      };
    }

    // Re-check CLI availability
    cliAvailable = await isSkillHubAvailable();
    if (!cliAvailable) {
      return {
        success: false,
        error: 'SkillHub CLI installation completed but command not found. Please restart the app and try again.'
      };
    }
  }

  onProgress?.('install', `Installing ${skillName}...`);

  try {
    const bin = getSkillHubBin();
    const { stdout, stderr } = await execAsync(`${bin} install "${skillName}"`, {
      timeout: 120000, // 2 minutes timeout for installation
      env: getExtendedEnv()
    });

    if (stderr && stderr.includes('error')) {
      return {
        success: false,
        error: stderr
      };
    }

    onProgress?.('done', 'Installation completed!');

    return {
      success: true,
      skillName
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[SkillMarket] Install failed:', errorMsg);

    return {
      success: false,
      error: `Installation failed: ${errorMsg}`
    };
  }
}

/**
 * Clear the skill cache
 */
export function clearSkillCache(): void {
  cachedSkills = null;
  cacheTime = 0;
}

/**
 * Get featured skills (TOP 50 from SkillHub)
 */
export async function getFeaturedSkills(): Promise<MarketSkill[]> {
  // For now, use the search function with empty query
  const result = await searchMarketSkills('', 1, 50);
  return result.skills;
}

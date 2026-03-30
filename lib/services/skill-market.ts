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
import path from 'path';
import { USER_SKILLS_DIR_ABSOLUTE } from '@/lib/config/paths';

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
// On Windows, skillhub may be .cmd (bundled wrapper), .exe, or extensionless (bash script from install.sh)
const SKILLHUB_BIN = 'skillhub';

/** Cached resolved path to the skillhub binary */
let _resolvedSkillHubPath: string | null = null;

/** Home directory (works on all platforms) */
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';

/**
 * Get the path to the builtin skillhub CLI bundled with the Electron app.
 * Set by electron/main.js via SKILLHUB_BUILTIN_PATH env var,
 * or detected from process.resourcesPath.
 */
function getBuiltinSkillHubPath(): string | null {
  // Priority 1: env var set by electron/main.js
  if (process.env.SKILLHUB_BUILTIN_PATH) {
    try {
      fs.accessSync(process.env.SKILLHUB_BUILTIN_PATH, IS_WIN ? fs.constants.F_OK : fs.constants.X_OK);
      return process.env.SKILLHUB_BUILTIN_PATH;
    } catch {
      // not available
    }
  }

  // Priority 2: detect from resourcesPath (Electron production)
  try {
    // @ts-ignore - process.resourcesPath is Electron-specific
    const resourcesPath = process.resourcesPath;
    if (resourcesPath) {
      let builtinPath: string;
      if (IS_WIN) {
        builtinPath = path.join(resourcesPath, 'skillhub-cli', 'win32-x64', 'bin', 'skillhub.cmd');
      } else {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        builtinPath = path.join(resourcesPath, 'skillhub-cli', `darwin-${arch}`, 'bin', 'skillhub');
      }
      try {
        fs.accessSync(builtinPath, IS_WIN ? fs.constants.F_OK : fs.constants.X_OK);
        return builtinPath;
      } catch {
        // not bundled
      }
    }
  } catch {
    // not in Electron context
  }

  return null;
}

/** Common installation paths for skillhub CLI (platform-aware) */
function getCommonPaths(): string[] {
  if (IS_WIN) {
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    // On Windows, skillhub may be .cmd, .exe, or extensionless bash script
    const winCandidates: string[] = [];
    const winDirs = [
      ...(localAppData ? [`${localAppData}\\skillhub\\bin`] : []),
      ...(appData ? [`${appData}\\skillhub\\bin`] : []),
      ...(HOME_DIR ? [
        `${HOME_DIR}\\.skillhub\\bin`,
        `${HOME_DIR}\\.local\\bin`,
      ] : []),
    ];
    for (const dir of winDirs) {
      winCandidates.push(`${dir}\\skillhub.cmd`, `${dir}\\skillhub.exe`, `${dir}\\skillhub`);
    }
    winCandidates.push(
      'C:\\Program Files\\skillhub\\bin\\skillhub.exe',
      'C:\\Program Files (x86)\\skillhub\\bin\\skillhub.exe',
    );
    return winCandidates;
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
  return _resolvedSkillHubPath || 'skillhub';
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
        ...(HOME_DIR ? [`${HOME_DIR}\\.skillhub\\bin`, `${HOME_DIR}\\.local\\bin`] : []),
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

  // Priority check: builtin CLI bundled with the Electron app
  const builtinPath = getBuiltinSkillHubPath();
  if (builtinPath) {
    _resolvedSkillHubPath = builtinPath;
    return true;
  }

  // Try `which` (Unix) or `where` (Windows) with extended PATH
  // On Windows, try multiple extensions: .cmd (bundled), .exe, and extensionless
  const whichCmds = IS_WIN
    ? ['where skillhub.cmd', 'where skillhub.exe', 'where skillhub']
    : [`which ${SKILLHUB_BIN}`];
  for (const whichCmd of whichCmds) {
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
      // try next
    }
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
  // Both platforms use the tar.gz archive (the .ps1 installer URL is broken on COS)
  const tarURL = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz';
  let installCmd: string;
  if (IS_WIN) {
    // Windows: download tar.gz, extract, run install.sh via bash if available,
    // otherwise manually install Python CLI files + create .cmd wrapper
    installCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "`
      + `$ErrorActionPreference='Continue'; `
      + `$tmpDir = Join-Path $env:TEMP ('skillhub-install-' + (Get-Random)); `
      + `New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null; `
      + `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; `
      + `Invoke-WebRequest -Uri '${tarURL}' -OutFile (Join-Path $tmpDir 'latest.tar.gz') -UseBasicParsing; `
      + `$extractDir = Join-Path $tmpDir 'extracted'; `
      + `New-Item -ItemType Directory -Path $extractDir -Force | Out-Null; `
      + `tar -xzf (Join-Path $tmpDir 'latest.tar.gz') -C $extractDir; `
      + `$installer = Get-ChildItem -Path $extractDir -Recurse -Filter 'install.sh' | Select-Object -First 1; `
      + `$bashExe = Get-Command bash -ErrorAction SilentlyContinue; `
      + `if ($installer -and $bashExe) { & bash $installer.FullName --cli-only } `
      + `else { `
      // Manual install: find skills_store_cli.py and set up ~/.skillhub/ + .cmd wrapper
      + `$cliPy = Get-ChildItem -Path $extractDir -Recurse -Filter 'skills_store_cli.py' | Select-Object -First 1; `
      + `if ($cliPy) { `
      + `$skillhubHome = Join-Path $env:USERPROFILE '.skillhub'; `
      + `New-Item -ItemType Directory -Path $skillhubHome -Force | Out-Null; `
      + `Copy-Item $cliPy.FullName (Join-Path $skillhubHome 'skills_store_cli.py') -Force; `
      + `$srcDir = $cliPy.DirectoryName; `
      + `foreach ($f in @('skills_upgrade.py','config.json','metadata.json','version.json')) { `
      + `$fp = Join-Path $srcDir $f; if (Test-Path $fp) { Copy-Item $fp (Join-Path $skillhubHome $f) -Force } }; `
      + '$binDir = Join-Path $env:LOCALAPPDATA \'skillhub\' \'bin\'; '
      + 'New-Item -ItemType Directory -Path $binDir -Force | Out-Null; '
      + '$cmdLines = @("@echo off","setlocal","set \"CLI=%USERPROFILE%\.skillhub\skills_store_cli.py\"","if not exist \"%CLI%\" (echo Error: SkillHub CLI not found >&2 ^& exit /b 1)","python \"%CLI%\" %*"); '
      + '[System.IO.File]::WriteAllLines((Join-Path $binDir \'skillhub.cmd\'), $cmdLines); '
      + 'Write-Host (\'Installed CLI to \' + $skillhubHome + \', wrapper at \' + $binDir) '
      + `} else { Write-Error 'skills_store_cli.py not found in archive' } `
      + `}; `
      + `Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue`
      + `"`;
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

/** Track CLI search failures to avoid repeated slow timeouts */
let _cliSearchFailed = false;
let _cliSearchFailedTime = 0;
const CLI_RETRY_INTERVAL = 5 * 60 * 1000; // Retry CLI after 5 minutes

/**
 * Search skills from SkillHub marketplace.
 * Uses Web API directly (fast & reliable). CLI is no longer tried for search
 * because the npm-installed CLI on Windows connects to a different, often
 * unreachable registry causing 30-60s timeouts.
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

  // Skip CLI if it previously failed (retry after CLI_RETRY_INTERVAL)
  const shouldTryCli = !_cliSearchFailed || (Date.now() - _cliSearchFailedTime > CLI_RETRY_INTERVAL);

  if (shouldTryCli) {
    const cliAvailable = await isSkillHubAvailable();
    if (cliAvailable) {
      try {
        const result = await searchViaCLI(query, page, limit);
        _cliSearchFailed = false; // CLI works, reset failure flag
        return result;
      } catch (cliError) {
        _cliSearchFailed = true;
        _cliSearchFailedTime = Date.now();
        console.warn('[SkillMarket] CLI search failed, using web API (will skip CLI for 5min):', cliError instanceof Error ? cliError.message : cliError);
      }
    }
  }

  // Primary path: fetch from SkillHub web API (fast, works everywhere)
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
  const timeout = 10000; // 10 seconds (keep short to fail fast on unreachable registries)

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
      // Don't throw - let caller fall back to web API
      throw error;
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
  // SkillHub search API (same as used by skills_store_cli.py)
  const searchUrl = 'https://lightmake.site/api/v1/search';
  // Full index for browsing (no query)
  const indexUrl = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills.json';

  try {
    let rawSkills: unknown[] = [];
    let totalCount = 0;

    if (query) {
      // Use search API
      const params = new URLSearchParams({
        q: query,
        limit: String(limit),
      });
      const response = await fetch(`${searchUrl}?${params}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Genvis/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Search API returned ${response.status}`);
      const data = await response.json();
      rawSkills = data.results || data.skills || data.data || [];
      totalCount = rawSkills.length;
    } else {
      // Fetch full index for browsing
      const response = await fetch(indexUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Genvis/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Index API returned ${response.status}`);
      const data = await response.json();
      rawSkills = Array.isArray(data) ? data : (data.skills || data.results || data.data || []);
      totalCount = rawSkills.length;
    }

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

    // Update cache for full index
    if (!query && page === 1) {
      cachedSkills = skills;
      cacheTime = Date.now();
    }

    const start = (page - 1) * limit;
    const end = start + limit;

    return {
      skills: skills.slice(start, end),
      total: totalCount,
      hasMore: end < totalCount,
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
 * Install a skill from the marketplace.
 * Strategy:
 *   1. Try CLI with --dir flag (Python-based skillhub)
 *   2. If --dir not supported, try CLI without --dir (npm-based skillhub-cli)
 *   3. If CLI fails entirely, download zip directly via web API
 */
export async function installFromMarket(
  skillName: string,
  onProgress?: (step: string, message: string) => void
): Promise<InstallResult> {
  const installDir = USER_SKILLS_DIR_ABSOLUTE;

  // Ensure install directory exists
  try {
    fs.mkdirSync(installDir, { recursive: true });
  } catch { /* already exists */ }

  onProgress?.('install', `Installing ${skillName}...`);

  // Try CLI install first
  const cliAvailable = await isSkillHubAvailable();
  if (cliAvailable) {
    const cliResult = await tryInstallViaCLI(skillName, installDir);
    if (cliResult.success) {
      await postInstallRefresh(onProgress);
      return cliResult;
    }
    // CLI failed - log and fall through to direct download
    console.warn('[SkillMarket] CLI install failed, trying direct download:', cliResult.error);
  }

  // Fallback: direct download via web API
  onProgress?.('download', `Downloading ${skillName} from marketplace...`);
  const dlResult = await installViaDirectDownload(skillName, installDir);
  if (dlResult.success) {
    await postInstallRefresh(onProgress);
  }
  return dlResult;
}

/**
 * Try installing via CLI (handles both Python and npm versions)
 */
async function tryInstallViaCLI(
  skillName: string,
  installDir: string,
): Promise<InstallResult> {
  const bin = getSkillHubBin();
  const installEnv = getExtendedEnv();

  // Attempt 1: with --dir flag (Python-based CLI)
  try {
    const { stdout, stderr } = await execAsync(
      `${bin} --dir "${installDir}" install "${skillName}"`,
      { timeout: 120000, env: installEnv }
    );
    if (stderr && stderr.includes('error') && !stderr.includes('info:')) {
      return { success: false, error: stderr };
    }
    return { success: true, skillName };
  } catch (dirError) {
    const errMsg = dirError instanceof Error ? dirError.message : String(dirError);
    // If --dir is not recognized, try without it (npm-based CLI)
    if (errMsg.includes('unknown option') || errMsg.includes('--dir')) {
      console.warn('[SkillMarket] CLI does not support --dir, trying with cwd...');
      try {
        const { stdout, stderr } = await execAsync(
          `${bin} install "${skillName}"`,
          { timeout: 120000, env: installEnv, cwd: installDir }
        );
        if (stderr && stderr.includes('error') && !stderr.includes('info:')) {
          return { success: false, error: stderr };
        }
        return { success: true, skillName };
      } catch (cwdError) {
        return { success: false, error: cwdError instanceof Error ? cwdError.message : String(cwdError) };
      }
    }
    return { success: false, error: errMsg };
  }
}

/**
 * Install a skill by directly downloading the zip from SkillHub CDN.
 * No CLI dependency - pure HTTP download + zip extraction.
 */
async function installViaDirectDownload(
  skillName: string,
  installDir: string,
): Promise<InstallResult> {
  // Download URLs (same as used by Python CLI)
  const primaryUrl = `https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills/${encodeURIComponent(skillName)}.zip`;
  const fallbackUrl = `https://lightmake.site/api/v1/download?slug=${encodeURIComponent(skillName)}`;

  const targetDir = path.join(installDir, skillName);

  // Don't overwrite existing
  if (fs.existsSync(targetDir)) {
    return { success: false, error: `Skill already exists at ${targetDir}. Remove it first to reinstall.` };
  }

  for (const url of [primaryUrl, fallbackUrl]) {
    try {
      console.log(`[SkillMarket] Downloading from: ${url}`);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Genvis/1.0' },
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        console.warn(`[SkillMarket] Download returned ${response.status} from ${url}`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Extract zip to target directory
      const { extractZipBuffer } = await import('@/lib/utils/zip-extract');
      await extractZipBuffer(buffer, targetDir);

      console.log(`[SkillMarket] Installed ${skillName} to ${targetDir}`);
      return { success: true, skillName };
    } catch (err) {
      console.warn(`[SkillMarket] Download from ${url} failed:`, err instanceof Error ? err.message : err);
      continue;
    }
  }

  return {
    success: false,
    error: `Failed to download skill "${skillName}" from marketplace. Please check your network connection.`
  };
}

/**
 * Post-install: refresh skill registry so the new skill appears in the list
 */
async function postInstallRefresh(
  onProgress?: (step: string, message: string) => void
): Promise<void> {
  onProgress?.('register', 'Registering skill...');
  try {
    const { validateAndUpdatePluginJson } = await import('@/lib/services/skill-service');
    await validateAndUpdatePluginJson();
  } catch (regError) {
    console.warn('[SkillMarket] Post-install plugin.json update failed:', regError);
  }

  try {
    const { rebuildRegistry } = await import('@/lib/services/api-skill-registry');
    await rebuildRegistry();
  } catch (regError) {
    console.warn('[SkillMarket] Post-install registry rebuild failed:', regError);
  }

  onProgress?.('done', 'Installation completed!');
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

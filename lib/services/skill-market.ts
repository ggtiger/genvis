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

/**
 * Check if skillhub CLI is available
 */
export async function isSkillHubAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('which skillhub', { timeout: 5000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
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

  const installScriptUrl = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh';
  const installCmd = `curl -fsSL ${installScriptUrl} | bash -s -- --cli-only`;

  try {
    const { stdout, stderr } = await execAsync(installCmd, {
      timeout: 180000, // 3 minutes timeout
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    });

    onProgress?.('verify', 'Verifying installation...');

    // Verify installation
    const installed = await isSkillHubAvailable();
    if (installed) {
      onProgress?.('done', 'SkillHub CLI installed successfully!');
      return { success: true };
    } else {
      // CLI might be in PATH but not immediately available
      // Try common installation paths
      const possiblePaths = [
        '/usr/local/bin/skillhub',
        '/usr/bin/skillhub',
        `${process.env.HOME}/.local/bin/skillhub`,
      ];

      for (const path of possiblePaths) {
        try {
          await execAsync(`test -x ${path}`, { timeout: 5000 });
          onProgress?.('done', 'SkillHub CLI installed successfully!');
          return { success: true };
        } catch {
          // Path doesn't exist, continue checking
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
  const searchCmd = query ? `skillhub search "${query}"` : 'skillhub list';
  const timeout = 30000; // 30 seconds

  try {
    const { stdout } = await execAsync(searchCmd, {
    timeout,
    maxBuffer: 1024 * 1024, // 1MB buffer
    env: { ...process.env, LANG: 'en_US.UTF-8' }
    });

    const skills = parseSkillHubOutput(stdout);

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
  } catch (error) {
    console.error('[SkillMarket] CLI search failed:', error);
    throw new Error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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

    return {
      skills: data.skills || [],
      total: data.total || 0,
      hasMore: data.hasMore || false,
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
 * Parse SkillHub CLI output into structured skill list
 */
function parseSkillHubOutput(output: string): MarketSkill[] {
  const skills: MarketSkill[] = [];
  const lines = output.split('\n').filter(line => line.trim());

  for (const line of lines) {
    // Parse format: "skill-name  Description text  author/name  downloads"
    // This is a simplified parser - actual format needs to be verified
    const parts = line.split(/\s{2,}/);

    if (parts.length >= 2) {
      const name = parts[0]?.trim();
      const description = parts[1]?.trim();

      if (name && !name.startsWith('#') && !name.startsWith('---')) {
        skills.push({
          name,
          displayName: name,
          description: description || '',
          installed: false
        });
      }
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
    const { stdout, stderr } = await execAsync(`skillhub install "${skillName}"`, {
      timeout: 120000, // 2 minutes timeout for installation
      env: { ...process.env, LANG: 'en_US.UTF-8' }
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

/**
 * API Skill Registry Service
 *
 * Manages the registration and persistence of API skill metadata.
 * Scans skill directories for api-endpoints.json files, validates them,
 * and maintains a registry of all registered API skills.
 *
 * Storage location:
 * - Production (Electron): {userData}/settings/api-skill-registry.json (via SETTINGS_DIR env var)
 * - Development: {cwd}/data/api-skill-registry.json
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 5.3, 7.1, 7.2
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { USER_SKILLS_DIR_ABSOLUTE, SKILLS_DIR_ABSOLUTE } from '@/lib/config/paths';
import { isSkillEnabled, getSkillEnvVars } from '@/lib/services/skill-service';
import {
  type ApiEndpointsConfig,
  type RegisteredApiSkill,
  type ApiSkillRegistryData,
  createEmptyRegistry,
  validateApiEndpointsConfig,
} from '@/lib/types/api-skill';

// ========== Internal Helpers ==========

/**
 * Resolve the data directory for storing the registry file.
 * Uses SETTINGS_DIR env var if set (production Electron sets this),
 * falls back to {cwd}/data (development).
 */
function getRegistryDir(): string {
  return process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
}

/**
 * Get the full path to the registry JSON file.
 */
function getRegistryFilePath(): string {
  return path.join(getRegistryDir(), 'api-skill-registry.json');
}

/**
 * Validate that a parsed object conforms to the ApiSkillRegistryData shape.
 */
function isValidRegistryData(obj: unknown): obj is ApiSkillRegistryData {
  if (!obj || typeof obj !== 'object') return false;
  const r = obj as Record<string, unknown>;
  return (
    r.version === 1 &&
    Array.isArray(r.skills) &&
    typeof r.updatedAt === 'string'
  );
}

/**
 * Check if all required auth env vars have non-empty values.
 */
async function isAuthConfigured(
  skillName: string,
  envVarNames: string[]
): Promise<boolean> {
  if (envVarNames.length === 0) {
    return true;
  }

  try {
    const envVars = await getSkillEnvVars(skillName);
    return envVarNames.every(
      (varName) => varName in envVars && envVars[varName].trim().length > 0
    );
  } catch {
    // If we can't read env vars (e.g., skill not found), treat as not configured
    return false;
  }
}

/**
 * Build a RegisteredApiSkill entry from a validated config.
 */
async function buildRegisteredSkill(
  config: ApiEndpointsConfig
): Promise<RegisteredApiSkill> {
  const authType = config.auth?.authType ?? 'none';
  const envVars = config.auth?.envVars;
  let configured = true;

  if (authType !== 'none' && envVars && envVars.length > 0) {
    configured = await isAuthConfigured(config.skillName, envVars);
  }

  return {
    skillName: config.skillName,
    displayName: config.displayName,
    description: config.description,
    auth: {
      authType,
      envVars,
      configured,
    },
    endpoints: config.endpoints,
    registeredAt: new Date().toISOString(),
  };
}

// ========== Public API ==========

/**
 * Load registry data from the JSON file.
 * Returns an empty registry if the file doesn't exist or is corrupted.
 *
 * Validates: Requirements 2.3
 */
export async function loadRegistry(): Promise<ApiSkillRegistryData> {
  const filePath = getRegistryFilePath();

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (isValidRegistryData(parsed)) {
      return parsed;
    }

    // File exists but content is invalid – reset to empty
    console.warn('[ApiSkillRegistry] Invalid registry data, returning empty registry');
    return createEmptyRegistry();
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      // File does not exist – normal first-run case
      return createEmptyRegistry();
    }

    // JSON parse error or other read error – reset gracefully
    console.warn('[ApiSkillRegistry] Failed to load registry, returning empty registry:', error);
    return createEmptyRegistry();
  }
}

/**
 * Save registry data to the JSON file.
 * Automatically updates the top-level `updatedAt` timestamp.
 *
 * Validates: Requirements 2.3
 */
export async function saveRegistry(registry: ApiSkillRegistryData): Promise<void> {
  const filePath = getRegistryFilePath();
  const dir = getRegistryDir();

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  // Update the updatedAt timestamp
  const registryToSave: ApiSkillRegistryData = {
    ...registry,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(filePath, JSON.stringify(registryToSave, null, 2), 'utf-8');
}

/**
 * Register a single API skill by name.
 * Scans the skill directory for api-endpoints.json, validates it,
 * checks auth configuration status, and adds to the registry.
 *
 * Validates: Requirements 2.1, 5.3
 */
export async function registerSkill(skillName: string): Promise<void> {
  // Look in both user skills and builtin skills directories
  let skillDir = path.join(USER_SKILLS_DIR_ABSOLUTE, skillName);
  if (!fsSync.existsSync(skillDir)) {
    skillDir = path.join(SKILLS_DIR_ABSOLUTE, skillName);
  }

  // Check if skill directory exists
  if (!fsSync.existsSync(skillDir)) {
    console.warn(`[ApiSkillRegistry] Skill directory not found: ${skillName}`);
    return;
  }

  // Check if api-endpoints.json exists
  const endpointsPath = path.join(skillDir, 'api-endpoints.json');
  if (!fsSync.existsSync(endpointsPath)) {
    // Not an API skill – silently skip
    return;
  }

  // Check if skill is enabled
  const enabled = await isSkillEnabled(skillName);
  if (!enabled) {
    console.warn(`[ApiSkillRegistry] Skill is disabled, skipping: ${skillName}`);
    return;
  }

  // Parse and validate api-endpoints.json
  let config: ApiEndpointsConfig | null = null;
  try {
    const raw = await fs.readFile(endpointsPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    config = validateApiEndpointsConfig(parsed);
  } catch (error) {
    console.warn(`[ApiSkillRegistry] Failed to parse api-endpoints.json for ${skillName}:`, error);
    return;
  }

  if (!config) {
    console.warn(`[ApiSkillRegistry] Invalid api-endpoints.json for ${skillName}, skipping`);
    return;
  }

  // Build registered skill entry
  const registeredSkill = await buildRegisteredSkill(config);

  // Load current registry, update, and save
  const registry = await loadRegistry();

  // Remove existing entry for this skill (if any) before adding
  registry.skills = registry.skills.filter((s) => s.skillName !== skillName);
  registry.skills.push(registeredSkill);

  await saveRegistry(registry);
}

/**
 * Unregister a skill from the registry by name.
 *
 * Validates: Requirements 2.2
 */
export async function unregisterSkill(skillName: string): Promise<void> {
  const registry = await loadRegistry();
  const originalLength = registry.skills.length;

  registry.skills = registry.skills.filter((s) => s.skillName !== skillName);

  // Only save if something was actually removed
  if (registry.skills.length !== originalLength) {
    await saveRegistry(registry);
  }
}

/**
 * Rebuild the entire registry by scanning all enabled skills in both
 * SKILLS_DIR_ABSOLUTE (builtin) and USER_SKILLS_DIR_ABSOLUTE (user).
 * Called at application startup to ensure registry is consistent with actual skill state.
 *
 * Validates: Requirements 2.4
 */
export async function rebuildRegistry(): Promise<ApiSkillRegistryData> {
  const registry = createEmptyRegistry();
  const seenSkills = new Set<string>();

  console.log('[ApiSkillRegistry] Rebuilding registry, scanning user skills and builtin skills...');

  // Scan a single directory for API skills
  async function scanDirectory(dirPath: string, label: string): Promise<void> {
    if (!fsSync.existsSync(dirPath)) {
      console.log(`[ApiSkillRegistry] ${label} directory not found: ${dirPath}`);
      return;
    }

    console.log(`[ApiSkillRegistry] Scanning ${label} directory: ${dirPath}`);

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip non-directories and hidden/special directories
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }

        const skillName = entry.name;

        // Skip if already registered from a previous directory (user skills take priority)
        if (seenSkills.has(skillName)) {
          continue;
        }

        const endpointsPath = path.join(dirPath, skillName, 'api-endpoints.json');

        // Check if api-endpoints.json exists
        if (!fsSync.existsSync(endpointsPath)) {
          continue;
        }

        // Check if skill is enabled
        const enabled = await isSkillEnabled(skillName);
        if (!enabled) {
          continue;
        }

        // Parse and validate api-endpoints.json
        let config: ApiEndpointsConfig | null = null;
        try {
          const raw = await fs.readFile(endpointsPath, 'utf-8');
          const parsed: unknown = JSON.parse(raw);
          config = validateApiEndpointsConfig(parsed);
        } catch (error) {
          console.warn(
            `[ApiSkillRegistry] Failed to parse api-endpoints.json for ${skillName} (${label}):`,
            error
          );
          continue;
        }

        if (!config) {
          console.warn(
            `[ApiSkillRegistry] Invalid api-endpoints.json for ${skillName} (${label}), skipping`
          );
          continue;
        }

        // Build registered skill entry and add to registry
        const registeredSkill = await buildRegisteredSkill(config);
        registry.skills.push(registeredSkill);
        seenSkills.add(skillName);
      }
    } catch (error) {
      console.warn(`[ApiSkillRegistry] Failed to scan ${label} directory:`, error);
    }
  }

  // Scan user skills first (higher priority), then builtin skills
  await scanDirectory(USER_SKILLS_DIR_ABSOLUTE, 'user');
  await scanDirectory(SKILLS_DIR_ABSOLUTE, 'builtin');

  console.log(`[ApiSkillRegistry] Registry rebuilt: ${registry.skills.length} skill(s) registered: ${registry.skills.map(s => s.skillName).join(', ') || '(none)'}`);

  await saveRegistry(registry);
  return registry;
}

/**
 * Get all registered API skills from the registry.
 * Pure function that operates on the registry data.
 *
 * Validates: Requirements 7.1
 */
export function getRegisteredSkills(
  registry: ApiSkillRegistryData
): RegisteredApiSkill[] {
  return registry.skills;
}

/**
 * Get a single registered API skill by name.
 * Pure function that operates on the registry data.
 *
 * Validates: Requirements 7.2
 */
/**
 * Get a single registered API skill by name.
 * Matches by skillName (exact), displayName (exact), or fuzzy substring.
 * Pure function that operates on the registry data.
 *
 * Validates: Requirements 7.2
 */
export function getSkillByName(
  registry: ApiSkillRegistryData,
  skillName: string
): RegisteredApiSkill | undefined {
  const normalized = skillName.toLowerCase();

  // 1. Exact match by skillName
  const exactSkill = registry.skills.find((s) => s.skillName.toLowerCase() === normalized);
  if (exactSkill) return exactSkill;

  // 2. Exact match by displayName
  const exactDisplay = registry.skills.find((s) => s.displayName.toLowerCase() === normalized);
  if (exactDisplay) return exactDisplay;

  // 3. Fuzzy substring match (target contains name or vice versa)
  return registry.skills.find(
    (s) =>
      normalized.includes(s.skillName.toLowerCase()) ||
      normalized.includes(s.displayName.toLowerCase()) ||
      s.skillName.toLowerCase().includes(normalized) ||
      s.displayName.toLowerCase().includes(normalized)
  );
}


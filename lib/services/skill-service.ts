/**
 * Skill Service - Manage skills for Claude SDK
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import matter from 'gray-matter';
import AdmZip from 'adm-zip';
import {
  SKILLS_DIR_ABSOLUTE,
  USER_SKILLS_DIR_ABSOLUTE,
} from '@/lib/config/paths';
import type { DeployStatus, SkillDeployMeta } from './deploy-manager';

// Directories and files to preserve when updating builtin skills
// These contain user data that should not be overwritten on version update
const PRESERVE_DIRS_ON_UPDATE = ['prisma', 'data', 'node_modules', '.next'];
const PRESERVE_FILES_ON_UPDATE = ['.env.local'];

// Global singleton for initialization state (similar to DB client pattern)
const globalForSkills = global as unknown as {
  skillsInitialized: boolean | undefined;
  skillsInitPromise: Promise<void> | undefined;
};

export interface EnvVarConfig {
  key: string;
  label: string;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  default?: string;
}

export interface SkillMeta {
  name: string;
  displayName?: string;
  description: string;
  path: string;
  source: 'builtin' | 'user';
  size: number;
  // Extended fields
  category?: string;
  tags?: string[];
  version?: string;
  author?: string;
  preview?: string;
  projectType?: 'nextjs' | 'python-fastapi';
  envVars?: EnvVarConfig[];
  // Capability flags
  hasSkill: boolean;   // Has SKILL.md (can be used as SDK skill)
  hasApp: boolean;     // Has projectType (can run as BS app)
  // Deploy fields (populated from plugin-ex.json deployedSkills)
  deployStatus?: DeployStatus;
  deployPort?: number;
}

// Plugin config interface (SDK standard fields only)
interface PluginConfig {
  name: string;
  description: string;
  version: string;
  skills: string[];
}

/**
 * Extended config file (plugin-ex.json)
 *
 * Why we need a separate extended config file:
 * - Claude SDK's plugin.json has strict schema validation and only accepts standard fields (name, description, version, skills)
 * - We need to track additional custom fields (disabledSkills, builtinVersion) for Genvis's skill management
 * - These custom fields would cause SDK validation errors if added to plugin.json
 * - Solution: Store SDK-compliant fields in plugin.json, store extended fields in plugin-ex.json
 */
interface SkillExtendedConfig {
  disabledSkills?: string[];
  builtinVersion?: string; // Track which app version initialized builtin skills
  autoStartSkills?: string[]; // Skills to auto-start on system startup (only hasApp=true skills)
  deployedSkills?: Record<string, SkillDeployMeta>; // Local deploy metadata per skill
}

// Get app version (same as AppSidebar.tsx)
// In production, APP_VERSION env is set by electron/main.js
// In development, import from package.json works
function getAppVersion(): string {
  if (process.env.APP_VERSION) {
    return process.env.APP_VERSION;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/package.json').version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Get plugin.json path
 */
function getPluginJsonPath(): string {
  return path.join(USER_SKILLS_DIR_ABSOLUTE, '.claude-plugin', 'plugin.json');
}

/**
 * Get skill extended config file path (separate from plugin.json)
 */
function getSkillExtendedConfigPath(): string {
  return path.join(USER_SKILLS_DIR_ABSOLUTE, '.claude-plugin', 'plugin-ex.json');
}

/**
 * Read plugin.json config
 */
async function readPluginConfig(): Promise<PluginConfig | null> {
  const configPath = getPluginJsonPath();
  try {
    if (!fsSync.existsSync(configPath)) {
      return null;
    }
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content) as PluginConfig;
  } catch {
    return null;
  }
}

/**
 * Write plugin.json config (SDK standard fields only)
 */
async function writePluginConfig(config: PluginConfig): Promise<void> {
  const configPath = getPluginJsonPath();
  const wrapperDir = path.dirname(configPath);
  await fs.mkdir(wrapperDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Read skill extended config (internal tracking, not for SDK)
 */
export async function readSkillExtendedConfig(): Promise<SkillExtendedConfig> {
  const configPath = getSkillExtendedConfigPath();
  try {
    if (!fsSync.existsSync(configPath)) {
      return {};
    }
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content) as SkillExtendedConfig;
  } catch {
    return {};
  }
}

/**
 * Write skill extended config (internal tracking, not for SDK)
 */
export async function writeSkillExtendedConfig(config: SkillExtendedConfig): Promise<void> {
  const configPath = getSkillExtendedConfigPath();
  const wrapperDir = path.dirname(configPath);
  await fs.mkdir(wrapperDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Validate and update plugin.json based on actual directory contents
 * Preserves disabled skills list and builtin version marker (in separate config file)
 */
export async function validateAndUpdatePluginJson(builtinVersion?: string): Promise<void> {
  // Scan user-skills directory for valid skills
  const userSkillsDir = USER_SKILLS_DIR_ABSOLUTE;
  if (!fsSync.existsSync(userSkillsDir)) {
    await fs.mkdir(userSkillsDir, { recursive: true });
  }

  const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
  const validSkillNames: string[] = [];
  const appSkillNames: Set<string> = new Set(); // Skills with hasApp=true

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillDir = path.join(userSkillsDir, entry.name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (fsSync.existsSync(skillMdPath)) {
      validSkillNames.push(entry.name);
    }

    // Check if skill has hasApp=true (has projectType in template.json or SKILL.md)
    const parsed = await parseSkillDir(skillDir, entry.name);
    if (parsed?.hasApp) {
      appSkillNames.add(entry.name);
    }
  }

  // Also scan builtin skills directory for autoStartSkills cleanup
  // autoStartSkills can reference both builtin and user skills (getAllSkills merges both)
  const allSkillNames = new Set(validSkillNames);
  const allAppSkillNames = new Set(appSkillNames);
  if (fsSync.existsSync(SKILLS_DIR_ABSOLUTE)) {
    const builtinEntries = await fs.readdir(SKILLS_DIR_ABSOLUTE, { withFileTypes: true });
    for (const entry of builtinEntries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const skillDir = path.join(SKILLS_DIR_ABSOLUTE, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      if (fsSync.existsSync(skillMdPath)) {
        allSkillNames.add(entry.name);
        const parsed = await parseSkillDir(skillDir, entry.name);
        if (parsed?.hasApp) {
          allAppSkillNames.add(entry.name);
        }
      }
    }
  }

  // Read existing config to preserve disabled list and version
  const existingConfig = await readSkillExtendedConfig();
  const disabledSkills = existingConfig.disabledSkills || [];
  const autoStartSkills = existingConfig.autoStartSkills || [];

  // Filter out disabled skills from enabled list (user skills only for plugin.json)
  const enabledSkillPaths = validSkillNames
    .filter(name => !disabledSkills.includes(name))
    .map(name => `./${name}`);

  // Also clean up disabled list (remove skills that no longer exist in user-skills)
  const validDisabledSkills = disabledSkills.filter(name => validSkillNames.includes(name));

  // Clean up autoStartSkills: keep only skills that exist (builtin OR user) AND have hasApp=true
  const validAutoStartSkills = autoStartSkills.filter(
    name => allSkillNames.has(name) && allAppSkillNames.has(name)
  );

  // Write plugin.json (SDK standard fields only)
  const config: PluginConfig = {
    name: 'genvis-skills',
    description: 'Genvis managed skills',
    version: '1.0.0',
    skills: enabledSkillPaths,
  };
  await writePluginConfig(config);

  // Write extended config file (internal tracking)
  const extendedConfig: SkillExtendedConfig = {
    disabledSkills: validDisabledSkills.length > 0 ? validDisabledSkills : undefined,
    builtinVersion: builtinVersion || existingConfig.builtinVersion,
    autoStartSkills: validAutoStartSkills.length > 0 ? validAutoStartSkills : undefined,
    deployedSkills: existingConfig.deployedSkills,
  };
  await writeSkillExtendedConfig(extendedConfig);

  console.log(`[SkillService] Updated plugin.json: ${enabledSkillPaths.length} enabled, ${validDisabledSkills.length} disabled, ${validAutoStartSkills.length} auto-start`);
}

/**
 * Copy directory recursively, skip node_modules
 * Optionally skip .next as well (when target already has build artifacts)
 */
async function copyDirSkipNodeModules(
  src: string,
  dest: string,
  skipDirs: string[] = ['node_modules'],
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (skipDirs.includes(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirSkipNodeModules(srcPath, destPath, skipDirs);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Extract project.zip and flatten project/ subdirectory
 * Handles ZIP structure: project.zip -> project/ -> actual files
 */
async function extractProjectZip(zipPath: string, targetDir: string): Promise<void> {
  console.log(`[SkillService] Extracting ${zipPath} to ${targetDir}`);

  const zip = new AdmZip(zipPath);
  const tempDir = path.join(targetDir, `_temp_extract_${Date.now()}`);

  try {
    // Extract to temp directory
    zip.extractAllTo(tempDir, true);

    // Check if extracted to project/ subdirectory
    const projectSubdir = path.join(tempDir, 'project');
    const sourceDir = fsSync.existsSync(projectSubdir) ? projectSubdir : tempDir;

    // Move contents to target directory
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(sourceDir, entry.name);
      const destPath = path.join(targetDir, entry.name);

      // Remove existing file/dir if exists
      if (fsSync.existsSync(destPath)) {
        await fs.rm(destPath, { recursive: true, force: true });
      }

      await fs.rename(srcPath, destPath);
    }

    console.log(`[SkillService] Extracted ${entries.length} items from ${path.basename(zipPath)}`);
  } finally {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Copy a builtin skill to user-skills directory (overwrite if exists)
 */
async function ensureSkillInUserDir(builtinSkillPath: string, skillName: string): Promise<void> {
  const targetDir = path.join(USER_SKILLS_DIR_ABSOLUTE, skillName);

  // Check if should extract from project.zip
  const projectZipPath = path.join(builtinSkillPath, 'project.zip');
  const shouldExtractZip = fsSync.existsSync(projectZipPath) &&
                           !fsSync.existsSync(path.join(builtinSkillPath, 'wxauto_lib'));

  if (shouldExtractZip) {
    // Extract ZIP mode: skill has project.zip but missing wxauto_lib
    console.log(`[SkillService] Extracting ${skillName} from project.zip`);

    // Backup user data directories and files before removal
    const backupDir = path.join(USER_SKILLS_DIR_ABSOLUTE, `.backup-${skillName}-${Date.now()}`);
    const preservedPaths: { original: string; backup: string; isDir: boolean }[] = [];

    if (fsSync.existsSync(targetDir)) {
      // Collect paths to preserve
      for (const dirName of PRESERVE_DIRS_ON_UPDATE) {
        const originalPath = path.join(targetDir, dirName);
        if (fsSync.existsSync(originalPath)) {
          preservedPaths.push({
            original: originalPath,
            backup: path.join(backupDir, dirName),
            isDir: true
          });
        }
      }
      for (const fileName of PRESERVE_FILES_ON_UPDATE) {
        const originalPath = path.join(targetDir, fileName);
        if (fsSync.existsSync(originalPath)) {
          preservedPaths.push({
            original: originalPath,
            backup: path.join(backupDir, fileName),
            isDir: false
          });
        }
      }

      // Move preserved items to backup location
      if (preservedPaths.length > 0) {
        await fs.mkdir(backupDir, { recursive: true });
        for (const item of preservedPaths) {
          await fs.rename(item.original, item.backup);
          console.log(`[SkillService] Backed up: ${item.original}`);
        }
      }

      // Remove old directory
      await fs.rm(targetDir, { recursive: true, force: true });
    }

    // Create target directory
    await fs.mkdir(targetDir, { recursive: true });

    // Extract project.zip to target directory
    await extractProjectZip(projectZipPath, targetDir);

    // Copy additional files (template.json, mock.json, SKILL.md, etc.) that are not in ZIP
    const entries = await fs.readdir(builtinSkillPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'project.zip' || entry.name === 'project') {
        continue; // Skip ZIP and project directory
      }

      const srcPath = path.join(builtinSkillPath, entry.name);
      const destPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await copyDirSkipNodeModules(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }

    // Restore backed up user data
    for (const item of preservedPaths) {
      // Remove any files that were extracted from ZIP before restoring backup
      if (fsSync.existsSync(item.original)) {
        await fs.rm(item.original, { recursive: true, force: true });
      }
      await fs.rename(item.backup, item.original);
      console.log(`[SkillService] Restored: ${item.original}`);
    }

    // Cleanup backup directory
    if (fsSync.existsSync(backupDir)) {
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
    }

    console.log(`[SkillService] Extracted and copied builtin skill: ${skillName}`);
  } else {
    // Normal copy mode: no ZIP or already extracted
    // Always overwrite to ensure latest version
    const skipDirs = [...PRESERVE_DIRS_ON_UPDATE]; // Copy preserve list as skip list
    if (fsSync.existsSync(targetDir)) {
      // Remove old files but preserve user data, node_modules and .next if they exist
      const hasPreserveItems = PRESERVE_DIRS_ON_UPDATE.some(dirName =>
        fsSync.existsSync(path.join(targetDir, dirName))
      ) || PRESERVE_FILES_ON_UPDATE.some(fileName =>
        fsSync.existsSync(path.join(targetDir, fileName))
      );

      if (hasPreserveItems) {
        // Preserve user data: remove all other files/dirs first
        const entries = await fs.readdir(targetDir, { withFileTypes: true });
        for (const entry of entries) {
          if (PRESERVE_DIRS_ON_UPDATE.includes(entry.name) ||
              PRESERVE_FILES_ON_UPDATE.includes(entry.name)) {
            continue;
          }
          await fs.rm(path.join(targetDir, entry.name), { recursive: true, force: true });
        }
      } else {
        await fs.rm(targetDir, { recursive: true, force: true });
      }
    }

    await copyDirSkipNodeModules(builtinSkillPath, targetDir, skipDirs);
    console.log(`[SkillService] Copied builtin skill to user-skills: ${skillName}`);
  }
}

/**
 * Initialize all builtin skills to user-skills directory
 * Only runs on first install or when app version changes
 */
export async function initializeBuiltinSkills(): Promise<void> {
  const currentVersion = getAppVersion();
  const extendedConfig = await readSkillExtendedConfig();
  const isVersionMatch = extendedConfig.builtinVersion === currentVersion;

  if (!fsSync.existsSync(SKILLS_DIR_ABSOLUTE)) {
    console.log('[SkillService] Builtin skills directory not found, skipping initialization');
    return;
  }

  try {
    const entries = await fs.readdir(SKILLS_DIR_ABSOLUTE, { withFileTypes: true });
    const prebuiltSkills: string[] = [];
    let copiedCount = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(SKILLS_DIR_ABSOLUTE, entry.name);
      const hasSkillMd = fsSync.existsSync(path.join(skillPath, 'SKILL.md'));

      // Only accept skills with SKILL.md
      if (!hasSkillMd) continue;

      const targetDir = path.join(USER_SKILLS_DIR_ABSOLUTE, entry.name);
      const targetExists = fsSync.existsSync(targetDir);

      // Copy if: target doesn't exist (new skill) OR version changed (update all)
      if (!targetExists || !isVersionMatch) {
        await ensureSkillInUserDir(skillPath, entry.name);
        copiedCount++;
      }

      // Detect pre-built skills (have .prebuild-manifest.json)
      const manifestPath = path.join(skillPath, '.prebuild-manifest.json');
      if (fsSync.existsSync(manifestPath)) {
        prebuiltSkills.push(entry.name);
      }
    }

    if (copiedCount > 0) {
      console.log(`[SkillService] Copied ${copiedCount} builtin skill(s) to user-skills`);
    } else if (isVersionMatch) {
      console.log(`[SkillService] Builtin skills up-to-date for version ${currentVersion}`);
    }

    // Register pre-built skills as deployed so they auto-start
    if (prebuiltSkills.length > 0) {
      await registerPrebuiltSkillsAsDeployed(prebuiltSkills);
    }

    // Update plugin.json with version marker
    await validateAndUpdatePluginJson(currentVersion);
  } catch (error) {
    console.error('[SkillService] Error initializing builtin skills:', error);
  }
}

/**
 * Register pre-built skills as deployed in plugin-ex.json.
 *
 * Pre-built skills ship with .next/ build artifacts already included.
 * This function reads the `.prebuild-manifest.json` from each skill and
 * registers it in `deployedSkills` so that `startAllDeployed()` will
 * automatically start them on the next server boot — no manual deploy needed.
 */
async function registerPrebuiltSkillsAsDeployed(skillNames: string[]): Promise<void> {
  const config = await readSkillExtendedConfig();
  const deployedSkills = config.deployedSkills ?? {};
  let changed = false;

  for (const skillName of skillNames) {
    // Skip if already registered (user may have manually deployed/stopped)
    if (deployedSkills[skillName]) {
      console.log(`[SkillService] Pre-built skill "${skillName}" already has deploy record, skipping`);
      continue;
    }

    // Read manifest from user-skills copy (where it was copied to)
    const manifestPath = path.join(USER_SKILLS_DIR_ABSOLUTE, skillName, '.prebuild-manifest.json');
    if (!fsSync.existsSync(manifestPath)) {
      console.warn(`[SkillService] Pre-built manifest not found for "${skillName}" in user-skills, skipping`);
      continue;
    }

    let manifest: { buildTimestamp?: string };
    try {
      manifest = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
    } catch {
      console.warn(`[SkillService] Failed to parse pre-built manifest for "${skillName}"`);
      continue;
    }

    // Register as deployed with port=0 (will be resolved at startup by startAllDeployed)
    deployedSkills[skillName] = {
      status: 'deployed',
      port: 0,
      buildTimestamp: manifest.buildTimestamp,
    };
    changed = true;
    console.log(`[SkillService] Registered pre-built skill "${skillName}" as deployed`);
  }

  if (changed) {
    config.deployedSkills = deployedSkills;
    await writeSkillExtendedConfig(config);
    console.log(`[SkillService] Updated plugin-ex.json with ${skillNames.length} pre-built skill(s)`);
  }
}


/**
 * Initialize skills on app startup
 * - Copy builtin skills to user directory (first time or version upgrade)
 * - Validate and update plugin.json
 * Uses global singleton to ensure only runs once per process
 */
export async function initializeSkillsOnStartup(): Promise<void> {
  // Skip during Next.js build phase
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  // Return cached promise if already initializing
  if (globalForSkills.skillsInitPromise) {
    return globalForSkills.skillsInitPromise;
  }

  // Skip if already initialized
  if (globalForSkills.skillsInitialized) {
    return;
  }

  // Start initialization
  globalForSkills.skillsInitPromise = (async () => {
    try {
      await initializeBuiltinSkills();
      // Always validate plugin.json on startup to fix any inconsistencies
      await validateAndUpdatePluginJson();

      // Rebuild API skill registry
      try {
        console.log('[SkillService] Rebuilding API skill registry...');
        const { rebuildRegistry } = await import('@/lib/services/api-skill-registry');
        const registry = await rebuildRegistry();
        console.log(`[SkillService] API skill registry rebuilt: ${registry.skills.length} skill(s) registered`);
      } catch (error) {
        console.warn('[SkillService] Failed to rebuild API skill registry:', error);
      }

      globalForSkills.skillsInitialized = true;
      console.log('[SkillService] Skills initialization completed');

      // Fire-and-forget: auto-start marked skills without blocking initialization
      // Not awaited intentionally — ensures startup is not delayed by skill launching
      autoStartMarkedSkills().catch(error => {
        console.error('[SkillService] Auto-start marked skills failed:', error);
      });
    } catch (error) {
      console.error('[SkillService] Skills initialization failed:', error);
    } finally {
      globalForSkills.skillsInitPromise = undefined;
    }
  })();

  return globalForSkills.skillsInitPromise;
}

/**
 * Ensure skills are initialized before use
 * Call this at the start of any exported function that needs skills
 */
async function ensureInitialized(): Promise<void> {
  if (!globalForSkills.skillsInitialized) {
    await initializeSkillsOnStartup();
  }
}

/**
 * Calculate directory size recursively
 */
async function getDirSize(dirPath: string): Promise<number> {
  let totalSize = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getDirSize(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        totalSize += stat.size;
      }
    }
  } catch {
    // Ignore errors
  }
  return totalSize;
}

/**
 * Template config interface (template.json)
 */
interface TemplateConfig {
  displayName?: string;
  description?: string;
  category?: string;
  tags?: string[];
  version?: string;
  author?: string;
  preview?: string;
  projectType?: 'nextjs' | 'python-fastapi';
  envVars?: EnvVarConfig[];
}

/**
 * Parsed skill/template data
 */
interface ParsedSkillData {
  displayName?: string;
  description: string;
  category?: string;
  tags?: string[];
  version?: string;
  author?: string;
  preview?: string;
  projectType?: 'nextjs' | 'python-fastapi';
  envVars?: EnvVarConfig[];
  hasSkill: boolean;
  hasApp: boolean;
}

/**
 * Parse template.json
 */
async function parseTemplateJson(skillPath: string): Promise<TemplateConfig | null> {
  const templateJsonPath = path.join(skillPath, 'template.json');
  try {
    if (!fsSync.existsSync(templateJsonPath)) {
      return null;
    }
    const content = await fs.readFile(templateJsonPath, 'utf-8');
    return JSON.parse(content) as TemplateConfig;
  } catch {
    return null;
  }
}

/**
 * Extract envVars from SKILL.md frontmatter data.
 * Supports two formats:
 * 1. Top-level: envVars: [{key, label, required, secret, ...}]
 * 2. Nested openclaw: metadata.openclaw.requires.env: ["KEY1", "KEY2"]
 */
function extractEnvVars(data: Record<string, unknown>): EnvVarConfig[] | undefined {
  // Format 1: top-level envVars array
  if (Array.isArray(data.envVars) && data.envVars.length > 0) {
    return data.envVars as EnvVarConfig[];
  }

  // Format 2: metadata.openclaw.requires.env (ClawHub format)
  const metadata = data.metadata as Record<string, unknown> | undefined;
  if (metadata && typeof metadata === 'object') {
    const nested = (metadata.openclaw ?? metadata.clawdbot ?? metadata.clawdis) as Record<string, unknown> | undefined;
    if (nested && typeof nested === 'object') {
      const requires = nested.requires as Record<string, unknown> | undefined;
      if (requires?.env && Array.isArray(requires.env) && requires.env.length > 0) {
        return (requires.env as string[]).map((key: string) => ({
          key,
          label: key,
          required: true,
          secret: true,
        }));
      }
    }
  }

  return undefined;
}

/**
 * Parse SKILL.md frontmatter
 */
async function parseSkillMd(skillPath: string): Promise<{
  name: string;
  displayName?: string;
  description: string;
  category?: string;
  tags?: string[];
  version?: string;
  author?: string;
  preview?: string;
  projectType?: 'nextjs' | 'python-fastapi';
  envVars?: EnvVarConfig[];
} | null> {
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  try {
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const { data } = matter(content);
    if (data.name && data.description) {
      return {
        name: String(data.name),
        displayName: data.displayName ? String(data.displayName) : undefined,
        description: String(data.description),
        category: data.category ? String(data.category) : undefined,
        tags: Array.isArray(data.tags) ? data.tags.map(String) : undefined,
        version: data.version ? String(data.version) : undefined,
        author: data.author ? String(data.author) : undefined,
        preview: data.preview ? String(data.preview) : undefined,
        projectType: data.projectType as 'nextjs' | 'python-fastapi' | undefined,
        envVars: extractEnvVars(data),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse skill directory - supports both template.json and SKILL.md
 * Priority: template.json > SKILL.md
 */
async function parseSkillDir(skillPath: string, dirName: string): Promise<ParsedSkillData | null> {
  const templateConfig = await parseTemplateJson(skillPath);
  const skillMdData = await parseSkillMd(skillPath);

  const hasSkill = skillMdData !== null;
  const hasApp = !!(templateConfig?.projectType || skillMdData?.projectType);

  // Need at least one config file
  if (!templateConfig && !skillMdData) {
    return null;
  }

  // Priority: template.json > SKILL.md
  if (templateConfig) {
    return {
      displayName: templateConfig.displayName,
      description: templateConfig.description || skillMdData?.description || dirName,
      category: templateConfig.category || skillMdData?.category,
      tags: templateConfig.tags || skillMdData?.tags,
      version: templateConfig.version || skillMdData?.version,
      author: templateConfig.author || skillMdData?.author,
      preview: templateConfig.preview || skillMdData?.preview,
      projectType: templateConfig.projectType || skillMdData?.projectType,
      envVars: templateConfig.envVars,
      hasSkill,
      hasApp,
    };
  }

  // Fallback to SKILL.md only
  return {
    displayName: skillMdData!.displayName,
    description: skillMdData!.description,
    category: skillMdData!.category,
    tags: skillMdData!.tags,
    version: skillMdData!.version,
    author: skillMdData!.author,
    preview: skillMdData!.preview,
    projectType: skillMdData!.projectType,
    envVars: skillMdData!.envVars,
    hasSkill,
    hasApp,
  };
}

/**
 * Scan skills from a directory
 */
async function scanSkillsFromDir(
  dirPath: string,
  source: 'builtin' | 'user'
): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = [];

  try {
    if (!fsSync.existsSync(dirPath)) {
      return skills;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Skip irrelevant directories
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;

      const skillPath = path.join(dirPath, entry.name);
      const parsed = await parseSkillDir(skillPath, entry.name);

      if (parsed) {
        // Skip size calculation for performance (can be slow with node_modules)
        const size = 0;
        skills.push({
          name: entry.name,
          displayName: parsed.displayName,
          description: parsed.description,
          path: skillPath,
          source,
          size,
          category: parsed.category,
          tags: parsed.tags,
          version: parsed.version,
          author: parsed.author,
          preview: parsed.preview,
          projectType: parsed.projectType,
          envVars: parsed.envVars,
          hasSkill: parsed.hasSkill,
          hasApp: parsed.hasApp,
        });
      }
    }
  } catch (error) {
    console.error(`[SkillService] Error scanning skills from ${dirPath}:`, error);
  }

  return skills;
}

/**
 * Get all skills (builtin + user)
 * User skills override builtin skills with same name
 */
export async function getAllSkills(): Promise<SkillMeta[]> {
  await ensureInitialized();

  // Scan builtin skills
  const builtinSkills = await scanSkillsFromDir(SKILLS_DIR_ABSOLUTE, 'builtin');

  // Scan user skills
  const userSkills = await scanSkillsFromDir(USER_SKILLS_DIR_ABSOLUTE, 'user');

  // Merge: user skills override builtin with same name
  const skillMap = new Map<string, SkillMeta>();
  for (const skill of builtinSkills) {
    skillMap.set(skill.name, skill);
  }
  for (const skill of userSkills) {
    skillMap.set(skill.name, skill);
  }

  // Populate deploy status from plugin-ex.json
  const extendedConfig = await readSkillExtendedConfig();
  const deployedSkills = extendedConfig.deployedSkills ?? {};

  const skills = Array.from(skillMap.values());
  for (const skill of skills) {
    const deployMeta = deployedSkills[skill.name];
    if (deployMeta) {
      skill.deployStatus = deployMeta.status;
      skill.deployPort = deployMeta.port;
    }
  }

  return skills;
}

/**
 * Import skill from folder or ZIP
 * Supports both SKILL.md (pure skill) and template.json (app template)
 */
export async function importSkill(sourcePath: string): Promise<SkillMeta> {
  const stat = await fs.stat(sourcePath);
  let skillDir: string;

  if (stat.isDirectory()) {
    // Import from folder - check for SKILL.md or template.json
    if (!isValidSkillDir(sourcePath)) {
      throw new Error('Invalid skill: SKILL.md or template.json not found');
    }

    // Use directory name as skill name
    const dirName = path.basename(sourcePath);
    const targetDir = path.join(USER_SKILLS_DIR_ABSOLUTE, dirName);
    await copyDir(sourcePath, targetDir);
    skillDir = targetDir;
  } else if (sourcePath.endsWith('.zip')) {
    // Import from ZIP
    const zip = new AdmZip(sourcePath);
    const tempDir = path.join(USER_SKILLS_DIR_ABSOLUTE, `_temp_${Date.now()}`);
    zip.extractAllTo(tempDir, true);

    // Find valid skill directory (has SKILL.md or template.json)
    const skillPath = await findValidSkillDir(tempDir);
    if (!skillPath) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw new Error('Invalid ZIP: SKILL.md or template.json not found');
    }

    // Use directory name as skill name
    const dirName = path.basename(skillPath);
    const targetDir = path.join(USER_SKILLS_DIR_ABSOLUTE, dirName);
    if (fsSync.existsSync(targetDir)) {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
    await fs.rename(skillPath, targetDir);

    // Cleanup temp
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    skillDir = targetDir;
  } else {
    throw new Error('Unsupported file type. Please provide a folder or ZIP file.');
  }

  // Return the imported skill meta
  const dirName = path.basename(skillDir);
  const parsedDir = await parseSkillDir(skillDir, dirName);
  if (!parsedDir) {
    throw new Error('Failed to parse imported skill');
  }

  const size = await getDirSize(skillDir);

  // Check if skill has required env vars - if yes, disable by default
  const hasRequiredEnvVars = parsedDir.envVars?.some(v => v.required) || false;

  // Update plugin.json to include the new skill (only if hasSkill)
  // If hasRequiredEnvVars, it will be disabled by default
  if (hasRequiredEnvVars && parsedDir.hasSkill) {
    const extendedConfig = await readSkillExtendedConfig();
    const disabledSkills = extendedConfig.disabledSkills || [];
    if (!disabledSkills.includes(dirName)) {
      disabledSkills.push(dirName);
      extendedConfig.disabledSkills = disabledSkills;
      await writeSkillExtendedConfig(extendedConfig);
    }
  }

  await validateAndUpdatePluginJson();

  // Register as API skill if api-endpoints.json exists
  try {
    const { registerSkill: regSkill } = await import('@/lib/services/api-skill-registry');
    await regSkill(dirName);
  } catch (error) {
    console.warn(`[SkillService] Failed to register API skill ${dirName}:`, error);
  }

  return {
    name: dirName,
    displayName: parsedDir.displayName,
    description: parsedDir.description,
    path: skillDir,
    source: 'user',
    size,
    category: parsedDir.category,
    tags: parsedDir.tags,
    version: parsedDir.version,
    author: parsedDir.author,
    preview: parsedDir.preview,
    projectType: parsedDir.projectType,
    hasSkill: parsedDir.hasSkill,
    hasApp: parsedDir.hasApp,
  };
}

/**
 * Check if directory is a valid skill (has SKILL.md or template.json)
 */
function isValidSkillDir(dirPath: string): boolean {
  const hasSkillMd = fsSync.existsSync(path.join(dirPath, 'SKILL.md'));
  const hasTemplateJson = fsSync.existsSync(path.join(dirPath, 'template.json'));
  return hasSkillMd || hasTemplateJson;
}

/**
 * Find directory containing SKILL.md or template.json (handles nested structures)
 */
async function findValidSkillDir(baseDir: string): Promise<string | null> {
  // Check if valid skill exists in base dir
  if (isValidSkillDir(baseDir)) {
    return baseDir;
  }

  // Check immediate subdirectories
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(baseDir, entry.name);
        if (isValidSkillDir(subDir)) {
          return subDir;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return null;
}

/**
 * Copy directory recursively
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Delete a user skill (builtin skills cannot be deleted)
 */
export async function deleteSkill(skillName: string): Promise<void> {
  const skills = await getAllSkills();
  const skill = skills.find(s => s.name === skillName);

  if (!skill) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  if (skill.source === 'builtin') {
    throw new Error('Cannot delete builtin skills');
  }

  // Unregister from API skill registry before deletion
  try {
    const { unregisterSkill: unregSkill } = await import('@/lib/services/api-skill-registry');
    await unregSkill(skillName);
  } catch (error) {
    console.warn(`[SkillService] Failed to unregister API skill ${skillName}:`, error);
  }

  await fs.rm(skill.path, { recursive: true, force: true });

  // Update plugin.json to remove the deleted skill
  await validateAndUpdatePluginJson();
}

/**
 * Get skill paths for SDK plugins configuration
 * Reads from plugin.json (managed by validateAndUpdatePluginJson)
 */
export async function getEnabledSkillPaths(): Promise<string[]> {
  await ensureInitialized();

  // Read from plugin.json instead of regenerating every time
  const config = await readPluginConfig();
  if (!config || config.skills.length === 0) {
    return [];
  }

  // Return user-skills directory (parent of .claude-plugin)
  return [USER_SKILLS_DIR_ABSOLUTE];
}

/**
 * Get skill detail (read SKILL.md content)
 */
export async function getSkillDetail(skillName: string): Promise<{ meta: SkillMeta; content: string } | null> {
  const skills = await getAllSkills();
  const skill = skills.find(s => s.name === skillName);

  if (!skill) {
    return null;
  }

  try {
    const skillMdPath = path.join(skill.path, 'SKILL.md');
    const content = await fs.readFile(skillMdPath, 'utf-8');
    return { meta: skill, content };
  } catch {
    return null;
  }
}

/**
 * Toggle skill enabled/disabled status
 */
export async function toggleSkill(skillName: string, enabled: boolean): Promise<void> {
  const config = await readPluginConfig();
  if (!config) {
    throw new Error('Plugin config not found');
  }

  const extendedConfig = await readSkillExtendedConfig();
  const disabledSkills = extendedConfig.disabledSkills || [];
  const skillPath = `./${skillName}`;

  if (enabled) {
    // Enable: remove from disabled list, add to skills array
    const newDisabled = disabledSkills.filter(name => name !== skillName);
    if (!config.skills.includes(skillPath)) {
      config.skills.push(skillPath);
    }
    extendedConfig.disabledSkills = newDisabled.length > 0 ? newDisabled : undefined;
  } else {
    // Disable: add to disabled list, remove from skills array
    if (!disabledSkills.includes(skillName)) {
      disabledSkills.push(skillName);
    }
    config.skills = config.skills.filter(p => p !== skillPath);
    extendedConfig.disabledSkills = disabledSkills;
  }

  await writePluginConfig(config);
  await writeSkillExtendedConfig(extendedConfig);
  console.log(`[SkillService] Skill ${skillName} ${enabled ? 'enabled' : 'disabled'}`);

  // Update API skill registry
  try {
    if (enabled) {
      const { registerSkill } = await import('@/lib/services/api-skill-registry');
      await registerSkill(skillName);
    } else {
      const { unregisterSkill } = await import('@/lib/services/api-skill-registry');
      await unregisterSkill(skillName);
    }
  } catch (error) {
    console.warn(`[SkillService] Failed to update API skill registry for ${skillName}:`, error);
  }
}

/**
 * Check if a skill is set to auto-start
 * Reads plugin-ex.json and checks if the skill is in the autoStartSkills list
 */
export async function isSkillAutoStart(skillName: string): Promise<boolean> {
  const extendedConfig = await readSkillExtendedConfig();
  const autoStartSkills = extendedConfig.autoStartSkills || [];
  return autoStartSkills.includes(skillName);
}

/**
 * Set skill auto-start status
 * Only allows hasApp=true skills to be set for auto-start
 */
export async function setSkillAutoStart(skillName: string, enabled: boolean): Promise<void> {
  const skills = await getAllSkills();
  const skill = skills.find(s => s.name === skillName);

  if (!skill) {
    throw new Error('Skill not found');
  }

  if (!skill.hasApp) {
    throw new Error('Skill does not support app mode');
  }

  const extendedConfig = await readSkillExtendedConfig();
  const autoStartSkills = extendedConfig.autoStartSkills || [];

  if (enabled) {
    // Add to autoStartSkills (avoid duplicates)
    if (!autoStartSkills.includes(skillName)) {
      autoStartSkills.push(skillName);
    }
  } else {
    // Remove from autoStartSkills
    const index = autoStartSkills.indexOf(skillName);
    if (index !== -1) {
      autoStartSkills.splice(index, 1);
    }
  }

  extendedConfig.autoStartSkills = autoStartSkills.length > 0 ? autoStartSkills : undefined;
  await writeSkillExtendedConfig(extendedConfig);
  console.log(`[SkillService] Skill ${skillName} auto-start ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Get all auto-start skill names
 * Returns the autoStartSkills list from extended config (or empty array if undefined)
 */
export async function getAutoStartSkills(): Promise<string[]> {
  const extendedConfig = await readSkillExtendedConfig();
  return extendedConfig.autoStartSkills || [];
}

/**
 * Auto-start all skills marked for auto-start.
 * Only starts previously deployed skills in production mode via DeployManager.
 * Preview-mode auto-start is no longer supported — use deploy instead.
 * Exported for testing purposes.
 */
export async function autoStartMarkedSkills(): Promise<void> {
  // Start all previously deployed skills in production mode
  try {
    const { deployManager } = await import('@/lib/services/deploy-manager');
    await deployManager.startAllDeployed();
  } catch (error) {
    console.error('[SkillService] Failed to start deployed skills:', error);
  }
}

/**
 * Check if a skill is enabled
 */
export async function isSkillEnabled(skillName: string): Promise<boolean> {
  const extendedConfig = await readSkillExtendedConfig();
  const disabledSkills = extendedConfig.disabledSkills || [];
  return !disabledSkills.includes(skillName);
}

/**
 * Get all skills with enabled status
 */
export async function getAllSkillsWithStatus(): Promise<(SkillMeta & { enabled: boolean })[]> {
  const skills = await getAllSkills();
  const extendedConfig = await readSkillExtendedConfig();
  const disabledSkills = extendedConfig.disabledSkills || [];

  return skills.map(skill => ({
    ...skill,
    enabled: !disabledSkills.includes(skill.name),
  }));
}

/**
 * Run a skill as a project (create/update project record and return projectId)
 * Only works for skills with hasApp=true
 */
export async function runSkill(skillName: string): Promise<{ projectId: string }> {
  const skills = await getAllSkills();
  const skill = skills.find(s => s.name === skillName);

  if (!skill) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  if (!skill.hasApp) {
    throw new Error(`Skill "${skillName}" does not support app mode (no projectType)`);
  }

  // Import db lazily to avoid circular dependency
  const { db } = await import('@/lib/db/client');
  const { projects } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');

  const projectId = `skill-${skillName}`;
  const now = new Date().toISOString();

  // Check if project already exists
  const existing = await db.select().from(projects).where(eq(projects.id, projectId)).get();

  if (existing) {
    // Update timestamps
    await db.update(projects)
      .set({ updatedAt: now, lastActiveAt: now })
      .where(eq(projects.id, projectId));
  } else {
    // Create new project record
    await db.insert(projects).values({
      id: projectId,
      name: skill.displayName || skill.name,
      description: skill.description,
      status: 'idle',
      mode: 'code',
      repoPath: skill.path,
      projectType: skill.projectType || 'python-fastapi',
      planConfirmed: true,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
    });
  }

  return { projectId };
}

/**
 * Generate a short project ID (8 chars, same as frontend)
 */
function generateProjectId(): string {
  return `p-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Fork a skill to create a new project for customization
 * Copies skill files to projects directory and creates a new project record
 */
export async function forkSkill(skillName: string): Promise<{ projectId: string }> {
  const skills = await getAllSkills();
  const skill = skills.find(s => s.name === skillName);

  if (!skill) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  // Import db lazily to avoid circular dependency
  const { db } = await import('@/lib/db/client');
  const { projects } = await import('@/lib/db/schema');
  const { PROJECTS_DIR_ABSOLUTE } = await import('@/lib/config/paths');

  const projectId = generateProjectId();
  const now = new Date().toISOString();
  const targetPath = path.join(PROJECTS_DIR_ABSOLUTE, projectId);

  // Check if should extract from project.zip
  const projectZipPath = path.join(skill.path, 'project.zip');
  if (fsSync.existsSync(projectZipPath)) {
    // Extract ZIP mode
    console.log(`[SkillService] Forking ${skillName} by extracting project.zip`);

    await fs.mkdir(targetPath, { recursive: true });
    await extractProjectZip(projectZipPath, targetPath);

    // Copy additional non-ZIP files (skip template.json, mock.json which are not needed in forked project)
    const entries = await fs.readdir(skill.path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'project.zip' || entry.name === 'project' ||
          entry.name === 'template.json' || entry.name === 'mock.json' ||
          entry.name === 'SKILL.md') {
        continue; // Skip these files
      }

      const srcPath = path.join(skill.path, entry.name);
      const destPath = path.join(targetPath, entry.name);

      if (entry.isDirectory()) {
        await copyDirSkipVenv(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }

    console.log(`[SkillService] Forked ${skillName} to ${projectId} (from ZIP)`);
  } else {
    // Normal copy mode (skip .venv and node_modules)
    await copyDirSkipVenv(skill.path, targetPath);
    console.log(`[SkillService] Forked ${skillName} to ${projectId} (from directory)`);
  }

  // Create project record
  await db.insert(projects).values({
    id: projectId,
    name: `${skill.displayName || skill.name} (Fork)`,
    description: skill.description,
    status: 'idle',
    mode: 'code',
    repoPath: targetPath,
    projectType: skill.projectType || 'python-fastapi',
    planConfirmed: true,
    fromTemplate: `skill:${skillName}`,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
  });

  return { projectId };
}

/**
 * Copy directory recursively, skip .venv and node_modules
 */
async function copyDirSkipVenv(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip .venv, node_modules directories, and project.zip
    if (entry.name === '.venv' || entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === 'project.zip') {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirSkipVenv(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// ========== Directories/files to skip when merging back ==========
const MERGE_SKIP_DIRS = new Set([
  '.venv', 'node_modules', '__pycache__', '.next', '.git',
  'data', 'downloads', '.hypothesis', '.pytest_cache',
]);
const MERGE_SKIP_FILES = new Set([
  '.env', '.env.local',
  'python_dev.db', 'sub_dev.db', 'prod.db',
]);

/**
 * Merge a forked project back to its source skill.
 * Copies code files only, skipping data/runtime/env files to avoid overwriting user data.
 */
export async function mergeBackToSkill(projectId: string): Promise<{ skillName: string; filesCopied: number; filesSkipped: number }> {
  const { db } = await import('@/lib/db/client');
  const { projects } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');

  // 1. Get project record
  const result = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const project = result[0];
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // 2. Check fromTemplate field
  const fromTemplate = (project as any).fromTemplate as string | null;
  if (!fromTemplate || !fromTemplate.startsWith('skill:')) {
    throw new Error('该项目不是从技能二开的，无法合并回主技能');
  }

  const skillName = fromTemplate.replace('skill:', '');

  // Determine merge targets: user-skills (always writable) + builtin (best-effort)
  const userSkillPath = path.join(USER_SKILLS_DIR_ABSOLUTE, skillName);
  const builtinSkillPath = path.join(SKILLS_DIR_ABSOLUTE, skillName);

  // At least one target must exist
  const userExists = fsSync.existsSync(userSkillPath);
  const builtinExists = fsSync.existsSync(builtinSkillPath);
  if (!userExists && !builtinExists) {
    throw new Error(`源技能不存在: ${skillName}`);
  }

  const projectPath = project.repoPath;
  if (!projectPath || !fsSync.existsSync(projectPath)) {
    throw new Error(`项目目录不存在: ${projectPath}`);
  }

  // 3. Copy files from project back to skill locations, skipping data
  let filesCopied = 0;
  let filesSkipped = 0;

  async function mergeDir(srcDir: string, destDir: string): Promise<void> {
    await fs.mkdir(destDir, { recursive: true });
    const entries = await fs.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip data/runtime directories
      if (MERGE_SKIP_DIRS.has(entry.name)) {
        filesSkipped++;
        continue;
      }

      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        await mergeDir(srcPath, destPath);
      } else {
        // Skip data/env files
        if (MERGE_SKIP_FILES.has(entry.name)) {
          filesSkipped++;
          continue;
        }
        // Skip database files
        if (entry.name.endsWith('.db') || entry.name.endsWith('.db-shm') || entry.name.endsWith('.db-wal') || entry.name.endsWith('.db-journal')) {
          filesSkipped++;
          continue;
        }

        await fs.copyFile(srcPath, destPath);
        filesCopied++;
      }
    }
  }

  // Always merge to user-skills (writable in both dev and production)
  await mergeDir(projectPath, userSkillPath);
  console.log(`[SkillService] Merged project ${projectId} to user-skills/${skillName}: ${filesCopied} files copied, ${filesSkipped} skipped`);

  // Best-effort merge to builtin skills (may be read-only in production/Electron)
  if (builtinExists && builtinSkillPath !== userSkillPath) {
    try {
      let builtinCopied = 0;
      const builtinFilesSkipped = 0;
      async function mergeDirBuiltin(srcDir: string, destDir: string): Promise<void> {
        await fs.mkdir(destDir, { recursive: true });
        const entries = await fs.readdir(srcDir, { withFileTypes: true });
        for (const entry of entries) {
          if (MERGE_SKIP_DIRS.has(entry.name)) continue;
          const srcPath = path.join(srcDir, entry.name);
          const destPath = path.join(destDir, entry.name);
          if (entry.isDirectory()) {
            await mergeDirBuiltin(srcPath, destPath);
          } else {
            if (MERGE_SKIP_FILES.has(entry.name)) continue;
            if (entry.name.endsWith('.db') || entry.name.endsWith('.db-shm') || entry.name.endsWith('.db-wal') || entry.name.endsWith('.db-journal')) continue;
            await fs.copyFile(srcPath, destPath);
            builtinCopied++;
          }
        }
      }
      await mergeDirBuiltin(projectPath, builtinSkillPath);
      console.log(`[SkillService] Also merged to builtin skills/${skillName}: ${builtinCopied} files`);
    } catch (err) {
      // Builtin directory may be read-only in packaged Electron app — that's OK
      console.warn(`[SkillService] Could not merge to builtin skills (read-only?): ${(err as Error).message}`);
    }
  }

  return { skillName, filesCopied, filesSkipped };
}

/**
 * Get skill path by name
 */
export function getSkillPathByName(skillName: string): string | null {
  // Priority: user-skills > builtin skills
  const userSkillPath = path.join(USER_SKILLS_DIR_ABSOLUTE, skillName);
  if (fsSync.existsSync(userSkillPath)) {
    return userSkillPath;
  }

  const builtinSkillPath = path.join(SKILLS_DIR_ABSOLUTE, skillName);
  if (fsSync.existsSync(builtinSkillPath)) {
    return builtinSkillPath;
  }

  return null;
}

/**
 * Read skill .env file
 */
export async function getSkillEnvVars(skillName: string): Promise<Record<string, string>> {
  const skillPath = getSkillPathByName(skillName);
  if (!skillPath) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  const envPath = path.join(skillPath, '.env');
  const result: Record<string, string> = {};

  try {
    if (!fsSync.existsSync(envPath)) {
      return result;
    }
    const content = await fs.readFile(envPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        result[key] = value;
      }
    }
  } catch (error) {
    console.error(`[SkillService] Error reading .env for ${skillName}:`, error);
  }

  return result;
}

/**
 * Save skill .env file
 */
export async function saveSkillEnvVars(skillName: string, vars: Record<string, string>): Promise<void> {
  const skillPath = getSkillPathByName(skillName);
  if (!skillPath) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  const envPath = path.join(skillPath, '.env');

  // Build .env content
  const lines: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (key && value !== undefined) {
      // Quote value if it contains special characters
      const needsQuotes = value.includes(' ') || value.includes('#') || value.includes('=');
      const quotedValue = needsQuotes ? `"${value}"` : value;
      lines.push(`${key}=${quotedValue}`);
    }
  }

  await fs.writeFile(envPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`[SkillService] Saved .env for ${skillName}`);
}

/**
 * File tree node interface
 */
export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

/**
 * Get skill file tree
 */
export async function getSkillFileTree(skillName: string): Promise<FileTreeNode> {
  const skillPath = getSkillPathByName(skillName);
  if (!skillPath) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  async function buildTree(dirPath: string, dirName: string): Promise<FileTreeNode> {
    const node: FileTreeNode = {
      name: dirName,
      type: 'directory',
      children: [],
    };

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    // Sort: directories first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      // Skip hidden files/dirs and large directories
      if (entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === '__pycache__' ||
          entry.name === '.venv') {
        continue;
      }

      const entryPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const child = await buildTree(entryPath, entry.name);
        node.children!.push(child);
      } else {
        node.children!.push({
          name: entry.name,
          type: 'file',
        });
      }
    }

    return node;
  }

  return buildTree(skillPath, skillName);
}

/**
 * Get skill SKILL.md content
 */
export async function getSkillMdContent(skillName: string): Promise<string | null> {
  const skillPath = getSkillPathByName(skillName);
  if (!skillPath) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  const skillMdPath = path.join(skillPath, 'SKILL.md');
  try {
    if (!fsSync.existsSync(skillMdPath)) {
      return null;
    }
    return await fs.readFile(skillMdPath, 'utf-8');
  } catch {
    return null;
  }
}


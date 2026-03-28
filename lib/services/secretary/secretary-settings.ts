/**
 * Secretary Settings - Persistent settings for the Secretary system
 * 
 * Stores secretary-specific settings like enabledSkills to:
 * - data/secretary-settings.json
 * 
 * Modeled after LAN group skill management pattern.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

// ========== Types ==========

export interface SecretarySettings {
  enabledSkills: string[];
  // Future extensibility: additional settings can be added here
}

// ========== Paths ==========

const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'secretary-settings.json');

// ========== Default Values ==========

const DEFAULT_SETTINGS: SecretarySettings = {
  enabledSkills: [],
};

// ========== Helper Functions ==========

/**
 * Ensure data directory exists
 */
async function ensureDataDir(): Promise<void> {
  if (!fsSync.existsSync(DATA_DIR)) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

// ========== Main Functions ==========

/**
 * Get secretary settings from persistent storage
 * Returns default settings if file doesn't exist
 */
export async function getSecretarySettings(): Promise<SecretarySettings> {
  try {
    if (!fsSync.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS };
    }
    
    const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    
    // Merge with defaults to handle missing fields
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      enabledSkills: Array.isArray(parsed.enabledSkills) ? parsed.enabledSkills : [],
    };
  } catch (error) {
    console.warn('[SecretarySettings] Failed to load settings, using defaults:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Update secretary settings (partial update)
 * Merges the provided partial with existing settings
 */
export async function updateSecretarySettings(
  partial: Partial<SecretarySettings>
): Promise<SecretarySettings> {
  await ensureDataDir();
  
  const current = await getSecretarySettings();
  const updated: SecretarySettings = {
    ...current,
    ...partial,
  };
  
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  console.log('[SecretarySettings] Settings updated:', Object.keys(partial).join(', '));
  
  return updated;
}

/**
 * Get the list of enabled skills for the secretary
 */
export async function getSecretaryEnabledSkills(): Promise<string[]> {
  const settings = await getSecretarySettings();
  return settings.enabledSkills;
}

/**
 * Set the list of enabled skills for the secretary
 */
export async function setSecretaryEnabledSkills(skills: string[]): Promise<void> {
  await updateSecretarySettings({ enabledSkills: skills });
  console.log(`[SecretarySettings] Enabled skills updated: ${skills.length} skill(s)`);
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

/**
 * Unit tests for isSkillAutoStart and setSkillAutoStart functions.
 * Validates: Requirements 1.1, 1.2, 1.3, 4.1
 *
 * Tests cover:
 * - isSkillAutoStart: Returning true/false based on autoStartSkills list
 * - setSkillAutoStart: Enabling/disabling auto-start for App skills
 * - setSkillAutoStart: Rejecting non-App skills and non-existent skills
 * - setSkillAutoStart: Avoiding duplicates and handling edge cases
 */

// Use a temp directory for test isolation
const TEST_USER_SKILLS_DIR = path.join(process.cwd(), 'data', '__test-skill-auto-start__');
const TEST_BUILTIN_SKILLS_DIR = path.join(process.cwd(), 'data', '__test-skill-auto-start-builtin__');
const PLUGIN_EX_PATH = path.join(TEST_USER_SKILLS_DIR, '.claude-plugin', 'plugin-ex.json');

// Mock the paths module to use our test directory
vi.mock('@/lib/config/paths', () => ({
  SKILLS_DIR_ABSOLUTE: path.join(process.cwd(), 'data', '__test-skill-auto-start-builtin__'),
  USER_SKILLS_DIR_ABSOLUTE: path.join(process.cwd(), 'data', '__test-skill-auto-start__'),
}));

describe('isSkillAutoStart', () => {
  beforeEach(async () => {
    // Ensure test directory exists
    await fs.mkdir(path.dirname(PLUGIN_EX_PATH), { recursive: true });
  });

  afterEach(async () => {
    vi.resetModules();
    // Clean up test directory
    try {
      await fs.rm(TEST_USER_SKILLS_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('should return true when skill is in autoStartSkills list', async () => {
    const config = {
      autoStartSkills: ['portal-integration', 'another-skill'],
    };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { isSkillAutoStart } = await import('../skill-service');
    const result = await isSkillAutoStart('portal-integration');

    expect(result).toBe(true);
  });

  it('should return false when skill is not in autoStartSkills list', async () => {
    const config = {
      autoStartSkills: ['portal-integration'],
    };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { isSkillAutoStart } = await import('../skill-service');
    const result = await isSkillAutoStart('non-existent-skill');

    expect(result).toBe(false);
  });

  it('should return false when autoStartSkills is empty', async () => {
    const config = {
      autoStartSkills: [],
    };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { isSkillAutoStart } = await import('../skill-service');
    const result = await isSkillAutoStart('any-skill');

    expect(result).toBe(false);
  });

  it('should return false when autoStartSkills is undefined', async () => {
    const config = {
      disabledSkills: ['some-skill'],
    };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { isSkillAutoStart } = await import('../skill-service');
    const result = await isSkillAutoStart('any-skill');

    expect(result).toBe(false);
  });

  it('should return false when plugin-ex.json does not exist', async () => {
    // Ensure the file does not exist
    try {
      await fs.unlink(PLUGIN_EX_PATH);
    } catch {
      // ignore if already doesn't exist
    }

    const { isSkillAutoStart } = await import('../skill-service');
    const result = await isSkillAutoStart('any-skill');

    expect(result).toBe(false);
  });
});

/**
 * Helper to create a mock skill directory with SKILL.md and optional template.json
 */
async function createMockSkill(skillName: string, options: { hasApp: boolean }) {
  const skillDir = path.join(TEST_USER_SKILLS_DIR, skillName);
  await fs.mkdir(skillDir, { recursive: true });

  // Create SKILL.md (required for skill to be recognized)
  const skillMdContent = `---
name: ${skillName}
description: Test skill ${skillName}
${options.hasApp ? 'projectType: python-fastapi' : ''}
---
# ${skillName}
`;
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');

  // Create template.json if hasApp
  if (options.hasApp) {
    const templateConfig = {
      description: `Test skill ${skillName}`,
      projectType: 'python-fastapi',
    };
    await fs.writeFile(path.join(skillDir, 'template.json'), JSON.stringify(templateConfig, null, 2), 'utf-8');
  }
}

describe('setSkillAutoStart', () => {
  beforeEach(async () => {
    // Ensure test directories exist
    await fs.mkdir(path.dirname(PLUGIN_EX_PATH), { recursive: true });
    await fs.mkdir(TEST_BUILTIN_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    vi.resetModules();
    // Clean up test directories
    try {
      await fs.rm(TEST_USER_SKILLS_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      await fs.rm(TEST_BUILTIN_SKILLS_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('should enable auto-start for an App skill', async () => {
    // Create a mock App skill
    await createMockSkill('test-app-skill', { hasApp: true });
    // Write initial config with no autoStartSkills
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify({}, null, 2), 'utf-8');

    const { setSkillAutoStart, isSkillAutoStart } = await import('../skill-service');
    await setSkillAutoStart('test-app-skill', true);

    const result = await isSkillAutoStart('test-app-skill');
    expect(result).toBe(true);
  });

  it('should disable auto-start for an App skill', async () => {
    // Create a mock App skill
    await createMockSkill('test-app-skill', { hasApp: true });
    // Write initial config with the skill in autoStartSkills
    const config = { autoStartSkills: ['test-app-skill'] };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { setSkillAutoStart, isSkillAutoStart } = await import('../skill-service');
    await setSkillAutoStart('test-app-skill', false);

    const result = await isSkillAutoStart('test-app-skill');
    expect(result).toBe(false);
  });

  it('should throw error for non-existent skill', async () => {
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify({}, null, 2), 'utf-8');

    const { setSkillAutoStart } = await import('../skill-service');
    await expect(setSkillAutoStart('non-existent-skill', true)).rejects.toThrow('Skill not found');
  });

  it('should throw error for non-App skill (hasApp=false)', async () => {
    // Create a mock non-App skill (no projectType)
    await createMockSkill('pure-skill', { hasApp: false });
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify({}, null, 2), 'utf-8');

    const { setSkillAutoStart } = await import('../skill-service');
    await expect(setSkillAutoStart('pure-skill', true)).rejects.toThrow('Skill does not support app mode');
  });

  it('should not add duplicate entries when enabling twice', async () => {
    await createMockSkill('test-app-skill', { hasApp: true });
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify({}, null, 2), 'utf-8');

    const { setSkillAutoStart } = await import('../skill-service');
    await setSkillAutoStart('test-app-skill', true);
    await setSkillAutoStart('test-app-skill', true);

    // Read config directly to verify no duplicates
    const content = await fs.readFile(PLUGIN_EX_PATH, 'utf-8');
    const config = JSON.parse(content);
    const count = (config.autoStartSkills || []).filter((s: string) => s === 'test-app-skill').length;
    expect(count).toBe(1);
  });

  it('should handle disabling a skill that is not in the list', async () => {
    await createMockSkill('test-app-skill', { hasApp: true });
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify({}, null, 2), 'utf-8');

    const { setSkillAutoStart, isSkillAutoStart } = await import('../skill-service');
    // Should not throw when disabling a skill not in the list
    await setSkillAutoStart('test-app-skill', false);

    const result = await isSkillAutoStart('test-app-skill');
    expect(result).toBe(false);
  });

  it('should preserve other skills in autoStartSkills when adding', async () => {
    await createMockSkill('skill-a', { hasApp: true });
    await createMockSkill('skill-b', { hasApp: true });
    const config = { autoStartSkills: ['skill-a'] };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { setSkillAutoStart, isSkillAutoStart } = await import('../skill-service');
    await setSkillAutoStart('skill-b', true);

    expect(await isSkillAutoStart('skill-a')).toBe(true);
    expect(await isSkillAutoStart('skill-b')).toBe(true);
  });

  it('should preserve other skills in autoStartSkills when removing', async () => {
    await createMockSkill('skill-a', { hasApp: true });
    await createMockSkill('skill-b', { hasApp: true });
    const config = { autoStartSkills: ['skill-a', 'skill-b'] };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { setSkillAutoStart, isSkillAutoStart } = await import('../skill-service');
    await setSkillAutoStart('skill-b', false);

    expect(await isSkillAutoStart('skill-a')).toBe(true);
    expect(await isSkillAutoStart('skill-b')).toBe(false);
  });
});


describe('getAutoStartSkills', () => {
  beforeEach(async () => {
    // Ensure test directory exists
    await fs.mkdir(path.dirname(PLUGIN_EX_PATH), { recursive: true });
  });

  afterEach(async () => {
    vi.resetModules();
    // Clean up test directory
    try {
      await fs.rm(TEST_USER_SKILLS_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('should return the autoStartSkills list when it exists', async () => {
    const config = {
      autoStartSkills: ['portal-integration', 'another-skill'],
    };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { getAutoStartSkills } = await import('../skill-service');
    const result = await getAutoStartSkills();

    expect(result).toEqual(['portal-integration', 'another-skill']);
  });

  it('should return an empty array when autoStartSkills is undefined', async () => {
    const config = {
      disabledSkills: ['some-skill'],
    };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { getAutoStartSkills } = await import('../skill-service');
    const result = await getAutoStartSkills();

    expect(result).toEqual([]);
  });

  it('should return an empty array when plugin-ex.json does not exist', async () => {
    // Ensure the file does not exist
    try {
      await fs.unlink(PLUGIN_EX_PATH);
    } catch {
      // ignore if already doesn't exist
    }

    const { getAutoStartSkills } = await import('../skill-service');
    const result = await getAutoStartSkills();

    expect(result).toEqual([]);
  });

  it('should return an empty array when autoStartSkills is empty', async () => {
    const config = {
      autoStartSkills: [],
    };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { getAutoStartSkills } = await import('../skill-service');
    const result = await getAutoStartSkills();

    expect(result).toEqual([]);
  });

  it('should return a single skill when only one is configured', async () => {
    const config = {
      autoStartSkills: ['portal-integration'],
    };
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify(config, null, 2), 'utf-8');

    const { getAutoStartSkills } = await import('../skill-service');
    const result = await getAutoStartSkills();

    expect(result).toEqual(['portal-integration']);
  });
});

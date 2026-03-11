/**
 * Property-based tests for skill auto-start round-trip consistency.
 *
 * **Feature: skill-auto-start, Property 1: 自动启动设置的往返一致性**
 * **Validates: Requirements 1.1, 1.2**
 *
 * For any App skill name, enabling auto-start then reading the status should return `true`,
 * disabling auto-start then reading the status should return `false`, and after disabling
 * the config should be restored to the state before enabling (skill name not in autoStartSkills).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import fs from 'fs/promises';
import path from 'path';

// Use a temp directory for test isolation
const TEST_USER_SKILLS_DIR = path.join(process.cwd(), 'data', '__test-skill-auto-start-prop1__');
const TEST_BUILTIN_SKILLS_DIR = path.join(process.cwd(), 'data', '__test-skill-auto-start-prop1-builtin__');
const PLUGIN_EX_PATH = path.join(TEST_USER_SKILLS_DIR, '.claude-plugin', 'plugin-ex.json');

// Mock the paths module to use our test directory
vi.mock('@/lib/config/paths', () => ({
  SKILLS_DIR_ABSOLUTE: path.join(process.cwd(), 'data', '__test-skill-auto-start-prop1-builtin__'),
  USER_SKILLS_DIR_ABSOLUTE: path.join(process.cwd(), 'data', '__test-skill-auto-start-prop1__'),
}));

// ========== Arbitraries ==========

/**
 * Generate valid skill names: lowercase alphanumeric with hyphens, like real skill names.
 * Must start with a letter, 3-20 chars long.
 */
const skillNameArb = fc.stringMatching(/^[a-z][a-z0-9\-]{2,19}$/).filter(
  (s) => !s.endsWith('-') && !s.includes('--'),
);

// ========== Helpers ==========

/**
 * Create a mock skill directory with SKILL.md and template.json (hasApp=true).
 */
async function createMockAppSkill(skillName: string): Promise<void> {
  const skillDir = path.join(TEST_USER_SKILLS_DIR, skillName);
  await fs.mkdir(skillDir, { recursive: true });

  // Create SKILL.md (required for skill to be recognized)
  const skillMdContent = `---
name: ${skillName}
description: Test skill ${skillName}
projectType: python-fastapi
---
# ${skillName}
`;
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');

  // Create template.json (marks it as hasApp=true)
  const templateConfig = {
    description: `Test skill ${skillName}`,
    projectType: 'python-fastapi',
  };
  await fs.writeFile(
    path.join(skillDir, 'template.json'),
    JSON.stringify(templateConfig, null, 2),
    'utf-8',
  );
}

// ========== Test Setup ==========

describe('Feature: skill-auto-start, Property 1: 自动启动设置的往返一致性', () => {
  beforeEach(async () => {
    // Ensure test directories exist
    await fs.mkdir(path.dirname(PLUGIN_EX_PATH), { recursive: true });
    await fs.mkdir(TEST_BUILTIN_SKILLS_DIR, { recursive: true });
    // Write empty config
    await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify({}, null, 2), 'utf-8');
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

  it('enabling auto-start then reading status returns true', () => {
    return fc.assert(
      fc.asyncProperty(skillNameArb, async (skillName) => {
        // Reset modules to get fresh imports for each iteration
        vi.resetModules();

        // Set up mock skill directory
        await createMockAppSkill(skillName);
        // Ensure clean config
        await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify({}, null, 2), 'utf-8');

        // Import fresh to avoid stale module state
        const { setSkillAutoStart, isSkillAutoStart } = await import('../skill-service');

        // Enable auto-start
        await setSkillAutoStart(skillName, true);

        // Read status - should be true
        const status = await isSkillAutoStart(skillName);
        expect(status).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('disabling auto-start then reading status returns false', () => {
    return fc.assert(
      fc.asyncProperty(skillNameArb, async (skillName) => {
        vi.resetModules();

        // Set up mock skill directory
        await createMockAppSkill(skillName);
        // Start with the skill already in autoStartSkills
        await fs.writeFile(
          PLUGIN_EX_PATH,
          JSON.stringify({ autoStartSkills: [skillName] }, null, 2),
          'utf-8',
        );

        const { setSkillAutoStart, isSkillAutoStart } = await import('../skill-service');

        // Disable auto-start
        await setSkillAutoStart(skillName, false);

        // Read status - should be false
        const status = await isSkillAutoStart(skillName);
        expect(status).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('enable then disable round-trip restores config (skill not in autoStartSkills)', () => {
    return fc.assert(
      fc.asyncProperty(skillNameArb, async (skillName) => {
        vi.resetModules();

        // Set up mock skill directory
        await createMockAppSkill(skillName);
        // Start with empty config
        await fs.writeFile(PLUGIN_EX_PATH, JSON.stringify({}, null, 2), 'utf-8');

        // Read config before enabling
        const configBefore = await fs.readFile(PLUGIN_EX_PATH, 'utf-8');
        const parsedBefore = JSON.parse(configBefore);
        const autoStartBefore = parsedBefore.autoStartSkills || [];

        // Verify skill is not in the list before
        expect(autoStartBefore).not.toContain(skillName);

        const { setSkillAutoStart } = await import('../skill-service');

        // Enable auto-start
        await setSkillAutoStart(skillName, true);

        // Verify skill IS in the list after enabling
        const configAfterEnable = await fs.readFile(PLUGIN_EX_PATH, 'utf-8');
        const parsedAfterEnable = JSON.parse(configAfterEnable);
        expect(parsedAfterEnable.autoStartSkills || []).toContain(skillName);

        // Disable auto-start
        await setSkillAutoStart(skillName, false);

        // Read config after disable - skill should NOT be in autoStartSkills
        const configAfterDisable = await fs.readFile(PLUGIN_EX_PATH, 'utf-8');
        const parsedAfterDisable = JSON.parse(configAfterDisable);
        const autoStartAfter = parsedAfterDisable.autoStartSkills || [];

        expect(autoStartAfter).not.toContain(skillName);
      }),
      { numRuns: 100 },
    );
  });

  it('enable/disable round-trip preserves other skills in autoStartSkills', () => {
    return fc.assert(
      fc.asyncProperty(
        // Generate two unique skill names
        fc.tuple(skillNameArb, skillNameArb).filter(([a, b]) => a !== b),
        async ([skillNameA, skillNameB]) => {
          vi.resetModules();

          // Set up both mock skill directories
          await createMockAppSkill(skillNameA);
          await createMockAppSkill(skillNameB);

          // Start with skillA already in autoStartSkills
          await fs.writeFile(
            PLUGIN_EX_PATH,
            JSON.stringify({ autoStartSkills: [skillNameA] }, null, 2),
            'utf-8',
          );

          const { setSkillAutoStart, isSkillAutoStart } = await import('../skill-service');

          // Enable skillB
          await setSkillAutoStart(skillNameB, true);

          // Both should be enabled
          expect(await isSkillAutoStart(skillNameA)).toBe(true);
          expect(await isSkillAutoStart(skillNameB)).toBe(true);

          // Disable skillB
          await setSkillAutoStart(skillNameB, false);

          // skillA should still be enabled, skillB should be disabled
          expect(await isSkillAutoStart(skillNameA)).toBe(true);
          expect(await isSkillAutoStart(skillNameB)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Property-based tests for non-App skill auto-start rejection.
 *
 * **Feature: skill-auto-start, Property 2: 非 App 技能不可设置自动启动**
 * **Validates: Requirements 1.3**
 *
 * For any skill whose `hasApp` is `false`, calling `setSkillAutoStart` should throw
 * an error ('Skill does not support app mode'), and the `autoStartSkills` list in
 * plugin-ex.json should NOT be modified.
 */

// Use a separate temp directory for Property 2 test isolation
const TEST_USER_SKILLS_DIR_P2 = path.join(process.cwd(), 'data', '__test-skill-auto-start-prop2__');
const TEST_BUILTIN_SKILLS_DIR_P2 = path.join(process.cwd(), 'data', '__test-skill-auto-start-prop2-builtin__');
const PLUGIN_EX_PATH_P2 = path.join(TEST_USER_SKILLS_DIR_P2, '.claude-plugin', 'plugin-ex.json');

// ========== Arbitraries (Property 2) ==========

/**
 * Generate valid skill names for non-App skills.
 * Same constraints as Property 1: lowercase alphanumeric with hyphens, 3-20 chars.
 */
const nonAppSkillNameArb = fc.stringMatching(/^[a-z][a-z0-9\-]{2,19}$/).filter(
  (s) => !s.endsWith('-') && !s.includes('--'),
);

/**
 * Generate a list of pre-existing auto-start skill names (0-5 skills).
 * These represent other App skills already in the autoStartSkills list.
 */
const existingAutoStartListArb = fc.array(
  fc.stringMatching(/^[a-z][a-z0-9\-]{2,14}$/).filter(
    (s) => !s.endsWith('-') && !s.includes('--'),
  ),
  { minLength: 0, maxLength: 5 },
).map((arr) => [...new Set(arr)]); // Deduplicate

// ========== Helpers (Property 2) ==========

/**
 * Create a mock non-App skill directory with SKILL.md only (no projectType, no template.json).
 * This ensures hasApp=false.
 */
async function createMockNonAppSkill(skillName: string): Promise<void> {
  const skillDir = path.join(TEST_USER_SKILLS_DIR_P2, skillName);
  await fs.mkdir(skillDir, { recursive: true });

  // Create SKILL.md WITHOUT projectType (required for skill to be recognized, but hasApp=false)
  const skillMdContent = `---
name: ${skillName}
description: Test non-app skill ${skillName}
---
# ${skillName}
A pure skill without app capabilities.
`;
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');

  // No template.json → hasApp will be false
}

// ========== Test Suite (Property 2) ==========

describe('Feature: skill-auto-start, Property 2: 非 App 技能不可设置自动启动', () => {
  beforeEach(async () => {
    // Ensure test directories exist
    await fs.mkdir(path.dirname(PLUGIN_EX_PATH_P2), { recursive: true });
    await fs.mkdir(TEST_BUILTIN_SKILLS_DIR_P2, { recursive: true });
    // Write empty config
    await fs.writeFile(PLUGIN_EX_PATH_P2, JSON.stringify({}, null, 2), 'utf-8');
  });

  afterEach(async () => {
    vi.resetModules();
    // Clean up test directories
    try {
      await fs.rm(TEST_USER_SKILLS_DIR_P2, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      await fs.rm(TEST_BUILTIN_SKILLS_DIR_P2, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('setSkillAutoStart throws error for non-App skill and autoStartSkills list is unchanged', () => {
    return fc.assert(
      fc.asyncProperty(
        nonAppSkillNameArb,
        existingAutoStartListArb,
        async (skillName, existingAutoStart) => {
          // Ensure the non-App skill name doesn't collide with existing auto-start names
          const filteredExisting = existingAutoStart.filter((s) => s !== skillName);

          vi.resetModules();

          // Override paths for this test suite's isolated directory
          vi.doMock('@/lib/config/paths', () => ({
            SKILLS_DIR_ABSOLUTE: TEST_BUILTIN_SKILLS_DIR_P2,
            USER_SKILLS_DIR_ABSOLUTE: TEST_USER_SKILLS_DIR_P2,
          }));

          // Set up mock non-App skill directory (hasApp=false)
          await createMockNonAppSkill(skillName);

          // Write initial config with pre-existing autoStartSkills
          const initialConfig = filteredExisting.length > 0
            ? { autoStartSkills: [...filteredExisting] }
            : {};
          await fs.writeFile(PLUGIN_EX_PATH_P2, JSON.stringify(initialConfig, null, 2), 'utf-8');

          // Snapshot the autoStartSkills list before the call
          const configBefore = JSON.parse(await fs.readFile(PLUGIN_EX_PATH_P2, 'utf-8'));
          const autoStartBefore = configBefore.autoStartSkills || [];

          // Import fresh module
          const { setSkillAutoStart } = await import('../skill-service');

          // Calling setSkillAutoStart(skillName, true) should throw
          await expect(setSkillAutoStart(skillName, true)).rejects.toThrow(
            'Skill does not support app mode',
          );

          // Verify autoStartSkills list was NOT modified
          const configAfter = JSON.parse(await fs.readFile(PLUGIN_EX_PATH_P2, 'utf-8'));
          const autoStartAfter = configAfter.autoStartSkills || [];

          expect(autoStartAfter).toEqual(autoStartBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Property-based tests for deleted skill cleanup from autoStartSkills.
 *
 * **Feature: skill-auto-start, Property 3: 已删除技能自动从自动启动列表清除**
 * **Validates: Requirements 1.4**
 *
 * For any autoStartSkills list and skill directory set, after calling
 * validateAndUpdatePluginJson(), the autoStartSkills list should only contain
 * skill names that actually exist in the skill directory AND have hasApp=true.
 */

// Use a separate temp directory for Property 3 test isolation
const TEST_USER_SKILLS_DIR_P3 = path.join(process.cwd(), 'data', '__test-skill-auto-start-prop3__');
const TEST_BUILTIN_SKILLS_DIR_P3 = path.join(process.cwd(), 'data', '__test-skill-auto-start-prop3-builtin__');
const PLUGIN_EX_PATH_P3 = path.join(TEST_USER_SKILLS_DIR_P3, '.claude-plugin', 'plugin-ex.json');

// ========== Arbitraries (Property 3) ==========

/**
 * Generate valid skill names for Property 3.
 * Same constraints: lowercase alphanumeric with hyphens, 3-20 chars.
 */
const p3SkillNameArb = fc.stringMatching(/^[a-z][a-z0-9\-]{2,19}$/).filter(
  (s) => !s.endsWith('-') && !s.includes('--'),
);

/**
 * Skill presence descriptor: each skill in autoStartSkills can be:
 * - 'missing': directory does not exist (deleted skill)
 * - 'non-app': directory exists with SKILL.md but no template.json (hasApp=false)
 * - 'app': directory exists with SKILL.md and template.json (hasApp=true)
 */
type SkillPresence = 'missing' | 'non-app' | 'app';

const skillPresenceArb: fc.Arbitrary<SkillPresence> = fc.constantFrom('missing', 'non-app', 'app');

/**
 * Generate a list of unique skill entries with their presence status.
 * Each entry is a [skillName, presence] tuple.
 * 1-8 skills to keep test runs manageable.
 */
const skillEntriesArb = fc.array(
  fc.tuple(p3SkillNameArb, skillPresenceArb),
  { minLength: 1, maxLength: 8 },
).map((entries) => {
  // Deduplicate by skill name, keeping the first occurrence
  const seen = new Set<string>();
  return entries.filter(([name]) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}).filter((entries) => entries.length >= 1);

// ========== Helpers (Property 3) ==========

/**
 * Create a mock App skill directory (hasApp=true) in the P3 test directory.
 */
async function createMockAppSkillP3(skillName: string): Promise<void> {
  const skillDir = path.join(TEST_USER_SKILLS_DIR_P3, skillName);
  await fs.mkdir(skillDir, { recursive: true });

  const skillMdContent = `---
name: ${skillName}
description: Test app skill ${skillName}
projectType: python-fastapi
---
# ${skillName}
`;
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');

  const templateConfig = {
    description: `Test skill ${skillName}`,
    projectType: 'python-fastapi',
  };
  await fs.writeFile(
    path.join(skillDir, 'template.json'),
    JSON.stringify(templateConfig, null, 2),
    'utf-8',
  );
}

/**
 * Create a mock non-App skill directory (hasApp=false) in the P3 test directory.
 */
async function createMockNonAppSkillP3(skillName: string): Promise<void> {
  const skillDir = path.join(TEST_USER_SKILLS_DIR_P3, skillName);
  await fs.mkdir(skillDir, { recursive: true });

  const skillMdContent = `---
name: ${skillName}
description: Test non-app skill ${skillName}
---
# ${skillName}
A pure skill without app capabilities.
`;
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');
  // No template.json → hasApp will be false
}

// ========== Test Suite (Property 3) ==========

describe('Feature: skill-auto-start, Property 3: 已删除技能自动从自动启动列表清除', () => {
  beforeEach(async () => {
    // Ensure test directories exist
    await fs.mkdir(path.dirname(PLUGIN_EX_PATH_P3), { recursive: true });
    await fs.mkdir(TEST_BUILTIN_SKILLS_DIR_P3, { recursive: true });
    // Write empty config
    await fs.writeFile(PLUGIN_EX_PATH_P3, JSON.stringify({}, null, 2), 'utf-8');
  });

  afterEach(async () => {
    vi.resetModules();
    // Clean up test directories
    try {
      await fs.rm(TEST_USER_SKILLS_DIR_P3, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      await fs.rm(TEST_BUILTIN_SKILLS_DIR_P3, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('after validateAndUpdatePluginJson, autoStartSkills only contains existing App skills', () => {
    return fc.assert(
      fc.asyncProperty(
        skillEntriesArb,
        async (skillEntries) => {
          vi.resetModules();

          // Override paths for this test suite's isolated directory
          vi.doMock('@/lib/config/paths', () => ({
            SKILLS_DIR_ABSOLUTE: TEST_BUILTIN_SKILLS_DIR_P3,
            USER_SKILLS_DIR_ABSOLUTE: TEST_USER_SKILLS_DIR_P3,
          }));

          // Set up skill directories based on presence status
          const allSkillNames: string[] = [];
          const expectedSurvivors: string[] = [];

          for (const [skillName, presence] of skillEntries) {
            allSkillNames.push(skillName);

            if (presence === 'app') {
              // Create directory with SKILL.md + template.json (hasApp=true)
              await createMockAppSkillP3(skillName);
              expectedSurvivors.push(skillName);
            } else if (presence === 'non-app') {
              // Create directory with SKILL.md only (hasApp=false)
              await createMockNonAppSkillP3(skillName);
              // Should NOT survive: exists but hasApp=false
            }
            // 'missing': no directory created → should NOT survive
          }

          // Write plugin-ex.json with ALL skill names in autoStartSkills
          // (simulating a state where some skills have been deleted or changed)
          const initialConfig = { autoStartSkills: [...allSkillNames] };
          await fs.writeFile(
            PLUGIN_EX_PATH_P3,
            JSON.stringify(initialConfig, null, 2),
            'utf-8',
          );

          // Import fresh module and call validateAndUpdatePluginJson
          const { validateAndUpdatePluginJson } = await import('../skill-service');
          await validateAndUpdatePluginJson();

          // Read the resulting plugin-ex.json
          const resultConfig = JSON.parse(await fs.readFile(PLUGIN_EX_PATH_P3, 'utf-8'));
          const resultAutoStart: string[] = resultConfig.autoStartSkills || [];

          // Property: autoStartSkills should only contain skills that BOTH exist AND have hasApp=true
          // 1. Every skill in the result must be in expectedSurvivors
          for (const name of resultAutoStart) {
            expect(expectedSurvivors).toContain(name);
          }

          // 2. Every expected survivor must be in the result
          for (const name of expectedSurvivors) {
            expect(resultAutoStart).toContain(name);
          }

          // 3. Result should have exactly the expected survivors (same length, same elements)
          expect(resultAutoStart.sort()).toEqual(expectedSurvivors.sort());
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property-based tests for API skill registry persistence round-trip.
 *
 * **Feature: api-skill-plugin, Property 4: 注册表持久化往返**
 * **Validates: Requirements 2.3**
 *
 * For any valid ApiSkillRegistryData object, saving it to a JSON file and
 * loading it back SHALL produce an equivalent object.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import os from 'os';
import fsPromises from 'fs/promises';
import path from 'path';
import type {
  ApiSkillRegistryData,
  RegisteredApiSkill,
  ApiEndpoint,
  ApiEndpointParam,
  ApiEndpointResponseField,
} from '@/lib/types/api-skill';

// ========== Mock Setup ==========

// Mock @/lib/config/paths to avoid PROJECTS_DIR requirement
vi.mock('@/lib/config/paths', () => ({
  USER_SKILLS_DIR_ABSOLUTE: '/tmp/mock-skills',
  PROJECTS_DIR_ABSOLUTE: '/tmp/mock-projects',
  SKILLS_DIR_ABSOLUTE: '/tmp/mock-builtin-skills',
}));

// Mock skill-service to avoid database and filesystem dependencies
vi.mock('@/lib/services/skill-service', () => ({
  isSkillEnabled: vi.fn().mockResolvedValue(true),
  getSkillEnvVars: vi.fn().mockResolvedValue({}),
}));

// Import after mocks are set up
import {
  loadRegistry,
  saveRegistry,
  registerSkill,
  unregisterSkill,
  getRegisteredSkills,
  getSkillByName,
} from '@/lib/services/api-skill-registry';
import { getSkillEnvVars } from '@/lib/services/skill-service';
import * as pathsModule from '@/lib/config/paths';

// ========== Arbitraries ==========

/** Non-empty string for identifiers and descriptions */
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.length > 0);

/** Valid HTTP methods */
const httpMethodArb = fc.constantFrom('GET' as const, 'POST' as const, 'PUT' as const, 'DELETE' as const);

/** Valid auth types */
const authTypeArb = fc.constantFrom('none' as const, 'api-key' as const, 'oauth' as const);

/** API path string starting with / */
const apiPathArb = fc
  .stringMatching(/^\/[a-z][a-z0-9\-\/]{0,49}$/)
  .filter((s) => s.length > 0);

/** Parameter type values */
const paramTypeArb = fc.constantFrom('string', 'number', 'boolean', 'object');

/** Response field type values */
const responseFieldTypeArb = fc.constantFrom('string', 'number', 'boolean', 'object', 'array');

/** Environment variable name */
const envVarNameArb = fc.stringMatching(/^[A-Z][A-Z0-9_]{0,29}$/);

/** ISO timestamp string - use integer-based approach to avoid invalid date edge cases */
const isoTimestampArb = fc
  .integer({
    min: new Date('2020-01-01T00:00:00.000Z').getTime(),
    max: new Date('2030-12-31T23:59:59.999Z').getTime(),
  })
  .map((ms) => new Date(ms).toISOString());

/** Arbitrary for ApiEndpointParam */
const apiEndpointParamArb: fc.Arbitrary<ApiEndpointParam> = fc.record({
  name: nonEmptyStringArb,
  type: paramTypeArb,
  required: fc.boolean(),
  description: nonEmptyStringArb,
});

/** Arbitrary for ApiEndpointResponseField */
const apiEndpointResponseFieldArb: fc.Arbitrary<ApiEndpointResponseField> = fc.record({
  name: nonEmptyStringArb,
  type: responseFieldTypeArb,
  description: nonEmptyStringArb,
});

/** Arbitrary for ApiEndpoint */
const apiEndpointArb: fc.Arbitrary<ApiEndpoint> = fc.record({
  path: apiPathArb,
  method: httpMethodArb,
  description: nonEmptyStringArb,
  parameters: fc.option(fc.array(apiEndpointParamArb, { minLength: 0, maxLength: 4 }), { nil: undefined }),
  responseDescription: fc.option(nonEmptyStringArb, { nil: undefined }),
  responseFields: fc.option(fc.array(apiEndpointResponseFieldArb, { minLength: 0, maxLength: 4 }), { nil: undefined }),
});

/** Arbitrary for RegisteredApiSkill */
const registeredApiSkillArb: fc.Arbitrary<RegisteredApiSkill> = fc.record({
  skillName: nonEmptyStringArb,
  displayName: nonEmptyStringArb,
  description: nonEmptyStringArb,
  auth: fc.record({
    authType: authTypeArb,
    envVars: fc.option(fc.array(envVarNameArb, { minLength: 0, maxLength: 4 }), { nil: undefined }),
    configured: fc.boolean(),
  }),
  endpoints: fc.array(apiEndpointArb, { minLength: 1, maxLength: 4 }),
  registeredAt: isoTimestampArb,
});

/** Arbitrary for ApiSkillRegistryData */
const apiSkillRegistryDataArb: fc.Arbitrary<ApiSkillRegistryData> = fc.record({
  version: fc.constant(1 as const),
  skills: fc.array(registeredApiSkillArb, { minLength: 0, maxLength: 5 }),
  updatedAt: isoTimestampArb,
});

// ========== Test Setup ==========

let tmpDir: string;
let originalSettingsDir: string | undefined;

beforeEach(async () => {
  // Save original SETTINGS_DIR
  originalSettingsDir = process.env.SETTINGS_DIR;

  // Create a temp directory for each test
  tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'api-skill-registry-test-'));
  process.env.SETTINGS_DIR = tmpDir;
});

afterEach(async () => {
  // Restore original SETTINGS_DIR
  if (originalSettingsDir === undefined) {
    delete process.env.SETTINGS_DIR;
  } else {
    process.env.SETTINGS_DIR = originalSettingsDir;
  }

  // Clean up temp directory
  try {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ========== Tests ==========

/**
 * **Feature: api-skill-plugin, Property 4: 注册表持久化往返**
 * **Validates: Requirements 2.3**
 */
describe('Property 4: 注册表持久化往返 (Registry persistence round-trip)', () => {
  it('saving and loading a registry preserves version and skills data', () => {
    return fc.assert(
      fc.asyncProperty(apiSkillRegistryDataArb, async (registryData) => {
        // Save the registry to a temp file
        await saveRegistry(registryData);

        // Load it back
        const loaded = await loadRegistry();

        // saveRegistry updates updatedAt to current time, so we compare
        // version and skills only (not updatedAt)
        expect(loaded.version).toBe(registryData.version);
        expect(loaded.skills).toEqual(registryData.skills);
      }),
      { numRuns: 100 },
    );
  });

  it('loaded registry has a valid updatedAt timestamp after save', () => {
    return fc.assert(
      fc.asyncProperty(apiSkillRegistryDataArb, async (registryData) => {
        const beforeSave = new Date().toISOString();

        await saveRegistry(registryData);

        const loaded = await loadRegistry();
        const afterLoad = new Date().toISOString();

        // updatedAt should be a valid ISO timestamp between before and after
        expect(loaded.updatedAt).toBeDefined();
        expect(typeof loaded.updatedAt).toBe('string');
        expect(loaded.updatedAt >= beforeSave).toBe(true);
        expect(loaded.updatedAt <= afterLoad).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('skills array length is preserved through save/load cycle', () => {
    return fc.assert(
      fc.asyncProperty(apiSkillRegistryDataArb, async (registryData) => {
        await saveRegistry(registryData);
        const loaded = await loadRegistry();

        expect(loaded.skills).toHaveLength(registryData.skills.length);
      }),
      { numRuns: 100 },
    );
  });

  it('each skill preserves all fields through save/load cycle', () => {
    return fc.assert(
      fc.asyncProperty(apiSkillRegistryDataArb, async (registryData) => {
        await saveRegistry(registryData);
        const loaded = await loadRegistry();

        for (let i = 0; i < registryData.skills.length; i++) {
          const original = registryData.skills[i];
          const restored = loaded.skills[i];

          expect(restored.skillName).toBe(original.skillName);
          expect(restored.displayName).toBe(original.displayName);
          expect(restored.description).toBe(original.description);
          expect(restored.auth).toEqual(original.auth);
          expect(restored.endpoints).toEqual(original.endpoints);
          expect(restored.registeredAt).toBe(original.registeredAt);
        }
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * **Feature: api-skill-plugin, Property 3: 注册/注销往返一致性**
 * **Validates: Requirements 2.1, 2.2**
 *
 * For any valid API skill, registering it to the registry and then
 * unregistering it SHALL result in a registry that does not contain
 * that skill, and the remaining skills SHALL be unchanged.
 */
describe('Property 3: 注册/注销往返一致性 (Register/unregister round-trip)', () => {
  /**
   * Arbitrary that generates a list of RegisteredApiSkill with unique skillNames,
   * plus one additional skill whose name is guaranteed not to collide.
   *
   * Returns { baseSkills, extraSkill } where extraSkill.skillName is unique
   * relative to all baseSkills.
   */
  const uniqueSkillsWithExtraArb = fc
    .uniqueArray(
      fc.stringMatching(/^[a-z][a-z0-9\-]{0,19}$/),
      { minLength: 1, maxLength: 6 },
    )
    .chain((uniqueNames) => {
      // Use the last name as the "extra" skill, the rest as base skills
      const baseNames = uniqueNames.slice(0, -1);
      const extraName = uniqueNames[uniqueNames.length - 1];

      // Generate a RegisteredApiSkill for each base name
      const baseSkillsArb = fc.tuple(
        ...baseNames.map((name) =>
          registeredApiSkillArb.map((skill) => ({ ...skill, skillName: name }))
        ),
      );

      // Generate the extra skill
      const extraSkillArb = registeredApiSkillArb.map((skill) => ({
        ...skill,
        skillName: extraName,
      }));

      // When baseNames is empty, return just the extra skill with empty base
      if (baseNames.length === 0) {
        return extraSkillArb.map((extra) => ({
          baseSkills: [] as RegisteredApiSkill[],
          extraSkill: extra,
        }));
      }

      return fc.tuple(baseSkillsArb, extraSkillArb).map(([baseArr, extra]) => ({
        baseSkills: baseArr as RegisteredApiSkill[],
        extraSkill: extra,
      }));
    });

  it('unregistering a skill removes only that skill from the registry', () => {
    return fc.assert(
      fc.asyncProperty(uniqueSkillsWithExtraArb, async ({ baseSkills, extraSkill }) => {
        // Build a registry containing base skills + the extra skill
        const allSkills = [...baseSkills, extraSkill];
        const registryWithExtra: ApiSkillRegistryData = {
          version: 1,
          skills: allSkills,
          updatedAt: new Date().toISOString(),
        };

        // Save the registry with all skills (including the extra)
        await saveRegistry(registryWithExtra);

        // Unregister the extra skill
        await unregisterSkill(extraSkill.skillName);

        // Load the registry after unregister
        const loaded = await loadRegistry();

        // The extra skill should NOT be in the registry
        const extraInRegistry = loaded.skills.find(
          (s) => s.skillName === extraSkill.skillName,
        );
        expect(extraInRegistry).toBeUndefined();

        // The remaining skills should match the base skills exactly
        expect(loaded.skills).toHaveLength(baseSkills.length);
        expect(loaded.skills).toEqual(baseSkills);
      }),
      { numRuns: 100 },
    );
  });

  it('unregistering a skill that does not exist leaves the registry unchanged', () => {
    return fc.assert(
      fc.asyncProperty(uniqueSkillsWithExtraArb, async ({ baseSkills, extraSkill }) => {
        // Build a registry containing ONLY the base skills (not the extra)
        const registryWithoutExtra: ApiSkillRegistryData = {
          version: 1,
          skills: baseSkills,
          updatedAt: new Date().toISOString(),
        };

        // Save the registry
        await saveRegistry(registryWithoutExtra);

        // Try to unregister a skill that is NOT in the registry
        await unregisterSkill(extraSkill.skillName);

        // Load the registry after the no-op unregister
        const loaded = await loadRegistry();

        // Skills should be unchanged
        expect(loaded.skills).toHaveLength(baseSkills.length);
        expect(loaded.skills).toEqual(baseSkills);
      }),
      { numRuns: 100 },
    );
  });

  it('registry version remains 1 after unregister', () => {
    return fc.assert(
      fc.asyncProperty(uniqueSkillsWithExtraArb, async ({ baseSkills, extraSkill }) => {
        const allSkills = [...baseSkills, extraSkill];
        const registry: ApiSkillRegistryData = {
          version: 1,
          skills: allSkills,
          updatedAt: new Date().toISOString(),
        };

        await saveRegistry(registry);
        await unregisterSkill(extraSkill.skillName);

        const loaded = await loadRegistry();
        expect(loaded.version).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * **Feature: api-skill-plugin, Property 8: 注册表查询正确性**
 * **Validates: Requirements 7.1, 7.2**
 *
 * For any ApiSkillRegistryData and any skill name, getSkillByName SHALL return
 * the skill's metadata if the skill is registered, or undefined if it is not.
 * getRegisteredSkills SHALL return all skills in the registry.
 */
describe('Property 8: 注册表查询正确性 (Registry query correctness)', () => {
  /**
   * Arbitrary that generates a registry with skills that have unique skillNames.
   */
  const registryWithUniqueSkillNamesArb: fc.Arbitrary<ApiSkillRegistryData> = fc
    .uniqueArray(
      fc.stringMatching(/^[a-z][a-z0-9\-]{0,19}$/),
      { minLength: 0, maxLength: 5 },
    )
    .chain((uniqueNames) => {
      const skillsArb =
        uniqueNames.length === 0
          ? fc.constant([] as RegisteredApiSkill[])
          : fc
              .tuple(
                ...uniqueNames.map((name) =>
                  registeredApiSkillArb.map((skill) => ({ ...skill, skillName: name }))
                ),
              )
              .map((arr) => arr as RegisteredApiSkill[]);

      return fc.tuple(skillsArb, isoTimestampArb).map(([skills, updatedAt]) => ({
        version: 1 as const,
        skills,
        updatedAt,
      }));
    });

  it('getRegisteredSkills returns all skills in the registry (same length and content)', () => {
    fc.assert(
      fc.property(registryWithUniqueSkillNamesArb, (registry) => {
        const result = getRegisteredSkills(registry);

        // Same length
        expect(result).toHaveLength(registry.skills.length);

        // Same content (reference equality – getRegisteredSkills returns registry.skills)
        expect(result).toEqual(registry.skills);
      }),
      { numRuns: 100 },
    );
  });

  it('getSkillByName returns the correct skill when queried with an existing name', () => {
    // Generate a registry with at least one skill, then pick one name to query
    const registryWithAtLeastOneSkillArb = registryWithUniqueSkillNamesArb.filter(
      (reg) => reg.skills.length > 0,
    );

    fc.assert(
      fc.property(
        registryWithAtLeastOneSkillArb.chain((registry) =>
          fc
            .integer({ min: 0, max: registry.skills.length - 1 })
            .map((idx) => ({ registry, queryName: registry.skills[idx].skillName, expectedIdx: idx })),
        ),
        ({ registry, queryName, expectedIdx }) => {
          const result = getSkillByName(registry, queryName);

          // Should not be undefined
          expect(result).toBeDefined();

          // Should match the expected skill
          expect(result).toEqual(registry.skills[expectedIdx]);
          expect(result!.skillName).toBe(queryName);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getSkillByName returns undefined when queried with a name not in the registry', () => {
    fc.assert(
      fc.property(
        registryWithUniqueSkillNamesArb,
        // Generate a name guaranteed not to be in the registry by using a prefix
        nonEmptyStringArb.map((s) => `__nonexistent__${s}`),
        (registry, queryName) => {
          // Extra safety: ensure the generated name is truly not in the registry
          const nameExists = registry.skills.some((s) => s.skillName === queryName);
          fc.pre(!nameExists);

          const result = getSkillByName(registry, queryName);

          expect(result).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * **Feature: api-skill-plugin, Property 7: 未配置认证技能标记**
 * **Validates: Requirements 4.2, 5.3**
 *
 * For any API skill with auth.authType not equal to 'none' and auth.envVars
 * containing variables not set in the environment, the registered skill entry
 * SHALL have `auth.configured` set to false.
 */
describe('Property 7: 未配置认证技能标记 (Unconfigured auth flagging)', () => {
  /**
   * Skill name arbitrary: lowercase alphanumeric with hyphens, valid directory name.
   */
  const skillNameArb = fc.stringMatching(/^[a-z][a-z0-9\-]{2,19}$/);

  /**
   * Auth type that requires configuration (not 'none').
   */
  const authTypeRequiringConfigArb = fc.constantFrom('api-key' as const, 'oauth' as const);

  /**
   * Arbitrary for a minimal valid api-endpoints.json config with specific auth settings.
   */
  function apiEndpointsConfigArb(opts: {
    skillName: string;
    authType: 'none' | 'api-key' | 'oauth';
    envVars?: string[];
  }) {
    return fc.constant({
      skillName: opts.skillName,
      displayName: `Display ${opts.skillName}`,
      description: `Description for ${opts.skillName}`,
      auth: {
        authType: opts.authType,
        ...(opts.envVars ? { envVars: opts.envVars } : {}),
      },
      endpoints: [
        {
          path: '/api/test',
          method: 'GET' as const,
          description: 'Test endpoint',
        },
      ],
    });
  }

  /**
   * Helper: create a skill directory with api-endpoints.json under the given base dir.
   */
  async function createSkillDir(
    baseDir: string,
    skillName: string,
    config: Record<string, unknown>,
  ) {
    const skillDir = path.join(baseDir, skillName);
    await fsPromises.mkdir(skillDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(skillDir, 'api-endpoints.json'),
      JSON.stringify(config),
      'utf-8',
    );
  }

  /**
   * Helper: clean up a skill directory.
   */
  async function cleanupSkillDir(baseDir: string, skillName: string) {
    try {
      await fsPromises.rm(path.join(baseDir, skillName), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  // Use a dedicated temp dir for skill directories in this describe block
  let skillsBaseDir: string;

  beforeEach(async () => {
    skillsBaseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'api-skill-prop7-'));
    // Dynamically update the mocked USER_SKILLS_DIR_ABSOLUTE to our temp dir
    (pathsModule as Record<string, unknown>).USER_SKILLS_DIR_ABSOLUTE = skillsBaseDir;
  });

  afterEach(async () => {
    // Restore the original mock value
    (pathsModule as Record<string, unknown>).USER_SKILLS_DIR_ABSOLUTE = '/tmp/mock-skills';
    // Clean up the temp skills directory
    try {
      await fsPromises.rm(skillsBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('auth.configured is true when authType is "none", regardless of envVars', () => {
    return fc.assert(
      fc.asyncProperty(
        skillNameArb,
        fc.option(fc.array(envVarNameArb, { minLength: 0, maxLength: 3 }), { nil: undefined }),
        async (skillName, envVars) => {
          // Create skill directory with authType 'none'
          const config = {
            skillName,
            displayName: `Display ${skillName}`,
            description: `Description for ${skillName}`,
            auth: {
              authType: 'none',
              ...(envVars ? { envVars } : {}),
            },
            endpoints: [
              { path: '/api/test', method: 'GET', description: 'Test endpoint' },
            ],
          };

          await createSkillDir(skillsBaseDir, skillName, config);

          // Mock getSkillEnvVars to return empty (no env vars set)
          vi.mocked(getSkillEnvVars).mockResolvedValue({});

          try {
            await registerSkill(skillName);
            const registry = await loadRegistry();
            const skill = registry.skills.find((s) => s.skillName === skillName);

            expect(skill).toBeDefined();
            expect(skill!.auth.authType).toBe('none');
            expect(skill!.auth.configured).toBe(true);
          } finally {
            await cleanupSkillDir(skillsBaseDir, skillName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('auth.configured is true when authType requires config and ALL envVars are set with non-empty values', () => {
    return fc.assert(
      fc.asyncProperty(
        skillNameArb,
        authTypeRequiringConfigArb,
        fc.array(envVarNameArb, { minLength: 1, maxLength: 4 }).filter(
          (arr) => new Set(arr).size === arr.length, // unique env var names
        ),
        async (skillName, authType, envVars) => {
          const config = {
            skillName,
            displayName: `Display ${skillName}`,
            description: `Description for ${skillName}`,
            auth: { authType, envVars },
            endpoints: [
              { path: '/api/test', method: 'GET', description: 'Test endpoint' },
            ],
          };

          await createSkillDir(skillsBaseDir, skillName, config);

          // Mock getSkillEnvVars to return all env vars with non-empty values
          const envVarValues: Record<string, string> = {};
          for (const v of envVars) {
            envVarValues[v] = 'configured-value';
          }
          vi.mocked(getSkillEnvVars).mockResolvedValue(envVarValues);

          try {
            await registerSkill(skillName);
            const registry = await loadRegistry();
            const skill = registry.skills.find((s) => s.skillName === skillName);

            expect(skill).toBeDefined();
            expect(skill!.auth.authType).toBe(authType);
            expect(skill!.auth.configured).toBe(true);
          } finally {
            await cleanupSkillDir(skillsBaseDir, skillName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('auth.configured is false when authType requires config and some envVars are missing', () => {
    return fc.assert(
      fc.asyncProperty(
        skillNameArb,
        authTypeRequiringConfigArb,
        fc.array(envVarNameArb, { minLength: 2, maxLength: 4 }).filter(
          (arr) => new Set(arr).size === arr.length, // unique env var names
        ),
        fc.integer({ min: 1 }), // at least 1 env var will be missing
        async (skillName, authType, envVars, missingCountSeed) => {
          const config = {
            skillName,
            displayName: `Display ${skillName}`,
            description: `Description for ${skillName}`,
            auth: { authType, envVars },
            endpoints: [
              { path: '/api/test', method: 'GET', description: 'Test endpoint' },
            ],
          };

          await createSkillDir(skillsBaseDir, skillName, config);

          // Set some env vars but leave at least one missing
          const missingCount = Math.min(
            (missingCountSeed % envVars.length) + 1,
            envVars.length,
          );
          const envVarValues: Record<string, string> = {};
          for (let i = 0; i < envVars.length - missingCount; i++) {
            envVarValues[envVars[i]] = 'configured-value';
          }
          // The remaining envVars are NOT in the returned object (missing)
          vi.mocked(getSkillEnvVars).mockResolvedValue(envVarValues);

          try {
            await registerSkill(skillName);
            const registry = await loadRegistry();
            const skill = registry.skills.find((s) => s.skillName === skillName);

            expect(skill).toBeDefined();
            expect(skill!.auth.authType).toBe(authType);
            expect(skill!.auth.configured).toBe(false);
          } finally {
            await cleanupSkillDir(skillsBaseDir, skillName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('auth.configured is false when authType requires config and all envVars are empty strings', () => {
    return fc.assert(
      fc.asyncProperty(
        skillNameArb,
        authTypeRequiringConfigArb,
        fc.array(envVarNameArb, { minLength: 1, maxLength: 4 }).filter(
          (arr) => new Set(arr).size === arr.length,
        ),
        async (skillName, authType, envVars) => {
          const config = {
            skillName,
            displayName: `Display ${skillName}`,
            description: `Description for ${skillName}`,
            auth: { authType, envVars },
            endpoints: [
              { path: '/api/test', method: 'GET', description: 'Test endpoint' },
            ],
          };

          await createSkillDir(skillsBaseDir, skillName, config);

          // Mock getSkillEnvVars to return all env vars with empty string values
          const envVarValues: Record<string, string> = {};
          for (const v of envVars) {
            envVarValues[v] = '';
          }
          vi.mocked(getSkillEnvVars).mockResolvedValue(envVarValues);

          try {
            await registerSkill(skillName);
            const registry = await loadRegistry();
            const skill = registry.skills.find((s) => s.skillName === skillName);

            expect(skill).toBeDefined();
            expect(skill!.auth.authType).toBe(authType);
            expect(skill!.auth.configured).toBe(false);
          } finally {
            await cleanupSkillDir(skillsBaseDir, skillName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('auth.configured is false when authType requires config and envVars contain only whitespace', () => {
    return fc.assert(
      fc.asyncProperty(
        skillNameArb,
        authTypeRequiringConfigArb,
        fc.array(envVarNameArb, { minLength: 1, maxLength: 4 }).filter(
          (arr) => new Set(arr).size === arr.length,
        ),
        async (skillName, authType, envVars) => {
          const config = {
            skillName,
            displayName: `Display ${skillName}`,
            description: `Description for ${skillName}`,
            auth: { authType, envVars },
            endpoints: [
              { path: '/api/test', method: 'GET', description: 'Test endpoint' },
            ],
          };

          await createSkillDir(skillsBaseDir, skillName, config);

          // Mock getSkillEnvVars to return all env vars with whitespace-only values
          const envVarValues: Record<string, string> = {};
          for (const v of envVars) {
            envVarValues[v] = '   ';
          }
          vi.mocked(getSkillEnvVars).mockResolvedValue(envVarValues);

          try {
            await registerSkill(skillName);
            const registry = await loadRegistry();
            const skill = registry.skills.find((s) => s.skillName === skillName);

            expect(skill).toBeDefined();
            expect(skill!.auth.authType).toBe(authType);
            expect(skill!.auth.configured).toBe(false);
          } finally {
            await cleanupSkillDir(skillsBaseDir, skillName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

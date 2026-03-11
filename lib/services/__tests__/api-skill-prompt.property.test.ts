/**
 * Property-based tests for API skill prompt block completeness.
 *
 * **Feature: api-skill-plugin, Property 6: 提示词块包含所有注册技能信息**
 * **Validates: Requirements 3.1, 3.2**
 *
 * For any non-empty ApiSkillRegistryData, the generated prompt block SHALL
 * contain every registered skill's displayName, and for each skill, every
 * endpoint's method and path.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type {
  ApiSkillRegistryData,
  RegisteredApiSkill,
  ApiEndpoint,
  ApiEndpointParam,
  ApiEndpointResponseField,
} from '@/lib/types/api-skill';
import { createEmptyRegistry } from '@/lib/types/api-skill';
import { buildApiSkillPromptBlock } from '@/lib/services/api-skill-prompt';

// ========== Arbitraries ==========

/** Valid HTTP methods */
const httpMethodArb = fc.constantFrom(
  'GET' as const,
  'POST' as const,
  'PUT' as const,
  'DELETE' as const,
);

/** Valid auth types */
const authTypeArb = fc.constantFrom(
  'none' as const,
  'api-key' as const,
  'oauth' as const,
);

/** Parameter type values */
const paramTypeArb = fc.constantFrom('string', 'number', 'boolean', 'object');

/** Response field type values */
const responseFieldTypeArb = fc.constantFrom('string', 'number', 'boolean', 'object', 'array');

/** Non-empty alphanumeric string for identifiers (avoids substring collisions) */
const identifierArb = fc.stringMatching(/^[a-z][a-z0-9\-]{0,19}$/);

/** Non-empty description string */
const descriptionArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

/** Environment variable name */
const envVarNameArb = fc.stringMatching(/^[A-Z][A-Z0-9_]{0,29}$/);

/**
 * Display name with a unique prefix to avoid false substring matches.
 * Uses "SkillDisplay_" prefix followed by a unique identifier.
 */
const displayNameArb = identifierArb.map((id) => `SkillDisplay_${id}`);

/**
 * Skill name with a unique prefix to avoid false substring matches.
 */
const skillNameArb = identifierArb.map((id) => `skill-${id}`);

/** API path string starting with / */
const apiPathArb = fc
  .stringMatching(/^\/[a-z][a-z0-9\-\/]{0,29}$/)
  .filter((s) => s.length > 0);

/** ISO timestamp string */
const isoTimestampArb = fc
  .integer({
    min: new Date('2020-01-01T00:00:00.000Z').getTime(),
    max: new Date('2030-12-31T23:59:59.999Z').getTime(),
  })
  .map((ms) => new Date(ms).toISOString());

/** Arbitrary for ApiEndpointParam */
const apiEndpointParamArb: fc.Arbitrary<ApiEndpointParam> = fc.record({
  name: identifierArb,
  type: paramTypeArb,
  required: fc.boolean(),
  description: descriptionArb,
});

/** Arbitrary for ApiEndpointResponseField */
const apiEndpointResponseFieldArb: fc.Arbitrary<ApiEndpointResponseField> = fc.record({
  name: identifierArb,
  type: responseFieldTypeArb,
  description: descriptionArb,
});

/** Arbitrary for ApiEndpoint */
const apiEndpointArb: fc.Arbitrary<ApiEndpoint> = fc.record({
  path: apiPathArb,
  method: httpMethodArb,
  description: descriptionArb,
  parameters: fc.option(fc.array(apiEndpointParamArb, { minLength: 0, maxLength: 3 }), {
    nil: undefined,
  }),
  responseDescription: fc.option(descriptionArb, { nil: undefined }),
  responseFields: fc.option(
    fc.array(apiEndpointResponseFieldArb, { minLength: 0, maxLength: 3 }),
    { nil: undefined },
  ),
});

/** Arbitrary for RegisteredApiSkill with unique prefixed names */
const registeredApiSkillArb: fc.Arbitrary<RegisteredApiSkill> = fc.record({
  skillName: skillNameArb,
  displayName: displayNameArb,
  description: descriptionArb,
  auth: fc.record({
    authType: authTypeArb,
    envVars: fc.option(fc.array(envVarNameArb, { minLength: 0, maxLength: 3 }), {
      nil: undefined,
    }),
    configured: fc.boolean(),
  }),
  endpoints: fc.array(apiEndpointArb, { minLength: 1, maxLength: 4 }),
  registeredAt: isoTimestampArb,
});

/**
 * Arbitrary for non-empty ApiSkillRegistryData (at least 1 skill).
 * Skills have unique skillNames and unique displayNames.
 */
const nonEmptyRegistryArb: fc.Arbitrary<ApiSkillRegistryData> = fc
  .uniqueArray(
    fc.tuple(identifierArb, identifierArb),
    {
      minLength: 1,
      maxLength: 5,
      comparator: (a, b) => a[0] === b[0] || a[1] === b[1],
    },
  )
  .chain((uniquePairs) => {
    const skillsArb = fc.tuple(
      ...uniquePairs.map(([nameId, displayId]) =>
        registeredApiSkillArb.map((skill) => ({
          ...skill,
          skillName: `skill-${nameId}`,
          displayName: `SkillDisplay_${displayId}`,
        })),
      ),
    );

    return fc.tuple(skillsArb, isoTimestampArb).map(([skills, updatedAt]) => ({
      version: 1 as const,
      skills: skills as RegisteredApiSkill[],
      updatedAt,
    }));
  });

// ========== Tests ==========

/**
 * **Feature: api-skill-plugin, Property 6: 提示词块包含所有注册技能信息**
 * **Validates: Requirements 3.1, 3.2**
 */
describe('Property 6: 提示词块包含所有注册技能信息 (Prompt block contains all registered skill info)', () => {
  it('output contains every skill\'s displayName', () => {
    fc.assert(
      fc.property(nonEmptyRegistryArb, (registry) => {
        const output = buildApiSkillPromptBlock(registry);

        for (const skill of registry.skills) {
          expect(output).toContain(skill.displayName);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('output contains every endpoint\'s method and path for each skill', () => {
    fc.assert(
      fc.property(nonEmptyRegistryArb, (registry) => {
        const output = buildApiSkillPromptBlock(registry);

        for (const skill of registry.skills) {
          for (const endpoint of skill.endpoints) {
            // The prompt format includes "METHOD /path" (e.g., "GET /api/todos")
            expect(output).toContain(`${endpoint.method} ${endpoint.path}`);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('output contains every skill\'s skillName', () => {
    fc.assert(
      fc.property(nonEmptyRegistryArb, (registry) => {
        const output = buildApiSkillPromptBlock(registry);

        for (const skill of registry.skills) {
          expect(output).toContain(skill.skillName);
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ========== Unit Tests: Empty Registry Edge Case ==========

/**
 * Unit tests for empty registry edge case.
 *
 * **Validates: Requirements 3.3**
 *
 * WHEN no API skills are registered, THE API_Skill_Prompt_Builder SHALL
 * return an empty string and not inject any API skill section into the prompt.
 */
describe('Unit: Empty registry returns empty string (Requirement 3.3)', () => {
  it('returns empty string for a registry created by createEmptyRegistry()', () => {
    const registry = createEmptyRegistry();
    const result = buildApiSkillPromptBlock(registry);
    expect(result).toBe('');
  });

  it('returns empty string for a registry with empty skills array but different updatedAt', () => {
    const registry: ApiSkillRegistryData = {
      version: 1,
      skills: [],
      updatedAt: '2025-06-15T12:00:00.000Z',
    };
    const result = buildApiSkillPromptBlock(registry);
    expect(result).toBe('');
  });
});

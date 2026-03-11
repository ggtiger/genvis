import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateTemplateJson } from '../transformer';
import type { ParsedManifest } from '../types';

/**
 * **Validates: Requirements 5.3, 5.4**
 *
 * Property 9: Required Environment Variables Determine Enable Status
 *
 * The enable/disable logic lives in importSkill (skill-service.ts), which
 * checks `envVars?.some(v => v.required)` on the parsed skill directory.
 * Since template.json is the source of truth for envVars, we verify at the
 * template.json level that:
 *
 * - If the manifest has at least one required envVar, the generated
 *   template.json contains at least one envVar with required: true
 *   (so importSkill will disable the skill).
 * - If the manifest has no required envVars, the generated template.json
 *   has no envVar with required: true (so importSkill will enable the skill).
 */

// ── Arbitraries (reused patterns from transformer.property.test.ts) ──

const arbKebabCase = fc
  .stringMatching(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
  .filter((s) => s.length >= 1 && s.length <= 30);

const arbSafeString = fc
  .stringMatching(/^[a-zA-Z0-9 ]+$/)
  .filter((s) => s.length >= 1 && s.length <= 50);

const arbRuntime = fc.constantFrom<'python' | 'node' | 'typescript' | 'unknown'>(
  'python',
  'node',
  'typescript',
  'unknown',
);

const arbParsedManifest: fc.Arbitrary<ParsedManifest> = fc
  .record({
    name: arbKebabCase,
    displayName: fc.option(arbSafeString, { nil: undefined }),
    description: arbSafeString,
    version: fc.option(arbSafeString, { nil: undefined }),
    author: fc.option(arbSafeString, { nil: undefined }),
    category: fc.option(arbSafeString, { nil: undefined }),
    tags: fc.option(fc.array(arbSafeString, { minLength: 0, maxLength: 5 }), { nil: undefined }),
    runtime: fc.option(arbRuntime, { nil: undefined }),
  })
  .map((rec) => ({
    name: rec.name,
    description: rec.description,
    ...(rec.displayName !== undefined && { displayName: rec.displayName }),
    ...(rec.version !== undefined && { version: rec.version }),
    ...(rec.author !== undefined && { author: rec.author }),
    ...(rec.category !== undefined && { category: rec.category }),
    ...(rec.tags !== undefined && { tags: rec.tags }),
    ...(rec.runtime !== undefined && { runtime: rec.runtime }),
    sourcePlatform: 'openclaw' as const,
    sourceUrl: 'https://clawhub.ai/test/test-skill',
  }));

const arbEnvVarKey = fc
  .stringMatching(/^[A-Z][A-Z0-9_]*$/)
  .filter((s) => s.length >= 1 && s.length <= 30);

/**
 * Arbitrary: envVars array where at least one variable has required: true
 */
const arbEnvVarsWithRequired: fc.Arbitrary<
  Array<{ key: string; label?: string; required: boolean; secret?: boolean; defaultValue?: string }>
> = fc
  .array(
    fc.record({
      key: arbEnvVarKey,
      label: fc.option(arbSafeString, { nil: undefined }),
      required: fc.boolean(),
      secret: fc.option(fc.boolean(), { nil: undefined }),
      defaultValue: fc.option(arbSafeString, { nil: undefined }),
    }),
    { minLength: 1, maxLength: 10 },
  )
  .map((vars) => {
    // Ensure unique keys
    const seen = new Set<string>();
    const unique = vars.filter((v) => {
      if (seen.has(v.key)) return false;
      seen.add(v.key);
      return true;
    });
    // Force at least one to be required
    if (!unique.some((v) => v.required) && unique.length > 0) {
      unique[0].required = true;
    }
    return unique;
  })
  .filter((vars) => vars.length >= 1 && vars.some((v) => v.required));

/**
 * Arbitrary: envVars array where NO variable has required: true
 */
const arbEnvVarsNoRequired: fc.Arbitrary<
  Array<{ key: string; label?: string; required: boolean; secret?: boolean; defaultValue?: string }>
> = fc
  .array(
    fc.record({
      key: arbEnvVarKey,
      label: fc.option(arbSafeString, { nil: undefined }),
      required: fc.constant(false),
      secret: fc.option(fc.boolean(), { nil: undefined }),
      defaultValue: fc.option(arbSafeString, { nil: undefined }),
    }),
    { minLength: 0, maxLength: 10 },
  )
  .map((vars) => {
    const seen = new Set<string>();
    return vars.filter((v) => {
      if (seen.has(v.key)) return false;
      seen.add(v.key);
      return true;
    });
  });

describe('Property 9: Required Environment Variables Determine Enable Status', () => {
  it('manifest with required envVars → template.json has required envVars (skill should be disabled)', () => {
    fc.assert(
      fc.property(arbParsedManifest, arbEnvVarsWithRequired, (baseManifest, envVars) => {
        const manifest: ParsedManifest = { ...baseManifest, envVars };
        const templateConfig = generateTemplateJson(manifest);

        // template.json must contain envVars
        expect(templateConfig.envVars).toBeDefined();
        expect(templateConfig.envVars!.length).toBeGreaterThan(0);

        // At least one envVar must have required: true
        const hasRequired = templateConfig.envVars!.some((v) => v.required);
        expect(hasRequired).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('manifest without required envVars → template.json has no required envVars (skill should be enabled)', () => {
    fc.assert(
      fc.property(arbParsedManifest, arbEnvVarsNoRequired, (baseManifest, envVars) => {
        const manifest: ParsedManifest = {
          ...baseManifest,
          envVars: envVars.length > 0 ? envVars : undefined,
        };
        const templateConfig = generateTemplateJson(manifest);

        // If envVars exist in template, none should be required
        if (templateConfig.envVars && templateConfig.envVars.length > 0) {
          const hasRequired = templateConfig.envVars.some((v) => v.required);
          expect(hasRequired).toBe(false);
        }
        // If no envVars, that's also fine — skill will be enabled
      }),
      { numRuns: 100 },
    );
  });

  it('manifest with no envVars at all → template.json has no envVars (skill should be enabled)', () => {
    fc.assert(
      fc.property(arbParsedManifest, (manifest) => {
        // Ensure no envVars on the manifest
        const cleanManifest: ParsedManifest = { ...manifest };
        delete cleanManifest.envVars;

        const templateConfig = generateTemplateJson(cleanManifest);

        // No envVars means no required envVars → skill enabled
        expect(templateConfig.envVars).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});

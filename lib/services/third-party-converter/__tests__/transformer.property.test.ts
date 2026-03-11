import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateTemplateJson, generateSkillMd } from '../transformer';
import matter from 'gray-matter';
import type { ParsedManifest } from '../types';

/**
 * Arbitrary: kebab-case name (non-empty, lowercase letters and hyphens)
 */
const arbKebabCase = fc
  .stringMatching(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
  .filter((s) => s.length >= 1 && s.length <= 30);

/**
 * Arbitrary: non-empty safe string (avoids YAML/JSON special chars)
 */
const arbSafeString = fc
  .stringMatching(/^[a-zA-Z0-9 ]+$/)
  .filter((s) => s.length >= 1 && s.length <= 50);

/**
 * Arbitrary: valid runtime value
 */
const arbRuntime = fc.constantFrom<'python' | 'node' | 'typescript' | 'unknown'>(
  'python',
  'node',
  'typescript',
  'unknown',
);

/**
 * Arbitrary: valid ParsedManifest object for round-trip testing
 */
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

/**
 * Helper: compute the expected projectType from a manifest,
 * mirroring the logic in transformer.ts: only set projectType when
 * the skill has runnable code (explicit runtime or codeFiles).
 */
function expectedProjectType(
  manifest: ParsedManifest,
): 'nextjs' | 'python-fastapi' | undefined {
  const hasCode = !!(manifest.runtime || (manifest.codeFiles && manifest.codeFiles.length > 0));
  if (!hasCode) return undefined;
  if (manifest.runtime === 'python') return 'python-fastapi';
  return 'nextjs';
}

/**
 * **Validates: Requirements 3.1, 3.6**
 *
 * Property 4: template.json Generation Round-Trip Consistency
 *
 * For any valid ParsedManifest, calling generateTemplateJson and then
 * serializing the result to JSON and parsing it back (simulating what
 * parseTemplateJson does internally: JSON.parse(fs.readFile(...))) should
 * produce consistent values for displayName, description, category, tags,
 * version, author, and projectType.
 */
describe('Property 4: template.json Generation Round-Trip Consistency', () => {
  it('generateTemplateJson → JSON.stringify → JSON.parse produces consistent field values', () => {
    fc.assert(
      fc.property(arbParsedManifest, (manifest) => {
        // Step 1: Generate TemplateConfig from manifest
        const templateConfig = generateTemplateJson(manifest);

        // Step 2: Simulate what transformToSkillDir + parseTemplateJson does:
        //   transformToSkillDir writes: JSON.stringify(templateConfig, null, 2)
        //   parseTemplateJson reads:    JSON.parse(content) as TemplateConfig
        const json = JSON.stringify(templateConfig, null, 2);
        const parsed = JSON.parse(json);

        // Step 3: Verify round-trip consistency for all required fields

        // displayName: should be translatedMeta?.displayName || manifest.displayName || manifest.name
        const expectedDisplayName = manifest.displayName || manifest.name;
        expect(parsed.displayName).toBe(expectedDisplayName);

        // description: should match manifest.description
        expect(parsed.description).toBe(manifest.description);

        // projectType: should be mapped from runtime (only when has runnable code)
        expect(parsed.projectType).toBe(expectedProjectType(manifest));

        // category: should match manifest.category (or be absent)
        if (manifest.category) {
          expect(parsed.category).toBe(manifest.category);
        } else {
          expect(parsed.category).toBeUndefined();
        }

        // tags: should match manifest.tags (or be absent)
        if (manifest.tags && manifest.tags.length > 0) {
          expect(parsed.tags).toEqual(manifest.tags);
        } else {
          expect(parsed.tags).toBeUndefined();
        }

        // version: should match manifest.version (or be absent)
        if (manifest.version) {
          expect(parsed.version).toBe(manifest.version);
        } else {
          expect(parsed.version).toBeUndefined();
        }

        // author: should match manifest.author (or be absent)
        if (manifest.author) {
          expect(parsed.author).toBe(manifest.author);
        } else {
          expect(parsed.author).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * **Validates: Requirements 3.2, 3.7**
 *
 * Property 5: SKILL.md Generation Round-Trip Consistency
 *
 * For any valid ParsedManifest, calling generateSkillMd and then parsing
 * the result with gray-matter should produce consistent values for name,
 * description, version, author, category, tags, projectType.
 * The name in frontmatter should be displayName || manifest.name.
 */
describe('Property 5: SKILL.md Generation Round-Trip Consistency', () => {
  it('generateSkillMd → gray-matter parse produces consistent field values', () => {
    fc.assert(
      fc.property(arbParsedManifest, (manifest) => {
        // Step 1: Generate SKILL.md content
        const skillMdContent = generateSkillMd(manifest);

        // Step 2: Parse it back with gray-matter (same as parseSkillMd does)
        const { data } = matter(skillMdContent);

        // Step 3: Verify round-trip consistency

        // name in frontmatter should be displayName || manifest.name
        const expectedName = manifest.displayName || manifest.name;
        expect(data.name).toBe(expectedName);

        // description should match
        expect(data.description).toBe(manifest.description);

        // projectType should be mapped from runtime (only when has runnable code)
        expect(data.projectType).toBe(expectedProjectType(manifest));

        // version: present if manifest has it
        if (manifest.version) {
          expect(data.version).toBe(manifest.version);
        } else {
          expect(data.version).toBeUndefined();
        }

        // author: present if manifest has it
        if (manifest.author) {
          expect(data.author).toBe(manifest.author);
        } else {
          expect(data.author).toBeUndefined();
        }

        // category: present if manifest has it
        if (manifest.category) {
          expect(data.category).toBe(manifest.category);
        } else {
          expect(data.category).toBeUndefined();
        }

        // tags: present if manifest has non-empty tags
        if (manifest.tags && manifest.tags.length > 0) {
          expect(data.tags).toEqual(manifest.tags);
        } else {
          expect(data.tags).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Arbitrary: environment variable key (uppercase letters, digits, underscores)
 */
const arbEnvVarKey = fc
  .stringMatching(/^[A-Z][A-Z0-9_]*$/)
  .filter((s) => s.length >= 1 && s.length <= 30);

/**
 * Arbitrary: generates a random environment variable configuration array
 */
const arbEnvVars: fc.Arbitrary<
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
  // Ensure unique keys
  .map((vars) => {
    const seen = new Set<string>();
    return vars.filter((v) => {
      if (seen.has(v.key)) return false;
      seen.add(v.key);
      return true;
    });
  })
  .filter((vars) => vars.length >= 1);

/**
 * **Validates: Requirements 3.3**
 *
 * Property 6: Environment Variable Preservation
 *
 * For any ParsedManifest with envVars, generateTemplateJson should produce
 * a template.json where envVars contains all original environment variables.
 * Each variable's key, required, and secret properties should be preserved exactly.
 */
describe('Property 6: Environment Variable Preservation', () => {
  it('generateTemplateJson preserves all envVars with key, required, and secret intact', () => {
    fc.assert(
      fc.property(arbParsedManifest, arbEnvVars, (baseManifest, envVars) => {
        const manifest: ParsedManifest = {
          ...baseManifest,
          envVars,
        };

        const templateConfig = generateTemplateJson(manifest);

        // envVars should be present in the output
        expect(templateConfig.envVars).toBeDefined();
        expect(templateConfig.envVars!.length).toBe(envVars.length);

        // Each env var should have key, required, and secret preserved
        for (let i = 0; i < envVars.length; i++) {
          const original = envVars[i];
          const converted = templateConfig.envVars![i];

          expect(converted.key).toBe(original.key);
          expect(converted.required).toBe(original.required);
          expect(converted.secret).toBe(original.secret);
        }
      }),
      { numRuns: 100 },
    );
  });
});



/**
 * **Validates: Requirements 3.4, 3.5**
 *
 * Property 7: Runtime to projectType Mapping
 *
 * For any ParsedManifest with runtime 'python', the generated projectType
 * should be 'python-fastapi'. For any ParsedManifest with runtime 'node' or
 * 'typescript', the generated projectType should be 'nextjs'.
 */
describe('Property 7: Runtime to projectType Mapping', () => {
  it('runtime "python" maps to projectType "python-fastapi" in template.json', () => {
    fc.assert(
      fc.property(arbParsedManifest, (baseManifest) => {
        const manifest: ParsedManifest = { ...baseManifest, runtime: 'python' };
        const templateConfig = generateTemplateJson(manifest);
        expect(templateConfig.projectType).toBe('python-fastapi');
      }),
      { numRuns: 100 },
    );
  });

  it('runtime "node" maps to projectType "nextjs" in template.json', () => {
    fc.assert(
      fc.property(arbParsedManifest, (baseManifest) => {
        const manifest: ParsedManifest = { ...baseManifest, runtime: 'node' };
        const templateConfig = generateTemplateJson(manifest);
        expect(templateConfig.projectType).toBe('nextjs');
      }),
      { numRuns: 100 },
    );
  });

  it('runtime "typescript" maps to projectType "nextjs" in template.json', () => {
    fc.assert(
      fc.property(arbParsedManifest, (baseManifest) => {
        const manifest: ParsedManifest = { ...baseManifest, runtime: 'typescript' };
        const templateConfig = generateTemplateJson(manifest);
        expect(templateConfig.projectType).toBe('nextjs');
      }),
      { numRuns: 100 },
    );
  });

  it('runtime "python" maps to projectType "python-fastapi" in SKILL.md', () => {
    fc.assert(
      fc.property(arbParsedManifest, (baseManifest) => {
        const manifest: ParsedManifest = { ...baseManifest, runtime: 'python' };
        const skillMdContent = generateSkillMd(manifest);
        const { data } = matter(skillMdContent);
        expect(data.projectType).toBe('python-fastapi');
      }),
      { numRuns: 100 },
    );
  });

  it('runtime "node" or "typescript" maps to projectType "nextjs" in SKILL.md', () => {
    fc.assert(
      fc.property(
        arbParsedManifest,
        fc.constantFrom<'node' | 'typescript'>('node', 'typescript'),
        (baseManifest, runtime) => {
          const manifest: ParsedManifest = { ...baseManifest, runtime };
          const skillMdContent = generateSkillMd(manifest);
          const { data } = matter(skillMdContent);
          expect(data.projectType).toBe('nextjs');
        },
      ),
      { numRuns: 100 },
    );
  });
});

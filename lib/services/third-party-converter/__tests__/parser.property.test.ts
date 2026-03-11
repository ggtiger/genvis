import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import yaml from 'js-yaml';
import { parseOpenClawYaml, parseOpenClawJson } from '../parser';
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
  'unknown'
);

/**
 * Arbitrary: valid ParsedManifest object for round-trip testing
 */
const arbParsedManifest: fc.Arbitrary<ParsedManifest> = fc
  .record({
    name: arbKebabCase,
    description: arbSafeString,
    version: fc.option(arbSafeString, { nil: undefined }),
    author: fc.option(arbSafeString, { nil: undefined }),
    tags: fc.option(fc.array(arbSafeString, { minLength: 0, maxLength: 5 }), { nil: undefined }),
    runtime: fc.option(arbRuntime, { nil: undefined }),
  })
  .map((rec) => ({
    name: rec.name,
    description: rec.description,
    ...(rec.version !== undefined && { version: rec.version }),
    ...(rec.author !== undefined && { author: rec.author }),
    ...(rec.tags !== undefined && { tags: rec.tags }),
    ...(rec.runtime !== undefined && { runtime: rec.runtime }),
    sourcePlatform: 'openclaw' as const,
    sourceUrl: '',
  }));


/**
 * Helper: serialize a ParsedManifest to a plain object suitable for YAML/JSON serialization.
 * Only includes fields that the parser knows how to extract.
 */
function toSerializableObject(m: ParsedManifest): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    name: m.name,
    description: m.description,
  };
  if (m.version !== undefined) obj.version = m.version;
  if (m.author !== undefined) obj.author = m.author;
  if (m.tags !== undefined) obj.tags = m.tags;
  if (m.runtime !== undefined) obj.runtime = m.runtime;
  return obj;
}

/**
 * **Validates: Requirements 2.1, 2.2**
 *
 * Property 1: Parse Round-Trip Consistency
 *
 * For any valid ParsedManifest, serializing to OpenClaw YAML then parsing back
 * should produce an equivalent ParsedManifest. Same for JSON format.
 */
describe('Property 1: Parse Round-Trip Consistency', () => {
  it('YAML round-trip: serialize → parse produces equivalent manifest', () => {
    fc.assert(
      fc.property(arbParsedManifest, (manifest) => {
        const obj = toSerializableObject(manifest);
        const yamlStr = yaml.dump(obj);
        const parsed = parseOpenClawYaml(yamlStr);

        expect(parsed.name).toBe(manifest.name);
        expect(parsed.description).toBe(manifest.description);
        expect(parsed.sourcePlatform).toBe('openclaw');
        expect(parsed.sourceUrl).toBe('');

        if (manifest.version !== undefined) {
          expect(parsed.version).toBe(manifest.version);
        }
        if (manifest.author !== undefined) {
          expect(parsed.author).toBe(manifest.author);
        }
        if (manifest.tags !== undefined) {
          expect(parsed.tags).toEqual(manifest.tags);
        }
        if (manifest.runtime !== undefined) {
          expect(parsed.runtime).toBe(manifest.runtime);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('JSON round-trip: serialize → parse produces equivalent manifest', () => {
    fc.assert(
      fc.property(arbParsedManifest, (manifest) => {
        const obj = toSerializableObject(manifest);
        const jsonStr = JSON.stringify(obj);
        const parsed = parseOpenClawJson(jsonStr);

        expect(parsed.name).toBe(manifest.name);
        expect(parsed.description).toBe(manifest.description);
        expect(parsed.sourcePlatform).toBe('openclaw');
        expect(parsed.sourceUrl).toBe('');

        if (manifest.version !== undefined) {
          expect(parsed.version).toBe(manifest.version);
        }
        if (manifest.author !== undefined) {
          expect(parsed.author).toBe(manifest.author);
        }
        if (manifest.tags !== undefined) {
          expect(parsed.tags).toEqual(manifest.tags);
        }
        if (manifest.runtime !== undefined) {
          expect(parsed.runtime).toBe(manifest.runtime);
        }
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Validates: Requirements 2.3**
 *
 * Property 2: Missing Required Fields Validation
 *
 * For any config object that is missing name or description (or both),
 * the parse functions should throw an error whose message contains the
 * names of all missing fields.  Empty-string values are treated as missing.
 */
describe('Property 2: Missing Required Fields Validation', () => {
  /**
   * Arbitrary: a valid non-empty safe string (used for the field that IS present)
   */
  const arbPresentValue = fc
    .stringMatching(/^[a-zA-Z0-9 ]+$/)
    .filter((s) => s.length >= 1 && s.length <= 50);

  /**
   * Arbitrary: a "missing" representation – either the key is absent (undefined) or empty string
   */
  const arbMissing = fc.constantFrom(undefined, '');

  /**
   * Helper: build a config object with optional extra known fields
   */
  function buildConfig(
    nameVal: string | undefined,
    descVal: string | undefined,
    extras: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const obj: Record<string, unknown> = { ...extras };
    if (nameVal !== undefined) obj.name = nameVal;
    if (descVal !== undefined) obj.description = descVal;
    return obj;
  }

  // --- Case 1: name missing, description present ---
  it('YAML: missing name → error mentions "name"', () => {
    fc.assert(
      fc.property(arbMissing, arbPresentValue, (missingName, validDesc) => {
        const obj = buildConfig(missingName, validDesc);
        const yamlStr = yaml.dump(obj);
        expect(() => parseOpenClawYaml(yamlStr)).toThrowError(/name/);
      }),
      { numRuns: 100 }
    );
  });

  it('JSON: missing name → error mentions "name"', () => {
    fc.assert(
      fc.property(arbMissing, arbPresentValue, (missingName, validDesc) => {
        const obj = buildConfig(missingName, validDesc);
        const jsonStr = JSON.stringify(obj);
        expect(() => parseOpenClawJson(jsonStr)).toThrowError(/name/);
      }),
      { numRuns: 100 }
    );
  });

  // --- Case 2: description missing, name present ---
  it('YAML: missing description → error mentions "description"', () => {
    fc.assert(
      fc.property(arbPresentValue, arbMissing, (validName, missingDesc) => {
        const obj = buildConfig(validName, missingDesc);
        const yamlStr = yaml.dump(obj);
        expect(() => parseOpenClawYaml(yamlStr)).toThrowError(/description/);
      }),
      { numRuns: 100 }
    );
  });

  it('JSON: missing description → error mentions "description"', () => {
    fc.assert(
      fc.property(arbPresentValue, arbMissing, (validName, missingDesc) => {
        const obj = buildConfig(validName, missingDesc);
        const jsonStr = JSON.stringify(obj);
        expect(() => parseOpenClawJson(jsonStr)).toThrowError(/description/);
      }),
      { numRuns: 100 }
    );
  });

  // --- Case 3: both missing ---
  it('YAML: both missing → error mentions "name" and "description"', () => {
    fc.assert(
      fc.property(arbMissing, arbMissing, (missingName, missingDesc) => {
        const obj = buildConfig(missingName, missingDesc);
        const yamlStr = yaml.dump(obj);
        try {
          parseOpenClawYaml(yamlStr);
          // Should not reach here
          expect.unreachable('Expected parseOpenClawYaml to throw');
        } catch (err: unknown) {
          const msg = (err as Error).message;
          expect(msg).toMatch(/name/);
          expect(msg).toMatch(/description/);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('JSON: both missing → error mentions "name" and "description"', () => {
    fc.assert(
      fc.property(arbMissing, arbMissing, (missingName, missingDesc) => {
        const obj = buildConfig(missingName, missingDesc);
        const jsonStr = JSON.stringify(obj);
        try {
          parseOpenClawJson(jsonStr);
          expect.unreachable('Expected parseOpenClawJson to throw');
        } catch (err: unknown) {
          const msg = (err as Error).message;
          expect(msg).toMatch(/name/);
          expect(msg).toMatch(/description/);
        }
      }),
      { numRuns: 100 }
    );
  });

  // --- Case 4: empty string values treated as missing ---
  it('YAML: empty string name and description → error mentions both', () => {
    fc.assert(
      fc.property(
        fc.constant(''),
        fc.constant(''),
        (emptyName, emptyDesc) => {
          const obj = { name: emptyName, description: emptyDesc };
          const yamlStr = yaml.dump(obj);
          try {
            parseOpenClawYaml(yamlStr);
            expect.unreachable('Expected parseOpenClawYaml to throw');
          } catch (err: unknown) {
            const msg = (err as Error).message;
            expect(msg).toMatch(/name/);
            expect(msg).toMatch(/description/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('JSON: empty string name and description → error mentions both', () => {
    fc.assert(
      fc.property(
        fc.constant(''),
        fc.constant(''),
        (emptyName, emptyDesc) => {
          const obj = { name: emptyName, description: emptyDesc };
          const jsonStr = JSON.stringify(obj);
          try {
            parseOpenClawJson(jsonStr);
            expect.unreachable('Expected parseOpenClawJson to throw');
          } catch (err: unknown) {
            const msg = (err as Error).message;
            expect(msg).toMatch(/name/);
            expect(msg).toMatch(/description/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});



/**
 * **Validates: Requirements 2.4**
 *
 * Property 3: Unknown Fields Ignored
 *
 * For any config object that contains valid required fields (name, description)
 * PLUS additional unknown fields, the parsed result should:
 *   1. Only contain known fields in the ParsedManifest (unknown fields should NOT appear as direct properties)
 *   2. Known fields should have correct values matching the input
 *   3. rawConfig should preserve the unknown fields
 */
describe('Property 3: Unknown Fields Ignored', () => {
  /**
   * Set of all known field names that the parser extracts into ParsedManifest.
   * Unknown field keys must NOT collide with these.
   */
  const KNOWN_FIELDS = new Set([
    'name',
    'description',
    'displayName',
    'version',
    'author',
    'tags',
    'runtime',
    'entryPoint',
    'envVars',
    'category',
  ]);

  /**
   * All valid direct property keys of ParsedManifest (including internal ones set by parser).
   */
  const MANIFEST_KEYS = new Set([
    ...KNOWN_FIELDS,
    'sourcePlatform',
    'sourceUrl',
    'rawConfig',
    'codeFiles',
  ]);

  /**
   * Arbitrary: a random unknown field key that does NOT match any known field name.
   * Uses a prefix to guarantee no collision.
   */
  const arbUnknownKey = fc
    .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    .filter((s) => s.length >= 2 && s.length <= 20)
    .map((s) => `x_${s}`)
    .filter((s) => !KNOWN_FIELDS.has(s));

  /**
   * Arbitrary: a random value for unknown fields (string, number, boolean, or array of strings).
   */
  const arbUnknownValue: fc.Arbitrary<unknown> = fc.oneof(
    fc.stringMatching(/^[a-zA-Z0-9 ]+$/).filter((s) => s.length >= 1 && s.length <= 30),
    fc.integer({ min: -1000, max: 1000 }),
    fc.boolean(),
    fc.array(fc.stringMatching(/^[a-zA-Z0-9]+$/).filter((s) => s.length >= 1), {
      minLength: 0,
      maxLength: 3,
    })
  );

  /**
   * Arbitrary: a record of 1-5 unknown fields.
   */
  const arbUnknownFields = fc
    .array(fc.tuple(arbUnknownKey, arbUnknownValue), { minLength: 1, maxLength: 5 })
    .map((pairs) => Object.fromEntries(pairs));

  it('YAML: unknown fields do not appear as direct ParsedManifest properties', () => {
    fc.assert(
      fc.property(arbKebabCase, arbSafeString, arbUnknownFields, (name, description, unknowns) => {
        const obj: Record<string, unknown> = { name, description, ...unknowns };
        const yamlStr = yaml.dump(obj);
        const parsed = parseOpenClawYaml(yamlStr);

        // 1. Unknown fields should NOT appear as direct properties on parsed result
        for (const key of Object.keys(unknowns)) {
          expect(parsed).not.toHaveProperty(key);
        }

        // 2. All direct properties of parsed result should be known manifest keys
        for (const key of Object.keys(parsed)) {
          expect(MANIFEST_KEYS.has(key)).toBe(true);
        }

        // 3. Known fields should have correct values
        expect(parsed.name).toBe(name);
        expect(parsed.description).toBe(description);
        expect(parsed.sourcePlatform).toBe('openclaw');

        // 4. rawConfig should preserve the unknown fields
        expect(parsed.rawConfig).toBeDefined();
        for (const [key, value] of Object.entries(unknowns)) {
          expect(parsed.rawConfig![key]).toEqual(value);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('JSON: unknown fields do not appear as direct ParsedManifest properties', () => {
    fc.assert(
      fc.property(arbKebabCase, arbSafeString, arbUnknownFields, (name, description, unknowns) => {
        const obj: Record<string, unknown> = { name, description, ...unknowns };
        const jsonStr = JSON.stringify(obj);
        const parsed = parseOpenClawJson(jsonStr);

        // 1. Unknown fields should NOT appear as direct properties on parsed result
        for (const key of Object.keys(unknowns)) {
          expect(parsed).not.toHaveProperty(key);
        }

        // 2. All direct properties of parsed result should be known manifest keys
        for (const key of Object.keys(parsed)) {
          expect(MANIFEST_KEYS.has(key)).toBe(true);
        }

        // 3. Known fields should have correct values
        expect(parsed.name).toBe(name);
        expect(parsed.description).toBe(description);
        expect(parsed.sourcePlatform).toBe('openclaw');

        // 4. rawConfig should preserve the unknown fields
        expect(parsed.rawConfig).toBeDefined();
        for (const [key, value] of Object.entries(unknowns)) {
          expect(parsed.rawConfig![key]).toEqual(value);
        }
      }),
      { numRuns: 100 }
    );
  });
});

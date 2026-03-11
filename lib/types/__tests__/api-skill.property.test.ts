/**
 * Property-based tests for API skill metadata validation.
 *
 * **Feature: api-skill-plugin, Property 1: 元数据格式验证**
 * **Validates: Requirements 1.1, 1.3, 1.4**
 *
 * For any valid ApiEndpointsConfig object, parsing it to JSON and back SHALL
 * produce an equivalent object containing all required fields: skillName,
 * displayName, description, endpoints (each with path, method, description),
 * and optional auth (with authType and envVars).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateApiEndpointsConfig,
  type ApiEndpointsConfig,
  type ApiEndpoint,
  type ApiEndpointParam,
  type ApiEndpointResponseField,
} from '../api-skill';

// ========== Arbitraries ==========

/** Non-empty string for identifiers and descriptions */
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.length > 0);

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
  parameters: fc.option(fc.array(apiEndpointParamArb, { minLength: 0, maxLength: 5 }), { nil: undefined }),
  responseDescription: fc.option(nonEmptyStringArb, { nil: undefined }),
  responseFields: fc.option(fc.array(apiEndpointResponseFieldArb, { minLength: 0, maxLength: 5 }), { nil: undefined }),
});

/** Arbitrary for auth configuration */
const authConfigArb = fc.record({
  authType: authTypeArb,
  envVars: fc.option(fc.array(envVarNameArb, { minLength: 0, maxLength: 5 }), { nil: undefined }),
});

/** Arbitrary for a valid ApiEndpointsConfig */
const apiEndpointsConfigArb: fc.Arbitrary<ApiEndpointsConfig> = fc.record({
  skillName: nonEmptyStringArb,
  displayName: nonEmptyStringArb,
  description: nonEmptyStringArb,
  auth: fc.option(authConfigArb, { nil: undefined }),
  endpoints: fc.array(apiEndpointArb, { minLength: 1, maxLength: 5 }),
});

// ========== Tests ==========

/**
 * **Feature: api-skill-plugin, Property 1: 元数据格式验证**
 * **Validates: Requirements 1.1, 1.3, 1.4**
 */
describe('Property 1: 元数据格式验证 (Metadata format validation)', () => {
  it('any valid ApiEndpointsConfig survives JSON round-trip and passes validation', () => {
    fc.assert(
      fc.property(apiEndpointsConfigArb, (config) => {
        // Serialize to JSON and parse back
        const json = JSON.stringify(config);
        const parsed = JSON.parse(json);

        // Validate the parsed object
        const validated = validateApiEndpointsConfig(parsed);

        // Validation must succeed
        expect(validated).not.toBeNull();

        // The validated object must be deeply equal to the original
        expect(validated).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });

  it('all required top-level fields are preserved after JSON round-trip', () => {
    fc.assert(
      fc.property(apiEndpointsConfigArb, (config) => {
        const json = JSON.stringify(config);
        const parsed = JSON.parse(json);
        const validated = validateApiEndpointsConfig(parsed);

        expect(validated).not.toBeNull();

        // Requirement 1.4: top-level skill description field
        expect(validated!.skillName).toBe(config.skillName);
        expect(validated!.displayName).toBe(config.displayName);
        expect(validated!.description).toBe(config.description);

        // Requirement 1.1: endpoints array preserved
        expect(validated!.endpoints).toHaveLength(config.endpoints.length);
      }),
      { numRuns: 100 },
    );
  });

  it('each endpoint preserves path, method, description, and optional fields after round-trip', () => {
    fc.assert(
      fc.property(apiEndpointsConfigArb, (config) => {
        const json = JSON.stringify(config);
        const parsed = JSON.parse(json);
        const validated = validateApiEndpointsConfig(parsed);

        expect(validated).not.toBeNull();

        // Requirement 1.1: each endpoint has path, method, description
        for (let i = 0; i < config.endpoints.length; i++) {
          const original = config.endpoints[i];
          const result = validated!.endpoints[i];

          expect(result.path).toBe(original.path);
          expect(result.method).toBe(original.method);
          expect(result.description).toBe(original.description);

          // Parameters preserved if present
          if (original.parameters !== undefined) {
            expect(result.parameters).toEqual(original.parameters);
          }

          // Response fields preserved if present
          if (original.responseDescription !== undefined) {
            expect(result.responseDescription).toBe(original.responseDescription);
          }
          if (original.responseFields !== undefined) {
            expect(result.responseFields).toEqual(original.responseFields);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('auth configuration is preserved after JSON round-trip when present', () => {
    // Use a config that always has auth to specifically test Requirement 1.3
    const configWithAuthArb = fc.record({
      skillName: nonEmptyStringArb,
      displayName: nonEmptyStringArb,
      description: nonEmptyStringArb,
      auth: authConfigArb,
      endpoints: fc.array(apiEndpointArb, { minLength: 1, maxLength: 5 }),
    });

    fc.assert(
      fc.property(configWithAuthArb, (config) => {
        const json = JSON.stringify(config);
        const parsed = JSON.parse(json);
        const validated = validateApiEndpointsConfig(parsed);

        expect(validated).not.toBeNull();

        // Requirement 1.3: auth with authType and envVars preserved
        expect(validated!.auth).toBeDefined();
        expect(validated!.auth!.authType).toBe(config.auth.authType);

        if (config.auth.envVars !== undefined) {
          expect(validated!.auth!.envVars).toEqual(config.auth.envVars);
        }
      }),
      { numRuns: 100 },
    );
  });
});

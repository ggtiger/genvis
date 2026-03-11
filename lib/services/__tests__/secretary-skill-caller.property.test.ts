/**
 * Property-based tests for secretary-skill-caller service.
 *
 * **Feature: secretary-employee, Property 4: Skill API call with correct port resolution**
 * **Validates: Requirements 4.1, 4.5**
 *
 * Property 4: For any enabled skill with a running preview, when the
 * Secretary_Skill_Caller invokes an API endpoint, it SHALL resolve the skill's
 * port from the project's previewPort and construct the correct localhost URL
 * for the HTTP request.
 *
 * We verify:
 * 1. The callSkillApi function queries the projects table with the correct `skill-{skillName}` id
 * 2. The constructed URL is `http://localhost:{port}{path}` with the resolved port
 * 3. Query parameters are correctly appended
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// ========== Mock Setup ==========

// Shared mock state – mirrors the chain: db.select().from().where().limit()
const mockLimitFn = vi.fn();
const mockWhereFn = vi.fn().mockReturnValue({ limit: mockLimitFn });
const mockFromFn = vi.fn().mockReturnValue({ where: mockWhereFn });
const mockSelectFn = vi.fn().mockReturnValue({ from: mockFromFn });

vi.mock('@/lib/db/client', () => ({
  db: {
    select: (...args: any[]) => mockSelectFn(...args),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  projects: {
    previewPort: 'preview_port',
    id: 'id',
  },
}));

const mockEq = vi.fn((col: any, val: any) => ({ col, val }));
vi.mock('drizzle-orm', () => ({
  eq: (a: any, b: any) => mockEq(a, b),
}));

// Import after mocks
import { callSkillApi } from '../secretary-skill-caller';

// ========== Arbitraries ==========

/** Alphanumeric skill names (non-empty, reasonable length) */
const skillNameArb = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,29}$/);

/** Valid port numbers in the non-privileged range */
const portArb = fc.integer({ min: 1024, max: 65535 });

/** API path segments: non-empty alphanumeric with hyphens/underscores */
const pathSegmentArb = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,19}$/);

/** API paths starting with / and containing 1-5 segments */
const apiPathArb = fc
  .array(pathSegmentArb, { minLength: 1, maxLength: 5 })
  .map((segments) => '/' + segments.join('/'));

/** Query parameter key: non-empty alphanumeric */
const queryKeyArb = fc.stringMatching(/^[a-z][a-z0-9]{0,14}$/);

/** Query parameter value: non-empty alphanumeric (avoids encoding edge cases) */
const queryValueArb = fc.stringMatching(/^[a-z0-9]{1,20}$/);

/** A record of 0-5 query parameters */
const queryParamsArb = fc.dictionary(queryKeyArb, queryValueArb, {
  minKeys: 0,
  maxKeys: 5,
});

/** HTTP methods supported by the skill caller */
const httpMethodArb = fc.constantFrom(
  'GET' as const,
  'POST' as const,
  'PUT' as const,
  'DELETE' as const,
);

// ========== Helpers ==========

function setupDbMock(previewPort: number) {
  mockLimitFn.mockResolvedValue([{ previewPort }]);
}

function resetMockChain() {
  mockSelectFn.mockReturnValue({ from: mockFromFn });
  mockFromFn.mockReturnValue({ where: mockWhereFn });
  mockWhereFn.mockReturnValue({ limit: mockLimitFn });
}

function setupFetchMock() {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: vi.fn().mockResolvedValue({ success: true }),
  });
}

// ========== Tests ==========

describe('Property 4: Skill API call with correct port resolution', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    resetMockChain();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it(
    'should query the projects table with `skill-{skillName}` for any random skill name',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          skillNameArb,
          portArb,
          apiPathArb,
          async (skillName, port, apiPath) => {
            vi.clearAllMocks();
            resetMockChain();
            setupDbMock(port);
            setupFetchMock();

            await callSkillApi(skillName, 'GET', apiPath);

            // PROPERTY: eq() is called with the column and `skill-{skillName}`
            expect(mockEq).toHaveBeenCalledWith(
              expect.anything(),
              `skill-${skillName}`,
            );
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should construct URL as http://localhost:{port}{path} for any random port and path',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          skillNameArb,
          portArb,
          apiPathArb,
          httpMethodArb,
          async (skillName, port, apiPath, method) => {
            vi.clearAllMocks();
            resetMockChain();
            setupDbMock(port);
            setupFetchMock();

            await callSkillApi(skillName, method, apiPath);

            const expectedUrl = `http://localhost:${port}${apiPath}`;
            const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
              .calls[0][0] as string;

            // PROPERTY: The URL starts with the expected base
            expect(calledUrl).toBe(expectedUrl);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should correctly append query parameters to the URL for any random params',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          skillNameArb,
          portArb,
          apiPathArb,
          queryParamsArb,
          async (skillName, port, apiPath, queryParams) => {
            vi.clearAllMocks();
            resetMockChain();
            setupDbMock(port);
            setupFetchMock();

            await callSkillApi(skillName, 'GET', apiPath, undefined, queryParams);

            const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
              .calls[0][0] as string;

            const expectedBase = `http://localhost:${port}${apiPath}`;
            const keys = Object.keys(queryParams);

            if (keys.length === 0) {
              // PROPERTY: No query string when params are empty
              expect(calledUrl).toBe(expectedBase);
            } else {
              // PROPERTY: URL starts with the base
              expect(calledUrl.startsWith(expectedBase + '?')).toBe(true);

              // PROPERTY: Every key=value pair is present in the query string
              const urlObj = new URL(calledUrl);
              for (const [key, value] of Object.entries(queryParams)) {
                expect(urlObj.searchParams.get(key)).toBe(value);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});

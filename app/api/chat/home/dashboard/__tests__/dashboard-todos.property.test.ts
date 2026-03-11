/**
 * Property-based tests for Dashboard Todo Counts.
 *
 * **Feature: secretary-employee, Property 5: Dashboard todo counts match actual data**
 * **Validates: Requirements 7.2**
 *
 * Property 5: For any set of todos in the productivity-hub database,
 * the dashboard API's todo overview counts (pending, inProgress, completed)
 * SHALL equal the actual count of todos in each respective status.
 *
 * Strategy:
 * - Use fast-check to generate random arrays of todo objects with random status strings
 * - Mock callSkillApi to return the generated todos
 * - Mock employee status and notes APIs to return defaults
 * - Call the GET handler and verify:
 *   1. The sum of pending + inProgress + completed equals the total number of todos
 *   2. Each todo is counted in exactly one category
 *   3. The counts match the expected categorization rules:
 *      - 'completed' or 'done' → completed
 *      - 'in-progress', 'doing', 'active' → inProgress
 *      - everything else → pending
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// ========== Mock Setup ==========

// Mock secretary-skill-caller (used for todos, schedules, notes)
const mockCallSkillApi = vi.fn();
vi.mock('@/lib/services/secretary-skill-caller', () => ({
  callSkillApi: (...args: any[]) => mockCallSkillApi(...args),
}));

// Import after mocks
import { GET } from '../route';

// ========== Categorization Reference ==========

/**
 * Reference implementation of the categorization logic from route.ts.
 * Used to compute expected counts independently for property verification.
 *
 * The route normalizes status via: toLowerCase().replace(/[-_\s]/g, '')
 * Then categorizes:
 *   'completed' | 'done' → completed
 *   'inprogress' | 'doing' | 'active' → inProgress
 *   everything else → pending
 */
function expectedCategory(status: string): 'pending' | 'inProgress' | 'completed' {
  const normalized = (status || '').toLowerCase().replace(/[-_\s]/g, '');
  if (normalized === 'completed' || normalized === 'done') {
    return 'completed';
  } else if (normalized === 'inprogress' || normalized === 'doing' || normalized === 'active') {
    return 'inProgress';
  } else {
    return 'pending';
  }
}

/**
 * Compute expected counts from a list of todos using the reference categorization.
 */
function computeExpectedCounts(todos: Array<{ status: string }>) {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;

  for (const todo of todos) {
    const cat = expectedCategory(todo.status);
    if (cat === 'completed') completed++;
    else if (cat === 'inProgress') inProgress++;
    else pending++;
  }

  return { pending, inProgress, completed };
}

// ========== Arbitraries ==========

/** Known status strings that map to specific categories */
const completedStatusArb = fc.constantFrom('completed', 'done', 'Completed', 'DONE', 'Done');
const inProgressStatusArb = fc.constantFrom(
  'in-progress', 'doing', 'active',
  'In-Progress', 'IN_PROGRESS', 'in_progress',
  'Doing', 'DOING', 'Active', 'ACTIVE',
  'in progress',
);
const pendingStatusArb = fc.constantFrom(
  'pending', 'todo', 'Pending', 'TODO', 'new', 'blocked', 'waiting',
  'backlog', '', 'unknown',
);

/** Random arbitrary status string (will fall into pending) */
const randomStatusArb = fc.string({ minLength: 0, maxLength: 30 });

/** Any status: mix of known categories and random strings */
const todoStatusArb = fc.oneof(
  { weight: 3, arbitrary: completedStatusArb },
  { weight: 3, arbitrary: inProgressStatusArb },
  { weight: 3, arbitrary: pendingStatusArb },
  { weight: 1, arbitrary: randomStatusArb },
);

/** A single todo object with a random id, title, and status */
const todoArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  status: todoStatusArb,
});

/** An array of todos: 0 to 50 items */
const todoArrayArb = fc.array(todoArb, { minLength: 0, maxLength: 50 });

// ========== Helpers ==========

let originalFetch: typeof globalThis.fetch;

/**
 * Set up mocks so that callSkillApi returns the given todos for the /api/todos call,
 * and returns empty arrays for schedules and notes.
 * Also mock fetch for the employee status internal API call.
 */
function setupMocks(todos: Array<{ id: string; title: string; status: string }>) {
  mockCallSkillApi.mockImplementation(
    async (skillName: string, method: string, path: string) => {
      if (path === '/api/todos') {
        return { success: true, data: todos };
      }
      if (path === '/api/schedules') {
        return { success: true, data: [] };
      }
      if (path === '/api/notes') {
        return { success: true, data: [] };
      }
      return { success: false, error: 'Unknown path' };
    },
  );

  // Mock fetch for the employee status internal API call
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      success: true,
      data: [],
    }),
  });
}

// ========== Tests ==========

describe('Property 5: Dashboard todo counts match actual data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it(
    'the sum of pending + inProgress + completed should equal the total number of todos for any random set of todos',
    async () => {
      await fc.assert(
        fc.asyncProperty(todoArrayArb, async (todos) => {
          vi.clearAllMocks();
          setupMocks(todos);

          const response = await GET();
          const json = await response.json();

          expect(json.success).toBe(true);

          const { pending, inProgress, completed } = json.data.todos;

          // PROPERTY: Sum of all categories equals total number of todos
          expect(pending + inProgress + completed).toBe(todos.length);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'each todo should be counted in exactly one category matching the categorization rules for any random set of todos',
    async () => {
      await fc.assert(
        fc.asyncProperty(todoArrayArb, async (todos) => {
          vi.clearAllMocks();
          setupMocks(todos);

          const response = await GET();
          const json = await response.json();

          expect(json.success).toBe(true);

          const { pending, inProgress, completed } = json.data.todos;
          const expected = computeExpectedCounts(todos);

          // PROPERTY: Each category count matches the expected categorization
          expect(pending).toBe(expected.pending);
          expect(inProgress).toBe(expected.inProgress);
          expect(completed).toBe(expected.completed);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should return all zeros for an empty todo list',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.constant([] as { id: string; title: string; status: string }[]), async (todos) => {
          vi.clearAllMocks();
          setupMocks(todos);

          const response = await GET();
          const json = await response.json();

          expect(json.success).toBe(true);

          const { pending, inProgress, completed } = json.data.todos;

          // PROPERTY: Empty input yields all-zero counts
          expect(pending).toBe(0);
          expect(inProgress).toBe(0);
          expect(completed).toBe(0);
        }),
        { numRuns: 1 },
      );
    },
  );

  it(
    'should correctly count when all todos have the same status for any single status',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          todoStatusArb,
          fc.integer({ min: 1, max: 30 }),
          async (status, count) => {
            vi.clearAllMocks();

            // Generate `count` todos all with the same status
            const todos = Array.from({ length: count }, (_, i) => ({
              id: `todo-${i}`,
              title: `Todo ${i}`,
              status,
            }));

            setupMocks(todos);

            const response = await GET();
            const json = await response.json();

            expect(json.success).toBe(true);

            const { pending, inProgress, completed } = json.data.todos;
            const category = expectedCategory(status);

            // PROPERTY: All todos should be in exactly one category
            if (category === 'completed') {
              expect(completed).toBe(count);
              expect(pending).toBe(0);
              expect(inProgress).toBe(0);
            } else if (category === 'inProgress') {
              expect(inProgress).toBe(count);
              expect(pending).toBe(0);
              expect(completed).toBe(0);
            } else {
              expect(pending).toBe(count);
              expect(inProgress).toBe(0);
              expect(completed).toBe(0);
            }

            // PROPERTY: Sum still equals total
            expect(pending + inProgress + completed).toBe(count);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});

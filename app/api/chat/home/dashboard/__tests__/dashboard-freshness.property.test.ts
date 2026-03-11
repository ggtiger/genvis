/**
 * Property-based tests for Dashboard Data Freshness After Mutation.
 *
 * **Feature: secretary-employee, Property 7: Dashboard data freshness after mutation**
 * **Validates: Requirements 7.8**
 *
 * Property 7: For any mutation (e.g., creating a todo via the skill API),
 * a subsequent call to the dashboard API SHALL return data that reflects the mutation.
 *
 * Strategy:
 * - Use fast-check to generate random initial todo arrays and random new todos to add
 * - Mock callSkillApi to return different data on successive calls (before and after mutation)
 * - Call the GET handler with initial data, then simulate a mutation (add a new todo),
 *   then call the GET handler again
 * - Verify the second response reflects the mutation:
 *   1. The total todo count increases by the number of added todos
 *   2. The new todo items appear in the response
 *   3. The category counts are updated correctly
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

// ========== Reference Implementation ==========

/**
 * Reference implementation of the categorization logic from route.ts.
 * Used to compute expected counts independently for property verification.
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
const completedStatusArb = fc.constantFrom('completed', 'done', 'Completed', 'DONE');
const inProgressStatusArb = fc.constantFrom(
  'in-progress', 'doing', 'active',
  'In-Progress', 'in_progress',
);
const pendingStatusArb = fc.constantFrom(
  'pending', 'todo', 'Pending', 'TODO', 'new', 'blocked',
);

/** Any status: mix of known categories */
const todoStatusArb = fc.oneof(
  { weight: 3, arbitrary: completedStatusArb },
  { weight: 3, arbitrary: inProgressStatusArb },
  { weight: 4, arbitrary: pendingStatusArb },
);

/** A single todo object with a random id, title, and status */
const todoArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 80 }),
  status: todoStatusArb,
});

/** An array of initial todos: 0 to 20 items */
const initialTodoArrayArb = fc.array(todoArb, { minLength: 0, maxLength: 20 });

/** A single new todo to add (simulating a mutation) */
const newTodoArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 80 }),
  status: todoStatusArb,
});

/** An array of new todos to add: 1 to 5 items */
const newTodosArb = fc.array(newTodoArb, { minLength: 1, maxLength: 5 });

// ========== Helpers ==========

let originalFetch: typeof globalThis.fetch;

/**
 * Create a mock for callSkillApi that returns different todo data
 * based on a mutable reference. This simulates the data changing
 * between successive dashboard API calls.
 */
function setupMocksWithMutableTodos(currentTodosRef: { value: Array<{ id: string; title: string; status: string }> }) {
  mockCallSkillApi.mockImplementation(
    async (_skillName: string, _method: string, path: string) => {
      if (path === '/api/todos') {
        // Return the current snapshot of todos
        return { success: true, data: [...currentTodosRef.value] };
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

describe('Property 7: Dashboard data freshness after mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it(
    'total todo count should increase after adding new todos for any random initial set and new todos',
    async () => {
      await fc.assert(
        fc.asyncProperty(initialTodoArrayArb, newTodosArb, async (initialTodos, newTodos) => {
          vi.clearAllMocks();

          // Mutable reference to simulate data changing between calls
          const todosRef = { value: [...initialTodos] };
          setupMocksWithMutableTodos(todosRef);

          // First call: get dashboard with initial data
          const response1 = await GET();
          const json1 = await response1.json();
          expect(json1.success).toBe(true);

          const beforeCount = json1.data.todos.items.length;
          expect(beforeCount).toBe(initialTodos.length);

          // Simulate mutation: add new todos to the data source
          todosRef.value = [...initialTodos, ...newTodos];

          // Second call: get dashboard after mutation
          const response2 = await GET();
          const json2 = await response2.json();
          expect(json2.success).toBe(true);

          const afterCount = json2.data.todos.items.length;

          // PROPERTY: After adding newTodos, the total count should increase by exactly newTodos.length
          expect(afterCount).toBe(beforeCount + newTodos.length);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'new todo items should appear in the dashboard response after mutation for any random initial set and new todos',
    async () => {
      await fc.assert(
        fc.asyncProperty(initialTodoArrayArb, newTodosArb, async (initialTodos, newTodos) => {
          vi.clearAllMocks();

          const todosRef = { value: [...initialTodos] };
          setupMocksWithMutableTodos(todosRef);

          // First call: get dashboard with initial data
          const response1 = await GET();
          const json1 = await response1.json();
          expect(json1.success).toBe(true);

          const beforeIds = new Set(
            json1.data.todos.items.map((t: { id: string }) => t.id),
          );

          // Verify new todos are NOT in the initial response
          for (const newTodo of newTodos) {
            expect(beforeIds.has(newTodo.id)).toBe(false);
          }

          // Simulate mutation: add new todos
          todosRef.value = [...initialTodos, ...newTodos];

          // Second call: get dashboard after mutation
          const response2 = await GET();
          const json2 = await response2.json();
          expect(json2.success).toBe(true);

          const afterIds = new Set(
            json2.data.todos.items.map((t: { id: string }) => t.id),
          );

          // PROPERTY: Every newly added todo should appear in the post-mutation response
          for (const newTodo of newTodos) {
            expect(afterIds.has(newTodo.id)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'category counts should be updated correctly after mutation for any random initial set and new todos',
    async () => {
      await fc.assert(
        fc.asyncProperty(initialTodoArrayArb, newTodosArb, async (initialTodos, newTodos) => {
          vi.clearAllMocks();

          const todosRef = { value: [...initialTodos] };
          setupMocksWithMutableTodos(todosRef);

          // First call: get dashboard with initial data
          const response1 = await GET();
          const json1 = await response1.json();
          expect(json1.success).toBe(true);

          const beforeCounts = {
            pending: json1.data.todos.pending,
            inProgress: json1.data.todos.inProgress,
            completed: json1.data.todos.completed,
          };

          // Verify initial counts match expected
          const expectedBefore = computeExpectedCounts(initialTodos);
          expect(beforeCounts.pending).toBe(expectedBefore.pending);
          expect(beforeCounts.inProgress).toBe(expectedBefore.inProgress);
          expect(beforeCounts.completed).toBe(expectedBefore.completed);

          // Simulate mutation: add new todos
          const allTodosAfter = [...initialTodos, ...newTodos];
          todosRef.value = allTodosAfter;

          // Second call: get dashboard after mutation
          const response2 = await GET();
          const json2 = await response2.json();
          expect(json2.success).toBe(true);

          const afterCounts = {
            pending: json2.data.todos.pending,
            inProgress: json2.data.todos.inProgress,
            completed: json2.data.todos.completed,
          };

          // PROPERTY: Post-mutation counts should match the expected counts for the full set
          const expectedAfter = computeExpectedCounts(allTodosAfter);
          expect(afterCounts.pending).toBe(expectedAfter.pending);
          expect(afterCounts.inProgress).toBe(expectedAfter.inProgress);
          expect(afterCounts.completed).toBe(expectedAfter.completed);

          // PROPERTY: The difference in counts should match the new todos' categories
          const newTodoCounts = computeExpectedCounts(newTodos);
          expect(afterCounts.pending - beforeCounts.pending).toBe(newTodoCounts.pending);
          expect(afterCounts.inProgress - beforeCounts.inProgress).toBe(newTodoCounts.inProgress);
          expect(afterCounts.completed - beforeCounts.completed).toBe(newTodoCounts.completed);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'original todos should be preserved after mutation for any random initial set and new todos',
    async () => {
      await fc.assert(
        fc.asyncProperty(initialTodoArrayArb, newTodosArb, async (initialTodos, newTodos) => {
          vi.clearAllMocks();

          const todosRef = { value: [...initialTodos] };
          setupMocksWithMutableTodos(todosRef);

          // First call: get dashboard with initial data
          const response1 = await GET();
          const json1 = await response1.json();
          expect(json1.success).toBe(true);

          const beforeIds = new Set(
            json1.data.todos.items.map((t: { id: string }) => t.id),
          );

          // Simulate mutation: add new todos
          todosRef.value = [...initialTodos, ...newTodos];

          // Second call: get dashboard after mutation
          const response2 = await GET();
          const json2 = await response2.json();
          expect(json2.success).toBe(true);

          const afterIds = new Set(
            json2.data.todos.items.map((t: { id: string }) => t.id),
          );

          // PROPERTY: All original todos should still be present after mutation
          for (const id of beforeIds) {
            expect(afterIds.has(id)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    },
  );
});

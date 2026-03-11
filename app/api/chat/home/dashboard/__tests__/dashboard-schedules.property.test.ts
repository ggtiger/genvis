/**
 * Property-based tests for Dashboard Schedule Filtering.
 *
 * **Feature: secretary-employee, Property 6: Dashboard schedule filtering returns today only**
 * **Validates: Requirements 7.3**
 *
 * Property 6: For any set of schedules in the productivity-hub database,
 * the dashboard API's today schedule list SHALL contain only schedules
 * whose startTime falls within the current calendar day.
 *
 * Strategy:
 * - Use fast-check to generate random arrays of schedule objects with random startTime dates
 * - Include dates from today, yesterday, tomorrow, and random past/future dates
 * - Mock callSkillApi to return the generated schedules for /api/schedules
 * - Mock other APIs (todos, notes, employee status) to return defaults
 * - Call the GET handler and verify:
 *   1. All returned schedules have startTime within the current calendar day
 *   2. No schedule from a different day is included
 *   3. All schedules from today are included (no false negatives)
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
 * Reference implementation of the isToday check from route.ts.
 * A schedule's startTime falls within the current calendar day if
 * its year, month, and date match the current date.
 */
function isToday(startTime: string): boolean {
  const scheduleDate = new Date(startTime);
  const now = new Date();

  return (
    scheduleDate.getFullYear() === now.getFullYear() &&
    scheduleDate.getMonth() === now.getMonth() &&
    scheduleDate.getDate() === now.getDate()
  );
}

// ========== Arbitraries ==========

/**
 * Generate a date that falls within the current calendar day (today).
 * Picks a random hour (0-23), minute (0-59), second (0-59), millisecond (0-999).
 */
const todayDateArb = fc
  .record({
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
    ms: fc.integer({ min: 0, max: 999 }),
  })
  .map(({ hour, minute, second, ms }) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, second, ms);
    return d.toISOString();
  });

/**
 * Generate a date that is yesterday (offset -1 day from today).
 */
const yesterdayDateArb = fc
  .record({
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
  })
  .map(({ hour, minute, second }) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, hour, minute, second);
    return d.toISOString();
  });

/**
 * Generate a date that is tomorrow (offset +1 day from today).
 */
const tomorrowDateArb = fc
  .record({
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
  })
  .map(({ hour, minute, second }) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, minute, second);
    return d.toISOString();
  });

/**
 * Generate a random date from the past or future (2-365 days offset).
 */
const randomOtherDateArb = fc
  .record({
    dayOffset: fc.oneof(
      fc.integer({ min: 2, max: 365 }),
      fc.integer({ min: -365, max: -2 }),
    ),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
  })
  .map(({ dayOffset, hour, minute, second }) => {
    const now = new Date();
    const d = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + dayOffset,
      hour,
      minute,
      second,
    );
    return d.toISOString();
  });

/**
 * Generate a startTime that is NOT today (yesterday, tomorrow, or random other day).
 */
const notTodayDateArb = fc.oneof(yesterdayDateArb, tomorrowDateArb, randomOtherDateArb);

/**
 * Generate a startTime that could be any day (today or not today).
 */
const anyDateArb = fc.oneof(
  { weight: 3, arbitrary: todayDateArb },
  { weight: 1, arbitrary: yesterdayDateArb },
  { weight: 1, arbitrary: tomorrowDateArb },
  { weight: 1, arbitrary: randomOtherDateArb },
);

/** A single schedule object with a random id, title, and startTime */
const scheduleArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  startTime: anyDateArb,
});

/** A schedule that is guaranteed to be today */
const todayScheduleArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  startTime: todayDateArb,
});

/** A schedule that is guaranteed to NOT be today */
const notTodayScheduleArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  startTime: notTodayDateArb,
});

/** An array of schedules: 0 to 50 items with mixed dates */
const scheduleArrayArb = fc.array(scheduleArb, { minLength: 0, maxLength: 50 });

// ========== Helpers ==========

let originalFetch: typeof globalThis.fetch;

/**
 * Set up mocks so that callSkillApi returns the given schedules for /api/schedules,
 * and returns empty arrays for todos and notes.
 * Also mock fetch for the employee status internal API call.
 */
function setupMocks(schedules: Array<{ id: string; title: string; startTime: string }>) {
  mockCallSkillApi.mockImplementation(async (_skillName: string, _method: string, path: string) => {
    if (path === '/api/schedules') {
      return { success: true, data: schedules };
    }
    if (path === '/api/todos') {
      return { success: true, data: [] };
    }
    if (path === '/api/notes') {
      return { success: true, data: [] };
    }
    return { success: false, error: 'Unknown path' };
  });

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

describe('Property 6: Dashboard schedule filtering returns today only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it(
    'all returned schedules should have startTime within the current calendar day for any random set of schedules',
    async () => {
      await fc.assert(
        fc.asyncProperty(scheduleArrayArb, async (schedules) => {
          vi.clearAllMocks();
          setupMocks(schedules);

          const response = await GET();
          const json = await response.json();

          expect(json.success).toBe(true);

          const todaySchedules: Array<{ startTime: string }> = json.data.schedules.today;

          // PROPERTY: Every returned schedule must have a startTime that is today
          for (const schedule of todaySchedules) {
            expect(isToday(schedule.startTime)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'no schedule from a different day should be included in the today list for any random set of schedules',
    async () => {
      await fc.assert(
        fc.asyncProperty(scheduleArrayArb, async (schedules) => {
          vi.clearAllMocks();
          setupMocks(schedules);

          const response = await GET();
          const json = await response.json();

          expect(json.success).toBe(true);

          const todaySchedules: Array<{ id: string; startTime: string }> = json.data.schedules.today;
          const returnedIds = new Set(todaySchedules.map((s) => s.id));

          // PROPERTY: No schedule whose startTime is NOT today should appear in the result
          for (const schedule of schedules) {
            if (!isToday(schedule.startTime)) {
              expect(returnedIds.has(schedule.id)).toBe(false);
            }
          }
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'all schedules from today should be included (no false negatives) for any random set of schedules',
    async () => {
      await fc.assert(
        fc.asyncProperty(scheduleArrayArb, async (schedules) => {
          vi.clearAllMocks();
          setupMocks(schedules);

          const response = await GET();
          const json = await response.json();

          expect(json.success).toBe(true);

          const todaySchedules: Array<{ id: string }> = json.data.schedules.today;
          const returnedIds = new Set(todaySchedules.map((s) => s.id));

          // PROPERTY: Every schedule whose startTime IS today must appear in the result
          const expectedTodaySchedules = schedules.filter(
            (s) => s.startTime && isToday(s.startTime),
          );

          for (const schedule of expectedTodaySchedules) {
            expect(returnedIds.has(schedule.id)).toBe(true);
          }

          // Also verify the count matches exactly
          expect(todaySchedules.length).toBe(expectedTodaySchedules.length);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should return an empty today list when all schedules are from other days',
    async () => {
      const allNotTodayArb = fc.array(notTodayScheduleArb, { minLength: 1, maxLength: 30 });

      await fc.assert(
        fc.asyncProperty(allNotTodayArb, async (schedules) => {
          vi.clearAllMocks();
          setupMocks(schedules);

          const response = await GET();
          const json = await response.json();

          expect(json.success).toBe(true);

          // PROPERTY: When no schedule is from today, the today list must be empty
          expect(json.data.schedules.today).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should return all schedules when every schedule is from today',
    async () => {
      const allTodayArb = fc.array(todayScheduleArb, { minLength: 1, maxLength: 30 });

      await fc.assert(
        fc.asyncProperty(allTodayArb, async (schedules) => {
          vi.clearAllMocks();
          setupMocks(schedules);

          const response = await GET();
          const json = await response.json();

          expect(json.success).toBe(true);

          // PROPERTY: When all schedules are from today, all should be returned
          expect(json.data.schedules.today).toHaveLength(schedules.length);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should return an empty today list for an empty schedule array',
    async () => {
      setupMocks([]);

      const response = await GET();
      const json = await response.json();

      expect(json.success).toBe(true);

      // PROPERTY: Empty input yields empty today list
      expect(json.data.schedules.today).toHaveLength(0);
    },
  );
});

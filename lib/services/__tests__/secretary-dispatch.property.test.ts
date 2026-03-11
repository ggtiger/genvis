/**
 * Property-based tests for secretary-dispatch service.
 *
 * **Feature: secretary-employee, Property 3: Dispatch creates correctly assigned project**
 * **Validates: Requirements 3.1**
 *
 * Property 3: For any valid employee ID and instruction string, when the
 * Secretary_Dispatch_Service dispatches a task, the resulting project SHALL
 * have its employee_id set to the target employee's ID and autoStart SHALL
 * be triggered.
 *
 * We verify:
 * 1. The created project has employee_id set to the target employee's ID
 * 2. The auto-start (act API) is triggered with the correct instruction
 * 3. The DispatchResult contains the correct employeeId and employeeName
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// ========== Mock Setup ==========

// Mock getEmployeeById
const mockGetEmployeeById = vi.fn();
vi.mock('../employee-service', () => ({
  getEmployeeById: (...args: any[]) => mockGetEmployeeById(...args),
}));

// Mock createProject
const mockCreateProject = vi.fn();
vi.mock('../project', () => ({
  createProject: (...args: any[]) => mockCreateProject(...args),
}));

// Import after mocks
import { dispatchToEmployee } from '../secretary-dispatch';

// ========== Arbitraries ==========

/** Employee IDs: alphanumeric strings with hyphens, non-empty */
const employeeIdArb = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,29}$/);

/** Employee names: Chinese or English strings */
const employeeNameArb = fc.oneof(
  // Chinese names: generate an array of code points and join them
  fc
    .array(fc.integer({ min: 0x4e00, max: 0x9fff }), { minLength: 2, maxLength: 10 })
    .map((cps) => cps.map((cp) => String.fromCodePoint(cp)).join('')),
  // English names
  fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,19}$/),
);

/** Instruction strings: non-empty strings of reasonable length */
const instructionArb = fc.string({ minLength: 1, maxLength: 200 });

/** Employee modes: 'code' or 'work' (the modes that map directly to project modes) */
const employeeModeArb = fc.constantFrom('code' as const, 'work' as const);

/** Combined arbitrary for a valid employee + instruction scenario */
const dispatchScenarioArb = fc.record({
  employeeId: employeeIdArb,
  employeeName: employeeNameArb,
  instruction: instructionArb,
  mode: employeeModeArb,
});

// ========== Helpers ==========

function buildMockEmployee(id: string, name: string, mode: 'code' | 'work') {
  return {
    id,
    name,
    description: 'Test employee',
    category: 'engineering' as const,
    mode,
    system_prompt: 'You are a test employee',
    is_builtin: true,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };
}

// ========== Tests ==========

describe('Property 3: Dispatch creates correctly assigned project', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    // Default: fetch succeeds (fire and forget for auto-start)
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it(
    'should create a project with employee_id set to the target employee ID for any random employee and instruction',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          dispatchScenarioArb,
          async ({ employeeId, employeeName, instruction, mode }) => {
            vi.clearAllMocks();
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

            const employee = buildMockEmployee(employeeId, employeeName, mode);
            mockGetEmployeeById.mockResolvedValue(employee);

            const fakeProjectId = `dispatch-test-${Date.now()}`;
            mockCreateProject.mockResolvedValue({ id: fakeProjectId });

            await dispatchToEmployee(employeeId, instruction);

            // PROPERTY: createProject is called with employee_id matching the target employee
            expect(mockCreateProject).toHaveBeenCalledTimes(1);
            const createArgs = mockCreateProject.mock.calls[0][0];
            expect(createArgs.employee_id).toBe(employeeId);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should trigger auto-start (act API) with the correct instruction for any random instruction',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          dispatchScenarioArb,
          async ({ employeeId, employeeName, instruction, mode }) => {
            vi.clearAllMocks();
            const mockFetch = vi.fn().mockResolvedValue({ ok: true });
            globalThis.fetch = mockFetch;

            const employee = buildMockEmployee(employeeId, employeeName, mode);
            mockGetEmployeeById.mockResolvedValue(employee);

            const fakeProjectId = `dispatch-test-${Date.now()}`;
            mockCreateProject.mockResolvedValue({ id: fakeProjectId });

            await dispatchToEmployee(employeeId, instruction);

            // Wait for the fire-and-forget fetch to be called
            await vi.waitFor(() => {
              expect(mockFetch).toHaveBeenCalled();
            });

            // PROPERTY: fetch is called with the act API URL containing the project ID
            const fetchUrl = mockFetch.mock.calls[0][0] as string;
            expect(fetchUrl).toContain(`/api/chat/${fakeProjectId}/act`);

            // PROPERTY: The request body contains the instruction and isInitialPrompt=true
            const fetchOptions = mockFetch.mock.calls[0][1];
            const body = JSON.parse(fetchOptions.body);
            expect(body.instruction).toBe(instruction);
            expect(body.isInitialPrompt).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should return DispatchResult with correct employeeId and employeeName for any random employee',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          dispatchScenarioArb,
          async ({ employeeId, employeeName, instruction, mode }) => {
            vi.clearAllMocks();
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

            const employee = buildMockEmployee(employeeId, employeeName, mode);
            mockGetEmployeeById.mockResolvedValue(employee);

            const fakeProjectId = `dispatch-test-${Date.now()}`;
            mockCreateProject.mockResolvedValue({ id: fakeProjectId });

            const result = await dispatchToEmployee(employeeId, instruction);

            // PROPERTY: The result is successful
            expect(result.success).toBe(true);

            // PROPERTY: The result contains the correct employeeId
            expect(result.employeeId).toBe(employeeId);

            // PROPERTY: The result contains the correct employeeName
            expect(result.employeeName).toBe(employeeName);

            // PROPERTY: The result contains the projectId from createProject
            expect(result.projectId).toBe(fakeProjectId);

            // PROPERTY: No error in successful dispatch
            expect(result.error).toBeUndefined();
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});

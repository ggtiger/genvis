/**
 * Property-based tests for Secretary Chat API route.
 *
 * **Feature: secretary-employee, Property 1: Secretary chat round-trip**
 * **Validates: Requirements 2.3**
 *
 * Property 1: For any valid user message sent to the secretary chat API,
 * the API SHALL return a response containing a non-empty reply string
 * and a valid sessionId.
 *
 * Strategy:
 * - Mock all external dependencies (AI service, session, employee service, settings)
 * - Use fast-check to generate random user messages and random AI decisions
 * - For each AI decision type (direct_reply, dispatch, skill_call), verify
 *   the response always contains { success: true, data: { reply: non-empty, sessionId: non-empty } }
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { NextRequest } from 'next/server';

// ========== Mock Setup ==========

// Mock secretary-session
const mockLoadSession = vi.fn();
const mockSaveSession = vi.fn();
vi.mock('@/lib/services/secretary-session', () => ({
  loadSession: (...args: any[]) => mockLoadSession(...args),
  saveSession: (...args: any[]) => mockSaveSession(...args),
}));

// Mock secretary-dispatch
const mockDispatchToEmployee = vi.fn();
vi.mock('@/lib/services/secretary-dispatch', () => ({
  dispatchToEmployee: (...args: any[]) => mockDispatchToEmployee(...args),
}));

// Mock secretary-skill-caller
const mockCallSkillApi = vi.fn();
vi.mock('@/lib/services/secretary-skill-caller', () => ({
  callSkillApi: (...args: any[]) => mockCallSkillApi(...args),
}));

// Mock employee-service
const mockGetEmployeeById = vi.fn();
const mockGetAllEmployees = vi.fn();
vi.mock('@/lib/services/employee-service', () => ({
  getEmployeeById: (...args: any[]) => mockGetEmployeeById(...args),
  getAllEmployees: (...args: any[]) => mockGetAllEmployees(...args),
}));

// Mock settings
const mockLoadGlobalSettings = vi.fn();
vi.mock('@/lib/services/settings', () => ({
  loadGlobalSettings: (...args: any[]) => mockLoadGlobalSettings(...args),
}));

// Import after mocks
import { POST } from '../route';

// ========== Helpers ==========

const FAKE_SESSION_ID = 'test-session-id-12345';

function createMockSession() {
  return {
    id: FAKE_SESSION_ID,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createMockSecretary() {
  return {
    id: 'builtin-secretary',
    name: '秘书',
    description: '智能秘书',
    category: 'admin',
    mode: 'secretary',
    system_prompt: 'You are a secretary.',
    is_builtin: true,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };
}

function createMockSettings() {
  return {
    default_cli: 'claude',
    cli_settings: {
      claude: {
        apiKey: 'test-api-key-123',
        apiUrl: 'https://api.test.com',
        model: 'claude-sonnet-4-5-20250929',
      },
    },
  };
}

/**
 * Build a NextRequest with the given JSON body.
 */
function buildRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat/home/secretary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Build a mock Claude API response that returns the given AI decision JSON.
 */
function buildClaudeResponse(decision: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify(decision),
        },
      ],
    }),
    text: vi.fn().mockResolvedValue(JSON.stringify(decision)),
  };
}

// ========== Arbitraries ==========

/** Non-empty user messages: printable strings with at least 1 non-whitespace char */
const userMessageArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/** AI direct_reply decisions with random reply text */
const directReplyDecisionArb = fc
  .string({ minLength: 1, maxLength: 300 })
  .map((reply) => ({
    action: 'direct_reply' as const,
    reply,
  }));

/** AI dispatch decisions with random employee ID and instruction */
const dispatchDecisionArb = fc.record({
  action: fc.constant('dispatch' as const),
  employeeId: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
  instruction: fc.string({ minLength: 1, maxLength: 200 }),
});

/** AI skill_call decisions with random skill parameters */
const skillCallDecisionArb = fc.record({
  action: fc.constant('skill_call' as const),
  skillName: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
  method: fc.constantFrom('GET' as const, 'POST' as const),
  path: fc.stringMatching(/^\/api\/[a-z]{1,20}$/),
});

/** Combined arbitrary: any AI decision type */
const aiDecisionArb = fc.oneof(
  directReplyDecisionArb,
  dispatchDecisionArb,
  skillCallDecisionArb
);

// ========== Tests ==========

describe('Property 1: Secretary chat round-trip', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;

    // Default mock setup
    mockLoadSession.mockResolvedValue(createMockSession());
    mockSaveSession.mockResolvedValue(undefined);
    mockGetEmployeeById.mockResolvedValue(createMockSecretary());
    mockGetAllEmployees.mockResolvedValue([createMockSecretary()]);
    mockLoadGlobalSettings.mockResolvedValue(createMockSettings());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it(
    'should return success:true, non-empty reply, and valid sessionId for any user message with direct_reply AI decision',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          userMessageArb,
          directReplyDecisionArb,
          async (message, decision) => {
            vi.clearAllMocks();
            mockLoadSession.mockResolvedValue(createMockSession());
            mockSaveSession.mockResolvedValue(undefined);
            mockGetEmployeeById.mockResolvedValue(createMockSecretary());
            mockLoadGlobalSettings.mockResolvedValue(createMockSettings());

            // Mock fetch to return the AI decision
            globalThis.fetch = vi.fn().mockResolvedValue(buildClaudeResponse(decision));

            const request = buildRequest({ message });
            const response = await POST(request);
            const json = await response.json();

            // PROPERTY: Response indicates success
            expect(json.success).toBe(true);

            // PROPERTY: Response data contains a non-empty reply string
            expect(typeof json.data.reply).toBe('string');
            expect(json.data.reply.length).toBeGreaterThan(0);

            // PROPERTY: Response data contains a valid (non-empty) sessionId
            expect(typeof json.data.sessionId).toBe('string');
            expect(json.data.sessionId.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should return success:true, non-empty reply, and valid sessionId for any user message with dispatch AI decision',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          userMessageArb,
          dispatchDecisionArb,
          async (message, decision) => {
            vi.clearAllMocks();
            mockLoadSession.mockResolvedValue(createMockSession());
            mockSaveSession.mockResolvedValue(undefined);
            mockGetEmployeeById.mockResolvedValue(createMockSecretary());
            mockGetAllEmployees.mockResolvedValue([
              createMockSecretary(),
              {
                id: decision.employeeId,
                name: 'Test Employee',
                mode: 'work',
              },
            ]);
            mockLoadGlobalSettings.mockResolvedValue(createMockSettings());

            // Mock dispatch to succeed
            mockDispatchToEmployee.mockResolvedValue({
              success: true,
              projectId: 'proj-123',
              employeeId: decision.employeeId,
              employeeName: 'Test Employee',
            });

            // Mock fetch for Claude API call
            globalThis.fetch = vi.fn().mockResolvedValue(buildClaudeResponse(decision));

            const request = buildRequest({ message });
            const response = await POST(request);
            const json = await response.json();

            // PROPERTY: Response indicates success
            expect(json.success).toBe(true);

            // PROPERTY: Response data contains a non-empty reply string
            expect(typeof json.data.reply).toBe('string');
            expect(json.data.reply.length).toBeGreaterThan(0);

            // PROPERTY: Response data contains a valid (non-empty) sessionId
            expect(typeof json.data.sessionId).toBe('string');
            expect(json.data.sessionId.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should return success:true, non-empty reply, and valid sessionId for any user message with skill_call AI decision',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          userMessageArb,
          skillCallDecisionArb,
          async (message, decision) => {
            vi.clearAllMocks();
            mockLoadSession.mockResolvedValue(createMockSession());
            mockSaveSession.mockResolvedValue(undefined);
            mockGetEmployeeById.mockResolvedValue(createMockSecretary());
            mockLoadGlobalSettings.mockResolvedValue(createMockSettings());

            // Mock skill API call to succeed
            mockCallSkillApi.mockResolvedValue({
              success: true,
              data: { items: [{ id: 1, title: 'Test item' }] },
            });

            // Mock fetch for Claude API call
            globalThis.fetch = vi.fn().mockResolvedValue(buildClaudeResponse(decision));

            const request = buildRequest({ message });
            const response = await POST(request);
            const json = await response.json();

            // PROPERTY: Response indicates success
            expect(json.success).toBe(true);

            // PROPERTY: Response data contains a non-empty reply string
            expect(typeof json.data.reply).toBe('string');
            expect(json.data.reply.length).toBeGreaterThan(0);

            // PROPERTY: Response data contains a valid (non-empty) sessionId
            expect(typeof json.data.sessionId).toBe('string');
            expect(json.data.sessionId.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should return success:true, non-empty reply, and valid sessionId for any AI decision type',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          userMessageArb,
          aiDecisionArb,
          async (message, decision) => {
            vi.clearAllMocks();
            mockLoadSession.mockResolvedValue(createMockSession());
            mockSaveSession.mockResolvedValue(undefined);
            mockGetEmployeeById.mockResolvedValue(createMockSecretary());
            mockGetAllEmployees.mockResolvedValue([
              createMockSecretary(),
              {
                id: (decision as any).employeeId || 'test-emp',
                name: 'Test Employee',
                mode: 'work',
              },
            ]);
            mockLoadGlobalSettings.mockResolvedValue(createMockSettings());

            // Mock dispatch and skill call to succeed
            mockDispatchToEmployee.mockResolvedValue({
              success: true,
              projectId: 'proj-123',
              employeeId: (decision as any).employeeId || 'test-emp',
              employeeName: 'Test Employee',
            });
            mockCallSkillApi.mockResolvedValue({
              success: true,
              data: { result: 'ok' },
            });

            // Mock fetch for Claude API call
            globalThis.fetch = vi.fn().mockResolvedValue(buildClaudeResponse(decision));

            const request = buildRequest({ message });
            const response = await POST(request);
            const json = await response.json();

            // PROPERTY: Response indicates success
            expect(json.success).toBe(true);

            // PROPERTY: Response data contains a non-empty reply string
            expect(typeof json.data.reply).toBe('string');
            expect(json.data.reply.length).toBeGreaterThan(0);

            // PROPERTY: Response data contains a valid (non-empty) sessionId
            expect(typeof json.data.sessionId).toBe('string');
            expect(json.data.sessionId.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 },
      );
    },
  );
});

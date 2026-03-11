/**
 * Property-based tests for TerminalManager service.
 *
 * Uses fast-check to generate random sequences of create/destroy operations
 * and verifies session lifecycle invariants hold across all inputs.
 *
 * **Validates: Requirements 3.5, 6.4**
 * **Validates: Requirements 4.4**
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { TerminalManager, type PtySpawner } from '../terminal-manager';
import type { IPty } from 'node-pty';

/**
 * Creates a mock IPty object for property testing.
 */
function createMockPty(): IPty {
  return {
    pid: Math.floor(Math.random() * 100000) + 1000,
    cols: 80,
    rows: 24,
    process: 'mock-shell',
    handleFlowControl: false,
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    resize: vi.fn(),
    clear: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
}

/**
 * Creates a mock PtySpawner for property testing.
 */
function createMockSpawner(): PtySpawner {
  return () => createMockPty();
}

/**
 * Represents an operation in a session lifecycle sequence.
 * - 'create': Create a new session
 * - 'destroy': Destroy an existing session (by index into created sessions)
 */
type Operation =
  | { type: 'create'; cols: number; rows: number }
  | { type: 'destroy'; targetIndex: number };

describe('TerminalManager Property Tests', () => {
  let manager: TerminalManager;

  afterEach(() => {
    if (manager) {
      manager.destroyAllSessions();
    }
  });

  /**
   * Property 1: 会话生命周期不变量
   *
   * For any terminal session created by TerminalManager, calling
   * getSession(sessionId) SHALL return the session object until
   * destroySession(sessionId) is called, after which getSession(sessionId)
   * SHALL return undefined.
   *
   * **Validates: Requirements 3.5, 6.4**
   */
  it('Property 1: session lifecycle invariant - getSession returns session until destroyed, then returns undefined', () => {
    fc.assert(
      fc.property(
        // Generate a random sequence of create and destroy operations
        fc.array(
          fc.oneof(
            // Create operation with random cols/rows
            fc.record({
              type: fc.constant('create' as const),
              cols: fc.integer({ min: 1, max: 500 }),
              rows: fc.integer({ min: 1, max: 200 }),
            }),
            // Destroy operation targeting a random index among created sessions
            fc.record({
              type: fc.constant('destroy' as const),
              targetIndex: fc.nat({ max: 49 }),
            })
          ),
          { minLength: 1, maxLength: 50 }
        ),
        (operations) => {
          manager = new TerminalManager(createMockSpawner());

          // Track created session IDs and which have been destroyed
          const createdSessionIds: string[] = [];
          const destroyedSessionIds = new Set<string>();

          for (const op of operations) {
            if (op.type === 'create') {
              const session = manager.createSession({ cols: op.cols, rows: op.rows });

              // Invariant: newly created session must be retrievable
              const retrieved = manager.getSession(session.id);
              expect(retrieved).toBeDefined();
              expect(retrieved!.id).toBe(session.id);

              createdSessionIds.push(session.id);
            } else if (op.type === 'destroy') {
              // Only destroy if we have created sessions that haven't been destroyed yet
              const aliveSessionIds = createdSessionIds.filter(
                (id) => !destroyedSessionIds.has(id)
              );

              if (aliveSessionIds.length > 0) {
                const targetIdx = op.targetIndex % aliveSessionIds.length;
                const targetId = aliveSessionIds[targetIdx];

                // Invariant: session must be retrievable before destruction
                const beforeDestroy = manager.getSession(targetId);
                expect(beforeDestroy).toBeDefined();
                expect(beforeDestroy!.id).toBe(targetId);

                manager.destroySession(targetId);
                destroyedSessionIds.add(targetId);

                // Invariant: session must NOT be retrievable after destruction
                const afterDestroy = manager.getSession(targetId);
                expect(afterDestroy).toBeUndefined();
              }
            }

            // After each operation, verify the full invariant across all sessions:
            // - All alive sessions must be retrievable
            // - All destroyed sessions must return undefined
            for (const sessionId of createdSessionIds) {
              const result = manager.getSession(sessionId);
              if (destroyedSessionIds.has(sessionId)) {
                expect(result).toBeUndefined();
              } else {
                expect(result).toBeDefined();
                expect(result!.id).toBe(sessionId);
              }
            }
          }

          // Cleanup
          manager.destroyAllSessions();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Resize 维度一致性
   *
   * For any valid cols (1-500) and rows (1-200) values, calling
   * resizeSession(sessionId, cols, rows) SHALL update the session's
   * cols and rows to match the provided values exactly.
   *
   * **Validates: Requirements 4.4**
   */
  it('Property 2: resize dimension consistency - resizeSession updates cols and rows to match provided values exactly', () => {
    fc.assert(
      fc.property(
        // Generate random valid cols (1-500) and rows (1-200) for initial session creation
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 200 }),
        // Generate random valid cols and rows for the resize operation
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 200 }),
        (initialCols, initialRows, resizeCols, resizeRows) => {
          manager = new TerminalManager(createMockSpawner());

          // Create a session with initial dimensions
          const session = manager.createSession({ cols: initialCols, rows: initialRows });

          // Resize the session with new dimensions
          manager.resizeSession(session.id, resizeCols, resizeRows);

          // Retrieve the session and verify dimensions match exactly
          const updated = manager.getSession(session.id);
          expect(updated).toBeDefined();
          expect(updated!.cols).toBe(resizeCols);
          expect(updated!.rows).toBe(resizeRows);

          // Verify the mock PTY's resize was called with the correct values
          expect(session.pty.resize).toHaveBeenCalledWith(resizeCols, resizeRows);

          // Cleanup
          manager.destroyAllSessions();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2 (clamping): Resize 维度一致性 - out-of-range clamping
   *
   * For any cols and rows values (including out-of-range), calling
   * resizeSession SHALL clamp cols to [1, 500] and rows to [1, 200].
   *
   * **Validates: Requirements 4.4**
   */
  it('Property 2: resize dimension clamping - out-of-range values are clamped to valid ranges', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary integer cols and rows, including out-of-range values
        fc.integer({ min: -1000, max: 2000 }),
        fc.integer({ min: -1000, max: 2000 }),
        (cols, rows) => {
          manager = new TerminalManager(createMockSpawner());

          const session = manager.createSession({ cols: 80, rows: 24 });

          // Resize with potentially out-of-range values
          manager.resizeSession(session.id, cols, rows);

          // Compute expected clamped values
          const expectedCols = Math.max(1, Math.min(500, Math.round(cols)));
          const expectedRows = Math.max(1, Math.min(200, Math.round(rows)));

          // Verify session dimensions match the clamped values
          const updated = manager.getSession(session.id);
          expect(updated).toBeDefined();
          expect(updated!.cols).toBe(expectedCols);
          expect(updated!.rows).toBe(expectedRows);

          // Verify the PTY resize was called with clamped values
          expect(session.pty.resize).toHaveBeenCalledWith(expectedCols, expectedRows);

          // Cleanup
          manager.destroyAllSessions();
        }
      ),
      { numRuns: 100 }
    );
  });
});

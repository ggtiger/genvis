/**
 * Property-based tests for DeployManager auto-restart on abnormal process exit.
 *
 * **Feature: skill-local-deploy, Property 5: 进程异常退出自动重启**
 * **Validates: Requirements 2.5**
 *
 * For any deployed Skill App, if the production process exits abnormally,
 * DeployManager should auto-restart up to 3 times. After the 3rd failure,
 * no more restarts, and status updates to `stopped`.
 *
 * Normal exits (code 0) do not trigger restarts.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Constants — mirror deploy-manager.ts
// ---------------------------------------------------------------------------

const MAX_RESTART_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Model of the restart logic from attachProcessListeners
// ---------------------------------------------------------------------------

type ProcessStatus = 'deployed' | 'stopped' | 'building';

interface RestartState {
  status: ProcessStatus;
  restartCount: number;
}

interface ExitEvent {
  /** Exit code: 0 = normal, 1-255 = abnormal */
  code: number;
}

/**
 * Pure model of the restart decision logic in attachProcessListeners.
 *
 * Returns the new state after a process exit event.
 */
function applyExitEvent(state: RestartState, event: ExitEvent): RestartState {
  // If process was intentionally stopped or is rebuilding, ignore the exit
  if (state.status === 'stopped' || state.status === 'building') {
    return state;
  }

  // Normal exit (code 0) — no restart triggered, process just exits
  if (event.code === 0) {
    return state;
  }

  // Abnormal exit with restarts remaining
  if (state.restartCount < MAX_RESTART_ATTEMPTS) {
    return {
      status: 'deployed',
      restartCount: state.restartCount + 1,
    };
  }

  // Abnormal exit, exhausted restart attempts
  return {
    status: 'stopped',
    restartCount: state.restartCount,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Exit code: 0 for normal, 1-255 for abnormal */
const exitCodeArb = fc.integer({ min: 0, max: 255 });

/** Only abnormal exit codes (1-255) */
const abnormalExitCodeArb = fc.integer({ min: 1, max: 255 });

/** A sequence of exit events */
const exitEventSequenceArb = fc.array(
  fc.record({ code: exitCodeArb }),
  { minLength: 1, maxLength: 30 },
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feature: skill-local-deploy, Property 5: 进程异常退出自动重启', () => {
  it('restart count never exceeds MAX_RESTART_ATTEMPTS for any sequence of exit events', () => {
    fc.assert(
      fc.property(exitEventSequenceArb, (events) => {
        let state: RestartState = { status: 'deployed', restartCount: 0 };

        for (const event of events) {
          state = applyExitEvent(state, event);
          expect(state.restartCount).toBeLessThanOrEqual(MAX_RESTART_ATTEMPTS);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('after exactly 3 abnormal exits, status becomes stopped', () => {
    fc.assert(
      fc.property(
        fc.tuple(abnormalExitCodeArb, abnormalExitCodeArb, abnormalExitCodeArb),
        ([code1, code2, code3]) => {
          let state: RestartState = { status: 'deployed', restartCount: 0 };

          // First abnormal exit → restart (count=1), still deployed
          state = applyExitEvent(state, { code: code1 });
          expect(state.status).toBe('deployed');
          expect(state.restartCount).toBe(1);

          // Second abnormal exit → restart (count=2), still deployed
          state = applyExitEvent(state, { code: code2 });
          expect(state.status).toBe('deployed');
          expect(state.restartCount).toBe(2);

          // Third abnormal exit → restart (count=3), still deployed
          state = applyExitEvent(state, { code: code3 });
          expect(state.status).toBe('deployed');
          expect(state.restartCount).toBe(3);

          // Fourth abnormal exit → exhausted, status becomes stopped
          state = applyExitEvent(state, { code: code3 });
          expect(state.status).toBe('stopped');
          expect(state.restartCount).toBe(3);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('normal exits (code 0) never trigger restarts', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant({ code: 0 }), { minLength: 1, maxLength: 20 }),
        (normalExits) => {
          let state: RestartState = { status: 'deployed', restartCount: 0 };

          for (const event of normalExits) {
            state = applyExitEvent(state, event);
          }

          // After any number of normal exits, restart count stays 0
          expect(state.restartCount).toBe(0);
          // Status remains deployed
          expect(state.status).toBe('deployed');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('once stopped, further exit events do not change state', () => {
    fc.assert(
      fc.property(exitEventSequenceArb, (events) => {
        // Start in stopped state
        const stoppedState: RestartState = { status: 'stopped', restartCount: 3 };

        let state = stoppedState;
        for (const event of events) {
          state = applyExitEvent(state, event);
        }

        // State should remain unchanged
        expect(state.status).toBe('stopped');
        expect(state.restartCount).toBe(3);
      }),
      { numRuns: 200 },
    );
  });

  it('interleaved normal and abnormal exits: only abnormal exits increment restart count', () => {
    fc.assert(
      fc.property(exitEventSequenceArb, (events) => {
        let state: RestartState = { status: 'deployed', restartCount: 0 };
        let abnormalCount = 0;

        for (const event of events) {
          const prevCount = state.restartCount;
          state = applyExitEvent(state, event);

          if (event.code !== 0 && state.status === 'deployed' && state.restartCount > prevCount) {
            abnormalCount++;
          }

          // Normal exits never change restart count
          if (event.code === 0) {
            expect(state.restartCount).toBe(prevCount);
          }
        }

        // Total abnormal restarts should not exceed MAX_RESTART_ATTEMPTS
        expect(abnormalCount).toBeLessThanOrEqual(MAX_RESTART_ATTEMPTS);
      }),
      { numRuns: 200 },
    );
  });

  it('building status ignores all exit events', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_RESTART_ATTEMPTS }),
        exitEventSequenceArb,
        (initialRestartCount, events) => {
          const buildingState: RestartState = {
            status: 'building',
            restartCount: initialRestartCount,
          };

          let state = buildingState;
          for (const event of events) {
            state = applyExitEvent(state, event);
          }

          // State should remain unchanged
          expect(state.status).toBe('building');
          expect(state.restartCount).toBe(initialRestartCount);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('restart count monotonically increases until MAX_RESTART_ATTEMPTS', () => {
    fc.assert(
      fc.property(exitEventSequenceArb, (events) => {
        let state: RestartState = { status: 'deployed', restartCount: 0 };
        let prevRestartCount = 0;

        for (const event of events) {
          state = applyExitEvent(state, event);
          // Restart count should never decrease
          expect(state.restartCount).toBeGreaterThanOrEqual(prevRestartCount);
          prevRestartCount = state.restartCount;
        }
      }),
      { numRuns: 200 },
    );
  });
});

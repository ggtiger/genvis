/**
 * Property-based tests for secretary session service.
 *
 * **Feature: secretary-employee, Property 2: Secretary mode does not create projects**
 * **Validates: Requirements 5.1, 5.3**
 *
 * Property 2: For any sequence of messages sent through the secretary chat API,
 * the number of projects in the projects database SHALL remain unchanged
 * before and after the messages are processed.
 *
 * Since the secretary chat API doesn't exist yet, we test at the session service level:
 * for any sequence of random messages saved to the secretary session, the session
 * operations (load/save/clear) should never create project entries in the projects directory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import fs from 'fs/promises';
import path from 'path';
import {
  loadSession,
  saveSession,
  clearSession,
  type SecretarySession,
  type SecretaryMessage,
  type SecretaryAction,
} from '../secretary-session';

// Isolated test directories
const TEST_DATA_DIR = path.join(process.cwd(), 'data', '__test-pbt-secretary__');
const TEST_PROJECTS_DIR = path.join(TEST_DATA_DIR, 'projects');
const SESSION_FILE = path.join(TEST_DATA_DIR, 'secretary-session.json');

// ========== Arbitraries ==========

/** Arbitrary for SecretaryAction */
const secretaryActionArb: fc.Arbitrary<SecretaryAction> = fc.oneof(
  fc.record({
    type: fc.constant('dispatch' as const),
    employeeId: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    employeeName: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    projectId: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  }),
  fc.record({
    type: fc.constant('skill_call' as const),
    skillName: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    endpoint: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    result: fc.option(fc.jsonValue(), { nil: undefined }),
  }),
  fc.record({
    type: fc.constant('info' as const),
  }),
);

/** Arbitrary for SecretaryMessage */
const secretaryMessageArb: fc.Arbitrary<SecretaryMessage> = fc.record({
  role: fc.constantFrom('user' as const, 'assistant' as const),
  content: fc.string({ minLength: 0, maxLength: 500 }),
  actions: fc.option(fc.array(secretaryActionArb, { minLength: 0, maxLength: 3 }), { nil: undefined }),
  timestamp: fc.integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-01-01').getTime() }).map(ts => new Date(ts).toISOString()),
});

/** Arbitrary for an array of SecretaryMessages (a conversation) */
const messageSequenceArb: fc.Arbitrary<SecretaryMessage[]> = fc.array(secretaryMessageArb, {
  minLength: 0,
  maxLength: 20,
});

// ========== Helpers ==========

/**
 * List all entries in the projects directory.
 * Returns an empty array if the directory doesn't exist.
 */
async function listProjectEntries(): Promise<string[]> {
  try {
    const entries = await fs.readdir(TEST_PROJECTS_DIR);
    return entries;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// ========== Tests ==========

describe('Property 2: Secretary mode does not create projects', () => {
  beforeEach(async () => {
    // Point SETTINGS_DIR to our isolated test directory
    vi.stubEnv('SETTINGS_DIR', TEST_DATA_DIR);

    // Create the test directories
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
    await fs.mkdir(TEST_PROJECTS_DIR, { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    // Clean up test directory
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it(
    'saving any sequence of random messages to the secretary session should never create project entries',
    async () => {
      await fc.assert(
        fc.asyncProperty(messageSequenceArb, async (messages: SecretaryMessage[]) => {
          // Record projects before
          const projectsBefore = await listProjectEntries();

          // Build a session with the random messages
          const session: SecretarySession = {
            id: `pbt-session-${Date.now()}`,
            messages,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          // Execute session operations: save, load, and clear
          await saveSession(session);
          const loaded = await loadSession();

          // Verify loaded session is valid
          expect(loaded).toBeDefined();
          expect(loaded.id).toBe(session.id);
          expect(loaded.messages).toHaveLength(messages.length);

          // Clear the session
          await clearSession();

          // Verify session was cleared (load returns empty session)
          const afterClear = await loadSession();
          expect(afterClear.messages).toHaveLength(0);

          // Record projects after all session operations
          const projectsAfter = await listProjectEntries();

          // PROPERTY: The number of projects must remain unchanged
          expect(projectsAfter.length).toBe(projectsBefore.length);
          // PROPERTY: The exact same project entries must exist (no additions or removals)
          expect(projectsAfter.sort()).toEqual(projectsBefore.sort());
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'multiple save/load cycles with random messages should never create project entries',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(messageSequenceArb, { minLength: 1, maxLength: 5 }),
          async (messageSequences: SecretaryMessage[][]) => {
            // Record projects before
            const projectsBefore = await listProjectEntries();

            // Perform multiple save/load cycles with different message sequences
            for (const messages of messageSequences) {
              const session: SecretarySession = {
                id: `pbt-multi-${Date.now()}`,
                messages,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };

              await saveSession(session);
              await loadSession();
            }

            // Final clear
            await clearSession();

            // Record projects after
            const projectsAfter = await listProjectEntries();

            // PROPERTY: The number of projects must remain unchanged
            expect(projectsAfter.length).toBe(projectsBefore.length);
            expect(projectsAfter.sort()).toEqual(projectsBefore.sort());
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'session file operations should only affect the secretary-session.json file, not the projects directory',
    async () => {
      await fc.assert(
        fc.asyncProperty(secretaryMessageArb, async (message: SecretaryMessage) => {
          // Snapshot the projects directory before
          const projectsBefore = await listProjectEntries();

          // Create a session with a single random message and save it
          const session: SecretarySession = {
            id: `pbt-single-${Date.now()}`,
            messages: [message],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await saveSession(session);

          // Verify the session file exists
          const sessionFileExists = await fs.access(SESSION_FILE).then(() => true).catch(() => false);
          expect(sessionFileExists).toBe(true);

          // Verify the projects directory is untouched
          const projectsAfter = await listProjectEntries();
          expect(projectsAfter.length).toBe(projectsBefore.length);
          expect(projectsAfter.sort()).toEqual(projectsBefore.sort());

          // Clean up for next iteration
          await clearSession();
        }),
        { numRuns: 100 },
      );
    },
  );
});

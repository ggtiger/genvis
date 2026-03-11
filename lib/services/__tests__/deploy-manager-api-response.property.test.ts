/**
 * Property-based tests for deploy status API response completeness.
 *
 * **Feature: skill-local-deploy, Property 6: 部署状态 API 响应完整性**
 * **Validates: Requirements 3.2, 5.4**
 *
 * For any Skill App's deploy status query, the API response should contain
 * `status`, `port` (non-null when deployed), `buildTimestamp` (non-null after
 * build) fields. The Skill list API should return `deployStatus` for each
 * `hasApp=true` Skill.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { DeployStatus, DeployedProcess, DeployInfo } from '../deploy-manager';

// ---------------------------------------------------------------------------
// In-memory config store
// ---------------------------------------------------------------------------

let inMemoryConfig: Record<string, unknown> = {};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/config/paths', () => ({
  PROJECTS_DIR_ABSOLUTE: '/tmp/test-projects',
  getBuiltinNodePath: () => null,
  getBuiltinNpmCliPath: () => null,
  getBuiltinNodeDir: () => null,
}));

vi.mock('@/lib/config/constants', () => ({
  PREVIEW_CONFIG: { PORT_START: 4000, PORT_END: 5000 },
}));

vi.mock('@/lib/utils/ports', () => ({
  findAvailablePort: vi.fn(async () => 4000),
}));

vi.mock('@/lib/utils/python', () => ({
  detectPython: vi.fn(),
  createVirtualEnv: vi.fn(),
  getVenvPythonPath: vi.fn(),
}));

vi.mock('../skill-service', () => ({
  readSkillExtendedConfig: vi.fn(async () => ({ ...inMemoryConfig })),
  writeSkillExtendedConfig: vi.fn(async (config: Record<string, unknown>) => {
    inMemoryConfig = { ...config };
  }),
  getAllSkills: vi.fn(async () => []),
}));

// Import after mocks
const { deployManager } = await import('../deploy-manager');

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const VALID_STATUSES: DeployStatus[] = [
  'not_deployed', 'building', 'deployed', 'build_failed', 'stopped',
];

const deployStatusArb = fc.constantFrom<DeployStatus>(...VALID_STATUSES);

const skillNameArb = fc
  .string({ minLength: 2, maxLength: 20 })
  .filter((s) => /^[a-z][a-z0-9-]*[a-z0-9]$/.test(s) && !s.includes('--'));

const portArb = fc.integer({ min: 1024, max: 65535 });

const timestampArb = fc
  .integer({ min: 1577836800000, max: 1893456000000 })
  .map((ms) => new Date(ms).toISOString());

const optionalTimestampArb = fc.option(timestampArb, { nil: undefined });

/** Generate a DeployedProcess-like entry for the internal processes Map */
const deployedProcessArb = fc.tuple(
  deployStatusArb,
  portArb,
  optionalTimestampArb,
  fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 0, maxLength: 5 }),
).map(([status, port, buildTimestamp, logs]) => ({
  process: null,
  port,
  status,
  logs,
  buildLogs: [],
  startedAt: new Date(),
  buildTimestamp,
  restartCount: 0,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProcessesMap(): Map<string, DeployedProcess> {
  return (deployManager as any).processes;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feature: skill-local-deploy, Property 6: 部署状态 API 响应完整性', () => {
  beforeEach(() => {
    inMemoryConfig = {};
    getProcessesMap().clear();
  });

  it('getStatus() always returns an object with status, port, buildTimestamp, and logs fields', () => {
    fc.assert(
      fc.property(skillNameArb, deployedProcessArb, (name, proc) => {
        getProcessesMap().set(name, proc as any);

        const info = deployManager.getStatus(name);

        // Shape: all four required fields must exist as own properties
        expect(info).toHaveProperty('status');
        expect(info).toHaveProperty('port');
        expect(info).toHaveProperty('buildTimestamp');
        expect(info).toHaveProperty('logs');

        // Types
        expect(typeof info.status).toBe('string');
        expect(VALID_STATUSES).toContain(info.status);
        expect(Array.isArray(info.logs)).toBe(true);

        // port is number or null
        expect(info.port === null || typeof info.port === 'number').toBe(true);

        // buildTimestamp is string or null
        expect(info.buildTimestamp === null || typeof info.buildTimestamp === 'string').toBe(true);

        getProcessesMap().delete(name);
      }),
      { numRuns: 200 },
    );
  });

  it('getStatus() for unknown skill returns default response with correct shape', () => {
    fc.assert(
      fc.property(skillNameArb, (name) => {
        // Ensure the skill is NOT in the processes map
        getProcessesMap().delete(name);

        const info = deployManager.getStatus(name);

        expect(info).toHaveProperty('status');
        expect(info).toHaveProperty('port');
        expect(info).toHaveProperty('buildTimestamp');
        expect(info).toHaveProperty('logs');

        // Default values for unknown skill
        expect(info.status).toBe('not_deployed');
        expect(info.port).toBeNull();
        expect(info.buildTimestamp).toBeNull();
        expect(info.logs).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('when status is "deployed", port is non-null', () => {
    fc.assert(
      fc.property(skillNameArb, portArb, optionalTimestampArb, (name, port, ts) => {
        getProcessesMap().set(name, {
          process: null,
          port,
          status: 'deployed',
          logs: [],
          buildLogs: [],
          startedAt: new Date(),
          buildTimestamp: ts,
          restartCount: 0,
        } as any);

        const info = deployManager.getStatus(name);

        expect(info.status).toBe('deployed');
        expect(info.port).not.toBeNull();
        expect(typeof info.port).toBe('number');

        getProcessesMap().delete(name);
      }),
      { numRuns: 200 },
    );
  });

  it('when status is "deployed" or "build_failed", buildTimestamp is non-null if set in process', () => {
    fc.assert(
      fc.property(
        skillNameArb,
        portArb,
        fc.constantFrom<DeployStatus>('deployed', 'build_failed'),
        timestampArb,
        (name, port, status, ts) => {
          getProcessesMap().set(name, {
            process: null,
            port,
            status,
            logs: [],
            buildLogs: [],
            startedAt: new Date(),
            buildTimestamp: ts,
            restartCount: 0,
          } as any);

          const info = deployManager.getStatus(name);

          // When a buildTimestamp was recorded, it must be present in the response
          expect(info.buildTimestamp).not.toBeNull();
          expect(info.buildTimestamp).toBe(ts);

          getProcessesMap().delete(name);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('response status always matches the internal process status', () => {
    fc.assert(
      fc.property(skillNameArb, deployedProcessArb, (name, proc) => {
        getProcessesMap().set(name, proc as any);

        const info = deployManager.getStatus(name);
        expect(info.status).toBe(proc.status);

        getProcessesMap().delete(name);
      }),
      { numRuns: 200 },
    );
  });

  it('response logs is a copy (not a reference) of the internal logs array', () => {
    fc.assert(
      fc.property(
        skillNameArb,
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 10 }),
        (name, logs) => {
          getProcessesMap().set(name, {
            process: null,
            port: 4000,
            status: 'deployed',
            logs,
            buildLogs: [],
            startedAt: new Date(),
            restartCount: 0,
          } as any);

          const info = deployManager.getStatus(name);

          // Content should match
          expect(info.logs).toEqual(logs);

          // But it should be a different array reference (defensive copy)
          expect(info.logs).not.toBe(logs);

          getProcessesMap().delete(name);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('response port matches the internal process port for any status', () => {
    fc.assert(
      fc.property(skillNameArb, deployedProcessArb, (name, proc) => {
        getProcessesMap().set(name, proc as any);

        const info = deployManager.getStatus(name);
        expect(info.port).toBe(proc.port);

        getProcessesMap().delete(name);
      }),
      { numRuns: 200 },
    );
  });
});

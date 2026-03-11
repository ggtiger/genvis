/**
 * Property-based tests for port persistence round-trip consistency.
 *
 * **Feature: skill-local-deploy, Property 2: 端口持久化往返一致性**
 * **Validates: Requirements 2.2, 2.3**
 *
 * For any successfully deployed Skill App, the port number written to
 * Extended_Config (plugin-ex.json) via writeDeployedSkills and then read
 * back via readDeployedSkills should be identical. Additionally, the
 * in-memory processes Map port should match the persisted value.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { SkillDeployMeta, DeployStatus } from '../deploy-manager';

// ---------------------------------------------------------------------------
// In-memory store to replace real file I/O
// ---------------------------------------------------------------------------

let inMemoryConfig: Record<string, unknown> = {};

// Mock config/paths to avoid PROJECTS_DIR requirement
vi.mock('@/lib/config/paths', () => ({
  PROJECTS_DIR_ABSOLUTE: '/tmp/test-projects',
  getBuiltinNodePath: () => null,
  getBuiltinNpmCliPath: () => null,
  getBuiltinNodeDir: () => null,
}));

// Mock skill-service to use in-memory config store
vi.mock('../skill-service', () => ({
  readSkillExtendedConfig: vi.fn(async () => ({ ...inMemoryConfig })),
  writeSkillExtendedConfig: vi.fn(async (config: Record<string, unknown>) => {
    inMemoryConfig = { ...config };
  }),
  getAllSkills: vi.fn(async () => []),
}));

// Mock ports utility
vi.mock('@/lib/utils/ports', () => ({
  findAvailablePort: vi.fn(async () => 4000),
}));

// Mock python utilities
vi.mock('@/lib/utils/python', () => ({
  detectPython: vi.fn(),
  createVirtualEnv: vi.fn(),
  getVenvPythonPath: vi.fn(),
}));

// Import after mocks are set up
const mod = await import('../deploy-manager');
const { deployManager } = mod;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Valid skill names: non-empty alphanumeric + hyphens (realistic names) */
const skillNameArb = fc
  .string({ minLength: 2, maxLength: 30 })
  .filter((s) => /^[a-z][a-z0-9-]*[a-z0-9]$/.test(s) && !s.includes('--'));

/** Port numbers in the valid TCP range */
const portArb = fc.integer({ min: 1024, max: 65535 });

/** Deploy statuses that indicate a successful deployment (port is meaningful) */
const deployedStatusArb = fc.constantFrom<DeployStatus>('deployed', 'stopped');

/** Optional ISO timestamp — use integer-based generation to avoid invalid Date edge cases */
const timestampArb = fc.option(
  fc.integer({ min: 1577836800000, max: 1893456000000 }).map((ms) => new Date(ms).toISOString()),
  { nil: undefined },
);

/** A single SkillDeployMeta entry */
const deployMetaArb: fc.Arbitrary<SkillDeployMeta> = fc
  .tuple(portArb, deployedStatusArb, timestampArb)
  .map(([port, status, buildTimestamp]) => ({
    status,
    port,
    ...(buildTimestamp ? { buildTimestamp } : {}),
  }));

/** A record of skill name → SkillDeployMeta (1–5 entries, unique names) */
const deployedSkillsRecordArb: fc.Arbitrary<Record<string, SkillDeployMeta>> = fc
  .uniqueArray(fc.tuple(skillNameArb, deployMetaArb), {
    minLength: 1,
    maxLength: 5,
    selector: ([name]) => name,
  })
  .map((entries) => Object.fromEntries(entries));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feature: skill-local-deploy, Property 2: 端口持久化往返一致性', () => {
  beforeEach(() => {
    inMemoryConfig = {};
  });

  it('writeDeployedSkills → readDeployedSkills round-trips port correctly for a single skill', async () => {
    await fc.assert(
      fc.asyncProperty(skillNameArb, deployMetaArb, async (name, meta) => {
        inMemoryConfig = {};

        // Write
        const record: Record<string, SkillDeployMeta> = { [name]: meta };
        await deployManager.writeDeployedSkills(record);

        // Read back
        const readBack = await deployManager.readDeployedSkills();

        // Port must survive the round-trip
        expect(readBack[name]).toBeDefined();
        expect(readBack[name].port).toBe(meta.port);
        expect(readBack[name].status).toBe(meta.status);
        if (meta.buildTimestamp) {
          expect(readBack[name].buildTimestamp).toBe(meta.buildTimestamp);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('writeDeployedSkills → readDeployedSkills round-trips ports correctly for multiple skills', async () => {
    await fc.assert(
      fc.asyncProperty(deployedSkillsRecordArb, async (skills) => {
        inMemoryConfig = {};

        // Write all skills at once
        await deployManager.writeDeployedSkills(skills);

        // Read back
        const readBack = await deployManager.readDeployedSkills();

        // Every skill's port must match
        for (const [name, meta] of Object.entries(skills) as [string, SkillDeployMeta][]) {
          expect(readBack[name]).toBeDefined();
          expect(readBack[name].port).toBe(meta.port);
          expect(readBack[name].status).toBe(meta.status);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('overwriting deployedSkills preserves the latest port value', async () => {
    await fc.assert(
      fc.asyncProperty(skillNameArb, portArb, portArb, async (name, port1, port2) => {
        inMemoryConfig = {};

        // Write first port
        await deployManager.writeDeployedSkills({
          [name]: { status: 'deployed' as DeployStatus, port: port1 },
        });

        // Overwrite with second port
        await deployManager.writeDeployedSkills({
          [name]: { status: 'deployed' as DeployStatus, port: port2 },
        });

        // Read back — should have the latest port
        const readBack = await deployManager.readDeployedSkills();
        expect(readBack[name].port).toBe(port2);
      }),
      { numRuns: 200 },
    );
  });

  it('in-memory getStatus port matches persisted port after simulated deploy', async () => {
    await fc.assert(
      fc.asyncProperty(skillNameArb, portArb, deployedStatusArb, async (name, port, status) => {
        inMemoryConfig = {};

        // Simulate what deploy() does internally:
        // 1. Set in-memory process entry via the processes Map
        const processes = (deployManager as any).processes as Map<string, any>;
        processes.set(name, {
          process: null,
          port,
          status,
          logs: [],
          buildLogs: [],
          startedAt: new Date(),
          restartCount: 0,
        });

        // 2. Persist the same data (mirrors persistDeployStatus)
        const deployed = await deployManager.readDeployedSkills();
        deployed[name] = { status, port };
        await deployManager.writeDeployedSkills(deployed);

        // Read back from persistence
        const persisted = await deployManager.readDeployedSkills();

        // In-memory port (via getStatus) must match persisted port
        const inMemoryInfo = deployManager.getStatus(name);
        expect(inMemoryInfo.port).toBe(persisted[name].port);

        // Both must equal the original port
        expect(inMemoryInfo.port).toBe(port);
        expect(persisted[name].port).toBe(port);

        // Clean up
        processes.delete(name);
      }),
      { numRuns: 200 },
    );
  });

  it('port value is preserved exactly (no floating-point or serialization drift)', async () => {
    await fc.assert(
      fc.asyncProperty(
        skillNameArb,
        fc.integer({ min: 1, max: 65535 }),
        async (name, port) => {
          inMemoryConfig = {};

          await deployManager.writeDeployedSkills({
            [name]: { status: 'deployed' as DeployStatus, port },
          });

          const readBack = await deployManager.readDeployedSkills();

          // Strict equality — no type coercion
          expect(readBack[name].port).toStrictEqual(port);
          expect(typeof readBack[name].port).toBe('number');
        },
      ),
      { numRuns: 200 },
    );
  });
});

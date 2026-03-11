/**
 * Property-based tests for system startup auto-start filtering.
 *
 * **Feature: skill-local-deploy, Property 4: 系统启动时自动启动已部署 Skill**
 * **Validates: Requirements 4.1**
 *
 * For any Extended_Config `deployedSkills` configuration, on system startup
 * DeployManager should only start skills with status `deployed` or `stopped`,
 * NOT `build_failed` or `not_deployed`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { DeployStatus, SkillDeployMeta } from '../deploy-manager';

// ---------------------------------------------------------------------------
// Track which skills had processes spawned
// ---------------------------------------------------------------------------

interface SpawnCall {
  command: string;
  args: string[];
  cwd: string;
}

let spawnCalls: SpawnCall[] = [];

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
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
  findAvailablePort: vi.fn(async (start: number) => start),
}));

vi.mock('@/lib/utils/python', () => ({
  detectPython: vi.fn(async () => '/usr/bin/python3'),
  createVirtualEnv: vi.fn(async () => {}),
  getVenvPythonPath: vi.fn((projectPath: string) => `${projectPath}/.venv/bin/python`),
}));

let inMemoryConfig: Record<string, unknown> = {};

vi.mock('../skill-service', () => ({
  readSkillExtendedConfig: vi.fn(async () => ({ ...inMemoryConfig })),
  writeSkillExtendedConfig: vi.fn(async (config: Record<string, unknown>) => {
    inMemoryConfig = { ...config };
  }),
  getAllSkills: vi.fn(async () => []),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(
      (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
        spawnCalls.push({
          command,
          args: [...args],
          cwd: options?.cwd ?? '',
        });

        const fakeProcess = new EventEmitter() as ChildProcess;
        Object.defineProperty(fakeProcess, 'pid', { value: 99999, writable: true });
        fakeProcess.stdout = new EventEmitter() as any;
        fakeProcess.stderr = new EventEmitter() as any;
        fakeProcess.kill = vi.fn(() => true);

        // Build/install commands should close immediately; production start stays alive
        const isBuildOrInstall =
          args.includes('build') || args.includes('install');
        if (isBuildOrInstall) {
          process.nextTick(() => fakeProcess.emit('close', 0));
        }

        return fakeProcess;
      },
    ),
  };
});

vi.mock('tree-kill', () => ({
  default: vi.fn((_pid: number, _signal: string, cb?: (err?: Error) => void) => {
    if (cb) cb();
  }),
}));

// Mock fs.existsSync — pretend node_modules, .venv, .next all exist
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn((p: string) => {
        if (typeof p !== 'string') return false;
        if (p.endsWith('node_modules')) return true;
        if (p.endsWith('.venv')) return true;
        if (p.endsWith('.next')) return true;
        if (p.includes('.venv/bin/python') || p.includes('.venv\\Scripts\\python')) return true;
        if (p.endsWith('requirements.txt')) return false;
        return false;
      }),
    },
    existsSync: vi.fn((p: string) => {
      if (typeof p !== 'string') return false;
      if (p.endsWith('node_modules')) return true;
      if (p.endsWith('.venv')) return true;
      if (p.endsWith('.next')) return true;
      if (p.includes('.venv/bin/python') || p.includes('.venv\\Scripts\\python')) return true;
      if (p.endsWith('requirements.txt')) return false;
      return false;
    }),
  };
});

vi.mock('@/lib/services/stream-manager', () => ({
  streamManager: { broadcast: vi.fn() },
}));

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(() => undefined),
    })),
  })),
}));

// Import after all mocks
const { deployManager } = await import('../deploy-manager');
const { getAllSkills } = await import('../skill-service');

function resetManager() {
  (deployManager as any).processes.clear();
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ELIGIBLE_STATUSES: DeployStatus[] = ['deployed', 'stopped'];
const INELIGIBLE_STATUSES: DeployStatus[] = ['build_failed', 'not_deployed'];
const ALL_STATUSES: DeployStatus[] = [...ELIGIBLE_STATUSES, ...INELIGIBLE_STATUSES];

const deployStatusArb = fc.constantFrom<DeployStatus>(...ALL_STATUSES);

const skillNameArb = fc
  .string({ minLength: 2, maxLength: 15 })
  .filter((s) => /^[a-z][a-z0-9-]*[a-z0-9]$/.test(s) && !s.includes('--'));

const portArb = fc.integer({ min: 4000, max: 5000 });

/** Generate a single SkillDeployMeta entry with a random status */
const deployMetaArb = (status: fc.Arbitrary<DeployStatus>): fc.Arbitrary<SkillDeployMeta> =>
  fc.record({
    status,
    port: portArb,
    buildTimestamp: fc.constant('2025-01-15T10:30:00Z'),
  });

/**
 * Generate a deployedSkills config map with 1-6 skills, each with a random status.
 * Returns both the config and the list of skill names for setting up getAllSkills mock.
 */
const deployedSkillsConfigArb = fc
  .array(
    fc.tuple(skillNameArb, deployStatusArb, portArb),
    { minLength: 1, maxLength: 6 },
  )
  // Ensure unique skill names
  .map((entries) => {
    const seen = new Set<string>();
    return entries.filter(([name]) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  })
  .filter((entries) => entries.length > 0);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feature: skill-local-deploy, Property 4: 系统启动时自动启动已部署 Skill', () => {
  beforeEach(() => {
    spawnCalls = [];
    inMemoryConfig = {};
    resetManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('only skills with status deployed or stopped are started; build_failed and not_deployed are skipped', async () => {
    await fc.assert(
      fc.asyncProperty(deployedSkillsConfigArb, async (entries) => {
        spawnCalls = [];
        inMemoryConfig = {};
        resetManager();

        // Build the deployedSkills config
        const deployedSkills: Record<string, SkillDeployMeta> = {};
        for (const [name, status, port] of entries) {
          deployedSkills[name] = { status, port, buildTimestamp: '2025-01-15T10:30:00Z' };
        }
        inMemoryConfig = { deployedSkills };

        // Mock getAllSkills to return all skills as valid hasApp=true nextjs skills
        vi.mocked(getAllSkills).mockResolvedValue(
          entries.map(([name, , port]) => ({
            name,
            hasApp: true,
            projectType: 'nextjs',
            path: `/tmp/skills/${name}`,
          })) as any,
        );

        await deployManager.startAllDeployed();

        // Determine which skills should have been started
        const eligibleNames = entries
          .filter(([, status]) => status === 'deployed' || status === 'stopped')
          .map(([name]) => name);

        const ineligibleNames = entries
          .filter(([, status]) => status !== 'deployed' && status !== 'stopped')
          .map(([name]) => name);

        // Each eligible skill should have a production start spawn call
        // (npm start with --port and the skill's path as cwd)
        for (const name of eligibleNames) {
          const startCall = spawnCalls.find(
            (c) => c.cwd === `/tmp/skills/${name}` && c.args.includes('start'),
          );
          expect(startCall, `Expected skill "${name}" to be started`).toBeDefined();
        }

        // Ineligible skills should NOT have any spawn calls
        for (const name of ineligibleNames) {
          const startCall = spawnCalls.find(
            (c) => c.cwd === `/tmp/skills/${name}` && c.args.includes('start'),
          );
          expect(startCall, `Expected skill "${name}" NOT to be started`).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  }, 60_000);

  it('no processes are spawned when all skills have ineligible statuses', async () => {
    const ineligibleOnlyArb = fc
      .array(
        fc.tuple(skillNameArb, fc.constantFrom<DeployStatus>('build_failed', 'not_deployed'), portArb),
        { minLength: 1, maxLength: 5 },
      )
      .map((entries) => {
        const seen = new Set<string>();
        return entries.filter(([name]) => {
          if (seen.has(name)) return false;
          seen.add(name);
          return true;
        });
      })
      .filter((entries) => entries.length > 0);

    await fc.assert(
      fc.asyncProperty(ineligibleOnlyArb, async (entries) => {
        spawnCalls = [];
        inMemoryConfig = {};
        resetManager();

        const deployedSkills: Record<string, SkillDeployMeta> = {};
        for (const [name, status, port] of entries) {
          deployedSkills[name] = { status, port, buildTimestamp: '2025-01-15T10:30:00Z' };
        }
        inMemoryConfig = { deployedSkills };

        vi.mocked(getAllSkills).mockResolvedValue(
          entries.map(([name]) => ({
            name,
            hasApp: true,
            projectType: 'nextjs',
            path: `/tmp/skills/${name}`,
          })) as any,
        );

        await deployManager.startAllDeployed();

        // No production start calls should exist
        const startCalls = spawnCalls.filter((c) => c.args.includes('start'));
        expect(startCalls).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('all eligible skills are started when all have deployed or stopped status', async () => {
    const eligibleOnlyArb = fc
      .array(
        fc.tuple(skillNameArb, fc.constantFrom<DeployStatus>('deployed', 'stopped'), portArb),
        { minLength: 1, maxLength: 5 },
      )
      .map((entries) => {
        const seen = new Set<string>();
        return entries.filter(([name]) => {
          if (seen.has(name)) return false;
          seen.add(name);
          return true;
        });
      })
      .filter((entries) => entries.length > 0);

    await fc.assert(
      fc.asyncProperty(eligibleOnlyArb, async (entries) => {
        spawnCalls = [];
        inMemoryConfig = {};
        resetManager();

        const deployedSkills: Record<string, SkillDeployMeta> = {};
        for (const [name, status, port] of entries) {
          deployedSkills[name] = { status, port, buildTimestamp: '2025-01-15T10:30:00Z' };
        }
        inMemoryConfig = { deployedSkills };

        vi.mocked(getAllSkills).mockResolvedValue(
          entries.map(([name]) => ({
            name,
            hasApp: true,
            projectType: 'nextjs',
            path: `/tmp/skills/${name}`,
          })) as any,
        );

        await deployManager.startAllDeployed();

        // Every skill should have a production start call
        for (const [name] of entries) {
          const startCall = spawnCalls.find(
            (c) => c.cwd === `/tmp/skills/${name}` && c.args.includes('start'),
          );
          expect(startCall, `Expected skill "${name}" to be started`).toBeDefined();
        }

        // Number of start calls should equal number of eligible skills
        const startCalls = spawnCalls.filter((c) => c.args.includes('start'));
        expect(startCalls).toHaveLength(entries.length);
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('the count of started skills equals the count of eligible skills in the config', async () => {
    await fc.assert(
      fc.asyncProperty(deployedSkillsConfigArb, async (entries) => {
        spawnCalls = [];
        inMemoryConfig = {};
        resetManager();

        const deployedSkills: Record<string, SkillDeployMeta> = {};
        for (const [name, status, port] of entries) {
          deployedSkills[name] = { status, port, buildTimestamp: '2025-01-15T10:30:00Z' };
        }
        inMemoryConfig = { deployedSkills };

        vi.mocked(getAllSkills).mockResolvedValue(
          entries.map(([name]) => ({
            name,
            hasApp: true,
            projectType: 'nextjs',
            path: `/tmp/skills/${name}`,
          })) as any,
        );

        await deployManager.startAllDeployed();

        const expectedCount = entries.filter(
          ([, status]) => status === 'deployed' || status === 'stopped',
        ).length;

        const startCalls = spawnCalls.filter((c) => c.args.includes('start'));
        expect(startCalls).toHaveLength(expectedCount);
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('empty deployedSkills config results in no processes spawned', async () => {
    spawnCalls = [];
    inMemoryConfig = { deployedSkills: {} };
    resetManager();

    vi.mocked(getAllSkills).mockResolvedValue([]);

    await deployManager.startAllDeployed();

    expect(spawnCalls).toHaveLength(0);
  });
});

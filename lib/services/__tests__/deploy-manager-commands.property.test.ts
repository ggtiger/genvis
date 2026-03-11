/**
 * Property-based tests for build/start command matching by project type.
 *
 * **Feature: skill-local-deploy, Property 3: 构建命令与项目类型匹配**
 * **Validates: Requirements 1.1, 2.1, 2.4**
 *
 * For any Skill App, DeployManager should select the correct build and start
 * commands based on `projectType`:
 *   - `nextjs` uses `npm run build` + `npm start`, NODE_ENV=production
 *   - `python-fastapi` validates dependencies and uses `uvicorn`, NODE_ENV=production
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// Captured spawn calls for verification
// ---------------------------------------------------------------------------

interface SpawnCall {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
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

// Mock child_process.spawn to capture commands.
// For runCommand calls (build/install), emit 'close' with code 0 so the promise resolves.
// For production start calls, just stay alive.
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(
      (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
        spawnCalls.push({
          command,
          args: [...args],
          env: { ...(options?.env ?? {}) } as Record<string, string | undefined>,
          cwd: options?.cwd ?? '',
        });

        const fakeProcess = new EventEmitter() as ChildProcess;
        Object.defineProperty(fakeProcess, 'pid', { value: 99999, writable: true });
        fakeProcess.stdout = new EventEmitter() as any;
        fakeProcess.stderr = new EventEmitter() as any;
        fakeProcess.kill = vi.fn(() => true);

        // runCommand awaits 'close' — emit it on next tick for build/install commands
        // Production start commands (npm start, uvicorn) should NOT close
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

// Mock fs.existsSync — pretend node_modules, .venv, .next, and venv python all exist
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
        // venv python binary path: .venv/bin/python
        if (p.includes('.venv/bin/python') || p.includes('.venv\\Scripts\\python')) return true;
        // requirements.txt — pretend it doesn't exist to skip pip install
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

type ProjectType = 'nextjs' | 'python-fastapi';
const projectTypeArb = fc.constantFrom<ProjectType>('nextjs', 'python-fastapi');

const skillNameArb = fc
  .string({ minLength: 2, maxLength: 20 })
  .filter((s) => /^[a-z][a-z0-9-]*[a-z0-9]$/.test(s) && !s.includes('--'));

const portArb = fc.integer({ min: 3000, max: 9000 });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feature: skill-local-deploy, Property 3: 构建命令与项目类型匹配', () => {
  beforeEach(() => {
    spawnCalls = [];
    inMemoryConfig = {};
    resetManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('nextjs projects use "npm run build" for building and "npm start" for production', async () => {
    await fc.assert(
      fc.asyncProperty(skillNameArb, portArb, async (skillName, port) => {
        spawnCalls = [];
        inMemoryConfig = {};
        resetManager();

        vi.mocked(getAllSkills).mockResolvedValue([
          { name: skillName, hasApp: true, projectType: 'nextjs', path: `/tmp/skills/${skillName}` },
        ] as any);

        const { findAvailablePort } = await import('@/lib/utils/ports');
        vi.mocked(findAvailablePort).mockResolvedValue(port);

        await deployManager.deploy(skillName);

        // Build call: npm run build
        const buildCall = spawnCalls.find(
          (c) => c.args.includes('run') && c.args.includes('build'),
        );
        expect(buildCall).toBeDefined();
        expect(buildCall!.args).toContain('run');
        expect(buildCall!.args).toContain('build');

        // Start call: npm start -- --port {port}
        const startCall = spawnCalls.find(
          (c) => c.args.includes('start') && !c.args.includes('build'),
        );
        expect(startCall).toBeDefined();
        expect(startCall!.args).toContain('start');
        expect(startCall!.args).toContain('--port');
        expect(startCall!.args).toContain(String(port));
      }),
      { numRuns: 50 },
    );
  }, 30_000);

  it('python-fastapi projects use uvicorn with correct host and port', async () => {
    await fc.assert(
      fc.asyncProperty(skillNameArb, portArb, async (skillName, port) => {
        spawnCalls = [];
        inMemoryConfig = {};
        resetManager();

        vi.mocked(getAllSkills).mockResolvedValue([
          { name: skillName, hasApp: true, projectType: 'python-fastapi', path: `/tmp/skills/${skillName}` },
        ] as any);

        const { findAvailablePort } = await import('@/lib/utils/ports');
        vi.mocked(findAvailablePort).mockResolvedValue(port);

        await deployManager.deploy(skillName);

        // Python projects should NOT have npm run build
        const npmBuildCall = spawnCalls.find(
          (c) => c.args.includes('run') && c.args.includes('build'),
        );
        expect(npmBuildCall).toBeUndefined();

        // Should have a uvicorn start call
        const uvicornCall = spawnCalls.find(
          (c) => c.args.includes('-m') && c.args.includes('uvicorn'),
        );
        expect(uvicornCall).toBeDefined();
        expect(uvicornCall!.args).toContain('app.main:app');
        expect(uvicornCall!.args).toContain('--host');
        expect(uvicornCall!.args).toContain('0.0.0.0');
        expect(uvicornCall!.args).toContain('--port');
        expect(uvicornCall!.args).toContain(String(port));

        // Command should be the venv python path
        expect(uvicornCall!.command).toContain('.venv/bin/python');
      }),
      { numRuns: 50 },
    );
  }, 30_000);

  it('NODE_ENV is set to "production" for all project types', async () => {
    await fc.assert(
      fc.asyncProperty(skillNameArb, portArb, projectTypeArb, async (skillName, port, projectType) => {
        spawnCalls = [];
        inMemoryConfig = {};
        resetManager();

        vi.mocked(getAllSkills).mockResolvedValue([
          { name: skillName, hasApp: true, projectType, path: `/tmp/skills/${skillName}` },
        ] as any);

        const { findAvailablePort } = await import('@/lib/utils/ports');
        vi.mocked(findAvailablePort).mockResolvedValue(port);

        await deployManager.deploy(skillName);

        // The production start process should have NODE_ENV=production
        const startCall = projectType === 'nextjs'
          ? spawnCalls.find((c) => c.args.includes('start') && !c.args.includes('build'))
          : spawnCalls.find((c) => c.args.includes('uvicorn'));

        expect(startCall).toBeDefined();
        expect(startCall!.env.NODE_ENV).toBe('production');
      }),
      { numRuns: 50 },
    );
  }, 30_000);

  it('nextjs build command also runs with NODE_ENV=production', async () => {
    await fc.assert(
      fc.asyncProperty(skillNameArb, portArb, async (skillName, port) => {
        spawnCalls = [];
        inMemoryConfig = {};
        resetManager();

        vi.mocked(getAllSkills).mockResolvedValue([
          { name: skillName, hasApp: true, projectType: 'nextjs', path: `/tmp/skills/${skillName}` },
        ] as any);

        const { findAvailablePort } = await import('@/lib/utils/ports');
        vi.mocked(findAvailablePort).mockResolvedValue(port);

        await deployManager.deploy(skillName);

        const buildCall = spawnCalls.find(
          (c) => c.args.includes('run') && c.args.includes('build'),
        );
        expect(buildCall).toBeDefined();
        expect(buildCall!.env.NODE_ENV).toBe('production');
      }),
      { numRuns: 50 },
    );
  }, 30_000);

  it('command selection is deterministic: same projectType always produces same command pattern', async () => {
    await fc.assert(
      fc.asyncProperty(skillNameArb, portArb, projectTypeArb, async (skillName, port, projectType) => {
        const callSets: SpawnCall[][] = [];

        for (let i = 0; i < 2; i++) {
          spawnCalls = [];
          inMemoryConfig = {};
          resetManager();

          vi.mocked(getAllSkills).mockResolvedValue([
            { name: skillName, hasApp: true, projectType, path: `/tmp/skills/${skillName}` },
          ] as any);

          const { findAvailablePort } = await import('@/lib/utils/ports');
          vi.mocked(findAvailablePort).mockResolvedValue(port);

          await deployManager.deploy(skillName);
          callSets.push([...spawnCalls]);
        }

        expect(callSets[0].length).toBe(callSets[1].length);
        for (let i = 0; i < callSets[0].length; i++) {
          expect(callSets[0][i].command).toBe(callSets[1][i].command);
          expect(callSets[0][i].args).toEqual(callSets[1][i].args);
        }
      }),
      { numRuns: 30 },
    );
  }, 30_000);
});

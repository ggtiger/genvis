/**
 * Property-based tests for auto-start failure isolation.
 *
 * **Feature: skill-auto-start, Property 4: 自动启动失败不影响其余技能**
 * **Validates: Requirements 2.3**
 *
 * For any auto-start skill list, if some skills fail to start, the remaining skills
 * should still be attempted. The number of successfully started skills should equal
 * the total list length minus the number of failed skills.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import fs from 'fs/promises';
import path from 'path';

const TEST_USER = path.join(process.cwd(), 'data', '__test-auto-start-p4__');
const TEST_BUILTIN = path.join(process.cwd(), 'data', '__test-auto-start-p4-builtin__');
const PLUGIN_EX = path.join(TEST_USER, '.claude-plugin', 'plugin-ex.json');

vi.mock('@/lib/config/paths', () => ({
  SKILLS_DIR_ABSOLUTE: path.join(process.cwd(), 'data', '__test-auto-start-p4-builtin__'),
  USER_SKILLS_DIR_ABSOLUTE: path.join(process.cwd(), 'data', '__test-auto-start-p4__'),
}));

const mockPreviewStart = vi.fn<(id: string) => Promise<void>>();
vi.mock('@/lib/services/preview', () => ({
  previewManager: { start: (...a: [string]) => mockPreviewStart(...a) },
}));

const mockDbGet = vi.fn();
const mockDbInsert = vi.fn();
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ get: () => mockDbGet() }) }) }),
    insert: () => ({ values: (v: unknown) => mockDbInsert(v) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
}));
vi.mock('@/lib/db/schema', () => ({ projects: {} }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));
vi.mock('@/lib/services/api-skill-registry', () => ({
  rebuildRegistry: vi.fn().mockResolvedValue(undefined),
  registerSkill: vi.fn().mockResolvedValue(undefined),
  unregisterSkill: vi.fn().mockResolvedValue(undefined),
}));

const skillNameArb = fc.stringMatching(/^[a-z][a-z0-9\-]{2,19}$/).filter(
  (s) => !s.endsWith('-') && !s.includes('--'),
);
const skillListArb = fc.array(skillNameArb, { minLength: 1, maxLength: 10 })
  .map((arr) => [...new Set(arr)])
  .filter((arr) => arr.length >= 1);

function failingIndicesArb(len: number): fc.Arbitrary<Set<number>> {
  return fc.array(fc.boolean(), { minLength: len, maxLength: len }).map((bools) => {
    const s = new Set<number>();
    bools.forEach((fail, i) => { if (fail) s.add(i); });
    return s;
  });
}

async function createSkill(name: string): Promise<void> {
  const dir = path.join(TEST_USER, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'),
    '---\nname: ' + name + '\ndescription: Test\nprojectType: python-fastapi\n---\n# ' + name + '\n', 'utf-8');
  await fs.writeFile(path.join(dir, 'template.json'),
    JSON.stringify({ description: 'Test ' + name, projectType: 'python-fastapi' }), 'utf-8');
}

function setInit(v: boolean): void {
  const g = global as unknown as { skillsInitialized: boolean | undefined; skillsInitPromise: Promise<void> | undefined };
  g.skillsInitialized = v;
  g.skillsInitPromise = undefined;
}

async function cleanDirs(): Promise<void> {
  try {
    const entries = await fs.readdir(TEST_USER, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name !== '.claude-plugin') {
        await fs.rm(path.join(TEST_USER, e.name), { recursive: true, force: true });
      }
    }
  } catch { /* ok */ }
}

describe('Feature: skill-auto-start, Property 4: 自动启动失败不影响其余技能', () => {
  beforeEach(async () => {
    await fs.mkdir(path.dirname(PLUGIN_EX), { recursive: true });
    await fs.mkdir(TEST_BUILTIN, { recursive: true });
    await fs.writeFile(PLUGIN_EX, JSON.stringify({}, null, 2), 'utf-8');
    setInit(true);
  });

  afterEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    setInit(false);
    try { await fs.rm(TEST_USER, { recursive: true, force: true }); } catch {}
    try { await fs.rm(TEST_BUILTIN, { recursive: true, force: true }); } catch {}
  });

  it('partial failures do not prevent remaining skills from starting', () => {
    return fc.assert(
      fc.asyncProperty(
        skillListArb.chain((skills) => failingIndicesArb(skills.length).map((failSet) => ({ skills, failSet }))),
        async ({ skills, failSet }) => {
          vi.resetModules();
          setInit(true);
          await cleanDirs();

          const failing = new Set<string>();
          skills.forEach((n, i) => { if (failSet.has(i)) failing.add(n); });
          const success = skills.filter((s) => !failing.has(s));

          for (const n of skills) await createSkill(n);
          await fs.writeFile(PLUGIN_EX, JSON.stringify({ autoStartSkills: [...skills] }, null, 2), 'utf-8');

          mockDbGet.mockReturnValue(null);
          mockDbInsert.mockImplementation((vals: { id?: string }) => {
            const sn = (vals?.id || '').replace(/^skill-/, '');
            if (failing.has(sn)) throw new Error('Fail ' + sn);
          });
          mockPreviewStart.mockReset();
          mockPreviewStart.mockResolvedValue(undefined);

          const ce = vi.spyOn(console, 'error').mockImplementation(() => {});
          const cl = vi.spyOn(console, 'log').mockImplementation(() => {});
          try {
            const { autoStartMarkedSkills } = await import('../skill-service');
            await autoStartMarkedSkills();
            expect(mockPreviewStart).toHaveBeenCalledTimes(success.length);
            for (const n of success) expect(mockPreviewStart).toHaveBeenCalledWith('skill-' + n);
            expect(mockPreviewStart.mock.calls.length).toBe(skills.length - failing.size);
          } finally { ce.mockRestore(); cl.mockRestore(); }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('when all skills fail, no preview is started but function completes', () => {
    return fc.assert(
      fc.asyncProperty(skillListArb, async (skills) => {
        vi.resetModules();
        setInit(true);
        await cleanDirs();

        for (const n of skills) await createSkill(n);
        await fs.writeFile(PLUGIN_EX, JSON.stringify({ autoStartSkills: [...skills] }, null, 2), 'utf-8');

        mockDbGet.mockReturnValue(null);
        mockDbInsert.mockImplementation(() => { throw new Error('Fail'); });
        mockPreviewStart.mockReset();
        mockPreviewStart.mockResolvedValue(undefined);

        const ce = vi.spyOn(console, 'error').mockImplementation(() => {});
        const cl = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          const { autoStartMarkedSkills } = await import('../skill-service');
          await expect(autoStartMarkedSkills()).resolves.toBeUndefined();
          expect(mockPreviewStart).toHaveBeenCalledTimes(0);
        } finally { ce.mockRestore(); cl.mockRestore(); }
      }),
      { numRuns: 100 },
    );
  });

  it('when no skills fail, all previews are started', () => {
    return fc.assert(
      fc.asyncProperty(skillListArb, async (skills) => {
        vi.resetModules();
        setInit(true);
        await cleanDirs();

        for (const n of skills) await createSkill(n);
        await fs.writeFile(PLUGIN_EX, JSON.stringify({ autoStartSkills: [...skills] }, null, 2), 'utf-8');

        mockDbGet.mockReturnValue(null);
        mockDbInsert.mockReturnValue(undefined);
        mockPreviewStart.mockReset();
        mockPreviewStart.mockResolvedValue(undefined);

        const cl = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          const { autoStartMarkedSkills } = await import('../skill-service');
          await autoStartMarkedSkills();
          expect(mockPreviewStart).toHaveBeenCalledTimes(skills.length);
          for (const n of skills) expect(mockPreviewStart).toHaveBeenCalledWith('skill-' + n);
        } finally { cl.mockRestore(); }
      }),
      { numRuns: 100 },
    );
  });
});

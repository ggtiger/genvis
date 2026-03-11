/**
 * Unit tests for auto-fixer.ts - autoFix
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { TestReport, TestSuite, TestResult } from '../types';

// Mock skill-service
vi.mock('@/lib/services/skill-service', () => ({
  getSkillPathByName: vi.fn(),
}));

// Mock version-store
vi.mock('../version-store', () => ({
  createSnapshot: vi.fn(),
}));

// Mock test-runner
vi.mock('../test-runner', () => ({
  runFailed: vi.fn(),
}));

// Mock child_process.exec to prevent real LLM calls
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { autoFix, callLLMForFix, MAX_FIX_ATTEMPTS } from '../auto-fixer';
import { getSkillPathByName } from '@/lib/services/skill-service';
import { createSnapshot } from '../version-store';
import { runFailed } from '../test-runner';
import { exec } from 'child_process';

const mockedGetSkillPath = vi.mocked(getSkillPathByName);
const mockedCreateSnapshot = vi.mocked(createSnapshot);
const mockedRunFailed = vi.mocked(runFailed);
const mockedExec = vi.mocked(exec);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-fixer-test-'));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Helper: set up a skill directory with qa-tests.json and optional source files */
async function setupSkillDir(
  files: Record<string, string> = {},
): Promise<string> {
  const skillPath = path.join(tmpDir, 'test-skill');
  await fs.mkdir(skillPath, { recursive: true });
  mockedGetSkillPath.mockReturnValue(skillPath);

  // Write provided files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(skillPath, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  return skillPath;
}

/** Helper: create a test suite JSON file in the skill directory */
async function writeTestSuite(skillPath: string, suite: TestSuite): Promise<void> {
  const testsDir = path.join(skillPath, '__tests__');
  await fs.mkdir(testsDir, { recursive: true });
  await fs.writeFile(
    path.join(testsDir, 'qa-tests.json'),
    JSON.stringify(suite, null, 2),
    'utf-8',
  );
}

/** Helper: create a test report with failed cases */
function makeFailedReport(
  failedCaseIds: string[],
  passedCaseIds: string[] = [],
): TestReport {
  const results: TestResult[] = [
    ...failedCaseIds.map((id) => ({
      caseId: id,
      status: 'failed' as const,
      duration: 100,
      error: `Test ${id} failed: assertion error`,
    })),
    ...passedCaseIds.map((id) => ({
      caseId: id,
      status: 'passed' as const,
      duration: 50,
    })),
  ];

  return {
    skillName: 'test-skill',
    runAt: new Date().toISOString(),
    total: results.length,
    passed: passedCaseIds.length,
    failed: failedCaseIds.length,
    errors: 0,
    results,
  };
}

/** Helper: create a test report where all pass */
function makePassedReport(caseIds: string[]): TestReport {
  return {
    skillName: 'test-skill',
    runAt: new Date().toISOString(),
    total: caseIds.length,
    passed: caseIds.length,
    failed: 0,
    errors: 0,
    results: caseIds.map((id) => ({
      caseId: id,
      status: 'passed' as const,
      duration: 50,
    })),
  };
}

/** Helper: minimal test suite */
function makeSuite(caseIds: string[]): TestSuite {
  return {
    skillName: 'test-skill',
    generatedAt: new Date().toISOString(),
    cases: caseIds.map((id) => ({
      id,
      description: `Test ${id}`,
      type: 'script' as const,
      command: '/bin/echo',
      args: ['test'],
      expect: { exitCode: 0 },
    })),
  };
}

/**
 * Helper: mock exec to simulate LLM response.
 * The exec mock simulates the child_process.exec callback.
 */
function mockExecResponse(response: string): void {
  mockedExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: unknown) => {
    const cb = callback as (error: Error | null, stdout: string, stderr: string) => void;
    process.nextTick(() => cb(null, response, ''));
    return {
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn(),
    } as unknown as ReturnType<typeof exec>;
  });
}

/** Helper: mock exec to simulate LLM failure */
function mockExecError(errorMsg: string): void {
  mockedExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: unknown) => {
    const cb = callback as (error: Error | null, stdout: string, stderr: string) => void;
    process.nextTick(() => cb(new Error(errorMsg), '', ''));
    return {
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn(),
    } as unknown as ReturnType<typeof exec>;
  });
}

/** Helper: mock exec with sequence of responses/errors */
function mockExecSequence(responses: Array<{ response?: string; error?: string }>): void {
  let callIndex = 0;
  mockedExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: unknown) => {
    const cb = callback as (error: Error | null, stdout: string, stderr: string) => void;
    const current = responses[callIndex] || responses[responses.length - 1];
    callIndex++;
    process.nextTick(() => {
      if (current.error) {
        cb(new Error(current.error), '', '');
      } else {
        cb(null, current.response || '', '');
      }
    });
    return {
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn(),
    } as unknown as ReturnType<typeof exec>;
  });
}

describe('autoFix', () => {
  it('returns success immediately when no failed cases in report', async () => {
    const report = makePassedReport(['tc-001', 'tc-002']);

    const result = await autoFix('test-skill', report);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(0);
    expect(result.fixedCases).toEqual([]);
    expect(result.unfixedCases).toEqual([]);
    expect(mockedCreateSnapshot).not.toHaveBeenCalled();
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('returns error when skill not found', async () => {
    mockedGetSkillPath.mockReturnValue(null);
    const report = makeFailedReport(['tc-001']);

    const result = await autoFix('nonexistent', report);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(result.unfixedCases).toEqual(['tc-001']);
  });

  it('creates version snapshot before fixing', async () => {
    const skillPath = await setupSkillDir({
      'SKILL.md': '# Test Skill',
      'index.ts': 'export default {}',
    });
    const suite = makeSuite(['tc-001']);
    await writeTestSuite(skillPath, suite);

    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      reason: '自动修复前备份',
      files: ['index.ts'],
    });

    mockExecResponse('--- index.ts ---\nexport default { fixed: true }');
    mockedRunFailed.mockResolvedValue(makePassedReport(['tc-001']));

    const report = makeFailedReport(['tc-001']);
    await autoFix('test-skill', report);

    expect(mockedCreateSnapshot).toHaveBeenCalledWith('test-skill', '自动修复前备份');
  });

  it('fixes all cases on first attempt and returns success', async () => {
    const skillPath = await setupSkillDir({
      'SKILL.md': '# Test Skill',
      'index.ts': 'export default {}',
    });
    const suite = makeSuite(['tc-001', 'tc-002']);
    await writeTestSuite(skillPath, suite);

    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      reason: '自动修复前备份',
      files: ['index.ts'],
    });

    mockExecResponse('--- index.ts ---\nexport default { fixed: true }');
    mockedRunFailed.mockResolvedValue(makePassedReport(['tc-001', 'tc-002']));

    const report = makeFailedReport(['tc-001', 'tc-002']);
    const result = await autoFix('test-skill', report);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.fixedCases).toEqual(['tc-001', 'tc-002']);
    expect(result.unfixedCases).toEqual([]);
  });

  it('retries up to MAX_FIX_ATTEMPTS when fixes fail', async () => {
    const skillPath = await setupSkillDir({
      'SKILL.md': '# Test Skill',
      'index.ts': 'export default {}',
    });
    const suite = makeSuite(['tc-001']);
    await writeTestSuite(skillPath, suite);

    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      reason: '自动修复前备份',
      files: ['index.ts'],
    });

    mockExecResponse('--- index.ts ---\nexport default { attempt: true }');
    mockedRunFailed.mockResolvedValue(makeFailedReport(['tc-001']));

    const report = makeFailedReport(['tc-001']);
    const result = await autoFix('test-skill', report);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(MAX_FIX_ATTEMPTS);
    expect(result.unfixedCases).toEqual(['tc-001']);
    expect(mockedExec).toHaveBeenCalledTimes(MAX_FIX_ATTEMPTS);
    expect(mockedRunFailed).toHaveBeenCalledTimes(MAX_FIX_ATTEMPTS);
  });

  it('reports partially fixed cases after max retries', async () => {
    const skillPath = await setupSkillDir({
      'SKILL.md': '# Test Skill',
      'index.ts': 'export default {}',
    });
    const suite = makeSuite(['tc-001', 'tc-002', 'tc-003']);
    await writeTestSuite(skillPath, suite);

    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      reason: '自动修复前备份',
      files: ['index.ts'],
    });

    mockExecResponse('--- index.ts ---\nfixed');

    // First attempt: tc-001 fixed, tc-002 and tc-003 still fail
    mockedRunFailed
      .mockResolvedValueOnce(makeFailedReport(['tc-002', 'tc-003'], ['tc-001']))
      // Second attempt: tc-002 fixed, tc-003 still fails
      .mockResolvedValueOnce(makeFailedReport(['tc-003'], ['tc-002']))
      // Third attempt: tc-003 still fails
      .mockResolvedValueOnce(makeFailedReport(['tc-003']));

    const report = makeFailedReport(['tc-001', 'tc-002', 'tc-003']);
    const result = await autoFix('test-skill', report);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(MAX_FIX_ATTEMPTS);
    expect(result.fixedCases).toEqual(['tc-001', 'tc-002']);
    expect(result.unfixedCases).toEqual(['tc-003']);
  });

  it('handles LLM call failure gracefully and retries', async () => {
    const skillPath = await setupSkillDir({
      'SKILL.md': '# Test Skill',
      'index.ts': 'export default {}',
    });
    const suite = makeSuite(['tc-001']);
    await writeTestSuite(skillPath, suite);

    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      reason: '自动修复前备份',
      files: ['index.ts'],
    });

    // First two attempts fail, third succeeds
    mockExecSequence([
      { error: 'LLM timeout' },
      { error: 'LLM timeout' },
      { response: '--- index.ts ---\nfixed' },
    ]);

    mockedRunFailed.mockResolvedValue(makePassedReport(['tc-001']));

    const report = makeFailedReport(['tc-001']);
    const result = await autoFix('test-skill', report);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('returns error when snapshot creation fails', async () => {
    await setupSkillDir({ 'index.ts': 'code' });
    mockedCreateSnapshot.mockRejectedValue(new Error('Disk full'));

    const report = makeFailedReport(['tc-001']);
    const result = await autoFix('test-skill', report);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to create snapshot');
    expect(result.unfixedCases).toEqual(['tc-001']);
  });

  it('returns error when test suite cannot be loaded', async () => {
    // Set up skill dir WITHOUT qa-tests.json
    const skillPath = path.join(tmpDir, 'test-skill');
    await fs.mkdir(skillPath, { recursive: true });
    mockedGetSkillPath.mockReturnValue(skillPath);

    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      reason: '自动修复前备份',
      files: [],
    });

    const report = makeFailedReport(['tc-001']);
    const result = await autoFix('test-skill', report);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to load test suite');
  });

  it('MAX_FIX_ATTEMPTS is 3', () => {
    expect(MAX_FIX_ATTEMPTS).toBe(3);
  });
});

/**
 * Unit tests for pipeline.ts - runPipeline
 *
 * Tests the full QA pipeline flow: generate → test → fix → publish
 * and verifies deploy failure rollback behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TestSuite, TestReport, FixResult } from '../types';
import type { DeployInfo } from '../../deploy-manager';

// Mock all dependencies
vi.mock('../test-generator', () => ({
  generateTestCases: vi.fn(),
}));

vi.mock('../test-runner', () => ({
  runTests: vi.fn(),
}));

vi.mock('../auto-fixer', () => ({
  autoFix: vi.fn(),
}));

vi.mock('../version-store', () => ({
  createSnapshot: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock('../../deploy-manager', () => ({
  deployManager: {
    redeploy: vi.fn(),
  },
}));

import { runPipeline, getPipelineState, getStatus, getReport } from '../pipeline';
import { generateTestCases } from '../test-generator';
import { runTests } from '../test-runner';
import { autoFix } from '../auto-fixer';
import { createSnapshot, rollback } from '../version-store';
import { deployManager } from '../../deploy-manager';

const mockedGenerate = vi.mocked(generateTestCases);
const mockedRunTests = vi.mocked(runTests);
const mockedAutoFix = vi.mocked(autoFix);
const mockedCreateSnapshot = vi.mocked(createSnapshot);
const mockedRollback = vi.mocked(rollback);
const mockedRedeploy = vi.mocked(deployManager.redeploy);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuite(skillName: string): TestSuite {
  return {
    skillName,
    generatedAt: new Date().toISOString(),
    cases: [
      { id: 'tc-001', description: 'test', type: 'http', method: 'GET', path: '/api/test', expect: { status: 200 } },
    ],
  };
}

function makePassingReport(skillName: string): TestReport {
  return {
    skillName,
    runAt: new Date().toISOString(),
    total: 1,
    passed: 1,
    failed: 0,
    errors: 0,
    results: [{ caseId: 'tc-001', status: 'passed', duration: 50 }],
  };
}

function makeFailingReport(skillName: string): TestReport {
  return {
    skillName,
    runAt: new Date().toISOString(),
    total: 1,
    passed: 0,
    failed: 1,
    errors: 0,
    results: [{ caseId: 'tc-001', status: 'failed', duration: 50, error: 'Expected 200 got 500' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runPipeline', () => {
  it('should complete successfully when all tests pass (no fix needed)', async () => {
    const skillName = 'test-skill';
    const suite = makeSuite(skillName);
    const report = makePassingReport(skillName);

    mockedGenerate.mockResolvedValue(suite);
    mockedRunTests.mockResolvedValue(report);
    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      reason: '发布',
      files: ['SKILL.md'],
    });
    mockedRedeploy.mockResolvedValue({
      status: 'deployed',
      port: 3100,
      buildTimestamp: null,
      logs: [],
    });

    await runPipeline(skillName);

    const state = getPipelineState(skillName);
    expect(state).toBeDefined();
    expect(state!.status).toBe('completed');
    expect(state!.publishedVersion).toBe(1);
    expect(state!.completedAt).toBeDefined();

    // Verify publish snapshot was created with reason "发布"
    expect(mockedCreateSnapshot).toHaveBeenCalledWith(skillName, '发布');
    // Verify redeploy was called
    expect(mockedRedeploy).toHaveBeenCalledWith(skillName);
    // autoFix should NOT have been called
    expect(mockedAutoFix).not.toHaveBeenCalled();
  });

  it('should fix and publish when tests fail but autoFix succeeds', async () => {
    const skillName = 'fixable-skill';
    const suite = makeSuite(skillName);
    const failingReport = makeFailingReport(skillName);
    const passingReport = makePassingReport(skillName);

    mockedGenerate.mockResolvedValue(suite);
    // First run fails, second run (after fix) passes
    mockedRunTests
      .mockResolvedValueOnce(failingReport)
      .mockResolvedValueOnce(passingReport);

    const fixResult: FixResult = {
      success: true,
      attempts: 1,
      fixedCases: ['tc-001'],
      unfixedCases: [],
    };
    mockedAutoFix.mockResolvedValue(fixResult);

    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 2,
      createdAt: new Date().toISOString(),
      reason: '发布',
      files: ['SKILL.md'],
    });
    mockedRedeploy.mockResolvedValue({
      status: 'deployed',
      port: 3100,
      buildTimestamp: null,
      logs: [],
    });

    await runPipeline(skillName);

    const state = getPipelineState(skillName);
    expect(state!.status).toBe('completed');
    expect(state!.fixResult).toEqual(fixResult);
    expect(state!.publishedVersion).toBe(2);
    expect(mockedAutoFix).toHaveBeenCalledWith(skillName, failingReport);
  });

  it('should fail when autoFix cannot fix all tests', async () => {
    const skillName = 'unfixable-skill';
    const suite = makeSuite(skillName);
    const failingReport = makeFailingReport(skillName);

    mockedGenerate.mockResolvedValue(suite);
    mockedRunTests.mockResolvedValue(failingReport);

    const fixResult: FixResult = {
      success: false,
      attempts: 3,
      fixedCases: [],
      unfixedCases: ['tc-001'],
      error: 'Failed to fix after 3 attempts',
    };
    mockedAutoFix.mockResolvedValue(fixResult);

    await runPipeline(skillName);

    const state = getPipelineState(skillName);
    expect(state!.status).toBe('failed');
    expect(state!.error).toContain('Failed to fix after 3 attempts');
    // Should NOT attempt to publish
    expect(mockedCreateSnapshot).not.toHaveBeenCalled();
    expect(mockedRedeploy).not.toHaveBeenCalled();
  });

  it('should rollback when deploy fails after publish (Req 7.4)', async () => {
    const skillName = 'deploy-fail-skill';
    const suite = makeSuite(skillName);
    const report = makePassingReport(skillName);

    mockedGenerate.mockResolvedValue(suite);
    mockedRunTests.mockResolvedValue(report);
    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 3,
      createdAt: new Date().toISOString(),
      reason: '发布',
      files: ['SKILL.md'],
    });
    // Deploy fails
    mockedRedeploy.mockRejectedValue(new Error('Build failed: out of memory'));
    // Rollback succeeds
    mockedRollback.mockResolvedValue({
      success: true,
      fromVersion: 4,
      toVersion: 2,
    });

    await runPipeline(skillName);

    const state = getPipelineState(skillName);
    expect(state!.status).toBe('failed');
    expect(state!.error).toContain('部署失败已回滚到版本 2');
    expect(state!.error).toContain('Build failed: out of memory');
    // Rollback should be called with pre-publish version (3 - 1 = 2)
    expect(mockedRollback).toHaveBeenCalledWith(skillName, 2);
  });

  it('should report both deploy and rollback errors when rollback also fails', async () => {
    const skillName = 'double-fail-skill';
    const suite = makeSuite(skillName);
    const report = makePassingReport(skillName);

    mockedGenerate.mockResolvedValue(suite);
    mockedRunTests.mockResolvedValue(report);
    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 5,
      createdAt: new Date().toISOString(),
      reason: '发布',
      files: ['SKILL.md'],
    });
    mockedRedeploy.mockRejectedValue(new Error('Deploy error'));
    mockedRollback.mockRejectedValue(new Error('Rollback error'));

    await runPipeline(skillName);

    const state = getPipelineState(skillName);
    expect(state!.status).toBe('failed');
    expect(state!.error).toContain('部署失败且回滚失败');
    expect(state!.error).toContain('Deploy error');
    expect(state!.error).toContain('Rollback error');
  });

  it('should fail when deploy returns build_failed status', async () => {
    const skillName = 'build-fail-skill';
    const suite = makeSuite(skillName);
    const report = makePassingReport(skillName);

    mockedGenerate.mockResolvedValue(suite);
    mockedRunTests.mockResolvedValue(report);
    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 2,
      createdAt: new Date().toISOString(),
      reason: '发布',
      files: ['SKILL.md'],
    });
    mockedRedeploy.mockResolvedValue({
      status: 'build_failed',
      port: null,
      buildTimestamp: null,
      logs: ['Build error'],
    });
    mockedRollback.mockResolvedValue({
      success: true,
      fromVersion: 3,
      toVersion: 1,
    });

    await runPipeline(skillName);

    const state = getPipelineState(skillName);
    expect(state!.status).toBe('failed');
    expect(state!.error).toContain('部署失败');
    expect(mockedRollback).toHaveBeenCalledWith(skillName, 1);
  });

  it('should handle test generation errors gracefully', async () => {
    const skillName = 'no-skill';
    mockedGenerate.mockRejectedValue(new Error('Skill "no-skill" not found'));

    await runPipeline(skillName);

    const state = getPipelineState(skillName);
    expect(state!.status).toBe('failed');
    expect(state!.error).toContain('Skill "no-skill" not found');
  });

  it('should set a unique runId for each pipeline run', async () => {
    const skillName = 'run-id-skill';
    mockedGenerate.mockRejectedValue(new Error('fail'));

    await runPipeline(skillName);
    const state1 = getPipelineState(skillName);
    const runId1 = state1!.runId;

    await runPipeline(skillName);
    const state2 = getPipelineState(skillName);
    const runId2 = state2!.runId;

    expect(runId1).toBeDefined();
    expect(runId2).toBeDefined();
    expect(runId1).not.toBe(runId2);
  });
});

// ---------------------------------------------------------------------------
// getStatus tests
// ---------------------------------------------------------------------------

describe('getStatus', () => {
  it('should return default idle state for a skill that has never run', () => {
    const state = getStatus('never-run-skill');
    expect(state.status).toBe('idle');
    expect(state.skillName).toBe('never-run-skill');
    expect(state.runId).toBe('');
    expect(state.startedAt).toBe('');
  });

  it('should return the current pipeline state after a pipeline run', async () => {
    const skillName = 'status-test-skill';
    mockedGenerate.mockRejectedValue(new Error('fail'));

    await runPipeline(skillName);

    const state = getStatus(skillName);
    expect(state.status).toBe('failed');
    expect(state.skillName).toBe(skillName);
    expect(state.runId).toBeDefined();
    expect(state.runId).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// getReport tests
// ---------------------------------------------------------------------------

describe('getReport', () => {
  it('should return null for a skill that has never run', () => {
    const report = getReport('no-report-skill');
    expect(report).toBeNull();
  });

  it('should return null when pipeline failed before testing', async () => {
    const skillName = 'no-test-report-skill';
    mockedGenerate.mockRejectedValue(new Error('generation failed'));

    await runPipeline(skillName);

    const report = getReport(skillName);
    expect(report).toBeNull();
  });

  it('should return the test report after a successful test run', async () => {
    const skillName = 'has-report-skill';
    const suite = makeSuite(skillName);
    const testReport = makePassingReport(skillName);

    mockedGenerate.mockResolvedValue(suite);
    mockedRunTests.mockResolvedValue(testReport);
    mockedCreateSnapshot.mockResolvedValue({
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      reason: '发布',
      files: ['SKILL.md'],
    });
    mockedRedeploy.mockResolvedValue({
      status: 'deployed',
      port: 3100,
      buildTimestamp: null,
      logs: [],
    });

    await runPipeline(skillName);

    const report = getReport(skillName);
    expect(report).not.toBeNull();
    expect(report!.skillName).toBe(skillName);
    expect(report!.total).toBe(1);
    expect(report!.passed).toBe(1);
  });
});


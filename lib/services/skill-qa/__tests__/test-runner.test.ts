/**
 * Unit tests for test-runner.ts - runTests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import http from 'http';
import type { AddressInfo } from 'net';
import type { TestSuite, TestCase } from '../types';

// Mock skill-service
vi.mock('@/lib/services/skill-service', () => ({
  getSkillPathByName: vi.fn(),
}));

// Mock deploy-manager
vi.mock('@/lib/services/deploy-manager', () => ({
  deployManager: {
    getStatus: vi.fn(),
    deploy: vi.fn(),
  },
}));

import { runTests, runFailed, ensureDeployed } from '../test-runner';
import { getSkillPathByName } from '@/lib/services/skill-service';
import { deployManager } from '@/lib/services/deploy-manager';

const mockedGetSkillPath = vi.mocked(getSkillPathByName);
const mockedGetStatus = vi.mocked(deployManager.getStatus);
const mockedDeploy = vi.mocked(deployManager.deploy);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-runner-test-'));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Helper: set up a skill directory and mock the path resolver */
function setupSkillPath(): string {
  const skillPath = path.join(tmpDir, 'test-skill');
  mockedGetSkillPath.mockReturnValue(skillPath);
  return skillPath;
}

/** Helper: create a minimal test suite */
function makeSuite(cases: TestCase[]): TestSuite {
  return {
    skillName: 'test-skill',
    generatedAt: new Date().toISOString(),
    cases,
  };
}

describe('ensureDeployed', () => {
  it('returns base URL when skill is already deployed', async () => {
    mockedGetStatus.mockReturnValue({
      status: 'deployed',
      port: 4000,
      buildTimestamp: null,
      logs: [],
    });

    const url = await ensureDeployed('test-skill');
    expect(url).toBe('http://localhost:4000');
    expect(mockedDeploy).not.toHaveBeenCalled();
  });

  it('deploys skill when not deployed and returns base URL', async () => {
    mockedGetStatus.mockReturnValue({
      status: 'not_deployed',
      port: null,
      buildTimestamp: null,
      logs: [],
    });
    mockedDeploy.mockResolvedValue({
      status: 'deployed',
      port: 5000,
      buildTimestamp: null,
      logs: [],
    });

    const url = await ensureDeployed('test-skill');
    expect(url).toBe('http://localhost:5000');
    expect(mockedDeploy).toHaveBeenCalledWith('test-skill');
  });

  it('throws when deploy fails', async () => {
    mockedGetStatus.mockReturnValue({
      status: 'not_deployed',
      port: null,
      buildTimestamp: null,
      logs: [],
    });
    mockedDeploy.mockResolvedValue({
      status: 'build_failed',
      port: null,
      buildTimestamp: null,
      logs: [],
    });

    await expect(ensureDeployed('test-skill')).rejects.toThrow(
      'Failed to deploy skill "test-skill"',
    );
  });
});

describe('runTests', () => {
  it('throws when skill does not exist', async () => {
    mockedGetSkillPath.mockReturnValue(null);

    await expect(
      runTests('nonexistent', makeSuite([])),
    ).rejects.toThrow('Skill "nonexistent" not found');
  });

  it('returns empty report for empty test suite', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(skillPath, { recursive: true });

    const report = await runTests('test-skill', makeSuite([]));

    expect(report.skillName).toBe('test-skill');
    expect(report.total).toBe(0);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.errors).toBe(0);
    expect(report.results).toEqual([]);
  });

  it('saves report to __tests__/qa-report.json', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(skillPath, { recursive: true });

    await runTests('test-skill', makeSuite([]));

    const reportPath = path.join(skillPath, '__tests__', 'qa-report.json');
    const raw = await fs.readFile(reportPath, 'utf-8');
    const saved = JSON.parse(raw);

    expect(saved.skillName).toBe('test-skill');
    expect(saved.runAt).toBeTruthy();
    expect(saved.total).toBe(0);
  });

  it('executes HTTP test cases against a real server', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(skillPath, { recursive: true });

    // Start a tiny HTTP server
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    // Mock deploy status to point to our test server
    mockedGetStatus.mockReturnValue({
      status: 'deployed',
      port,
      buildTimestamp: null,
      logs: [],
    });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'GET /health',
        type: 'http',
        method: 'GET',
        path: '/health',
        expect: { status: 200 },
      },
    ]);

    const report = await runTests('test-skill', suite);

    server.close();

    expect(report.total).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.results[0].status).toBe('passed');
    expect(report.results[0].actual?.status).toBe(200);
  });

  it('marks HTTP test as failed when status code does not match', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(skillPath, { recursive: true });

    const server = http.createServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    mockedGetStatus.mockReturnValue({
      status: 'deployed',
      port,
      buildTimestamp: null,
      logs: [],
    });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'GET /api should return 200',
        type: 'http',
        method: 'GET',
        path: '/api',
        expect: { status: 200 },
      },
    ]);

    const report = await runTests('test-skill', suite);

    server.close();

    expect(report.failed).toBe(1);
    expect(report.results[0].status).toBe('failed');
    expect(report.results[0].error).toContain('Expected status 200, got 500');
  });

  it('validates bodyContains expectation', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(skillPath, { recursive: true });

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'hello world' }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    mockedGetStatus.mockReturnValue({
      status: 'deployed',
      port,
      buildTimestamp: null,
      logs: [],
    });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'bodyContains check',
        type: 'http',
        method: 'GET',
        path: '/api',
        expect: { status: 200, bodyContains: ['hello', 'missing-text'] },
      },
    ]);

    const report = await runTests('test-skill', suite);

    server.close();

    expect(report.results[0].status).toBe('failed');
    expect(report.results[0].error).toContain('missing-text');
  });

  it('validates bodyMatch expectation', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(skillPath, { recursive: true });

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', count: 5 }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    mockedGetStatus.mockReturnValue({
      status: 'deployed',
      port,
      buildTimestamp: null,
      logs: [],
    });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'bodyMatch check',
        type: 'http',
        method: 'GET',
        path: '/api',
        expect: { status: 200, bodyMatch: { status: 'ok', count: 99 } },
      },
    ]);

    const report = await runTests('test-skill', suite);

    server.close();

    expect(report.results[0].status).toBe('failed');
    expect(report.results[0].error).toContain('body.count');
  });

  it('executes script test cases', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(path.join(skillPath, 'scripts'), { recursive: true });

    // Create a simple script
    const scriptPath = path.join(skillPath, 'scripts', 'hello.sh');
    await fs.writeFile(scriptPath, '#!/bin/bash\necho "hello from script"', {
      mode: 0o755,
    });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'Script test',
        type: 'script',
        command: path.join(skillPath, 'scripts', 'hello.sh'),
        args: [],
        expect: { exitCode: 0, outputContains: ['hello from script'] },
      },
    ]);

    const report = await runTests('test-skill', suite);

    expect(report.total).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.results[0].actual?.exitCode).toBe(0);
    expect(report.results[0].actual?.output).toContain('hello from script');
  });

  it('marks script test as failed when exit code does not match', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(path.join(skillPath, 'scripts'), { recursive: true });

    const scriptPath = path.join(skillPath, 'scripts', 'fail.sh');
    await fs.writeFile(scriptPath, '#!/bin/bash\nexit 1', { mode: 0o755 });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'Script should exit 0',
        type: 'script',
        command: scriptPath,
        args: [],
        expect: { exitCode: 0 },
      },
    ]);

    const report = await runTests('test-skill', suite);

    expect(report.failed).toBe(1);
    expect(report.results[0].error).toContain('Expected exit code 0, got 1');
  });

  it('marks script test as error when command not found', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(skillPath, { recursive: true });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'Nonexistent script',
        type: 'script',
        command: '/nonexistent/script.sh',
        args: [],
        expect: { exitCode: 0 },
      },
    ]);

    const report = await runTests('test-skill', suite);

    expect(report.errors).toBe(1);
    expect(report.results[0].status).toBe('error');
  });

  it('report counts are consistent: total = passed + failed + errors', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(path.join(skillPath, 'scripts'), { recursive: true });

    // Create scripts for different outcomes
    const passScript = path.join(skillPath, 'scripts', 'pass.sh');
    await fs.writeFile(passScript, '#!/bin/bash\necho ok', { mode: 0o755 });

    const failScript = path.join(skillPath, 'scripts', 'fail.sh');
    await fs.writeFile(failScript, '#!/bin/bash\nexit 1', { mode: 0o755 });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'Pass',
        type: 'script',
        command: passScript,
        args: [],
        expect: { exitCode: 0 },
      },
      {
        id: 'tc-002',
        description: 'Fail',
        type: 'script',
        command: failScript,
        args: [],
        expect: { exitCode: 0 },
      },
      {
        id: 'tc-003',
        description: 'Error',
        type: 'script',
        command: '/nonexistent/script.sh',
        args: [],
        expect: { exitCode: 0 },
      },
    ]);

    const report = await runTests('test-skill', suite);

    expect(report.total).toBe(report.passed + report.failed + report.errors);
    expect(report.total).toBe(3);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.errors).toBe(1);
  });

  it('does not call deploy when there are only script tests', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(path.join(skillPath, 'scripts'), { recursive: true });

    const scriptPath = path.join(skillPath, 'scripts', 'ok.sh');
    await fs.writeFile(scriptPath, '#!/bin/bash\necho ok', { mode: 0o755 });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'Script only',
        type: 'script',
        command: scriptPath,
        args: [],
        expect: { exitCode: 0 },
      },
    ]);

    await runTests('test-skill', suite);

    expect(mockedGetStatus).not.toHaveBeenCalled();
    expect(mockedDeploy).not.toHaveBeenCalled();
  });

  it('deploys skill when HTTP tests exist and skill is not deployed', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(skillPath, { recursive: true });

    // Mock: not deployed → deploy → deployed on port
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    mockedGetStatus.mockReturnValue({
      status: 'not_deployed',
      port: null,
      buildTimestamp: null,
      logs: [],
    });
    mockedDeploy.mockResolvedValue({
      status: 'deployed',
      port,
      buildTimestamp: null,
      logs: [],
    });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'HTTP test',
        type: 'http',
        method: 'GET',
        path: '/api',
        expect: { status: 200 },
      },
    ]);

    const report = await runTests('test-skill', suite);

    server.close();

    expect(mockedDeploy).toHaveBeenCalledWith('test-skill');
    expect(report.passed).toBe(1);
  });
});

describe('runFailed', () => {
  it('only executes the specified failed case IDs', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(path.join(skillPath, 'scripts'), { recursive: true });

    const passScript = path.join(skillPath, 'scripts', 'pass.sh');
    await fs.writeFile(passScript, '#!/bin/bash\necho ok', { mode: 0o755 });

    const failScript = path.join(skillPath, 'scripts', 'fail.sh');
    await fs.writeFile(failScript, '#!/bin/bash\nexit 1', { mode: 0o755 });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'Pass',
        type: 'script',
        command: passScript,
        args: [],
        expect: { exitCode: 0 },
      },
      {
        id: 'tc-002',
        description: 'Fail',
        type: 'script',
        command: failScript,
        args: [],
        expect: { exitCode: 0 },
      },
    ]);

    const report = await runFailed('test-skill', suite, ['tc-002']);

    expect(report.total).toBe(1);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].caseId).toBe('tc-002');
  });

  it('returns empty report when no case IDs match', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(skillPath, { recursive: true });

    const suite = makeSuite([
      {
        id: 'tc-001',
        description: 'Some test',
        type: 'script',
        command: '/bin/echo',
        args: ['hi'],
        expect: { exitCode: 0 },
      },
    ]);

    const report = await runFailed('test-skill', suite, ['tc-999']);

    expect(report.total).toBe(0);
    expect(report.results).toEqual([]);
  });

  it('saves report to __tests__/qa-report.json', async () => {
    const skillPath = setupSkillPath();
    await fs.mkdir(skillPath, { recursive: true });

    const suite = makeSuite([]);
    await runFailed('test-skill', suite, []);

    const reportPath = path.join(skillPath, '__tests__', 'qa-report.json');
    const raw = await fs.readFile(reportPath, 'utf-8');
    const saved = JSON.parse(raw);
    expect(saved.skillName).toBe('test-skill');
  });
});


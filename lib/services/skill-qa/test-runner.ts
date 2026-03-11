/**
 * TestRunner - 测试执行器
 *
 * 按顺序执行测试用例（HTTP 和 Script 类型），
 * 生成测试报告并保存到 __tests__/qa-report.json。
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { getSkillPathByName } from '../skill-service';
import { deployManager } from '../deploy-manager';
import type { TestCase, TestSuite, TestResult, TestReport } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HTTP 测试超时时间（毫秒） */
const HTTP_TIMEOUT_MS = 30_000;

/** 脚本测试超时时间（毫秒） */
const SCRIPT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 确保 skill 已部署并返回 base URL。
 * 如果未部署，则调用 DeployManager 部署。
 */
export async function ensureDeployed(skillName: string): Promise<string> {
  const info = deployManager.getStatus(skillName);

  if (info.status === 'deployed' && info.port) {
    return `http://localhost:${info.port}`;
  }

  // Not deployed — trigger deploy
  const result = await deployManager.deploy(skillName);

  if (result.status !== 'deployed' || !result.port) {
    throw new Error(
      `Failed to deploy skill "${skillName}": status=${result.status}`,
    );
  }

  return `http://localhost:${result.port}`;
}

/**
 * 检查测试套件是否包含 HTTP 类型的测试用例
 */
function hasHttpTests(cases: TestCase[]): boolean {
  return cases.some((c) => c.type === 'http');
}

/**
 * 执行单个 HTTP 测试用例
 */
async function executeHttpTest(
  tc: TestCase,
  baseUrl: string,
): Promise<TestResult> {
  const start = Date.now();

  try {
    const url = `${baseUrl}${tc.path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    const fetchOptions: RequestInit = {
      method: tc.method || 'GET',
      signal: controller.signal,
      headers: tc.headers,
    };

    if (tc.body && (tc.method === 'POST' || tc.method === 'PUT')) {
      fetchOptions.body = JSON.stringify(tc.body);
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeout);

    let body: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
    } else {
      body = await response.text();
    }

    const duration = Date.now() - start;
    const actual = { status: response.status, body };

    // Validate expectations
    const failures: string[] = [];

    if (tc.expect.status !== undefined && response.status !== tc.expect.status) {
      failures.push(
        `Expected status ${tc.expect.status}, got ${response.status}`,
      );
    }

    if (tc.expect.bodyContains) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      for (const needle of tc.expect.bodyContains) {
        if (!bodyStr.includes(needle)) {
          failures.push(`Response body does not contain "${needle}"`);
        }
      }
    }

    if (tc.expect.bodyMatch) {
      for (const [key, expectedVal] of Object.entries(tc.expect.bodyMatch)) {
        const actualVal = (body as Record<string, unknown>)?.[key];
        if (JSON.stringify(actualVal) !== JSON.stringify(expectedVal)) {
          failures.push(
            `body.${key}: expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actualVal)}`,
          );
        }
      }
    }

    if (failures.length > 0) {
      return {
        caseId: tc.id,
        status: 'failed',
        duration,
        actual,
        error: failures.join('; '),
      };
    }

    return { caseId: tc.id, status: 'passed', duration, actual };
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const message =
      err instanceof Error ? err.message : String(err);

    // AbortError means timeout
    const isTimeout =
      (err instanceof Error && err.name === 'AbortError') ||
      message.includes('aborted');

    return {
      caseId: tc.id,
      status: 'error',
      duration,
      error: isTimeout
        ? `HTTP request timed out after ${HTTP_TIMEOUT_MS}ms`
        : message,
    };
  }
}


/**
 * 执行单个 Script 测试用例
 */
async function executeScriptTest(
  tc: TestCase,
  skillPath: string,
): Promise<TestResult> {
  const start = Date.now();

  try {
    // Resolve the command — replace ${SKILL_DIR} placeholder
    const resolvedCommand = (tc.command || '').replace(
      /\$\{SKILL_DIR\}/g,
      skillPath,
    );

    const { stdout, exitCode } = await runScript(
      resolvedCommand,
      tc.args || [],
      skillPath,
    );

    const duration = Date.now() - start;
    const actual = { exitCode, output: stdout };

    // Validate expectations
    const failures: string[] = [];

    if (tc.expect.exitCode !== undefined && exitCode !== tc.expect.exitCode) {
      failures.push(
        `Expected exit code ${tc.expect.exitCode}, got ${exitCode}`,
      );
    }

    if (tc.expect.outputContains) {
      for (const needle of tc.expect.outputContains) {
        if (!stdout.includes(needle)) {
          failures.push(`Output does not contain "${needle}"`);
        }
      }
    }

    if (failures.length > 0) {
      return {
        caseId: tc.id,
        status: 'failed',
        duration,
        actual,
        error: failures.join('; '),
      };
    }

    return { caseId: tc.id, status: 'passed', duration, actual };
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    const isTimeout = message.includes('timed out');

    return {
      caseId: tc.id,
      status: 'error',
      duration,
      error: isTimeout
        ? `Script timed out after ${SCRIPT_TIMEOUT_MS}ms`
        : message,
    };
  }
}

/**
 * 在子进程中执行脚本命令，捕获 stdout 和退出码
 */
function runScript(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd,
        timeout: SCRIPT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024, // 1 MB
      },
      (error, stdout, stderr) => {
        if (error) {
          // Timeout (process was killed)
          if ((error as unknown as { killed?: boolean }).killed) {
            reject(new Error(`Script timed out after ${SCRIPT_TIMEOUT_MS}ms`));
            return;
          }

          // Spawn error (e.g. ENOENT — command not found)
          const errnoCode = (error as NodeJS.ErrnoException).code;
          if (errnoCode === 'ENOENT' || errnoCode === 'EACCES') {
            reject(new Error(`${errnoCode}: ${error.message}`));
            return;
          }

          // Non-zero exit code — still return the result (not an error)
          // error.code here is the exit code (number) from the child process
          const exitCode =
            typeof (error as unknown as { code?: unknown }).code === 'number'
              ? ((error as unknown as { code: number }).code)
              : 1;
          resolve({
            stdout: (stdout || '') + (stderr || ''),
            exitCode,
          });
          return;
        }

        resolve({
          stdout: stdout || '',
          exitCode: 0,
        });
      },
    );

    // Handle spawn errors
    child.on('error', (err) => {
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Core: runTests
// ---------------------------------------------------------------------------

/**
 * 执行测试套件中的所有测试用例。
 *
 * 1. 检查 skill 部署状态，未部署则先部署
 * 2. 按顺序执行每个测试用例
 *    - HTTP 类型：发送 HTTP 请求到已部署 skill
 *    - Script 类型：在 skill 目录执行脚本
 * 3. 收集结果，生成测试报告
 * 4. 保存到 __tests__/qa-report.json
 *
 * @param skillName - skill 名称
 * @param testSuite - 要执行的测试套件
 * @returns 测试报告
 */
export async function runTests(
  skillName: string,
  testSuite: TestSuite,
): Promise<TestReport> {
  const skillPath = getSkillPathByName(skillName);
  if (!skillPath) {
    throw new Error(`Skill "${skillName}" not found`);
  }

  // Ensure skill is deployed if there are HTTP tests
  let baseUrl = '';
  if (hasHttpTests(testSuite.cases)) {
    baseUrl = await ensureDeployed(skillName);
  }

  // Execute all test cases sequentially
  const results: TestResult[] = [];

  for (const tc of testSuite.cases) {
    let result: TestResult;

    if (tc.type === 'http') {
      result = await executeHttpTest(tc, baseUrl);
    } else {
      result = await executeScriptTest(tc, skillPath);
    }

    results.push(result);
  }

  // Build report
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const errors = results.filter((r) => r.status === 'error').length;

  const report: TestReport = {
    skillName,
    runAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    errors,
    results,
  };

  // Save report to __tests__/qa-report.json
  const testsDir = path.join(skillPath, '__tests__');
  await fs.mkdir(testsDir, { recursive: true });
  await fs.writeFile(
    path.join(testsDir, 'qa-report.json'),
    JSON.stringify(report, null, 2),
    'utf-8',
  );

  return report;
}

/**
 * 仅重新执行指定的失败用例。
 *
 * 过滤测试套件，只保留 failedCaseIds 中的用例，
 * 复用 runTests 相同的执行逻辑，生成并保存报告。
 *
 * @param skillName - skill 名称
 * @param testSuite - 完整测试套件
 * @param failedCaseIds - 需要重新执行的失败用例 ID 列表
 * @returns 仅包含重新执行用例结果的测试报告
 */
export async function runFailed(
  skillName: string,
  testSuite: TestSuite,
  failedCaseIds: string[],
): Promise<TestReport> {
  const failedSet = new Set(failedCaseIds);
  const filteredSuite: TestSuite = {
    ...testSuite,
    cases: testSuite.cases.filter((c) => failedSet.has(c.id)),
  };

  return runTests(skillName, filteredSuite);
}


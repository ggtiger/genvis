/**
 * AutoFixer - 自动修复器
 *
 * 读取失败测试用例的错误信息和相关源代码，
 * 调用 LLM 生成修复方案并应用到源文件，
 * 重新执行失败用例验证修复效果，最多重试 3 次。
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { getSkillPathByName } from '../skill-service';
import { createSnapshot } from './version-store';
import { runFailed } from './test-runner';
import type { TestReport, TestResult, TestSuite, FixResult } from './types';

/** 最大修复尝试次数 */
export const MAX_FIX_ATTEMPTS = 3;

/** 排除的目录（不读取为源代码上下文） */
const EXCLUDED_DIRS = [
  '.versions',
  'node_modules',
  '.venv',
  '__pycache__',
  '.next',
  '.git',
  '__tests__',
];

/**
 * 递归读取 skill 目录中的源代码文件内容，用于构建修复上下文。
 * 返回 { relativePath: content } 的映射。
 */
async function readSourceFiles(
  dir: string,
  basePath: string = '',
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.includes(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const subFiles = await readSourceFiles(fullPath, relativePath);
      Object.assign(result, subFiles);
    } else {
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        result[relativePath] = content;
      } catch {
        // Skip unreadable files (binary, etc.)
      }
    }
  }

  return result;
}

/**
 * 从测试报告中提取失败用例的错误摘要。
 */
function extractFailedErrors(
  report: TestReport,
): { caseId: string; error: string }[] {
  return report.results
    .filter((r: TestResult) => r.status === 'failed' || r.status === 'error')
    .map((r: TestResult) => ({
      caseId: r.caseId,
      error: r.error || 'Unknown error',
    }));
}

/**
 * 构建修复 prompt，包含失败用例错误信息、源代码和 SKILL.md 描述。
 */
function buildFixPrompt(
  skillName: string,
  failedErrors: { caseId: string; error: string }[],
  sourceFiles: Record<string, string>,
  skillMdContent: string,
): string {
  const errorSection = failedErrors
    .map((e) => `- Case ${e.caseId}: ${e.error}`)
    .join('\n');

  const sourceSection = Object.entries(sourceFiles)
    .map(([filePath, content]) => `--- ${filePath} ---\n${content}`)
    .join('\n\n');

  return [
    `Fix the following test failures for skill "${skillName}".`,
    '',
    '## Failed Test Cases',
    errorSection,
    '',
    '## SKILL.md',
    skillMdContent,
    '',
    '## Source Code',
    sourceSection,
    '',
    'Please provide the corrected source code files. For each file that needs changes,',
    'output the full file content with the path as a header.',
  ].join('\n');
}

/**
 * 调用 LLM 生成修复方案。
 *
 * 通过平台 CLI 执行器（如 claude CLI）调用 LLM。
 * 此函数被导出以便在测试中 mock。
 *
 * @param prompt - 修复 prompt
 * @returns LLM 生成的修复响应文本
 */
export async function callLLMForFix(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(
      'claude',
      { maxBuffer: 5 * 1024 * 1024, timeout: 120_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`LLM call failed: ${error.message}`));
          return;
        }
        resolve(stdout || '');
      },
    );

    // Write prompt to stdin
    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

/**
 * 解析 LLM 响应，提取文件修改。
 * 期望格式：以 `--- path/to/file ---` 为分隔的文件内容块。
 */
function parseLLMResponse(
  response: string,
): Record<string, string> {
  const files: Record<string, string> = {};
  const blocks = response.split(/^---\s+(.+?)\s+---$/m);

  // blocks: ['preamble', 'filepath1', 'content1', 'filepath2', 'content2', ...]
  for (let i = 1; i < blocks.length - 1; i += 2) {
    const filePath = blocks[i].trim();
    const content = blocks[i + 1].trim();
    if (filePath && content) {
      files[filePath] = content;
    }
  }

  return files;
}

/**
 * 将修复内容应用到 skill 源文件。
 */
async function applyFixes(
  skillPath: string,
  fixes: Record<string, string>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(fixes)) {
    const fullPath = path.join(skillPath, relativePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }
}

/**
 * 从磁盘加载测试套件（qa-tests.json）。
 */
async function loadTestSuite(skillPath: string): Promise<TestSuite> {
  const suitePath = path.join(skillPath, '__tests__', 'qa-tests.json');
  const raw = await fs.readFile(suitePath, 'utf-8');
  return JSON.parse(raw) as TestSuite;
}

/**
 * 自动修复失败的测试用例。
 *
 * 1. 如果没有失败用例，直接返回成功
 * 2. 创建修复前版本快照
 * 3. 提取失败用例的错误信息
 * 4. 循环最多 MAX_FIX_ATTEMPTS 次：
 *    a. 读取源代码和 SKILL.md
 *    b. 构建修复 prompt，调用 LLM
 *    c. 应用修复到源文件
 *    d. 重新执行失败用例
 *    e. 如果全部通过，返回成功
 *    f. 更新失败用例列表
 * 5. 返回 FixResult
 *
 * @param skillName - skill 名称
 * @param report - 测试报告
 * @returns 修复结果
 */
export async function autoFix(
  skillName: string,
  report: TestReport,
): Promise<FixResult> {
  // Extract initially failed case IDs
  const allFailedIds = report.results
    .filter((r) => r.status === 'failed' || r.status === 'error')
    .map((r) => r.caseId);

  // If no failed cases, return success immediately
  if (allFailedIds.length === 0) {
    return {
      success: true,
      attempts: 0,
      fixedCases: [],
      unfixedCases: [],
    };
  }

  // Resolve skill path
  const skillPath = getSkillPathByName(skillName);
  if (!skillPath) {
    return {
      success: false,
      attempts: 0,
      fixedCases: [],
      unfixedCases: allFailedIds,
      error: `Skill "${skillName}" not found`,
    };
  }

  // Create version snapshot before fixing (Requirement 4.6)
  try {
    await createSnapshot(skillName, '自动修复前备份');
  } catch (err) {
    return {
      success: false,
      attempts: 0,
      fixedCases: [],
      unfixedCases: allFailedIds,
      error: `Failed to create snapshot: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Load test suite for re-running failed tests
  let testSuite: TestSuite;
  try {
    testSuite = await loadTestSuite(skillPath);
  } catch {
    return {
      success: false,
      attempts: 0,
      fixedCases: [],
      unfixedCases: allFailedIds,
      error: 'Failed to load test suite (qa-tests.json)',
    };
  }

  let currentFailedIds = [...allFailedIds];
  let currentReport = report;
  let attempts = 0;

  for (attempts = 1; attempts <= MAX_FIX_ATTEMPTS; attempts++) {
    try {
      // Read source code files
      const sourceFiles = await readSourceFiles(skillPath);

      // Read SKILL.md
      let skillMdContent = '';
      try {
        skillMdContent = await fs.readFile(
          path.join(skillPath, 'SKILL.md'),
          'utf-8',
        );
      } catch {
        // SKILL.md may not exist, continue without it
      }

      // Extract current failed errors
      const failedErrors = extractFailedErrors(currentReport);

      // Build prompt and call LLM
      const prompt = buildFixPrompt(
        skillName,
        failedErrors,
        sourceFiles,
        skillMdContent,
      );

      const llmResponse = await callLLMForFix(prompt);

      // Parse and apply fixes
      const fixes = parseLLMResponse(llmResponse);
      if (Object.keys(fixes).length > 0) {
        await applyFixes(skillPath, fixes);
      }

      // Re-run failed tests (Requirement 4.3)
      const rerunReport = await runFailed(skillName, testSuite, currentFailedIds);

      // Check which cases are now passing
      const stillFailed = rerunReport.results
        .filter((r) => r.status === 'failed' || r.status === 'error')
        .map((r) => r.caseId);

      if (stillFailed.length === 0) {
        // All fixed!
        return {
          success: true,
          attempts,
          fixedCases: allFailedIds,
          unfixedCases: [],
        };
      }

      // Update for next iteration
      currentFailedIds = stillFailed;
      currentReport = rerunReport;
    } catch (err) {
      // LLM call or other error — count as an attempt, continue to next retry
      if (attempts === MAX_FIX_ATTEMPTS) {
        return {
          success: false,
          attempts,
          fixedCases: allFailedIds.filter((id) => !currentFailedIds.includes(id)),
          unfixedCases: currentFailedIds,
          error: `Fix attempt ${attempts} failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      // Continue to next attempt
    }
  }

  // Reached max retries (Requirement 4.5)
  const fixedCases = allFailedIds.filter((id) => !currentFailedIds.includes(id));

  return {
    success: false,
    attempts: MAX_FIX_ATTEMPTS,
    fixedCases,
    unfixedCases: currentFailedIds,
    error: `Failed to fix all cases after ${MAX_FIX_ATTEMPTS} attempts`,
  };
}

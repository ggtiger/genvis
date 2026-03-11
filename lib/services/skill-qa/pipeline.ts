/**
 * QAPipeline - QA 流水线
 *
 * 串联测试生成 → 测试执行 → 自动修复 → 发布的完整流程。
 * 管理流水线状态并提供状态查询接口。
 */

import { generateTestCases } from './test-generator';
import { runTests } from './test-runner';
import { autoFix } from './auto-fixer';
import { createSnapshot, rollback } from './version-store';
import { deployManager } from '../deploy-manager';
import type { PipelineState, TestReport } from './types';

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/** 每个 skill 的流水线状态 */
const pipelineStates = new Map<string, PipelineState>();

/**
 * 生成唯一的运行 ID
 */
function generateRunId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * 获取指定 skill 的流水线状态
 */
export function getPipelineState(skillName: string): PipelineState | undefined {
  return pipelineStates.get(skillName);
}

/**
 * 获取所有流水线状态（用于调试/监控）
 */
export function getAllPipelineStates(): Map<string, PipelineState> {
  return pipelineStates;
}

/**
 * 获取指定 skill 的当前流水线状态。
 * 如果该 skill 从未运行过流水线，返回默认的 idle 状态。
 *
 * @param skillName - skill 名称
 * @returns 当前流水线状态
 */
export function getStatus(skillName: string): PipelineState {
  const existing = pipelineStates.get(skillName);
  if (existing) {
    return existing;
  }
  return {
    status: 'idle',
    skillName,
    runId: '',
    startedAt: '',
  };
}

/**
 * 获取指定 skill 最近一次测试报告。
 * 如果该 skill 没有运行过流水线或没有测试报告，返回 null。
 *
 * @param skillName - skill 名称
 * @returns 测试报告或 null
 */
export function getReport(skillName: string): TestReport | null {
  const state = pipelineStates.get(skillName);
  return state?.testReport ?? null;
}


// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * 运行完整的 QA 流水线。
 *
 * 流程：
 * 1. 状态 → generating：生成测试用例
 * 2. 状态 → testing：执行测试
 * 3. 如有失败 → fixing：自动修复（循环最多 3 次）
 * 4. 全部通过 → publishing：创建版本快照 + 重新部署
 * 5. 状态 → completed 或 failed
 *
 * 发布时创建版本快照（原因："发布"），然后调用 DeployManager.redeploy。
 * 部署失败时自动回滚到发布前的版本。
 *
 * @param skillName - skill 名称
 */
export async function runPipeline(skillName: string): Promise<void> {
  const runId = generateRunId();

  const state: PipelineState = {
    status: 'idle',
    skillName,
    runId,
    startedAt: new Date().toISOString(),
  };

  pipelineStates.set(skillName, state);

  try {
    // ── Step 1: 生成测试用例 ──────────────────────────────────
    state.status = 'generating';
    state.currentStep = '正在生成测试用例';

    const testSuite = await generateTestCases(skillName);

    // ── Step 2: 执行测试 ──────────────────────────────────────
    state.status = 'testing';
    state.currentStep = '正在执行测试';

    let report: TestReport = await runTests(skillName, testSuite);
    state.testReport = report;

    // ── Step 3: 自动修复（如有失败） ──────────────────────────
    const hasFailures = report.failed > 0 || report.errors > 0;

    if (hasFailures) {
      state.status = 'fixing';
      state.currentStep = '正在自动修复失败的测试';

      const fixResult = await autoFix(skillName, report);
      state.fixResult = fixResult;

      if (!fixResult.success) {
        state.status = 'failed';
        state.completedAt = new Date().toISOString();
        state.error = fixResult.error || '自动修复失败，仍有未通过的测试用例';
        return;
      }

      // Re-run all tests after fix to get a fresh report
      state.status = 'testing';
      state.currentStep = '修复后重新执行全部测试';
      report = await runTests(skillName, testSuite);
      state.testReport = report;

      // Verify all tests pass after fix
      if (report.failed > 0 || report.errors > 0) {
        state.status = 'failed';
        state.completedAt = new Date().toISOString();
        state.error = '修复后仍有测试未通过';
        return;
      }
    }

    // ── Step 4: 发布 ──────────────────────────────────────────
    // Requirement 7.1: 所有测试通过后创建发布版本快照
    state.status = 'publishing';
    state.currentStep = '正在发布';

    const publishSnapshot = await createSnapshot(skillName, '发布');
    state.publishedVersion = publishSnapshot.versionNumber;

    // Requirement 7.2: 调用 DeployManager.redeploy 重新部署
    try {
      state.currentStep = '正在重新部署';
      const deployResult = await deployManager.redeploy(skillName);

      if (deployResult.status === 'build_failed' || deployResult.status === 'stopped') {
        throw new Error(`部署失败: status=${deployResult.status}`);
      }

      // Requirement 7.3: 发布成功
      state.status = 'completed';
      state.completedAt = new Date().toISOString();
      state.currentStep = `发布成功，版本 ${publishSnapshot.versionNumber}，部署状态: ${deployResult.status}`;
    } catch (deployError) {
      // Requirement 7.4: 部署失败时自动回滚
      state.currentStep = '部署失败，正在回滚';

      const prePublishVersion = publishSnapshot.versionNumber - 1;

      if (prePublishVersion >= 1) {
        try {
          await rollback(skillName, prePublishVersion);
          state.error = `部署失败已回滚到版本 ${prePublishVersion}: ${deployError instanceof Error ? deployError.message : String(deployError)}`;
        } catch (rollbackError) {
          state.error = `部署失败且回滚失败: 部署错误=${deployError instanceof Error ? deployError.message : String(deployError)}, 回滚错误=${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`;
        }
      } else {
        state.error = `部署失败（无可回滚版本）: ${deployError instanceof Error ? deployError.message : String(deployError)}`;
      }

      state.status = 'failed';
      state.completedAt = new Date().toISOString();
    }
  } catch (err) {
    // Unexpected error at any stage
    state.status = 'failed';
    state.completedAt = new Date().toISOString();
    state.error = err instanceof Error ? err.message : String(err);
  }
}

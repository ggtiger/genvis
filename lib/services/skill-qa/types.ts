/**
 * Skill QA 自动化员工 - 数据模型定义
 *
 * 定义测试用例、测试报告、版本管理和流水线状态等核心接口。
 */

// ─── 测试用例 ───────────────────────────────────────────────

/**
 * 测试用例
 */
export interface TestCase {
  /** 唯一标识，如 "tc-001" */
  id: string;
  /** 测试描述 */
  description: string;
  /** 测试类型：HTTP 请求或脚本调用 */
  type: 'http' | 'script';
  // HTTP 类型字段
  /** HTTP 方法 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** API 路径，如 "/api/query" */
  path?: string;
  /** 请求体 */
  body?: Record<string, unknown>;
  /** 请求头 */
  headers?: Record<string, string>;
  // Script 类型字段
  /** 脚本命令 */
  command?: string;
  /** 脚本参数 */
  args?: string[];
  /** 验证规则 */
  expect: {
    /** 预期 HTTP 状态码 */
    status?: number;
    /** 响应体包含的字符串 */
    bodyContains?: string[];
    /** 响应体字段匹配 */
    bodyMatch?: Record<string, unknown>;
    /** 预期退出码 */
    exitCode?: number;
    /** 标准输出包含的字符串 */
    outputContains?: string[];
  };
}


/**
 * 测试套件
 */
export interface TestSuite {
  /** skill 名称 */
  skillName: string;
  /** 生成时间（ISO8601） */
  generatedAt: string;
  /** 测试用例列表 */
  cases: TestCase[];
}

// ─── 测试结果 ───────────────────────────────────────────────

/**
 * 单个测试用例的执行结果
 */
export interface TestResult {
  /** 对应的测试用例 ID */
  caseId: string;
  /** 执行状态 */
  status: 'passed' | 'failed' | 'error';
  /** 执行时间（毫秒） */
  duration: number;
  /** 实际结果 */
  actual?: {
    /** HTTP 响应状态码 */
    status?: number;
    /** HTTP 响应体 */
    body?: unknown;
    /** 脚本退出码 */
    exitCode?: number;
    /** 脚本标准输出 */
    output?: string;
  };
  /** 错误信息 */
  error?: string;
}

/**
 * 测试报告
 */
export interface TestReport {
  /** skill 名称 */
  skillName: string;
  /** 执行时间（ISO8601） */
  runAt: string;
  /** 总用例数 */
  total: number;
  /** 通过数 */
  passed: number;
  /** 失败数 */
  failed: number;
  /** 错误数 */
  errors: number;
  /** 各用例执行结果 */
  results: TestResult[];
}

// ─── 版本管理 ───────────────────────────────────────────────

/**
 * 版本信息
 */
export interface VersionInfo {
  /** 递增整数版本号 */
  versionNumber: number;
  /** 创建时间（ISO8601） */
  createdAt: string;
  /** 创建原因，如"自动修复前备份"或"发布版本" */
  reason: string;
  /** 文件清单（相对路径） */
  files: string[];
}

/**
 * 回滚结果
 */
export interface RollbackResult {
  /** 是否成功 */
  success: boolean;
  /** 回滚前的版本号（新创建的备份） */
  fromVersion: number;
  /** 回滚到的目标版本号 */
  toVersion: number;
  /** 错误信息 */
  error?: string;
}

// ─── 自动修复 ───────────────────────────────────────────────

/**
 * 修复结果
 */
export interface FixResult {
  /** 是否成功 */
  success: boolean;
  /** 修复尝试次数 */
  attempts: number;
  /** 修复成功的用例 ID */
  fixedCases: string[];
  /** 未能修复的用例 ID */
  unfixedCases: string[];
  /** 错误信息 */
  error?: string;
}

// ─── QA 流水线 ──────────────────────────────────────────────

/**
 * 流水线状态枚举
 */
export type PipelineStatus =
  | 'idle'
  | 'generating'
  | 'testing'
  | 'fixing'
  | 'publishing'
  | 'completed'
  | 'failed';

/**
 * 流水线状态
 */
export interface PipelineState {
  /** 当前状态 */
  status: PipelineStatus;
  /** skill 名称 */
  skillName: string;
  /** 运行 ID */
  runId: string;
  /** 开始时间（ISO8601） */
  startedAt: string;
  /** 完成时间（ISO8601） */
  completedAt?: string;
  /** 当前步骤描述 */
  currentStep?: string;
  /** 测试报告 */
  testReport?: TestReport;
  /** 修复结果 */
  fixResult?: FixResult;
  /** 发布的版本号 */
  publishedVersion?: number;
  /** 错误信息 */
  error?: string;
}

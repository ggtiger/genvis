/**
 * TestCaseGenerator - 测试用例生成器
 *
 * 读取 skill 的 SKILL.md 和 api-endpoints.json，
 * 自动生成正向/异常测试用例和脚本调用测试用例。
 */

import fs from 'fs/promises';
import path from 'path';
import { getSkillPathByName } from '../skill-service';
import type { TestCase, TestSuite } from './types';

/** HTTP 方法类型 */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** 从 SKILL.md 解析出的 API 端点 */
interface ParsedEndpoint {
  method: HttpMethod;
  path: string;
  description?: string;
  hasBody?: boolean;
  bodyExample?: Record<string, unknown>;
}

/** 从 SKILL.md 解析出的脚本调用 */
interface ParsedScript {
  command: string;
  args: string[];
  description?: string;
}

/** api-endpoints.json 中的端点参数 */
interface EndpointParam {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

/** api-endpoints.json 中的端点定义 */
interface EndpointDef {
  path: string;
  method: string;
  description?: string;
  parameters?: EndpointParam[];
}

/** api-endpoints.json 文件格式 */
interface ApiEndpointsConfig {
  skillName: string;
  endpoints: EndpointDef[];
}

/**
 * 正则：匹配 SKILL.md 中的 HTTP 方法 + 路径模式
 * 例如: `POST /api/query`, `GET /api/todos`, `PUT /api/notes/:id`
 */
const HTTP_ENDPOINT_REGEX = /`?(GET|POST|PUT|DELETE)\s+(\/[^\s`'"]+)`?/g;

/**
 * 正则：匹配 SKILL.md 中的脚本调用模式
 * 例如: `python3 ${SKILL_DIR}/scripts/search.py '{"query":"xxx"}'`
 */
const SCRIPT_CALL_REGEX =
  /(?:python3?|node|bash|sh)\s+\$\{SKILL_DIR\}\/scripts\/([^\s'"`]+)/g;

/**
 * 生成格式化的测试用例 ID
 * @param index - 从 1 开始的序号
 */
function makeTestId(index: number): string {
  return `tc-${String(index).padStart(3, '0')}`;
}

/**
 * 从 SKILL.md 内容中解析 API 端点
 */
export function parseEndpointsFromMarkdown(content: string): ParsedEndpoint[] {
  const endpoints: ParsedEndpoint[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  // Reset regex state
  HTTP_ENDPOINT_REGEX.lastIndex = 0;

  while ((match = HTTP_ENDPOINT_REGEX.exec(content)) !== null) {
    const method = match[1] as HttpMethod;
    const apiPath = match[2];
    const key = `${method} ${apiPath}`;

    if (seen.has(key)) continue;
    seen.add(key);

    // Try to extract a JSON body example from nearby code blocks
    const bodyExample = extractBodyExample(content, match.index, method);

    endpoints.push({
      method,
      path: apiPath,
      hasBody: method === 'POST' || method === 'PUT',
      bodyExample: bodyExample || undefined,
    });
  }

  return endpoints;
}

/**
 * 尝试从 SKILL.md 中提取 API 端点附近的 JSON body 示例
 */
function extractBodyExample(
  content: string,
  matchIndex: number,
  method: string,
): Record<string, unknown> | null {
  if (method !== 'POST' && method !== 'PUT') return null;

  // Look for a JSON code block within the next 500 characters after the endpoint mention
  const searchRegion = content.substring(matchIndex, matchIndex + 500);
  const jsonBlockMatch = searchRegion.match(/```json\s*\n([\s\S]*?)```/);

  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return null;
}

/**
 * 从 SKILL.md 内容中解析脚本调用
 */
export function parseScriptsFromMarkdown(content: string): ParsedScript[] {
  const scripts: ParsedScript[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  SCRIPT_CALL_REGEX.lastIndex = 0;

  while ((match = SCRIPT_CALL_REGEX.exec(content)) !== null) {
    const scriptFile = match[1];

    if (seen.has(scriptFile)) continue;
    seen.add(scriptFile);

    scripts.push({
      command: `\${SKILL_DIR}/scripts/${scriptFile}`,
      args: [],
    });
  }

  return scripts;
}

/**
 * 从 api-endpoints.json 中读取端点定义，合并到已解析的端点列表中
 */
async function loadApiEndpoints(skillPath: string): Promise<ParsedEndpoint[]> {
  const filePath = path.join(skillPath, 'api-endpoints.json');
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const config: ApiEndpointsConfig = JSON.parse(raw);

    if (!config.endpoints || !Array.isArray(config.endpoints)) {
      return [];
    }

    return config.endpoints.map((ep) => {
      const method = (ep.method?.toUpperCase() || 'GET') as HttpMethod;
      // Build a sample body from required parameters for POST/PUT
      let bodyExample: Record<string, unknown> | undefined;
      if ((method === 'POST' || method === 'PUT') && ep.parameters) {
        bodyExample = buildSampleBody(ep.parameters);
      }

      return {
        method,
        path: ep.path,
        description: ep.description,
        hasBody: method === 'POST' || method === 'PUT',
        bodyExample,
      };
    });
  } catch {
    // File doesn't exist or is invalid — that's fine
    return [];
  }
}

/**
 * 根据 api-endpoints.json 的参数定义构建示例请求体
 */
function buildSampleBody(params: EndpointParam[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const p of params) {
    if (p.type === 'string') {
      body[p.name] = `test-${p.name}`;
    } else if (p.type === 'number' || p.type === 'integer') {
      body[p.name] = 1;
    } else if (p.type === 'boolean') {
      body[p.name] = true;
    } else {
      body[p.name] = `test-${p.name}`;
    }
  }
  return body;
}

/**
 * 合并从 SKILL.md 和 api-endpoints.json 解析出的端点，去重
 */
function mergeEndpoints(
  fromMarkdown: ParsedEndpoint[],
  fromJson: ParsedEndpoint[],
): ParsedEndpoint[] {
  const seen = new Set<string>();
  const merged: ParsedEndpoint[] = [];

  // JSON endpoints take priority (more structured data)
  for (const ep of fromJson) {
    const key = `${ep.method} ${ep.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ep);
    }
  }

  for (const ep of fromMarkdown) {
    const key = `${ep.method} ${ep.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ep);
    }
  }

  return merged;
}

/**
 * 为单个 API 端点生成正向测试用例
 */
function generatePositiveHttpCase(
  ep: ParsedEndpoint,
  id: string,
): TestCase {
  const tc: TestCase = {
    id,
    description: ep.description
      ? `正向测试: ${ep.description}`
      : `正向测试: ${ep.method} ${ep.path} 应返回 200`,
    type: 'http',
    method: ep.method,
    path: ep.path,
    expect: {
      status: 200,
    },
  };

  if (ep.hasBody && ep.bodyExample) {
    tc.body = ep.bodyExample;
    tc.headers = { 'Content-Type': 'application/json' };
  }

  return tc;
}

/**
 * 为单个 API 端点生成异常测试用例
 */
function generateNegativeHttpCase(
  ep: ParsedEndpoint,
  id: string,
): TestCase {
  const tc: TestCase = {
    id,
    description: ep.description
      ? `异常测试: ${ep.description} - 无效输入`
      : `异常测试: ${ep.method} ${ep.path} 无效输入应返回 400`,
    type: 'http',
    method: ep.method,
    path: ep.path,
    expect: {
      status: 400,
    },
  };

  if (ep.hasBody) {
    // Send empty body to trigger validation error
    tc.body = {};
    tc.headers = { 'Content-Type': 'application/json' };
  } else {
    // For GET/DELETE, use an invalid path variant
    tc.path = ep.path.replace(/\/([^/]+)$/, '/___invalid___');
  }

  return tc;
}

/**
 * 为脚本调用生成测试用例
 */
function generateScriptCase(
  script: ParsedScript,
  id: string,
): TestCase {
  return {
    id,
    description: `脚本测试: ${script.command}`,
    type: 'script',
    command: script.command,
    args: script.args,
    expect: {
      exitCode: 0,
    },
  };
}

/**
 * 生成测试用例的主函数。
 *
 * 1. 读取 SKILL.md 解析功能描述和示例
 * 2. 读取 api-endpoints.json（如存在）获取 API 端点
 * 3. 为每个 API 端点生成正向和异常测试用例
 * 4. 为每个脚本调用生成测试用例
 * 5. 保存到 __tests__/qa-tests.json
 *
 * @param skillName - skill 名称
 * @returns 生成的测试套件
 */
export async function generateTestCases(skillName: string): Promise<TestSuite> {
  // Resolve skill path
  const skillPath = getSkillPathByName(skillName);
  if (!skillPath) {
    throw new Error(`Skill "${skillName}" not found`);
  }

  // Read SKILL.md
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  let skillMdContent: string;
  try {
    skillMdContent = await fs.readFile(skillMdPath, 'utf-8');
  } catch {
    throw new Error(`SKILL.md not found for skill "${skillName}"`);
  }

  // Parse endpoints from SKILL.md
  const mdEndpoints = parseEndpointsFromMarkdown(skillMdContent);

  // Parse scripts from SKILL.md
  const scripts = parseScriptsFromMarkdown(skillMdContent);

  // Load api-endpoints.json (if exists)
  const jsonEndpoints = await loadApiEndpoints(skillPath);

  // Merge endpoints (JSON takes priority)
  const allEndpoints = mergeEndpoints(mdEndpoints, jsonEndpoints);

  // Generate test cases
  const cases: TestCase[] = [];
  let counter = 1;

  for (const ep of allEndpoints) {
    // Positive test case
    cases.push(generatePositiveHttpCase(ep, makeTestId(counter++)));
    // Negative test case
    cases.push(generateNegativeHttpCase(ep, makeTestId(counter++)));
  }

  for (const script of scripts) {
    cases.push(generateScriptCase(script, makeTestId(counter++)));
  }

  const suite: TestSuite = {
    skillName,
    generatedAt: new Date().toISOString(),
    cases,
  };

  // Save to __tests__/qa-tests.json
  const testsDir = path.join(skillPath, '__tests__');
  await fs.mkdir(testsDir, { recursive: true });
  await fs.writeFile(
    path.join(testsDir, 'qa-tests.json'),
    JSON.stringify(suite, null, 2),
    'utf-8',
  );

  return suite;
}

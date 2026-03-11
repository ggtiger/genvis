/**
 * API 技能插件系统类型定义
 *
 * 定义 API 技能元数据格式、注册表数据结构，以及相关的工厂函数和验证函数。
 */

/**
 * API 端点请求参数定义
 */
export interface ApiEndpointParam {
  /** 参数名 */
  name: string;
  /** 参数类型: string, number, boolean, object */
  type: string;
  /** 是否必填 */
  required: boolean;
  /** 参数描述（中文） */
  description: string;
}

/**
 * API 端点响应字段定义
 */
export interface ApiEndpointResponseField {
  /** 字段名 */
  name: string;
  /** 字段类型: string, number, boolean, object, array */
  type: string;
  /** 字段描述（中文） */
  description: string;
}

/**
 * API 端点定义
 */
export interface ApiEndpoint {
  /** API 路径，如 "/api/todos" */
  path: string;
  /** HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** 端点功能描述（中文） */
  description: string;
  /** 请求参数（body 或 query） */
  parameters?: ApiEndpointParam[];
  /** 响应整体描述 */
  responseDescription?: string;
  /** 响应数据字段定义 */
  responseFields?: ApiEndpointResponseField[];
}

/**
 * API 端点配置文件格式（api-endpoints.json）
 */
export interface ApiEndpointsConfig {
  /** 技能标识名，如 "productivity-hub" */
  skillName: string;
  /** 技能显示名，如 "个人效率助手" */
  displayName: string;
  /** 技能整体功能描述，用于秘书意图匹配 */
  description: string;
  /** 认证配置 */
  auth?: {
    /** 认证类型 */
    authType: 'none' | 'api-key' | 'oauth';
    /** 所需环境变量名列表 */
    envVars?: string[];
  };
  /** API 端点列表 */
  endpoints: ApiEndpoint[];
}

/**
 * 注册表中的技能条目
 */
export interface RegisteredApiSkill {
  /** 技能标识名 */
  skillName: string;
  /** 技能显示名 */
  displayName: string;
  /** 技能功能描述 */
  description: string;
  /** 认证信息 */
  auth: {
    /** 认证类型 */
    authType: 'none' | 'api-key' | 'oauth';
    /** 所需环境变量名列表 */
    envVars?: string[];
    /** 认证是否已配置 */
    configured: boolean;
  };
  /** API 端点列表 */
  endpoints: ApiEndpoint[];
  /** 注册时间 ISO timestamp */
  registeredAt: string;
}

/**
 * API 技能注册表数据结构
 */
export interface ApiSkillRegistryData {
  /** 版本号 */
  version: 1;
  /** 已注册的技能列表 */
  skills: RegisteredApiSkill[];
  /** 最后更新时间 ISO timestamp */
  updatedAt: string;
}

/**
 * 创建空的 API 技能注册表
 */
export function createEmptyRegistry(): ApiSkillRegistryData {
  return {
    version: 1,
    skills: [],
    updatedAt: new Date().toISOString(),
  };
}

// --- 验证辅助函数 ---

const VALID_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
const VALID_AUTH_TYPES = ['none', 'api-key', 'oauth'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidMethod(value: unknown): value is ApiEndpoint['method'] {
  return typeof value === 'string' && (VALID_METHODS as readonly string[]).includes(value);
}

function isValidAuthType(value: unknown): value is 'none' | 'api-key' | 'oauth' {
  return typeof value === 'string' && (VALID_AUTH_TYPES as readonly string[]).includes(value);
}

function validateParam(param: unknown): param is ApiEndpointParam {
  if (typeof param !== 'object' || param === null) return false;
  const p = param as Record<string, unknown>;
  return (
    isNonEmptyString(p.name) &&
    isNonEmptyString(p.type) &&
    typeof p.required === 'boolean' &&
    isNonEmptyString(p.description)
  );
}

function validateResponseField(field: unknown): field is ApiEndpointResponseField {
  if (typeof field !== 'object' || field === null) return false;
  const f = field as Record<string, unknown>;
  return (
    isNonEmptyString(f.name) &&
    isNonEmptyString(f.type) &&
    isNonEmptyString(f.description)
  );
}

function validateEndpoint(endpoint: unknown): endpoint is ApiEndpoint {
  if (typeof endpoint !== 'object' || endpoint === null) return false;
  const e = endpoint as Record<string, unknown>;

  if (!isNonEmptyString(e.path)) return false;
  if (!isValidMethod(e.method)) return false;
  if (!isNonEmptyString(e.description)) return false;

  // 验证可选的 parameters
  if (e.parameters !== undefined) {
    if (!Array.isArray(e.parameters)) return false;
    if (!e.parameters.every(validateParam)) return false;
  }

  // 验证可选的 responseDescription
  if (e.responseDescription !== undefined) {
    if (typeof e.responseDescription !== 'string') return false;
  }

  // 验证可选的 responseFields
  if (e.responseFields !== undefined) {
    if (!Array.isArray(e.responseFields)) return false;
    if (!e.responseFields.every(validateResponseField)) return false;
  }

  return true;
}

function validateAuth(auth: unknown): auth is ApiEndpointsConfig['auth'] {
  if (typeof auth !== 'object' || auth === null) return false;
  const a = auth as Record<string, unknown>;

  if (!isValidAuthType(a.authType)) return false;

  if (a.envVars !== undefined) {
    if (!Array.isArray(a.envVars)) return false;
    if (!a.envVars.every((v: unknown) => typeof v === 'string')) return false;
  }

  return true;
}

/**
 * 验证未知数据是否为有效的 ApiEndpointsConfig
 *
 * 检查所有必填字段和类型，返回验证后的配置对象或 null（如果无效）。
 *
 * @param data - 待验证的未知数据
 * @returns 验证通过的 ApiEndpointsConfig 对象，或 null
 */
export function validateApiEndpointsConfig(data: unknown): ApiEndpointsConfig | null {
  if (typeof data !== 'object' || data === null) return null;

  const d = data as Record<string, unknown>;

  // 验证必填的顶层字段
  if (!isNonEmptyString(d.skillName)) return null;
  if (!isNonEmptyString(d.displayName)) return null;
  if (!isNonEmptyString(d.description)) return null;

  // 验证 endpoints 是非空数组
  if (!Array.isArray(d.endpoints) || d.endpoints.length === 0) return null;

  // 验证每个 endpoint
  if (!d.endpoints.every(validateEndpoint)) return null;

  // 验证可选的 auth
  if (d.auth !== undefined) {
    if (!validateAuth(d.auth)) return null;
  }

  return data as ApiEndpointsConfig;
}

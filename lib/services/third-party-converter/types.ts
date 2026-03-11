import type { SkillMeta } from '../skill-service';

/**
 * 解析后的中间表示 —— 第三方 skill 配置解析为统一结构
 */
export interface ParsedManifest {
  /** skill 唯一标识名（kebab-case） */
  name: string;
  /** 显示名称 */
  displayName?: string;
  /** 描述 */
  description: string;
  /** 版本号 */
  version?: string;
  /** 作者 */
  author?: string;
  /** 分类 */
  category?: string;
  /** 标签列表 */
  tags?: string[];
  /** 运行时类型 */
  runtime?: 'python' | 'node' | 'typescript' | 'unknown';
  /** 执行入口文件 */
  entryPoint?: string;
  /** 环境变量依赖 */
  envVars?: Array<{
    key: string;
    label?: string;
    required: boolean;
    secret?: boolean;
    defaultValue?: string;
  }>;
  /** 原始配置（保留完整的第三方配置供参考） */
  rawConfig?: Record<string, unknown>;
  /** 来源平台 */
  sourcePlatform: 'openclaw';
  /** 来源 URL */
  sourceUrl: string;
  /** 代码文件列表（相对路径） */
  codeFiles?: string[];
}

/**
 * 翻译后的元数据
 */
export interface TranslatedMeta {
  displayName?: string;
  description?: string;
  /** 翻译后的 SKILL.md 正文 */
  skillMdContent?: string;
}

/**
 * 抓取结果
 */
export interface FetchResult {
  /** 临时目录路径 */
  tempDir: string;
  /** 配置文件路径（YAML 或 JSON） */
  manifestPath: string;
  /** 配置文件格式 */
  manifestFormat: 'yaml' | 'json' | 'markdown';
  /** 代码文件路径列表 */
  codeFiles: string[];
}

/**
 * 转换结果
 */
export interface ConvertResult {
  success: boolean;
  /** 转换后的 skill 元数据 */
  skill?: SkillMeta;
  /** 错误信息 */
  error?: string;
  /** 失败的步骤 */
  failedStep?: 'fetch' | 'parse' | 'transform' | 'translate' | 'register';
}

/**
 * 转换选项
 */
export interface ConvertOptions {
  /** 是否执行中文化翻译，默认 true */
  translate?: boolean;
  /** 是否覆盖已存在的同名 skill，默认 false */
  overwrite?: boolean;
  /** 进度回调 */
  onProgress?: (step: string, message: string) => void;
}

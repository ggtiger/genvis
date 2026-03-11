/**
 * Transformer - 将 ParsedManifest 转换为平台标准格式文件
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import type { ParsedManifest, TranslatedMeta } from './types';
import type { EnvVarConfig } from '../skill-service';

/**
 * TemplateConfig 接口 —— 与 skill-service.ts 中的 TemplateConfig 保持一致
 * skill-service 中未导出该接口，因此在此重新定义以确保类型安全
 */
export interface TemplateConfig {
  displayName?: string;
  description?: string;
  category?: string;
  tags?: string[];
  version?: string;
  author?: string;
  preview?: string;
  projectType?: 'nextjs' | 'python-fastapi';
  envVars?: EnvVarConfig[];
}

/**
 * 将 runtime 映射为平台 projectType
 * 仅当 runtime 明确指定时才返回值，undefined 返回 undefined
 */
function mapRuntimeToProjectType(
  runtime?: ParsedManifest['runtime'],
): 'nextjs' | 'python-fastapi' | undefined {
  if (!runtime) return undefined;
  if (runtime === 'python') return 'python-fastapi';
  // node, typescript, unknown 均映射为 nextjs
  return 'nextjs';
}

/**
 * 判断 skill 是否包含可运行代码（有明确 runtime 或 codeFiles）
 */
function hasRunnableCode(manifest: ParsedManifest): boolean {
  return !!(manifest.runtime || (manifest.codeFiles && manifest.codeFiles.length > 0));
}

/**
 * 将 ParsedManifest 的 envVars 转换为 TemplateConfig 的 EnvVarConfig 格式
 */
function mapEnvVars(
  envVars?: ParsedManifest['envVars'],
): EnvVarConfig[] | undefined {
  if (!envVars || envVars.length === 0) return undefined;

  return envVars.map((v) => ({
    key: v.key,
    label: v.label || v.key,
    required: v.required,
    secret: v.secret,
    default: v.defaultValue,
  }));
}

/**
 * 生成 template.json 内容
 *
 * 将 ParsedManifest 转换为符合 TemplateConfig 接口的对象。
 * 如果提供了 translatedMeta，优先使用翻译后的 displayName 和 description。
 *
 * @param manifest - 解析后的第三方 skill 配置
 * @param translatedMeta - 可选的翻译后元数据
 * @returns 符合 TemplateConfig 接口的对象，可被 parseTemplateJson 正确解析
 */
export function generateTemplateJson(
  manifest: ParsedManifest,
  translatedMeta?: TranslatedMeta,
): TemplateConfig {
  const displayName =
    translatedMeta?.displayName || manifest.displayName || manifest.name;
  const description = translatedMeta?.description || manifest.description;

  const config: TemplateConfig = {
    displayName,
    description,
  };

  if (hasRunnableCode(manifest)) {
    config.projectType = mapRuntimeToProjectType(manifest.runtime) || 'nextjs';
  }

  if (manifest.category) {
    config.category = manifest.category;
  }

  if (manifest.tags && manifest.tags.length > 0) {
    config.tags = [...manifest.tags];
  }

  if (manifest.version) {
    config.version = manifest.version;
  }

  if (manifest.author) {
    config.author = manifest.author;
  }

  const envVars = mapEnvVars(manifest.envVars);
  if (envVars) {
    config.envVars = envVars;
  }

  return config;
}

/**
 * 生成 SKILL.md 内容
 *
 * 使用 gray-matter 生成带 YAML frontmatter 的 Markdown 文件内容。
 * frontmatter 包含 name、description、version、author、category、tags、projectType。
 * 正文包含使用说明。
 *
 * 如果提供了 translatedMeta，优先使用翻译后的 displayName（作为 name）、description 和 skillMdContent（作为正文）。
 *
 * 生成的内容可被现有 parseSkillMd 函数正确解析。
 *
 * @param manifest - 解析后的第三方 skill 配置
 * @param translatedMeta - 可选的翻译后元数据
 * @returns 完整的 SKILL.md 文件内容字符串
 */
export function generateSkillMd(
  manifest: ParsedManifest,
  translatedMeta?: TranslatedMeta,
): string {
  const name = translatedMeta?.displayName || manifest.displayName || manifest.name;
  const description = translatedMeta?.description || manifest.description;

  const frontmatter: Record<string, unknown> = {
    name,
    description,
  };

  if (manifest.version) {
    frontmatter.version = manifest.version;
  }

  if (manifest.author) {
    frontmatter.author = manifest.author;
  }

  if (manifest.category) {
    frontmatter.category = manifest.category;
  }

  if (manifest.tags && manifest.tags.length > 0) {
    frontmatter.tags = [...manifest.tags];
  }

  if (hasRunnableCode(manifest)) {
    frontmatter.projectType = mapRuntimeToProjectType(manifest.runtime) || 'nextjs';
  }

  const body = translatedMeta?.skillMdContent || generateDefaultBody(name, description);

  return matter.stringify(body, frontmatter);
}

/**
 * 生成默认的 SKILL.md 正文内容
 */
function generateDefaultBody(name: string, description: string): string {
  return `# ${name}\n\n${description}\n\n## 使用说明\n\n请参考上方描述了解此 skill 的功能和用法。\n`;
}


/**
 * 生成完整的 skill 目录结构
 *
 * 1. 在目标路径创建 skill 目录（递归）
 * 2. 写入 template.json（由 generateTemplateJson 生成）
 * 3. 写入 SKILL.md（由 generateSkillMd 生成）
 * 4. 从 sourcePath 复制代码文件到目标目录（使用 manifest.codeFiles 列表，若未指定则复制所有文件）
 *
 * @param manifest - 解析后的第三方 skill 配置
 * @param sourcePath - 源代码文件所在目录
 * @param targetPath - 目标 skill 目录路径
 * @param translatedMeta - 可选的翻译后元数据
 */
export async function transformToSkillDir(
  manifest: ParsedManifest,
  sourcePath: string,
  targetPath: string,
  translatedMeta?: TranslatedMeta,
): Promise<void> {
  // 1. Create target directory
  await fs.mkdir(targetPath, { recursive: true });

  // 2. Write template.json
  const templateConfig = generateTemplateJson(manifest, translatedMeta);
  await fs.writeFile(
    path.join(targetPath, 'template.json'),
    JSON.stringify(templateConfig, null, 2),
    'utf-8',
  );

  // 3. Write SKILL.md
  const skillMd = generateSkillMd(manifest, translatedMeta);
  await fs.writeFile(path.join(targetPath, 'SKILL.md'), skillMd, 'utf-8');

  // 4. Copy code files from sourcePath to targetPath
  // Exclude manifest/config files that we've already generated
  const excludeFiles = new Set(['SKILL.md', 'template.json', 'openclaw.yaml', 'openclaw.json', 'manifest.yaml', 'manifest.json']);
  const filesToCopy = (manifest.codeFiles ?? await listAllFiles(sourcePath))
    .filter(f => !excludeFiles.has(path.basename(f)));

  for (const relPath of filesToCopy) {
    const src = path.join(sourcePath, relPath);
    const dest = path.join(targetPath, relPath);

    // Ensure destination subdirectory exists
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

/**
 * 递归列出目录下所有文件的相对路径
 */
async function listAllFiles(dir: string, base: string = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const rel = base ? path.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listAllFiles(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }

  return files;
}


/**
 * VersionStore - Skill 版本存储模块
 *
 * 管理 skill 历史版本的创建、查询和回滚。
 * 版本快照存储在 skill 目录下的 `.versions/{versionNumber}/` 中。
 */

import fs from 'fs/promises';
import path from 'path';
import { getSkillPathByName } from '../skill-service';
import type { VersionInfo, RollbackResult } from './types';

/** 排除的目录列表（运行时/构建产物） */
const EXCLUDED_DIRS = [
  '.versions',
  'node_modules',
  '.venv',
  '__pycache__',
  '.next',
  '.git',
  '.DS_Store',
];

/** 每个 skill 最多保留的版本数 */
const MAX_VERSIONS = 20;

/**
 * 递归复制目录中的代码文件，排除运行时目录。
 * 返回复制的文件相对路径列表。
 */
async function copySkillFiles(
  srcDir: string,
  destDir: string,
  basePath: string = '',
): Promise<string[]> {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (EXCLUDED_DIRS.includes(entry.name)) continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const subFiles = await copySkillFiles(srcPath, destPath, relativePath);
      files.push(...subFiles);
    } else {
      await fs.copyFile(srcPath, destPath);
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * 获取 skill 的 .versions 目录路径。
 */
function getVersionsDir(skillPath: string): string {
  return path.join(skillPath, '.versions');
}

/**
 * 读取现有版本号列表（已排序，升序）。
 */
async function getExistingVersionNumbers(versionsDir: string): Promise<number[]> {
  try {
    const entries = await fs.readdir(versionsDir, { withFileTypes: true });
    const versions = entries
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => parseInt(e.name, 10))
      .sort((a, b) => a - b);
    return versions;
  } catch {
    return [];
  }
}

/**
 * 确定下一个版本号。
 */
async function getNextVersionNumber(versionsDir: string): Promise<number> {
  const existing = await getExistingVersionNumbers(versionsDir);
  if (existing.length === 0) return 1;
  return existing[existing.length - 1] + 1;
}

/**
 * 清理超出上限的旧版本，保留最新的 MAX_VERSIONS 个。
 */
async function cleanupOldVersions(versionsDir: string): Promise<void> {
  const existing = await getExistingVersionNumbers(versionsDir);
  if (existing.length <= MAX_VERSIONS) return;

  const toDelete = existing.slice(0, existing.length - MAX_VERSIONS);
  for (const ver of toDelete) {
    await fs.rm(path.join(versionsDir, String(ver)), { recursive: true, force: true });
  }
}

/**
 * 创建 skill 的版本快照。
 *
 * @param skillName - skill 名称
 * @param reason - 创建原因（如"自动修复前备份"或"发布版本"）
 * @returns 版本信息
 */
export async function createSnapshot(skillName: string, reason: string): Promise<VersionInfo> {
  const skillPath = getSkillPathByName(skillName);
  if (!skillPath) {
    throw new Error(`Skill "${skillName}" not found`);
  }

  const versionsDir = getVersionsDir(skillPath);
  const versionNumber = await getNextVersionNumber(versionsDir);
  const versionDir = path.join(versionsDir, String(versionNumber));

  // 复制代码文件到版本目录
  const files = await copySkillFiles(skillPath, versionDir);

  // 写入版本元数据
  const versionInfo: VersionInfo = {
    versionNumber,
    createdAt: new Date().toISOString(),
    reason,
    files,
  };

  await fs.writeFile(
    path.join(versionDir, 'meta.json'),
    JSON.stringify(versionInfo, null, 2),
    'utf-8',
  );

  // 清理超出上限的旧版本
  await cleanupOldVersions(versionsDir);

  return versionInfo;
}

/**
 * 列出 skill 的所有版本，按创建时间倒序排列。
 *
 * @param skillName - skill 名称
 * @returns 按时间倒序排列的版本列表
 */
export async function listVersions(skillName: string): Promise<VersionInfo[]> {
  const skillPath = getSkillPathByName(skillName);
  if (!skillPath) {
    throw new Error(`Skill "${skillName}" not found`);
  }

  const versionsDir = getVersionsDir(skillPath);
  const versionNumbers = await getExistingVersionNumbers(versionsDir);

  if (versionNumbers.length === 0) {
    return [];
  }

  const versions: VersionInfo[] = [];

  for (const num of versionNumbers) {
    try {
      const metaPath = path.join(versionsDir, String(num), 'meta.json');
      const raw = await fs.readFile(metaPath, 'utf-8');
      const meta: VersionInfo = JSON.parse(raw);
      versions.push(meta);
    } catch {
      // Skip corrupted version directories (missing or invalid meta.json)
    }
  }

  // Sort by createdAt descending (newest first), break ties by versionNumber descending
  versions.sort((a, b) => {
    const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.versionNumber - a.versionNumber;
  });

  return versions;
}


/**
 * 清除 skill 目录中的所有非排除文件和目录。
 * 用于回滚前清理当前文件，以便用目标版本文件替换。
 */
async function clearSkillFiles(skillPath: string): Promise<void> {
  const entries = await fs.readdir(skillPath, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_DIRS.includes(entry.name)) continue;

    const fullPath = path.join(skillPath, entry.name);
    await fs.rm(fullPath, { recursive: true, force: true });
  }
}

/**
 * 将 skill 回滚到指定版本。
 *
 * 1. 验证目标版本存在
 * 2. 创建当前版本快照（原因："回滚前备份"）
 * 3. 清除 skill 目录中的现有代码文件
 * 4. 将目标版本文件复制回 skill 目录
 *
 * @param skillName - skill 名称
 * @param versionNumber - 目标版本号
 * @returns 回滚结果
 */
export async function rollback(skillName: string, versionNumber: number): Promise<RollbackResult> {
  const skillPath = getSkillPathByName(skillName);
  if (!skillPath) {
    throw new Error(`Skill "${skillName}" not found`);
  }

  const versionsDir = getVersionsDir(skillPath);
  const existingVersions = await getExistingVersionNumbers(versionsDir);

  // Validate target version exists with a valid meta.json
  const targetVersionDir = path.join(versionsDir, String(versionNumber));
  const targetMetaPath = path.join(targetVersionDir, 'meta.json');

  let targetVersionExists = false;
  try {
    const raw = await fs.readFile(targetMetaPath, 'utf-8');
    JSON.parse(raw); // Validate it's valid JSON
    targetVersionExists = true;
  } catch {
    targetVersionExists = false;
  }

  if (!targetVersionExists) {
    const availableVersions = existingVersions.join(', ') || 'none';
    throw new Error(
      `Version ${versionNumber} does not exist for skill "${skillName}". Available versions: ${availableVersions}`,
    );
  }

  // Create backup of current state before rollback
  const backup = await createSnapshot(skillName, '回滚前备份');

  // Clear existing code files from skill directory
  await clearSkillFiles(skillPath);

  // Copy files from target version back to skill directory
  // Exclude meta.json which is version metadata, not a skill file
  await copySkillFiles(targetVersionDir, skillPath);

  // Remove meta.json that was copied from the version directory (it's version metadata, not a skill file)
  const copiedMeta = path.join(skillPath, 'meta.json');
  try {
    await fs.unlink(copiedMeta);
  } catch {
    // meta.json may not exist if it wasn't copied (no-op)
  }

  return {
    success: true,
    fromVersion: backup.versionNumber,
    toVersion: versionNumber,
  };
}


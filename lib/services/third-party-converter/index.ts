/**
 * 第三方 Skill 转换器 — 主入口
 *
 * 编排完整流程：平台识别 → 抓取 → 解析 → 翻译 → 转换 → 注册
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import type { ConvertOptions, ConvertResult, TranslatedMeta } from './types';
import { identifyPlatform, fetchSkillFromUrl } from './fetcher';
import { parseSkillManifest } from './parser';
import { translateMeta } from './translator';
import { transformToSkillDir } from './transformer';
import { importSkill } from '../skill-service';
import { USER_SKILLS_DIR_ABSOLUTE } from '@/lib/config/paths';

/**
 * 完整的第三方 skill 导入转换流程
 *
 * 1. identifyPlatform(url) → 验证平台
 * 2. fetchSkillFromUrl(url) → 抓取数据到临时目录
 * 3. parseSkillManifest(manifestPath, content) → 解析配置
 * 4. translateMeta(manifest) → 翻译元数据（可选）
 * 5. transformToSkillDir(...) → 生成平台标准文件到临时 skill 目录
 * 6. importSkill(targetPath) → 注册到平台（处理同名冲突 + 启用/禁用）
 * 7. 清理临时文件
 *
 * @param url 第三方平台的 skill URL
 * @param options 转换选项
 */
export async function convertThirdPartySkill(
  url: string,
  options?: ConvertOptions,
): Promise<ConvertResult> {
  const progress = options?.onProgress ?? (() => {});
  let tempDir: string | undefined;
  let fetchTempDir: string | undefined;

  try {
    // ── Step 1: 平台识别 ──
    progress('identify', '正在识别平台...');
    const platform = identifyPlatform(url);
    if (platform === 'unknown') {
      return {
        success: false,
        error: '暂不支持该平台',
        failedStep: 'fetch',
      };
    }

    // ── Step 2: 抓取 skill 数据 ──
    progress('fetch', '正在从第三方平台抓取 skill 数据...');
    let fetchResult;
    try {
      fetchResult = await fetchSkillFromUrl(url);
      fetchTempDir = fetchResult.tempDir;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `抓取失败: ${msg}`,
        failedStep: 'fetch',
      };
    }

    // ── Step 3: 解析配置 ──
    progress('parse', '正在解析 skill 配置...');
    let manifest;
    try {
      const manifestContent = await fs.readFile(fetchResult.manifestPath, 'utf-8');
      manifest = parseSkillManifest(fetchResult.manifestPath, manifestContent);
      // Fill in source URL
      manifest.sourceUrl = url;
      // Attach code files from fetch result
      if (fetchResult.codeFiles.length > 0) {
        manifest.codeFiles = fetchResult.codeFiles.map((f) =>
          path.relative(fetchResult.tempDir, f),
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `解析失败: ${msg}`,
        failedStep: 'parse',
      };
    }

    // ── Step 4: 翻译元数据（可选）──
    let translatedMeta: TranslatedMeta | undefined;
    if (options?.translate !== false) {
      progress('translate', '正在翻译 skill 元数据...');
      try {
        translatedMeta = await translateMeta(manifest);
      } catch (err: unknown) {
        // 翻译失败不阻断流程，记录日志继续
        console.warn('[Converter] 翻译失败，保留原文:', err);
        translatedMeta = undefined;
      }
    }

    // ── Step 5: 格式转换 ──
    progress('transform', '正在转换为平台标准格式...');
    const suffix = randomBytes(4).toString('hex');
    tempDir = path.join(os.tmpdir(), `skill-convert-${suffix}`);
    const targetPath = path.join(tempDir, manifest.name);
    try {
      await transformToSkillDir(
        manifest,
        fetchResult.tempDir,
        targetPath,
        translatedMeta,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `转换失败: ${msg}`,
        failedStep: 'transform',
      };
    }

    // ── Step 6: 平台注册 ──
    progress('register', '正在注册 skill 到平台...');
    try {
      // Check for existing skill with same name
      const existingPath = path.join(USER_SKILLS_DIR_ABSOLUTE, manifest.name);
      if (fsSync.existsSync(existingPath)) {
        if (!options?.overwrite) {
          return {
            success: false,
            error: `同名 skill "${manifest.name}" 已存在，请使用 overwrite 选项覆盖`,
            failedStep: 'register',
          };
        }
        // Backup existing skill before overwrite
        const backupPath = `${existingPath}.backup-${Date.now()}`;
        await fs.rename(existingPath, backupPath);
      }

      // Use importSkill to register — it handles:
      // - Copying to UserSkillsDir
      // - Parsing skill metadata
      // - Disabling skills with required envVars
      // - Updating plugin.json
      // - Registering API skills
      const skillMeta = await importSkill(targetPath);

      progress('done', '导入完成！');

      return {
        success: true,
        skill: skillMeta,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `注册失败: ${msg}`,
        failedStep: 'register',
      };
    }
  } finally {
    // ── 清理临时文件 ──
    const dirsToClean = [tempDir, fetchTempDir].filter(Boolean) as string[];
    for (const dir of dirsToClean) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * 从本地压缩包导入第三方 skill
 *
 * 1. 解压 zip 到临时目录
 * 2. 在解压目录中查找 manifest 文件（SKILL.md / openclaw.yaml / manifest.json 等）
 * 3. 解析配置
 * 4. 翻译元数据（可选）
 * 5. 转换为平台标准格式
 * 6. 注册到平台
 * 7. 清理临时文件
 *
 * @param zipPath 本地 zip 文件路径
 * @param options 转换选项
 */
export async function convertThirdPartyZip(
  zipPath: string,
  options?: ConvertOptions,
): Promise<ConvertResult> {
  const progress = options?.onProgress ?? (() => {});
  let extractDir: string | undefined;
  let tempDir: string | undefined;

  try {
    // ── Step 1: 解压 zip ──
    progress('fetch', '正在解压文件...');
    const suffix = randomBytes(4).toString('hex');
    extractDir = path.join(os.tmpdir(), `clawhub-zip-${suffix}`);
    await fs.mkdir(extractDir, { recursive: true });

    const { execSync } = await import('child_process');
    try {
      execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `解压失败: ${msg}`,
        failedStep: 'fetch',
      };
    }

    // ── Step 2: 查找 manifest 文件 ──
    progress('parse', '正在查找 skill 配置文件...');
    const manifestCandidates = ['SKILL.md', 'openclaw.yaml', 'openclaw.json', 'manifest.yaml', 'manifest.json'];

    // Check both root and one level deep (zip may contain a wrapper folder)
    let manifestPath: string | undefined;
    let sourceDir: string = extractDir;

    // First check root
    for (const candidate of manifestCandidates) {
      const p = path.join(extractDir, candidate);
      if (fsSync.existsSync(p)) {
        manifestPath = p;
        break;
      }
    }

    // If not found at root, check one level deep
    if (!manifestPath) {
      const entries = await fs.readdir(extractDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory());
      for (const dir of dirs) {
        for (const candidate of manifestCandidates) {
          const p = path.join(extractDir, dir.name, candidate);
          if (fsSync.existsSync(p)) {
            manifestPath = p;
            sourceDir = path.join(extractDir, dir.name);
            break;
          }
        }
        if (manifestPath) break;
      }
    }

    if (!manifestPath) {
      return {
        success: false,
        error: `压缩包中未找到 skill 配置文件（支持: ${manifestCandidates.join(', ')}）`,
        failedStep: 'parse',
      };
    }

    // ── Step 3: 解析配置 ──
    progress('parse', '正在解析 skill 配置...');
    let manifest;
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      manifest = parseSkillManifest(manifestPath, manifestContent);
      manifest.sourceUrl = `local:${path.basename(zipPath)}`;

      // Collect code files from source dir
      const allFiles = await fs.readdir(sourceDir);
      const codeExts = ['.py', '.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs'];
      const codeFiles = allFiles.filter(f => codeExts.some(ext => f.endsWith(ext)));
      if (codeFiles.length > 0) {
        manifest.codeFiles = codeFiles;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `解析失败: ${msg}`,
        failedStep: 'parse',
      };
    }

    // ── Step 4: 翻译元数据（可选）──
    let translatedMeta: TranslatedMeta | undefined;
    if (options?.translate !== false) {
      progress('translate', '正在翻译 skill 元数据...');
      try {
        translatedMeta = await translateMeta(manifest);
      } catch (err: unknown) {
        console.warn('[Converter] 翻译失败，保留原文:', err);
        translatedMeta = undefined;
      }
    }

    // ── Step 5: 格式转换 ──
    progress('transform', '正在转换为平台标准格式...');
    const convertSuffix = randomBytes(4).toString('hex');
    tempDir = path.join(os.tmpdir(), `skill-convert-${convertSuffix}`);
    const targetPath = path.join(tempDir, manifest.name);
    try {
      await transformToSkillDir(
        manifest,
        sourceDir,
        targetPath,
        translatedMeta,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `转换失败: ${msg}`,
        failedStep: 'transform',
      };
    }

    // ── Step 6: 平台注册 ──
    progress('register', '正在注册 skill 到平台...');
    try {
      const existingPath = path.join(USER_SKILLS_DIR_ABSOLUTE, manifest.name);
      if (fsSync.existsSync(existingPath)) {
        if (!options?.overwrite) {
          return {
            success: false,
            error: `同名 skill "${manifest.name}" 已存在，请使用 overwrite 选项覆盖`,
            failedStep: 'register',
          };
        }
        const backupPath = `${existingPath}.backup-${Date.now()}`;
        await fs.rename(existingPath, backupPath);
      }

      const skillMeta = await importSkill(targetPath);
      progress('done', '导入完成！');

      return {
        success: true,
        skill: skillMeta,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `注册失败: ${msg}`,
        failedStep: 'register',
      };
    }
  } finally {
    const dirsToClean = [extractDir, tempDir].filter(Boolean) as string[];
    for (const dir of dirsToClean) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export * from './types';

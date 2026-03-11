/**
 * Skill Directory Validator
 *
 * Validates that skill directories contain all required files
 * for API Skills and Script Skills.
 *
 * Validates: Requirements 7.3, 7.4
 */

import fs from 'fs';
import path from 'path';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that a directory is a complete API Skill.
 *
 * Required files:
 * - SKILL.md with name and description in YAML frontmatter
 * - api-endpoints.json with skillName and endpoints fields
 * - app/main.py
 * - requirements.txt
 */
export function validateApiSkillDir(dirPath: string): ValidationResult {
  const errors: string[] = [];

  // Check SKILL.md
  const skillMdPath = path.join(dirPath, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    errors.push('缺少 SKILL.md 文件');
  } else {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const frontmatterErrors = validateSkillMdFrontmatter(content);
    errors.push(...frontmatterErrors);
  }

  // Check api-endpoints.json
  const endpointsPath = path.join(dirPath, 'api-endpoints.json');
  if (!fs.existsSync(endpointsPath)) {
    errors.push('缺少 api-endpoints.json 文件');
  } else {
    try {
      const raw = fs.readFileSync(endpointsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed.skillName) {
        errors.push('api-endpoints.json 缺少 skillName 字段');
      }
      if (!parsed.endpoints || !Array.isArray(parsed.endpoints)) {
        errors.push('api-endpoints.json 缺少 endpoints 数组');
      }
    } catch {
      errors.push('api-endpoints.json 格式无效（非合法 JSON）');
    }
  }

  // Check app/main.py
  const mainPyPath = path.join(dirPath, 'app', 'main.py');
  if (!fs.existsSync(mainPyPath)) {
    errors.push('缺少 app/main.py 文件');
  }

  // Check requirements.txt
  const reqPath = path.join(dirPath, 'requirements.txt');
  if (!fs.existsSync(reqPath)) {
    errors.push('缺少 requirements.txt 文件');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a directory is a complete Script Skill.
 *
 * Required files:
 * - SKILL.md with name and description in YAML frontmatter
 * - scripts/ directory with at least one .py file
 */
export function validateScriptSkillDir(dirPath: string): ValidationResult {
  const errors: string[] = [];

  // Check SKILL.md
  const skillMdPath = path.join(dirPath, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    errors.push('缺少 SKILL.md 文件');
  } else {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const frontmatterErrors = validateSkillMdFrontmatter(content);
    errors.push(...frontmatterErrors);
  }

  // Check scripts/ directory
  const scriptsDir = path.join(dirPath, 'scripts');
  if (!fs.existsSync(scriptsDir) || !fs.statSync(scriptsDir).isDirectory()) {
    errors.push('缺少 scripts/ 目录');
  } else {
    const pyFiles = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.py'));
    if (pyFiles.length === 0) {
      errors.push('scripts/ 目录下没有 .py 文件');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate SKILL.md YAML frontmatter contains required name and description fields.
 */
function validateSkillMdFrontmatter(content: string): string[] {
  const errors: string[] = [];
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);

  if (!frontmatterMatch) {
    errors.push('SKILL.md 缺少 YAML frontmatter（--- 分隔符）');
    return errors;
  }

  const frontmatter = frontmatterMatch[1];

  if (!/^name\s*:/m.test(frontmatter)) {
    errors.push('SKILL.md frontmatter 缺少 name 字段');
  }

  if (!/^description\s*:/m.test(frontmatter)) {
    errors.push('SKILL.md frontmatter 缺少 description 字段');
  }

  return errors;
}

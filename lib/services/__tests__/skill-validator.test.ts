/**
 * Unit tests for skill-validator.ts
 * Validates: Requirements 7.3, 7.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { validateApiSkillDir, validateScriptSkillDir } from '../skill-validator';

let tmpDir: string;

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-validator-test-'));
}

function writeFile(dir: string, relativePath: string, content: string) {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

const VALID_SKILL_MD = `---
name: test-skill
description: "A test skill"
---

# Test Skill
`;

const VALID_ENDPOINTS = JSON.stringify({
  skillName: 'test-skill',
  displayName: 'Test Skill',
  description: 'A test skill',
  auth: { authType: 'none' },
  endpoints: [{ method: 'GET', path: '/api/test', description: 'Test endpoint' }],
});

const VALID_MAIN_PY = `from fastapi import FastAPI\napp = FastAPI()\n`;
const VALID_REQUIREMENTS = `fastapi==0.104.1\n`;

beforeEach(() => {
  tmpDir = createTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('validateApiSkillDir', () => {
  it('should pass for a valid API Skill directory', () => {
    writeFile(tmpDir, 'SKILL.md', VALID_SKILL_MD);
    writeFile(tmpDir, 'api-endpoints.json', VALID_ENDPOINTS);
    writeFile(tmpDir, 'app/main.py', VALID_MAIN_PY);
    writeFile(tmpDir, 'requirements.txt', VALID_REQUIREMENTS);

    const result = validateApiSkillDir(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when SKILL.md is missing', () => {
    writeFile(tmpDir, 'api-endpoints.json', VALID_ENDPOINTS);
    writeFile(tmpDir, 'app/main.py', VALID_MAIN_PY);
    writeFile(tmpDir, 'requirements.txt', VALID_REQUIREMENTS);

    const result = validateApiSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('缺少 SKILL.md 文件');
  });

  it('should fail when api-endpoints.json is missing', () => {
    writeFile(tmpDir, 'SKILL.md', VALID_SKILL_MD);
    writeFile(tmpDir, 'app/main.py', VALID_MAIN_PY);
    writeFile(tmpDir, 'requirements.txt', VALID_REQUIREMENTS);

    const result = validateApiSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('缺少 api-endpoints.json 文件');
  });

  it('should fail when app/main.py is missing', () => {
    writeFile(tmpDir, 'SKILL.md', VALID_SKILL_MD);
    writeFile(tmpDir, 'api-endpoints.json', VALID_ENDPOINTS);
    writeFile(tmpDir, 'requirements.txt', VALID_REQUIREMENTS);

    const result = validateApiSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('缺少 app/main.py 文件');
  });

  it('should fail when requirements.txt is missing', () => {
    writeFile(tmpDir, 'SKILL.md', VALID_SKILL_MD);
    writeFile(tmpDir, 'api-endpoints.json', VALID_ENDPOINTS);
    writeFile(tmpDir, 'app/main.py', VALID_MAIN_PY);

    const result = validateApiSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('缺少 requirements.txt 文件');
  });

  it('should fail when SKILL.md has no frontmatter', () => {
    writeFile(tmpDir, 'SKILL.md', '# No frontmatter\n');
    writeFile(tmpDir, 'api-endpoints.json', VALID_ENDPOINTS);
    writeFile(tmpDir, 'app/main.py', VALID_MAIN_PY);
    writeFile(tmpDir, 'requirements.txt', VALID_REQUIREMENTS);

    const result = validateApiSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('frontmatter'))).toBe(true);
  });

  it('should fail when SKILL.md frontmatter lacks name', () => {
    writeFile(tmpDir, 'SKILL.md', '---\ndescription: "test"\n---\n');
    writeFile(tmpDir, 'api-endpoints.json', VALID_ENDPOINTS);
    writeFile(tmpDir, 'app/main.py', VALID_MAIN_PY);
    writeFile(tmpDir, 'requirements.txt', VALID_REQUIREMENTS);

    const result = validateApiSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('name'))).toBe(true);
  });

  it('should fail when api-endpoints.json lacks skillName', () => {
    writeFile(tmpDir, 'SKILL.md', VALID_SKILL_MD);
    writeFile(tmpDir, 'api-endpoints.json', JSON.stringify({ endpoints: [] }));
    writeFile(tmpDir, 'app/main.py', VALID_MAIN_PY);
    writeFile(tmpDir, 'requirements.txt', VALID_REQUIREMENTS);

    const result = validateApiSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('skillName'))).toBe(true);
  });

  it('should fail when api-endpoints.json is invalid JSON', () => {
    writeFile(tmpDir, 'SKILL.md', VALID_SKILL_MD);
    writeFile(tmpDir, 'api-endpoints.json', 'not json');
    writeFile(tmpDir, 'app/main.py', VALID_MAIN_PY);
    writeFile(tmpDir, 'requirements.txt', VALID_REQUIREMENTS);

    const result = validateApiSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('JSON'))).toBe(true);
  });
});

describe('validateScriptSkillDir', () => {
  it('should pass for a valid Script Skill directory', () => {
    writeFile(tmpDir, 'SKILL.md', VALID_SKILL_MD);
    writeFile(tmpDir, 'scripts/action.py', '#!/usr/bin/env python3\nprint("ok")\n');

    const result = validateScriptSkillDir(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when SKILL.md is missing', () => {
    writeFile(tmpDir, 'scripts/action.py', 'print("ok")\n');

    const result = validateScriptSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('缺少 SKILL.md 文件');
  });

  it('should fail when scripts/ directory is missing', () => {
    writeFile(tmpDir, 'SKILL.md', VALID_SKILL_MD);

    const result = validateScriptSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('缺少 scripts/ 目录');
  });

  it('should fail when scripts/ has no .py files', () => {
    writeFile(tmpDir, 'SKILL.md', VALID_SKILL_MD);
    writeFile(tmpDir, 'scripts/readme.txt', 'not a python file');

    const result = validateScriptSkillDir(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('scripts/ 目录下没有 .py 文件');
  });
});

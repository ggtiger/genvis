/**
 * Property tests for skill-validator.ts
 *
 * Feature: auto-skill-development
 * Property 3: API Skill 目录完整性
 * Property 4: Script Skill 目录完整性
 *
 * Validates: Requirements 7.3, 7.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { validateApiSkillDir, validateScriptSkillDir } from '../skill-validator';

let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-prop-'));
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

function writeFile(dir: string, relativePath: string, content: string) {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

const validSkillMd = (name: string) =>
  `---\nname: ${name}\ndescription: "test skill"\n---\n# ${name}\n`;

const validEndpoints = (name: string) =>
  JSON.stringify({
    skillName: name,
    displayName: name,
    description: 'test',
    auth: { authType: 'none' },
    endpoints: [{ method: 'GET', path: '/api/test', description: 'test' }],
  });

// Arbitrary for valid skill names (lowercase, dashes, 3-20 chars)
const skillNameArb = fc.string({ minLength: 3, maxLength: 20 })
  .map(s => s.toLowerCase().replace(/[^a-z-]/g, 'a').replace(/^-/, 'a').replace(/-$/, 'a').replace(/--+/g, '-'))
  .filter(s => s.length >= 3 && /^[a-z]/.test(s));

describe('Feature: auto-skill-development, Property 3: API Skill 目录完整性', () => {
  /**
   * For any valid API Skill directory containing all required files,
   * validateApiSkillDir should return valid: true.
   */
  it('complete API Skill directories always pass validation', () => {
    fc.assert(
      fc.property(skillNameArb, (name) => {
        const dir = path.join(tmpBase, `api-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
        fs.mkdirSync(dir, { recursive: true });

        writeFile(dir, 'SKILL.md', validSkillMd(name));
        writeFile(dir, 'api-endpoints.json', validEndpoints(name));
        writeFile(dir, 'app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
        writeFile(dir, 'requirements.txt', 'fastapi==0.104.1\n');

        const result = validateApiSkillDir(dir);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * For any subset of required files that is missing at least one file,
   * validateApiSkillDir should return valid: false.
   */
  it('incomplete API Skill directories always fail validation', () => {
    // 4 required files: SKILL.md, api-endpoints.json, app/main.py, requirements.txt
    // Generate a bitmask 0-14 (at least one file missing, not all 4 present = 0b1111 = 15)
    const subsetArb = fc.integer({ min: 0, max: 14 });

    fc.assert(
      fc.property(skillNameArb, subsetArb, (name, mask) => {
        const dir = path.join(tmpBase, `api-inc-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
        fs.mkdirSync(dir, { recursive: true });

        if (mask & 1) writeFile(dir, 'SKILL.md', validSkillMd(name));
        if (mask & 2) writeFile(dir, 'api-endpoints.json', validEndpoints(name));
        if (mask & 4) writeFile(dir, 'app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
        if (mask & 8) writeFile(dir, 'requirements.txt', 'fastapi==0.104.1\n');

        const result = validateApiSkillDir(dir);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: auto-skill-development, Property 4: Script Skill 目录完整性', () => {
  /**
   * For any valid Script Skill directory containing SKILL.md and at least one .py in scripts/,
   * validateScriptSkillDir should return valid: true.
   */
  it('complete Script Skill directories always pass validation', () => {
    fc.assert(
      fc.property(skillNameArb, (name) => {
        const dir = path.join(tmpBase, `script-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
        fs.mkdirSync(dir, { recursive: true });

        writeFile(dir, 'SKILL.md', validSkillMd(name));
        writeFile(dir, 'scripts/action.py', '#!/usr/bin/env python3\nprint("ok")\n');

        const result = validateScriptSkillDir(dir);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * For any Script Skill directory missing SKILL.md or scripts/*.py,
   * validateScriptSkillDir should return valid: false.
   */
  it('incomplete Script Skill directories always fail validation', () => {
    // 2 required: SKILL.md, scripts/*.py — mask 0-2 (not 3)
    const subsetArb = fc.integer({ min: 0, max: 2 });

    fc.assert(
      fc.property(skillNameArb, subsetArb, (name, mask) => {
        const dir = path.join(tmpBase, `script-inc-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
        fs.mkdirSync(dir, { recursive: true });

        if (mask & 1) writeFile(dir, 'SKILL.md', validSkillMd(name));
        if (mask & 2) writeFile(dir, 'scripts/action.py', 'print("ok")\n');

        const result = validateScriptSkillDir(dir);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

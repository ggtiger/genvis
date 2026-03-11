/**
 * Integration tests for auto-skill-development feature
 *
 * Task 6.1: Secretary dispatch to generalist when skill doesn't exist
 * Task 6.2: Verify builtin-employees.json and SKILL.md completeness
 *
 * Validates: Requirements 1.1-1.5, 2.1, 2.2, 2.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// ── Task 6.2: Static file completeness ──

describe('builtin-employees.json completeness', () => {
  const raw = fs.readFileSync(
    path.join(process.cwd(), 'builtin-employees.json'),
    'utf-8'
  );
  const data = JSON.parse(raw);

  it('should contain builtin-skill-generalist employee (Req 1.1)', () => {
    const generalist = data.employees.find(
      (e: any) => e.id === 'builtin-skill-generalist'
    );
    expect(generalist).toBeDefined();
    expect(generalist.name).toBe('通才技能专家');
    expect(generalist.mode).toBe('code');
    expect(generalist.category).toBe('engineering');
    expect(generalist.is_builtin).toBe(true);
  });

  it('should have a non-empty system_prompt_plan and system_prompt_execution for generalist (Req 1.2)', () => {
    const generalist = data.employees.find(
      (e: any) => e.id === 'builtin-skill-generalist'
    );
    // mode: "code" employees use plan + execution prompts, not system_prompt
    expect(generalist.system_prompt_plan.length).toBeGreaterThan(100);
    expect(generalist.system_prompt_execution.length).toBeGreaterThan(100);
    // Plan prompt should contain analysis keywords
    expect(generalist.system_prompt_plan).toContain('需求');
    // Execution prompt should contain skill creation keywords
    expect(generalist.system_prompt_execution).toContain('SKILL.md');
    expect(generalist.system_prompt_execution).toContain('api-endpoints.json');
  });

  it('should reference generalist in secretary system_prompt (Req 1.5)', () => {
    const secretary = data.employees.find(
      (e: any) => e.id === 'builtin-secretary'
    );
    expect(secretary.system_prompt).toContain('builtin-skill-generalist');
    expect(secretary.system_prompt).toContain('通才技能专家');
  });
});

describe('skills/skill-generalist/SKILL.md completeness', () => {
  const skillMdPath = path.join(
    process.cwd(),
    'skills',
    'skill-generalist',
    'SKILL.md'
  );

  it('should exist (Req 1.3)', () => {
    expect(fs.existsSync(skillMdPath)).toBe(true);
  });

  it('should have valid YAML frontmatter with name and description (Req 1.3)', () => {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(match).not.toBeNull();

    const frontmatter = match![1];
    expect(frontmatter).toMatch(/^name\s*:/m);
    expect(frontmatter).toMatch(/^description\s*:/m);
  });

  it('should NOT have projectType in frontmatter (Req 1.4)', () => {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    const frontmatter = match![1];
    expect(frontmatter).not.toMatch(/projectType/);
  });

  it('should contain API Skill and Script Skill templates', () => {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    expect(content).toContain('api-endpoints.json');
    expect(content).toContain('app/main.py');
    expect(content).toContain('scripts/');
    expect(content).toContain('requirements.txt');
  });
});

// ── Task 6.1: Secretary dispatch to generalist ──

describe('secretary-core executeSkillCall generalist fallback', () => {
  // We test the logic by importing and mocking dependencies
  beforeEach(() => {
    vi.resetModules();
  });

  it('should dispatch to generalist when skill not in registry (Req 2.1, 2.2)', async () => {
    // Mock dependencies
    vi.doMock('@/lib/services/api-skill-registry', () => ({
      loadRegistry: vi.fn().mockResolvedValue({ version: 1, skills: [], updatedAt: '' }),
      getSkillByName: vi.fn().mockReturnValue(undefined),
    }));

    const mockDispatch = vi.fn().mockResolvedValue({
      success: true,
      projectId: 'test-project',
      employeeId: 'builtin-skill-generalist',
      employeeName: '通才技能专家',
    });
    vi.doMock('@/lib/services/secretary-dispatch', () => ({
      dispatchToEmployee: mockDispatch,
    }));

    vi.doMock('@/lib/services/settings', () => ({
      loadGlobalSettings: vi.fn().mockResolvedValue({}),
    }));

    vi.doMock('@/lib/services/employee-service', () => ({
      getEmployeeById: vi.fn(),
      getAllEmployees: vi.fn(),
    }));

    vi.doMock('@/lib/services/secretary-skill-caller', () => ({
      callSkillApi: vi.fn(),
    }));

    vi.doMock('@/lib/services/api-skill-prompt', () => ({
      buildApiSkillPromptBlock: vi.fn().mockReturnValue(''),
    }));

    vi.doMock('@/lib/services/secretary-result-formatter', () => ({
      formatSkillResult: vi.fn(),
    }));

    const { executeSkillCall } = await import('../secretary-core');

    const result = await executeSkillCall({
      action: 'skill_call',
      skillName: 'nonexistent-skill',
      method: 'POST',
      path: '/api/generate',
      body: { content: 'test' },
    });

    // Should have dispatched to generalist
    expect(mockDispatch).toHaveBeenCalledWith(
      'builtin-skill-generalist',
      expect.stringContaining('nonexistent-skill')
    );

    // Result should indicate dispatch
    expect(result.reply).toContain('通才技能专家');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('dispatch');
    expect(result.actions[0].employeeId).toBe('builtin-skill-generalist');
  });

  it('should include original request info in dispatch instruction (Req 2.4)', async () => {
    vi.doMock('@/lib/services/api-skill-registry', () => ({
      loadRegistry: vi.fn().mockResolvedValue({ version: 1, skills: [], updatedAt: '' }),
      getSkillByName: vi.fn().mockReturnValue(undefined),
    }));

    const mockDispatch = vi.fn().mockResolvedValue({
      success: true,
      projectId: 'test-project',
      employeeId: 'builtin-skill-generalist',
      employeeName: '通才技能专家',
    });
    vi.doMock('@/lib/services/secretary-dispatch', () => ({
      dispatchToEmployee: mockDispatch,
    }));

    vi.doMock('@/lib/services/settings', () => ({
      loadGlobalSettings: vi.fn().mockResolvedValue({}),
    }));
    vi.doMock('@/lib/services/employee-service', () => ({
      getEmployeeById: vi.fn(),
      getAllEmployees: vi.fn(),
    }));
    vi.doMock('@/lib/services/secretary-skill-caller', () => ({
      callSkillApi: vi.fn(),
    }));
    vi.doMock('@/lib/services/api-skill-prompt', () => ({
      buildApiSkillPromptBlock: vi.fn().mockReturnValue(''),
    }));
    vi.doMock('@/lib/services/secretary-result-formatter', () => ({
      formatSkillResult: vi.fn(),
    }));

    const { executeSkillCall } = await import('../secretary-core');

    await executeSkillCall({
      action: 'skill_call',
      skillName: 'qrcode-generator',
      method: 'POST',
      path: '/api/generate',
      body: { content: 'https://example.com' },
    });

    const instruction = mockDispatch.mock.calls[0][1];
    expect(instruction).toContain('qrcode-generator');
    expect(instruction).toContain('POST');
    expect(instruction).toContain('/api/generate');
    expect(instruction).toContain('https://example.com');
  });
});

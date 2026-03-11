import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Unit tests for secretary-dispatch service.
 * Validates: Requirements 3.1, 3.2
 *
 * Tests cover:
 * - Employee lookup and validation
 * - Project creation with correct employee_id and mode
 * - Auto-start trigger (fire and forget)
 * - Error handling for missing employees
 * - Error handling for project creation failures
 * - DispatchResult structure
 */

// Mock employee data
const mockEmployee = {
  id: 'emp-ppt',
  name: 'PPT制作助手',
  description: 'PPT specialist',
  category: 'engineering' as const,
  mode: 'work' as const,
  system_prompt: 'You are a PPT assistant',
  is_builtin: true,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

const mockCodeEmployee = {
  id: 'emp-dev',
  name: 'Python全栈工程师',
  description: 'Full-stack developer',
  category: 'engineering' as const,
  mode: 'code' as const,
  system_prompt: 'You are a developer',
  is_builtin: true,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

const mockSecretaryEmployee = {
  id: 'builtin-secretary',
  name: '秘书',
  description: 'Secretary',
  category: 'admin' as const,
  mode: 'secretary' as const,
  system_prompt: 'You are a secretary',
  is_builtin: true,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

// Mock getEmployeeById
const mockGetEmployeeById = vi.fn();
vi.mock('../employee-service', () => ({
  getEmployeeById: (...args: any[]) => mockGetEmployeeById(...args),
}));

// Mock createProject
const mockCreateProject = vi.fn();
vi.mock('../project', () => ({
  createProject: (...args: any[]) => mockCreateProject(...args),
}));

// Import after mocks
import { dispatchToEmployee, type DispatchResult } from '../secretary-dispatch';

describe('secretary-dispatch service', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    // Default: fetch succeeds (fire and forget for auto-start)
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('employee lookup', () => {
    it('should return error when employee is not found', async () => {
      mockGetEmployeeById.mockResolvedValue(null);

      const result = await dispatchToEmployee('nonexistent-emp', 'Do something');

      expect(result.success).toBe(false);
      expect(result.employeeId).toBe('nonexistent-emp');
      expect(result.employeeName).toBe('');
      expect(result.error).toContain('员工不存在');
      expect(result.projectId).toBeUndefined();
    });

    it('should return error when employee lookup throws', async () => {
      mockGetEmployeeById.mockRejectedValue(new Error('DB connection failed'));

      const result = await dispatchToEmployee('emp-ppt', 'Do something');

      expect(result.success).toBe(false);
      expect(result.employeeId).toBe('emp-ppt');
      expect(result.employeeName).toBe('');
      expect(result.error).toContain('查找员工失败');
      expect(result.error).toContain('DB connection failed');
    });

    it('should call getEmployeeById with the correct employee ID', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockResolvedValue({ id: 'test-project' });

      await dispatchToEmployee('emp-ppt', 'Make a presentation');

      expect(mockGetEmployeeById).toHaveBeenCalledWith('emp-ppt');
    });
  });

  describe('project creation', () => {
    it('should create project with correct employee_id', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-123' });

      await dispatchToEmployee('emp-ppt', 'Create a PPT');

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          employee_id: 'emp-ppt',
        })
      );
    });

    it('should create project with initialPrompt set to the instruction', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-123' });

      const instruction = 'Create a presentation about AI';
      await dispatchToEmployee('emp-ppt', instruction);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          initialPrompt: instruction,
        })
      );
    });

    it('should use employee mode for project mode (work employee)', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-123' });

      await dispatchToEmployee('emp-ppt', 'Create a PPT');

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'work',
        })
      );
    });

    it('should use employee mode for project mode (code employee)', async () => {
      mockGetEmployeeById.mockResolvedValue(mockCodeEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-123' });

      await dispatchToEmployee('emp-dev', 'Build a web app');

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'code',
        })
      );
    });

    it('should fallback to work mode when dispatching to a secretary employee', async () => {
      mockGetEmployeeById.mockResolvedValue(mockSecretaryEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-123' });

      await dispatchToEmployee('builtin-secretary', 'Do something');

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'work',
        })
      );
    });

    it('should generate a project name with employee name and truncated instruction', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-123' });

      const longInstruction = 'This is a very long instruction that exceeds thirty characters';
      await dispatchToEmployee('emp-ppt', longInstruction);

      const callArgs = mockCreateProject.mock.calls[0][0];
      expect(callArgs.name).toContain('PPT制作助手');
      expect(callArgs.name).toContain('...');
    });

    it('should not truncate short instructions in project name', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-123' });

      const shortInstruction = 'Make a PPT';
      await dispatchToEmployee('emp-ppt', shortInstruction);

      const callArgs = mockCreateProject.mock.calls[0][0];
      expect(callArgs.name).toBe('PPT制作助手 - Make a PPT');
      expect(callArgs.name).not.toContain('...');
    });

    it('should generate project_id starting with dispatch-', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-123' });

      await dispatchToEmployee('emp-ppt', 'Create a PPT');

      const callArgs = mockCreateProject.mock.calls[0][0];
      expect(callArgs.project_id).toMatch(/^dispatch-/);
    });
  });

  describe('auto-start trigger', () => {
    it('should call fetch to trigger the act API after project creation', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-proj-1' });

      await dispatchToEmployee('emp-ppt', 'Create a PPT');

      // Wait for the fire-and-forget fetch to be called
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalled();
      });

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/api/chat/dispatch-proj-1/act');
      expect(fetchCall[1].method).toBe('POST');

      const body = JSON.parse(fetchCall[1].body);
      expect(body.instruction).toBe('Create a PPT');
      expect(body.isInitialPrompt).toBe(true);
    });

    it('should not fail if auto-start fetch fails', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-proj-2' });
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await dispatchToEmployee('emp-ppt', 'Create a PPT');

      // The dispatch should still succeed even if auto-start fails
      expect(result.success).toBe(true);
      expect(result.projectId).toBe('dispatch-proj-2');
    });
  });

  describe('successful dispatch result', () => {
    it('should return success with projectId, employeeId, and employeeName', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockResolvedValue({ id: 'dispatch-proj-3' });

      const result = await dispatchToEmployee('emp-ppt', 'Create a PPT');

      expect(result.success).toBe(true);
      expect(result.projectId).toBe('dispatch-proj-3');
      expect(result.employeeId).toBe('emp-ppt');
      expect(result.employeeName).toBe('PPT制作助手');
      expect(result.error).toBeUndefined();
    });
  });

  describe('error handling - project creation failure', () => {
    it('should return error when createProject throws', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockRejectedValue(new Error('Database write failed'));

      const result = await dispatchToEmployee('emp-ppt', 'Create a PPT');

      expect(result.success).toBe(false);
      expect(result.employeeId).toBe('emp-ppt');
      expect(result.employeeName).toBe('PPT制作助手');
      expect(result.error).toContain('创建项目失败');
      expect(result.error).toContain('Database write failed');
      expect(result.projectId).toBeUndefined();
    });

    it('should handle non-Error exceptions in project creation', async () => {
      mockGetEmployeeById.mockResolvedValue(mockEmployee);
      mockCreateProject.mockRejectedValue('string error');

      const result = await dispatchToEmployee('emp-ppt', 'Create a PPT');

      expect(result.success).toBe(false);
      expect(result.error).toContain('创建项目失败');
      expect(result.error).toContain('未知错误');
    });
  });
});

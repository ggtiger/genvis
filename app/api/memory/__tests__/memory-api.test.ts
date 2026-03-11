import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Unit tests for Memory Management API (app/api/memory/route.ts)
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 *
 * Tests cover:
 * - GET returns grouped memory data
 * - PUT updates specific entry
 * - DELETE removes specific entry
 * - DELETE without params clears all
 * - Invalid params return 400
 */

// ========== Mocks ==========

const mockLoadMemory = vi.fn();
const mockSaveMemory = vi.fn();
const mockUpsertEntry = vi.fn();
const mockDeleteEntry = vi.fn();
const mockClearAllEntries = vi.fn();

vi.mock('@/lib/services/secretary-memory', () => ({
  loadMemory: (...args: any[]) => mockLoadMemory(...args),
  saveMemory: (...args: any[]) => mockSaveMemory(...args),
  upsertEntry: (...args: any[]) => mockUpsertEntry(...args),
  deleteEntry: (...args: any[]) => mockDeleteEntry(...args),
  clearAllEntries: (...args: any[]) => mockClearAllEntries(...args),
}));

// Import route handlers after mocks
import { GET, PUT, DELETE } from '../route';

// ========== Helpers ==========

function createMemoryData(overrides = {}) {
  return {
    version: 1 as const,
    user_profile: [
      {
        key: 'job_title',
        value: '产品经理',
        source: '用户说"我是产品经理"',
        createdAt: '2026-02-08T10:00:00.000Z',
        updatedAt: '2026-02-08T10:00:00.000Z',
      },
    ],
    learned_preference: [
      {
        key: 'ppt_style',
        value: '商务蓝',
        source: '用户说"我喜欢商务蓝PPT风格"',
        createdAt: '2026-02-08T11:00:00.000Z',
        updatedAt: '2026-02-08T11:00:00.000Z',
      },
    ],
    interaction_pattern: [],
    updatedAt: '2026-02-08T11:00:00.000Z',
    ...overrides,
  };
}

function createPutRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/memory', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/memory');
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url.toString(), { method: 'DELETE' });
}

// ========== Tests ==========

describe('Memory API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveMemory.mockResolvedValue(undefined);
  });

  // ---- GET /api/memory ----

  describe('GET /api/memory', () => {
    it('should return grouped memory data with success: true', async () => {
      const memoryData = createMemoryData();
      mockLoadMemory.mockResolvedValue(memoryData);

      const response = await GET();
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toEqual(memoryData);
      expect(json.data.user_profile).toHaveLength(1);
      expect(json.data.learned_preference).toHaveLength(1);
      expect(json.data.interaction_pattern).toHaveLength(0);
    });

    it('should return empty memory structure when no entries exist', async () => {
      const emptyMemory = createMemoryData({
        user_profile: [],
        learned_preference: [],
        interaction_pattern: [],
      });
      mockLoadMemory.mockResolvedValue(emptyMemory);

      const response = await GET();
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.user_profile).toEqual([]);
      expect(json.data.learned_preference).toEqual([]);
      expect(json.data.interaction_pattern).toEqual([]);
    });
  });

  // ---- PUT /api/memory ----

  describe('PUT /api/memory', () => {
    it('should update a specific entry and return updated memory', async () => {
      const memoryData = createMemoryData();
      const updatedMemory = createMemoryData({
        user_profile: [
          {
            key: 'job_title',
            value: '产品经理',
            source: '用户手动编辑',
            createdAt: '2026-02-08T10:00:00.000Z',
            updatedAt: '2026-02-08T12:00:00.000Z',
          },
        ],
      });

      mockLoadMemory.mockResolvedValue(memoryData);
      mockUpsertEntry.mockReturnValue(updatedMemory);

      const request = createPutRequest({
        category: 'user_profile',
        key: 'job_title',
        value: '产品经理',
      });

      const response = await PUT(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toEqual(updatedMemory);
      expect(mockUpsertEntry).toHaveBeenCalledWith(memoryData, 'user_profile', {
        key: 'job_title',
        value: '产品经理',
        source: '用户手动编辑',
      });
      expect(mockSaveMemory).toHaveBeenCalledWith(updatedMemory);
    });

    it('should return 400 when category is missing', async () => {
      const request = createPutRequest({ key: 'job_title', value: '产品经理' });

      const response = await PUT(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('无效的记忆类别');
    });

    it('should return 400 when category is invalid', async () => {
      const request = createPutRequest({
        category: 'invalid_category',
        key: 'job_title',
        value: '产品经理',
      });

      const response = await PUT(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('无效的记忆类别');
    });

    it('should return 400 when key is missing', async () => {
      const request = createPutRequest({
        category: 'user_profile',
        value: '产品经理',
      });

      const response = await PUT(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('缺少记忆键名');
    });

    it('should return 400 when key is empty string', async () => {
      const request = createPutRequest({
        category: 'user_profile',
        key: '   ',
        value: '产品经理',
      });

      const response = await PUT(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('缺少记忆键名');
    });

    it('should return 400 when value is missing', async () => {
      const request = createPutRequest({
        category: 'user_profile',
        key: 'job_title',
      });

      const response = await PUT(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('缺少记忆值');
    });

    it('should return 400 when value is empty string', async () => {
      const request = createPutRequest({
        category: 'user_profile',
        key: 'job_title',
        value: '',
      });

      const response = await PUT(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('缺少记忆值');
    });

    it('should trim key and value before upserting', async () => {
      const memoryData = createMemoryData();
      const updatedMemory = createMemoryData();

      mockLoadMemory.mockResolvedValue(memoryData);
      mockUpsertEntry.mockReturnValue(updatedMemory);

      const request = createPutRequest({
        category: 'learned_preference',
        key: '  ppt_style  ',
        value: '  商务蓝  ',
      });

      await PUT(request);

      expect(mockUpsertEntry).toHaveBeenCalledWith(memoryData, 'learned_preference', {
        key: 'ppt_style',
        value: '商务蓝',
        source: '用户手动编辑',
      });
    });
  });

  // ---- DELETE /api/memory ----

  describe('DELETE /api/memory', () => {
    it('should remove a specific entry when category and key are provided', async () => {
      const memoryData = createMemoryData();
      const updatedMemory = createMemoryData({ user_profile: [] });

      mockLoadMemory.mockResolvedValue(memoryData);
      mockDeleteEntry.mockReturnValue(updatedMemory);

      const request = createDeleteRequest({ category: 'user_profile', key: 'job_title' });

      const response = await DELETE(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockDeleteEntry).toHaveBeenCalledWith(memoryData, 'user_profile', 'job_title');
      expect(mockSaveMemory).toHaveBeenCalledWith(updatedMemory);
    });

    it('should clear all entries when no params are provided', async () => {
      const emptyMemory = createMemoryData({
        user_profile: [],
        learned_preference: [],
        interaction_pattern: [],
      });
      mockClearAllEntries.mockReturnValue(emptyMemory);

      const request = createDeleteRequest();

      const response = await DELETE(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockClearAllEntries).toHaveBeenCalled();
      expect(mockSaveMemory).toHaveBeenCalledWith(emptyMemory);
    });

    it('should return 400 when only category is provided without key', async () => {
      const request = createDeleteRequest({ category: 'user_profile' });

      const response = await DELETE(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('参数不完整');
    });

    it('should return 400 when only key is provided without category', async () => {
      const request = createDeleteRequest({ key: 'job_title' });

      const response = await DELETE(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('参数不完整');
    });

    it('should return 400 when category is invalid', async () => {
      const request = createDeleteRequest({ category: 'bad_category', key: 'job_title' });

      const response = await DELETE(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('无效的记忆类别');
    });
  });
});

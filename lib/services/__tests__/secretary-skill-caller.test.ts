import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Unit tests for secretary-skill-caller service.
 * Validates: Requirements 4.1, 4.2, 4.5
 *
 * Tests cover:
 * - Port resolution from the projects table
 * - URL construction with path and query parameters
 * - HTTP method support (GET/POST/PUT/DELETE)
 * - 5-second timeout handling
 * - Error handling for missing/stopped skills
 * - Successful API call responses
 */

// Shared mock state
const mockLimitFn = vi.fn();
const mockWhereFn = vi.fn().mockReturnValue({ limit: mockLimitFn });
const mockFromFn = vi.fn().mockReturnValue({ where: mockWhereFn });
const mockSelectFn = vi.fn().mockReturnValue({ from: mockFromFn });

// Mock the database module before any imports
vi.mock('@/lib/db/client', () => ({
  db: {
    select: (...args: any[]) => mockSelectFn(...args),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  projects: {
    previewPort: 'preview_port',
    id: 'id',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: any, val: any) => ({ col, val })),
}));

// Import after mocks are set up
import { callSkillApi } from '../secretary-skill-caller';
import { eq } from 'drizzle-orm';

function setupDbMock(previewPort: number | null, found: boolean = true) {
  mockLimitFn.mockResolvedValue(found ? [{ previewPort }] : []);
}

describe('secretary-skill-caller service', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    // Reset the mock chain
    mockSelectFn.mockReturnValue({ from: mockFromFn });
    mockFromFn.mockReturnValue({ where: mockWhereFn });
    mockWhereFn.mockReturnValue({ limit: mockLimitFn });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('callSkillApi - port resolution', () => {
    it('should return error when skill project is not found in database', async () => {
      setupDbMock(null, false);

      const result = await callSkillApi('nonexistent-skill', 'GET', '/api/test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('当前未运行');
      expect(result.code).toBe('SKILL_NOT_RUNNING');
    });

    it('should return error when skill project exists but has no previewPort', async () => {
      setupDbMock(null, true);

      const result = await callSkillApi('productivity-hub', 'GET', '/api/todos');

      expect(result.success).toBe(false);
      expect(result.error).toContain('当前未运行');
      expect(result.code).toBe('SKILL_NOT_RUNNING');
    });

    it('should query the projects table with correct skill project id', async () => {
      setupDbMock(3001);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ items: [] }),
      });

      await callSkillApi('productivity-hub', 'GET', '/api/todos');

      // Verify eq was called with the correct project id pattern
      expect(eq).toHaveBeenCalledWith(
        expect.anything(),
        'skill-productivity-hub'
      );
    });
  });

  describe('callSkillApi - URL construction', () => {
    it('should construct correct URL with port and path', async () => {
      setupDbMock(3001);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ data: 'test' }),
      });

      await callSkillApi('productivity-hub', 'GET', '/api/todos');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/todos',
        expect.any(Object)
      );
    });

    it('should append query parameters to the URL', async () => {
      setupDbMock(3001);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ data: 'test' }),
      });

      await callSkillApi('productivity-hub', 'GET', '/api/todos', undefined, {
        status: 'pending',
        limit: '10',
      });

      const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
      expect(calledUrl).toContain('http://localhost:3001/api/todos?');
      expect(calledUrl).toContain('status=pending');
      expect(calledUrl).toContain('limit=10');
    });

    it('should not append query string when queryParams is empty', async () => {
      setupDbMock(4500);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({}),
      });

      await callSkillApi('my-skill', 'GET', '/api/data', undefined, {});

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:4500/api/data',
        expect.any(Object)
      );
    });
  });

  describe('callSkillApi - HTTP methods', () => {
    beforeEach(() => {
      setupDbMock(3001);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ success: true }),
      });
    });

    it('should send GET request without body', async () => {
      await callSkillApi('productivity-hub', 'GET', '/api/todos');

      const fetchOptions = (globalThis.fetch as any).mock.calls[0][1];
      expect(fetchOptions.method).toBe('GET');
      expect(fetchOptions.body).toBeUndefined();
    });

    it('should send POST request with JSON body', async () => {
      const body = { title: '新待办', status: 'pending' };
      await callSkillApi('productivity-hub', 'POST', '/api/todos', body);

      const fetchOptions = (globalThis.fetch as any).mock.calls[0][1];
      expect(fetchOptions.method).toBe('POST');
      expect(fetchOptions.body).toBe(JSON.stringify(body));
      expect(fetchOptions.headers['Content-Type']).toBe('application/json');
    });

    it('should send PUT request with JSON body', async () => {
      const body = { title: '更新待办', status: 'completed' };
      await callSkillApi('productivity-hub', 'PUT', '/api/todos/1', body);

      const fetchOptions = (globalThis.fetch as any).mock.calls[0][1];
      expect(fetchOptions.method).toBe('PUT');
      expect(fetchOptions.body).toBe(JSON.stringify(body));
    });

    it('should send DELETE request', async () => {
      await callSkillApi('productivity-hub', 'DELETE', '/api/todos/1');

      const fetchOptions = (globalThis.fetch as any).mock.calls[0][1];
      expect(fetchOptions.method).toBe('DELETE');
    });
  });

  describe('callSkillApi - successful responses', () => {
    it('should return success with JSON data', async () => {
      setupDbMock(3001);

      const responseData = { items: [{ id: 1, title: 'Test todo' }] };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue(responseData),
      });

      const result = await callSkillApi('productivity-hub', 'GET', '/api/todos');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(responseData);
      expect(result.error).toBeUndefined();
    });

    it('should return success with text data for non-JSON responses', async () => {
      setupDbMock(3001);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: vi.fn().mockResolvedValue('OK'),
      });

      const result = await callSkillApi('productivity-hub', 'GET', '/health');

      expect(result.success).toBe(true);
      expect(result.data).toBe('OK');
    });
  });

  describe('callSkillApi - error handling', () => {
    it('should return error for non-OK HTTP responses', async () => {
      setupDbMock(3001);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ message: 'Not found' }),
      });

      const result = await callSkillApi('productivity-hub', 'GET', '/api/nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('should return timeout error when request exceeds 5 seconds', async () => {
      setupDbMock(3001);

      // Mock fetch to never resolve, simulating a hung request.
      // The AbortController signal will fire after 5 seconds.
      globalThis.fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        return new Promise((_resolve, reject) => {
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            });
          }
        });
      });

      // Let the real 5-second timeout fire (increase test timeout to accommodate)
      const result = await callSkillApi('productivity-hub', 'GET', '/api/slow');

      expect(result.success).toBe(false);
      expect(result.error).toContain('超时');
    }, 10000);

    it('should return connection error when skill is not actually running', async () => {
      setupDbMock(3001);

      const connError = new Error('fetch failed: ECONNREFUSED');
      globalThis.fetch = vi.fn().mockRejectedValue(connError);

      const result = await callSkillApi('productivity-hub', 'GET', '/api/todos');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle generic errors gracefully', async () => {
      setupDbMock(3001);

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Unexpected error'));

      const result = await callSkillApi('productivity-hub', 'GET', '/api/todos');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unexpected error');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Unit tests for the auto-start API route handlers.
 * Validates: Requirements 4.1, 4.2, 4.3
 *
 * Tests cover:
 * - GET handler: returns auto-start status
 * - POST handler: sets auto-start status with proper validation
 * - Error handling: 404 for missing skills, 400 for non-App skills, 400 for invalid body
 */

// Mock the skill-service module
vi.mock('@/lib/services/skill-service', () => ({
  isSkillAutoStart: vi.fn(),
  setSkillAutoStart: vi.fn(),
}));

import { isSkillAutoStart, setSkillAutoStart } from '@/lib/services/skill-service';
import { GET, POST } from '../route';

const mockIsSkillAutoStart = vi.mocked(isSkillAutoStart);
const mockSetSkillAutoStart = vi.mocked(setSkillAutoStart);

function createParams(name: string): { params: Promise<{ name: string }> } {
  return { params: Promise.resolve({ name }) };
}

function createRequest(method: string, body?: unknown): NextRequest {
  const url = 'http://localhost:3000/api/skills/test-skill/auto-start';
  if (body !== undefined) {
    return new NextRequest(url, {
      method,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new NextRequest(url, { method });
}

describe('GET /api/skills/{name}/auto-start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return autoStart: true when skill is auto-start enabled', async () => {
    mockIsSkillAutoStart.mockResolvedValue(true);

    const request = createRequest('GET');
    const response = await GET(request, createParams('portal-integration'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, data: { autoStart: true } });
    expect(mockIsSkillAutoStart).toHaveBeenCalledWith('portal-integration');
  });

  it('should return autoStart: false when skill is not auto-start enabled', async () => {
    mockIsSkillAutoStart.mockResolvedValue(false);

    const request = createRequest('GET');
    const response = await GET(request, createParams('some-skill'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, data: { autoStart: false } });
    expect(mockIsSkillAutoStart).toHaveBeenCalledWith('some-skill');
  });

  it('should decode URL-encoded skill names', async () => {
    mockIsSkillAutoStart.mockResolvedValue(false);

    const request = createRequest('GET');
    const response = await GET(request, createParams('my%20skill'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, data: { autoStart: false } });
    expect(mockIsSkillAutoStart).toHaveBeenCalledWith('my skill');
  });

  it('should return 500 when isSkillAutoStart throws an unexpected error', async () => {
    mockIsSkillAutoStart.mockRejectedValue(new Error('Unexpected error'));

    const request = createRequest('GET');
    const response = await GET(request, createParams('test-skill'));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ success: false, error: 'Unexpected error' });
  });
});

describe('POST /api/skills/{name}/auto-start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should enable auto-start successfully', async () => {
    mockSetSkillAutoStart.mockResolvedValue(undefined);

    const request = createRequest('POST', { enabled: true });
    const response = await POST(request, createParams('portal-integration'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockSetSkillAutoStart).toHaveBeenCalledWith('portal-integration', true);
  });

  it('should disable auto-start successfully', async () => {
    mockSetSkillAutoStart.mockResolvedValue(undefined);

    const request = createRequest('POST', { enabled: false });
    const response = await POST(request, createParams('portal-integration'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockSetSkillAutoStart).toHaveBeenCalledWith('portal-integration', false);
  });

  it('should return 400 when enabled is not a boolean', async () => {
    const request = createRequest('POST', { enabled: 'yes' });
    const response = await POST(request, createParams('test-skill'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ success: false, error: 'enabled (boolean) is required' });
    expect(mockSetSkillAutoStart).not.toHaveBeenCalled();
  });

  it('should return 400 when enabled is missing from body', async () => {
    const request = createRequest('POST', {});
    const response = await POST(request, createParams('test-skill'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ success: false, error: 'enabled (boolean) is required' });
    expect(mockSetSkillAutoStart).not.toHaveBeenCalled();
  });

  it('should return 404 when skill is not found', async () => {
    mockSetSkillAutoStart.mockRejectedValue(new Error('Skill not found'));

    const request = createRequest('POST', { enabled: true });
    const response = await POST(request, createParams('non-existent'));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ success: false, error: 'Skill not found' });
  });

  it('should return 400 when skill does not support app mode', async () => {
    mockSetSkillAutoStart.mockRejectedValue(new Error('Skill does not support app mode'));

    const request = createRequest('POST', { enabled: true });
    const response = await POST(request, createParams('pure-skill'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ success: false, error: 'Skill does not support app mode' });
  });

  it('should return 500 for unexpected errors', async () => {
    mockSetSkillAutoStart.mockRejectedValue(new Error('Database connection failed'));

    const request = createRequest('POST', { enabled: true });
    const response = await POST(request, createParams('test-skill'));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ success: false, error: 'Database connection failed' });
  });

  it('should decode URL-encoded skill names', async () => {
    mockSetSkillAutoStart.mockResolvedValue(undefined);

    const request = createRequest('POST', { enabled: true });
    const response = await POST(request, createParams('my%20skill'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockSetSkillAutoStart).toHaveBeenCalledWith('my skill', true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Unit tests for the Office API route handlers.
 * Validates: Requirements 1.3, 1.4, 1.5
 *
 * Tests cover:
 * - GET handler: missing path (400), file not found (404), path traversal (400)
 * - POST handler: missing path (400), path traversal (400)
 */

// Mock dependencies — order matters: mock paths first to avoid PROJECTS_DIR env requirement
vi.mock('@/lib/config/paths', () => ({
  PROJECTS_DIR_ABSOLUTE: '/tmp/mock-projects',
  USER_SKILLS_DIR_ABSOLUTE: '/tmp/mock-skills',
  SKILLS_DIR_ABSOLUTE: '/tmp/mock-builtin-skills',
}));

vi.mock('@/lib/services/project', () => ({
  getProjectById: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import { getProjectById } from '@/lib/services/project';
import fs from 'fs/promises';
import { GET, POST } from '../route';

const mockGetProjectById = vi.mocked(getProjectById);
const mockReadFile = vi.mocked(fs.readFile);
const mockWriteFile = vi.mocked(fs.writeFile);

function createContext(projectId = 'test-project') {
  return { params: Promise.resolve({ project_id: projectId }) };
}

function createGetRequest(queryParams?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/repo/test-project/office');
  if (queryParams) {
    Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url.toString(), { method: 'GET' });
}

function createPostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/repo/test-project/office', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/repo/[project_id]/office', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: project exists with a work_directory
    mockGetProjectById.mockResolvedValue({
      id: 'test-project',
      name: 'Test Project',
      repoPath: '/projects/test-project',
    } as any);
  });

  it('should return 400 when path parameter is missing', async () => {
    const request = createGetRequest();
    const response = await GET(request, createContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '缺少 path 参数' });
  });

  it('should return 404 when file does not exist', async () => {
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(enoentError);

    const request = createGetRequest({ path: 'docs/readme.docx' });
    const response = await GET(request, createContext());
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: '文件不存在' });
  });

  it('should return 400 when path contains traversal attack (../)', async () => {
    const request = createGetRequest({ path: '../../../etc/passwd' });
    const response = await GET(request, createContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '路径不合法' });
  });
});

describe('POST /api/repo/[project_id]/office', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectById.mockResolvedValue({
      id: 'test-project',
      name: 'Test Project',
      repoPath: '/projects/test-project',
    } as any);
  });

  it('should return 400 when path is missing from body', async () => {
    const request = createPostRequest({ content: 'dGVzdA==' });
    const response = await POST(request, createContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '缺少 path 参数' });
  });

  it('should return 400 when path contains traversal attack', async () => {
    const request = createPostRequest({
      path: '../../../etc/passwd',
      content: 'dGVzdA==',
    });
    const response = await POST(request, createContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '路径不合法' });
  });
});

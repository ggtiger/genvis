/**
 * Unit tests for test-generator.ts - generateTestCases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock skill-service to control skill path resolution
vi.mock('@/lib/services/skill-service', () => ({
  getSkillPathByName: vi.fn(),
}));

import {
  generateTestCases,
  parseEndpointsFromMarkdown,
  parseScriptsFromMarkdown,
} from '../test-generator';
import { getSkillPathByName } from '@/lib/services/skill-service';

const mockedGetSkillPath = vi.mocked(getSkillPathByName);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-generator-test-'));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Helper: create a skill directory with given files */
async function setupSkillDir(files: Record<string, string>): Promise<string> {
  const skillPath = path.join(tmpDir, 'test-skill');
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(skillPath, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }
  mockedGetSkillPath.mockReturnValue(skillPath);
  return skillPath;
}

describe('parseEndpointsFromMarkdown', () => {
  it('parses HTTP method + path patterns from markdown', () => {
    const content = `
## API
\`GET /api/todos\`
\`POST /api/todos\`
\`PUT /api/todos/:id\`
\`DELETE /api/todos/:id\`
    `;
    const endpoints = parseEndpointsFromMarkdown(content);

    expect(endpoints).toHaveLength(4);
    expect(endpoints[0]).toMatchObject({ method: 'GET', path: '/api/todos' });
    expect(endpoints[1]).toMatchObject({ method: 'POST', path: '/api/todos' });
    expect(endpoints[2]).toMatchObject({ method: 'PUT', path: '/api/todos/:id' });
    expect(endpoints[3]).toMatchObject({ method: 'DELETE', path: '/api/todos/:id' });
  });

  it('deduplicates endpoints with same method and path', () => {
    const content = `
\`GET /api/todos\`
Some text
\`GET /api/todos\`
    `;
    const endpoints = parseEndpointsFromMarkdown(content);
    expect(endpoints).toHaveLength(1);
  });

  it('extracts JSON body examples for POST/PUT endpoints', () => {
    const content = `
\`POST /api/notes\`
\`\`\`json
{
  "title": "Test Note",
  "content": "Hello"
}
\`\`\`
    `;
    const endpoints = parseEndpointsFromMarkdown(content);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].bodyExample).toEqual({
      title: 'Test Note',
      content: 'Hello',
    });
  });

  it('returns empty array for content with no endpoints', () => {
    const content = '# Just a title\nSome description text.';
    const endpoints = parseEndpointsFromMarkdown(content);
    expect(endpoints).toEqual([]);
  });

  it('marks POST and PUT as hasBody', () => {
    const content = `
\`POST /api/data\`
\`PUT /api/data/:id\`
\`GET /api/data\`
\`DELETE /api/data/:id\`
    `;
    const endpoints = parseEndpointsFromMarkdown(content);
    expect(endpoints.find((e) => e.method === 'POST')?.hasBody).toBe(true);
    expect(endpoints.find((e) => e.method === 'PUT')?.hasBody).toBe(true);
    expect(endpoints.find((e) => e.method === 'GET')?.hasBody).toBe(false);
    expect(endpoints.find((e) => e.method === 'DELETE')?.hasBody).toBe(false);
  });
});

describe('parseScriptsFromMarkdown', () => {
  it('parses python3 script calls', () => {
    const content = `
\`\`\`bash
python3 \${SKILL_DIR}/scripts/search.py '{"query":"test"}'
\`\`\`
    `;
    const scripts = parseScriptsFromMarkdown(content);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].command).toBe('${SKILL_DIR}/scripts/search.py');
  });

  it('parses node script calls', () => {
    const content = `
\`\`\`bash
node \${SKILL_DIR}/scripts/build.js
\`\`\`
    `;
    const scripts = parseScriptsFromMarkdown(content);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].command).toBe('${SKILL_DIR}/scripts/build.js');
  });

  it('deduplicates script calls', () => {
    const content = `
python3 \${SKILL_DIR}/scripts/search.py '{"query":"a"}'
python3 \${SKILL_DIR}/scripts/search.py '{"query":"b"}'
    `;
    const scripts = parseScriptsFromMarkdown(content);
    expect(scripts).toHaveLength(1);
  });

  it('returns empty array for content with no scripts', () => {
    const content = '# No scripts here\nJust text.';
    const scripts = parseScriptsFromMarkdown(content);
    expect(scripts).toEqual([]);
  });

  it('parses multiple different scripts', () => {
    const content = `
python3 \${SKILL_DIR}/scripts/search.py '{"query":"test"}'
python3 \${SKILL_DIR}/scripts/analyze.py --input data.json
bash \${SKILL_DIR}/scripts/setup.sh
    `;
    const scripts = parseScriptsFromMarkdown(content);
    expect(scripts).toHaveLength(3);
  });
});

describe('generateTestCases', () => {
  it('throws when skill does not exist', async () => {
    mockedGetSkillPath.mockReturnValue(null);
    await expect(generateTestCases('nonexistent')).rejects.toThrow(
      'Skill "nonexistent" not found',
    );
  });

  it('throws when SKILL.md is missing', async () => {
    const skillPath = path.join(tmpDir, 'no-skillmd');
    await fs.mkdir(skillPath, { recursive: true });
    mockedGetSkillPath.mockReturnValue(skillPath);

    await expect(generateTestCases('no-skillmd')).rejects.toThrow(
      'SKILL.md not found for skill "no-skillmd"',
    );
  });

  it('generates positive and negative test cases for each API endpoint', async () => {
    await setupSkillDir({
      'SKILL.md': `
# Test Skill
## API
\`GET /api/items\`
\`POST /api/items\`
      `,
    });

    const suite = await generateTestCases('test-skill');

    // 2 endpoints × 2 (positive + negative) = 4 cases
    expect(suite.cases).toHaveLength(4);
    expect(suite.cases.filter((c) => c.description.includes('正向')).length).toBe(2);
    expect(suite.cases.filter((c) => c.description.includes('异常')).length).toBe(2);
  });

  it('generates script test cases', async () => {
    await setupSkillDir({
      'SKILL.md': `
# Test Skill
\`\`\`bash
python3 \${SKILL_DIR}/scripts/run.py '{"input":"test"}'
\`\`\`
      `,
    });

    const suite = await generateTestCases('test-skill');

    const scriptCases = suite.cases.filter((c) => c.type === 'script');
    expect(scriptCases).toHaveLength(1);
    expect(scriptCases[0].expect.exitCode).toBe(0);
  });

  it('generates unique IDs for all test cases', async () => {
    await setupSkillDir({
      'SKILL.md': `
# Test Skill
\`GET /api/a\`
\`POST /api/b\`
\`\`\`bash
python3 \${SKILL_DIR}/scripts/run.py
\`\`\`
      `,
    });

    const suite = await generateTestCases('test-skill');

    const ids = suite.cases.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    // IDs should follow tc-XXX format
    for (const id of ids) {
      expect(id).toMatch(/^tc-\d{3}$/);
    }
  });

  it('saves test suite to __tests__/qa-tests.json', async () => {
    const skillPath = await setupSkillDir({
      'SKILL.md': '# Test\n`GET /api/health`',
    });

    await generateTestCases('test-skill');

    const outputPath = path.join(skillPath, '__tests__', 'qa-tests.json');
    const raw = await fs.readFile(outputPath, 'utf-8');
    const saved = JSON.parse(raw);

    expect(saved.skillName).toBe('test-skill');
    expect(saved.generatedAt).toBeTruthy();
    expect(saved.cases.length).toBeGreaterThan(0);
  });

  it('merges endpoints from SKILL.md and api-endpoints.json', async () => {
    await setupSkillDir({
      'SKILL.md': `
# Test Skill
\`GET /api/items\`
      `,
      'api-endpoints.json': JSON.stringify({
        skillName: 'test-skill',
        endpoints: [
          {
            path: '/api/items',
            method: 'GET',
            description: 'Get items',
          },
          {
            path: '/api/items',
            method: 'POST',
            description: 'Create item',
            parameters: [
              { name: 'title', type: 'string', required: true },
            ],
          },
        ],
      }),
    });

    const suite = await generateTestCases('test-skill');

    // GET /api/items (deduplicated) + POST /api/items = 2 endpoints × 2 = 4 cases
    expect(suite.cases).toHaveLength(4);
  });

  it('uses api-endpoints.json parameters to build sample body', async () => {
    await setupSkillDir({
      'SKILL.md': '# Test Skill',
      'api-endpoints.json': JSON.stringify({
        skillName: 'test-skill',
        endpoints: [
          {
            path: '/api/data',
            method: 'POST',
            description: 'Create data',
            parameters: [
              { name: 'name', type: 'string', required: true },
              { name: 'count', type: 'number', required: false },
            ],
          },
        ],
      }),
    });

    const suite = await generateTestCases('test-skill');

    const positiveCase = suite.cases.find((c) => c.description.includes('正向'));
    expect(positiveCase?.body).toEqual({
      name: 'test-name',
      count: 1,
    });
  });

  it('returns correct TestSuite structure', async () => {
    await setupSkillDir({
      'SKILL.md': '# Test\n`GET /api/health`',
    });

    const suite = await generateTestCases('test-skill');

    expect(suite.skillName).toBe('test-skill');
    expect(suite.generatedAt).toBeTruthy();
    expect(Array.isArray(suite.cases)).toBe(true);

    for (const tc of suite.cases) {
      expect(tc.id).toBeTruthy();
      expect(tc.description).toBeTruthy();
      expect(tc.type).toBe('http');
      expect(tc.expect).toBeDefined();
    }
  });

  it('handles SKILL.md with no API endpoints and no scripts', async () => {
    await setupSkillDir({
      'SKILL.md': '# Simple Skill\nJust a description, no APIs.',
    });

    const suite = await generateTestCases('test-skill');

    expect(suite.cases).toHaveLength(0);
    expect(suite.skillName).toBe('test-skill');
  });

  it('handles invalid api-endpoints.json gracefully', async () => {
    await setupSkillDir({
      'SKILL.md': '# Test\n`GET /api/health`',
      'api-endpoints.json': 'not valid json',
    });

    // Should not throw, just ignore the invalid file
    const suite = await generateTestCases('test-skill');
    expect(suite.cases).toHaveLength(2); // Only from SKILL.md
  });

  it('sets correct expect fields for HTTP test cases', async () => {
    await setupSkillDir({
      'SKILL.md': '# Test\n`POST /api/data`',
    });

    const suite = await generateTestCases('test-skill');

    const positive = suite.cases.find((c) => c.description.includes('正向'));
    expect(positive?.expect.status).toBe(200);

    const negative = suite.cases.find((c) => c.description.includes('异常'));
    expect(negative?.expect.status).toBe(400);
  });

  it('sets Content-Type header for POST/PUT positive cases with body', async () => {
    await setupSkillDir({
      'SKILL.md': `
# Test
\`POST /api/data\`
\`\`\`json
{"key": "value"}
\`\`\`
      `,
    });

    const suite = await generateTestCases('test-skill');

    const positive = suite.cases.find((c) => c.description.includes('正向'));
    expect(positive?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(positive?.body).toEqual({ key: 'value' });
  });
});

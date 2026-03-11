/**
 * Unit tests for version-store.ts - createSnapshot
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock skill-service to control skill path resolution
vi.mock('@/lib/services/skill-service', () => ({
  getSkillPathByName: vi.fn(),
}));

import { createSnapshot, listVersions, rollback } from '../version-store';
import { getSkillPathByName } from '@/lib/services/skill-service';

const mockedGetSkillPath = vi.mocked(getSkillPathByName);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'version-store-test-'));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Helper: create a skill directory with some files */
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

describe('createSnapshot', () => {
  it('creates a version snapshot with correct metadata', async () => {
    await setupSkillDir({
      'SKILL.md': '# Test Skill',
      'template.json': '{}',
      'scripts/main.py': 'print("hello")',
    });

    const result = await createSnapshot('test-skill', '发布版本');

    expect(result.versionNumber).toBe(1);
    expect(result.reason).toBe('发布版本');
    expect(result.files).toContain('SKILL.md');
    expect(result.files).toContain('template.json');
    expect(result.files).toContain('scripts/main.py');
    expect(result.createdAt).toBeTruthy();
  });

  it('increments version numbers', async () => {
    await setupSkillDir({ 'SKILL.md': '# Test' });

    const v1 = await createSnapshot('test-skill', 'v1');
    const v2 = await createSnapshot('test-skill', 'v2');
    const v3 = await createSnapshot('test-skill', 'v3');

    expect(v1.versionNumber).toBe(1);
    expect(v2.versionNumber).toBe(2);
    expect(v3.versionNumber).toBe(3);
  });

  it('copies files to .versions/{versionNumber}/ directory', async () => {
    const skillPath = await setupSkillDir({
      'SKILL.md': '# Test Skill',
      'src/index.ts': 'export default {}',
    });

    const result = await createSnapshot('test-skill', 'backup');
    const versionDir = path.join(skillPath, '.versions', String(result.versionNumber));

    const skillMd = await fs.readFile(path.join(versionDir, 'SKILL.md'), 'utf-8');
    expect(skillMd).toBe('# Test Skill');

    const indexTs = await fs.readFile(path.join(versionDir, 'src/index.ts'), 'utf-8');
    expect(indexTs).toBe('export default {}');
  });

  it('writes meta.json with version info', async () => {
    const skillPath = await setupSkillDir({ 'SKILL.md': '# Test' });

    const result = await createSnapshot('test-skill', 'test reason');
    const metaPath = path.join(skillPath, '.versions', String(result.versionNumber), 'meta.json');
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));

    expect(meta.versionNumber).toBe(result.versionNumber);
    expect(meta.reason).toBe('test reason');
    expect(meta.files).toEqual(result.files);
    expect(meta.createdAt).toBe(result.createdAt);
  });

  it('excludes runtime directories from snapshot', async () => {
    const skillPath = await setupSkillDir({
      'SKILL.md': '# Test',
      'node_modules/pkg/index.js': 'module.exports = {}',
      '__pycache__/cache.pyc': 'cached',
      '.venv/bin/python': 'python',
      '.next/build.js': 'build',
      '.git/HEAD': 'ref: refs/heads/main',
    });
    // Also create .DS_Store as a file (not dir)
    await fs.writeFile(path.join(skillPath, '.DS_Store'), 'store');

    const result = await createSnapshot('test-skill', 'backup');

    expect(result.files).toEqual(['SKILL.md']);
    // Verify excluded dirs are not in the version directory
    const versionDir = path.join(skillPath, '.versions', String(result.versionNumber));
    const entries = await fs.readdir(versionDir);
    expect(entries).not.toContain('node_modules');
    expect(entries).not.toContain('__pycache__');
    expect(entries).not.toContain('.venv');
    expect(entries).not.toContain('.next');
    expect(entries).not.toContain('.git');
  });

  it('excludes .versions directory from snapshot', async () => {
    await setupSkillDir({ 'SKILL.md': '# Test' });

    // Create first version, then second — .versions should not be nested
    await createSnapshot('test-skill', 'v1');
    const v2 = await createSnapshot('test-skill', 'v2');

    expect(v2.files).toEqual(['SKILL.md']);
  });

  it('cleans up old versions when exceeding 20', async () => {
    const skillPath = await setupSkillDir({ 'SKILL.md': '# Test' });

    // Create 22 versions
    for (let i = 0; i < 22; i++) {
      await createSnapshot('test-skill', `version ${i + 1}`);
    }

    const versionsDir = path.join(skillPath, '.versions');
    const entries = await fs.readdir(versionsDir);
    const versionDirs = entries.filter((e) => /^\d+$/.test(e));

    expect(versionDirs.length).toBe(20);
    // Oldest versions (1, 2) should be deleted, newest (3-22) should remain
    expect(versionDirs).not.toContain('1');
    expect(versionDirs).not.toContain('2');
    expect(versionDirs).toContain('3');
    expect(versionDirs).toContain('22');
  });

  it('throws when skill does not exist', async () => {
    mockedGetSkillPath.mockReturnValue(null);

    await expect(createSnapshot('nonexistent', 'backup')).rejects.toThrow(
      'Skill "nonexistent" not found',
    );
  });

  it('handles empty skill directory', async () => {
    const skillPath = path.join(tmpDir, 'empty-skill');
    await fs.mkdir(skillPath, { recursive: true });
    mockedGetSkillPath.mockReturnValue(skillPath);

    const result = await createSnapshot('empty-skill', 'empty backup');

    expect(result.versionNumber).toBe(1);
    expect(result.files).toEqual([]);
  });
});


describe('listVersions', () => {
  it('returns versions sorted by createdAt descending (newest first)', async () => {
    await setupSkillDir({ 'SKILL.md': '# Test' });

    await createSnapshot('test-skill', 'first');
    await createSnapshot('test-skill', 'second');
    await createSnapshot('test-skill', 'third');

    const versions = await listVersions('test-skill');

    expect(versions).toHaveLength(3);
    expect(versions[0].reason).toBe('third');
    expect(versions[1].reason).toBe('second');
    expect(versions[2].reason).toBe('first');
    // Verify descending order
    for (let i = 0; i < versions.length - 1; i++) {
      expect(new Date(versions[i].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(versions[i + 1].createdAt).getTime(),
      );
    }
  });

  it('returns empty array when no versions exist', async () => {
    await setupSkillDir({ 'SKILL.md': '# Test' });

    const versions = await listVersions('test-skill');

    expect(versions).toEqual([]);
  });

  it('throws when skill does not exist', async () => {
    mockedGetSkillPath.mockReturnValue(null);

    await expect(listVersions('nonexistent')).rejects.toThrow(
      'Skill "nonexistent" not found',
    );
  });

  it('skips corrupted version directories with missing meta.json', async () => {
    const skillPath = await setupSkillDir({ 'SKILL.md': '# Test' });

    // Create a valid version
    await createSnapshot('test-skill', 'valid');

    // Create a corrupted version directory (no meta.json)
    const corruptedDir = path.join(skillPath, '.versions', '2');
    await fs.mkdir(corruptedDir, { recursive: true });

    const versions = await listVersions('test-skill');

    expect(versions).toHaveLength(1);
    expect(versions[0].reason).toBe('valid');
  });

  it('skips corrupted version directories with invalid meta.json', async () => {
    const skillPath = await setupSkillDir({ 'SKILL.md': '# Test' });

    // Create a valid version
    await createSnapshot('test-skill', 'valid');

    // Create a version with invalid JSON
    const corruptedDir = path.join(skillPath, '.versions', '2');
    await fs.mkdir(corruptedDir, { recursive: true });
    await fs.writeFile(path.join(corruptedDir, 'meta.json'), 'not valid json', 'utf-8');

    const versions = await listVersions('test-skill');

    expect(versions).toHaveLength(1);
    expect(versions[0].reason).toBe('valid');
  });

  it('returns version info with all required fields', async () => {
    await setupSkillDir({
      'SKILL.md': '# Test',
      'src/index.ts': 'export default {}',
    });

    await createSnapshot('test-skill', '发布版本');

    const versions = await listVersions('test-skill');

    expect(versions).toHaveLength(1);
    const v = versions[0];
    expect(v.versionNumber).toBe(1);
    expect(v.createdAt).toBeTruthy();
    expect(v.reason).toBe('发布版本');
    expect(v.files).toContain('SKILL.md');
    expect(v.files).toContain('src/index.ts');
  });
});


describe('rollback', () => {
  it('restores files from target version to skill directory', async () => {
    const skillPath = await setupSkillDir({
      'SKILL.md': '# Original',
      'src/index.ts': 'original code',
    });

    // Create a snapshot (version 1)
    await createSnapshot('test-skill', 'v1');

    // Modify files
    await fs.writeFile(path.join(skillPath, 'SKILL.md'), '# Modified', 'utf-8');
    await fs.writeFile(path.join(skillPath, 'src/index.ts'), 'modified code', 'utf-8');

    // Rollback to version 1
    const result = await rollback('test-skill', 1);

    expect(result.success).toBe(true);
    expect(result.toVersion).toBe(1);
    expect(result.fromVersion).toBe(2); // backup version

    // Verify files are restored
    const skillMd = await fs.readFile(path.join(skillPath, 'SKILL.md'), 'utf-8');
    expect(skillMd).toBe('# Original');
    const indexTs = await fs.readFile(path.join(skillPath, 'src/index.ts'), 'utf-8');
    expect(indexTs).toBe('original code');
  });

  it('creates a backup snapshot before rollback with reason "回滚前备份"', async () => {
    await setupSkillDir({ 'SKILL.md': '# Test' });

    await createSnapshot('test-skill', 'v1');
    await rollback('test-skill', 1);

    const versions = await listVersions('test-skill');
    const backupVersion = versions.find((v) => v.reason === '回滚前备份');
    expect(backupVersion).toBeDefined();
  });

  it('throws error with available versions when target version does not exist', async () => {
    await setupSkillDir({ 'SKILL.md': '# Test' });

    await createSnapshot('test-skill', 'v1');
    await createSnapshot('test-skill', 'v2');

    await expect(rollback('test-skill', 99)).rejects.toThrow(/Available versions: 1, 2/);
  });

  it('throws when skill does not exist', async () => {
    mockedGetSkillPath.mockReturnValue(null);

    await expect(rollback('nonexistent', 1)).rejects.toThrow('Skill "nonexistent" not found');
  });

  it('removes extra files not present in target version', async () => {
    const skillPath = await setupSkillDir({ 'SKILL.md': '# Original' });

    // Create snapshot with only SKILL.md
    await createSnapshot('test-skill', 'v1');

    // Add a new file after snapshot
    await fs.writeFile(path.join(skillPath, 'extra.txt'), 'extra', 'utf-8');

    // Rollback to version 1
    await rollback('test-skill', 1);

    // extra.txt should be gone
    await expect(fs.access(path.join(skillPath, 'extra.txt'))).rejects.toThrow();
  });

  it('does not copy meta.json to skill directory', async () => {
    const skillPath = await setupSkillDir({ 'SKILL.md': '# Test' });

    await createSnapshot('test-skill', 'v1');
    await rollback('test-skill', 1);

    // meta.json should not exist in skill directory
    await expect(fs.access(path.join(skillPath, 'meta.json'))).rejects.toThrow();
  });

  it('preserves excluded directories during rollback', async () => {
    const skillPath = await setupSkillDir({ 'SKILL.md': '# Test' });

    // Create node_modules (excluded dir)
    await fs.mkdir(path.join(skillPath, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(
      path.join(skillPath, 'node_modules', 'pkg', 'index.js'),
      'module.exports = {}',
      'utf-8',
    );

    await createSnapshot('test-skill', 'v1');
    await rollback('test-skill', 1);

    // node_modules should still exist
    const nmExists = await fs
      .access(path.join(skillPath, 'node_modules', 'pkg', 'index.js'))
      .then(() => true)
      .catch(() => false);
    expect(nmExists).toBe(true);
  });
});

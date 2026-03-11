import { describe, it, expect, afterEach } from 'vitest';
import matter from 'gray-matter';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { generateTemplateJson, generateSkillMd, transformToSkillDir } from '../transformer';
import type { ParsedManifest, TranslatedMeta } from '../types';

/** Helper: minimal valid manifest */
function makeManifest(overrides: Partial<ParsedManifest> = {}): ParsedManifest {
  return {
    name: 'test-skill',
    description: 'A test skill',
    sourcePlatform: 'openclaw',
    sourceUrl: 'https://clawhub.ai/test/test-skill',
    ...overrides,
  };
}

describe('generateTemplateJson', () => {
  it('should generate a valid TemplateConfig with minimal manifest', () => {
    const manifest = makeManifest();
    const result = generateTemplateJson(manifest);

    expect(result.displayName).toBe('test-skill');
    expect(result.description).toBe('A test skill');
    expect(result.projectType).toBeUndefined();
    expect(result.category).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.envVars).toBeUndefined();
  });

  it('should use displayName from manifest when provided', () => {
    const manifest = makeManifest({ displayName: 'Test Skill' });
    const result = generateTemplateJson(manifest);

    expect(result.displayName).toBe('Test Skill');
  });

  it('should map python runtime to python-fastapi', () => {
    const manifest = makeManifest({ runtime: 'python' });
    const result = generateTemplateJson(manifest);

    expect(result.projectType).toBe('python-fastapi');
  });

  it('should map node runtime to nextjs', () => {
    const manifest = makeManifest({ runtime: 'node' });
    const result = generateTemplateJson(manifest);

    expect(result.projectType).toBe('nextjs');
  });

  it('should map typescript runtime to nextjs', () => {
    const manifest = makeManifest({ runtime: 'typescript' });
    const result = generateTemplateJson(manifest);

    expect(result.projectType).toBe('nextjs');
  });

  it('should map unknown runtime to nextjs', () => {
    const manifest = makeManifest({ runtime: 'unknown' });
    const result = generateTemplateJson(manifest);

    expect(result.projectType).toBe('nextjs');
  });

  it('should not set projectType when runtime is undefined and no codeFiles', () => {
    const manifest = makeManifest({ runtime: undefined });
    const result = generateTemplateJson(manifest);

    expect(result.projectType).toBeUndefined();
  });

  it('should set projectType when codeFiles are present even without runtime', () => {
    const manifest = makeManifest({ runtime: undefined, codeFiles: ['index.ts'] });
    const result = generateTemplateJson(manifest);

    expect(result.projectType).toBe('nextjs');
  });

  it('should preserve envVars configuration', () => {
    const manifest = makeManifest({
      envVars: [
        { key: 'API_KEY', label: 'API Key', required: true, secret: true },
        { key: 'DEBUG', required: false, defaultValue: 'false' },
      ],
    });
    const result = generateTemplateJson(manifest);

    expect(result.envVars).toHaveLength(2);
    expect(result.envVars![0]).toEqual({
      key: 'API_KEY',
      label: 'API Key',
      required: true,
      secret: true,
      default: undefined,
    });
    expect(result.envVars![1]).toEqual({
      key: 'DEBUG',
      label: 'DEBUG',
      required: false,
      secret: undefined,
      default: 'false',
    });
  });

  it('should include category, tags, version, author when present', () => {
    const manifest = makeManifest({
      category: '效率工具',
      tags: ['search', 'api'],
      version: '2.0.0',
      author: 'Test Author',
    });
    const result = generateTemplateJson(manifest);

    expect(result.category).toBe('效率工具');
    expect(result.tags).toEqual(['search', 'api']);
    expect(result.version).toBe('2.0.0');
    expect(result.author).toBe('Test Author');
  });

  it('should prefer translatedMeta displayName over manifest', () => {
    const manifest = makeManifest({ displayName: 'English Name' });
    const translated: TranslatedMeta = { displayName: '中文名称' };
    const result = generateTemplateJson(manifest, translated);

    expect(result.displayName).toBe('中文名称');
  });

  it('should prefer translatedMeta description over manifest', () => {
    const manifest = makeManifest({ description: 'English desc' });
    const translated: TranslatedMeta = { description: '中文描述' };
    const result = generateTemplateJson(manifest, translated);

    expect(result.description).toBe('中文描述');
  });

  it('should fall back to manifest values when translatedMeta fields are empty', () => {
    const manifest = makeManifest({
      displayName: 'Original Name',
      description: 'Original desc',
    });
    const translated: TranslatedMeta = {};
    const result = generateTemplateJson(manifest, translated);

    expect(result.displayName).toBe('Original Name');
    expect(result.description).toBe('Original desc');
  });

  it('should produce JSON-serializable output', () => {
    const manifest = makeManifest({
      displayName: 'Test',
      category: 'tools',
      tags: ['a', 'b'],
      version: '1.0.0',
      author: 'me',
      runtime: 'python',
      envVars: [{ key: 'K', required: true }],
    });
    const result = generateTemplateJson(manifest);
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);

    expect(parsed.displayName).toBe('Test');
    expect(parsed.projectType).toBe('python-fastapi');
    expect(parsed.envVars).toHaveLength(1);
  });
});


describe('generateSkillMd', () => {
  it('should generate valid SKILL.md with minimal manifest', () => {
    const manifest = makeManifest();
    const result = generateSkillMd(manifest);
    const parsed = matter(result);

    expect(parsed.data.name).toBe('test-skill');
    expect(parsed.data.description).toBe('A test skill');
    expect(parsed.data.projectType).toBeUndefined();
    expect(parsed.content).toContain('# test-skill');
  });

  it('should be parseable by parseSkillMd format (name and description required)', () => {
    const manifest = makeManifest({
      displayName: 'My Skill',
      version: '1.0.0',
      author: 'Author',
      category: 'tools',
      tags: ['search', 'api'],
      runtime: 'python',
    });
    const result = generateSkillMd(manifest);
    const parsed = matter(result);

    expect(parsed.data.name).toBe('My Skill');
    expect(parsed.data.description).toBe('A test skill');
    expect(parsed.data.version).toBe('1.0.0');
    expect(parsed.data.author).toBe('Author');
    expect(parsed.data.category).toBe('tools');
    expect(parsed.data.tags).toEqual(['search', 'api']);
    expect(parsed.data.projectType).toBe('python-fastapi');
  });

  it('should use displayName from manifest as name in frontmatter', () => {
    const manifest = makeManifest({ displayName: 'Display Name' });
    const result = generateSkillMd(manifest);
    const parsed = matter(result);

    expect(parsed.data.name).toBe('Display Name');
  });

  it('should fall back to manifest.name when displayName is not provided', () => {
    const manifest = makeManifest();
    const result = generateSkillMd(manifest);
    const parsed = matter(result);

    expect(parsed.data.name).toBe('test-skill');
  });

  it('should prefer translatedMeta displayName over manifest', () => {
    const manifest = makeManifest({ displayName: 'English Name' });
    const translated: TranslatedMeta = { displayName: '中文名称' };
    const result = generateSkillMd(manifest, translated);
    const parsed = matter(result);

    expect(parsed.data.name).toBe('中文名称');
  });

  it('should prefer translatedMeta description over manifest', () => {
    const manifest = makeManifest({ description: 'English desc' });
    const translated: TranslatedMeta = { description: '中文描述' };
    const result = generateSkillMd(manifest, translated);
    const parsed = matter(result);

    expect(parsed.data.description).toBe('中文描述');
  });

  it('should use translatedMeta skillMdContent as body when provided', () => {
    const manifest = makeManifest();
    const translated: TranslatedMeta = { skillMdContent: '# 自定义内容\n\n这是翻译后的正文。\n' };
    const result = generateSkillMd(manifest, translated);
    const parsed = matter(result);

    expect(parsed.content).toContain('# 自定义内容');
    expect(parsed.content).toContain('这是翻译后的正文。');
  });

  it('should generate default body with usage instructions when no translatedMeta', () => {
    const manifest = makeManifest({ displayName: 'Test Skill' });
    const result = generateSkillMd(manifest);
    const parsed = matter(result);

    expect(parsed.content).toContain('# Test Skill');
    expect(parsed.content).toContain('使用说明');
  });

  it('should map python runtime to python-fastapi projectType', () => {
    const manifest = makeManifest({ runtime: 'python' });
    const result = generateSkillMd(manifest);
    const parsed = matter(result);

    expect(parsed.data.projectType).toBe('python-fastapi');
  });

  it('should map node runtime to nextjs projectType', () => {
    const manifest = makeManifest({ runtime: 'node' });
    const result = generateSkillMd(manifest);
    const parsed = matter(result);

    expect(parsed.data.projectType).toBe('nextjs');
  });

  it('should not include optional fields when not present in manifest', () => {
    const manifest = makeManifest();
    const result = generateSkillMd(manifest);
    const parsed = matter(result);

    expect(parsed.data.version).toBeUndefined();
    expect(parsed.data.author).toBeUndefined();
    expect(parsed.data.category).toBeUndefined();
    expect(parsed.data.tags).toBeUndefined();
  });

  it('should produce output starting with frontmatter delimiters', () => {
    const manifest = makeManifest();
    const result = generateSkillMd(manifest);

    expect(result.startsWith('---\n')).toBe(true);
    expect(result).toContain('\n---\n');
  });

  it('should fall back to manifest values when translatedMeta fields are empty', () => {
    const manifest = makeManifest({
      displayName: 'Original Name',
      description: 'Original desc',
    });
    const translated: TranslatedMeta = {};
    const result = generateSkillMd(manifest, translated);
    const parsed = matter(result);

    expect(parsed.data.name).toBe('Original Name');
    expect(parsed.data.description).toBe('Original desc');
  });
});


describe('transformToSkillDir', () => {
  const tmpDirs: string[] = [];

  async function makeTmpDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tmpDirs.length = 0;
  });

  it('should create target directory and write template.json and SKILL.md', async () => {
    const sourceDir = await makeTmpDir();
    const targetDir = path.join(await makeTmpDir(), 'output-skill');

    const manifest = makeManifest({ displayName: 'Test Skill', version: '1.0.0' });

    await transformToSkillDir(manifest, sourceDir, targetDir);

    // template.json should exist and be valid JSON
    const templateRaw = await fs.readFile(path.join(targetDir, 'template.json'), 'utf-8');
    const template = JSON.parse(templateRaw);
    expect(template.displayName).toBe('Test Skill');
    expect(template.projectType).toBeUndefined();

    // SKILL.md should exist and have valid frontmatter
    const skillMdRaw = await fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf-8');
    const parsed = matter(skillMdRaw);
    expect(parsed.data.name).toBe('Test Skill');
  });

  it('should copy specified codeFiles from source to target', async () => {
    const sourceDir = await makeTmpDir();
    const targetDir = path.join(await makeTmpDir(), 'output-skill');

    // Create source files
    await fs.writeFile(path.join(sourceDir, 'index.ts'), 'export default {}');
    await fs.writeFile(path.join(sourceDir, 'utils.ts'), 'export const x = 1');
    await fs.writeFile(path.join(sourceDir, 'ignored.txt'), 'should not be copied');

    const manifest = makeManifest({ codeFiles: ['index.ts', 'utils.ts'] });

    await transformToSkillDir(manifest, sourceDir, targetDir);

    const index = await fs.readFile(path.join(targetDir, 'index.ts'), 'utf-8');
    expect(index).toBe('export default {}');

    const utils = await fs.readFile(path.join(targetDir, 'utils.ts'), 'utf-8');
    expect(utils).toBe('export const x = 1');

    // ignored.txt should NOT be copied
    await expect(fs.access(path.join(targetDir, 'ignored.txt'))).rejects.toThrow();
  });

  it('should copy all files when codeFiles is not specified', async () => {
    const sourceDir = await makeTmpDir();
    const targetDir = path.join(await makeTmpDir(), 'output-skill');

    await fs.writeFile(path.join(sourceDir, 'main.py'), 'print("hello")');
    await fs.writeFile(path.join(sourceDir, 'config.json'), '{}');

    const manifest = makeManifest({ runtime: 'python' });

    await transformToSkillDir(manifest, sourceDir, targetDir);

    const main = await fs.readFile(path.join(targetDir, 'main.py'), 'utf-8');
    expect(main).toBe('print("hello")');

    const config = await fs.readFile(path.join(targetDir, 'config.json'), 'utf-8');
    expect(config).toBe('{}');
  });

  it('should handle nested subdirectories in codeFiles', async () => {
    const sourceDir = await makeTmpDir();
    const targetDir = path.join(await makeTmpDir(), 'output-skill');

    await fs.mkdir(path.join(sourceDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'src', 'app.ts'), 'const app = true');

    const manifest = makeManifest({ codeFiles: ['src/app.ts'] });

    await transformToSkillDir(manifest, sourceDir, targetDir);

    const app = await fs.readFile(path.join(targetDir, 'src', 'app.ts'), 'utf-8');
    expect(app).toBe('const app = true');
  });

  it('should use translatedMeta when provided', async () => {
    const sourceDir = await makeTmpDir();
    const targetDir = path.join(await makeTmpDir(), 'output-skill');

    const manifest = makeManifest({ displayName: 'English Name' });
    const translated: TranslatedMeta = { displayName: '中文名称', description: '中文描述' };

    await transformToSkillDir(manifest, sourceDir, targetDir, translated);

    const templateRaw = await fs.readFile(path.join(targetDir, 'template.json'), 'utf-8');
    const template = JSON.parse(templateRaw);
    expect(template.displayName).toBe('中文名称');
    expect(template.description).toBe('中文描述');

    const skillMdRaw = await fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf-8');
    const parsed = matter(skillMdRaw);
    expect(parsed.data.name).toBe('中文名称');
  });
});

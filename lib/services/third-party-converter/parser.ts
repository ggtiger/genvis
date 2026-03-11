import path from 'path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import type { ParsedManifest } from './types';

/** Fields that must be present */
const REQUIRED_FIELDS = ['name', 'description'] as const;

/**
 * Validate required fields and map a raw config object to ParsedManifest.
 * Shared by both YAML and JSON parsers.
 */
function mapToManifest(raw: Record<string, unknown>): ParsedManifest {
  // --- validate required fields ---
  const missing = REQUIRED_FIELDS.filter(
    (f) => raw[f] === undefined || raw[f] === null || raw[f] === ''
  );
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }

  // --- extract known fields only ---
  const manifest: ParsedManifest = {
    name: String(raw.name),
    description: String(raw.description),
    sourcePlatform: 'openclaw',
    sourceUrl: '',
    rawConfig: raw,
  };

  if (raw.displayName !== undefined) {
    manifest.displayName = String(raw.displayName);
  }
  if (raw.version !== undefined) {
    manifest.version = String(raw.version);
  }
  if (raw.author !== undefined) {
    manifest.author = String(raw.author);
  }
  if (Array.isArray(raw.tags)) {
    manifest.tags = raw.tags.map(String);
  }
  if (raw.runtime !== undefined) {
    const rt = String(raw.runtime);
    if (rt === 'python' || rt === 'node' || rt === 'typescript') {
      manifest.runtime = rt;
    } else {
      manifest.runtime = 'unknown';
    }
  }
  if (raw.entryPoint !== undefined) {
    manifest.entryPoint = String(raw.entryPoint);
  }
  if (Array.isArray(raw.envVars)) {
    manifest.envVars = raw.envVars.map((v: Record<string, unknown>) => ({
      key: String(v.key ?? ''),
      label: v.label !== undefined ? String(v.label) : undefined,
      required: Boolean(v.required),
      secret: v.secret !== undefined ? Boolean(v.secret) : undefined,
      defaultValue: v.defaultValue !== undefined ? String(v.defaultValue) : undefined,
    }));
  }

  return manifest;
}

/**
 * 解析 OpenClaw 格式的 YAML 配置
 */
export function parseOpenClawYaml(content: string): ParsedManifest {
  const raw = yaml.load(content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid YAML: expected an object');
  }
  return mapToManifest(raw as Record<string, unknown>);
}

/**
 * 解析 OpenClaw 格式的 JSON 配置
 */
export function parseOpenClawJson(content: string): ParsedManifest {
  const raw = JSON.parse(content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid JSON: expected an object');
  }
  return mapToManifest(raw as Record<string, unknown>);
}

/**
 * 解析 SKILL.md 格式（YAML frontmatter + markdown body）
 * ClawHub 的标准 skill 格式
 */
export function parseSkillMdFormat(content: string): ParsedManifest {
  const { data: frontmatter, content: body } = matter(content);
  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new Error('Invalid SKILL.md: no frontmatter found');
  }

  // ClawHub SKILL.md frontmatter may nest metadata under 'metadata.openclaw'
  const raw: Record<string, unknown> = { ...frontmatter };

  // Extract nested metadata (metadata.openclaw, metadata.clawdbot, etc.)
  const metadata = frontmatter.metadata as Record<string, unknown> | undefined;
  if (metadata && typeof metadata === 'object') {
    const nested = metadata.openclaw ?? metadata.clawdbot ?? metadata.clawdis;
    if (nested && typeof nested === 'object') {
      const nestedObj = nested as Record<string, unknown>;
      // Map requires.env to envVars
      const requires = nestedObj.requires as Record<string, unknown> | undefined;
      if (requires?.env && Array.isArray(requires.env)) {
        raw.envVars = (requires.env as string[]).map((key: string) => ({
          key,
          required: true,
        }));
      }
      // Map primaryEnv
      if (nestedObj.primaryEnv) {
        raw.primaryEnv = nestedObj.primaryEnv;
      }
    }
  }

  // Store the markdown body for later use
  const manifest = mapToManifest(raw);
  // Preserve the body content in rawConfig for the translator/transformer
  if (body.trim()) {
    manifest.rawConfig = { ...manifest.rawConfig, _skillMdBody: body.trim() };
  }
  return manifest;
}

/**
 * 自动检测格式并解析 skill 配置文件
 * 根据文件扩展名选择 YAML、JSON 或 Markdown 解析器
 */
export function parseSkillManifest(filePath: string, content: string): ParsedManifest {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.yaml':
    case '.yml':
      return parseOpenClawYaml(content);
    case '.json':
      return parseOpenClawJson(content);
    case '.md':
      return parseSkillMdFormat(content);
    default:
      throw new Error(`Unsupported manifest file extension: ${ext}`);
  }
}


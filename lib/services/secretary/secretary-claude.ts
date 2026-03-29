/**
 * Secretary Claude Agent SDK Service
 *
 * Full Claude Agent SDK integration for the Secretary, supporting:
 * - Streaming AI responses (token-by-token via SSE)
 * - Tool chain (Read, Write, Edit, Bash, Glob, Grep, Skill)
 * - Session-based context continuity (resume)
 * - SOUL personality injection
 * - Memory and API skill registry injection
 * - Employee list and @dispatch support
 *
 * Modeled after lib/services/lan-peer/lan-claude.ts
 */

import {
  query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKAssistantMessage,
  type SDKSystemMessage,
  type SDKPartialAssistantMessage,
  type HookInput,
  type SyncHookJSONOutput,
  type HookCallback,
  type Options,
} from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { buildSoulPromptBlock } from '@/lib/services/secretary-soul';
import { getClaudeCodeExecutablePath, getBuiltinNodeDir, USER_SKILLS_DIR_ABSOLUTE } from '@/lib/config/paths';
import { CLAUDE_DEFAULT_MODEL, normalizeClaudeModelId } from '@/lib/constants/claudeModels';
import { loadMemory } from '@/lib/services/secretary-memory';
import { searchMemory, type RetrievalResult } from '@/lib/services/memory-retriever';
import { buildMemoryPromptBlockFromResults } from '@/lib/services/secretary-memory-prompt';
import { timelineLogger } from '@/lib/services/timeline';
import { inferActionFromToolName, extractPathFromInput, type ToolAction } from '@/lib/utils/sdk-tool-helpers';

// ========== Constants ==========

export const SECRETARY_SENDER_ID = 'secretary-ai';
export const SECRETARY_SENDER_NAME = '秘书';

// ========== Environment-aware path helpers (packaged Electron uses env vars) ==========

/** Writable data dir: SETTINGS_DIR (set by Electron main) or fallback to cwd/data */
function getDataDir(): string {
  return process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
}

/** User skills dir: USER_SKILLS_DIR (set by Electron main) or fallback */
function getUserSkillsDir(): string {
  return process.env.USER_SKILLS_DIR || path.join(process.cwd(), 'data', 'user-skills');
}

/** User employees dir: USER_EMPLOYEES_DIR (set by Electron main) or fallback */
function getUserEmployeesDir(): string {
  return process.env.USER_EMPLOYEES_DIR || path.join(process.cwd(), 'data', 'employees');
}

/** Builtin skills dir - stays in app resources, not user data */
function getBuiltinSkillsDir(): string {
  const resourcesPath = process.env.GENVIS_RESOURCES_PATH || (process as any).resourcesPath;
  if (resourcesPath && fsSync.existsSync(path.join(resourcesPath, 'skills'))) {
    return path.join(resourcesPath, 'skills');
  }
  return path.join(process.cwd(), 'skills');
}

// Default work directory for secretary file operations
const SECRETARY_WORK_DIR = path.join(getDataDir(), 'secretary-uploads');

// Tool action inference imported from '@/lib/utils/sdk-tool-helpers'

// ========== Config Loader ==========

interface ClaudeConfig {
  baseUrl?: string;
  authToken?: string;
  customModel?: string;
}

/**
 * Load Claude API config from global settings.
 * Returns a pure config object — does NOT mutate process.env.
 */
async function loadClaudeConfig(): Promise<ClaudeConfig> {
  const config: ClaudeConfig = {};
  try {
    const { loadGlobalSettings } = await import('@/lib/services/settings');
    const globalSettings = await loadGlobalSettings();
    const claudeSettings = globalSettings.cli_settings?.claude;

    if (claudeSettings) {
      if (typeof claudeSettings.apiUrl === 'string' && claudeSettings.apiUrl.trim()) {
        config.baseUrl = claudeSettings.apiUrl.trim();
      }
      if (typeof claudeSettings.apiKey === 'string' && claudeSettings.apiKey.trim()) {
        config.authToken = claudeSettings.apiKey.trim();
      }
      if (typeof claudeSettings.customModel === 'string' && claudeSettings.customModel.trim()) {
        config.customModel = claudeSettings.customModel.trim();
      }
    }
  } catch (error) {
    console.error('[SecretaryClaude] Failed to load config:', error);
  }
  return config;
}

// ========== System Prompt Builder (modularized, Task 8) ==========

/** Build SOUL personality block */
async function buildSoulSection(): Promise<string | null> {
  try {
    const soulBlock = await buildSoulPromptBlock();
    if (soulBlock) {
      return `\n========== 人格设定 ==========\n${soulBlock}\n==============================`;
    }
  } catch (err) {
    console.warn('[SecretaryClaude] Failed to load SOUL block:', err);
  }
  return null;
}

/** Build memory section via BM25 retrieval */
async function buildMemorySection(message?: string): Promise<string | null> {
  try {
    const memory = await loadMemory();
    let retrievalResults: RetrievalResult[] = [];

    const isIdentityQuery = message && /^(我是谁|你认识我吗|你知道我是谁|我的信息|我的资料|关于我)/.test(message.trim());

    if (isIdentityQuery) {
      retrievalResults = (memory.user_profile || []).map(entry => ({
        entry,
        score: 1.0,
        layer: 'long_term' as const,
      }));
      console.log(`[SecretaryClaude] Identity query detected, returning ${retrievalResults.length} user_profile entries`);
    } else if (message && message.trim().length > 1) {
      retrievalResults = searchMemory(message.trim(), memory, 10);
      console.log(`[SecretaryClaude] BM25 retrieval: ${retrievalResults.length} results for query "${message.slice(0, 50)}"`);
    }

    const memoryBlock = buildMemoryPromptBlockFromResults(retrievalResults);
    if (memoryBlock) {
      return `\n========== 记忆 ==========\n${memoryBlock}\n==========================`;
    }
  } catch (err) {
    console.warn('[SecretaryClaude] Failed to load memory:', err);
  }
  return null;
}

/** Build API skill registry section. Returns section text + set of registered skill names. */
async function buildApiRegistrySection(): Promise<{ section: string | null; registeredNames: Set<string> }> {
  const registeredNames = new Set<string>();
  try {
    const registryPath = path.join(getDataDir(), 'api-skill-registry.json');
    if (!fsSync.existsSync(registryPath)) return { section: null, registeredNames };
    const registryContent = await fs.readFile(registryPath, 'utf-8');
    const registry = JSON.parse(registryContent);
    if (!registry.skills || !Array.isArray(registry.skills) || registry.skills.length === 0) {
      return { section: null, registeredNames };
    }

    // Deployed skill ports
    let deployedSkillPorts: Record<string, number> = {};
    try {
      const pluginExPath = path.join(getUserSkillsDir(), '.claude-plugin', 'plugin-ex.json');
      if (fsSync.existsSync(pluginExPath)) {
        const pluginExContent = await fs.readFile(pluginExPath, 'utf-8');
        const pluginEx = JSON.parse(pluginExContent);
        if (pluginEx.deployedSkills) {
          for (const [name, meta] of Object.entries(pluginEx.deployedSkills)) {
            const m = meta as any;
            if (m.port && (m.status === 'deployed' || m.status === 'running')) {
              deployedSkillPorts[name] = m.port;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[SecretaryClaude] Failed to read deployed skill ports:', err);
    }
    console.log(`[SecretaryClaude] API skill ports: ${JSON.stringify(deployedSkillPorts)}`);

    // Relative URL skills
    const relativeUrlSkills = new Set<string>();
    for (const skillDir of [getBuiltinSkillsDir(), getUserSkillsDir()]) {
      try {
        const entries = await fs.readdir(skillDir);
        for (const entry of entries) {
          try {
            const epContent = await fs.readFile(path.join(skillDir, entry, 'api-endpoints.json'), 'utf-8');
            const epData = JSON.parse(epContent);
            if (epData.useRelativeUrl && epData.skillName) relativeUrlSkills.add(epData.skillName);
          } catch {}
        }
      } catch {}
    }
    console.log(`[SecretaryClaude] Relative URL skills: ${[...relativeUrlSkills].join(', ') || 'none'}`);

    const lines: string[] = ['## 可用 API 接口\n', '以下接口可通过 Bash 工具使用 curl 调用:\n'];
    for (const skill of registry.skills) {
      const skillName = skill.skillName;
      const skillPort = deployedSkillPorts[skillName];
      registeredNames.add(skillName);

      let baseUrl: string | null = null;
      if (skillPort) baseUrl = `http://localhost:${skillPort}`;
      else if (relativeUrlSkills.has(skillName)) baseUrl = `http://localhost:${process.env.PORT || '3000'}`;

      if (!baseUrl) {
        lines.push(`### ${skill.displayName || skillName} (⚠️ 未运行)`);
        lines.push(`描述: ${skill.description || '无描述'}`);
        lines.push('**注意**: 该技能当前未运行，API 不可用\n');
        continue;
      }
      lines.push(`### ${skill.displayName || skillName}`);
      lines.push(`描述: ${skill.description || '无描述'}`);
      lines.push(`服务地址: ${baseUrl}`);
      if (skill.endpoints && Array.isArray(skill.endpoints)) {
        for (const endpoint of skill.endpoints) {
          const params = endpoint.parameters?.map((p: any) =>
            `${p.name}${p.required ? '*' : ''}: ${p.type} - ${p.description || ''}`
          ).join(', ') || '无参数';
          lines.push(`- ${endpoint.method} ${baseUrl}${endpoint.path}: ${endpoint.description || ''}`);
          lines.push(`  参数: ${params}`);
        }
      }
      lines.push('');
    }
    const firstPort = Object.values(deployedSkillPorts)[0] || Number(process.env.PORT || '3000');
    if (firstPort) {
      lines.push('调用方法: 使用 Bash 工具执行 curl 命令，例如:');
      lines.push('```bash');
      lines.push(`curl -s -X GET "http://localhost:${firstPort}/api/todos"`);
      lines.push(`curl -s -X POST "http://localhost:${firstPort}/api/todos" -H "Content-Type: application/json" -d '{"title": "任务名称"}'`);
      lines.push('```\n');
    }
    return { section: lines.join('\n'), registeredNames };
  } catch (err) {
    console.warn('[SecretaryClaude] Failed to load API skill registry:', err);
    return { section: null, registeredNames };
  }
}

/** Build skill SKILL.md descriptions section */
async function buildSkillDescriptionsSection(
  enabledSkills: string[],
  apiRegisteredSkillNames: Set<string>
): Promise<string | null> {
  if (enabledSkills.length === 0) return null;
  const skillsRoot = getBuiltinSkillsDir();
  const userSkillsRoot = getUserSkillsDir();
  const lines: string[] = ['## 可用技能插件\n', '**重要：使用 Skill 工具调用技能，不要手动执行脚本！**\n'];

  for (const skillName of enabledSkills) {
    if (apiRegisteredSkillNames.has(skillName)) {
      console.log(`[SecretaryClaude] Skipping SKILL.md for ${skillName} (API registry skill)`);
      continue;
    }
    const userPath = path.join(userSkillsRoot, skillName, 'SKILL.md');
    const builtinPath = path.join(skillsRoot, skillName, 'SKILL.md');
    let skillContent: string | null = null;
    let actualSkillDir: string | null = null;

    try {
      await fs.access(userPath);
      skillContent = await fs.readFile(userPath, 'utf-8');
      actualSkillDir = path.join(userSkillsRoot, skillName);
      console.log(`[SecretaryClaude] Loaded SKILL.md from user-skills: ${skillName}`);
    } catch {}
    if (!skillContent) {
      try {
        await fs.access(builtinPath);
        skillContent = await fs.readFile(builtinPath, 'utf-8');
        actualSkillDir = path.join(skillsRoot, skillName);
        console.log(`[SecretaryClaude] Loaded SKILL.md from skills: ${skillName}`);
      } catch {
        console.warn(`[SecretaryClaude] SKILL.md not found for skill: ${skillName}`);
      }
    }
    if (skillContent && actualSkillDir) {
      let cleaned = skillContent.replace(/^---\n[\s\S]*?---\n/, '').trim();
      cleaned = cleaned.replace(/\$\{SKILL_DIR\}/g, actualSkillDir);
      lines.push(`### ${skillName}\n${cleaned.slice(0, 800)}${cleaned.length > 800 ? '...' : ''}\n`);
    }
  }
  return lines.length > 2 ? lines.join('\n') : null;
}

/** Build employee dispatch section */
async function buildEmployeeSection(isIMMode: boolean): Promise<string | null> {
  if (isIMMode) return null;
  try {
    const allEmployees: Array<{ id: string; name: string; description: string; mode: string }> = [];
    const builtinPath = path.join(process.cwd(), 'builtin-employees.json');
    if (fsSync.existsSync(builtinPath)) {
      const data = JSON.parse(await fs.readFile(builtinPath, 'utf-8'));
      if (data.employees && Array.isArray(data.employees)) allEmployees.push(...data.employees);
    }
    const userPath = path.join(getUserEmployeesDir(), 'user-employees.json');
    if (fsSync.existsSync(userPath)) {
      const data = JSON.parse(await fs.readFile(userPath, 'utf-8'));
      if (data.employees && Array.isArray(data.employees)) {
        allEmployees.push(...data.employees);
        console.log(`[SecretaryClaude] Loaded ${data.employees.length} custom employees`);
      }
    }
    if (allEmployees.length === 0) return null;

    const lines: string[] = ['## 可用员工\n', '当用户消息中包含 @员工名 时，通过 Bash 工具调用派发 API：\n'];
    const port = process.env.PORT || '3000';
    for (const emp of allEmployees) {
      if (emp.mode === 'secretary' || emp.mode === 'boss' || emp.mode === 'cli') continue;
      lines.push(`- **${emp.name}** (ID: ${emp.id})`);
      lines.push(`  能力: ${emp.description}`);
      lines.push(`  触发: @${emp.name}`);
    }
    lines.push('\n**派发方法**: 使用 POST /api/projects 接口创建项目并自动启动');
    lines.push('```bash');
    lines.push(`curl -s -X POST "http://localhost:${port}/api/projects" \\`);
    lines.push('  -H "Content-Type: application/json" \\');
    lines.push(`  -d '{"project_id":"p-xxx","name":"任务名称","initialPrompt":"具体任务指令","employee_id":"员工ID","mode":"code","autoStart":true}'`);
    lines.push('```\n');
    return lines.join('\n');
  } catch (err) {
    console.warn('[SecretaryClaude] Failed to load employees:', err);
    return null;
  }
}

/** Build skill tool usage instructions */
function buildSkillToolInstructions(skillToolOnlySkills: string[]): string | null {
  if (skillToolOnlySkills.length === 0) return null;
  return `## 技能调用方法（重要）

**必须使用 Skill 工具调用技能，禁止手动执行脚本！**

调用格式：
\`\`\`
Skill 工具参数:
{
  "skill": "技能名称",
  "prompt": "具体任务描述"
}
\`\`\`

可用技能: ${skillToolOnlySkills.join(', ')}

**安全规则：只允许调用以上列出的技能！调用未列出的技能将被系统拦截。**

示例：
- 天气查询：Skill("weather-query", "查询北京今天的天气")
- 搜索：Skill("baidu-search", "搜索关于人工智能的最新资讯")

**禁止行为**：
- ❌ 不要使用 python3/node 执行技能脚本
- ❌ 不要使用 \${SKILL_DIR} 变量（未设置）
- ❌ 不要先探索技能目录结构
- ✅ 直接使用 Skill 工具调用技能`;
}

/** Build general capabilities and safety rules section */
function buildGeneralCapabilities(workDir: string): string {
  return `## 通用能力

如果以上接口和技能都不能满足需求，你可以直接使用 Bash/Read/Write/Edit 等工具，
在工作目录 ${workDir} 下编写脚本或代码来完成任务。

## 执行原则

1. **匹配 API 接口** — 使用 curl 调用已部署的 REST API 服务
2. **使用 Skill 工具** — 调用插件型技能（如百度搜索、天气查询）
3. **识别 @员工名** — 派发给对应员工处理
4. **使用通用工具链** — 灵活兜底

## 安全限制

- 工作目录: ${workDir}
- 禁止访问系统敏感目录
- 禁止执行危险命令（rm -rf, 格式化等）
- 涉及用户数据的操作需确认

## 语言要求

- 始终使用中文（简体）回复
- 保持简洁友好`;
}

/**
 * Build the complete system prompt for secretary with smart routing.
 * Orchestrates modular sub-functions for each prompt section.
 */
export async function buildSecretarySystemPrompt(
  enabledSkills: string[] = [],
  workDir: string = SECRETARY_WORK_DIR,
  isIMMode: boolean = false,
  message?: string
): Promise<string> {
  const parts: string[] = [];

  // 1. Base identity
  parts.push(`你是秘书助手，请根据用户需求自动选择最佳执行方式。`);

  // 2. SOUL personality
  const soul = await buildSoulSection();
  if (soul) parts.push(soul);

  // 3. Memory (BM25 retrieval)
  const mem = await buildMemorySection(message);
  if (mem) parts.push(mem);

  // 4. API skill registry (first-level routing)
  const { section: apiSection, registeredNames: apiRegisteredSkillNames } = await buildApiRegistrySection();
  if (apiSection) parts.push(apiSection);

  // 5. Skill SKILL.md injection (second-level routing)
  const skillDesc = await buildSkillDescriptionsSection(enabledSkills, apiRegisteredSkillNames);
  if (skillDesc) parts.push(skillDesc);

  // 6. Employee dispatch
  const empSection = await buildEmployeeSection(isIMMode);
  if (empSection) parts.push(empSection);

  // 7. Skill tool usage instructions
  const skillToolOnlySkills = enabledSkills.filter(s => !apiRegisteredSkillNames.has(s));
  const toolInstr = buildSkillToolInstructions(skillToolOnlySkills);
  if (toolInstr) parts.push(toolInstr);

  // 8. General capabilities (third-level fallback)
  parts.push(buildGeneralCapabilities(workDir));

  return parts.join('\n\n');
}


// ========== Stream State ==========

interface AssistantStreamState {
  messageId: string;
  content: string;
  hasSentUpdate: boolean;
  finalized: boolean;
}

// ========== Main Executor ==========

export interface ExecuteSecretaryClaudeParams {
  message: string;
  sessionId?: string;
  enabledSkills?: string[];
  workDir?: string;
  requestId?: string;
  abortSignal?: AbortSignal;
  /** When true, disables employee dispatch capability (used for IM mode) */
  isIMMode?: boolean;
}

export interface ExecuteSecretaryClaudeResult {
  reply: string;
  newSessionId?: string;
  conversationStats?: Record<string, unknown>;
}

/**
 * Execute Claude Agent SDK query for the Secretary.
 *
 * Streams responses via secretaryStream SSE events.
 * Returns the complete AI reply text.
 */
export async function executeSecretaryClaude(
  params: ExecuteSecretaryClaudeParams
): Promise<ExecuteSecretaryClaudeResult> {
  const {
    message,
    sessionId,
    enabledSkills: paramSkills = [],
    workDir = SECRETARY_WORK_DIR,
    requestId = randomUUID(),
    abortSignal,
    isIMMode = false,
  } = params;

  // If enabledSkills not provided or empty, read from persistent settings
  let enabledSkills = paramSkills;
  if (!enabledSkills || enabledSkills.length === 0) {
    try {
      const { getSecretaryEnabledSkills } = await import('./secretary-settings');
      enabledSkills = await getSecretaryEnabledSkills();
      if (enabledSkills.length > 0) {
        console.log(`[SecretaryClaude] Loaded ${enabledSkills.length} skills from settings: ${enabledSkills.join(', ')}`);
      }
    } catch (err) {
      console.warn('[SecretaryClaude] Failed to load skills from settings:', err);
      enabledSkills = [];
    }
  }

  // Filter out API-registered skills from Skill plugin loading
  // API skills (like productivity-hub) use curl, not Skill tool
  let pluginSkills = [...enabledSkills];
  try {
    const registryPath = path.join(getDataDir(), 'api-skill-registry.json');
    if (fsSync.existsSync(registryPath)) {
      const registryContent = await fs.readFile(registryPath, 'utf-8');
      const registry = JSON.parse(registryContent);
      if (registry.skills && Array.isArray(registry.skills)) {
        const apiSkillNames = new Set(registry.skills.map((s: any) => s.skillName));
        pluginSkills = enabledSkills.filter(s => !apiSkillNames.has(s));
        if (pluginSkills.length < enabledSkills.length) {
          const filtered = enabledSkills.filter(s => apiSkillNames.has(s));
          console.log(`[SecretaryClaude] Filtered API skills from plugins: ${filtered.join(', ')}`);
        }
      }
    }
  } catch (err) {
    console.warn('[SecretaryClaude] Failed to filter API skills:', err);
  }

  console.log(`[SecretaryClaude] Starting | session=${sessionId || 'new'} | request=${requestId} | skills=${enabledSkills.length} | pluginSkills=${pluginSkills.length}`);

  const _startTime = Date.now();
  timelineLogger.logSystem('secretary', `AI request started: "${message.slice(0, 80)}"`, 'info', undefined, { messageLength: message.length, skills: enabledSkills.length, sessionId: sessionId || 'new' }).catch(() => {});

  // stderr buffer for debugging
  const stderrBuffer: string[] = [];
  let fullReply = '';
  let newSessionId: string | undefined;
  let conversationStats: Record<string, unknown> | undefined;

  // Try to import secretaryStream (may not exist yet if colleague hasn't created it)
  let secretaryStream: any = null;
  try {
    const streamModule = await import('../secretary-stream');
    secretaryStream = streamModule.secretaryStream;
  } catch {
    console.warn('[SecretaryClaude] secretaryStream not available, events will not be published');
  }

  try {
    // Load config and resolve model (Task 7: no process.env mutation)
    const claudeConfig = await loadClaudeConfig();
    const finalModel = claudeConfig.customModel || normalizeClaudeModelId(null);
    console.log(`[SecretaryClaude] Model: ${finalModel}`);

    // Ensure work directory exists
    await fs.mkdir(workDir, { recursive: true });

    // Build env with builtin node + API config (no global process.env mutation)
    const envWithBuiltinNode: Record<string, string | undefined> = { ...process.env };
    // Inject API config from settings into local env
    envWithBuiltinNode.ANTHROPIC_BASE_URL = claudeConfig.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.100agent.co';
    if (claudeConfig.authToken) {
      envWithBuiltinNode.ANTHROPIC_AUTH_TOKEN = claudeConfig.authToken;
    }
    const builtinNodeDir = getBuiltinNodeDir();
    if (builtinNodeDir) {
      envWithBuiltinNode.PATH = `${builtinNodeDir}:${process.env.PATH || ''}`;
    }

    // ========== Skill Plugin Loading (single directory, Task 1) ==========
    const skillsRoot = getBuiltinSkillsDir();
    const userSkillsRoot = getUserSkillsDir();

    const plugins: { type: 'local'; path: string }[] = [];
    if (pluginSkills.length > 0) {
      // Load USER_SKILLS_DIR_ABSOLUTE as single plugin directory.
      // SDK discovers skills from .claude-plugin/marketplace.json.
      // PreToolUse hook enforces enabledSkills whitelist.
      plugins.push({ type: 'local', path: USER_SKILLS_DIR_ABSOLUTE });
      console.log(`[SecretaryClaude] 🧩 Loading skill plugins from: ${USER_SKILLS_DIR_ABSOLUTE}`);
      console.log(`[SecretaryClaude] 🧩 Enabled plugin skills: ${pluginSkills.join(', ')}`);
    } else {
      console.log(`[SecretaryClaude] ℹ️ No plugin skills to load`);
    }

    // Inject env vars from enabled skills
    for (const skillName of enabledSkills) {
      try {
        const { getSkillEnvVars } = await import('@/lib/services/skill-service');
        const skillEnv = await getSkillEnvVars(skillName);
        if (Object.keys(skillEnv).length > 0) {
          Object.assign(envWithBuiltinNode, skillEnv);
          console.log(`[SecretaryClaude] 🔑 Injected env vars from skill "${skillName}":`, Object.keys(skillEnv));
        }
      } catch {}
    }

    // ========== Allowed Paths ==========
    const allowedPaths: string[] = [workDir];
    for (const skill of enabledSkills) {
      allowedPaths.push(path.join(skillsRoot, skill));
      allowedPaths.push(path.join(userSkillsRoot, skill));
    }
    allowedPaths.push(USER_SKILLS_DIR_ABSOLUTE);

    // ========== Hooks (typed, Task 2/4) ==========
    const postToolUseHook: HookCallback = async (input, toolUseID) => {
      try {
        if (input.hook_event_name !== 'PostToolUse') return {};
        const { tool_name: toolName, tool_input: rawInput } = input as Extract<HookInput, { hook_event_name: 'PostToolUse' }>;
        const toolInput = (rawInput ?? {}) as Record<string, unknown>;
        const toolResponse = (input as any).tool_response ?? '';
    
        console.log(`[SecretaryClaude] \u2705 PostToolUse: ${toolName} | id=${toolUseID}`);
    
        const action = inferActionFromToolName(toolName);
        const filePath = extractPathFromInput(toolInput);
        toolCallsLog.push({ toolName, filePath, action: action as string });
    
        // Log tool result to timeline
        const responsePreview = typeof toolResponse === 'string'
          ? toolResponse.slice(0, 200)
          : JSON.stringify(toolResponse).slice(0, 200);
        timelineLogger.logSDK('secretary', `${action}: ${toolName}${filePath ? ` -> ${filePath}` : ''}`, 'info', undefined, {
          toolName, action, filePath,
          responseLength: typeof toolResponse === 'string' ? toolResponse.length : 0,
          responsePreview,
        }).catch(() => {});
        const maxLen = 2000;
        const truncatedResponse = typeof toolResponse === 'string' && toolResponse.length > maxLen
          ? toolResponse.slice(0, maxLen) + '\n...(truncated)'
          : (typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse).slice(0, maxLen));
    
        // Publish ai_tool_result event
        if (secretaryStream) {
          secretaryStream.publish({
            type: 'ai_tool_result',
            data: { requestId, toolName, action, filePath, toolResponse: truncatedResponse, toolUseId: toolUseID, timestamp: new Date().toISOString() },
          });
        }
    
        return {};
      } catch (error) {
        console.warn(`[SecretaryClaude] Error in PostToolUse hook:`, error);
        return {};
      }
    };

    const postToolUseFailureHook: HookCallback = async (input, toolUseID) => {
      try {
        if (input.hook_event_name !== 'PostToolUseFailure') return {};
        const { tool_name: toolName, tool_input: rawInput, error: toolError } = input as Extract<HookInput, { hook_event_name: 'PostToolUseFailure' }>;
        const toolInput = (rawInput ?? {}) as Record<string, unknown>;
    
        console.log(`[SecretaryClaude] \u274c PostToolUseFailure: ${toolName} | id=${toolUseID}`);
    
        const errAction = inferActionFromToolName(toolName);
        const errFilePath = extractPathFromInput(toolInput);
        const errMessage = typeof toolError === 'string' ? toolError : JSON.stringify(toolError);
        timelineLogger.logError('secretary', `Tool failed: ${errAction} ${toolName}${errFilePath ? ` -> ${errFilePath}` : ''} - ${errMessage.slice(0, 200)}`, undefined, {
          toolName, action: errAction, filePath: errFilePath,
        }).catch(() => {});
    
        if (secretaryStream) {
          secretaryStream.publish({
            type: 'ai_tool_result',
            data: { requestId, toolName, action: errAction, filePath: errFilePath, toolError: errMessage, isError: true, toolUseId: toolUseID, timestamp: new Date().toISOString() },
          });
        }
    
        return {};
      } catch (err) {
        console.warn(`[SecretaryClaude] Error in PostToolUseFailure hook:`, err);
        return {};
      }
    };

    // PreToolUse hook: enforce skill whitelist + send ai_tool_use event
    const preToolUseHook: HookCallback = async (input, toolUseID) => {
      try {
        if (input.hook_event_name !== 'PreToolUse') return {};
        const { tool_name: toolName, tool_input: rawInput } = input as Extract<HookInput, { hook_event_name: 'PreToolUse' }>;
        const toolInput = (rawInput ?? {}) as Record<string, unknown>;

        // === Enforce enabled-skills-only for Skill tool ===
        if (toolName === 'Skill' && enabledSkills.length > 0) {
          const requestedSkill = (toolInput.skill || toolInput.name || '') as string;
          if (requestedSkill && !enabledSkills.includes(requestedSkill)) {
            console.warn(`[SecretaryClaude] Blocked disabled skill: "${requestedSkill}" | enabled: [${enabledSkills.join(', ')}]`);
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: 'deny' as const,
                permissionDecisionReason: `技能 "${requestedSkill}" 未启用。当前可用技能: ${enabledSkills.join(', ')}。请在秘书设置中启用该技能。`,
              },
            };
          }
        }

        const action = inferActionFromToolName(toolName);
        const filePath = extractPathFromInput(toolInput);

        console.log(`[SecretaryClaude] PreToolUse: ${toolName} | id=${toolUseID}`);

        // Log tool invocation to timeline
        timelineLogger.logSDK('secretary', `Using tool: ${toolName}${filePath ? ` -> ${filePath}` : ''}`, 'info', undefined, {
          toolName,
          action,
          filePath,
          toolInputPreview: JSON.stringify(toolInput).slice(0, 300),
        }).catch(() => {});

        // Publish ai_tool_use event BEFORE tool execution
        if (secretaryStream) {
          secretaryStream.publish({
            type: 'ai_tool_use',
            data: {
              requestId,
              toolName,
              toolInput,
              action,
              filePath,
              toolUseId: toolUseID,
              timestamp: new Date().toISOString(),
            },
          });
        }

        return {};
      } catch (err) {
        console.warn(`[SecretaryClaude] Error in PreToolUse hook:`, err);
        return {};
      }
    };

    // Stop hook: log graceful termination
    const stopHook: HookCallback = async (input) => {
      if (input.hook_event_name !== 'Stop') return {};
      console.log(`[SecretaryClaude] Stop hook triggered | request=${requestId}`);
      timelineLogger.logSDK('secretary', 'SDK stop hook triggered', 'info', undefined, { requestId }).catch(() => {});
      return {};
    };

    // Notification hook: forward SDK notifications to SSE
    const notificationHook: HookCallback = async (input) => {
      if (input.hook_event_name !== 'Notification') return {};
      const { message: notifMessage, title, notification_type } = input as Extract<HookInput, { hook_event_name: 'Notification' }>;
      console.log(`[SecretaryClaude] Notification: [${notification_type}] ${title ?? ''} - ${notifMessage}`);
      if (secretaryStream) {
        secretaryStream.publish({
          type: 'ai_notification',
          data: { requestId, title, message: notifMessage, notificationType: notification_type, timestamp: new Date().toISOString() },
        });
      }
      return {};
    };

    const hooks: Options['hooks'] = {
      PreToolUse: [{ hooks: [preToolUseHook] }],
      PostToolUse: [{ hooks: [postToolUseHook] }],
      PostToolUseFailure: [{ hooks: [postToolUseFailureHook] }],
      Stop: [{ hooks: [stopHook] }],
      Notification: [{ hooks: [notificationHook] }],
    };

    // ========== Call Claude Agent SDK ==========
    const hasPlugins = plugins.length > 0;
    console.log(`[SecretaryClaude] SDK query() options: { cwd: ${workDir}, plugins: ${hasPlugins ? plugins.length : 'none'}, model: ${finalModel} }`);

    const systemPrompt = await buildSecretarySystemPrompt(enabledSkills, workDir, isIMMode, message);

    // Log systemPrompt content
    timelineLogger.logSystem('secretary', `System prompt built (${systemPrompt.length} chars)`, 'info', undefined, {
      systemPromptPreview: systemPrompt.slice(0, 2000),
      model: finalModel,
      enabledSkills,
      sessionId: sessionId || 'new',
    }).catch(() => {});

    // AbortController for SDK-native cancellation (Task 3)
    const sdkAbortController = new AbortController();
    if (abortSignal) {
      // Forward external abort signal to SDK abort controller
      if (abortSignal.aborted) {
        sdkAbortController.abort();
      } else {
        abortSignal.addEventListener('abort', () => sdkAbortController.abort(), { once: true });
      }
    }

    const sdkOptions: Options = {
      cwd: workDir,
      additionalDirectories: allowedPaths,
      model: finalModel,
      resume: sessionId,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      systemPrompt,
      pathToClaudeCodeExecutable: getClaudeCodeExecutablePath(),
      env: envWithBuiltinNode,
      plugins: hasPlugins ? plugins : undefined,
      allowedTools: hasPlugins ? ['Skill', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'] : undefined,
      settingSources: hasPlugins ? ['project'] : undefined,
      hooks,
      // SDK-native abort (Task 3)
      abortController: sdkAbortController,
      // Safety/performance options (Task 5)
      maxTurns: 50,
      persistSession: !isIMMode,
      includePartialMessages: true,
      disallowedTools: ['AskUserQuestion'],
      stderr: (data: string) => {
        const line = String(data).trimEnd();
        if (!line) return;
        if (stderrBuffer.length > 100) stderrBuffer.shift();
        stderrBuffer.push(line);
        console.error(`[SecretaryClaude][stderr] ${line}`);
      },
    };

    const response = query({
      prompt: message,
      options: sdkOptions,
    });

    // Track assistant stream states
    const assistantStreamStates = new Map<string, AssistantStreamState>();
    const completedStreamSessions = new Set<string>();
    let hasPublishedContent = false;
    const toolCallsLog: Array<{ toolName: string; filePath?: string; action?: string }> = [];

    // Iterate streaming response (abort handled via sdkAbortController)
    for await (const msg of response) {
      // Check abort — SDK abortController handles cleanup, just break out
      if (sdkAbortController.signal.aborted) {
        console.log(`[SecretaryClaude] Aborted by user | request=${requestId}`);
        break;
      }

      console.log(`[SecretaryClaude] SDK message: type=${msg.type}`);

      // ─── stream_event: real-time streaming chunks ───
      if (msg.type === 'stream_event') {
        const partialMsg = msg as SDKPartialAssistantMessage;
        const event: Record<string, unknown> = (partialMsg.event ?? {}) as Record<string, unknown>;
        const sessionKey = partialMsg.session_id ?? partialMsg.uuid ?? 'default';

        let streamState = assistantStreamStates.get(sessionKey);

        switch (event.type) {
          case 'message_start': {
            const newState: AssistantStreamState = {
              messageId: randomUUID(),
              content: '',
              hasSentUpdate: false,
              finalized: false,
            };
            assistantStreamStates.set(sessionKey, newState);
            timelineLogger.logSDK('secretary', `SDK generate start`, 'info', undefined, {
              sessionKey,
              requestId,
            }).catch(() => {});
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta as Record<string, unknown> | string | undefined;
            let textChunk = '';
            if (typeof delta === 'string') {
              textChunk = delta;
            } else if (delta && typeof delta === 'object') {
              if (typeof delta.text === 'string') textChunk = delta.text;
              else if (typeof delta.delta === 'string') textChunk = delta.delta;
              else if (typeof delta.partial_json === 'string') {
                break; // Tool input streaming
              }
            }

            if (!textChunk) break;

            // Auto-create streamState if missing
            if (!streamState || streamState.finalized) {
              streamState = {
                messageId: randomUUID(),
                content: '',
                hasSentUpdate: false,
                finalized: false,
              };
              assistantStreamStates.set(sessionKey, streamState);
            }

            streamState.content += textChunk;
            streamState.hasSentUpdate = true;

            // Publish ai_stream_delta event
            if (secretaryStream) {
              secretaryStream.publish({
                type: 'ai_stream_delta',
                data: {
                  requestId,
                  messageId: streamState.messageId,
                  content: streamState.content,
                  delta: textChunk,
                  timestamp: new Date().toISOString(),
                },
              });
            }
            break;
          }

          case 'message_stop': {
            if (streamState && streamState.hasSentUpdate && !streamState.finalized) {
              const trimmedContent = streamState.content.trim();

              if (
                trimmedContent.length === 0 ||
                /^\[Tool:\s*.+\]$/i.test(trimmedContent) ||
                /^Using tool:/i.test(trimmedContent) ||
                /^Tool result:/i.test(trimmedContent)
              ) {
                assistantStreamStates.delete(sessionKey);
                break;
              }

              streamState.finalized = true;
              hasPublishedContent = true;
              completedStreamSessions.add(sessionKey);
              fullReply = trimmedContent;

              // Log assistant message completion
              timelineLogger.logSDK('secretary', `Assistant message generated (${trimmedContent.length} chars)`, 'info', undefined, {
                contentLength: trimmedContent.length,
                contentPreview: trimmedContent.slice(0, 200),
              }).catch(() => {});
            }

            assistantStreamStates.delete(sessionKey);
            break;
          }
        }

        continue;
      }

      // ─── system init: capture session ID ───
      if (msg.type === 'system') {
        const sysMsg = msg as SDKSystemMessage;
        if (sysMsg.subtype === 'init') {
          const initSessionId = sysMsg.session_id;
          if (initSessionId && typeof initSessionId === 'string') {
            console.log(`[SecretaryClaude] Session initialized: ${initSessionId}`);
            newSessionId = initSessionId;
            timelineLogger.logSystem('secretary', `SDK session initialized: ${initSessionId}`, 'info', undefined, {
              sessionId: initSessionId,
              model: finalModel,
              resumed: !!sessionId,
            }).catch(() => {});
          }
        }
        continue;
      }

      // ─── assistant: fallback for non-streaming responses ───
      if (msg.type === 'assistant') {
        const assistantMsg = msg as SDKAssistantMessage;
        const sessionKey = assistantMsg.session_id ?? assistantMsg.uuid ?? 'default';

        // Skip if already handled by stream_event
        if (completedStreamSessions.has(sessionKey)) {
          completedStreamSessions.delete(sessionKey);
          continue;
        }

        const assistantMessage = assistantMsg.message;
        let content = '';

        if (typeof assistantMessage?.content === 'string') {
          content = assistantMessage.content;
        } else if (Array.isArray(assistantMessage?.content)) {
          const parts: string[] = [];
          for (const block of assistantMessage.content) {
            if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
              const trimmed = block.text.trim();
              if (trimmed && !/^\[Tool:\s*/i.test(trimmed) && !/^Using tool:/i.test(trimmed) && !/^Tool result:/i.test(trimmed)) {
                parts.push(block.text);
              }
            }
          }
          content = parts.join('\n');
        }

        if (content.trim()) {
          hasPublishedContent = true;
          fullReply = content.trim();
          // Note: Don't send ai_stream_end here, wait for final completion
        }
        continue;
      }

      // ─── result: completion message + stats ───
      if (msg.type === 'result') {
        const resultMsg = msg as SDKResultMessage;
        const resultSubtype = resultMsg.subtype;
        console.log(`[SecretaryClaude] Task result: ${resultSubtype}`);

        // Extract conversation stats from SDK result (typed)
        const statsData: Record<string, unknown> = {
          duration_ms: resultMsg.duration_ms,
          duration_api_ms: resultMsg.duration_api_ms,
          total_cost_usd: resultMsg.total_cost_usd,
          num_turns: resultMsg.num_turns,
          modelUsage: resultMsg.modelUsage,
        };
        // SDK usage already uses snake_case, normalize for frontend
        if (resultMsg.usage) {
          const raw = resultMsg.usage;
          statsData.usage = {
            inputTokens: raw.input_tokens ?? 0,
            outputTokens: raw.output_tokens ?? 0,
            cacheReadInputTokens: raw.cache_read_input_tokens,
            cacheCreationInputTokens: raw.cache_creation_input_tokens,
          };
        }

        // Publish conversation_stats event for UI display
        if (Object.keys(statsData).length > 0) {
          conversationStats = statsData;
        }
        if (secretaryStream && conversationStats) {
          secretaryStream.publish({
            type: 'conversation_stats',
            data: statsData,
          });
        }

        // Log stats to timeline
        const usageInfo = statsData.usage as { inputTokens?: number; outputTokens?: number } | undefined;
        timelineLogger.logSDK('secretary', `SDK execution completed: ${resultSubtype}`, 'info', undefined, {
          resultSubtype,
          hasPublishedContent,
          toolsUsed: toolCallsLog.length,
          durationMs: statsData.duration_ms,
          durationApiMs: statsData.duration_api_ms,
          costUsd: statsData.total_cost_usd,
          inputTokens: usageInfo?.inputTokens,
          outputTokens: usageInfo?.outputTokens,
          numTurns: statsData.num_turns,
        }).catch(() => {});
        continue;
      }

      // Capture session ID for context continuity (generic fallback)
      if ('session_id' in msg && typeof msg.session_id === 'string') {
        newSessionId = msg.session_id;
      }
    }

    // If no content was published, send empty stream_end
    if (!hasPublishedContent && !sdkAbortController.signal.aborted) {
      console.warn(`[SecretaryClaude] No content published, sending empty stream_end`);
      if (secretaryStream) {
        secretaryStream.publish({
          type: 'ai_stream_end',
          data: {
            requestId,
            error: 'AI 未产生任何回复内容',
            timestamp: new Date().toISOString(),
          },
        });
      }
    } else if (hasPublishedContent && !sdkAbortController.signal.aborted) {
      // Send final ai_stream_end when content was published
      if (secretaryStream) {
        secretaryStream.publish({
          type: 'ai_stream_end',
          data: {
            requestId,
            content: fullReply,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    const wasAborted = sdkAbortController.signal.aborted;
    console.log(`[SecretaryClaude] Completed | request=${requestId}${wasAborted ? ' (aborted)' : ''}`);

    const _elapsed = Date.now() - _startTime;
    timelineLogger.logSDK('secretary', `AI request completed${wasAborted ? ' (aborted)' : ''}`, 'info', undefined, {
      userMessage: message.slice(0, 500),
      replyLength: fullReply.length,
      replyPreview: fullReply.slice(0, 1000),
      sessionId: newSessionId || sessionId,
      model: finalModel,
      durationMs: _elapsed,
      toolsUsed: toolCallsLog.slice(0, 50),
    }).catch(() => {});

    return {
      reply: fullReply,
      newSessionId,
      conversationStats,
    };

  } catch (error) {
    // If aborted, don't treat as error
    if (abortSignal?.aborted) {
      console.log(`[SecretaryClaude] Aborted by user (catch) | request=${requestId}`);
      return { reply: '' };
    }

    console.error(`[SecretaryClaude] Error:`, error);

    // Surface stderr for debugging
    if (stderrBuffer.length > 0) {
      console.error(`[SecretaryClaude] Last stderr lines:\n${stderrBuffer.slice(-10).join('\n')}`);
    }

    // Check if session is invalid — auto-retry WITHOUT session (start fresh)
    const errMsg = (error as Error).message || '';
    const isSessionError = /No conversation found|session.*not found/i.test(errMsg) ||
      stderrBuffer.some((l: string) => /No conversation found|session.*not found/i.test(l));

    if (isSessionError && sessionId) {
      console.log(`[SecretaryClaude] Session expired, retrying without session`);
      try {
        return await executeSecretaryClaude({ ...params, sessionId: undefined });
      } catch (retryErr) {
        console.error(`[SecretaryClaude] Retry also failed:`, retryErr);
      }
    }

    // Build user-friendly error message
    let errorContent = 'AI 回复失败';
    if (/not authenticated|auth/i.test(errMsg) || stderrBuffer.some((l: string) => /auth\s+login|not\s+logged/i.test(l))) {
      errorContent = 'AI 回复失败: Claude CLI 未认证，请运行 claude auth login';
    } else if (/command not found/i.test(errMsg)) {
      errorContent = 'AI 回复失败: Claude CLI 未安装，请运行 npm install -g @anthropic-ai/claude-code';
    } else {
      const tail = stderrBuffer.slice(-5).join(' ');
      errorContent = `AI 回复失败: ${errMsg || tail || '未知错误'}`;
    }

    const _errTail = stderrBuffer.slice(-5).join(' ');
    timelineLogger.logError('secretary', `AI request failed: ${errMsg || _errTail || 'unknown error'}`, undefined, { messageLength: message.length, sessionId: sessionId || 'new' }).catch(() => {});

    if (secretaryStream) {
      secretaryStream.publish({
        type: 'ai_stream_end',
        data: {
          requestId,
          content: errorContent,
          error: errorContent,
          timestamp: new Date().toISOString(),
        },
      });
    }

    return { reply: errorContent };
  }
}

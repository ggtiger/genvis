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

import { query } from '@anthropic-ai/claude-agent-sdk';
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

// ========== Constants ==========

export const SECRETARY_SENDER_ID = 'secretary-ai';
export const SECRETARY_SENDER_NAME = '秘书';

// Default work directory for secretary file operations
const SECRETARY_WORK_DIR = path.join(process.cwd(), 'data', 'secretary-uploads');

// ========== Tool Action Inference ==========

type ToolAction = 'Read' | 'Created' | 'Edited' | 'Deleted' | 'Searched' | 'Executed' | 'Generated';

const TOOL_NAME_ACTION_MAP: Record<string, ToolAction> = {
  Read: 'Read', read: 'Read', read_file: 'Read', 'read-file': 'Read',
  Write: 'Created', write: 'Created', write_file: 'Created', 'write-file': 'Created', create_file: 'Created',
  Edit: 'Edited', edit: 'Edited', edit_file: 'Edited', 'edit-file': 'Edited', update_file: 'Edited', apply_patch: 'Edited', patch_file: 'Edited',
  remove_file: 'Deleted', delete_file: 'Deleted', delete: 'Deleted', remove: 'Deleted',
  list_files: 'Searched', list: 'Searched', ls: 'Searched',
  Glob: 'Searched', glob: 'Searched', glob_files: 'Searched', search_files: 'Searched',
  Grep: 'Searched', grep: 'Searched',
  Bash: 'Executed', bash: 'Executed', run: 'Executed', run_bash: 'Executed', shell: 'Executed',
  Skill: 'Executed', skill: 'Executed',
  todo_write: 'Generated', todo: 'Generated', plan_write: 'Generated',
};

function inferActionFromToolName(toolName: string): ToolAction {
  const normalized = toolName.trim().toLowerCase();
  if (TOOL_NAME_ACTION_MAP[toolName]) return TOOL_NAME_ACTION_MAP[toolName];
  if (TOOL_NAME_ACTION_MAP[normalized]) return TOOL_NAME_ACTION_MAP[normalized];
  const suffix = normalized.split(':').pop() ?? normalized;
  if (suffix && TOOL_NAME_ACTION_MAP[suffix]) return TOOL_NAME_ACTION_MAP[suffix];
  // Fallback heuristics
  if (/read|open|view/i.test(normalized)) return 'Read';
  if (/write|create|add/i.test(normalized)) return 'Created';
  if (/edit|modify|update|patch/i.test(normalized)) return 'Edited';
  if (/delete|remove/i.test(normalized)) return 'Deleted';
  if (/search|find|list|glob|ls|grep/i.test(normalized)) return 'Searched';
  if (/execute|exec|run|bash|shell|command/i.test(normalized)) return 'Executed';
  return 'Executed';
}

function extractPathFromInput(toolInput: Record<string, unknown>): string | undefined {
  const keys = ['file_path', 'filePath', 'path', 'target', 'file', 'filename', 'directory', 'dir', 'pattern', 'command'];
  for (const key of keys) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return undefined;
}

// ========== Config Loader ==========

async function loadAndApplyClaudeConfig(): Promise<string | undefined> {
  let customModel: string | undefined;
  try {
    const { loadGlobalSettings } = await import('@/lib/services/settings');
    const globalSettings = await loadGlobalSettings();
    const claudeSettings = globalSettings.cli_settings?.claude;

    if (claudeSettings) {
      if (typeof claudeSettings.apiUrl === 'string' && claudeSettings.apiUrl.trim()) {
        process.env.ANTHROPIC_BASE_URL = claudeSettings.apiUrl.trim();
      } else if (!process.env.ANTHROPIC_BASE_URL) {
        process.env.ANTHROPIC_BASE_URL = 'https://api.100agent.co';
      }

      if (typeof claudeSettings.apiKey === 'string' && claudeSettings.apiKey.trim()) {
        process.env.ANTHROPIC_AUTH_TOKEN = claudeSettings.apiKey.trim();
      }

      if (typeof claudeSettings.customModel === 'string' && claudeSettings.customModel.trim()) {
        customModel = claudeSettings.customModel.trim();
      }
    }
  } catch (error) {
    console.error('[SecretaryClaude] Failed to load config:', error);
  }
  return customModel;
}

// ========== System Prompt Builder ==========

/**
 * Build the complete system prompt for secretary with smart routing.
 * Includes:
 * - SOUL personality block
 * - Memory content
 * - API skill registry (first-level routing)
 * - Skill SKILL.md content (second-level routing)
 * - General capabilities (third-level fallback)
 * - Employee list with @dispatch instructions
 */
export async function buildSecretarySystemPrompt(
  enabledSkills: string[] = [],
  workDir: string = SECRETARY_WORK_DIR,
  isIMMode: boolean = false,
  message?: string
): Promise<string> {
  const parts: string[] = [];
  
  // Track API-registered skills to avoid duplicate Skill tool injection
  let apiRegisteredSkillNames: Set<string> = new Set();

  // 1. Base identity
  parts.push(`你是秘书助手，请根据用户需求自动选择最佳执行方式。`);

  // 2. SOUL personality block
  try {
    const soulBlock = await buildSoulPromptBlock();
    if (soulBlock) {
      parts.push(`\n========== 人格设定 ==========\n${soulBlock}\n==============================`);
    }
  } catch (err) {
    console.warn('[SecretaryClaude] Failed to load SOUL block:', err);
  }

  // 3. Memory content (BM25 retrieval-based)
  try {
    const memory = await loadMemory();
    let retrievalResults: RetrievalResult[] = [];
    
    // Check if this is an identity query - return all user_profile entries
    const isIdentityQuery = message && /^(我是谁|你认识我吗|你知道我是谁|我的信息|我的资料|关于我)/.test(message.trim());
    
    if (isIdentityQuery) {
      // Directly return all user_profile entries as high-score results
      retrievalResults = (memory.user_profile || []).map(entry => ({
        entry,
        score: 1.0,
        layer: 'long_term' as const,
      }));
      console.log(`[SecretaryClaude] Identity query detected, returning ${retrievalResults.length} user_profile entries`);
    } else if (message && message.trim().length > 1) {
      // Use BM25 retrieval for other queries
      retrievalResults = searchMemory(message.trim(), memory, 10);
      console.log(`[SecretaryClaude] BM25 retrieval: ${retrievalResults.length} results for query "${message.slice(0, 50)}"`);
    }
    
    // Format retrieval results into prompt block
    const memoryBlock = buildMemoryPromptBlockFromResults(retrievalResults);
    if (memoryBlock) {
      parts.push(
        `\n========== 记忆 ==========\n` +
        memoryBlock +
        `\n==========================`
      );
    }
  } catch (err) {
    console.warn('[SecretaryClaude] Failed to load memory:', err);
  }

  // 4. API Skill Registry (first-level routing)
  try {
    const registryPath = path.join(process.cwd(), 'data', 'api-skill-registry.json');
    if (fsSync.existsSync(registryPath)) {
      const registryContent = await fs.readFile(registryPath, 'utf-8');
      const registry = JSON.parse(registryContent);
      
      if (registry.skills && Array.isArray(registry.skills) && registry.skills.length > 0) {
        // 动态获取已部署技能的端口
        let deployedSkillPorts: Record<string, number> = {};
        try {
          const pluginExPath = path.join(process.cwd(), 'data', 'user-skills', '.claude-plugin', 'plugin-ex.json');
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

        // Build set of skills that use relative URLs (main service port, no independent port)
        const relativeUrlSkills = new Set<string>();
        for (const skillDir of [path.join(process.cwd(), 'skills'), path.join(process.cwd(), 'data', 'user-skills')]) {
          try {
            const entries = await fs.readdir(skillDir);
            for (const entry of entries) {
              try {
                const epContent = await fs.readFile(path.join(skillDir, entry, 'api-endpoints.json'), 'utf-8');
                const epData = JSON.parse(epContent);
                if (epData.useRelativeUrl && epData.skillName) {
                  relativeUrlSkills.add(epData.skillName);
                }
              } catch {}
            }
          } catch {}
        }
        console.log(`[SecretaryClaude] Relative URL skills: ${[...relativeUrlSkills].join(', ') || 'none'}`);

        const apiEndpoints: string[] = [];
        apiEndpoints.push('## 可用 API 接口\n');
        apiEndpoints.push('以下接口可通过 Bash 工具使用 curl 调用:\n');
        
        for (const skill of registry.skills) {
          const skillName = skill.skillName;
          const skillPort = deployedSkillPorts[skillName];
          
          // Track API-registered skill names to avoid duplicate Skill tool injection
          apiRegisteredSkillNames.add(skillName);
          
          // Determine base URL: independent port, main service port (relativeUrl), or unavailable
          let baseUrl: string | null = null;
          if (skillPort) {
            baseUrl = `http://localhost:${skillPort}`;
          } else if (relativeUrlSkills.has(skillName)) {
            baseUrl = `http://localhost:${process.env.PORT || '3000'}`;
          }

          if (!baseUrl) {
            // 技能未运行且非主服务路由，跳过或标注
            apiEndpoints.push(`### ${skill.displayName || skillName} (⚠️ 未运行)`);
            apiEndpoints.push(`描述: ${skill.description || '无描述'}`);
            apiEndpoints.push('**注意**: 该技能当前未运行，API 不可用\n');
            continue;
          }
          apiEndpoints.push(`### ${skill.displayName || skillName}`);
          apiEndpoints.push(`描述: ${skill.description || '无描述'}`);
          apiEndpoints.push(`服务地址: ${baseUrl}`);
          
          if (skill.endpoints && Array.isArray(skill.endpoints)) {
            for (const endpoint of skill.endpoints) {
              const params = endpoint.parameters?.map((p: any) => 
                `${p.name}${p.required ? '*' : ''}: ${p.type} - ${p.description || ''}`
              ).join(', ') || '无参数';
              
              apiEndpoints.push(`- ${endpoint.method} ${baseUrl}${endpoint.path}: ${endpoint.description || ''}`);
              apiEndpoints.push(`  参数: ${params}`);
            }
          }
          apiEndpoints.push('');
        }
        
        // 生成示例（使用第一个可用技能的端口）
        const firstAvailablePort = Object.values(deployedSkillPorts)[0] || Number(process.env.PORT || '3000');
        if (firstAvailablePort) {
          apiEndpoints.push('调用方法: 使用 Bash 工具执行 curl 命令，例如:');
          apiEndpoints.push('```bash');
          apiEndpoints.push(`curl -s -X GET "http://localhost:${firstAvailablePort}/api/todos"`);
          apiEndpoints.push(`curl -s -X POST "http://localhost:${firstAvailablePort}/api/todos" -H "Content-Type: application/json" -d '{"title": "任务名称"}'`);
          apiEndpoints.push('```\n');
        }
        
        parts.push(apiEndpoints.join('\n'));
      }
    }
  } catch (err) {
    console.warn('[SecretaryClaude] Failed to load API skill registry:', err);
  }

  // 5. Skill SKILL.md injection (second-level routing)
  if (enabledSkills.length > 0) {
    const skillsRoot = path.join(process.cwd(), 'skills');
    const userSkillsRoot = path.join(process.cwd(), 'data', 'user-skills');
    const skillDescriptions: string[] = [];
    skillDescriptions.push('## 可用技能插件\n');
    skillDescriptions.push('**重要：使用 Skill 工具调用技能，不要手动执行脚本！**\n');

    for (const skillName of enabledSkills) {
      // Skip skills already registered in API registry (they use curl, not Skill tool)
      if (apiRegisteredSkillNames.has(skillName)) {
        console.log(`[SecretaryClaude] ⏭️ Skipping SKILL.md for ${skillName} (API registry skill)`);
        continue;
      }
      
      // Priority: user-skills > builtin skills
      const userPath = path.join(userSkillsRoot, skillName, 'SKILL.md');
      const builtinPath = path.join(skillsRoot, skillName, 'SKILL.md');
      const userSkillDir = path.join(userSkillsRoot, skillName);
      const builtinSkillDir = path.join(skillsRoot, skillName);
      let skillContent: string | null = null;
      let actualSkillDir: string | null = null;

      try {
        await fs.access(userPath);
        skillContent = await fs.readFile(userPath, 'utf-8');
        actualSkillDir = userSkillDir;
        console.log(`[SecretaryClaude] 📖 Loaded SKILL.md from user-skills: ${skillName}`);
      } catch {}

      if (!skillContent) {
        try {
          await fs.access(builtinPath);
          skillContent = await fs.readFile(builtinPath, 'utf-8');
          actualSkillDir = builtinSkillDir;
          console.log(`[SecretaryClaude] 📖 Loaded SKILL.md from skills: ${skillName}`);
        } catch {
          console.warn(`[SecretaryClaude] ⚠️ SKILL.md not found for skill: ${skillName}`);
        }
      }

      if (skillContent && actualSkillDir) {
        // Strip frontmatter (---...--- block) for cleaner injection
        let contentWithoutFrontmatter = skillContent.replace(/^---\n[\s\S]*?---\n/, '').trim();
        // Replace ${SKILL_DIR} placeholder with actual path
        contentWithoutFrontmatter = contentWithoutFrontmatter.replace(/\$\{SKILL_DIR\}/g, actualSkillDir);
        skillDescriptions.push(
          `### ${skillName}\n${contentWithoutFrontmatter.slice(0, 800)}${contentWithoutFrontmatter.length > 800 ? '...' : ''}\n`
        );
      }
    }

    if (skillDescriptions.length > 1) {
      parts.push(skillDescriptions.join('\n'));
    }
  }

  // 6. Employee list with @dispatch instructions
  // Skip employee dispatch capability in IM mode to prevent auto-dispatch
  if (!isIMMode) {
    // Read from both builtin-employees.json and data/employees/user-employees.json
    try {
      const allEmployees: Array<{ id: string; name: string; description: string; mode: string }> = [];
        
      // Load builtin employees
      const builtinPath = path.join(process.cwd(), 'builtin-employees.json');
      if (fsSync.existsSync(builtinPath)) {
        const builtinContent = await fs.readFile(builtinPath, 'utf-8');
        const builtinData = JSON.parse(builtinContent);
        if (builtinData.employees && Array.isArray(builtinData.employees)) {
          allEmployees.push(...builtinData.employees);
        }
      }
        
      // Load custom employees from data/employees/user-employees.json
      const userEmployeesPath = path.join(process.cwd(), 'data', 'employees', 'user-employees.json');
      if (fsSync.existsSync(userEmployeesPath)) {
        const userContent = await fs.readFile(userEmployeesPath, 'utf-8');
        const userData = JSON.parse(userContent);
        if (userData.employees && Array.isArray(userData.employees)) {
          allEmployees.push(...userData.employees);
          console.log(`[SecretaryClaude] Loaded ${userData.employees.length} custom employees`);
        }
      }
        
      if (allEmployees.length > 0) {
        const employeeList: string[] = [];
        employeeList.push('## 可用员工\n');
        employeeList.push('当用户消息中包含 @员工名 时，通过 Bash 工具调用派发 API：\n');
          
        // Get the server port dynamically
        const serverPort = process.env.PORT || '3000';
          
        for (const emp of allEmployees) {
          // Skip secretary and non-dispatchable modes
          if (emp.mode === 'secretary' || emp.mode === 'boss' || emp.mode === 'cli') continue;
            
          employeeList.push(`- **${emp.name}** (ID: ${emp.id})`);
          employeeList.push(`  能力: ${emp.description}`);
          employeeList.push(`  触发: @${emp.name}`);
        }
          
        employeeList.push('\n**派发方法**: 使用 POST /api/projects 接口创建项目并自动启动');
        employeeList.push('```bash');
        employeeList.push(`curl -s -X POST "http://localhost:${serverPort}/api/projects" \\`);
        employeeList.push('  -H "Content-Type: application/json" \\');
        employeeList.push(`  -d '{"project_id":"p-xxx","name":"任务名称","initialPrompt":"具体任务指令","employee_id":"员工ID","mode":"code","autoStart":true}'`);
        employeeList.push('```\n');
          
        parts.push(employeeList.join('\n'));
      }
    } catch (err) {
      console.warn('[SecretaryClaude] Failed to load employees:', err);
    }
  }

  // 7. Skill tool usage instructions (IMPORTANT)
  // Filter out API-registered skills - they should use curl, not Skill tool
  const skillToolOnlySkills = enabledSkills.filter(s => !apiRegisteredSkillNames.has(s));
  if (skillToolOnlySkills.length > 0) {
    parts.push(`## 技能调用方法（重要）

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

示例：
- 天气查询：Skill("weather-query", "查询北京今天的天气")
- 搜索：Skill("baidu-search", "搜索关于人工智能的最新资讯")

**禁止行为**：
- ❌ 不要使用 python3/node 执行技能脚本
- ❌ 不要使用 \${SKILL_DIR} 变量（未设置）
- ❌ 不要先探索技能目录结构
- ✅ 直接使用 Skill 工具调用技能`);
  }

  // 8. General capabilities (third-level fallback)
  parts.push(`## 通用能力

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
- 保持简洁友好`);

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
    const registryPath = path.join(process.cwd(), 'data', 'api-skill-registry.json');
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

  const configuredMaxTokens = Number(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS);
  const maxOutputTokens = Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
    ? configuredMaxTokens
    : 16000;

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
    // Load config and resolve model
    const customModel = await loadAndApplyClaudeConfig();
    const finalModel = customModel || normalizeClaudeModelId(null);
    console.log(`[SecretaryClaude] Model: ${finalModel}`);

    // Ensure work directory exists
    await fs.mkdir(workDir, { recursive: true });

    // Build env with builtin node
    const envWithBuiltinNode = { ...process.env };
    const builtinNodeDir = getBuiltinNodeDir();
    if (builtinNodeDir) {
      envWithBuiltinNode.PATH = `${builtinNodeDir}:${process.env.PATH || ''}`;
    }

    // ========== Skill Plugin Loading ==========
    const skillsRoot = path.join(process.cwd(), 'skills');
    const userSkillsRoot = path.join(process.cwd(), 'data', 'user-skills');

    const plugins: { type: 'local'; path: string }[] = [];
    if (pluginSkills.length > 0) {
      plugins.push({ type: 'local', path: USER_SKILLS_DIR_ABSOLUTE });
      console.log(`[SecretaryClaude] 🧩 Loading skill plugins from: ${USER_SKILLS_DIR_ABSOLUTE}`);
      console.log(`[SecretaryClaude] 🧩 Plugin skills (Skill tool): ${pluginSkills.join(', ')}`);
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

    // ========== Hooks ==========
    const postToolUseHook = async (input: any, toolUseID: string) => {
      try {
        if (input.hook_event_name !== 'PostToolUse') return {};
        const toolName = input.tool_name || 'unknown';
        const toolInput = input.tool_input || {};
        const toolResponse = input.tool_response || '';

        console.log(`[SecretaryClaude] ✅ PostToolUse: ${toolName} | id=${toolUseID}`);

        const action = inferActionFromToolName(toolName);
        const filePath = extractPathFromInput(toolInput);
        toolCallsLog.push({ toolName, filePath, action: action as string });

        // Log tool result to timeline
        const responsePreview = typeof toolResponse === 'string'
          ? toolResponse.slice(0, 200)
          : JSON.stringify(toolResponse).slice(0, 200);
        timelineLogger.logSDK('secretary', `${action}: ${toolName}${filePath ? ` -> ${filePath}` : ''}`, 'info', undefined, {
          toolName,
          action,
          filePath,
          responseLength: typeof toolResponse === 'string' ? toolResponse.length : 0,
          responsePreview,
        }).catch(() => {});
        const maxLen = 2000;
        const truncatedResponse = typeof toolResponse === 'string' && toolResponse.length > maxLen
          ? toolResponse.slice(0, maxLen) + '\n...(truncated)'
          : (typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse).slice(0, maxLen));

        // Publish ai_tool_result event (ai_tool_use is sent in PreToolUse hook)
        if (secretaryStream) {
          secretaryStream.publish({
            type: 'ai_tool_result',
            data: {
              requestId,
              toolName,
              action,
              filePath,
              toolResponse: truncatedResponse,
              toolUseId: toolUseID, // Use SDK-provided ID for matching
              timestamp: new Date().toISOString(),
            },
          });
        }

        return {};
      } catch (error) {
        console.warn(`[SecretaryClaude] Error in PostToolUse hook:`, error);
        return {};
      }
    };

    const postToolUseFailureHook = async (input: any, toolUseID: string) => {
      try {
        if (input.hook_event_name !== 'PostToolUseFailure') return {};
        const toolName = input.tool_name || 'unknown';
        const toolInput = input.tool_input || {};
        const error = input.error || 'Unknown error';

        console.log(`[SecretaryClaude] ❌ PostToolUseFailure: ${toolName} | id=${toolUseID}`);

        // Log tool failure to timeline
        const errAction = inferActionFromToolName(toolName);
        const errFilePath = extractPathFromInput(toolInput);
        const errMessage = typeof error === 'string' ? error : JSON.stringify(error);
        timelineLogger.logError('secretary', `Tool failed: ${errAction} ${toolName}${errFilePath ? ` -> ${errFilePath}` : ''} - ${errMessage.slice(0, 200)}`, undefined, {
          toolName,
          action: errAction,
          filePath: errFilePath,
        }).catch(() => {});

        if (secretaryStream) {
          secretaryStream.publish({
            type: 'ai_tool_result',
            data: {
              requestId,
              toolName,
              action: inferActionFromToolName(toolName),
              filePath: extractPathFromInput(toolInput),
              toolError: typeof error === 'string' ? error : JSON.stringify(error),
              isError: true,
              toolUseId: toolUseID, // Use SDK-provided ID for matching
              timestamp: new Date().toISOString(),
            },
          });
        }

        return {};
      } catch (err) {
        console.warn(`[SecretaryClaude] Error in PostToolUseFailure hook:`, err);
        return {};
      }
    };

    // PreToolUse hook: send ai_tool_use event BEFORE tool execution
    const preToolUseHook = async (input: any, toolUseID: string) => {
      try {
        if (input.hook_event_name !== 'PreToolUse') return {};
        const toolName = input.tool_name || 'unknown';
        const toolInput = input.tool_input || {};
        const action = inferActionFromToolName(toolName);
        const filePath = extractPathFromInput(toolInput);

        console.log(`[SecretaryClaude] 🔧 PreToolUse: ${toolName} | id=${toolUseID}`);

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
              toolUseId: toolUseID, // Use SDK-provided ID for matching
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

    const hooks = {
      PreToolUse: [{ hooks: [preToolUseHook] }],
      PostToolUse: [{ hooks: [postToolUseHook] }],
      PostToolUseFailure: [{ hooks: [postToolUseFailureHook] }],
    };

    // ========== Call Claude Agent SDK ==========
    const hasPlugins = plugins.length > 0;
    console.log(`[SecretaryClaude] 🚀 SDK query() options: { cwd: ${workDir}, plugins: ${hasPlugins ? plugins.length : 'none'}, model: ${finalModel} }`);

    const systemPrompt = await buildSecretarySystemPrompt(enabledSkills, workDir, isIMMode, message);

    // Log systemPrompt content
    timelineLogger.logSystem('secretary', `System prompt built (${systemPrompt.length} chars)`, 'info', undefined, {
      systemPromptPreview: systemPrompt.slice(0, 2000),
      model: finalModel,
      enabledSkills,
      sessionId: sessionId || 'new',
    }).catch(() => {});

    const response = query({
      prompt: message,
      options: {
        cwd: workDir,
        additionalDirectories: allowedPaths,
        model: finalModel,
        resume: sessionId,
        permissionMode: 'bypassPermissions',
        systemPrompt,
        maxOutputTokens,
        pathToClaudeCodeExecutable: getClaudeCodeExecutablePath(),
        env: envWithBuiltinNode,
        plugins: hasPlugins ? plugins : undefined,
        allowedTools: hasPlugins ? ['Skill', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'] : undefined,
        settingSources: hasPlugins ? ['project'] : undefined,
        hooks,
        stderr: (data: string) => {
          const line = String(data).trimEnd();
          if (!line) return;
          if (stderrBuffer.length > 100) stderrBuffer.shift();
          stderrBuffer.push(line);
          console.error(`[SecretaryClaude][stderr] ${line}`);
        },
      } as any,
    });

    // Track assistant stream states
    const assistantStreamStates = new Map<string, AssistantStreamState>();
    const completedStreamSessions = new Set<string>();
    let hasPublishedContent = false;
    const toolCallsLog: Array<{ toolName: string; filePath?: string; action?: string }> = [];

    // Iterate streaming response
    for await (const msg of response) {
      // Check abort signal
      if (abortSignal?.aborted) {
        console.log(`[SecretaryClaude] Aborted by user | request=${requestId}`);
        try { (response as any).return?.(); } catch {}
        break;
      }

      console.log(`[SecretaryClaude] SDK message: type=${msg.type}`);

      // ─── stream_event: real-time streaming chunks ───
      if (msg.type === 'stream_event') {
        const event: any = (msg as any).event ?? {};
        const sessionKey = ((msg as any).session_id ?? (msg as any).uuid ?? 'default').toString();

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
            const delta = event.delta;
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
      if (msg.type === 'system' && (msg as any).subtype === 'init') {
        const initSessionId = (msg as any).session_id;
        if (initSessionId && typeof initSessionId === 'string') {
          console.log(`[SecretaryClaude] Session initialized: ${initSessionId}`);
          newSessionId = initSessionId;
          timelineLogger.logSystem('secretary', `SDK session initialized: ${initSessionId}`, 'info', undefined, {
            sessionId: initSessionId,
            model: finalModel,
            resumed: !!sessionId,
          }).catch(() => {});
        }
        continue;
      }

      // ─── assistant: fallback for non-streaming responses ───
      if (msg.type === 'assistant') {
        const sessionKey = ((msg as any).session_id ?? (msg as any).uuid ?? 'default').toString();

        // Skip if already handled by stream_event
        if (completedStreamSessions.has(sessionKey)) {
          completedStreamSessions.delete(sessionKey);
          continue;
        }

        const assistantMessage = (msg as any).message;
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
        const resultMsg = msg as any;
        const resultSubtype = resultMsg.subtype || 'unknown';
        console.log(`[SecretaryClaude] Task result: ${resultSubtype}`);

        // Extract conversation stats from SDK result
        const statsData: Record<string, unknown> = {};
        if (typeof resultMsg.duration_ms === 'number') statsData.duration_ms = resultMsg.duration_ms;
        if (typeof resultMsg.duration_api_ms === 'number') statsData.duration_api_ms = resultMsg.duration_api_ms;
        if (typeof resultMsg.total_cost_usd === 'number') statsData.total_cost_usd = resultMsg.total_cost_usd;
        // Convert SDK usage from snake_case (input_tokens) to camelCase (inputTokens)
        if (resultMsg.usage && typeof resultMsg.usage === 'object') {
          const raw: any = resultMsg.usage;
          statsData.usage = {
            inputTokens: raw.inputTokens ?? raw.input_tokens ?? 0,
            outputTokens: raw.outputTokens ?? raw.output_tokens ?? 0,
            cacheReadInputTokens: raw.cacheReadInputTokens ?? raw.cache_read_input_tokens,
            cacheCreationInputTokens: raw.cacheCreationInputTokens ?? raw.cache_creation_input_tokens,
          };
        }
        if (resultMsg.modelUsage && typeof resultMsg.modelUsage === 'object') statsData.modelUsage = resultMsg.modelUsage;
        if (typeof resultMsg.num_turns === 'number') statsData.num_turns = resultMsg.num_turns;

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
      const msgSessionId = (msg as any).session_id;
      if (msgSessionId && typeof msgSessionId === 'string') {
        newSessionId = msgSessionId;
      }
    }

    // If no content was published, send empty stream_end
    if (!hasPublishedContent && !abortSignal?.aborted) {
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
    } else if (hasPublishedContent && !abortSignal?.aborted) {
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

    console.log(`[SecretaryClaude] Completed | request=${requestId}${abortSignal?.aborted ? ' (aborted)' : ''}`);

    const _elapsed = Date.now() - _startTime;
    timelineLogger.logSDK('secretary', `AI request completed${abortSignal?.aborted ? ' (aborted)' : ''}`, 'info', undefined, {
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

/**
 * LAN Peer Chat — Claude Agent SDK Service
 *
 * Full Claude Agent SDK integration for LAN group chat, supporting:
 * - Streaming AI responses (token-by-token via SSE)
 * - Tool chain (Read, Write, Edit, Bash, Glob, Grep)
 * - Session-based context continuity (resume)
 * - Database message persistence
 *
 * Modeled after lib/services/cli/claude.ts but adapted for LAN chat context.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { lanPeerStream } from './lan-peer-stream';
import { createLanMessage } from './lan-message-service';
import { updateGroupSession, getGroup } from './chat-service';
import { buildSoulPromptBlock } from '@/lib/services/secretary-soul';
import { getClaudeCodeExecutablePath, getBuiltinNodeDir, USER_SKILLS_DIR_ABSOLUTE } from '@/lib/config/paths';
import { CLAUDE_DEFAULT_MODEL, normalizeClaudeModelId } from '@/lib/constants/claudeModels';

// ========== Constants ==========

export const AI_SENDER_ID = 'ai-assistant';
export const AI_SENDER_NAME = '群助理';

// ========== Tool Action Inference (adapted from project chat) ==========

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

const LAN_DEFAULT_SYSTEM_PROMPT = `你是一个局域网群聊中的 群助理。
你具备完整的工具能力，可以读写文件、执行命令、搜索代码等。
请根据对话上下文自然地参与讨论，回答问题，提供帮助。
当用户需要操作文件或执行代码时，使用你的工具来完成。
保持简洁友好，用中文回复。

重要安全限制：
- 你当前在群聊沙箱环境中，只能操作群组工作目录和群主授权的技能目录。
- 禁止访问或操作任何其他系统目录、用户目录或项目目录。
- 禁止使用 AskUserQuestion 或任何需要用户实时输入的交互式工具。
- 如果需要用户确认或选择，请直接在聊天消息中用文字提问，等待用户回复。
- 所有文件操作请使用相对路径（相对于当前工作目录）。`;

/**
 * Build the final system prompt for a LAN chat group.
 * Priority: group custom prompt > default, always appended with SOUL block.
 */
async function buildLanSystemPrompt(groupId: string): Promise<string> {
  const parts: string[] = [];

  // 1. Per-group custom prompt or default
  const group = await getGroup(groupId);
  const basePrompt = group?.systemPrompt?.trim() || LAN_DEFAULT_SYSTEM_PROMPT;
  parts.push(basePrompt);

  // 2. SOUL block from settings page (personality + user profile)
  try {
    const soulBlock = await buildSoulPromptBlock();
    if (soulBlock) parts.push(soulBlock);
  } catch (err) {
    console.warn('[LanClaude] Failed to load SOUL block:', err);
  }

  // 3. Inject SKILL.md content for each enabled skill
  // This is critical — without this, AI only knows skill names but not their actual content/methods
  const enabledSkills = group?.enabledSkills || [];
  if (enabledSkills.length > 0) {
    const skillsRoot = path.join(process.cwd(), 'skills');
    const userSkillsRoot = path.join(process.cwd(), 'data', 'user-skills');

    for (const skillName of enabledSkills) {
      // Priority: user-skills > builtin skills (same as skill-service)
      const userPath = path.join(userSkillsRoot, skillName, 'SKILL.md');
      const builtinPath = path.join(skillsRoot, skillName, 'SKILL.md');
      let skillContent: string | null = null;

      try {
        await fs.access(userPath);
        skillContent = await fs.readFile(userPath, 'utf-8');
        console.log(`[LanClaude] 📖 Loaded SKILL.md from user-skills: ${skillName}`);
      } catch {}

      if (!skillContent) {
        try {
          await fs.access(builtinPath);
          skillContent = await fs.readFile(builtinPath, 'utf-8');
          console.log(`[LanClaude] 📖 Loaded SKILL.md from skills: ${skillName}`);
        } catch {
          console.warn(`[LanClaude] ⚠️ SKILL.md not found for skill: ${skillName}`);
        }
      }

      if (skillContent) {
        // Strip frontmatter (---...--- block) for cleaner injection
        const contentWithoutFrontmatter = skillContent.replace(/^---\n[\s\S]*?---\n/, '').trim();
        parts.push(
          `\n\n========== ${skillName} 技能说明 ==========\n${contentWithoutFrontmatter}\n` +
          `==========================================\n`
        );
      }
    }

    // Add guidance to use the Skill tool (not just Bash)
    const skillNames = enabledSkills.join('、');
    const groupWorkspacePath = groupWorkspace(groupId);

    // Build skill paths for AI to use
    const skillPaths: string[] = [];
    for (const skillName of enabledSkills) {
      const userSkillPath = path.join(userSkillsRoot, skillName);
      const builtinSkillPath = path.join(skillsRoot, skillName);
      try {
        fsSync.accessSync(userSkillPath);
        skillPaths.push(`${skillName}: ${userSkillPath}`);
      } catch {
        try {
          fsSync.accessSync(builtinSkillPath);
          skillPaths.push(`${skillName}: ${builtinSkillPath}`);
        } catch {}
      }
    }

    parts.push(
      `## 技能使用规范\n` +
      `上方已加载以下技能的具体说明：${skillNames}。\n\n` +
      `**重要**：Skill 工具的返回值 {"success":true,"commandName":"xxx"} 只是确认技能存在，` +
      `**不是执行结果**。你必须使用 Bash 执行脚本才能真正完成任务。\n\n` +
      `**群组工作目录**：${groupWorkspacePath}\n` +
      `所有生成的文件必须输出到这个目录。\n\n` +
      `**技能路径**：\n${skillPaths.map(p => `- ${p}`).join('\n')}\n\n` +
      `使用方法：\n` +
      `1. 使用技能的完整路径执行脚本\n` +
      `2. 使用 --output-dir 参数指定输出到群组工作目录\n` +
      `3. 例如：python3 /技能路径/scripts/generate.py "内容" --output-dir ${groupWorkspacePath}\n\n` +
      `**关键规则**：\n` +
      `- Skill 工具只用于确认技能存在，不执行任何操作\n` +
      `- 必须使用 Bash 执行脚本，使用完整路径\n` +
      `- 所有输出文件必须保存到群组工作目录`
    );
  }

  return parts.join('\n\n');
}

const DATA_DIR = path.join(process.cwd(), 'data', 'lan-peer', 'groups');

function groupWorkspace(groupId: string): string {
  return path.join(DATA_DIR, groupId, 'workspace');
}

// ========== Config Loader (reuse from project chat) ==========

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
    console.error('[LanClaude] Failed to load config:', error);
  }
  return customModel;
}

// ========== Stream State ==========

interface AssistantStreamState {
  messageId: string;
  content: string;
  hasSentUpdate: boolean;
  finalized: boolean;
}

// ========== Main Executor ==========

export interface ExecuteLanClaudeParams {
  groupId: string;
  instruction: string;
  sessionId?: string;
  requestId: string;
  senderName: string;
  abortSignal?: AbortSignal;
}

/**
 * Execute Claude Agent SDK query for a LAN chat group.
 *
 * Streams responses via lanPeerStream SSE events.
 * Persists final messages to the database.
 * Updates group session ID for context continuity.
 */
export async function executeLanClaude(params: ExecuteLanClaudeParams): Promise<void> {
  const { groupId, instruction, sessionId, requestId, senderName, abortSignal } = params;

  console.log(`[LanClaude] Starting | group=${groupId} | session=${sessionId || 'new'} | request=${requestId}`);

  const configuredMaxTokens = Number(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS);
  const maxOutputTokens = Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
    ? configuredMaxTokens
    : 16000;

  // stderr buffer — declared outside try so catch can access it
  const stderrBuffer: string[] = [];

  try {
    // Load config and resolve model
    const customModel = await loadAndApplyClaudeConfig();
    const finalModel = customModel || normalizeClaudeModelId(null);
    console.log(`[LanClaude] Model: ${finalModel}`);

    // Ensure workspace directory exists
    const workspace = groupWorkspace(groupId);
    await fs.mkdir(workspace, { recursive: true });

    // Build env with builtin node
    const envWithBuiltinNode = { ...process.env };
    const builtinNodeDir = getBuiltinNodeDir();
    if (builtinNodeDir) {
      envWithBuiltinNode.PATH = `${builtinNodeDir}:${process.env.PATH || ''}`;
    }

    // ========== Skill Plugin Loading ==========
    const group = await getGroup(groupId);
    const enabledSkills = group?.enabledSkills || [];
    const skillsRoot = path.join(process.cwd(), 'skills');
    const userSkillsRoot = path.join(process.cwd(), 'data', 'user-skills');

    // Use the same plugin loading approach as project chat:
    // Pass USER_SKILLS_DIR_ABSOLUTE (parent dir containing .claude-plugin/plugin.json)
    // SDK will scan this directory and register Skill tool based on plugin.json
    const plugins: { type: 'local'; path: string }[] = [];
    if (enabledSkills.length > 0) {
      plugins.push({ type: 'local', path: USER_SKILLS_DIR_ABSOLUTE });
      console.log(`[LanClaude] 🧩 Loading skill plugins from: ${USER_SKILLS_DIR_ABSOLUTE}`);
      console.log(`[LanClaude] 🧩 Group enabled skills: ${enabledSkills.join(', ')}`);
    } else {
      console.log(`[LanClaude] ℹ️ No skill plugins to load (enabledSkills empty)`);
    }

    // Inject env vars from enabled skills
    for (const skillName of enabledSkills) {
      try {
        const { getSkillEnvVars } = await import('@/lib/services/skill-service');
        const skillEnv = await getSkillEnvVars(skillName);
        if (Object.keys(skillEnv).length > 0) {
          Object.assign(envWithBuiltinNode, skillEnv);
          console.log(`[LanClaude] 🔑 Injected env vars from skill "${skillName}":`, Object.keys(skillEnv));
        }
      } catch {}
    }

    // ========== Security Sandbox ==========
    // Allowed directories: group workspace + enabled skill folders ONLY
    const allowedPaths: string[] = [workspace];
    for (const skill of enabledSkills) {
      allowedPaths.push(path.join(skillsRoot, skill));
      allowedPaths.push(path.join(userSkillsRoot, skill));
    }
    // Also allow the entire user-skills directory for skill execution
    allowedPaths.push(USER_SKILLS_DIR_ABSOLUTE);
    // Also allow the group's own data directory (for group.json, memory, etc.)
    const groupDataDir = path.join(DATA_DIR, groupId);
    allowedPaths.push(groupDataDir);

    /** Check if a resolved absolute path falls within any allowed directory */
    function isPathAllowed(targetPath: string): boolean {
      const resolved = path.resolve(workspace, targetPath);
      return allowedPaths.some(allowed => resolved === allowed || resolved.startsWith(allowed + path.sep));
    }

    /** Extract all path-like arguments from tool input */
    function extractAllPaths(toolInput: Record<string, unknown>): string[] {
      const pathKeys = ['file_path', 'filePath', 'path', 'target', 'file', 'filename', 'directory', 'dir'];
      const paths: string[] = [];
      for (const key of pathKeys) {
        const val = toolInput[key];
        if (typeof val === 'string' && val.trim()) paths.push(val.trim());
      }
      return paths;
    }

    /** Check bash/shell commands for unsafe directory references */
    function isBashCommandSafe(command: string): { safe: boolean; reason?: string } {
      const resolvedAllowed = allowedPaths.map(p => path.resolve(p));

      function isAbsPathAllowed(absPath: string): boolean {
        const resolved = path.resolve(absPath);
        return resolvedAllowed.some(a => resolved === a || resolved.startsWith(a + path.sep));
      }

      // 1. Block ~ and $HOME references (expand to user home directory)
      if (/(?:^|\s|[;&|`"'(])~(?:\/|\s|$|[;&|`"')])/m.test(command) || /\$HOME/i.test(command)) {
        return { safe: false, reason: '禁止访问用户主目录 (~/$HOME)，只允许操作群组工作目录和授权技能目录' };
      }

      // 2. Remove URL patterns first to avoid false positives
      // Match http://, https://, file://, ftp:// etc. and remove them
      const commandWithoutUrls = command.replace(/(?:https?|file|ftp):\/\/[^\s'"]+/gi, '');

      // 3. Extract ALL absolute path references from the command (without URLs)
      // Match /path/to/something patterns (must start with / and have at least one char after)
      // Exclude: // (protocol), / at end of word (like w/ in URLs)
      const absPathRegex = /(?:^|[\s=:"'`(])(\/[\w.\-]+(?:\/[\w.\-]+)*)(?=[\s'"`)&|]|$)/gm;
      let match;
      while ((match = absPathRegex.exec(commandWithoutUrls)) !== null) {
        const foundPath = match[1];
        // Skip URL-like patterns (double slash like //example.com)
        if (/^\/\/[^\/]/.test(foundPath)) continue;
        // Skip common safe command paths like /usr/bin, /bin, etc.
        if (/^\/(?:usr\/(?:bin|local\/bin)|bin|dev\/null|tmp)(?:\/|$)/.test(foundPath)) continue;
        if (!isAbsPathAllowed(foundPath)) {
          return { safe: false, reason: `禁止访问目录: ${foundPath}，只允许操作群组工作目录和授权的技能目录` };
        }
      }

      // 4. Block environment variable paths that could escape sandbox
      if (/\$\{?(?:PATH|TMPDIR|SHELL)\}?/.test(command)) {
        // Allow PATH references in non-destructive contexts
      }

      return { safe: true };
    }

    // canUseTool — enforce security sandbox for group chat
    const DENIED_TOOLS = new Set([
      'AskUserQuestion', 'ask_user_question', 'askUserQuestion',
      'AskFollowupQuestion', 'ask_followup_question',
    ]);
    // Tools that operate on file paths
    const FILE_TOOLS = new Set([
      'Read', 'read', 'read_file', 'read-file',
      'Write', 'write', 'write_file', 'write-file', 'create_file',
      'Edit', 'edit', 'edit_file', 'edit-file', 'update_file', 'apply_patch', 'patch_file',
      'remove_file', 'delete_file', 'delete', 'remove',
      'list_files', 'list', 'ls',
      'Glob', 'glob', 'glob_files', 'search_files',
      'Grep', 'grep',
    ]);
    // Tools that execute commands
    const EXEC_TOOLS = new Set([
      'Bash', 'bash', 'run', 'run_bash', 'shell',
    ]);

    const canUseTool = async (toolName: string, toolInput: Record<string, unknown>) => {
      // Log Skill tool calls for debugging
      if (toolName === 'Skill') {
        const skillInput = (toolInput as any) || {};
        console.log(`[LanClaude] 🔧 Skill tool called: ${JSON.stringify({ skillName: skillInput.skill, args: skillInput.args, toolUseID: 'pending' })}`);
      }

      // 1. Block interactive tools
      if (DENIED_TOOLS.has(toolName)) {
        return {
          behavior: 'deny' as const,
          message: '群聊环境不支持交互式工具，请直接在消息中提问',
        };
      }

      // 2. File tools — validate all paths are within allowed directories
      if (FILE_TOOLS.has(toolName)) {
        const paths = extractAllPaths(toolInput);
        for (const p of paths) {
          if (!isPathAllowed(p)) {
            const msg = `安全限制：禁止访问 ${p}。群聊 AI 只能操作群组工作目录和授权的技能目录。`;
            console.warn(`[LanClaude] ⛔ Path denied: ${p} (tool: ${toolName})`);
            return { behavior: 'deny' as const, message: msg };
          }
        }
      }

      // 3. Execution tools — validate command doesn't escape sandbox
      if (EXEC_TOOLS.has(toolName)) {
        const command = (toolInput.command || toolInput.input || '') as string;
        const check = isBashCommandSafe(command);
        if (!check.safe) {
          console.warn(`[LanClaude] ⛔ Command denied: ${command.slice(0, 100)} (reason: ${check.reason})`);
          return { behavior: 'deny' as const, message: check.reason || '命令被安全策略拒绝' };
        }
      }

      return { behavior: 'allow' as const, updatedInput: toolInput };
    };

    // PostToolUse hook — capture tool execution results and publish to frontend
    // Also publishes ai_tool_use event so the UI shows the tool call card
    const postToolUseHook = async (input: any, toolUseID: string) => {
      try {
        if (input.hook_event_name !== 'PostToolUse') return {};
        const toolName = input.tool_name || 'unknown';
        const toolInput = input.tool_input || {};
        const toolResponse = input.tool_response || '';

        console.log(`[LanClaude] ✅ PostToolUse: ${toolName} | id=${toolUseID} | input=${JSON.stringify(toolInput).slice(0, 200)} | response=${typeof toolResponse === 'string' ? toolResponse.slice(0, 500) : JSON.stringify(toolResponse).slice(0, 500)}`);

        // Publish ai_tool_use event so UI shows the tool call card
        lanPeerStream.publish({
          type: 'ai_tool_use',
          data: {
            groupId, requestId, toolName,
            toolInput,
            action: inferActionFromToolName(toolName),
            filePath: extractPathFromInput(toolInput),
            messageId: randomUUID(),
            timestamp: new Date().toISOString(),
          },
        });

        const action = inferActionFromToolName(toolName);
        const filePath = extractPathFromInput(toolInput);
        const maxLen = 2000;
        const truncatedResponse = typeof toolResponse === 'string' && toolResponse.length > maxLen
          ? toolResponse.slice(0, maxLen) + '\n...(truncated)'
          : (typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse).slice(0, maxLen));

        const metadata: Record<string, unknown> = {
          toolName, toolInput, toolResponse: truncatedResponse,
          toolUseId: toolUseID, action, filePath,
        };

        // Publish ai_tool_result SSE event
        lanPeerStream.publish({
          type: 'ai_tool_result',
          data: {
            groupId, requestId, toolName, action, filePath,
            toolResponse: truncatedResponse,
            messageId: randomUUID(),
            timestamp: new Date().toISOString(),
          },
        });

        // Persist to DB
        await createLanMessage({
          groupId,
          role: 'tool',
          messageType: 'tool_result',
          content: `Tool result: ${toolName}`,
          senderId: AI_SENDER_ID,
          senderName: AI_SENDER_NAME,
          interactionMode: 'ai_chat',
          metadata,
          requestId,
        });

        return {};
      } catch (error) {
        console.warn(`[LanClaude] Error in PostToolUse hook:`, error);
        return {};
      }
    };

    // PostToolUseFailure hook — capture tool execution failures
    const postToolUseFailureHook = async (input: any, toolUseID: string) => {
      try {
        if (input.hook_event_name !== 'PostToolUseFailure') return {};
        const toolName = input.tool_name || 'unknown';
        const toolInput = input.tool_input || {};
        const error = input.error || 'Unknown error';

        console.log(`[LanClaude] ❌ PostToolUseFailure: ${toolName} | id=${toolUseID}`);

        const action = inferActionFromToolName(toolName);
        const filePath = extractPathFromInput(toolInput);
        const metadata: Record<string, unknown> = {
          toolName, toolInput,
          toolError: typeof error === 'string' ? error : JSON.stringify(error),
          toolUseId: toolUseID, action, filePath, isError: true,
        };

        lanPeerStream.publish({
          type: 'ai_tool_result',
          data: {
            groupId, requestId, toolName, action, filePath,
            toolError: metadata.toolError,
            isError: true,
            messageId: randomUUID(),
            timestamp: new Date().toISOString(),
          },
        });

        await createLanMessage({
          groupId,
          role: 'tool',
          messageType: 'tool_result',
          content: `Tool failed: ${toolName}`,
          senderId: AI_SENDER_ID,
          senderName: AI_SENDER_NAME,
          interactionMode: 'ai_chat',
          metadata,
          requestId,
        });

        return {};
      } catch (err) {
        console.warn(`[LanClaude] Error in PostToolUseFailure hook:`, err);
        return {};
      }
    };

    // PreToolUse hook — enforce security sandbox BEFORE tool execution
    // This hook runs regardless of permissionMode, unlike canUseTool which is
    // skipped when permissionMode is 'bypassPermissions'.
    const preToolUseHook = async (input: any, toolUseID: string | undefined) => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const toolName = input.tool_name || '';
      console.log(`[LanClaude] 🔧 PreToolUse hook: ${toolName} | id=${toolUseID}`);
      if (toolName === 'Skill') {
        console.log(`[LanClaude] 🔧 Skill tool PreToolUse: input=${JSON.stringify(input.tool_input || {}).slice(0, 500)}`);
      }
      const toolInput = (input.tool_input || {}) as Record<string, unknown>;

      // 1. Block interactive tools
      if (DENIED_TOOLS.has(toolName)) {
        console.warn(`[LanClaude] ⛔ PreToolUse blocked interactive tool: ${toolName}`);
        return {
          decision: 'block' as const,
          reason: '群聊环境不支持交互式工具，请直接在消息中提问',
        };
      }

      // 2. File tools — validate all paths are within allowed directories
      if (FILE_TOOLS.has(toolName)) {
        const paths = extractAllPaths(toolInput);
        for (const p of paths) {
          if (!isPathAllowed(p)) {
            console.warn(`[LanClaude] ⛔ PreToolUse path denied: ${p} (tool: ${toolName})`);
            return {
              decision: 'block' as const,
              reason: `安全限制：禁止访问 ${p}。群聊 AI 只能操作群组工作目录和授权的技能目录。`,
            };
          }
        }
      }

      // 3. Execution tools — validate command doesn't escape sandbox
      if (EXEC_TOOLS.has(toolName)) {
        const command = (toolInput.command || toolInput.input || '') as string;
        const check = isBashCommandSafe(command);
        if (!check.safe) {
          console.warn(`[LanClaude] ⛔ PreToolUse command denied: ${command.slice(0, 100)} (reason: ${check.reason})`);
          return {
            decision: 'block' as const,
            reason: check.reason || '命令被安全策略拒绝',
          };
        }
      }

      return {}; // Allow tool execution
    };

    // Build hooks config
    const hooks = {
      PreToolUse: [{ hooks: [preToolUseHook] }],
      PostToolUse: [{ hooks: [postToolUseHook] }],
      PostToolUseFailure: [{ hooks: [postToolUseFailureHook] }],
    };

    // Call Claude Agent SDK
    // Use 'default' permissionMode so the SDK properly registers all tools including Skill.
    // canUseTool callback auto-approves all non-blocked tools (returns 'allow').
    // This ensures Skill tool is available when plugins are loaded.
    // IMPORTANT: Use workspace as cwd so generated files go to the right place.
    // Skill paths are provided in system prompt with full paths.
    const hasPlugins = plugins.length > 0;
    console.log(`[LanClaude] 🚀 SDK query() options: { cwd: ${workspace}, plugins: ${hasPlugins ? plugins.length : 'none'}, allowedTools: ${hasPlugins ? 'yes' : 'none'}, settingSources: ${hasPlugins ? 'project' : 'none'}, model: ${finalModel} }`);
    const response = query({
      prompt: instruction,
      options: {
        cwd: workspace, // Use workspace so files are generated in the right place
        additionalDirectories: allowedPaths, // Include skill directories for access
        model: finalModel,
        resume: sessionId,
        permissionMode: 'default',
        systemPrompt: await buildLanSystemPrompt(groupId),
        maxOutputTokens,
        pathToClaudeCodeExecutable: getClaudeCodeExecutablePath(),
        env: envWithBuiltinNode,
        plugins: hasPlugins ? plugins : undefined,
        allowedTools: hasPlugins ? ['Skill', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'] : undefined,
        settingSources: hasPlugins ? ['project'] : undefined,
        canUseTool,
        hooks,
        stderr: (data: string) => {
          const line = String(data).trimEnd();
          if (!line) return;
          if (stderrBuffer.length > 100) stderrBuffer.shift();
          stderrBuffer.push(line);
          console.error(`[LanClaude][stderr] ${line}`);
        },
      } as any,
    });

    // Track assistant stream states (keyed by session key)
    const assistantStreamStates = new Map<string, AssistantStreamState>();
    const completedStreamSessions = new Set<string>();
    let hasPublishedContent = false;

    // Iterate streaming response
    for await (const message of response) {
      // Check abort signal at the start of each iteration
      if (abortSignal?.aborted) {
        console.log(`[LanClaude] Aborted by user | group=${groupId} | request=${requestId}`);
        // Try to close the async iterator gracefully
        try { (response as any).return?.(); } catch {}
        break;
      }

      console.log(`[LanClaude] SDK message: type=${message.type}`);

      // ─── stream_event: real-time streaming chunks ───
      if (message.type === 'stream_event') {
        const event: any = (message as any).event ?? {};
        const sessionKey = ((message as any).session_id ?? (message as any).uuid ?? 'default').toString();

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
            break;
          }

          case 'content_block_start': {
            const contentBlock = event.content_block;
            if (contentBlock && typeof contentBlock === 'object' && contentBlock.type === 'tool_use') {
              const toolName = contentBlock.name || 'unknown';
              const toolInput = contentBlock.input || {};

              const action = inferActionFromToolName(toolName);
              const filePath = extractPathFromInput(typeof toolInput === 'object' ? toolInput as Record<string, unknown> : {});

              lanPeerStream.publish({
                type: 'ai_tool_use',
                data: {
                  groupId,
                  requestId,
                  toolName,
                  action,
                  filePath,
                  toolInput: typeof toolInput === 'object' ? toolInput : {},
                  messageId: streamState?.messageId || randomUUID(),
                  timestamp: new Date().toISOString(),
                },
              });

              await createLanMessage({
                groupId,
                role: 'tool',
                messageType: 'tool_use',
                content: `Using tool: ${toolName}`,
                senderId: AI_SENDER_ID,
                senderName: AI_SENDER_NAME,
                interactionMode: 'ai_chat',
                metadata: { toolName, toolInput, action, filePath },
                requestId,
              });
            }
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

            // Auto-create streamState if missing (same as project chat)
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

            lanPeerStream.publish({
              type: 'ai_stream_delta',
              data: {
                groupId,
                requestId,
                messageId: streamState.messageId,
                content: streamState.content,
                delta: textChunk,
                timestamp: new Date().toISOString(),
              },
            });
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

              await createLanMessage({
                id: streamState.messageId,
                groupId,
                role: 'assistant',
                messageType: 'text',
                content: trimmedContent,
                senderId: AI_SENDER_ID,
                senderName: AI_SENDER_NAME,
                interactionMode: 'ai_chat',
                requestId,
              });

              lanPeerStream.publish({
                type: 'ai_stream_end',
                data: {
                  groupId,
                  requestId,
                  messageId: streamState.messageId,
                  content: trimmedContent,
                  timestamp: new Date().toISOString(),
                },
              });
            }

            assistantStreamStates.delete(sessionKey);
            break;
          }
        }

        continue;
      }

      // ─── system init: capture session ID ───
      if (message.type === 'system' && (message as any).subtype === 'init') {
        const initSessionId = (message as any).session_id;
        if (initSessionId && typeof initSessionId === 'string') {
          console.log(`[LanClaude] Session initialized: ${initSessionId}`);
          await updateGroupSession(groupId, initSessionId).catch((err) => {
            console.error('[LanClaude] Failed to update session:', err);
          });
        }
        continue;
      }

      // ─── assistant: fallback for non-streaming responses ───
      if (message.type === 'assistant') {
        const sessionKey = ((message as any).session_id ?? (message as any).uuid ?? 'default').toString();

        // Skip if already handled by stream_event
        if (completedStreamSessions.has(sessionKey)) {
          completedStreamSessions.delete(sessionKey);
          continue;
        }

        const assistantMessage = (message as any).message;
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
          const msgId = randomUUID();

          await createLanMessage({
            id: msgId,
            groupId,
            role: 'assistant',
            messageType: 'text',
            content: content.trim(),
            senderId: AI_SENDER_ID,
            senderName: AI_SENDER_NAME,
            interactionMode: 'ai_chat',
            requestId,
          });

          lanPeerStream.publish({
            type: 'ai_stream_end',
            data: {
              groupId,
              requestId,
              messageId: msgId,
              content: content.trim(),
              timestamp: new Date().toISOString(),
            },
          });
        }
        continue;
      }

      // ─── result: completion message ───
      if (message.type === 'result') {
        console.log(`[LanClaude] Task result: ${(message as any).subtype || 'unknown'}`);
        continue;
      }

      // Capture session ID for context continuity (generic fallback)
      const msgSessionId = (message as any).session_id;
      if (msgSessionId && typeof msgSessionId === 'string') {
        await updateGroupSession(groupId, msgSessionId).catch((err) => {
          console.error('[LanClaude] Failed to update session:', err);
        });
      }
    }

    // If no content was published via streaming, send a stream_end to clear the spinner
    if (!hasPublishedContent && !abortSignal?.aborted) {
      console.warn(`[LanClaude] No content published, sending empty stream_end`);
      lanPeerStream.publish({
        type: 'ai_stream_end',
        data: {
          groupId,
          requestId,
          error: 'AI 未产生任何回复内容',
          timestamp: new Date().toISOString(),
        },
      });
    }

    console.log(`[LanClaude] Completed | group=${groupId} | request=${requestId}${abortSignal?.aborted ? ' (aborted)' : ''}`);
  } catch (error) {
    // If aborted, don't treat as error
    if (abortSignal?.aborted) {
      console.log(`[LanClaude] Aborted by user (catch) | group=${groupId} | request=${requestId}`);
      return;
    }
    console.error(`[LanClaude] Error:`, error);
  
    // Surface stderr for debugging
    if (stderrBuffer.length > 0) {
      console.error(`[LanClaude] Last stderr lines:\n${stderrBuffer.slice(-10).join('\n')}`);
    }
  
    // Check if session is invalid — auto-retry WITHOUT session (start fresh)
    const errMsg = (error as Error).message || '';
    const isSessionError = /No conversation found|session.*not found/i.test(errMsg) || stderrBuffer.some((l: string) => /No conversation found|session.*not found/i.test(l));
    if (isSessionError && sessionId) {
      console.log(`[LanClaude] Session expired, clearing and auto-retrying without session | group=${groupId}`);
      try {
        await updateGroupSession(groupId, '');
      } catch {}
      // Retry with fresh session — recursive call without sessionId
      try {
        await executeLanClaude({ ...params, sessionId: undefined });
        return; // Retry succeeded, done
      } catch (retryErr) {
        console.error(`[LanClaude] Retry also failed:`, retryErr);
        // Fall through to error reporting below
      }
    }
  
    // Build user-friendly error message
    let errorContent = 'AI \u56DE\u590D\u5931\u8D25';
    if (/not authenticated|auth/i.test(errMsg) || stderrBuffer.some((l: string) => /auth\s+login|not\s+logged/i.test(l))) {
      errorContent = 'AI \u56DE\u590D\u5931\u8D25: Claude CLI \u672A\u8BA4\u8BC1\uFF0C\u8BF7\u8FD0\u884C claude auth login';
    } else if (/command not found/i.test(errMsg)) {
      errorContent = 'AI \u56DE\u590D\u5931\u8D25: Claude CLI \u672A\u5B89\u88C5\uFF0C\u8BF7\u8FD0\u884C npm install -g @anthropic-ai/claude-code';
    } else {
      const tail = stderrBuffer.slice(-5).join(' ');
      errorContent = `AI \u56DE\u590D\u5931\u8D25: ${errMsg || tail || '\u672A\u77E5\u9519\u8BEF'}`;
    }

    await createLanMessage({
      groupId,
      role: 'assistant',
      messageType: 'system',
      content: errorContent,
      senderId: AI_SENDER_ID,
      senderName: AI_SENDER_NAME,
      interactionMode: 'ai_chat',
      requestId,
    });

    lanPeerStream.publish({
      type: 'ai_stream_end',
      data: {
        groupId,
        requestId,
        content: errorContent,
        error: errorContent,
        timestamp: new Date().toISOString(),
      },
    });
  }
}

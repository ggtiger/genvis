/**
 * Shared SDK Tool Helpers
 *
 * Common utilities for inferring tool actions and extracting paths from
 * Claude Agent SDK tool inputs. Used by:
 * - lib/services/secretary/secretary-claude.ts
 * - lib/services/lan-peer/lan-claude.ts
 */

export type ToolAction = 'Read' | 'Created' | 'Edited' | 'Deleted' | 'Searched' | 'Executed' | 'Generated';

export const TOOL_NAME_ACTION_MAP: Record<string, ToolAction> = {
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

/**
 * Infer a human-readable action label from an SDK tool name.
 * Checks exact match, lowercase, namespace suffix, then regex heuristics.
 */
export function inferActionFromToolName(toolName: string): ToolAction {
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

/**
 * Extract the most likely file/command path from a tool's input object.
 * Checks common key names in priority order.
 */
export function extractPathFromInput(toolInput: Record<string, unknown>): string | undefined {
  const keys = ['file_path', 'filePath', 'path', 'target', 'file', 'filename', 'directory', 'dir', 'pattern', 'command'];
  for (const key of keys) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return undefined;
}
/**
 * Rule Promoter
 *
 * Promotes high-frequency dispatch correction cases into permanent
 * dispatch rules in the secretary's system_prompt (builtin-employees.json).
 * Fire-and-forget, never-throw pattern.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import path from 'path';
import { spawn } from 'child_process';
import { detectPython } from '@/lib/utils/python';
import type { DispatchLearningValue } from './correction-recorder';
import {
  loadMemory,
  saveMemory,
  upsertEntry,
  type MemoryDataV2,
} from './secretary-memory';

// ========== Constants ==========

const DEFAULT_PROMOTION_THRESHOLD = 3;
const SECRETARY_ID = 'builtin-secretary';
const RULE_SECTION_HEADER = '## 自动学习的调度规则';

// ========== Public API ==========

/**
 * 从纠正案例生成自然语言调度规则。
 *
 * Format: "当用户请求涉及[场景描述]时，应使用[正确动作类型]调度给[正确目标]而非使用[错误动作类型]给[错误目标]"
 */
export function generateRule(learning: DispatchLearningValue): string {
  return `当用户请求涉及${learning.input}时，应使用 ${learning.correctActionType} 调度给 ${learning.correctAction} 而非使用 ${learning.wrongActionType} 给 ${learning.wrongAction}`;
}

/**
 * 使用 Python 子进程将规则追加到 builtin-employees.json 的秘书 system_prompt 中。
 *
 * The Python script:
 * 1. Reads builtin-employees.json
 * 2. Finds the secretary employee (id = "builtin-secretary")
 * 3. Checks if "## 自动学习的调度规则" section already exists
 *    - If yes: appends the new rule to that section
 *    - If no: adds the section header + rule
 * 4. Writes back the JSON file with ensure_ascii=False
 *
 * Uses Python for JSON editing to avoid escaping issues (Requirement 5.6).
 * Uses detectPython() from lib/utils/python.ts to find the Python binary.
 */
export async function appendRuleToSystemPrompt(rule: string): Promise<void> {
  const pythonBin = await detectPython();
  if (!pythonBin) {
    throw new Error('Python not found, cannot edit builtin-employees.json');
  }

  const jsonFilePath = path.join(process.cwd(), 'builtin-employees.json');

  // Python script reads rule and json path from stdin as JSON
  const pythonScript = `
import json, sys

input_data = json.loads(sys.stdin.read())
rule = input_data['rule']
json_path = input_data['json_path']
section_header = ${JSON.stringify(RULE_SECTION_HEADER)}
secretary_id = ${JSON.stringify(SECRETARY_ID)}

with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

employees = data.get('employees', data if isinstance(data, list) else [])
for emp in employees:
    if emp.get('id') == secretary_id:
        prompt = emp.get('system_prompt', '')
        if section_header in prompt:
            emp['system_prompt'] = prompt + '\\n' + rule
        else:
            emp['system_prompt'] = prompt + '\\n\\n' + section_header + '\\n' + rule
        break

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=4)
`;

  return new Promise<void>((resolve, reject) => {
    const child = spawn(pythonBin, ['-c', pythonScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });

    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Python script failed (code ${code}): ${stderr}`));
      }
    });

    // Pass data via stdin to avoid shell escaping issues
    child.stdin?.write(JSON.stringify({ rule, json_path: jsonFilePath }));
    child.stdin?.end();
  });
}

/**
 * 检查 dispatch_learnings 中是否有达到提升阈值的案例，
 * 如有则生成规则并写入 builtin-employees.json。
 * Fire-and-forget，never-throw。
 */
export async function checkAndPromoteRules(
  threshold: number = DEFAULT_PROMOTION_THRESHOLD,
): Promise<void> {
  try {
    let memory = await loadMemory();
    const entries = memory.dispatch_learnings;
    let changed = false;

    for (const entry of entries) {
      const count = entry.count || 0;
      if (count < threshold) continue;

      let value: DispatchLearningValue;
      try {
        value = JSON.parse(entry.value) as DispatchLearningValue;
      } catch {
        continue; // skip entries with invalid JSON
      }

      if (value.promotedToRule === true) continue;

      // Generate and append rule
      const rule = generateRule(value);
      await appendRuleToSystemPrompt(rule);

      // Mark as promoted
      value.promotedToRule = true;
      const now = new Date().toISOString();

      memory = upsertEntry(memory, 'dispatch_learnings', {
        key: entry.key,
        value: JSON.stringify(value),
        source: entry.source,
        count: entry.count,
        confidence: 1.0,
        lastAccessedAt: now,
        accessCount: entry.accessCount || 0,
        channel: entry.channel || 'web',
      }) as MemoryDataV2;

      changed = true;
    }

    if (changed) {
      await saveMemory(memory);
    }
  } catch (err) {
    console.warn('[RulePromoter] 规则提升失败:', err);
  }
}

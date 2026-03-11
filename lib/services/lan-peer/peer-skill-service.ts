/**
 * LAN Peer Chat — Peer Skill Service
 *
 * Manages exposed skills and remote skill invocation.
 *
 * Requirements: 5.1, 5.2, 5.4, 5.5
 */

import type { SkillCallResult, LanPeerSettings } from './types';
import { DEFAULT_LAN_PEER_SETTINGS } from './types';

const SKILL_CALL_TIMEOUT = 30_000; // 30s

/**
 * Get the list of skills this node exposes to peers.
 */
export async function getExposedSkills(): Promise<string[]> {
  const { loadGlobalSettings } = await import('@/lib/services/settings');
  const settings = await loadGlobalSettings();
  return settings.lan_peer?.exposedSkills ?? DEFAULT_LAN_PEER_SETTINGS.exposedSkills;
}

/**
 * Update the list of exposed skills.
 */
export async function setExposedSkills(skillNames: string[]): Promise<void> {
  const { loadGlobalSettings, updateGlobalSettings } = await import('@/lib/services/settings');
  const settings = await loadGlobalSettings();
  const current: LanPeerSettings = { ...DEFAULT_LAN_PEER_SETTINGS, ...settings.lan_peer };
  current.exposedSkills = skillNames;
  await updateGlobalSettings({ lan_peer: current });
}

/**
 * Handle an incoming skill request from a remote peer.
 * Executes the skill locally and returns the result.
 */
export async function handleSkillRequest(
  skillName: string,
  method: string,
  apiPath: string,
  body?: any,
  queryParams?: Record<string, string>,
): Promise<SkillCallResult> {
  const start = Date.now();
  try {
    // Check if skill is in exposed list
    const exposed = await getExposedSkills();
    if (!exposed.includes(skillName)) {
      return { success: false, error: `技能 ${skillName} 未对外暴露`, executionTime: Date.now() - start };
    }

    const { callSkillApi } = await import('@/lib/services/secretary-skill-caller');
    const result = await callSkillApi(skillName, method as 'GET' | 'POST' | 'PUT' | 'DELETE', apiPath, body, queryParams);

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      executionTime: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      executionTime: Date.now() - start,
    };
  }
}

/**
 * Call a skill on a remote peer via WebSocket SKILL_REQUEST/SKILL_RESPONSE.
 * This is a helper that sends the request and waits for the response with timeout.
 */
export function createSkillCallPromise(): {
  promise: Promise<SkillCallResult>;
  resolve: (result: SkillCallResult) => void;
  reject: (err: Error) => void;
} {
  let resolve!: (result: SkillCallResult) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<SkillCallResult>((res, rej) => {
    resolve = res;
    reject = rej;
    setTimeout(() => rej(new Error('远程技能调用超时 (30s)')), SKILL_CALL_TIMEOUT);
  });
  return { promise, resolve, reject };
}

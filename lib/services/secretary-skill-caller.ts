/**
 * Secretary Skill Caller Service
 *
 * Resolves a skill's running port from the projects table and invokes
 * its REST API on behalf of the secretary employee.
 *
 * Port resolution: Query the projects table for `skill-{skillName}` project's
 * `previewPort`, then construct `http://localhost:{port}{path}` for the HTTP call.
 *
 * Validates: Requirements 4.1, 4.2, 4.5
 */

import { db } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// ========== Interfaces ==========

export interface SkillCallResult {
  success: boolean;
  data?: any;
  error?: string;
  code?: 'SKILL_NOT_RUNNING' | 'SKILL_TIMEOUT' | 'SKILL_CONNECTION_REFUSED' | 'SKILL_API_ERROR';
}

// ========== Startup Lock ==========

/**
 * Per-skill startup lock to prevent concurrent auto-start attempts.
 * When multiple callers try to start the same skill simultaneously,
 * only the first one actually triggers the start; others await the same promise.
 */
const startupLocks = new Map<string, Promise<number | null>>();

// ========== Internal Helpers ==========

/**
 * Resolve the running port for a skill by querying the projects table.
 * Skills are stored as projects with id `skill-{skillName}`.
 *
 * @returns The preview port number, or null if the skill project is not found
 *          or does not have a running preview.
 */
export async function resolveSkillPort(skillName: string): Promise<number | null> {
  const projectId = `skill-${skillName}`;

  // 1. Check DeployManager first (deployed skills take priority)
  try {
    const { deployManager } = await import('@/lib/services/deploy-manager');
    const deployInfo = deployManager.getStatus(skillName);
    if (deployInfo.status === 'deployed' && deployInfo.port) {
      console.log(`[SkillCaller] Skill ${skillName} is deployed on port ${deployInfo.port}`);
      return deployInfo.port;
    }
  } catch {
    // DeployManager not available, continue
  }

  // 2. 查 DB
  const result = await db
    .select({ previewPort: projects.previewPort })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (result[0]?.previewPort) {
    return result[0].previewPort;
  }

  // 3. DB 里没有 port，尝试从 PreviewManager 内存中获取
  try {
    const { previewManager } = await import('@/lib/services/preview');
    const status = previewManager.getStatus(projectId);
    if (status && status.port && status.status !== 'stopped') {
      console.log(`[SkillCaller] DB has no port for ${skillName}, but PreviewManager reports port ${status.port}`);
      return status.port;
    }
  } catch {
    // PreviewManager not available, ignore
  }

  return null;
}

/**
 * Wait for a skill's HTTP server to be ready by polling its health endpoint.
 * Falls back to a simple TCP connect check if no /health endpoint exists.
 */
async function waitForSkillReady(port: number, maxWaitMs: number = 60000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 1000;
  const probeTimeout = 2000;

  console.log(`[SkillCaller] Waiting for skill on port ${port} to be ready (max ${maxWaitMs}ms)...`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), probeTimeout);
      try {
        const response = await fetch(`http://localhost:${port}/health`, {
          signal: controller.signal,
        });
        // Any HTTP response (including 404) means the server is up
        console.log(`[SkillCaller] Skill ready on port ${port} (health probe status ${response.status})`);
        return true;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      // /health fetch failed (connection refused, timeout, etc.) — try root path
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), probeTimeout);
        try {
          const response = await fetch(`http://localhost:${port}/`, {
            signal: controller.signal,
          });
          console.log(`[SkillCaller] Skill ready on port ${port} (root path status ${response.status})`);
          return true;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch {
        // Server not ready yet
        const elapsed = Date.now() - startTime;
        if (elapsed % 5000 < pollInterval) {
          console.log(`[SkillCaller] Still waiting for skill on port ${port}... (${Math.floor(elapsed / 1000)}s elapsed)`);
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.warn(`[SkillCaller] Skill on port ${port} not ready after ${maxWaitMs}ms timeout`);
  return false;
}

/**
 * Try to auto-start a skill's preview if it's not running.
 * Returns the port if successfully started, null otherwise.
 * Waits for the skill's HTTP server to be ready before returning.
 *
 * Uses a per-skill lock to prevent concurrent start attempts —
 * if multiple callers try to start the same skill simultaneously,
 * only the first one triggers the actual start; others await the same result.
 */
export async function tryAutoStartSkill(skillName: string): Promise<number | null> {
  // Check if there's already a startup in progress for this skill
  const existingLock = startupLocks.get(skillName);
  if (existingLock) {
    console.log(`[SkillCaller] Skill "${skillName}" startup already in progress, waiting...`);
    return existingLock;
  }

  // Create the startup promise and store it as a lock
  const startupPromise = (async (): Promise<number | null> => {
    const projectId = `skill-${skillName}`;

    try {
      // Check if skill is deployed — if so, start via DeployManager
      const { deployManager } = await import('@/lib/services/deploy-manager');
      const deployInfo = deployManager.getStatus(skillName);
      if (deployInfo.status === 'deployed' && deployInfo.port) {
        // Already running
        console.log(`[SkillCaller] Skill ${skillName} already deployed on port ${deployInfo.port}`);
        return deployInfo.port;
      }
      if (deployInfo.status === 'stopped' || deployInfo.status === 'build_failed') {
        // Was deployed before, start without rebuild
        console.log(`[SkillCaller] Auto-starting deployed skill ${skillName} via DeployManager...`);
        const info = await deployManager.start(skillName);
        if (info && info.port) {
          console.log(`[SkillCaller] Deployed skill ${skillName} started on port ${info.port}, waiting for readiness...`);
          const ready = await waitForSkillReady(info.port);
          if (ready) {
            console.log(`[SkillCaller] Deployed skill ${skillName} is ready on port ${info.port}`);
            return info.port;
          }
          return info.port;
        }
        return null;
      }
    } catch (deployError) {
      console.warn(`[SkillCaller] DeployManager check failed for ${skillName}:`, deployError);
    }

    try {
      // Not deployed — fall back to PreviewManager
      const { previewManager } = await import('@/lib/services/preview');
      console.log(`[SkillCaller] Auto-starting skill preview for ${projectId}...`);
      const info = await previewManager.start(projectId);

      if (info && info.port) {
        console.log(`[SkillCaller] Skill ${skillName} started on port ${info.port}, waiting for readiness...`);
        const ready = await waitForSkillReady(info.port);
        if (ready) {
          console.log(`[SkillCaller] Skill ${skillName} is ready on port ${info.port}`);
          return info.port;
        } else {
          console.warn(`[SkillCaller] Skill ${skillName} started but not ready within timeout`);
          return info.port;
        }
      }
    } catch (error) {
      console.error(`[SkillCaller] Failed to auto-start skill ${skillName}:`, error);
    }

    return null;
  })();

  startupLocks.set(skillName, startupPromise);

  try {
    return await startupPromise;
  } finally {
    startupLocks.delete(skillName);
  }
}

/**
 * Build the full URL for a skill API call, including optional query parameters.
 */
function buildSkillUrl(
  port: number,
  path: string,
  queryParams?: Record<string, string>
): string {
  const base = `http://localhost:${port}${path}`;

  if (!queryParams || Object.keys(queryParams).length === 0) {
    return base;
  }

  const searchParams = new URLSearchParams(queryParams);
  return `${base}?${searchParams.toString()}`;
}

// ========== Public API ==========

/**
 * Per-skill ensure-running lock to prevent concurrent ensure attempts.
 * When React Strict Mode (or other sources) trigger multiple dashboard
 * requests simultaneously, only the first one does the actual resolve + start;
 * subsequent callers await the same promise.
 */
const ensureLocks = new Map<string, Promise<number | null>>();

/**
 * Ensure a skill is running before making multiple API calls.
 * Resolves the port or auto-starts the skill once, so callers can
 * then use `callSkillApi` with `skipAutoStart: true` to avoid
 * redundant startup attempts.
 *
 * Uses a per-skill lock so concurrent callers share the same result.
 *
 * @returns The port number if the skill is running, null otherwise.
 */
export async function ensureSkillRunning(skillName: string): Promise<number | null> {
  const existing = ensureLocks.get(skillName);
  if (existing) {
    console.log(`[SkillCaller] ensureSkillRunning("${skillName}") already in progress, waiting...`);
    return existing;
  }

  // IMPORTANT: Set lock SYNCHRONOUSLY before any async operation
  // to prevent race condition when multiple requests come in simultaneously
  let resolvePromise: (value: number | null) => void;
  const promise = new Promise<number | null>((resolve) => {
    resolvePromise = resolve;
  });
  ensureLocks.set(skillName, promise);

  try {
    let port = await resolveSkillPort(skillName);
    if (port === null) {
      console.log(`[SkillCaller] Skill "${skillName}" not running, attempting auto-start...`);
      port = await tryAutoStartSkill(skillName);
    }
    resolvePromise!(port);
    return port;
  } catch (err) {
    resolvePromise!(null);
    throw err;
  } finally {
    ensureLocks.delete(skillName);
  }
}

export interface SkillCallOptions {
  /** If true, skip auto-start when skill is not running (for dashboard/read-only calls) */
  skipAutoStart?: boolean;
}

/**
 * Call a skill's REST API endpoint.
 *
 * 1. Resolves the skill's preview port from the projects table.
 * 2. Constructs the full URL with optional query parameters.
 * 3. Sends the HTTP request using native fetch with a 5-second timeout.
 * 4. Returns a SkillCallResult indicating success/failure.
 */
export async function callSkillApi(
  skillName: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: any,
  queryParams?: Record<string, string>,
  options?: SkillCallOptions
): Promise<SkillCallResult> {
  const t0 = Date.now();
  try {
    // 1. Resolve the skill's running port
    let port = await resolveSkillPort(skillName);
    console.log(`[SkillCaller] resolveSkillPort("${skillName}") → ${port} (${Date.now() - t0}ms)`);

    // 1b. If port is null, try to auto-start the skill (unless skipAutoStart)
    if (port === null && !options?.skipAutoStart) {
      console.log(`[SkillCaller] Skill "${skillName}" not running, attempting auto-start...`);
      port = await tryAutoStartSkill(skillName);
    }

    if (port === null) {
      return {
        success: false,
        error: `技能 "${skillName}" 当前未运行且自动启动失败。请在工作区中找到该技能项目并手动点击启动（▶），等待预览服务启动后再试。`,
        code: 'SKILL_NOT_RUNNING',
      };
    }

    // 2. Build the request URL
    const url = buildSkillUrl(port, path, queryParams);

    // 3. Set up a 30-second timeout via AbortController (portal/meeting APIs may need more time)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // 4. Build fetch options
      const fetchOptions: RequestInit = {
        method,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      // Attach body for methods that support it
      if (body !== undefined && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
        fetchOptions.body = JSON.stringify(body);
      }

      // 5. Execute the HTTP request
      const tFetch = Date.now();
      const response = await fetch(url, fetchOptions);

      // 6. Parse the response
      let data: any;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      console.log(`[SkillCaller] ${method} ${path} → ${response.status} (fetch ${Date.now() - tFetch}ms, total ${Date.now() - t0}ms)`);

      if (!response.ok) {
        return {
          success: false,
          error: `技能 API 返回错误 (${response.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`,
        };
      }

      return {
        success: true,
        data,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: unknown) {
    // Handle abort (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: `技能 "${skillName}" API 调用超时（30秒），服务可能负载过高，请稍后重试`,
        code: 'SKILL_TIMEOUT',
      };
    }

    // Handle connection errors (skill not actually running despite having a port)
    if (error instanceof Error && ('code' in error || error.message.includes('ECONNREFUSED'))) {
      if (options?.skipAutoStart) {
        return {
          success: false,
          error: `技能 "${skillName}" 的服务未运行。`,
          code: 'SKILL_NOT_RUNNING',
        };
      }
      // Try auto-restart once
      console.log(`[SkillCaller] Connection refused for skill "${skillName}", attempting auto-restart...`);
      const restartedPort = await tryAutoStartSkill(skillName);
      if (restartedPort) {
        // Retry the call once after restart
        try {
          const retryUrl = buildSkillUrl(restartedPort, path, queryParams);
          const retryController = new AbortController();
          const retryTimeout = setTimeout(() => retryController.abort(), 30000);
          try {
            const retryOptions: RequestInit = {
              method,
              signal: retryController.signal,
              headers: { 'Content-Type': 'application/json' },
            };
            if (body !== undefined && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
              retryOptions.body = JSON.stringify(body);
            }
            const retryResponse = await fetch(retryUrl, retryOptions);
            const retryContentType = retryResponse.headers.get('content-type');
            let retryData: any;
            if (retryContentType && retryContentType.includes('application/json')) {
              retryData = await retryResponse.json();
            } else {
              retryData = await retryResponse.text();
            }
            if (retryResponse.ok) {
              return { success: true, data: retryData };
            }
          } finally {
            clearTimeout(retryTimeout);
          }
        } catch {
          // Retry also failed, fall through to error
        }
      }

      return {
        success: false,
        error: `技能 "${skillName}" 的服务无法连接，自动重启也未成功。请手动重新启动该技能。`,
        code: 'SKILL_CONNECTION_REFUSED',
      };
    }

    // Generic error
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `技能 API 调用失败: ${message}`,
    };
  }
}

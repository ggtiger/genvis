/**
 * Permission management service for Claude SDK integration
 * Handles permission requests, user confirmations, and auto-approve logic
 */

import type { PermissionMode } from '@/types/backend/project';
import path from 'path';

// Permission request stored in globalThis for persistence across hot reloads
export interface PendingPermission {
  id: string;
  projectId: string;
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  inputPreview: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  /** Security warning when operation targets paths outside allowed scope */
  securityWarning?: string;
}

// Internal storage with resolve function (not exported)
interface PendingPermissionInternal extends PendingPermission {
  resolve?: (approved: boolean) => void;
}

export interface PermissionDecision {
  approved: boolean;
  reason?: string;
  timestamp: string;
}

// Read-only tools that are always safe to auto-approve
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'ListDirectory',
  'Task',
  'TodoRead',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Tool',
  'Skill',
]);

// File editing tools
const EDIT_TOOLS = new Set([
  'Write',
  'Edit',
  'NotebookEdit',
]);

// Permission timeout in milliseconds (24 hours - effectively no auto-timeout)
const PERMISSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// Poll interval for checking permission status (100ms)
const POLL_INTERVAL_MS = 100;

// Global storage for pending permissions (survives hot reload)
declare global {
  // eslint-disable-next-line no-var
  var __permissionStore: Map<string, PendingPermissionInternal> | undefined;
}

function getPermissionStore(): Map<string, PendingPermissionInternal> {
  if (!globalThis.__permissionStore) {
    globalThis.__permissionStore = new Map();
  }
  return globalThis.__permissionStore;
}

/**
 * Generate a unique permission ID
 */
function generatePermissionId(): string {
  return `perm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create input preview string (truncated JSON)
 */
function createInputPreview(toolInput: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(toolInput, null, 2);
    return json.length > 500 ? json.slice(0, 500) + '...' : json;
  } catch {
    return '[Unable to serialize input]';
  }
}

/**
 * Add a pending permission request and return a Promise that resolves when user responds
 * This combines addPendingPermission + waitForPermission into one atomic operation
 */
export function addPendingPermissionAndWait(
  projectId: string,
  requestId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  securityWarning?: string
): { permission: PendingPermission; waitPromise: Promise<boolean> } {
  const store = getPermissionStore();
  const now = Date.now();
  const id = generatePermissionId();

  const permission: PendingPermissionInternal = {
    id,
    projectId,
    requestId,
    toolName,
    toolInput,
    inputPreview: createInputPreview(toolInput),
    createdAt: now,
    expiresAt: now + PERMISSION_TIMEOUT_MS,
    status: 'pending',
    securityWarning,
  };

  const waitPromise = new Promise<boolean>((resolve) => {
    permission.resolve = resolve;

    // Auto-timeout
    setTimeout(() => {
      if (store.has(id) && store.get(id)?.status === 'pending') {
        console.log(`[Permission] Timeout: ${id}`);
        permission.status = 'expired';
        store.set(id, permission);
        resolve(false);
      }
    }, PERMISSION_TIMEOUT_MS);
  });

  store.set(id, permission);
  console.log(`[Permission] Added pending permission: ${id} for ${toolName}`);

  // Return public interface (without resolve function)
  const publicPermission: PendingPermission = {
    id: permission.id,
    projectId: permission.projectId,
    requestId: permission.requestId,
    toolName: permission.toolName,
    toolInput: permission.toolInput,
    inputPreview: permission.inputPreview,
    createdAt: permission.createdAt,
    expiresAt: permission.expiresAt,
    status: permission.status,
    securityWarning: permission.securityWarning,
  };

  return { permission: publicPermission, waitPromise };
}

/**
 * Add a pending permission request (legacy - for backward compatibility)
 */
export function addPendingPermission(
  projectId: string,
  requestId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): PendingPermission {
  const { permission } = addPendingPermissionAndWait(projectId, requestId, toolName, toolInput);
  return permission;
}

/**
 * Get all pending permissions for a project
 */
export function getPendingPermissions(projectId: string): PendingPermission[] {
  const store = getPermissionStore();
  const now = Date.now();
  const pending: PendingPermission[] = [];

  for (const [id, perm] of store.entries()) {
    if (perm.projectId === projectId) {
      // Check expiration
      if (perm.status === 'pending' && now > perm.expiresAt) {
        perm.status = 'expired';
        store.set(id, perm);
      }

      if (perm.status === 'pending') {
        pending.push(perm);
      }
    }
  }

  return pending;
}

/**
 * Get a specific permission by ID
 */
export function getPermissionById(permissionId: string): PendingPermission | undefined {
  const store = getPermissionStore();
  const perm = store.get(permissionId);

  if (perm && perm.status === 'pending') {
    const now = Date.now();
    if (now > perm.expiresAt) {
      perm.status = 'expired';
      store.set(permissionId, perm);
    }
  }

  return perm;
}

/**
 * Resolve a permission request (approve or deny)
 * Calls the stored resolve function directly (like Demo)
 */
export function resolvePermission(
  permissionId: string,
  approved: boolean
): boolean {
  const store = getPermissionStore();
  const perm = store.get(permissionId);

  if (!perm) {
    console.log(`[Permission] Permission not found: ${permissionId}`);
    return false;
  }

  if (perm.status !== 'pending') {
    console.log(`[Permission] Permission already resolved: ${permissionId} (${perm.status})`);
    return false;
  }

  perm.status = approved ? 'approved' : 'denied';
  store.set(permissionId, perm);

  // Call the stored resolve function directly (key fix!)
  if (perm.resolve) {
    perm.resolve(approved);
  }

  console.log(`[Permission] Resolved permission: ${permissionId} -> ${perm.status}`);
  return true;
}

/**
 * Wait for a permission to be resolved (with timeout)
 */
export async function waitForPermission(permissionId: string): Promise<boolean> {
  const store = getPermissionStore();

  return new Promise((resolve) => {
    const checkStatus = () => {
      const perm = store.get(permissionId);

      if (!perm) {
        resolve(false);
        return;
      }

      if (perm.status === 'approved') {
        resolve(true);
        return;
      }

      if (perm.status === 'denied' || perm.status === 'expired') {
        resolve(false);
        return;
      }

      // Check expiration
      if (Date.now() > perm.expiresAt) {
        perm.status = 'expired';
        store.set(permissionId, perm);
        console.log(`[Permission] Permission expired: ${permissionId}`);
        resolve(false);
        return;
      }

      // Continue polling
      setTimeout(checkStatus, POLL_INTERVAL_MS);
    };

    checkStatus();
  });
}

/**
 * Clean up old permissions (called periodically)
 */
export function cleanupExpiredPermissions(): void {
  const store = getPermissionStore();
  const now = Date.now();
  const expireThreshold = now - PERMISSION_TIMEOUT_MS * 2;

  for (const [id, perm] of store.entries()) {
    if (perm.createdAt < expireThreshold) {
      store.delete(id);
    }
  }
}

/**
 * Determine if a tool should be auto-approved based on permission mode
 */
export function shouldAutoApprove(
  toolName: string,
  permissionMode: PermissionMode
): boolean {
  switch (permissionMode) {
    case 'bypassPermissions':
      return true;

    case 'acceptEdits':
      return READ_ONLY_TOOLS.has(toolName) || EDIT_TOOLS.has(toolName);

    case 'default':
    default:
      return READ_ONLY_TOOLS.has(toolName);
  }
}

/**
 * Get human-readable description for permission mode
 */
export function getPermissionModeLabel(mode: PermissionMode): string {
  switch (mode) {
    case 'default':
      return '只读放行';
    case 'acceptEdits':
      return '允许编辑';
    case 'bypassPermissions':
      return '全放行';
    default:
      return mode;
  }
}

/**
 * Get description for permission mode
 */
export function getPermissionModeDescription(mode: PermissionMode): string {
  switch (mode) {
    case 'default':
      return '只读工具自动放行';
    case 'acceptEdits':
      return '编辑工具自动放行';
    case 'bypassPermissions':
      return '所有工具自动放行';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Out-of-scope path detection (security boundary check)
// ---------------------------------------------------------------------------

/**
 * Tools that perform destructive or modifying file/command operations.
 * These are the tools we need to check for out-of-scope path access.
 */
const DESTRUCTIVE_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'bash',
  'run',
  'shell',
]);

/**
 * Extract file paths from tool input for security boundary checking.
 * Different tools store paths in different fields.
 */
function extractPathsFromToolInput(toolName: string, toolInput: Record<string, unknown>): string[] {
  const paths: string[] = [];

  // Common file path fields
  const pathFields = ['file_path', 'filePath', 'path', 'file', 'target', 'destination', 'dest'];
  for (const field of pathFields) {
    const val = toolInput[field];
    if (typeof val === 'string' && val.trim()) {
      paths.push(val.trim());
    }
  }

  // Bash/command: extract paths from command string
  if (toolName === 'Bash' || toolName === 'bash' || toolName === 'run' || toolName === 'shell') {
    const command = toolInput.command as string | undefined;
    if (typeof command === 'string') {
      // Check for rm, mv, cp, etc. with absolute paths
      const dangerousPatterns = [
        /\brm\s+(?:-[rfRF]+\s+)?([/~][^\s;|&]+)/g,
        /\bmv\s+[^\s]+\s+([/~][^\s;|&]+)/g,
        /\bcp\s+(?:-[rfR]+\s+)?[^\s]+\s+([/~][^\s;|&]+)/g,
        /\b(?:chmod|chown)\s+[^\s]+\s+([/~][^\s;|&]+)/g,
        /(?<!\d)\b>\s*([/~][^\s;|&]+)/g,  // redirect output to file (exclude FD redirects like 2>)
        /\btee\s+(?:-a\s+)?([/~][^\s;|&]+)/g,
      ];
      for (const pattern of dangerousPatterns) {
        let match;
        while ((match = pattern.exec(command)) !== null) {
          // Skip /dev/null and other /dev/ special device paths
          if (match[1] && !match[1].startsWith('/dev/')) paths.push(match[1]);
        }
      }
    }
  }

  return paths;
}

/**
 * Check if a tool operation targets paths outside the allowed scope.
 * Returns a security warning message if out-of-scope, or null if safe.
 *
 * Allowed scopes:
 * - projectPath: The current project's working directory
 * - platformPath: The Genvis platform installation directory (process.cwd())
 *
 * @param toolName - The tool being invoked
 * @param toolInput - The tool's input parameters
 * @param projectPath - Absolute path of the current project
 * @returns Security warning string if out-of-scope, null if within scope
 */
export function checkOutOfScopeOperation(
  toolName: string,
  toolInput: Record<string, unknown>,
  projectPath: string
): string | null {
  // Only check destructive/modifying tools
  if (!DESTRUCTIVE_TOOLS.has(toolName)) {
    return null;
  }

  const extractedPaths = extractPathsFromToolInput(toolName, toolInput);
  if (extractedPaths.length === 0) {
    return null;
  }

  const normalizedProjectPath = path.resolve(projectPath);
  const platformPath = path.resolve(process.cwd());

  const outOfScopePaths: string[] = [];

  for (const rawPath of extractedPaths) {
    // Expand ~ to home directory
    const expandedPath = rawPath.startsWith('~')
      ? path.join(process.env.HOME || '/', rawPath.slice(1))
      : rawPath;

    // Only check absolute paths — relative paths are resolved within project scope by the CLI
    if (!path.isAbsolute(expandedPath)) {
      continue;
    }

    const resolved = path.resolve(expandedPath);

    // Check if within project directory
    if (resolved === normalizedProjectPath || resolved.startsWith(normalizedProjectPath + path.sep)) {
      continue;
    }

    // Check if within platform installation directory
    if (resolved === platformPath || resolved.startsWith(platformPath + path.sep)) {
      continue;
    }

    outOfScopePaths.push(resolved);
  }

  if (outOfScopePaths.length === 0) {
    return null;
  }

  // Build warning message
  const pathList = outOfScopePaths.map(p => `  • ${p}`).join('\n');
  return `⚠️ 安全警告：操作超出当前项目范围\n工具 ${toolName} 试图访问以下路径：\n${pathList}\n该路径不在当前项目目录 (${normalizedProjectPath}) 或平台安装目录内。`;
}

/**
 * Log permission decision for debugging and auditing
 */
export function logPermissionDecision(
  projectId: string,
  toolName: string,
  permissionMode: PermissionMode,
  autoApproved: boolean,
  toolInput?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const inputSummary = toolInput
    ? JSON.stringify(toolInput).slice(0, 200)
    : 'N/A';

  console.log(
    `[Permission] ${timestamp} | project=${projectId} | tool=${toolName} | mode=${permissionMode} | auto=${autoApproved} | input=${inputSummary}`
  );
}

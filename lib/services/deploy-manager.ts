/**
 * DeployManager - Manages local build & production deployment of Skill Apps
 *
 * Handles `npm run build` + `npm start` (Next.js) or `uvicorn` (Python FastAPI)
 * for Skill Apps, persisting deploy metadata to plugin-ex.json.
 */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fsSync from 'fs';
import kill from 'tree-kill';
import { findAvailablePort } from '@/lib/utils/ports';
import { getAllSkills, readSkillExtendedConfig, writeSkillExtendedConfig } from './skill-service';
import { getBuiltinNodePath, getBuiltinNpmCliPath, getBuiltinNodeDir } from '@/lib/config/paths';
import {
  detectPython,
  createVirtualEnv,
  getVenvPythonPath,
  isVenvUsable,
} from '@/lib/utils/python';
import { PREVIEW_CONFIG } from '@/lib/config/constants';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export type DeployStatus =
  | 'not_deployed'
  | 'building'
  | 'deployed'
  | 'build_failed'
  | 'stopped';

export interface DeployedProcess {
  process: ChildProcess | null;
  port: number;
  status: DeployStatus;
  logs: string[];
  buildLogs: string[];
  startedAt: Date;
  buildTimestamp?: string;
  restartCount: number;
}

export interface DeployInfo {
  status: DeployStatus;
  port: number | null;
  buildTimestamp: string | null;
  logs: string[];
}

export interface SkillDeployMeta {
  status: DeployStatus;
  port: number;
  buildTimestamp?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAY_MS = 3000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get npm executor config — prefer builtin Node.js, fallback to system npm.
 */
function getNpmExecutor(): { command: string; args: string[]; useBuiltin: boolean } {
  const builtinNode = getBuiltinNodePath();
  const builtinNpmCli = getBuiltinNpmCliPath();

  if (builtinNode && builtinNpmCli) {
    return { command: builtinNode, args: [builtinNpmCli], useBuiltin: true };
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return { command: npmCommand, args: [], useBuiltin: false };
}

/**
 * Build a safe subprocess environment, filtering out sensitive vars
 * and injecting GOODABLE_API_BASE.
 */
function buildSafeEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const BLACKLIST = ['DATABASE_URL', 'ENCRYPTION_KEY', 'PROJECTS_DIR'];
  // Next.js internal env var prefixes that leak from the parent process and
  // interfere with child project builds (causes "generate is not a function"
  // and similar cryptic errors).
  const NEXT_INTERNAL_PREFIXES = ['__NEXT_', 'NEXT_RUNTIME', 'NEXT_DEPLOYMENT'];
  const safeEnv: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (BLACKLIST.includes(key)) continue;
    if (NEXT_INTERNAL_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    safeEnv[key] = value;
  }

  const webPort = process.env.WEB_PORT || process.env.PORT || '3033';
  safeEnv.GOODABLE_API_BASE = `http://localhost:${webPort}`;

  // Inject a safe default DATABASE_URL for sub-projects (Prisma expects this).
  // Uses relative path so each skill's DB lives in its own project directory.
  safeEnv.DATABASE_URL = 'file:./dev.db';

  // Set CI=true to disable interactive prompts in Next.js build
  // Prevents "setRawMode EPERM" errors in subprocess environment
  safeEnv.CI = 'true';

  // macOS: Dock/Finder launch has minimal PATH, ensure common paths are included
  if (process.platform === 'darwin') {
    const currentPath = safeEnv.PATH || '';
    const macOSPaths = [
      '/opt/homebrew/bin',   // Apple Silicon homebrew
      '/opt/homebrew/sbin',
      '/usr/local/bin',      // Intel homebrew
      '/usr/local/sbin',
      '/usr/bin',
      '/bin',
    ];
    const missingPaths = macOSPaths.filter((p) => !currentPath.includes(p));
    if (missingPaths.length > 0) {
      safeEnv.PATH = missingPaths.join(':') + ':' + currentPath;
    }
  }

  Object.assign(safeEnv, overrides);
  return safeEnv as NodeJS.ProcessEnv;
}

/**
 * Run a command and collect output. Returns a promise that resolves on exit code 0.
 */
function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  onLog: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) onLog(line);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) onLog(line);
      }
    });

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command exited with code ${code}`));
    });
  });
}

/**
 * Resolve preview port bounds from env or fallback constants.
 */
function resolvePortBounds(): { start: number; end: number } {
  const envStart = Number.parseInt(process.env.PREVIEW_PORT_START || '', 10);
  const envEnd = Number.parseInt(process.env.PREVIEW_PORT_END || '', 10);

  const start = Number.isInteger(envStart) ? Math.max(1, envStart) : PREVIEW_CONFIG.FALLBACK_PORT_START;
  let end = Number.isInteger(envEnd) ? Math.min(65535, envEnd) : PREVIEW_CONFIG.FALLBACK_PORT_END;
  if (end < start) {
    end = Math.min(start + (PREVIEW_CONFIG.FALLBACK_PORT_END - PREVIEW_CONFIG.FALLBACK_PORT_START), 65535);
  }
  return { start, end };
}

// ---------------------------------------------------------------------------
// DeployManager Class
// ---------------------------------------------------------------------------

class DeployManager {
  private processes = new Map<string, DeployedProcess>();

  // -------------------------------------------------------------------------
  // Persistence helpers – read/write `deployedSkills` in plugin-ex.json
  // -------------------------------------------------------------------------

  async readDeployedSkills(): Promise<Record<string, SkillDeployMeta>> {
    try {
      const config = await readSkillExtendedConfig();
      return (config.deployedSkills as Record<string, SkillDeployMeta>) ?? {};
    } catch {
      return {};
    }
  }

  async writeDeployedSkills(
    deployedSkills: Record<string, SkillDeployMeta>,
  ): Promise<void> {
    const config = await readSkillExtendedConfig();
    config.deployedSkills = deployedSkills;
    await writeSkillExtendedConfig(config);
  }

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  getStatus(skillName: string): DeployInfo {
    const proc = this.processes.get(skillName);
    if (!proc) {
      return { status: 'not_deployed', port: null, buildTimestamp: null, logs: [] };
    }
    return {
      status: proc.status,
      port: proc.port,
      buildTimestamp: proc.buildTimestamp ?? null,
      logs: [...proc.logs],
    };
  }

  getBuildLogs(skillName: string): string[] {
    const proc = this.processes.get(skillName);
    return proc ? [...proc.buildLogs] : [];
  }

  // -------------------------------------------------------------------------
  // Notify frontend via streamManager
  // -------------------------------------------------------------------------

  private publishStatus(skillName: string, status: DeployStatus, extra?: Record<string, unknown>): void {
    try {
      // Lazy require to avoid circular dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { streamManager } = require('./stream');
      const projectId = `skill-${skillName}`;
      streamManager.publish(projectId, {
        type: 'deploy_status',
        data: { skillName, status, ...extra },
      });
    } catch (err) {
      console.error('[DeployManager] Failed to publish status:', err);
    }
  }

  // -------------------------------------------------------------------------
  // Port resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve port for a skill: prefer saved port, otherwise find a new one.
   */
  private async resolvePort(skillName: string): Promise<number> {
    const deployed = await this.readDeployedSkills();
    const saved = deployed[skillName];
    if (saved?.port) {
      // Check if saved port is still available
      try {
        const available = await findAvailablePort(saved.port, saved.port);
        if (available === saved.port) return saved.port;
      } catch {
        // Port occupied, fall through to allocate a new one
      }
    }
    const bounds = resolvePortBounds();
    return findAvailablePort(bounds.start, bounds.end);
  }

  /**
   * Resolve port for a skill, excluding ports already allocated in this batch.
   * Used by startAllDeployed to prevent duplicate port assignments when
   * multiple skills start before any of them bind their port.
   */
  private async resolvePortExcluding(skillName: string, exclude: Set<number>): Promise<number> {
    const bounds = resolvePortBounds();
    for (let port = bounds.start; port <= bounds.end; port++) {
      if (exclude.has(port)) continue;
      try {
        const available = await findAvailablePort(port, port);
        if (available === port) return port;
      } catch {
        // Port occupied, try next
      }
    }
    throw new Error(`No available port found for skill "${skillName}" in range ${bounds.start}-${bounds.end}`);
  }


  // -------------------------------------------------------------------------
  // Dependency management
  // -------------------------------------------------------------------------

  /**
   * Ensure node_modules exist for a Next.js project; run `npm install` if missing.
   */
  private async ensureNodeDependencies(
      projectPath: string,
      onLog: (line: string) => void,
    ): Promise<void> {
      const nodeModulesPath = path.join(projectPath, 'node_modules');
      const packageJsonPath = path.join(projectPath, 'package.json');

      let needsInstall = false;

      if (!fsSync.existsSync(nodeModulesPath)) {
        needsInstall = true;
        onLog('[DeployManager] node_modules missing, running npm install...');
      } else if (fsSync.existsSync(packageJsonPath)) {
        // Compare mtime: if package.json is newer than node_modules, re-install
        try {
          const pkgStat = fsSync.statSync(packageJsonPath);
          const nmStat = fsSync.statSync(nodeModulesPath);
          if (pkgStat.mtimeMs > nmStat.mtimeMs) {
            needsInstall = true;
            onLog('[DeployManager] package.json changed since last install, running npm install...');
          }
        } catch {
          // If stat fails, fall through to skip
        }
      }

      if (!needsInstall) {
        onLog('[DeployManager] node_modules up-to-date, skipping install');
        return;
      }

      const executor = getNpmExecutor();
      const builtinNodeDir = getBuiltinNodeDir();

      const env = buildSafeEnv({ NODE_ENV: 'development' });
      if (builtinNodeDir) {
        env.PATH = `${builtinNodeDir}${path.delimiter}${env.PATH || ''}`;
      }

      const command = executor.command;
      const args = [...executor.args, 'install', '--registry=https://registry.npmmirror.com'];

      await runCommand(command, args, projectPath, env, onLog);
      onLog('[DeployManager] npm install completed');
    }

  /**
   * Ensure Python virtual environment and dependencies for a FastAPI project.
   */
  private async ensurePythonDependencies(
    projectPath: string,
    onLog: (line: string) => void,
  ): Promise<void> {
    const pythonCmd = await detectPython();
    if (!pythonCmd) {
      throw new Error('Python not found (neither builtin nor system)');
    }

    await createVirtualEnv(projectPath, pythonCmd);

    const venvPython = getVenvPythonPath(projectPath);
    if (!fsSync.existsSync(venvPython)) {
      throw new Error('Virtual environment creation failed');
    }

    // Install dependencies via "python -m pip" (more reliable than calling pip directly)
    const requirementsPath = path.join(projectPath, 'requirements.txt');
    if (fsSync.existsSync(requirementsPath)) {
      onLog('[DeployManager] Installing Python dependencies...');
      const env = buildSafeEnv({ PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' });
      await runCommand(
        venvPython,
        ['-m', 'pip', 'install', '-i', 'https://mirrors.aliyun.com/pypi/simple', '-r', 'requirements.txt'],
        projectPath,
        env,
        onLog,
      );
      onLog('[DeployManager] Python dependencies installed');
    } else {
      onLog('[DeployManager] No requirements.txt found, skipping pip install');
    }
  }

  // -------------------------------------------------------------------------
  // Prisma setup
  // -------------------------------------------------------------------------

  /**
   * If the project has prisma/schema.prisma, run `prisma generate` and `prisma db push`
   * to ensure the Prisma Client is generated and the database tables exist.
   */
  private async ensurePrismaSetup(
    projectPath: string,
    onLog: (line: string) => void,
  ): Promise<void> {
    const schemaPath = path.join(projectPath, 'prisma', 'schema.prisma');
    if (!fsSync.existsSync(schemaPath)) {
      return; // Not a Prisma project
    }

    onLog('[DeployManager] Detected prisma/schema.prisma, running Prisma setup...');

    const executor = getNpmExecutor();
    const builtinNodeDir = getBuiltinNodeDir();
    const env = buildSafeEnv({ NODE_ENV: 'development' });
    if (builtinNodeDir) {
      env.PATH = `${builtinNodeDir}${path.delimiter}${env.PATH || ''}`;
    }

    // 1. prisma generate
    try {
      onLog('[DeployManager] Running prisma generate...');
      await runCommand(
        executor.command,
        [...executor.args, 'exec', 'prisma', 'generate'],
        projectPath,
        env,
        onLog,
      );
      onLog('[DeployManager] prisma generate completed');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onLog(`[DeployManager] prisma generate failed: ${msg}`);
      throw new Error(`Prisma generate failed: ${msg}`);
    }

    // 2. prisma db push (create tables if not exist)
    try {
      onLog('[DeployManager] Running prisma db push...');
      await runCommand(
        executor.command,
        [...executor.args, 'exec', 'prisma', 'db', 'push', '--skip-generate'],
        projectPath,
        env,
        onLog,
      );
      onLog('[DeployManager] prisma db push completed');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onLog(`[DeployManager] prisma db push failed: ${msg}`);
      throw new Error(`Prisma db push failed: ${msg}`);
    }
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  /**
   * Run `npm run build` for a Next.js project.
   */
  private async runBuild(
    projectPath: string,
    onLog: (line: string) => void,
  ): Promise<void> {
    onLog('[DeployManager] Running npm run build...');
    const executor = getNpmExecutor();
    const builtinNodeDir = getBuiltinNodeDir();

    const env = buildSafeEnv({ NODE_ENV: 'production' });
    if (builtinNodeDir) {
      env.PATH = `${builtinNodeDir}${path.delimiter}${env.PATH || ''}`;
    }

    // Remove parent Next.js public env vars to prevent config leaking into child build
    for (const key of Object.keys(env)) {
      if (key.startsWith('NEXT_PUBLIC_')) {
        delete env[key];
      }
    }

    const command = executor.command;
    const args = [...executor.args, 'run', 'build'];

    await runCommand(command, args, projectPath, env, onLog);
    onLog('[DeployManager] Build completed successfully');
  }

  // -------------------------------------------------------------------------
  // Production process start
  // -------------------------------------------------------------------------

  /**
   * Start a Next.js production server: `npm start -- --port {port}`
   */
  private startNextjsProduction(
    skillName: string,
    projectPath: string,
    port: number,
    deployedProcess: DeployedProcess,
  ): void {
    const executor = getNpmExecutor();
    const builtinNodeDir = getBuiltinNodeDir();

    const env = buildSafeEnv({
      NODE_ENV: 'production',
      PORT: String(port),
    });
    if (builtinNodeDir) {
      env.PATH = `${builtinNodeDir}${path.delimiter}${env.PATH || ''}`;
    }

    const command = executor.command;
    const args = [...executor.args, 'start', '--', '--port', String(port)];

    console.log(`[DeployManager] Starting Next.js production: ${command} ${args.join(' ')} (port ${port})`);

    const child = spawn(command, args, {
      cwd: projectPath,
      env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    deployedProcess.process = child;
    this.attachProcessListeners(skillName, projectPath, child, deployedProcess, 'nextjs');
  }

  /**
   * Start a Python FastAPI production server: `uvicorn app.main:app --host 0.0.0.0 --port {port}`
   */
  private startPythonProduction(
    skillName: string,
    projectPath: string,
    port: number,
    deployedProcess: DeployedProcess,
  ): void {
    const venvPython = getVenvPythonPath(projectPath);

    const env = buildSafeEnv({
      NODE_ENV: 'production',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    });

    const args = [
      '-m', 'uvicorn', 'app.main:app',
      '--host', '0.0.0.0',
      '--port', String(port),
    ];

    console.log(`[DeployManager] Starting Python production: ${venvPython} ${args.join(' ')} (port ${port})`);

    const child = spawn(venvPython, args, {
      cwd: projectPath,
      env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    deployedProcess.process = child;
    this.attachProcessListeners(skillName, projectPath, child, deployedProcess, 'python-fastapi');
  }

  // -------------------------------------------------------------------------
  // Process event listeners (stdout/stderr + exit with auto-restart)
  // -------------------------------------------------------------------------

  private attachProcessListeners(
    skillName: string,
    projectPath: string,
    child: ChildProcess,
    deployedProcess: DeployedProcess,
    projectType: 'nextjs' | 'python-fastapi',
  ): void {
    let readyLogged = false;

    const pushLog = (line: string) => {
      deployedProcess.logs.push(line);
      if (deployedProcess.logs.length > 500) {
        deployedProcess.logs.splice(0, deployedProcess.logs.length - 500);
      }
    };

    const collectLog = (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        pushLog(line);

        // Detect server ready and add a helpful note
        if (!readyLogged && (line.includes('Ready in') || line.includes('started server') || line.includes('Uvicorn running'))) {
          readyLogged = true;
          pushLog(`[DeployManager] ✓ 服务已就绪 http://localhost:${deployedProcess.port}`);
          if (projectType === 'nextjs') {
            pushLog('[DeployManager] ℹ Next.js 生产模式不输出请求日志，这是正常的');
          }
        }
      }
    };

    child.stdout?.on('data', collectLog);
    child.stderr?.on('data', collectLog);

    child.on('close', (code, signal) => {
      // Ignore if process was intentionally stopped (status already changed)
      if (deployedProcess.status === 'stopped' || deployedProcess.status === 'building') {
        return;
      }

      console.log(`[DeployManager] Process for "${skillName}" exited (code=${code}, signal=${signal})`);

      if (code === 0) {
        // Normal exit — mark as stopped but keep in map for status tracking
        deployedProcess.status = 'stopped';
        deployedProcess.process = null;
        this.publishStatus(skillName, 'stopped');
        this.persistDeployStatus(skillName, 'stopped', deployedProcess.port, deployedProcess.buildTimestamp).catch(err => {
          console.error('[DeployManager] Failed to persist stopped status:', err);
        });
      } else if (deployedProcess.restartCount < MAX_RESTART_ATTEMPTS) {
        deployedProcess.restartCount++;
        console.log(
          `[DeployManager] Auto-restarting "${skillName}" (attempt ${deployedProcess.restartCount}/${MAX_RESTART_ATTEMPTS})`,
        );
        this.publishStatus(skillName, 'deployed', {
          message: `Restarting (attempt ${deployedProcess.restartCount}/${MAX_RESTART_ATTEMPTS})`,
        });

        setTimeout(() => {
          // Re-check status — may have been stopped while waiting
          if (deployedProcess.status === 'stopped' || deployedProcess.status === 'building') return;

          if (projectType === 'nextjs') {
            this.startNextjsProduction(skillName, projectPath, deployedProcess.port, deployedProcess);
          } else {
            this.startPythonProduction(skillName, projectPath, deployedProcess.port, deployedProcess);
          }
        }, RESTART_DELAY_MS);
      } else {
        // Exhausted restart attempts
        console.error(`[DeployManager] "${skillName}" failed after ${MAX_RESTART_ATTEMPTS} restart attempts`);
        deployedProcess.status = 'stopped';
        deployedProcess.process = null;
        this.publishStatus(skillName, 'stopped', {
          message: `Process stopped after ${MAX_RESTART_ATTEMPTS} failed restart attempts`,
        });
        // Persist stopped status
        this.persistDeployStatus(skillName, 'stopped', deployedProcess.port).catch(err => {
          console.error('[DeployManager] Failed to persist stopped status:', err);
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Project record management
  // -------------------------------------------------------------------------

  /**
   * Create or update the project record in the DB so Secretary_Skill_Caller
   * can resolve the port via `previewPort`.
   */
  private async updateProjectRecord(skillName: string, port: number): Promise<void> {
    const { db } = await import('@/lib/db/client');
    const { projects } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    const projectId = `skill-${skillName}`;
    const now = new Date().toISOString();

    const existing = await db.select().from(projects).where(eq(projects.id, projectId)).get();

    if (existing) {
      await db.update(projects)
        .set({
          previewPort: port,
          previewUrl: `http://localhost:${port}`,
          status: 'running',
          updatedAt: now,
          lastActiveAt: now,
        })
        .where(eq(projects.id, projectId));
    } else {
      // Need skill metadata to create the record
      const skills = await getAllSkills();
      const skill = skills.find(s => s.name === skillName);
      if (!skill) {
        throw new Error(`Skill not found: ${skillName}`);
      }

      await db.insert(projects).values({
        id: projectId,
        name: skill.displayName || skill.name,
        description: skill.description,
        status: 'running',
        mode: 'code',
        repoPath: skill.path,
        projectType: skill.projectType || 'nextjs',
        planConfirmed: true,
        previewPort: port,
        previewUrl: `http://localhost:${port}`,
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now,
      });
    }

    console.log(`[DeployManager] Updated project record "${projectId}" with previewPort=${port}`);
  }

  /**
   * Ensure a project record exists for a skill, creating it if needed.
   * Used to make pre-built skills visible in the project list immediately
   * (e.g. with status "building") before dependencies are installed.
   */
  private async ensureProjectRecord(
    skillName: string,
    port: number,
    status: 'running' | 'building' = 'running',
  ): Promise<void> {
    const { db } = await import('@/lib/db/client');
    const { projects } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    const projectId = `skill-${skillName}`;
    const now = new Date().toISOString();

    const existing = await db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (existing) {
      // Update status only — don't overwrite port until it's actually running
      await db.update(projects)
        .set({ status, updatedAt: now, lastActiveAt: now })
        .where(eq(projects.id, projectId));
      return;
    }

    // Create new record
    const skills = await getAllSkills();
    const skill = skills.find(s => s.name === skillName);
    if (!skill) return;

    await db.insert(projects).values({
      id: projectId,
      name: skill.displayName || skill.name,
      description: skill.description,
      status,
      mode: 'code',
      repoPath: skill.path,
      projectType: skill.projectType || 'nextjs',
      planConfirmed: true,
      previewPort: port,
      previewUrl: `http://localhost:${port}`,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
    });

    console.log(`[DeployManager] Created project record "${projectId}" with status="${status}"`);
  }


  // -------------------------------------------------------------------------
  // Deploy status persistence
  // -------------------------------------------------------------------------

  /**
   * Persist deploy status + port + timestamp to plugin-ex.json.
   */
  private async persistDeployStatus(
    skillName: string,
    status: DeployStatus,
    port: number,
    buildTimestamp?: string,
  ): Promise<void> {
    const deployed = await this.readDeployedSkills();
    deployed[skillName] = {
      status,
      port,
      ...(buildTimestamp ? { buildTimestamp } : {}),
    };
    await this.writeDeployedSkills(deployed);
  }

  // -------------------------------------------------------------------------
  // Core lifecycle: deploy
  // -------------------------------------------------------------------------

  /**
   * Build and start a Skill App in production mode.
   *
   * Flow:
   * 1. Resolve skill metadata and project path
   * 2. Update status → building, notify frontend
   * 3. Install dependencies (if needed)
   * 4. Run build (Next.js only)
   * 5. Allocate port (prefer saved port)
   * 6. Start production process
   * 7. Write project record (previewPort)
   * 8. Persist deploy state to plugin-ex.json
   */
  async deploy(skillName: string): Promise<DeployInfo> {
    // 1. Resolve skill metadata
    const skills = await getAllSkills();
    const skill = skills.find(s => s.name === skillName);
    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`);
    }
    if (!skill.hasApp) {
      throw new Error(`Skill "${skillName}" does not support app mode (no projectType)`);
    }

    const projectPath = skill.path;
    const projectType = skill.projectType || 'nextjs';

    // Stop preview if running (preview and deploy share the same directory)
    const projectId = `skill-${skillName}`;
    try {
      const { previewManager } = await import('@/lib/services/preview');
      const previewStatus = previewManager.getStatus(projectId);
      if (previewStatus.status === 'running' || previewStatus.status === 'starting') {
        console.log(`[DeployManager] Stopping preview for "${skillName}" before deploy`);
        await previewManager.stop(projectId);
      }
    } catch (err) {
      console.warn(`[DeployManager] Failed to check/stop preview for "${skillName}":`, err);
    }

    // If there's an existing running process, stop it first
    const existing = this.processes.get(skillName);
    if (existing?.process?.pid) {
      console.log(`[DeployManager] Stopping existing process for "${skillName}" before deploy`);
      existing.status = 'building'; // Prevent auto-restart
      await this.killProcess(existing.process);
      existing.process = null;
    }

    // 2. Create in-memory record and set status to building
    const buildTimestamp = new Date().toISOString();
    const deployedProcess: DeployedProcess = {
      process: null,
      port: 0,
      status: 'building',
      logs: [],
      buildLogs: [],
      startedAt: new Date(),
      buildTimestamp,
      restartCount: 0,
    };
    this.processes.set(skillName, deployedProcess);
    this.publishStatus(skillName, 'building');

    const onBuildLog = (line: string) => {
      deployedProcess.buildLogs.push(line);
      if (deployedProcess.buildLogs.length > 1000) {
        deployedProcess.buildLogs.splice(0, deployedProcess.buildLogs.length - 1000);
      }
    };

    try {
      // 3. Install dependencies
      if (projectType === 'nextjs') {
        await this.ensureNodeDependencies(projectPath, onBuildLog);
        // 3.5 Prisma setup (if prisma/schema.prisma exists)
        await this.ensurePrismaSetup(projectPath, onBuildLog);
        // 4. Build
        await this.runBuild(projectPath, onBuildLog);
      } else if (projectType === 'python-fastapi') {
        await this.ensurePythonDependencies(projectPath, onBuildLog);
        // Python FastAPI has no build step
      }

      // 5. Allocate port
      const port = await this.resolvePort(skillName);
      deployedProcess.port = port;

      // 6. Start production process
      if (projectType === 'nextjs') {
        this.startNextjsProduction(skillName, projectPath, port, deployedProcess);
      } else {
        this.startPythonProduction(skillName, projectPath, port, deployedProcess);
      }

      // 7. Update project record with previewPort
      await this.updateProjectRecord(skillName, port);

      // 8. Persist deploy state
      deployedProcess.status = 'deployed';
      await this.persistDeployStatus(skillName, 'deployed', port, buildTimestamp);
      this.publishStatus(skillName, 'deployed', { port });

      console.log(`[DeployManager] Successfully deployed "${skillName}" on port ${port}`);
      return this.getStatus(skillName);
    } catch (error) {
      // Build or dependency install failed
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[DeployManager] Deploy failed for "${skillName}":`, errorMsg);

      deployedProcess.status = 'build_failed';
      deployedProcess.buildLogs.push(`[ERROR] ${errorMsg}`);
      this.publishStatus(skillName, 'build_failed', { error: errorMsg });

      // Persist failed status
      await this.persistDeployStatus(skillName, 'build_failed', deployedProcess.port, buildTimestamp).catch(err => {
        console.error('[DeployManager] Failed to persist build_failed status:', err);
      });

      return this.getStatus(skillName);
    }
  }

  // -------------------------------------------------------------------------
  // Process termination helper
  // -------------------------------------------------------------------------

  private killProcess(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (!child.pid) {
        resolve();
        return;
      }

      const pid = child.pid;

      // Try SIGTERM first (graceful), then SIGKILL after 3s
      kill(pid, 'SIGTERM', (err) => {
        if (err) {
          // SIGTERM failed (process may already be gone), try SIGKILL
          console.error('[DeployManager] SIGTERM failed, trying SIGKILL:', err.message);
          kill(pid, 'SIGKILL', () => resolve());
        } else {
          // SIGTERM sent, give it 3s then force kill
          const forceKillTimer = setTimeout(() => {
            try {
              process.kill(pid, 0); // Check if still alive
              console.warn(`[DeployManager] Process ${pid} still alive after SIGTERM, sending SIGKILL`);
              kill(pid, 'SIGKILL', () => resolve());
            } catch {
              // Process already dead
              resolve();
            }
          }, 3000);

          child.once('close', () => {
            clearTimeout(forceKillTimer);
            resolve();
          });

          // If already exited
          if (child.exitCode !== null) {
            clearTimeout(forceKillTimer);
            resolve();
          }
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Core lifecycle: stop
  // -------------------------------------------------------------------------

  /**
   * Stop a deployed Skill App's production process.
   *
   * 1. Kill the running process (tree-kill)
   * 2. Update in-memory status to `stopped`
   * 3. Clear `previewPort` from the project record
   * 4. Persist stopped status to plugin-ex.json
   * 5. Notify frontend
   */
  async stop(skillName: string): Promise<DeployInfo> {
    const proc = this.processes.get(skillName);
    if (!proc) {
      return { status: 'not_deployed', port: null, buildTimestamp: null, logs: [] };
    }

    // Mark as stopped before killing to prevent auto-restart in the close listener
    proc.status = 'stopped';

    // 1. Kill the running process (killProcess waits for process to actually exit)
    if (proc.process) {
      await this.killProcess(proc.process);
      proc.process = null;
    }

    // 2. Keep the record in processes map (so getStatus returns 'stopped', not 'not_deployed')
    // but clear the port from the project record
    try {
      const { updateProject } = await import('@/lib/services/project');
      const projectId = `skill-${skillName}`;
      await updateProject(projectId, {
        previewUrl: null,
        previewPort: null,
      });
    } catch (err) {
      console.error(`[DeployManager] Failed to clear project record for "${skillName}":`, err);
    }

    // 3. Persist stopped status to plugin-ex.json
    await this.persistDeployStatus(skillName, 'stopped', proc.port, proc.buildTimestamp);

    // 4. Notify frontend
    this.publishStatus(skillName, 'stopped');

    console.log(`[DeployManager] Stopped "${skillName}"`);
    return this.getStatus(skillName);
  }

  // -------------------------------------------------------------------------
  // Core lifecycle: start (without rebuild)
  // -------------------------------------------------------------------------

  /**
   * Start a previously-deployed Skill App without rebuilding.
   * Only spawns the production process using existing build artifacts.
   */
  async start(skillName: string): Promise<DeployInfo> {
    const skills = await getAllSkills();
    const skill = skills.find(s => s.name === skillName);
    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`);
    }
    if (!skill.hasApp) {
      throw new Error(`Skill "${skillName}" does not support app mode`);
    }

    const projectPath = skill.path;
    const projectType = skill.projectType || 'nextjs';

    // Verify build artifacts exist
    if (projectType === 'nextjs') {
      const nextDir = path.join(projectPath, '.next');
      if (!fsSync.existsSync(nextDir)) {
        throw new Error(`Build artifacts not found for "${skillName}". Please run a full deploy first.`);
      }
    }

    // If already running, just return status
    const existing = this.processes.get(skillName);
    if (existing?.status === 'deployed' && existing.process?.pid) {
      return this.getStatus(skillName);
    }

    // If there's a stale process still alive, kill it first to release the port
    if (existing?.process?.pid) {
      console.log(`[DeployManager] Killing stale process for "${skillName}" before start`);
      existing.status = 'stopped';
      await this.killProcess(existing.process);
      existing.process = null;
    }

    // Resolve port — prefer the previously used port
    let port = existing?.port || 0;
    if (!port) {
      port = await this.resolvePort(skillName);
    } else {
      try {
        const available = await findAvailablePort(port, port);
        if (available !== port) {
          port = await this.resolvePort(skillName);
        }
      } catch {
        port = await this.resolvePort(skillName);
      }
    }

    const deployedProcess: DeployedProcess = {
      process: null,
      port,
      status: 'deployed',
      logs: [`[DeployManager] Starting "${skillName}" on port ${port} (no rebuild)...`],
      buildLogs: existing?.buildLogs ?? [],
      startedAt: new Date(),
      buildTimestamp: existing?.buildTimestamp,
      restartCount: 0,
    };
    this.processes.set(skillName, deployedProcess);

    if (projectType === 'nextjs') {
      this.startNextjsProduction(skillName, projectPath, port, deployedProcess);
    } else {
      this.startPythonProduction(skillName, projectPath, port, deployedProcess);
    }

    await this.updateProjectRecord(skillName, port);
    await this.persistDeployStatus(skillName, 'deployed', port, deployedProcess.buildTimestamp);
    this.publishStatus(skillName, 'deployed', { port });

    console.log(`[DeployManager] Started "${skillName}" on port ${port} (no rebuild)`);
    return this.getStatus(skillName);
  }

  // -------------------------------------------------------------------------
  // Core lifecycle: redeploy
  // -------------------------------------------------------------------------

  /**
   * Redeploy a Skill App: stop the current process, then build and start fresh.
   */
  async redeploy(skillName: string): Promise<DeployInfo> {
    await this.stop(skillName);
    return this.deploy(skillName);
  }

  // -------------------------------------------------------------------------
  // Bulk lifecycle: startAllDeployed / stopAll
  // -------------------------------------------------------------------------

  /**
   * Restore all previously-deployed Skill Apps on system startup.
   *
   * Reads `deployedSkills` from plugin-ex.json and starts each skill whose
   * status is `deployed` or `stopped` in production mode.  Dependencies and
   * build steps are skipped — only the production process is spawned using the
   * persisted port.  For Next.js skills the `.next/` build directory must
   * exist; if it's missing the skill is skipped with a warning.
   *
   * Errors for individual skills are logged but do not prevent the remaining
   * skills from starting.
   */
  async startAllDeployed(): Promise<void> {
    let deployedSkills: Record<string, SkillDeployMeta>;
    try {
      deployedSkills = await this.readDeployedSkills();
    } catch (err) {
      console.error('[DeployManager] Failed to read deployedSkills, skipping auto-start:', err);
      return;
    }

    const eligibleEntries = Object.entries(deployedSkills).filter(
      ([, meta]) => meta.status === 'deployed' || meta.status === 'stopped',
    );

    if (eligibleEntries.length === 0) {
      console.log('[DeployManager] No deployed skills to start');
      return;
    }

    console.log(`[DeployManager] Auto-starting ${eligibleEntries.length} deployed skill(s)…`);

    // Track ports allocated in this batch to avoid duplicates
    // (processes may not have bound their port yet when the next skill resolves)
    const allocatedPorts = new Set<number>();

    // Resolve all skills once to avoid repeated calls
    let allSkills: Awaited<ReturnType<typeof getAllSkills>>;
    try {
      allSkills = await getAllSkills();
    } catch (err) {
      console.error('[DeployManager] Failed to load skills list, skipping auto-start:', err);
      return;
    }

    for (const [skillName, meta] of eligibleEntries) {
      try {
        // Skip if already running in memory (prevents duplicate processes)
        const existingProc = this.processes.get(skillName);
        if (existingProc?.process?.pid && existingProc.status === 'deployed') {
          console.log(`[DeployManager] Skill "${skillName}" already running (pid=${existingProc.process.pid}), skipping`);
          continue;
        }

        const skill = allSkills.find(s => s.name === skillName);
        if (!skill) {
          console.warn(`[DeployManager] Skill "${skillName}" not found in skills list, skipping`);
          continue;
        }
        if (!skill.hasApp) {
          console.warn(`[DeployManager] Skill "${skillName}" has no app mode, skipping`);
          continue;
        }

        const projectPath = skill.path;
        const projectType = skill.projectType || 'nextjs';

        // For Next.js projects, verify build artifacts exist
        if (projectType === 'nextjs') {
          const nextDir = path.join(projectPath, '.next');
          if (!fsSync.existsSync(nextDir)) {
            console.warn(
              `[DeployManager] Skill "${skillName}" is missing .next/ build artifacts, skipping. ` +
              'Run a full deploy to rebuild.',
            );
            continue;
          }
        }

        // Resolve port — prefer saved port, fall back to finding a new one
        let port = meta.port;
        if (!port || allocatedPorts.has(port)) {
          port = await this.resolvePortExcluding(skillName, allocatedPorts);
        } else {
          // Verify saved port is still available
          try {
            const available = await findAvailablePort(port, port);
            if (available !== port) {
              console.warn(
                `[DeployManager] Saved port ${port} for "${skillName}" is occupied, allocating new port`,
              );
              port = await this.resolvePortExcluding(skillName, allocatedPorts);
            }
          } catch {
            console.warn(
              `[DeployManager] Saved port ${port} for "${skillName}" is occupied, allocating new port`,
            );
            port = await this.resolvePortExcluding(skillName, allocatedPorts);
          }
        }
        allocatedPorts.add(port);

        // Create in-memory record
        const deployedProcess: DeployedProcess = {
          process: null,
          port,
          status: 'deployed',
          logs: [],
          buildLogs: [],
          startedAt: new Date(),
          buildTimestamp: meta.buildTimestamp,
          restartCount: 0,
        };
        this.processes.set(skillName, deployedProcess);

        // For pre-built skills, install dependencies if missing
        // (node_modules / .venv are stripped during Electron packaging to save space)
        const manifestPath = path.join(projectPath, '.prebuild-manifest.json');
        const isPrebuilt = fsSync.existsSync(manifestPath);

        if (isPrebuilt) {
          // Create project record early so the UI shows "启动中" immediately
          await this.ensureProjectRecord(skillName, port, 'building');
          // Persist building status so skill list API also reflects it
          await this.persistDeployStatus(skillName, 'building', port, meta.buildTimestamp);

          if (projectType === 'nextjs') {
            const nodeModulesDir = path.join(projectPath, 'node_modules');

            if (!fsSync.existsSync(nodeModulesDir)) {
              console.log(`[DeployManager] Pre-built skill "${skillName}" missing node_modules, installing...`);
              deployedProcess.status = 'building';
              this.publishStatus(skillName, 'building');
              try {
                await this.ensureNodeDependencies(projectPath, (line) => {
                  deployedProcess.buildLogs.push(line);
                });
                // Prisma generate + db push after fresh install
                await this.ensurePrismaSetup(projectPath, (line) => {
                  deployedProcess.buildLogs.push(line);
                });
                deployedProcess.status = 'deployed';
              } catch (depErr) {
                console.error(`[DeployManager] Failed to install deps for pre-built skill "${skillName}":`, depErr);
                deployedProcess.status = 'build_failed';
                this.publishStatus(skillName, 'build_failed');
                continue;
              }
            } else {
              // node_modules exists but .prisma/client may be missing or stale
              const prismaClientPath = path.join(projectPath, 'node_modules', '.prisma', 'client', 'default.js');
              if (!fsSync.existsSync(prismaClientPath)) {
                console.log(`[DeployManager] Pre-built skill "${skillName}" missing .prisma/client, running prisma generate...`);
                try {
                  await this.ensurePrismaSetup(projectPath, (line) => {
                    deployedProcess.buildLogs.push(line);
                  });
                } catch (prismaErr) {
                  console.error(`[DeployManager] Prisma setup failed for "${skillName}":`, prismaErr);
                  deployedProcess.status = 'build_failed';
                  this.publishStatus(skillName, 'build_failed');
                  continue;
                }
              }
            }
          } else if (projectType === 'python-fastapi') {
            const venvPython = getVenvPythonPath(projectPath);
            const venvOk = fsSync.existsSync(venvPython) && await isVenvUsable(projectPath);

            if (!venvOk) {
              console.log(`[DeployManager] Pre-built skill "${skillName}" has missing or broken .venv, reinstalling Python deps...`);
              deployedProcess.status = 'building';
              this.publishStatus(skillName, 'building');
              try {
                await this.ensurePythonDependencies(projectPath, (line) => {
                  deployedProcess.buildLogs.push(line);
                });
                deployedProcess.status = 'deployed';
              } catch (depErr) {
                console.error(`[DeployManager] Failed to install Python deps for pre-built skill "${skillName}":`, depErr);
                deployedProcess.status = 'build_failed';
                this.publishStatus(skillName, 'build_failed');
                continue;
              }
            }
          }
        }

        // Start production process (no build needed — already built)
        if (projectType === 'nextjs') {
          this.startNextjsProduction(skillName, projectPath, port, deployedProcess);
        } else {
          this.startPythonProduction(skillName, projectPath, port, deployedProcess);
        }

        // Update project record so Secretary_Skill_Caller can resolve the port
        await this.updateProjectRecord(skillName, port);

        // Persist updated status & port (in case port changed)
        await this.persistDeployStatus(skillName, 'deployed', port, meta.buildTimestamp);

        console.log(`[DeployManager] Auto-started "${skillName}" on port ${port}`);
      } catch (err) {
        console.error(`[DeployManager] Failed to auto-start "${skillName}":`, err);
        // Continue with remaining skills
      }
    }
  }

  /**
   * Stop all running deployed Skill App processes.
   *
   * Called during application shutdown to ensure every production process is
   * cleanly terminated.  Errors for individual skills are logged but do not
   * prevent the remaining skills from being stopped.
   */
  async stopAll(): Promise<void> {
    const skillNames = Array.from(this.processes.keys());
    if (skillNames.length === 0) return;

    console.log(`[DeployManager] Stopping all ${skillNames.length} deployed process(es)…`);

    for (const skillName of skillNames) {
      try {
        await this.stop(skillName);
      } catch (err) {
        console.error(`[DeployManager] Failed to stop "${skillName}":`, err);
      }
    }

    console.log('[DeployManager] All deployed processes stopped');
  }
}

// ---------------------------------------------------------------------------
// Global singleton (same pattern as PreviewManager)
// ---------------------------------------------------------------------------

const globalDeployManager = globalThis as unknown as {
  __claudable_deploy_manager__?: DeployManager;
};

export const deployManager: DeployManager =
  globalDeployManager.__claudable_deploy_manager__ ??
  (globalDeployManager.__claudable_deploy_manager__ = new DeployManager());

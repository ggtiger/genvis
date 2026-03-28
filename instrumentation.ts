/**
 * Next.js Instrumentation - runs once when the server starts
 * Used to trigger proactive initialization (e.g., skill auto-start)
 */
export async function register() {
  // Only run on the server (not during build or on edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Kill stale skill preview processes from previous runs
    // This prevents orphaned next-server processes from accumulating
    await killStaleSkillProcesses();

    // Eagerly initialize critical modules at startup to avoid cold-start delay
    // on the first API request. In dev mode, Next.js JIT-compiles modules on
    // first import; pre-importing here moves that cost to server startup.
    await import('@/lib/db/client');
    await import('@/lib/services/message');
    await import('@/lib/services/project');

    const { initializeSkillsOnStartup } = await import('@/lib/services/skill-service');
    // Trigger skill initialization which includes auto-starting marked skills
    initializeSkillsOnStartup().catch(error => {
      console.error('[Instrumentation] Failed to initialize skills on startup:', error);
    });

    // Initialize IM channel connections (Stream platforms) and validate Webhook configs
    const { initIMChannels } = await import('@/lib/services/im/im-init');
    initIMChannels().catch(error => {
      console.error('[Instrumentation] Failed to initialize IM channels:', error);
    });

    // Initialize LAN Peer Chat (discovery + WebSocket) if enabled
    const { initLanPeerManager } = await import('@/lib/services/lan-peer/manager');
    initLanPeerManager().catch(error => {
      console.error('[Instrumentation] Failed to initialize LAN peer manager:', error);
    });

    // Initialize Secretary Scheduler for scheduled messages
    const { startSecretaryScheduler } = await import('@/lib/services/secretary-scheduler');
    startSecretaryScheduler();

    // Register cleanup handlers to stop all preview child processes on exit
    let cleaningUp = false;
    const cleanup = async () => {
      if (cleaningUp) return;
      cleaningUp = true;
      console.log('[Instrumentation] Cleaning up child processes...');

      // Stop secretary scheduler first
      try {
        const { stopSecretaryScheduler } = await import('@/lib/services/secretary-scheduler');
        stopSecretaryScheduler();
        console.log('[Instrumentation] Secretary scheduler stopped');
      } catch (error) {
        console.error('[Instrumentation] Scheduler stop error:', error);
      }
      try {
        const { deployManager } = await import('@/lib/services/deploy-manager');
        await deployManager.stopAll();
        console.log('[Instrumentation] Deployed processes cleaned up');
      } catch (error) {
        console.error('[Instrumentation] Deploy cleanup error:', error);
      }
      try {
        const { previewManager } = await import('@/lib/services/preview');
        await previewManager.stopAll();
        console.log('[Instrumentation] Preview processes cleaned up');
      } catch (error) {
        console.error('[Instrumentation] Preview cleanup error:', error);
      }
      try {
        const { connectionManager } = await import('@/lib/services/im/connection-manager');
        connectionManager.stopHealthCheck();
        await connectionManager.disconnectAll();
        console.log('[Instrumentation] IM connections cleaned up');
      } catch (error) {
        console.error('[Instrumentation] IM cleanup error:', error);
      }
      try {
        const { getLanPeerManager } = await import('@/lib/services/lan-peer/manager');
        const mgr = getLanPeerManager();
        if (mgr) {
          await mgr.stop();
          console.log('[Instrumentation] LAN peer manager cleaned up');
        }
      } catch (error) {
        console.error('[Instrumentation] LAN peer cleanup error:', error);
      }
      process.exit();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
}

/**
 * Kill any leftover skill preview processes from previous runs.
 * Finds processes (next-server, uvicorn, python, node) whose working directory
 * is inside a skills directory and kills them.
 */
async function killStaleSkillProcesses(): Promise<void> {
  if (process.platform === 'win32') return;

  try {
    const { execSync } = await import(/* webpackIgnore: true */ 'child_process');
    const path = await import(/* webpackIgnore: true */ 'path');

    const skillsDirs = [
      path.join(process.cwd(), 'skills'),
    ];
    const userSkillsDir = process.env.USER_SKILLS_DIR;
    if (userSkillsDir) skillsDirs.push(userSkillsDir);
    const homeDir = process.env.HOME || '';
    if (homeDir) {
      skillsDirs.push(path.join(homeDir, 'Library', 'Application Support', 'Jenvis', 'user-skills'));
    }

    const pidsToKill = new Set<string>();
    const myPid = String(process.pid);
    const myPpid = String(process.ppid);

    // Single lsof call to find ALL processes whose cwd is inside any skills dir.
    // `+D dir` is recursive but too slow; instead grep the `cwd` file descriptors.
    // We get all processes with cwd type, then filter by path.
    try {
      const output = execSync(
        `lsof -d cwd -Fpn 2>/dev/null || true`,
        { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }
      );

      // Parse lsof -Fpn output: lines starting with 'p' = PID, 'n' = path
      let currentPid = '';
      for (const line of output.split('\n')) {
        if (line.startsWith('p')) {
          currentPid = line.slice(1);
        } else if (line.startsWith('n') && currentPid) {
          const cwdPath = line.slice(1);
          if (currentPid !== myPid && currentPid !== myPpid &&
              skillsDirs.some(dir => cwdPath.startsWith(dir))) {
            pidsToKill.add(currentPid);
          }
        }
      }
    } catch {
      // lsof failed, ignore
    }

    if (pidsToKill.size > 0) {
      const pidList = Array.from(pidsToKill).join(' ');
      console.log(`[Instrumentation] Killing ${pidsToKill.size} stale skill process(es): ${pidList}`);
      try {
        execSync(`kill -9 ${pidList} 2>/dev/null || true`, { timeout: 5000 });
        console.log('[Instrumentation] Stale processes killed');
      } catch {
        // Some may already be gone
      }
    } else {
      console.log('[Instrumentation] No stale skill processes found');
    }
  } catch (error) {
    console.warn('[Instrumentation] Failed to check for stale processes:', error);
  }
}

/**
 * Terminal Manager Service
 *
 * Manages terminal sessions with automatic fallback:
 * 1. Tries node-pty for full PTY support (resize, signals, etc.)
 * 2. Falls back to child_process with a shell pipe if node-pty is unavailable
 *
 * Uses a global singleton pattern via globalThis to survive Next.js hot reloads.
 */

import os from 'os';
import crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import type { IPty } from 'node-pty';

/**
 * Minimal interface matching the subset of IPty we actually use.
 * Both the real node-pty and our child_process wrapper implement this.
 */
export interface IPtyLike {
  onData(callback: (data: string) => void): { dispose(): void };
  onExit(callback: (e: { exitCode: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  pid: number;
}

export interface TerminalSession {
  id: string;
  pty: IPtyLike;
  cols: number;
  rows: number;
  cwd: string;
  createdAt: string;
}

export interface CreateSessionOptions {
  cols: number;
  rows: number;
  cwd?: string;
}

export type PtySpawner = (
  file: string,
  args: string[],
  options: {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: { [key: string]: string | undefined };
  }
) => IPtyLike;

export function getDefaultShell(): string {
  if (os.platform() === 'win32') {
    return 'powershell.exe';
  }
  // On macOS, prefer zsh (default since macOS Catalina)
  if (os.platform() === 'darwin') {
    return process.env.SHELL || '/bin/zsh';
  }
  return process.env.SHELL || '/bin/bash';
}

/**
 * Wraps a child_process.ChildProcess to match the IPtyLike interface.
 * Used as a fallback when node-pty is not available.
 *
 * On macOS/Linux, uses `script -q /dev/null <shell>` to allocate a real PTY
 * so that commands like `ls` correctly output CJK filenames instead of `?`.
 * Falls back to raw pipe mode on Windows or if `script` is unavailable.
 */
class ChildProcessPty implements IPtyLike {
  private proc: ChildProcess;
  private dataCallback: ((data: string) => void) | null = null;
  private lineBuffer = '';
  private usePtyWrapper: boolean;
  pid: number;

  constructor(shell: string, _args: string[], options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  }) {
    const platform = os.platform();
    // On macOS/Linux, wrap with `script` to get a real PTY allocation.
    // This makes programs like `ls` treat stdout as a terminal and output
    // UTF-8 filenames correctly instead of replacing them with `?`.
    this.usePtyWrapper = platform === 'darwin' || platform === 'linux';

    const env = {
      ...options.env,
      TERM: 'xterm-256color',
      // Inherit system locale; fall back to en_US.UTF-8 (guaranteed on macOS) to support CJK filenames
      LANG: options.env?.LANG || process.env.LANG || 'en_US.UTF-8',
      LC_ALL: options.env?.LC_ALL || process.env.LC_ALL || '',
      LC_CTYPE: options.env?.LC_CTYPE || process.env.LC_CTYPE || 'en_US.UTF-8',
    } as unknown as NodeJS.ProcessEnv;

    if (this.usePtyWrapper && platform === 'darwin') {
      console.log(`[ChildProcessPty] Spawning shell via script(1) PTY wrapper: ${shell}`);
      // macOS `script -q /dev/null <shell> -i` allocates a PTY
      this.proc = spawn('script', ['-q', '/dev/null', shell, '-i'], {
        cwd: options.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else if (this.usePtyWrapper && platform === 'linux') {
      console.log(`[ChildProcessPty] Spawning shell via script(1) PTY wrapper: ${shell}`);
      // Linux `script -qc "<shell> -i" /dev/null` allocates a PTY
      this.proc = spawn('script', ['-q', '-c', `${shell} -i`, '/dev/null'], {
        cwd: options.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      console.log(`[ChildProcessPty] Spawning shell in pipe mode: ${shell}`);
      this.proc = spawn(shell, [], {
        cwd: options.cwd,
        env: { ...env, TERM: 'dumb' },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    }

    this.pid = this.proc.pid ?? 0;
    console.log(`[ChildProcessPty] Shell process started with PID: ${this.pid}, ptyWrapper: ${this.usePtyWrapper}`);

    if (!this.usePtyWrapper) {
      // In raw pipe mode, show a synthetic prompt
      setTimeout(() => {
        this.emitData(`${options.cwd || '~'} $ `);
      }, 150);
    }
  }

  private emitData(data: string): void {
    if (this.dataCallback) {
      this.dataCallback(data);
    }
  }

  onData(callback: (data: string) => void): { dispose(): void } {
    this.dataCallback = callback;

    const { StringDecoder } = require('string_decoder');
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    if (this.usePtyWrapper) {
      // With script(1) PTY wrapper, the shell handles echo/prompt natively.
      // Just forward output as-is.
      const onStdout = (chunk: Buffer) => {
        const text = stdoutDecoder.write(chunk);
        if (text) callback(text);
      };
      const onStderr = (chunk: Buffer) => {
        const text = stderrDecoder.write(chunk);
        if (text) callback(text);
      };
      this.proc.stdout?.on('data', onStdout);
      this.proc.stderr?.on('data', onStderr);
      return {
        dispose: () => {
          this.dataCallback = null;
          this.proc.stdout?.off('data', onStdout);
          this.proc.stderr?.off('data', onStderr);
        },
      };
    }

    // Raw pipe mode: show synthetic prompt after output settles
    let promptTimer: ReturnType<typeof setTimeout> | null = null;
    const schedulePrompt = () => {
      if (promptTimer) clearTimeout(promptTimer);
      promptTimer = setTimeout(() => {
        callback('$ ');
      }, 100);
    };

    const onStdout = (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      if (text) callback(text);
      schedulePrompt();
    };
    const onStderr = (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      if (text) callback(text);
      schedulePrompt();
    };
    this.proc.stdout?.on('data', onStdout);
    this.proc.stderr?.on('data', onStderr);
    return {
      dispose: () => {
        if (promptTimer) clearTimeout(promptTimer);
        this.dataCallback = null;
        this.proc.stdout?.off('data', onStdout);
        this.proc.stderr?.off('data', onStderr);
      },
    };
  }

  onExit(callback: (e: { exitCode: number }) => void): { dispose(): void } {
    const handler = (code: number | null) => callback({ exitCode: code ?? 1 });
    this.proc.on('exit', handler);
    return {
      dispose: () => { this.proc.off('exit', handler); },
    };
  }

  write(data: string): void {
    if (this.usePtyWrapper) {
      // With script(1) PTY wrapper, the shell handles everything natively.
      // Just forward raw input directly.
      this.proc.stdin?.write(data);
      return;
    }

    // Raw pipe mode: manual line editing
    if (data === '\r' || data === '\n') {
      this.emitData('\r\n');
      const cmd = this.lineBuffer;
      this.lineBuffer = '';
      if (cmd.length > 0) {
        this.proc.stdin?.write(cmd + '\n');
      } else {
        this.emitData('$ ');
      }
    } else if (data === '\x7f' || data === '\b') {
      if (this.lineBuffer.length > 0) {
        const removed = this.lineBuffer[this.lineBuffer.length - 1];
        this.lineBuffer = this.lineBuffer.slice(0, -1);
        const isCJK = removed && /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/.test(removed);
        if (isCJK) {
          this.emitData('\b \b\b \b');
        } else {
          this.emitData('\b \b');
        }
      }
    } else if (data === '\x03') {
      this.lineBuffer = '';
      this.emitData('^C\r\n$ ');
    } else if (data === '\x04') {
      if (this.lineBuffer.length === 0) {
        this.proc.stdin?.end();
      }
    } else if (data.length > 0 && data.charCodeAt(0) >= 32) {
      this.lineBuffer += data;
      this.emitData(data);
    }
  }

  resize(_cols: number, _rows: number): void {
    // child_process does not support resize — no-op
  }

  kill(): void {
    try { this.proc.kill(); } catch { /* ignore */ }
  }
}

/**
 * Attempts to create a node-pty spawner. Returns null if node-pty
 * cannot be loaded or fails a smoke-test spawn.
 */
function tryNodePtySpawner(): PtySpawner | null {
  try {
    const pty = require('node-pty') as typeof import('node-pty');
    // Smoke test: try to spawn and immediately kill
    const shell = getDefaultShell();
    const test = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: process.env as Record<string, string>,
    });
    test.kill();
    console.log('[TerminalManager] node-pty available');
    return pty.spawn as unknown as PtySpawner;
  } catch (e) {
    console.warn('[TerminalManager] node-pty unavailable, using child_process fallback:', (e as Error).message);
    return null;
  }
}

/**
 * Creates a child_process-based spawner as fallback.
 */
function childProcessSpawner(): PtySpawner {
  return (file, args, options) => {
    return new ChildProcessPty(file, args, {
      cwd: options.cwd,
      env: options.env as Record<string, string | undefined>,
    });
  };
}

/**
 * Resolves the best available spawner: node-pty if it works, otherwise child_process.
 */
function getDefaultSpawner(): PtySpawner {
  return tryNodePtySpawner() ?? childProcessSpawner();
}

export class TerminalManager {
  private sessions: Map<string, TerminalSession> = new Map();
  private spawner: PtySpawner;

  constructor(spawner?: PtySpawner) {
    this.spawner = spawner || getDefaultSpawner();
  }

  createSession(options: CreateSessionOptions): TerminalSession {
    const id = crypto.randomUUID();
    const cwd = options.cwd || os.homedir();
    const shell = getDefaultShell();

    console.log(`[TerminalManager] Creating session ${id} with shell: ${shell}, cwd: ${cwd}`);

    // Ensure locale settings for UTF-8 support (critical for packaged Electron apps
    // launched from Finder, which don't inherit user's shell locale)
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8',
    } as { [key: string]: string };

    const ptyProcess = this.spawner(shell, [], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd,
      env,
    });

    const session: TerminalSession = {
      id,
      pty: ptyProcess,
      cols: options.cols,
      rows: options.rows,
      cwd,
      createdAt: new Date().toISOString(),
    };

    // Add debug logging for PTY events
    session.pty.onData((data) => {
      console.log(`[TerminalManager] Session ${id} received data:`, data.substring(0, 100));
    });

    session.pty.onExit((e) => {
      console.log(`[TerminalManager] Session ${id} exited with code:`, e.exitCode);
    });

    this.sessions.set(id, session);
    console.log(`[TerminalManager] Session ${id} created successfully`);
    return session;
  }

  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  writeToSession(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    session.pty.write(data);
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    const clampedCols = Math.max(1, Math.min(500, Math.round(cols)));
    const clampedRows = Math.max(1, Math.min(200, Math.round(rows)));
    session.pty.resize(clampedCols, clampedRows);
    session.cols = clampedCols;
    session.rows = clampedRows;
  }

  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    try { session.pty.kill(); } catch { /* ignore */ }
    this.sessions.delete(sessionId);
  }

  destroyAllSessions(): void {
    for (const [sessionId] of this.sessions) {
      try { this.destroySession(sessionId); } catch { /* ignore */ }
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
}

const globalForTerminal = globalThis as typeof globalThis & {
  __terminalManager?: TerminalManager;
  __terminalManagerVersion?: number;
};

// Bump this version to force re-creation on hot reload
const MANAGER_VERSION = 4;

// Always recreate if version changed (handles hot reload with code changes)
if (!globalForTerminal.__terminalManager || globalForTerminal.__terminalManagerVersion !== MANAGER_VERSION) {
  if (globalForTerminal.__terminalManager) {
    try { globalForTerminal.__terminalManager.destroyAllSessions(); } catch { /* ignore */ }
  }
  globalForTerminal.__terminalManager = new TerminalManager();
  globalForTerminal.__terminalManagerVersion = MANAGER_VERSION;
}

export const terminalManager: TerminalManager = globalForTerminal.__terminalManager;
export default terminalManager;

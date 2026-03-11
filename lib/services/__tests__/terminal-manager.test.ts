/**
 * Unit tests for TerminalManager service.
 *
 * Tests session lifecycle: create, get, write, resize, destroy.
 * Uses a mock PTY spawner to test the TerminalManager logic without
 * requiring actual PTY process spawning (which may not be available
 * in all environments, e.g., CI or sandboxed test runners).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TerminalManager, getDefaultShell, type PtySpawner } from '../terminal-manager';
import type { IPty } from 'node-pty';
import os from 'os';

/**
 * Creates a mock IPty object that tracks method calls.
 */
function createMockPty(overrides?: Partial<IPty>): IPty {
  let currentCols = 80;
  let currentRows = 24;

  const mockPty: IPty = {
    pid: Math.floor(Math.random() * 100000) + 1000,
    get cols() { return currentCols; },
    get rows() { return currentRows; },
    process: 'mock-shell',
    handleFlowControl: false,
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    resize: vi.fn((cols: number, rows: number) => {
      currentCols = cols;
      currentRows = rows;
    }),
    clear: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    ...overrides,
  };

  return mockPty;
}

/**
 * Creates a mock PtySpawner that returns mock IPty instances.
 */
function createMockSpawner(): { spawner: PtySpawner; calls: Array<{ file: string; args: string[]; options: any }> } {
  const calls: Array<{ file: string; args: string[]; options: any }> = [];

  const spawner: PtySpawner = (file, args, options) => {
    calls.push({ file, args, options });
    return createMockPty();
  };

  return { spawner, calls };
}

describe('TerminalManager', () => {
  let manager: TerminalManager;

  afterEach(() => {
    if (manager) {
      manager.destroyAllSessions();
    }
  });

  describe('getDefaultShell', () => {
    it('should return a non-empty string', () => {
      const shell = getDefaultShell();
      expect(shell).toBeTruthy();
      expect(typeof shell).toBe('string');
    });

    it('should return powershell.exe on Windows or a unix shell otherwise', () => {
      const shell = getDefaultShell();
      if (os.platform() === 'win32') {
        expect(shell).toBe('powershell.exe');
      } else {
        // On unix-like systems, should be a path or shell name
        expect(shell.length).toBeGreaterThan(0);
      }
    });
  });

  describe('createSession', () => {
    it('should create a session with a unique id', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      expect(session.id).toBeTruthy();
      expect(typeof session.id).toBe('string');
      expect(session.id.length).toBeGreaterThan(0);
    });

    it('should set cols and rows from options', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 120, rows: 40 });

      expect(session.cols).toBe(120);
      expect(session.rows).toBe(40);
    });

    it('should default cwd to user home directory', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      expect(session.cwd).toBe(os.homedir());
    });

    it('should use provided cwd when specified', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const cwd = os.tmpdir();
      const session = manager.createSession({ cols: 80, rows: 24, cwd });

      expect(session.cwd).toBe(cwd);
    });

    it('should set createdAt as a valid ISO timestamp', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const before = new Date().toISOString();
      const session = manager.createSession({ cols: 80, rows: 24 });
      const after = new Date().toISOString();

      expect(session.createdAt).toBeTruthy();
      expect(session.createdAt >= before).toBe(true);
      expect(session.createdAt <= after).toBe(true);
    });

    it('should have a valid PTY process', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      expect(session.pty).toBeTruthy();
      expect(typeof session.pty.pid).toBe('number');
      expect(session.pty.pid).toBeGreaterThan(0);
    });

    it('should create sessions with unique ids', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session1 = manager.createSession({ cols: 80, rows: 24 });
      const session2 = manager.createSession({ cols: 80, rows: 24 });

      expect(session1.id).not.toBe(session2.id);
    });

    it('should pass correct options to the PTY spawner', () => {
      const { spawner, calls } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const cwd = '/tmp/test';
      manager.createSession({ cols: 100, rows: 50, cwd });

      expect(calls).toHaveLength(1);
      expect(calls[0].options.cols).toBe(100);
      expect(calls[0].options.rows).toBe(50);
      expect(calls[0].options.cwd).toBe(cwd);
      expect(calls[0].options.name).toBe('xterm-256color');
      expect(calls[0].options.env).toBeDefined();
    });

    it('should spawn the correct shell for the platform', () => {
      const { spawner, calls } = createMockSpawner();
      manager = new TerminalManager(spawner);
      manager.createSession({ cols: 80, rows: 24 });

      const expectedShell = getDefaultShell();
      expect(calls[0].file).toBe(expectedShell);
    });
  });

  describe('getSession', () => {
    it('should return the session for a valid id', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });
      const retrieved = manager.getSession(session.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(session.id);
    });

    it('should return undefined for an unknown id', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const retrieved = manager.getSession('nonexistent-id');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('writeToSession', () => {
    it('should call pty.write with the provided data', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      manager.writeToSession(session.id, 'echo hello\n');

      expect(session.pty.write).toHaveBeenCalledWith('echo hello\n');
    });

    it('should throw when writing to a nonexistent session', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);

      expect(() => manager.writeToSession('nonexistent', 'data')).toThrow(
        'Terminal session not found: nonexistent'
      );
    });
  });

  describe('resizeSession', () => {
    it('should update session cols and rows', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      manager.resizeSession(session.id, 120, 40);

      const updated = manager.getSession(session.id);
      expect(updated!.cols).toBe(120);
      expect(updated!.rows).toBe(40);
    });

    it('should call pty.resize with clamped values', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      manager.resizeSession(session.id, 120, 40);

      expect(session.pty.resize).toHaveBeenCalledWith(120, 40);
    });

    it('should clamp cols to maximum 500', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      manager.resizeSession(session.id, 999, 24);

      const updated = manager.getSession(session.id);
      expect(updated!.cols).toBe(500);
      expect(session.pty.resize).toHaveBeenCalledWith(500, 24);
    });

    it('should clamp rows to maximum 200', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      manager.resizeSession(session.id, 80, 999);

      const updated = manager.getSession(session.id);
      expect(updated!.rows).toBe(200);
      expect(session.pty.resize).toHaveBeenCalledWith(80, 200);
    });

    it('should clamp cols to minimum 1', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      manager.resizeSession(session.id, 0, 24);

      const updated = manager.getSession(session.id);
      expect(updated!.cols).toBe(1);
      expect(session.pty.resize).toHaveBeenCalledWith(1, 24);
    });

    it('should clamp rows to minimum 1', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      manager.resizeSession(session.id, 80, -5);

      const updated = manager.getSession(session.id);
      expect(updated!.rows).toBe(1);
      expect(session.pty.resize).toHaveBeenCalledWith(80, 1);
    });

    it('should round fractional values', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      manager.resizeSession(session.id, 80.7, 24.3);

      const updated = manager.getSession(session.id);
      expect(updated!.cols).toBe(81);
      expect(updated!.rows).toBe(24);
    });

    it('should throw when resizing a nonexistent session', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);

      expect(() => manager.resizeSession('nonexistent', 80, 24)).toThrow(
        'Terminal session not found: nonexistent'
      );
    });
  });

  describe('destroySession', () => {
    it('should remove the session from the manager', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      manager.destroySession(session.id);

      expect(manager.getSession(session.id)).toBeUndefined();
    });

    it('should call pty.kill on the session', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      manager.destroySession(session.id);

      expect(session.pty.kill).toHaveBeenCalled();
    });

    it('should throw when destroying a nonexistent session', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);

      expect(() => manager.destroySession('nonexistent')).toThrow(
        'Terminal session not found: nonexistent'
      );
    });

    it('should decrement session count', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      manager.createSession({ cols: 80, rows: 24 });
      const session2 = manager.createSession({ cols: 80, rows: 24 });

      expect(manager.sessionCount).toBe(2);

      manager.destroySession(session2.id);

      expect(manager.sessionCount).toBe(1);
    });

    it('should handle pty.kill throwing gracefully', () => {
      const mockPty = createMockPty({
        kill: vi.fn(() => { throw new Error('Process already dead'); }),
      });
      const spawner: PtySpawner = () => mockPty;
      manager = new TerminalManager(spawner);
      const session = manager.createSession({ cols: 80, rows: 24 });

      // Should not throw even if pty.kill throws
      expect(() => manager.destroySession(session.id)).not.toThrow();
      expect(manager.getSession(session.id)).toBeUndefined();
    });
  });

  describe('destroyAllSessions', () => {
    it('should remove all sessions', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      manager.createSession({ cols: 80, rows: 24 });
      manager.createSession({ cols: 80, rows: 24 });
      manager.createSession({ cols: 80, rows: 24 });

      expect(manager.sessionCount).toBe(3);

      manager.destroyAllSessions();

      expect(manager.sessionCount).toBe(0);
    });

    it('should be safe to call on an empty manager', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);

      expect(() => manager.destroyAllSessions()).not.toThrow();
      expect(manager.sessionCount).toBe(0);
    });

    it('should continue cleanup even if one session kill fails', () => {
      let callCount = 0;
      const spawner: PtySpawner = () => {
        callCount++;
        if (callCount === 2) {
          return createMockPty({
            kill: vi.fn(() => { throw new Error('Kill failed'); }),
          });
        }
        return createMockPty();
      };
      manager = new TerminalManager(spawner);
      manager.createSession({ cols: 80, rows: 24 });
      manager.createSession({ cols: 80, rows: 24 }); // This one will fail to kill
      manager.createSession({ cols: 80, rows: 24 });

      expect(manager.sessionCount).toBe(3);

      manager.destroyAllSessions();

      expect(manager.sessionCount).toBe(0);
    });
  });

  describe('sessionCount', () => {
    it('should start at 0', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      expect(manager.sessionCount).toBe(0);
    });

    it('should increment when sessions are created', () => {
      const { spawner } = createMockSpawner();
      manager = new TerminalManager(spawner);
      manager.createSession({ cols: 80, rows: 24 });
      expect(manager.sessionCount).toBe(1);

      manager.createSession({ cols: 80, rows: 24 });
      expect(manager.sessionCount).toBe(2);
    });
  });
});

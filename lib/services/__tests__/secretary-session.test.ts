import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  loadSession,
  saveSession,
  clearSession,
  type SecretarySession,
  type SecretaryMessage,
} from '../secretary-session';

/**
 * Unit tests for secretary session service.
 * Validates: Requirements 5.3
 *
 * Tests cover:
 * - Loading a session from file
 * - Saving a session to file
 * - Clearing a session
 * - Graceful handling of corrupted/missing files
 */

// Use a temp directory for test isolation
const TEST_DATA_DIR = path.join(process.cwd(), 'data', '__test-secretary-session__');
const SESSION_FILE = path.join(TEST_DATA_DIR, 'secretary-session.json');

describe('secretary-session service', () => {
  beforeEach(async () => {
    // Point SETTINGS_DIR to our test directory
    vi.stubEnv('SETTINGS_DIR', TEST_DATA_DIR);
    // Ensure test directory exists
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    // Clean up test directory
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('loadSession', () => {
    it('should return an empty session when no file exists', async () => {
      const session = await loadSession();

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(typeof session.id).toBe('string');
      expect(session.id.length).toBeGreaterThan(0);
      expect(session.messages).toEqual([]);
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    it('should return a valid session when file exists with valid data', async () => {
      const existingSession: SecretarySession = {
        id: 'test-session-id',
        messages: [
          {
            role: 'user',
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
          {
            role: 'assistant',
            content: 'Hi there!',
            timestamp: '2024-01-01T00:00:01.000Z',
          },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
      };

      await fs.writeFile(SESSION_FILE, JSON.stringify(existingSession, null, 2), 'utf-8');

      const session = await loadSession();

      expect(session.id).toBe('test-session-id');
      expect(session.messages).toHaveLength(2);
      expect(session.messages[0].role).toBe('user');
      expect(session.messages[0].content).toBe('Hello');
      expect(session.messages[1].role).toBe('assistant');
      expect(session.messages[1].content).toBe('Hi there!');
    });

    it('should return an empty session when file contains invalid JSON', async () => {
      await fs.writeFile(SESSION_FILE, 'not valid json {{{', 'utf-8');

      const session = await loadSession();

      expect(session).toBeDefined();
      expect(session.messages).toEqual([]);
      expect(session.id).toBeDefined();
    });

    it('should return an empty session when file contains valid JSON but wrong shape', async () => {
      await fs.writeFile(SESSION_FILE, JSON.stringify({ foo: 'bar' }), 'utf-8');

      const session = await loadSession();

      expect(session).toBeDefined();
      expect(session.messages).toEqual([]);
      expect(session.id).toBeDefined();
    });

    it('should return an empty session when file contains null', async () => {
      await fs.writeFile(SESSION_FILE, 'null', 'utf-8');

      const session = await loadSession();

      expect(session).toBeDefined();
      expect(session.messages).toEqual([]);
    });
  });

  describe('saveSession', () => {
    it('should save a session to file', async () => {
      const session: SecretarySession = {
        id: 'save-test-id',
        messages: [
          {
            role: 'user',
            content: 'Test message',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      await saveSession(session);

      const raw = await fs.readFile(SESSION_FILE, 'utf-8');
      const saved = JSON.parse(raw) as SecretarySession;

      expect(saved.id).toBe('save-test-id');
      expect(saved.messages).toHaveLength(1);
      expect(saved.messages[0].content).toBe('Test message');
    });

    it('should update the updatedAt timestamp on save', async () => {
      const session: SecretarySession = {
        id: 'timestamp-test',
        messages: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      await saveSession(session);

      const raw = await fs.readFile(SESSION_FILE, 'utf-8');
      const saved = JSON.parse(raw) as SecretarySession;

      // updatedAt should be more recent than the original
      expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(
        new Date('2024-01-01T00:00:00.000Z').getTime()
      );
      // createdAt should remain unchanged
      expect(saved.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should create the directory if it does not exist', async () => {
      // Remove the test directory
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });

      const session: SecretarySession = {
        id: 'mkdir-test',
        messages: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      await saveSession(session);

      const raw = await fs.readFile(SESSION_FILE, 'utf-8');
      const saved = JSON.parse(raw) as SecretarySession;
      expect(saved.id).toBe('mkdir-test');
    });

    it('should preserve messages with actions', async () => {
      const session: SecretarySession = {
        id: 'actions-test',
        messages: [
          {
            role: 'assistant',
            content: 'I created a todo for you',
            actions: [
              {
                type: 'skill_call',
                skillName: 'productivity-hub',
                endpoint: '/api/todos',
                result: { id: 1, title: 'Test todo' },
              },
            ],
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      await saveSession(session);

      const raw = await fs.readFile(SESSION_FILE, 'utf-8');
      const saved = JSON.parse(raw) as SecretarySession;

      expect(saved.messages[0].actions).toHaveLength(1);
      expect(saved.messages[0].actions![0].type).toBe('skill_call');
      expect(saved.messages[0].actions![0].skillName).toBe('productivity-hub');
    });
  });

  describe('clearSession', () => {
    it('should delete the session file', async () => {
      // Create a session file first
      await fs.writeFile(SESSION_FILE, JSON.stringify({ id: 'to-delete', messages: [], createdAt: '', updatedAt: '' }), 'utf-8');

      await clearSession();

      // Verify file no longer exists
      await expect(fs.access(SESSION_FILE)).rejects.toThrow();
    });

    it('should not throw when file does not exist', async () => {
      // Ensure file doesn't exist
      try {
        await fs.unlink(SESSION_FILE);
      } catch {
        // ignore
      }

      // Should not throw
      await expect(clearSession()).resolves.toBeUndefined();
    });
  });

  describe('round-trip: save then load', () => {
    it('should preserve session data through save and load', async () => {
      const messages: SecretaryMessage[] = [
        {
          role: 'user',
          content: '帮我创建一个待办事项',
          timestamp: '2024-06-15T10:00:00.000Z',
        },
        {
          role: 'assistant',
          content: '好的，已为您创建待办事项。',
          actions: [
            {
              type: 'skill_call',
              skillName: 'productivity-hub',
              endpoint: '/api/todos',
              result: { id: 1, title: '新待办' },
            },
          ],
          timestamp: '2024-06-15T10:00:01.000Z',
        },
        {
          role: 'user',
          content: '请让PPT助手帮我做一个演示文稿',
          timestamp: '2024-06-15T10:01:00.000Z',
        },
        {
          role: 'assistant',
          content: '已将任务分配给PPT制作助手。',
          actions: [
            {
              type: 'dispatch',
              employeeId: 'builtin-ppt',
              employeeName: 'PPT制作助手',
              projectId: 'proj-123',
            },
          ],
          timestamp: '2024-06-15T10:01:01.000Z',
        },
      ];

      const original: SecretarySession = {
        id: 'roundtrip-test',
        messages,
        createdAt: '2024-06-15T10:00:00.000Z',
        updatedAt: '2024-06-15T10:01:01.000Z',
      };

      await saveSession(original);
      const loaded = await loadSession();

      expect(loaded.id).toBe('roundtrip-test');
      expect(loaded.messages).toHaveLength(4);
      expect(loaded.messages[0].content).toBe('帮我创建一个待办事项');
      expect(loaded.messages[1].actions![0].type).toBe('skill_call');
      expect(loaded.messages[3].actions![0].type).toBe('dispatch');
      expect(loaded.messages[3].actions![0].employeeName).toBe('PPT制作助手');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadIMSession, saveIMSession, type IMSession } from '../im-session';

describe('im-session', () => {
  let tmpDir: string;
  let originalSettingsDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-session-test-'));
    originalSettingsDir = process.env.SETTINGS_DIR;
    process.env.SETTINGS_DIR = tmpDir;
  });

  afterEach(async () => {
    if (originalSettingsDir === undefined) {
      delete process.env.SETTINGS_DIR;
    } else {
      process.env.SETTINGS_DIR = originalSettingsDir;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadIMSession', () => {
    it('should return a new empty session when no file exists', async () => {
      const session = await loadIMSession('dingtalk', 'user123');

      expect(session.platform).toBe('dingtalk');
      expect(session.senderId).toBe('user123');
      expect(session.messages).toEqual([]);
      expect(session.id).toBeTruthy();
      expect(session.createdAt).toBeTruthy();
      expect(session.updatedAt).toBeTruthy();
    });

    it('should load an existing session from disk', async () => {
      const sessionData: IMSession = {
        id: 'test-id',
        platform: 'feishu',
        senderId: 'sender1',
        messages: [{ role: 'user', content: 'hello', timestamp: '2025-01-01T00:00:00Z' }],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      const dir = path.join(tmpDir, 'im-sessions', 'feishu');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'sender1.json'), JSON.stringify(sessionData));

      const loaded = await loadIMSession('feishu', 'sender1');
      expect(loaded.id).toBe('test-id');
      expect(loaded.platform).toBe('feishu');
      expect(loaded.senderId).toBe('sender1');
      expect(loaded.messages).toHaveLength(1);
      expect(loaded.messages[0].content).toBe('hello');
    });

    it('should return empty session for corrupted JSON', async () => {
      const dir = path.join(tmpDir, 'im-sessions', 'wechat');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'bad.json'), 'not valid json{{{');

      const session = await loadIMSession('wechat', 'bad');
      expect(session.platform).toBe('wechat');
      expect(session.senderId).toBe('bad');
      expect(session.messages).toEqual([]);
    });

    it('should return empty session for invalid structure', async () => {
      const dir = path.join(tmpDir, 'im-sessions', 'qq');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'invalid.json'), JSON.stringify({ foo: 'bar' }));

      const session = await loadIMSession('qq', 'invalid');
      expect(session.platform).toBe('qq');
      expect(session.senderId).toBe('invalid');
      expect(session.messages).toEqual([]);
    });
  });

  describe('saveIMSession', () => {
    it('should save session and create directories', async () => {
      const session: IMSession = {
        id: 'save-test',
        platform: 'wecom',
        senderId: 'user456',
        messages: [{ role: 'assistant', content: 'hi', timestamp: '2025-01-01T00:00:00Z' }],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      await saveIMSession(session);

      const filePath = path.join(tmpDir, 'im-sessions', 'wecom', 'user456.json');
      const raw = await fs.readFile(filePath, 'utf-8');
      const saved = JSON.parse(raw);

      expect(saved.id).toBe('save-test');
      expect(saved.platform).toBe('wecom');
      expect(saved.messages).toHaveLength(1);
    });

    it('should update updatedAt timestamp on save', async () => {
      const session: IMSession = {
        id: 'ts-test',
        platform: 'dingtalk',
        senderId: 'user789',
        messages: [],
        createdAt: '2020-01-01T00:00:00Z',
        updatedAt: '2020-01-01T00:00:00Z',
      };

      const before = new Date().toISOString();
      await saveIMSession(session);

      const filePath = path.join(tmpDir, 'im-sessions', 'dingtalk', 'user789.json');
      const saved = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      expect(saved.updatedAt >= before).toBe(true);
      expect(saved.createdAt).toBe('2020-01-01T00:00:00Z');
    });
  });

  describe('round-trip', () => {
    it('should save and load a session preserving all data', async () => {
      const session: IMSession = {
        id: 'round-trip',
        platform: 'feishu',
        senderId: 'rt-user',
        messages: [
          { role: 'user', content: 'question', timestamp: '2025-01-01T00:00:00Z' },
          { role: 'assistant', content: 'answer', timestamp: '2025-01-01T00:00:01Z' },
        ],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:01Z',
      };

      await saveIMSession(session);
      const loaded = await loadIMSession('feishu', 'rt-user');

      expect(loaded.id).toBe('round-trip');
      expect(loaded.platform).toBe('feishu');
      expect(loaded.senderId).toBe('rt-user');
      expect(loaded.messages).toHaveLength(2);
      expect(loaded.messages[0].content).toBe('question');
      expect(loaded.messages[1].content).toBe('answer');
    });

    it('should maintain session isolation across platforms', async () => {
      const session1: IMSession = {
        id: 'iso-1',
        platform: 'dingtalk',
        senderId: 'same-user',
        messages: [{ role: 'user', content: 'dingtalk msg', timestamp: '2025-01-01T00:00:00Z' }],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      const session2: IMSession = {
        id: 'iso-2',
        platform: 'feishu',
        senderId: 'same-user',
        messages: [{ role: 'user', content: 'feishu msg', timestamp: '2025-01-01T00:00:00Z' }],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      await saveIMSession(session1);
      await saveIMSession(session2);

      const loaded1 = await loadIMSession('dingtalk', 'same-user');
      const loaded2 = await loadIMSession('feishu', 'same-user');

      expect(loaded1.id).toBe('iso-1');
      expect(loaded2.id).toBe('iso-2');
      expect(loaded1.messages[0].content).toBe('dingtalk msg');
      expect(loaded2.messages[0].content).toBe('feishu msg');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateRule, checkAndPromoteRules } from '../rule-promoter';
import type { DispatchLearningValue } from '../correction-recorder';
import type { MemoryEntryV2 } from '../secretary-memory';
import { createEmptyMemory } from '../secretary-memory';

// ========== Mocks ==========

// Mock child_process.spawn to simulate Python subprocess
const mockStdin = { write: vi.fn(), end: vi.fn() };
const mockStderr = { on: vi.fn() };
const mockChild = {
  stdin: mockStdin,
  stderr: mockStderr,
  on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
    if (event === 'close') cb(0); // simulate success
  }),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

vi.mock('@/lib/utils/python', () => ({
  detectPython: vi.fn(async () => '/usr/bin/python3'),
}));

vi.mock('../secretary-memory', async () => {
  const actual = await vi.importActual<typeof import('../secretary-memory')>('../secretary-memory');
  return {
    ...actual,
    loadMemory: vi.fn(),
    saveMemory: vi.fn(),
  };
});

import { loadMemory, saveMemory } from '../secretary-memory';
import { spawn } from 'child_process';
import { detectPython } from '@/lib/utils/python';

const mockedLoadMemory = vi.mocked(loadMemory);
const mockedSaveMemory = vi.mocked(saveMemory);
const mockedSpawn = vi.mocked(spawn);
const mockedDetectPython = vi.mocked(detectPython);

// ========== Helpers ==========

function makeLearningValue(overrides?: Partial<DispatchLearningValue>): DispatchLearningValue {
  return {
    input: '帮我查天气',
    wrongAction: 'direct_reply',
    wrongActionType: 'direct_reply',
    correctAction: 'weather-skill',
    correctActionType: 'skill_call',
    ...overrides,
  };
}

function makeEntry(
  key: string,
  value: DispatchLearningValue,
  count: number,
  confidence: number = 0.8,
): MemoryEntryV2 {
  return {
    key,
    value: JSON.stringify(value),
    source: 'dispatch_correction',
    createdAt: '2025-01-15T00:00:00.000Z',
    updatedAt: '2025-01-15T00:00:00.000Z',
    count,
    confidence,
    lastAccessedAt: '2025-01-15T00:00:00.000Z',
    accessCount: 0,
    channel: 'web',
  };
}

// ========== Tests ==========

describe('generateRule', () => {
  it('generates a rule in the expected format', () => {
    const learning = makeLearningValue();
    const rule = generateRule(learning);
    expect(rule).toBe(
      '当用户请求涉及帮我查天气时，应使用 skill_call 调度给 weather-skill 而非使用 direct_reply 给 direct_reply',
    );
  });

  it('includes all fields from the learning value', () => {
    const learning = makeLearningValue({
      input: '翻译这段话',
      wrongAction: 'builtin-doc-processor',
      wrongActionType: 'dispatch',
      correctAction: '翻译员工',
      correctActionType: 'dispatch',
    });
    const rule = generateRule(learning);
    expect(rule).toContain('翻译这段话');
    expect(rule).toContain('dispatch');
    expect(rule).toContain('翻译员工');
    expect(rule).toContain('builtin-doc-processor');
  });

  it('handles unknown correctActionType', () => {
    const learning = makeLearningValue({ correctActionType: 'unknown' });
    const rule = generateRule(learning);
    expect(rule).toContain('unknown');
  });
});

describe('checkAndPromoteRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset spawn mock to simulate successful Python execution
    mockedSpawn.mockReturnValue(mockChild as any);
    mockChild.on.mockImplementation((event: string, cb: (arg?: unknown) => void) => {
      if (event === 'close') cb(0);
      return mockChild;
    });
    mockStderr.on.mockImplementation(() => mockStderr);
    mockedDetectPython.mockResolvedValue('/usr/bin/python3');
  });

  it('does nothing when no entries exist', async () => {
    const memory = createEmptyMemory();
    mockedLoadMemory.mockResolvedValue(memory);

    await checkAndPromoteRules();

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it('does not promote entries below threshold', async () => {
    const memory = createEmptyMemory();
    memory.dispatch_learnings = [
      makeEntry('帮我查天气', makeLearningValue(), 2),
    ];
    mockedLoadMemory.mockResolvedValue(memory);

    await checkAndPromoteRules(3);

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it('does not promote already promoted entries', async () => {
    const memory = createEmptyMemory();
    const value = makeLearningValue({ promotedToRule: true });
    memory.dispatch_learnings = [makeEntry('帮我查天气', value, 5)];
    mockedLoadMemory.mockResolvedValue(memory);

    await checkAndPromoteRules(3);

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it('skips entries with invalid JSON value', async () => {
    const memory = createEmptyMemory();
    memory.dispatch_learnings = [
      {
        key: 'bad-entry',
        value: 'not-valid-json',
        source: 'dispatch_correction',
        createdAt: '2025-01-15T00:00:00.000Z',
        updatedAt: '2025-01-15T00:00:00.000Z',
        count: 5,
        confidence: 0.8,
        lastAccessedAt: '2025-01-15T00:00:00.000Z',
        accessCount: 0,
        channel: 'web',
      },
    ];
    mockedLoadMemory.mockResolvedValue(memory);

    await checkAndPromoteRules(3);

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it('never throws even when loadMemory fails', async () => {
    mockedLoadMemory.mockRejectedValue(new Error('disk error'));

    await expect(checkAndPromoteRules()).resolves.toBeUndefined();
  });

  it('never throws even when saveMemory fails', async () => {
    const memory = createEmptyMemory();
    const value = makeLearningValue();
    memory.dispatch_learnings = [makeEntry('帮我查天气', value, 3)];
    mockedLoadMemory.mockResolvedValue(memory);
    mockedSaveMemory.mockRejectedValue(new Error('write error'));

    await expect(checkAndPromoteRules()).resolves.toBeUndefined();
  });

  it('uses default threshold of 3', async () => {
    const memory = createEmptyMemory();
    memory.dispatch_learnings = [
      makeEntry('帮我查天气', makeLearningValue(), 2),
    ];
    mockedLoadMemory.mockResolvedValue(memory);

    await checkAndPromoteRules(); // no threshold arg → default 3

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it('promotes entries at or above threshold and calls spawn + saveMemory', async () => {
    const memory = createEmptyMemory();
    const value = makeLearningValue();
    memory.dispatch_learnings = [makeEntry('帮我查天气', value, 3)];
    mockedLoadMemory.mockResolvedValue(memory);
    mockedSaveMemory.mockResolvedValue(undefined);

    await checkAndPromoteRules(3);

    // Should have called spawn (Python subprocess)
    expect(mockedSpawn).toHaveBeenCalled();
    // Should have passed rule data via stdin
    expect(mockStdin.write).toHaveBeenCalled();
    expect(mockStdin.end).toHaveBeenCalled();
    // Should have saved memory
    expect(mockedSaveMemory).toHaveBeenCalled();

    // Verify the saved memory has promotedToRule = true and confidence = 1.0
    const savedMemory = mockedSaveMemory.mock.calls[0][0] as any;
    const savedEntry = savedMemory.dispatch_learnings.find(
      (e: any) => e.key === '帮我查天气',
    );
    expect(savedEntry).toBeDefined();
    const savedValue = JSON.parse(savedEntry.value);
    expect(savedValue.promotedToRule).toBe(true);
    expect(savedEntry.confidence).toBe(1.0);
  });

  it('promotes multiple eligible entries', async () => {
    const memory = createEmptyMemory();
    memory.dispatch_learnings = [
      makeEntry('帮我查天气', makeLearningValue(), 3),
      makeEntry('翻译这段话', makeLearningValue({
        input: '翻译这段话',
        wrongAction: 'builtin-doc',
        wrongActionType: 'dispatch',
        correctAction: '翻译员工',
        correctActionType: 'dispatch',
      }), 5),
      makeEntry('低频请求', makeLearningValue({ input: '低频请求' }), 1),
    ];
    mockedLoadMemory.mockResolvedValue(memory);
    mockedSaveMemory.mockResolvedValue(undefined);

    await checkAndPromoteRules(3);

    // spawn called twice (once per eligible entry)
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
    expect(mockedSaveMemory).toHaveBeenCalled();
  });

  it('never throws when Python is not found', async () => {
    mockedDetectPython.mockResolvedValue(null);
    const memory = createEmptyMemory();
    const value = makeLearningValue();
    memory.dispatch_learnings = [makeEntry('帮我查天气', value, 3)];
    mockedLoadMemory.mockResolvedValue(memory);

    // Should not throw — never-throw pattern catches the error
    await expect(checkAndPromoteRules(3)).resolves.toBeUndefined();
  });
});

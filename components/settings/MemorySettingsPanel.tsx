'use client';

/**
 * Memory Settings Panel Component
 * 秘书记忆管理界面 - 查看、编辑、删除秘书的记忆条目
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */
import React, { useEffect, useState, useCallback } from 'react';

// ========== Types ==========

interface MemoryEntry {
  key: string;
  value: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  count?: number;
}

type MemoryCategory = 'user_profile' | 'learned_preference' | 'interaction_pattern';

interface MemoryData {
  version: 1;
  user_profile: MemoryEntry[];
  learned_preference: MemoryEntry[];
  interaction_pattern: MemoryEntry[];
  updatedAt: string;
}

// ========== Constants ==========

const CATEGORY_TABS: { key: MemoryCategory; label: string }[] = [
  { key: 'user_profile', label: '用户档案' },
  { key: 'learned_preference', label: '学习偏好' },
  { key: 'interaction_pattern', label: '交互模式' },
];

// ========== Component ==========

export function MemorySettingsPanel() {
  const [memory, setMemory] = useState<MemoryData | null>(null);
  const [activeTab, setActiveTab] = useState<MemoryCategory>('user_profile');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Fetch memory data on mount
  const fetchMemory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/memory');
      if (!response.ok) {
        throw new Error('获取记忆数据失败');
      }
      const result = await response.json();
      setMemory(result.data);
    } catch (err) {
      console.error('[MemorySettingsPanel] 加载失败:', err);
      setError('加载记忆数据失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemory();
  }, [fetchMemory]);

  // Handle inline edit save
  const handleSaveEdit = async (category: MemoryCategory, key: string) => {
    if (!editValue.trim()) return;
    try {
      const response = await fetch('/api/memory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, key, value: editValue.trim() }),
      });
      if (!response.ok) {
        throw new Error('更新失败');
      }
      const result = await response.json();
      setMemory(result.data);
      setEditingKey(null);
      setEditValue('');
    } catch (err) {
      console.error('[MemorySettingsPanel] 更新失败:', err);
      alert('更新记忆失败，请稍后重试');
    }
  };

  // Handle delete single entry
  const handleDelete = async (category: MemoryCategory, key: string) => {
    if (!window.confirm(`确定要删除这条记忆吗？\n键名: ${key}`)) return;
    try {
      const response = await fetch(
        `/api/memory?category=${encodeURIComponent(category)}&key=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new Error('删除失败');
      }
      await fetchMemory();
    } catch (err) {
      console.error('[MemorySettingsPanel] 删除失败:', err);
      alert('删除记忆失败，请稍后重试');
    }
  };

  // Handle clear all
  const handleClearAll = async () => {
    if (!window.confirm('确定要清除所有记忆吗？此操作不可撤销。')) return;
    try {
      const response = await fetch('/api/memory', { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('清除失败');
      }
      await fetchMemory();
    } catch (err) {
      console.error('[MemorySettingsPanel] 清除失败:', err);
      alert('清除记忆失败，请稍后重试');
    }
  };

  // Start editing an entry
  const startEdit = (entry: MemoryEntry) => {
    setEditingKey(entry.key);
    setEditValue(entry.value);
  };

  // Cancel editing
  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  // Format timestamp for display
  const formatTimestamp = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  // Get entries for the active tab
  const activeEntries: MemoryEntry[] = memory ? memory[activeTab] : [];

  return (
    <div className="p-6 space-y-6">
      {/* Title */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">秘书记忆管理</h3>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <span className="text-sm text-gray-500 dark:text-gray-400">加载中...</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Content */}
      {!loading && !error && memory && (
        <>
          {/* Category Tabs */}
          <div className="flex border-b border-gray-200/60 dark:border-white/15">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  cancelEdit();
                }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-gray-900 dark:border-white text-gray-900 dark:text-white'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300/60 dark:hover:border-white/15'
                }`}
              >
                {tab.label}
                {memory[tab.key].length > 0 && (
                  <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                    ({memory[tab.key].length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Entry List */}
          <div className="space-y-3">
            {activeEntries.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                暂无记忆条目
              </div>
            ) : (
              activeEntries.map((entry) => (
                <div
                  key={entry.key}
                  className="glass-card rounded-2xl p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Entry content */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {/* Key */}
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        {entry.key}
                        {entry.count !== undefined && (
                          <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                            (出现 {entry.count} 次)
                          </span>
                        )}
                      </div>

                      {/* Value - inline edit or display */}
                      {editingKey === entry.key ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(activeTab, entry.key);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            className="flex-1 rounded border border-gray-300/60 dark:border-white/15 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveEdit(activeTab, entry.key)}
                            className="px-2 py-1 text-xs text-white bg-gray-900 rounded hover:bg-gray-800 transition-colors"
                          >
                            保存
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300/60 dark:border-white/15 rounded hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-900 dark:text-white">{entry.value}</div>
                      )}

                      {/* Source */}
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        来源: {entry.source}
                      </div>

                      {/* Timestamp */}
                      <div className="text-xs text-gray-400 dark:text-gray-500">
                        更新时间: {formatTimestamp(entry.updatedAt)}
                      </div>
                    </div>

                    {/* Action buttons */}
                    {editingKey !== entry.key && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startEdit(entry)}
                          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/15 rounded transition-colors"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(activeTab, entry.key)}
                          className="px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Clear All Button */}
          <div className="pt-4 border-t border-gray-200/60 dark:border-white/15">
            <button
              onClick={handleClearAll}
              className="rounded-lg border border-red-300 bg-white/90 dark:bg-white/10 px-4 py-2 text-sm text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              清除所有记忆
            </button>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              此操作将清除秘书的所有记忆数据，包括用户档案、学习偏好和交互模式。
            </p>
          </div>
        </>
      )}
    </div>
  );
}

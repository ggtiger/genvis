"use client";

import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

/**
 * Soul Settings Panel
 *
 * Allows users to edit the secretary's personality (SOUL.md)
 * and their own profile (USER.md) — the "soul trio" concept
 * inspired by OpenClaw.
 */
export default function SoulSettings() {
  const [soul, setSoul] = useState('');
  const [user, setUser] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeFile, setActiveFile] = useState<'soul' | 'user'>('soul');

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/soul`);
      if (res.ok) {
        const data = await res.json();
        setSoul(data.soul || '');
        setUser(data.user || '');
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/settings/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soul, user }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: '保存成功，重启对话后生效' });
      } else {
        setMessage({ type: 'error', text: '保存失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400 text-sm">
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">灵魂设定</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            定义秘书的性格和你的用户画像，让 AI 从「通用助手」变成「你的助手」
          </p>
        </div>
        <div className="flex items-center gap-2">
          {message && (
            <span className={`text-xs ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {message.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm font-medium bg-slate-800 dark:bg-white/20 hover:bg-slate-700 dark:hover:bg-white/30 text-white dark:text-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? '保存...' : '保存'}
          </button>
        </div>
      </div>

      {/* File Tabs */}
      <div className="flex gap-1 p-1 bg-white/40 dark:bg-white/5 rounded-lg border border-gray-200/60 dark:border-white/10">
        <button
          onClick={() => setActiveFile('soul')}
          className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-all ${
            activeFile === 'soul'
              ? 'bg-white dark:bg-white/15 text-gray-900 dark:text-white font-medium shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          🪄 SOUL.md — 秘书性格
        </button>
        <button
          onClick={() => setActiveFile('user')}
          className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-all ${
            activeFile === 'user'
              ? 'bg-white dark:bg-white/15 text-gray-900 dark:text-white font-medium shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          👤 USER.md — 用户画像
        </button>
      </div>

      {/* Editor */}
      <div className="relative">
        <textarea
          value={activeFile === 'soul' ? soul : user}
          onChange={(e) => activeFile === 'soul' ? setSoul(e.target.value) : setUser(e.target.value)}
          placeholder={activeFile === 'soul'
            ? '# Secretary Soul\n\n## Personality\n- ...\n\n## Communication Style\n- ...'
            : '# About Me\n\n## Basic Info\n- Name: ...\n\n## Work\n- Current Projects: ...'}
          className="w-full h-[420px] px-4 py-3 text-sm font-mono leading-relaxed rounded-xl border border-gray-200/60 dark:border-white/10 bg-white/80 dark:bg-white/5 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          spellCheck={false}
        />
      </div>

      {/* Tips */}
      <div className="p-3 bg-white/40 dark:bg-white/5 rounded-lg border border-gray-200/60 dark:border-white/10">
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {activeFile === 'soul'
            ? '💡 写清楚秘书的性格特征、说话风格和行为边界。比如：「简洁直接，偶尔幽默」「不确定的事先问再做」「深夜不主动打扰」'
            : '💡 把自己介绍给秘书。写清楚你做什么工作、在做什么项目、喜欢什么沟通方式。写得越清楚，秘书越懂你。'}
        </p>
      </div>
    </div>
  );
}

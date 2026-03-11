'use client';

import { useState, useEffect } from 'react';
import type { LanPeerSettings as LanPeerSettingsType } from '@/lib/services/lan-peer/types';

const API_BASE = '';

export default function LanPeerSettings() {
  const [settings, setSettings] = useState<LanPeerSettingsType>({
    enabled: false,
    nodeName: '',
    wsPort: 41235,
    udpPort: 41234,
    exposedSkills: [],
    fileReceiveDir: 'data/lan-peer/files',
  });
  const [lanIp, setLanIp] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);

  useEffect(() => {
    // Load current settings
    fetch(`${API_BASE}/api/settings`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.lan_peer) {
          setSettings((prev) => ({ ...prev, ...data.lan_peer }));
        }
      })
      .catch(() => {});

    // Load LAN IP
    fetch(`${API_BASE}/api/network/lan-ip`)
      .then((r) => r.json())
      .then((data) => {
        if (data.data?.primaryIP) setLanIp(data.data.primaryIP);
      })
      .catch(() => {});

    // Load available skills
    fetch(`${API_BASE}/api/skills`)
      .then((r) => r.json())
      .then((data) => {
        if (data.data && Array.isArray(data.data)) {
          setAvailableSkills(data.data.map((s: any) => s.name));
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lan_peer: settings }),
      });
      if (res.ok) {
        setSaveMsg({ type: 'success', text: '保存成功' });
      } else {
        setSaveMsg({ type: 'error', text: '保存失败，请重试' });
      }
    } catch {
      setSaveMsg({ type: 'error', text: '保存失败，请重试' });
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(null), 3000);
  };

  const toggleSkill = (skillName: string) => {
    setSettings((prev) => ({
      ...prev,
      exposedSkills: prev.exposedSkills.includes(skillName)
        ? prev.exposedSkills.filter((s) => s !== skillName)
        : [...prev.exposedSkills, skillName],
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-text-main mb-4">局域网聊天</h3>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-text-main">启用局域网聊天</div>
          <div className="text-xs text-text-secondary">允许局域网内的其他秘书实例发现并连接本机</div>
        </div>
        <button
          onClick={() => setSettings((prev) => ({ ...prev, enabled: !prev.enabled }))}
          className={`relative w-11 h-6 rounded-full transition-colors ${settings.enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
        </button>
      </div>

      <div>
        <label className="text-sm font-medium text-text-main block mb-1">节点名称</label>
        <input
          type="text"
          value={settings.nodeName}
          onChange={(e) => setSettings((prev) => ({ ...prev, nodeName: e.target.value }))}
          placeholder="输入你的显示名称"
          className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-white dark:bg-slate-700 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium text-text-main block mb-1">LAN IP</label>
          <div className="px-3 py-2 rounded-lg bg-bg-subtle text-sm text-text-secondary">{lanIp || '检测中...'}</div>
        </div>
        <div>
          <label className="text-sm font-medium text-text-main block mb-1">WebSocket 端口</label>
          <input
            type="number"
            value={settings.wsPort}
            onChange={(e) => setSettings((prev) => ({ ...prev, wsPort: parseInt(e.target.value) || 41235 }))}
            className="w-24 px-3 py-2 rounded-lg border border-border-subtle bg-white dark:bg-slate-700 text-sm text-text-main focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-text-main block mb-2">对外暴露的技能</label>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {availableSkills.map((skill) => (
            <label key={skill} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.exposedSkills.includes(skill)}
                onChange={() => toggleSkill(skill)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-text-main">{skill}</span>
            </label>
          ))}
          {availableSkills.length === 0 && (
            <p className="text-xs text-text-secondary">暂无可用技能</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存设置'}
        </button>
        {saveMsg && (
          <span className={`text-xs ${saveMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
            {saveMsg.text}
          </span>
        )}
      </div>
    </div>
  );
}

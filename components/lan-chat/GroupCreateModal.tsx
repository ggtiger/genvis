'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { PeerInfo } from '@/lib/services/lan-peer/types';

interface GroupCreateModalProps {
  peers: PeerInfo[];
  selfInfo?: PeerInfo | null;
  onClose: () => void;
  onCreated: () => void;
}

export default function GroupCreateModal({ peers, selfInfo, onClose, onCreated }: GroupCreateModalProps) {
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>(() =>
    selfInfo ? [selfInfo.id] : []
  );
  const [creating, setCreating] = useState(false);

  const onlinePeers = peers.filter((p) => p.status === 'online');

  const toggleMember = (peerId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(peerId) ? prev.filter((id) => id !== peerId) : [...prev, peerId]
    );
  };

  const handleCreate = async () => {
    if (!name.trim() || selectedMembers.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch('/api/lan-peer/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), members: selectedMembers, enabledSkills: [], systemPrompt: systemPrompt.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success) onCreated();
    } catch { /* ignore */ }
    setCreating(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-[420px] max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-base font-semibold text-text-main">创建群组</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-text-main block mb-1">群组名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入群组名称"
              className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-white dark:bg-slate-700 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-text-main block mb-1">
              AI 提示词 <span className="text-xs text-text-secondary font-normal">(可选，自定义机器人人设)</span>
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={`设定 AI 助手的性格、行为规则和回复风格...
留空则使用默认提示词 + 设置页的 SOUL`}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-white dark:bg-slate-700 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-text-main block mb-2">选择成员</label>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {/* Self node always first */}
              {selfInfo && (
                <label
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedMembers.includes(selfInfo.id)}
                    onChange={() => toggleMember(selfInfo.id)}
                    className="rounded border-gray-300"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-main truncate">
                      {selfInfo.name} <span className="text-xs text-blue-500">(我)</span>
                    </div>
                    <div className="text-xs text-text-secondary">{selfInfo.ip}</div>
                  </div>
                </label>
              )}
              {onlinePeers.map((peer) => (
                <label
                  key={peer.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedMembers.includes(peer.id)}
                    onChange={() => toggleMember(peer.id)}
                    className="rounded border-gray-300"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-main truncate">{peer.name}</div>
                    <div className="text-xs text-text-secondary">{peer.ip}</div>
                  </div>
                </label>
              ))}
              {onlinePeers.length === 0 && !selfInfo && (
                <p className="text-xs text-text-secondary text-center py-4">暂无在线节点</p>
              )}
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-border-subtle flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-text-secondary">
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || selectedMembers.length === 0 || creating}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}

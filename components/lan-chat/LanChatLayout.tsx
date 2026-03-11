'use client';

import { useState, useEffect, useCallback } from 'react';
import PeerStatusBar from './PeerStatusBar';
import GroupList from './GroupList';
import GroupChatPanel from './GroupChatPanel';
import GroupCreateModal from './GroupCreateModal';
import type { ChatGroup, PeerInfo } from '@/lib/services/lan-peer/types';

const API_BASE = '';

export default function LanChatLayout() {
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [selfInfo, setSelfInfo] = useState<PeerInfo | null>(null);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Fetch local node info once on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/lan-peer/info`)
      .then((res) => res.json())
      .then((data) => { if (data.success) setSelfInfo(data.data); })
      .catch(() => {});
  }, []);

  const loadPeers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/lan-peer/peers`);
      const data = await res.json();
      if (data.success) setPeers(data.data || []);
    } catch { /* ignore */ }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/lan-peer/groups`);
      const data = await res.json();
      if (data.success) setGroups(data.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadPeers();
    loadGroups();
  }, [loadPeers, loadGroups]);

  // SSE for real-time updates
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/lan-peer/stream`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'peer_online':
          case 'peer_offline':
            loadPeers();
            break;
          case 'group_created':
          case 'group_updated':
            loadGroups();
            break;
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [loadPeers, loadGroups]);

  const handleGroupCreated = () => {
    setShowCreateModal(false);
    loadGroups();
  };

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) || null;

  return (
    <div className="flex h-full">
      {/* Left panel: peers + groups */}
      <div className="w-72 border-r border-white/10 flex flex-col">
        <PeerStatusBar peers={peers} selfInfo={selfInfo} />
        <div className="flex-1 overflow-y-auto">
          <GroupList
            groups={groups}
            selectedGroupId={selectedGroupId}
            onSelect={setSelectedGroupId}
            onCreate={() => setShowCreateModal(true)}
          />
        </div>
      </div>

      {/* Right panel: chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedGroup ? (
          <GroupChatPanel group={selectedGroup} peers={peers} />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-slate-500 dark:text-slate-400">
              <p className="text-5xl mb-4">💬</p>
              <p className="text-sm font-medium">选择一个群组开始聊天</p>
              <p className="text-xs mt-1 opacity-60">或创建一个新群组</p>
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <GroupCreateModal
          peers={peers}
          selfInfo={selfInfo}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleGroupCreated}
        />
      )}
    </div>
  );
}

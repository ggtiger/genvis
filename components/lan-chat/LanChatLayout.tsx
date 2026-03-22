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
  const [activeAIGroupIds, setActiveAIGroupIds] = useState<Set<string>>(new Set());

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
          case 'connected':
            // SSE reconnected — reset active AI indicators, then let
            // the subsequent ai_stream_start events (from active streams
            // sent on connection) re-populate only truly active groups.
            setActiveAIGroupIds(new Set());
            break;
          case 'peer_online':
          case 'peer_offline':
            loadPeers();
            break;
          case 'group_created':
          case 'group_updated':
            loadGroups();
            break;
          case 'group_deleted': {
            const deletedId = data.data?.groupId;
            if (deletedId) {
              setGroups((prev) => prev.filter((g) => g.id !== deletedId));
              setSelectedGroupId((prev) => (prev === deletedId ? null : prev));
            }
            break;
          }
          case 'ai_stream_start': {
            const gid = data.data?.groupId;
            if (gid) setActiveAIGroupIds((prev) => new Set(prev).add(gid));
            break;
          }
          case 'ai_stream_end': {
            const gid = data.data?.groupId;
            if (gid) setActiveAIGroupIds((prev) => {
              const next = new Set(prev);
              next.delete(gid);
              return next;
            });
            break;
          }
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [loadPeers, loadGroups]);

  const handleGroupCreated = () => {
    setShowCreateModal(false);
    loadGroups();
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/lan-peer/groups/${groupId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setGroups((prev) => prev.filter((g) => g.id !== groupId));
        if (selectedGroupId === groupId) setSelectedGroupId(null);
      }
    } catch { /* ignore */ }
  };

  const handleLeaveGroup = async (groupId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/lan-peer/groups/${groupId}/leave`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setGroups((prev) => prev.filter((g) => g.id !== groupId));
        if (selectedGroupId === groupId) setSelectedGroupId(null);
      }
    } catch { /* ignore */ }
  };

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) || null;

  return (
    <div className="flex h-full">
      {/* Left panel: peers + groups */}
      <div className="w-64 flex flex-col bg-white/20 dark:bg-white/[0.02] border-r border-white/10 dark:border-white/[0.04]">
        <PeerStatusBar peers={peers} selfInfo={selfInfo} />
        <div className="flex-1 overflow-y-auto">
          <GroupList
            groups={groups}
            selectedGroupId={selectedGroupId}
            activeGroupIds={activeAIGroupIds}
            localPeerId={selfInfo?.id}
            peers={peers}
            selfInfo={selfInfo}
            onSelect={setSelectedGroupId}
            onCreate={() => setShowCreateModal(true)}
            onDelete={handleDeleteGroup}
            onLeave={handleLeaveGroup}
          />
        </div>
      </div>

      {/* Right panel: chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedGroup ? (
          <GroupChatPanel key={selectedGroup.id} group={selectedGroup} peers={peers} selfInfo={selfInfo} onDeleteGroup={handleDeleteGroup} onLeaveGroup={handleLeaveGroup} />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/20 dark:bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">💬</span>
              </div>
              <p className="text-sm font-medium text-text-main/80">选择一个群组开始聊天</p>
              <p className="text-[11px] mt-1.5 text-text-secondary/50">或在左侧创建一个新群组</p>
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

'use client';

import type { PeerInfo } from '@/lib/services/lan-peer/types';

interface PeerStatusBarProps {
  peers: PeerInfo[];
  selfInfo?: PeerInfo | null;
}

export default function PeerStatusBar({ peers, selfInfo }: PeerStatusBarProps) {
  const online = peers.filter((p) => p.status === 'online');
  const offline = peers.filter((p) => p.status === 'offline');
  const totalOnline = online.length + (selfInfo ? 1 : 0);

  return (
    <div className="px-4 py-3 border-b border-border-subtle">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-text-secondary">在线节点</span>
        <span className="text-xs px-1.5 py-0.5 bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 rounded-full">
          {totalOnline}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* Self node always first */}
        {selfInfo && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 dark:bg-blue-500/10 rounded-lg border border-blue-200 dark:border-blue-500/30 text-xs"
            title={`${selfInfo.name} (${selfInfo.ip}) — 本机`}
          >
            <div className="w-2 h-2 rounded-full bg-blue-500 ring-1 ring-blue-300 dark:ring-blue-400/50" />
            <span className="text-text-main truncate max-w-[80px]">{selfInfo.name}</span>
            <span className="text-[10px] text-blue-500 dark:text-blue-400">(我)</span>
          </div>
        )}
        {online.map((peer) => (
          <div
            key={peer.id}
            className="flex items-center gap-1.5 px-2 py-1 bg-white/50 dark:bg-white/5 rounded-lg border border-border-subtle text-xs"
            title={`${peer.name} (${peer.ip})`}
          >
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-text-main truncate max-w-[80px]">{peer.name}</span>
          </div>
        ))}
        {offline.map((peer) => (
          <div
            key={peer.id}
            className="flex items-center gap-1.5 px-2 py-1 bg-white/30 dark:bg-white/5 rounded-lg border border-border-subtle text-xs opacity-50"
            title={`${peer.name} (离线)`}
          >
            <div className="w-2 h-2 rounded-full bg-gray-400" />
            <span className="text-text-secondary truncate max-w-[80px]">{peer.name}</span>
          </div>
        ))}
        {!selfInfo && peers.length === 0 && (
          <p className="text-xs text-text-secondary">暂未发现其他节点</p>
        )}
      </div>
    </div>
  );
}

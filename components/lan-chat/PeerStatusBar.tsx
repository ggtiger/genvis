'use client';

import { Wifi } from 'lucide-react';
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
    <div className="px-4 pt-4 pb-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Wifi className="w-3.5 h-3.5 text-green-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary/70">在线节点</span>
        <span className="text-[10px] min-w-[18px] text-center px-1 py-0.5 bg-green-500/15 text-green-600 dark:text-green-400 rounded-full font-medium">
          {totalOnline}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {selfInfo && (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/8 dark:bg-primary/10 rounded-full text-[11px] font-medium cursor-default"
            title={`${selfInfo.name} (${selfInfo.ip}) — 本机`}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <span className="text-text-main truncate max-w-[72px]">{selfInfo.name}</span>
            <span className="text-[9px] text-primary/70">(我)</span>
          </div>
        )}
        {online.map((peer) => (
          <div
            key={peer.id}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/40 dark:bg-white/[0.06] hover:bg-white/60 dark:hover:bg-white/10 rounded-full text-[11px] transition-colors cursor-default"
            title={`${peer.name} (${peer.ip})`}
          >
            <div className="w-2 h-2 rounded-full bg-green-500 ring-1 ring-green-400/30" />
            <span className="text-text-main truncate max-w-[72px]">{peer.name}</span>
          </div>
        ))}
        {offline.map((peer) => (
          <div
            key={peer.id}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] opacity-40 cursor-default"
            title={`${peer.name} (离线)`}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            <span className="text-text-secondary truncate max-w-[72px]">{peer.name}</span>
          </div>
        ))}
        {!selfInfo && peers.length === 0 && (
          <p className="text-[11px] text-text-secondary/60 py-1">暂未发现其他节点</p>
        )}
      </div>
    </div>
  );
}

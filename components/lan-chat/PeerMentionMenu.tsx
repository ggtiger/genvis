'use client';

import { useRef, useEffect } from 'react';
import { User, Users } from 'lucide-react';
import type { Employee } from '@/types/backend/employee';

export interface PeerInfo {
  id: string;
  name: string;
  ip: string;
  port: number;
  online?: boolean;
}

interface PeerMentionMenuProps {
  employees: Employee[];
  peers: PeerInfo[];
  query: string;
  onSelectEmployee: (employee: Employee) => void;
  onSelectPeer: (peer: PeerInfo) => void;
  position: { bottom: number; left: number };
  selectedIdx: number;
  activeGroup: '内部员工' | '外部同事';
  onGroupChange: (group: '内部员工' | '外部同事') => void;
}

export default function PeerMentionMenu({
  employees,
  peers,
  query,
  onSelectEmployee,
  onSelectPeer,
  position,
  selectedIdx,
  activeGroup,
  onGroupChange,
}: PeerMentionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const filteredEmployees = employees.filter(
    (e) => e.mode !== 'secretary' && e.name.toLowerCase().includes(query.toLowerCase())
  );
  const filteredPeers = peers.filter(
    (p) => p.name.toLowerCase().includes(query.toLowerCase())
  );

  const currentItems = activeGroup === '内部员工' ? filteredEmployees : filteredPeers;

  useEffect(() => {
    itemRefs.current[selectedIdx]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (currentItems.length === 0 && activeGroup === '内部员工' && filteredPeers.length === 0) return null;
  if (currentItems.length === 0 && activeGroup === '外部同事' && filteredEmployees.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="absolute z-50 w-72 max-h-64 bg-white/70 dark:bg-slate-800/80 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-xl shadow-lg overflow-hidden"
      style={{ bottom: position.bottom, left: position.left }}
    >
      {/* Group tabs */}
      <div className="flex border-b border-gray-200/60 dark:border-white/10">
        {(['内部员工', '外部同事'] as const).map((group) => (
          <button
            key={group}
            onMouseDown={(e) => { e.preventDefault(); onGroupChange(group); }}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
              activeGroup === group
                ? 'text-primary border-b-2 border-primary bg-primary/5'
                : 'text-text-secondary hover:text-text-main hover:bg-gray-50 dark:hover:bg-white/5'
            }`}
          >
            {group === '内部员工' ? <User className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
            {group}
            <span className="text-[10px] opacity-60">
              ({group === '内部员工' ? filteredEmployees.length : filteredPeers.length})
            </span>
          </button>
        ))}
      </div>

      {/* Items list */}
      <div className="max-h-48 overflow-y-auto py-1">
        {activeGroup === '内部员工' ? (
          filteredEmployees.length === 0 ? (
            <div className="px-3 py-4 text-xs text-text-secondary text-center">无匹配员工</div>
          ) : (
            filteredEmployees.map((emp, idx) => (
              <button
                key={emp.id}
                ref={(el) => { itemRefs.current[idx] = el; }}
                onMouseDown={(e) => { e.preventDefault(); onSelectEmployee(emp); }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-primary/5 transition-colors ${idx === selectedIdx ? 'bg-primary/5' : ''}`}
              >
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-main truncate">{emp.name}</div>
                  {emp.description && <div className="text-xs text-text-secondary truncate">{emp.description}</div>}
                </div>
                <span className="text-[10px] text-text-secondary px-1.5 py-0.5 bg-bg-subtle rounded">
                  {emp.mode === 'code' ? '编程' : '工作'}
                </span>
              </button>
            ))
          )
        ) : (
          filteredPeers.length === 0 ? (
            <div className="px-3 py-4 text-xs text-text-secondary text-center">无在线同事</div>
          ) : (
            filteredPeers.map((peer, idx) => (
              <button
                key={peer.id}
                ref={(el) => { itemRefs.current[idx] = el; }}
                onMouseDown={(e) => { e.preventDefault(); onSelectPeer(peer); }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-primary/5 transition-colors ${idx === selectedIdx ? 'bg-primary/5' : ''}`}
              >
                <div className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center flex-shrink-0">
                  <Users className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-main truncate">{peer.name}</div>
                  <div className="text-xs text-text-secondary truncate">{peer.ip}:{peer.port}</div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400">在线</span>
              </button>
            ))
          )
        )}
      </div>
    </div>
  );
}

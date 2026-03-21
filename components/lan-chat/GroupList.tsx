'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, MessageCircle, Users } from 'lucide-react';
import type { ChatGroup } from '@/lib/services/lan-peer/types';

interface GroupListProps {
  groups: ChatGroup[];
  selectedGroupId: string | null;
  activeGroupIds?: Set<string>;
  onSelect: (groupId: string) => void;
  onCreate: () => void;
  onDelete?: (groupId: string) => void;
}

export default function GroupList({ groups, selectedGroupId, activeGroupIds, onSelect, onCreate, onDelete }: GroupListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; groupId: string; groupName: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, group: ChatGroup) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, groupId: group.id, groupName: group.name });
  };

  return (
    <div className="px-3 pb-3">
      <div className="flex items-center justify-between mb-2 px-1 pt-3 pb-2 border-t border-white/10 dark:border-white/[0.04]">
        <div className="flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5 text-text-secondary/60" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary/70">群组</span>
        </div>
        <button
          onClick={onCreate}
          className="p-1.5 rounded-lg hover:bg-primary/10 text-primary/70 hover:text-primary transition-all"
          title="创建群组"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        {groups.map((group) => {
          const isActive = activeGroupIds?.has(group.id);
          return (
          <button
            key={group.id}
            onClick={() => onSelect(group.id)}
            onContextMenu={(e) => handleContextMenu(e, group)}
            className={`w-full text-left px-3 py-2.5 rounded-xl transition-all relative group/item ${
              selectedGroupId === group.id
                ? 'bg-white/50 dark:bg-white/[0.08] shadow-sm ring-1 ring-primary/20'
                : 'hover:bg-white/30 dark:hover:bg-white/[0.04] text-text-main'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {/* Group avatar */}
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold ${
                selectedGroupId === group.id
                  ? 'bg-primary/15 text-primary'
                  : 'bg-white/40 dark:bg-white/[0.06] text-text-secondary group-hover/item:bg-white/60 dark:group-hover/item:bg-white/10'
              }`}>
                {isActive ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500" />
                  </span>
                ) : (
                  <Users className="w-4 h-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] font-medium truncate ${
                  selectedGroupId === group.id ? 'text-primary' : ''
                }`}>{group.name}</div>
                <div className="text-[11px] text-text-secondary/70 mt-0.5 flex items-center gap-1">
                  <span>{group.members.length} 位成员</span>
                  {group.enabledSkills.length > 0 && (
                    <>
                      <span className="text-text-secondary/30">·</span>
                      <span>{group.enabledSkills.length} 技能</span>
                    </>
                  )}
                  {isActive && (
                    <>
                      <span className="text-text-secondary/30">·</span>
                      <span className="text-violet-500 font-medium">AI 执行中</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </button>
          );
        })}
        {groups.length === 0 && (
          <div className="text-center py-8">
            <MessageCircle className="w-8 h-8 mx-auto text-text-secondary/20 mb-2" />
            <p className="text-[11px] text-text-secondary/50">暂无群组</p>
            <button onClick={onCreate} className="text-[11px] text-primary/60 hover:text-primary mt-1 transition-colors">创建一个</button>
          </div>
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && onDelete && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-xl shadow-2xl border border-white/20 dark:border-white/10 py-1.5 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              if (confirm(`确定要解散群组「${contextMenu.groupName}」吗？\n所有聊天记录将被永久删除。`)) {
                onDelete(contextMenu.groupId);
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            解散群组
          </button>
        </div>
      )}
    </div>
  );
}

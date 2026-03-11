'use client';

import { Plus } from 'lucide-react';
import type { ChatGroup } from '@/lib/services/lan-peer/types';

interface GroupListProps {
  groups: ChatGroup[];
  selectedGroupId: string | null;
  onSelect: (groupId: string) => void;
  onCreate: () => void;
}

export default function GroupList({ groups, selectedGroupId, onSelect, onCreate }: GroupListProps) {
  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-xs font-medium text-text-secondary">群组</span>
        <button
          onClick={onCreate}
          className="p-1 rounded-md hover:bg-primary/10 text-primary transition-colors"
          title="创建群组"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {groups.map((group) => (
          <button
            key={group.id}
            onClick={() => onSelect(group.id)}
            className={`w-full text-left px-3 py-2.5 rounded-xl transition-all ${
              selectedGroupId === group.id
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'hover:bg-white/30 dark:hover:bg-white/5 text-text-main'
            }`}
          >
            <div className="text-sm font-medium truncate">{group.name}</div>
            <div className="text-xs text-text-secondary mt-0.5">
              {group.members.length} 位成员
              {group.enabledSkills.length > 0 && ` · ${group.enabledSkills.length} 个技能`}
            </div>
          </button>
        ))}
        {groups.length === 0 && (
          <p className="text-xs text-text-secondary text-center py-4">暂无群组</p>
        )}
      </div>
    </div>
  );
}

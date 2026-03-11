'use client';

import type { ChatMessage } from '@/lib/services/lan-peer/types';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

export default function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isSystem = message.messageType === 'system';
  const isSkillResult = message.messageType === 'skill_result';

  if (isSystem) {
    return (
      <div className="text-center">
        <span className="text-xs text-text-secondary bg-bg-subtle px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  if (isSkillResult) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl text-sm">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium mb-1">
            <span>⚡</span>
            <span>技能调用结果</span>
          </div>
          <p className="text-text-main text-xs">{message.content}</p>
          {message.skillResult && (
            <div className="mt-2 text-[10px] text-text-secondary">
              耗时 {message.skillResult.executionTime}ms
              {!message.skillResult.success && message.skillResult.error && (
                <span className="text-red-500 ml-2">错误: {message.skillResult.error}</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex gap-3 max-w-2xl">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">
        {message.senderName.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-medium text-text-main">{message.senderName}</span>
          <span className="text-[10px] text-text-secondary">{time}</span>
          {message.interactionMode === 'mention' && (
            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded">@提及</span>
          )}
          {message.interactionMode === 'skill_invoke' && (
            <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded">技能调用</span>
          )}
        </div>
        <div className="p-3 bg-white/40 dark:bg-slate-800/50 rounded-2xl rounded-tl-none border border-white/50 dark:border-white/[0.08] text-sm text-text-main">
          {message.content}
        </div>
        {message.fileInfo && (
          <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-white/30 dark:bg-slate-800/30 rounded-lg border border-border-subtle text-xs">
            {message.messageType === 'image' ? '🖼️' : '📎'}
            <span className="truncate">{message.fileInfo.name}</span>
            <span className="text-text-secondary">({(message.fileInfo.size / 1024).toFixed(1)}KB)</span>
          </div>
        )}
        {message.status === 'failed' && (
          <span className="text-[10px] text-red-500 mt-1 inline-block">发送失败</span>
        )}
      </div>
    </div>
  );
}

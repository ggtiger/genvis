'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUp, Paperclip, Users } from 'lucide-react';
import ChatMessageBubble from './ChatMessageBubble';
import type { ChatGroup, ChatMessage, PeerInfo } from '@/lib/services/lan-peer/types';

const API_BASE = '';

interface GroupChatPanelProps {
  group: ChatGroup;
  peers: PeerInfo[];
}

export default function GroupChatPanel({ group, peers }: GroupChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/lan-peer/groups/${group.id}/messages?limit=100`);
      const data = await res.json();
      if (data.success) setMessages(data.data || []);
    } catch { /* ignore */ }
  }, [group.id]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // SSE for new messages
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/lan-peer/stream`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'new_message' && data.data?.message?.groupId === group.id) {
          setMessages((prev) => {
            const msg = data.data.message as ChatMessage;
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [group.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    const content = inputValue.trim();
    if (!content || sending) return;
    setSending(true);
    setInputValue('');
    try {
      await fetch(`${API_BASE}/api/lan-peer/groups/${group.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      await loadMessages();
    } catch { /* ignore */ }
    setSending(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const memberPeers = peers.filter((p) => group.members.includes(p.id));

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between bg-white/30 dark:bg-slate-900/30 backdrop-blur-sm">
        <div>
          <h2 className="text-base font-semibold text-text-main">{group.name}</h2>
          <p className="text-xs text-text-secondary">{group.members.length} 位成员</p>
        </div>
        <button
          onClick={() => setShowDetail(!showDetail)}
          className="p-2 rounded-lg hover:bg-white/30 dark:hover:bg-white/5 text-text-secondary"
        >
          <Users className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.map((msg) => (
              <ChatMessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-6 py-4 border-t border-border-subtle">
            <div className="flex items-end gap-2 bg-white/50 dark:bg-slate-800/50 rounded-2xl border border-border-subtle p-2">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={group.enabledSkills.length > 0 ? '输入消息（直接发送触发技能，@同事 或 #纯聊天）' : '输入消息...'}
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm text-text-main placeholder:text-text-secondary focus:outline-none px-2 py-1.5 max-h-32"
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || sending}
                className="p-2 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
            {group.enabledSkills.length > 0 && (
              <p className="text-[10px] text-text-secondary mt-1 px-2">
                💡 直接发送 = 技能调用 · @同事名 = 提及 · #开头 = 纯聊天
              </p>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {showDetail && (
          <div className="w-64 border-l border-border-subtle bg-white/20 dark:bg-slate-900/20 p-4 overflow-y-auto">
            <h3 className="text-sm font-semibold text-text-main mb-3">群组成员</h3>
            <div className="space-y-2">
              {memberPeers.map((peer) => (
                <div key={peer.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
                  <div className={`w-2 h-2 rounded-full ${peer.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-main truncate">{peer.name}</div>
                    {peer.skills.length > 0 && (
                      <div className="text-[10px] text-text-secondary">{peer.skills.length} 个技能</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {group.enabledSkills.length > 0 && (
              <>
                <h3 className="text-sm font-semibold text-text-main mt-4 mb-2">开放技能</h3>
                <div className="space-y-1">
                  {group.enabledSkills.map((skill) => (
                    <div key={skill} className="text-xs px-2 py-1 bg-primary/5 rounded text-primary">
                      ⚡ {skill}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

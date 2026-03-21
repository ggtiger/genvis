'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUp, Users, Trash2, Save, Settings, Zap, FolderOpen, X, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ChatMessageBubble from './ChatMessageBubble';
import FileGridView, { type FileItem } from '@/components/files/FileGridView';
import PreviewDialog from '@/components/preview/PreviewDialog';
import type { ChatGroup, ChatMessage, PeerInfo } from '@/lib/services/lan-peer/types';

const API_BASE = '';

// ========== File preview type detection ==========
type FilePreviewType = 'image' | 'video' | 'pdf' | 'word' | 'excel' | 'ppt' | 'markdown' | 'code';
const getFilePreviewType = (filePath: string): FilePreviewType => {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['xls', 'xlsx'].includes(ext)) return 'excel';
  if (['ppt', 'pptx'].includes(ext)) return 'ppt';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  return 'code';
};

interface GroupChatPanelProps {
  group: ChatGroup;
  peers: PeerInfo[];
  onDeleteGroup?: (groupId: string) => void;
}

export default function GroupChatPanel({ group, peers, onDeleteGroup }: GroupChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [localPeerId, setLocalPeerId] = useState<string>('local');
  const [streamingSenderId, setStreamingSenderId] = useState<string | null>(null);
  const [aborting, setAborting] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(group.systemPrompt || '');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ========== File browser state (reuses project FileGridView) ==========
  const [tree, setTree] = useState<{ path: string; type: string; size?: number; hasChildren?: boolean }[]>([]);
  const [currentPath, setCurrentPath] = useState('.');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [officePreviewFile, setOfficePreviewFile] = useState<File | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string>('');

  const loadTree = useCallback(async (dir = '.') => {
    try {
      const res = await fetch(`${API_BASE}/api/repo/${group.id}/tree?dir=${encodeURIComponent(dir)}`);
      if (res.ok) {
        const data = await res.json();
        setTree(data || []);
        setCurrentPath(dir);
      }
    } catch { /* ignore */ }
  }, [group.id]);

  const loadTreeRef = useRef(loadTree);
  useEffect(() => { loadTreeRef.current = loadTree; }, [loadTree]);

  // Keep ref for SSE closure
  const showFilesRef = useRef(showFiles);
  useEffect(() => { showFilesRef.current = showFiles; }, [showFiles]);

  // Load files when panel is shown
  useEffect(() => {
    if (showFiles) loadTree(currentPath);
  }, [showFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle file click — open preview
  const handleFileClick = useCallback(async (file: FileItem) => {
    const previewType = getFilePreviewType(file.path);

    // Office docs — fetch blob and open PreviewDialog
    if (['word', 'excel', 'ppt', 'pdf'].includes(previewType)) {
      try {
        const r = await fetch(`${API_BASE}/api/repo/${group.id}/file?path=${encodeURIComponent(file.path)}&raw=true`);
        if (r.ok) {
          const blob = await r.blob();
          const fileObj = new File([blob], file.name, { type: blob.type });
          setOfficePreviewFile(fileObj);
        }
      } catch { /* ignore */ }
      return;
    }

    // Images — show inline
    if (previewType === 'image') {
      setPreviewImageUrl(`${API_BASE}/api/repo/${group.id}/file?path=${encodeURIComponent(file.path)}&raw=true`);
      setPreviewFileName(file.name);
      setSelectedFile(file.path);
      return;
    }

    // Text / Markdown / Code — fetch content
    try {
      const r = await fetch(`${API_BASE}/api/repo/${group.id}/file?path=${encodeURIComponent(file.path)}`);
      if (r.ok) {
        const data = await r.json();
        setPreviewContent(data.content || '');
        setPreviewFileName(file.name);
        setSelectedFile(file.path);
      }
    } catch { /* ignore */ }
  }, [group.id]);

  const closePreview = () => {
    setSelectedFile(null);
    setPreviewContent('');
    setPreviewImageUrl(null);
    setOfficePreviewFile(null);
  };

  const loadMessages = useCallback(async (replace = false) => {
    try {
      const res = await fetch(`${API_BASE}/api/lan-peer/groups/${group.id}/messages?limit=100`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        const dbMsgs: ChatMessage[] = data.data;
        setMessages((prev) => {
          // Safety: never wipe existing messages with empty result
          if (dbMsgs.length === 0 && prev.length > 0) return prev;
          // Full replace on initial load or explicit request
          if (replace || prev.length === 0) return dbMsgs;
          // Merge: DB is source of truth, keep recent SSE-only messages
          const dbIdSet = new Set(dbMsgs.map(m => m.id));
          const now = Date.now();
          // Keep SSE-only messages added within last 30s (not yet in DB)
          const sseOnly = prev.filter(m => !dbIdSet.has(m.id) && m.timestamp && (now - m.timestamp) < 30000);
          if (sseOnly.length === 0) return dbMsgs;
          const merged = [...dbMsgs, ...sseOnly];
          merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          return merged;
        });
      }
    } catch { /* ignore */ }
  }, [group.id]);

  useEffect(() => {
    loadMessages(true); // Full replace on initial load
  }, [loadMessages]);

  // Periodic message sync — catches DB-persisted messages missed during SSE gaps
  // Skip during active AI streaming to prevent state conflicts
  useEffect(() => {
    const interval = setInterval(() => {
      if (streamingMessage) return; // Don't poll while streaming — SSE handles it
      loadMessages();
    }, 10000); // 10s interval (SSE handles real-time)
    return () => clearInterval(interval);
  }, [loadMessages, streamingMessage]);

  // SSE for new messages + AI streaming
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/lan-peer/stream`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // SSE connected — capture local peerId
        if (data.type === 'connected' && data.data?.localPeerId) {
          setLocalPeerId(data.data.localPeerId);
        }

        // Regular new message (user messages, final non-streaming messages)
        if (data.type === 'new_message' && data.data?.message?.groupId === group.id) {
          setMessages((prev) => {
            const msg = data.data.message as ChatMessage;
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }

        // AI streaming start (also sent on SSE reconnect if AI is still active)
        if (data.type === 'ai_stream_start' && data.data?.groupId === group.id) {
          // Track who triggered this stream
          setStreamingSenderId(data.data.senderId || null);
          // On reconnect (resumed=true), also refresh messages to catch any we missed
          if (data.data.resumed) {
            loadMessages();
          }
          setStreamingMessage({
            id: data.data.requestId || 'streaming',
            groupId: group.id,
            senderId: 'ai-assistant',
            senderName: 'AI 助手',
            content: '',
            messageType: 'text',
            interactionMode: 'ai_chat',
            isStreaming: true,
            timestamp: Date.now(),
            status: 'sent',
          });
        }

        // AI streaming delta (token-by-token)
        if (data.type === 'ai_stream_delta' && data.data?.groupId === group.id) {
          setStreamingMessage((prev) => {
            if (!prev) return prev;
            return { ...prev, content: data.data.content || prev.content };
          });
        }

        // AI streaming end — clear regardless of groupId to handle stale state
        if (data.type === 'ai_stream_end') {
          if (data.data?.groupId === group.id) {
            setStreamingMessage(null);
            setStreamingSenderId(null);
            setAborting(false);
            // Add the final message (content or error)
            const finalContent = data.data.content || data.data.error;
            if (finalContent) {
              setMessages((prev) => {
                const msgId = data.data.messageId || data.data.requestId;
                if (msgId && prev.some((m) => m.id === msgId)) return prev;
                return [...prev, {
                  id: msgId || `end-${Date.now()}`,
                  groupId: group.id,
                  senderId: 'ai-assistant',
                  senderName: 'AI \u52A9\u624B',
                  content: finalContent,
                  messageType: data.data.error ? 'system' : 'text',
                  interactionMode: 'ai_chat',
                  timestamp: Date.now(),
                  status: 'sent',
                }];
              });
            }
          } else {
            // Different group's stream ended — still clear streaming if it was stale
            setStreamingMessage((prev) => {
              if (!prev) return prev;
              if (prev.id === data.data?.requestId) return null;
              return prev;
            });
          }
        }

        // AI tool use
        if (data.type === 'ai_tool_use' && data.data?.groupId === group.id) {
          const toolMsg: ChatMessage = {
            id: `tool-${data.data.messageId || Date.now()}`,
            groupId: group.id,
            senderId: 'ai-assistant',
            senderName: 'AI 助手',
            content: `Using tool: ${data.data.toolName}`,
            messageType: 'tool_use',
            interactionMode: 'ai_chat',
            metadata: {
              toolName: data.data.toolName,
              toolInput: data.data.toolInput,
              action: data.data.action,
              filePath: data.data.filePath,
            },
            timestamp: Date.now(),
            status: 'sent',
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === toolMsg.id)) return prev;
            return [...prev, toolMsg];
          });
        }

        // AI tool result
        if (data.type === 'ai_tool_result' && data.data?.groupId === group.id) {
          const resultMsg: ChatMessage = {
            id: `result-${data.data.messageId || Date.now()}`,
            groupId: group.id,
            senderId: 'ai-assistant',
            senderName: 'AI 助手',
            content: data.data.toolResponse || data.data.toolError || '',
            messageType: 'tool_result',
            interactionMode: 'ai_chat',
            metadata: {
              toolName: data.data.toolName,
              action: data.data.action,
              filePath: data.data.filePath,
              toolResponse: data.data.toolResponse,
              toolError: data.data.toolError,
              isError: data.data.isError,
            },
            timestamp: Date.now(),
            status: 'sent',
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === resultMsg.id)) return prev;
            return [...prev, resultMsg];
          });

          // Auto-refresh file browser when AI creates/edits/deletes files
          const fileAction = data.data.action;
          if (fileAction && ['Created', 'Edited', 'Deleted'].includes(fileAction)) {
            if (showFilesRef.current) {
              loadTreeRef.current?.('.');
            }
          }
        }

        // When AI stream ends, refresh file list and reconcile messages with DB
        if (data.type === 'ai_stream_end' && data.data?.groupId === group.id) {
          setTimeout(() => {
            if (showFilesRef.current) {
              loadTreeRef.current?.('.');
            }
            // Reconcile messages with DB after AI completes
            loadMessages();
          }, 1000);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [group.id, loadTree]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingMessage?.content]);

  const isMyStream = streamingMessage && streamingSenderId === localPeerId;

  const handleAbort = async () => {
    if (aborting) return;
    setAborting(true);
    try {
      await fetch(`${API_BASE}/api/lan-peer/groups/${group.id}/abort`, { method: 'POST' });
    } catch { /* ignore */ }
    // If SSE ai_stream_end doesn't arrive within 3s, force-clear
    setTimeout(() => {
      setStreamingMessage(null);
      setStreamingSenderId(null);
      setAborting(false);
    }, 3000);
  };

  const handleSend = async () => {
    const content = inputValue.trim();
    if (!content || sending) return;
    setSending(true);
    setInputValue('');
    try {
      const res = await fetch(`${API_BASE}/api/lan-peer/groups/${group.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const result = await res.json();
      // Optimistic update: add message from POST response immediately
      if (result.success && result.data) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === result.data.id)) return prev;
          return [...prev, result.data];
        });
      }
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
    <div className="flex-1 flex flex-col h-full relative">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/10 dark:border-white/[0.04] flex items-center justify-between backdrop-blur-sm bg-white/30 dark:bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-text-main leading-tight">{group.name}</h2>
            <p className="text-[11px] text-text-secondary/60 mt-0.5">
              {group.members.length} 位成员
              {group.enabledSkills.length > 0 && ` · ${group.enabledSkills.length} 个技能`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowFiles(!showFiles); if (!showFiles) setShowDetail(false); }}
            className={`p-2 rounded-xl transition-all ${
              showFiles
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-white/30 dark:hover:bg-white/5 text-text-secondary/60 hover:text-text-main'
            }`}
            title="群组文件"
          >
            <FolderOpen className="w-4.5 h-4.5" />
          </button>
          <button
            onClick={() => { setShowDetail(!showDetail); if (!showDetail) setShowFiles(false); }}
            className={`p-2 rounded-xl transition-all ${
              showDetail
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-white/30 dark:hover:bg-white/5 text-text-secondary/60 hover:text-text-main'
            }`}
            title="群组设置"
          >
            <Settings className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {messages.map((msg) => (
              <ChatMessageBubble key={msg.id} message={msg} />
            ))}
            {streamingMessage && (
              <ChatMessageBubble key="streaming" message={streamingMessage} isStreaming />
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-5 py-3">
            <div className="flex items-end gap-2 bg-white/50 dark:bg-white/[0.04] rounded-2xl border border-white/30 dark:border-white/[0.06] p-2 shadow-sm backdrop-blur-sm focus-within:ring-1 focus-within:ring-primary/20 transition-shadow">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isMyStream ? 'AI 正在响应中，请等待或终止...' : (group.enabledSkills.length > 0 ? '输入消息（直接发送触发技能，@同事 或 #纯聊天）' : '输入消息...')}
                rows={1}
                disabled={!!isMyStream}
                className="flex-1 resize-none bg-transparent text-sm text-text-main placeholder:text-text-secondary/40 focus:outline-none px-2 py-1.5 max-h-32 disabled:opacity-40 disabled:cursor-not-allowed"
              />
              {isMyStream ? (
                <button
                  onClick={handleAbort}
                  disabled={aborting}
                  className="p-2 rounded-xl bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-all shrink-0 shadow-sm flex items-center gap-1"
                  title="终止AI响应"
                >
                  <Square className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim() || sending || !!streamingMessage}
                  className="p-2 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0 shadow-sm"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
            </div>
            {group.enabledSkills.length > 0 && (
              <p className="text-[10px] text-text-secondary/40 mt-1.5 px-2">
                直接发送 = 技能调用 · @同事名 = 提及 · #开头 = 纯聊天
              </p>
            )}
          </div>
        </div>

        {/* File browser panel — reuses project FileGridView */}
        {showFiles && (
          <div className="w-80 border-l border-white/10 dark:border-white/[0.04] bg-white/15 dark:bg-white/[0.01] backdrop-blur-sm flex flex-col overflow-hidden">
            <FileGridView
              files={tree.map(entry => ({
                name: entry.path.split('/').pop() || entry.path,
                path: entry.path,
                type: entry.type === 'dir' ? 'directory' as const : 'file' as const,
                size: entry.size,
                extension: entry.path.split('.').pop(),
              }))}
              projectId={group.id}
              currentDir={currentPath}
              compact
              onFileClick={handleFileClick}
              onFolderClick={(folder) => loadTree(folder.path)}
              onRefresh={() => loadTreeRef.current?.('.')}
            />
          </div>
        )}

        {/* Detail panel */}
        {showDetail && (
          <div className="w-60 border-l border-white/10 dark:border-white/[0.04] bg-white/15 dark:bg-white/[0.01] backdrop-blur-sm p-4 overflow-y-auto">
            {/* Members section */}
            <div className="mb-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary/60 mb-2.5 px-1">群组成员</h3>
              <div className="space-y-0.5">
                {memberPeers.map((peer) => (
                  <div key={peer.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/20 dark:hover:bg-white/[0.04] transition-colors">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${peer.status === 'online' ? 'bg-green-500' : 'bg-gray-400/50'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-text-main truncate">{peer.name}</div>
                      {peer.skills.length > 0 && (
                        <div className="text-[10px] text-text-secondary/50">{peer.skills.length} 个技能</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Skills section */}
            {group.enabledSkills.length > 0 && (
              <div className="mb-5">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary/60 mb-2.5 px-1">开放技能</h3>
                <div className="space-y-1">
                  {group.enabledSkills.map((skill) => (
                    <div key={skill} className="flex items-center gap-2 text-[12px] px-2.5 py-1.5 bg-primary/5 hover:bg-primary/8 rounded-lg text-primary/80 transition-colors">
                      <Zap className="w-3 h-3 shrink-0" />
                      <span className="truncate">{skill}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI System Prompt Editor */}
            <div className="mb-5 pt-4 border-t border-white/10 dark:border-white/[0.04]">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary/60 mb-1.5 px-1">AI 提示词</h3>
              <p className="text-[10px] text-text-secondary/40 mb-2 px-1">自定义机器人人设，留空使用默认</p>
              <textarea
                value={editingPrompt}
                onChange={(e) => setEditingPrompt(e.target.value)}
                placeholder="设定 AI 的性格、行为规则..."
                rows={5}
                className="w-full px-2.5 py-2 text-[11px] font-mono rounded-xl border border-white/20 dark:border-white/[0.06] bg-white/30 dark:bg-white/[0.03] text-text-main focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none placeholder:text-text-secondary/30"
              />
              <button
                onClick={async () => {
                  setSavingPrompt(true);
                  try {
                    await fetch(`${API_BASE}/api/lan-peer/groups/${group.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ systemPrompt: editingPrompt.trim() || undefined }),
                    });
                  } catch { /* ignore */ }
                  setSavingPrompt(false);
                }}
                disabled={savingPrompt}
                className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-primary/70 hover:text-primary hover:bg-primary/5 rounded-xl transition-all disabled:opacity-40"
              >
                <Save className="w-3.5 h-3.5" />
                {savingPrompt ? '保存中...' : '保存提示词'}
              </button>
            </div>
            {/* Dissolve group button */}
            {onDeleteGroup && (
              <div className="pt-4 border-t border-white/10 dark:border-white/[0.04]">
                <button
                  onClick={() => {
                    if (confirm(`确定要解散群组「${group.name}」吗？\n所有聊天记录将被永久删除，此操作不可撤销。`)) {
                      onDeleteGroup(group.id);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[12px] text-red-400/70 hover:text-red-500 hover:bg-red-500/5 rounded-xl transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  解散群组
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ====== Office/PDF Preview Dialog ====== */}
      {officePreviewFile && (
        <PreviewDialog file={officePreviewFile} onClose={closePreview} />
      )}

      {/* ====== Image / Text / Markdown Preview Overlay ====== */}
      {(selectedFile && (previewImageUrl || previewContent)) && (
        <div
          className="absolute inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center p-4 sm:p-8"
          onClick={closePreview}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200/80 dark:border-gray-700/50 bg-gray-50/80 dark:bg-gray-800/50 shrink-0">
              <span className="text-[14px] font-semibold text-text-main truncate">{previewFileName}</span>
              <button
                onClick={closePreview}
                className="p-2 rounded-xl hover:bg-gray-200/80 dark:hover:bg-gray-700/50 text-text-secondary/60 hover:text-text-main transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-auto">
              {previewImageUrl && (
                <div className="flex items-center justify-center p-6 min-h-[300px]">
                  <img src={previewImageUrl} alt="preview" className="max-w-full max-h-[75vh] rounded-lg shadow-sm" />
                </div>
              )}
              {previewContent && (
                getFilePreviewType(previewFileName) === 'markdown' ? (
                  <div className="p-6 prose prose-sm dark:prose-invert max-w-none prose-headings:text-text-main prose-p:text-text-main/90 prose-li:text-text-main/90 prose-strong:text-text-main prose-code:text-primary/80 prose-code:bg-primary/5 prose-code:rounded prose-code:px-1 prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-table:text-sm prose-th:bg-gray-100 prose-th:dark:bg-gray-800 prose-td:border-gray-200 prose-td:dark:border-gray-700">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewContent}</ReactMarkdown>
                  </div>
                ) : (
                  <pre className="p-6 text-[13px] leading-relaxed font-mono text-text-main whitespace-pre-wrap break-words bg-gray-50/50 dark:bg-gray-800/30">{previewContent}</pre>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

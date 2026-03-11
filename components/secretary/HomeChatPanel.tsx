'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, Mic, Sparkles, ArrowUp, User, X, Image as ImageIcon, FileText as FileTextIcon, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useToast } from '@/contexts/ToastContext';
import type { SecretaryMessage, SecretaryAction, SecretaryAttachment } from '@/lib/services/secretary-session';
import type { Employee } from '@/types/backend/employee';
import PeerMentionMenu from '@/components/lan-chat/PeerMentionMenu';
import type { PeerInfo } from '@/components/lan-chat/PeerMentionMenu';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

/** Number of messages per page (initial + load-more) */
const PAGE_SIZE = 10;

interface HomeChatPanelProps {
  onActionComplete?: () => void;
}

// ========== @Mention types ==========
interface MentionState {
  active: boolean;
  startIndex: number; // cursor position of '@'
  query: string;      // text after '@' for filtering
}

interface SecretaryChatResponseData {
  sessionId: string;
  reply: string;
  actions?: SecretaryAction[];
  confidence?: number;
  candidates?: Array<{
    label: string;
    action: SecretaryAction;
    instruction?: string;
  }>;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ========== Sub-components ==========

function LoadingIndicator() {
  return (
    <div className="flex gap-4 max-w-3xl mr-auto animate-pulse">
      <div className="shrink-0 flex flex-col items-center gap-1">
        <div className="w-10 h-10 rounded-full bg-primary shadow-lg shadow-primary/20 flex items-center justify-center text-white text-lg">🤖</div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-text-main">小G</span>
        </div>
        <div className="p-4 bg-white/40 dark:bg-[rgba(30,41,59,0.7)] backdrop-blur-md rounded-2xl rounded-tl-none border border-white/50 dark:border-white/[0.08] w-48 h-12 flex items-center gap-1.5">
          <div className="w-2 h-2 bg-text-secondary/40 rounded-full animate-bounce" />
          <div className="w-2 h-2 bg-text-secondary/40 rounded-full animate-bounce" style={{ animationDelay: '100ms' }} />
          <div className="w-2 h-2 bg-text-secondary/40 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
        </div>
      </div>
    </div>
  );
}

function formatActionResult(result: any): string | null {
  if (result == null) return null;
  const items = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : null;
  if (items !== null) {
    if (items.length === 0) return '无数据';
    return `${items.length} 条记录`;
  }
  if (typeof result === 'object') {
    if (result.success === true && result.data == null) return '成功';
    if (result.title) return result.title;
    if (result.message) return result.message;
    return '成功';
  }
  return String(result);
}

function SecretaryActionDisplay({ action }: { action: SecretaryAction }) {
  switch (action.type) {
    case 'dispatch':
      return (
        <div className="mt-2 p-3 bg-primary-subtle border border-primary/20 rounded-xl text-sm">
          <div className="flex items-center gap-2 text-primary font-medium">
            <span>📋</span>
            <span>已调度给 {action.employeeName || action.employeeId}</span>
            <ConfidenceBadge confidence={action.confidence} />
          </div>
          {action.projectId && (
            <a href={`/${action.projectId}/chat`} className="inline-block mt-1 text-primary hover:opacity-80 underline text-xs">查看项目 →</a>
          )}
        </div>
      );
    case 'skill_call': {
      const summary = formatActionResult(action.result);
      return (
        <div className="mt-2 p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl text-sm">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium">
            <span>⚡</span>
            <span>{action.skillName}{action.endpoint ? ` (${action.endpoint})` : ''}</span>
            <ConfidenceBadge confidence={action.confidence} />
          </div>
          {summary && <p className="mt-1 text-xs text-green-800 dark:text-green-300">{summary}</p>}
        </div>
      );
    }
    case 'info':
      return (
        <div className="mt-2 p-3 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 rounded-xl text-sm">
          <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
            <span>ℹ️</span>
            <span>{action.result ?? ''}</span>
          </div>
        </div>
      );
    default:
      return null;
  }
}

/** 置信度标签 */
function ConfidenceBadge({ confidence }: { confidence?: number }) {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);
  const color = confidence >= 0.9
    ? 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-500/10'
    : confidence >= 0.75
    ? 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/10'
    : confidence >= 0.5
    ? 'text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-500/10'
    : 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-500/10';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${color}`}>
      🎯 {pct}%
    </span>
  );
}

/** 低置信度候选项选择器 */
function CandidateSelector({
  candidates,
  onSelect,
}: {
  candidates: Array<{ label: string; action: SecretaryAction; instruction?: string }>;
  onSelect: (candidate: { label: string; action: SecretaryAction; instruction?: string }) => void;
}) {
  if (!candidates || candidates.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {candidates.map((c, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(c)}
          className="w-full text-left p-2.5 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors text-sm"
        >
          <span className="font-medium text-primary">{c.label}</span>
          {c.instruction && (
            <span className="block text-xs text-text-secondary mt-0.5 whitespace-pre-wrap break-words">{c.instruction}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ========== @Mention dropdown ==========
function EmployeeMentionMenu({
  employees,
  query,
  onSelect,
  position,
  selectedIdx,
}: {
  employees: Employee[];
  query: string;
  onSelect: (employee: Employee) => void;
  position: { bottom: number; left: number };
  selectedIdx: number;
}) {
  const filtered = employees.filter(
    (e) => e.mode !== 'secretary' && e.name.toLowerCase().includes(query.toLowerCase())
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Scroll selected item into view
  useEffect(() => {
    itemRefs.current[selectedIdx]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="absolute z-50 w-64 max-h-52 overflow-y-auto bg-white/70 dark:bg-slate-800/80 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-xl shadow-lg py-1"
      style={{ bottom: position.bottom, left: position.left }}
    >
      {filtered.map((emp, idx) => (
        <button
          key={emp.id}
          ref={(el) => { itemRefs.current[idx] = el; }}
          onMouseDown={(e) => { e.preventDefault(); onSelect(emp); }}
          className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-primary/5 transition-colors ${idx === selectedIdx ? 'bg-primary/5' : ''}`}
        >
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-main truncate">{emp.name}</div>
            {emp.description && (
              <div className="text-xs text-text-secondary truncate">{emp.description}</div>
            )}
          </div>
          <span className="text-[10px] text-text-secondary px-1.5 py-0.5 bg-bg-subtle rounded">
            {emp.mode === 'code' ? '编程' : '工作'}
          </span>
        </button>
      ))}
    </div>
  );
}

// ========== Employee template card in messages ==========
function EmployeeTemplateCard({ employee }: { employee: Employee }) {
  const router = useRouter();
  const handleClick = () => {
    const url = `/workspace?view=home&employee_id=${encodeURIComponent(employee.id)}&auto_send=true`;
    router.push(url);
  };

  return (
    <div
      onClick={handleClick}
      className="mt-2 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-500/10 dark:to-indigo-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl cursor-pointer hover:shadow-md transition-all group"
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="w-3.5 h-3.5 text-primary" />
        </div>
        <span className="text-sm font-medium text-primary">{employee.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full">
          {employee.mode === 'code' ? '编程' : '工作'}
        </span>
      </div>
      {employee.description && (
        <p className="text-xs text-primary/80 mb-1.5 line-clamp-2">{employee.description}</p>
      )}
      {employee.first_prompt && (
        <div className="text-xs text-blue-600/70 dark:text-blue-400/70 bg-white/60 dark:bg-white/5 rounded-lg p-2 border border-blue-100 dark:border-blue-500/20 line-clamp-2">
          💡 {employee.first_prompt}
        </div>
      )}
      <div className="mt-2 text-[10px] text-blue-500 group-hover:text-blue-700 font-medium">
        点击开始对话 →
      </div>
    </div>
  );
}

// ========== Parse @mentions in user messages ==========
function MentionText({ content, employees }: { content: string; employees: Employee[] }) {
  // Match @employeeName patterns
  const parts: React.ReactNode[] = [];
  const mentionRegex = /@([\u4e00-\u9fa5a-zA-Z0-9_-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(content)) !== null) {
    // Add text before mention
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>);
    }
    const mentionName = match[1];
    const emp = employees.find((e) => e.name === mentionName);
    if (emp) {
      parts.push(
        <span key={`m-${match.index}`} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/30 rounded-md text-sm font-medium">
          @{emp.name}
        </span>
      );
    } else {
      parts.push(<span key={`m-${match.index}`}>@{mentionName}</span>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push(<span key={`t-${lastIndex}`}>{content.slice(lastIndex)}</span>);
  }
  return <>{parts}</>;
}

/** 消息来源渠道标签 */
const SOURCE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  dingtalk: { label: '钉钉', icon: '💬', color: 'text-blue-500' },
  feishu:   { label: '飞书', icon: '🐦', color: 'text-indigo-500' },
  wechat:   { label: '微信', icon: '💚', color: 'text-green-500' },
  wecom:    { label: '企微', icon: '🏢', color: 'text-blue-600' },
  qq:       { label: 'QQ',   icon: '🐧', color: 'text-sky-500' },
  web:      { label: '桌面', icon: '🖥️', color: 'text-gray-500' },
  skill:    { label: '技能', icon: '🧩', color: 'text-purple-500' },
};

function SourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  const info = SOURCE_LABELS[source];
  if (!info) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-bg-subtle dark:bg-white/5 border border-border-subtle/40 ${info.color}`}>
      <span>{info.icon}</span>
      <span>{info.label}</span>
    </span>
  );
}

/** Parse [附件] block from message content for backward compatibility with old messages */
function parseAttachmentBlock(content: string): { cleanContent: string; parsedAttachments: SecretaryAttachment[] } {
  const idx = content.indexOf('\n\n[附件]\n');
  if (idx === -1) return { cleanContent: content, parsedAttachments: [] };
  const cleanContent = content.substring(0, idx);
  const block = content.substring(idx + '\n\n[附件]\n'.length);
  const parsedAttachments: SecretaryAttachment[] = [];
  // Each attachment: "- name (mimeType, sizeKB)\n  路径: /path"
  const entryRegex = /^- (.+?) \(([^,]+),\s*([\d.]+)KB\)\n\s*路径:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(block)) !== null) {
    parsedAttachments.push({ name: m[1], mimeType: m[2], size: parseFloat(m[3]) * 1024, absolutePath: m[4] });
  }
  return { cleanContent, parsedAttachments };
}

function MessageBubble({ message, employees, onImageClick }: { message: SecretaryMessage; employees?: Employee[]; onImageClick?: (url: string) => void }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState<string | null>(null); // tracks what was copied: 'text', 'img-0', 'att-0', etc.
  const [feedbackState, setFeedbackState] = useState<'none' | 'up' | 'down'>('none');
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);

  const hasDispatchAction = !isUser && message.actions?.some(
    (a) => a.type === 'dispatch' || a.type === 'skill_call',
  );

  const sendFeedback = async (type: 'thumbs_up' | 'thumbs_down', comment?: string) => {
    if (feedbackSending) return;
    setFeedbackSending(true);
    try {
      await fetch(`${API_BASE}/api/chat/home/secretary/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageTimestamp: message.timestamp,
          type,
          ...(comment ? { comment } : {}),
        }),
      });
      setFeedbackState(type === 'thumbs_up' ? 'up' : 'down');
      setShowCommentInput(false);
      setFeedbackComment('');
    } catch {
      /* ignore */
    } finally {
      setFeedbackSending(false);
    }
  };
  // For old messages that have [附件] baked into content, parse them out
  const { cleanContent, parsedAttachments } = useMemo(() => {
    if (isUser && !message.attachments?.length) {
      return parseAttachmentBlock(message.content);
    }
    return { cleanContent: message.content, parsedAttachments: [] };
  }, [message.content, message.attachments, isUser]);
  const allAttachments = message.attachments?.length ? message.attachments : parsedAttachments;

  const showCopied = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(cleanContent);
      showCopied('text');
    } catch { /* ignore */ }
  };

  const copyImage = async (url: string, key: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      showCopied(key);
    } catch {
      // Fallback: copy URL
      try { await navigator.clipboard.writeText(url); showCopied(key); } catch { /* ignore */ }
    }
  };

  const copyAttachmentPath = async (att: SecretaryAttachment, key: string) => {
    const text = att.absolutePath || att.url || att.name;
    try {
      await navigator.clipboard.writeText(text);
      showCopied(key);
    } catch { /* ignore */ }
  };
  return (
    <div className={`flex gap-4 max-w-3xl group ${isUser ? 'ml-auto justify-end' : 'mr-auto'}`}>
      {!isUser && (
        <div className="shrink-0 flex flex-col items-center gap-1">
          <div className="w-10 h-10 rounded-full bg-primary shadow-lg shadow-primary/20 flex items-center justify-center text-white text-lg">🤖</div>
        </div>
      )}
      <div className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className="flex items-baseline gap-2">
          {isUser && <span className="text-xs text-text-secondary">{new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
          <span className="text-sm font-semibold text-text-main">{isUser ? '你' : '小G'}</span>
          {!isUser && <span className="text-xs text-text-secondary">{new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
          {isUser && <SourceBadge source={message.source} />}
        </div>
        {/* Image thumbnails */}
        {message.images && message.images.length > 0 && (
          <div className={`flex flex-wrap gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {message.images.map((url, i) => {
              const key = `img-${i}`;
              return (
                <div key={i} className="relative group/img">
                  <button
                    onClick={() => onImageClick?.(url)}
                    className="rounded-xl overflow-hidden border border-white/20 dark:border-white/10 shadow-sm hover:shadow-md transition-shadow cursor-zoom-in"
                  >
                    <img src={url} alt={`附件图片 ${i + 1}`} className="max-w-[200px] max-h-[160px] object-cover" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); copyImage(url, key); }}
                    className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-black/70"
                    title="复制图片"
                  >
                    {copied === key ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {/* File attachments as clickable links */}
        {allAttachments.length > 0 && (
          <div className={`flex flex-wrap gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {allAttachments.map((att, i) => {
              const key = `att-${i}`;
              return (
                <div key={i} className="relative group/att flex items-center gap-0.5">
                  <button
                    onClick={() => {
                      const filePath = att.absolutePath || att.url;
                      if (filePath && typeof window !== 'undefined') {
                        const api = (window as any).desktopAPI;
                        if (api?.openFolder && att.absolutePath) {
                          api.openFolder(att.absolutePath);
                        } else if (att.url) {
                          window.open(att.url, '_blank');
                        }
                      }
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors
                      bg-white/80 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600/50 text-gray-800 dark:text-gray-200`}
                    title={att.absolutePath || att.name}
                  >
                    <FileTextIcon className="w-5 h-5 shrink-0 opacity-70" />
                    <div className="flex flex-col items-start min-w-0">
                      <span className="text-sm font-medium truncate max-w-[180px]">{att.name}</span>
                      <span className="text-xs opacity-60">{(att.size / 1024).toFixed(1)}KB</span>
                    </div>
                  </button>
                  <button
                    onClick={() => copyAttachmentPath(att, key)}
                    className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover/att:opacity-100 transition-opacity"
                    title="复制路径"
                  >
                    {copied === key ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className={`p-4 text-sm leading-relaxed break-words ${
          isUser
            ? 'bg-primary text-white rounded-2xl rounded-tr-none shadow-lg shadow-primary/20'
            : 'bg-white/40 dark:bg-[rgba(30,41,59,0.7)] backdrop-blur-md rounded-2xl rounded-tl-none border border-white/50 dark:border-white/[0.08] text-text-main shadow-sm dark:backdrop-blur-sm'
        }`}>
          {isUser ? (
            employees && employees.length > 0 ? (
              <span className="whitespace-pre-wrap"><MentionText content={cleanContent} employees={employees} /></span>
            ) : (
              <span className="whitespace-pre-wrap">{cleanContent}</span>
            )
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-headings:font-semibold [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children, ...props }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                      onClick={(e) => {
                        if (href && typeof window !== 'undefined' && (window as any).desktopAPI?.openExternal) {
                          e.preventDefault();
                          (window as any).desktopAPI.openExternal(href);
                        }
                      }}
                      {...props}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {cleanContent}
              </ReactMarkdown>
            </div>
          )}
        </div>
        {/* Show employee template cards for @mentions in user messages */}
        {isUser && employees && employees.length > 0 && (() => {
          const mentionRegex = /@([\u4e00-\u9fa5a-zA-Z0-9_-]+)/g;
          const mentioned: Employee[] = [];
          let m: RegExpExecArray | null;
          while ((m = mentionRegex.exec(cleanContent)) !== null) {
            const emp = employees.find((e) => e.name === m![1]);
            if (emp && !mentioned.find((x) => x.id === emp.id)) mentioned.push(emp);
          }
          return mentioned.map((emp) => <EmployeeTemplateCard key={emp.id} employee={emp} />);
        })()}
        {message.actions && message.actions.length > 0 && (
          <div className="w-full">
            {message.actions.map((action, idx) => (
              <SecretaryActionDisplay key={idx} action={action} />
            ))}
          </div>
        )}
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity pl-1">
          <button onClick={copyText} className="flex items-center gap-1 text-text-secondary hover:text-primary text-xs">
            {copied === 'text' ? <><Check className="w-3 h-3" />已复制</> : '复制'}
          </button>
          {hasDispatchAction && feedbackState === 'none' && (
            <>
              <button
                onClick={() => sendFeedback('thumbs_up')}
                disabled={feedbackSending}
                className="text-text-secondary hover:text-green-500 text-xs transition-colors"
                title="调度正确"
              >
                👍
              </button>
              <button
                onClick={() => setShowCommentInput(true)}
                disabled={feedbackSending}
                className="text-text-secondary hover:text-red-500 text-xs transition-colors"
                title="调度错误"
              >
                👎
              </button>
            </>
          )}
          {hasDispatchAction && feedbackState === 'up' && (
            <span className="text-xs text-green-500">👍 已反馈</span>
          )}
          {hasDispatchAction && feedbackState === 'down' && (
            <span className="text-xs text-red-500">👎 已反馈</span>
          )}
        </div>
        {showCommentInput && (
          <div className="flex items-center gap-2 pl-1 mt-1">
            <input
              type="text"
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendFeedback('thumbs_down', feedbackComment || undefined); }}
              placeholder="说明正确的调度目标（可选）"
              className="flex-1 text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white/50 dark:bg-gray-800/50 text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <button
              onClick={() => sendFeedback('thumbs_down', feedbackComment || undefined)}
              disabled={feedbackSending}
              className="text-xs px-2 py-1 rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              提交
            </button>
            <button
              onClick={() => { setShowCommentInput(false); setFeedbackComment(''); }}
              className="text-xs text-text-secondary hover:text-text-main"
            >
              取消
            </button>
          </div>
        )}
      </div>
      {isUser && (
        <div className="shrink-0 flex flex-col items-center gap-1">
          <div className="w-10 h-10 rounded-full bg-white/20 dark:bg-white/10 border border-white/20 dark:border-white/10 shadow-sm flex items-center justify-center text-sm">👤</div>
        </div>
      )}
    </div>
  );
}

function QuickActions({ onAction }: { onAction: (msg: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      <button onClick={() => onAction('起草邮件')} className="px-3 py-1.5 text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-lg transition-colors">起草邮件</button>
      <button onClick={() => onAction('总结文档')} className="px-3 py-1.5 text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-lg transition-colors">总结文档</button>
      <button onClick={() => onAction('帮我安排一下本周的工作计划')} className="px-3 py-1.5 text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-lg transition-colors">计划本周</button>
    </div>
  );
}

// ========== Main Component ==========

export default function HomeChatPanel({ onActionComplete }: HomeChatPanelProps) {
  const [messages, setMessages] = useState<SecretaryMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);

  // Attachment state
  const [attachments, setAttachments] = useState<Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    publicUrl?: string | null;
    base64?: string;
    absolutePath?: string;
    uploading?: boolean;
  }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image lightbox state
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Employee state for @mention
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [mention, setMention] = useState<MentionState>({ active: false, startIndex: 0, query: '' });
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);
  const [mentionGroup, setMentionGroup] = useState<'内部员工' | '外部同事'>('内部员工');
  const [lanPeers, setLanPeers] = useState<PeerInfo[]>([]);

  // Compute filtered employees for keyboard navigation
  const mentionFiltered = mention.active
    ? (mentionGroup === '内部员工'
        ? employees.filter((e) => e.mode !== 'secretary' && e.name.toLowerCase().includes(mention.query.toLowerCase()))
        : lanPeers.filter((p) => p.name.toLowerCase().includes(mention.query.toLowerCase()))
      )
    : [];

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const loadingMoreRef = useRef(false); // Ref-based lock to prevent concurrent loads
  const hasScrolledInitially = useRef(false); // Track if initial scroll has happened

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousScrollHeight = useRef<number>(0);

  const scrollToBottom = useCallback((instant?: boolean) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
    }
  }, []);

  // Scroll to bottom only after initial session load (no animation)
  useEffect(() => {
    if (!initialLoading && messages.length > 0 && !hasScrolledInitially.current) {
      hasScrolledInitially.current = true;
      setTimeout(() => scrollToBottom(true), 100);
    }
  }, [initialLoading, messages.length, scrollToBottom]);

  const toast = useToast();
  const [trackedDispatches, setTrackedDispatches] = useState<Map<string, { employeeName: string }>>(new Map());
  const [pendingCandidates, setPendingCandidates] = useState<SecretaryChatResponseData['candidates']>(undefined);

  // ---- Waiting feedback state (employees needing user confirmation) ----
  const [waitingFeedbacks, setWaitingFeedbacks] = useState<Map<string, { employeeName: string; questionContent?: string }>>(new Map());
  const [replyingToProject, setReplyingToProject] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState<string>('');

  // ---- Load employees for @mention ----
  useEffect(() => {
    let cancelled = false;
    async function fetchEmployees() {
      try {
        const response = await fetch(`${API_BASE}/api/employees`);
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) setEmployees(data.data || []);
        }
      } catch (error) {
        console.error('[HomeChatPanel] Failed to load employees:', error);
      }
    }
    fetchEmployees();
    return () => { cancelled = true; };
  }, []);

  // ---- Load LAN peers for @mention ----
  useEffect(() => {
    let cancelled = false;
    async function fetchPeers() {
      try {
        const response = await fetch(`${API_BASE}/api/lan-peer/peers`);
        if (response.ok) {
          const data = await response.json();
          if (!cancelled && data.data) setLanPeers(data.data);
        }
      } catch {
        // LAN peer service may not be running — ignore
      }
    }
    fetchPeers();
    // Refresh peers periodically (every 30s)
    const interval = setInterval(fetchPeers, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ---- Load existing session on mount ----
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function fetchSession() {
      try {
        const response = await fetch(`${API_BASE}/api/chat/home/secretary?page=1&limit=${PAGE_SIZE}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        const result = await response.json();
        if (!cancelled && result.success && result.data) {
          const { sessionId: loadedSessionId, messages: loadedMessages, pagination } = result.data;
          if (loadedSessionId) setSessionId(loadedSessionId);
          if (Array.isArray(loadedMessages) && loadedMessages.length > 0) {
            setMessages(loadedMessages);
            if (pagination) {
              setHasMore(pagination.hasMore);
              setTotalMessages(pagination.total);
              setCurrentPage(1);
            }
            const allDispatches = new Map<string, { employeeName: string }>();
            for (const msg of loadedMessages) {
              if (msg.actions) {
                for (const action of msg.actions) {
                  if (action.type === 'dispatch' && action.projectId) {
                    allDispatches.set(action.projectId, { employeeName: action.employeeName || action.employeeId || '员工' });
                  }
                }
              }
            }
            if (allDispatches.size > 0) {
              try {
                const statusResp = await fetch(`${API_BASE}/api/chat/home/dispatch-status`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ projectIds: Array.from(allDispatches.keys()) }),
                });
                const statusResult = await statusResp.json();
                if (statusResult.success && Array.isArray(statusResult.data)) {
                  const activeDispatches = new Map<string, { employeeName: string }>();
                  for (const item of statusResult.data) {
                    if (item.status === 'active') {
                      const tracked = allDispatches.get(item.projectId);
                      if (tracked) activeDispatches.set(item.projectId, tracked);
                    }
                  }
                  if (!cancelled && activeDispatches.size > 0) setTrackedDispatches(activeDispatches);
                }
              } catch (err) {
                console.error('[HomeChatPanel] Failed to check dispatch statuses on load:', err);
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Aborted by cleanup (e.g. React Strict Mode), ignore
        } else {
          console.error('[HomeChatPanel] Failed to load session:', error);
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }
    fetchSession();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  // ---- Load more messages when scrolling to top ----
  const loadMoreMessages = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = currentPage + 1;

    // Capture scroll state before loading
    const container = scrollContainerRef.current;
    const prevScrollHeight = container ? container.scrollHeight : 0;
    const prevScrollTop = container ? container.scrollTop : 0;

    try {
      const response = await fetch(`${API_BASE}/api/chat/home/secretary?page=${nextPage}&limit=${PAGE_SIZE}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json();
      
      if (result.success && result.data) {
        const { messages: olderMessages, pagination } = result.data;
        
        if (Array.isArray(olderMessages) && olderMessages.length > 0) {
          // Prepend older messages to the beginning (they're already in chronological order)
          setMessages((prev) => [...olderMessages, ...prev]);
          setCurrentPage(nextPage);
          
          if (pagination) {
            setHasMore(pagination.hasMore);
          }

          // Restore scroll position after DOM updates
          // Use double rAF to ensure React has flushed the DOM changes
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (container) {
                const newScrollHeight = container.scrollHeight;
                const heightAdded = newScrollHeight - prevScrollHeight;
                container.scrollTop = prevScrollTop + heightAdded;
              }
            });
          });
        } else {
          setHasMore(false);
        }
      }
    } catch (error) {
      console.error('[HomeChatPanel] Failed to load more messages:', error);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, currentPage]);

  // ---- SSE: Real-time push for dispatch status + IM messages (replaces polling) ----
  useEffect(() => {
    if (initialLoading) return;

    let es: EventSource | null = null;
    let closed = false;
    let hasConnectedOnce = false;
    let lastHeartbeat = Date.now();

    function connect() {
      if (closed) return;
      es = new EventSource(`${API_BASE}/api/chat/home/stream`);

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          switch (parsed.type) {
            case 'dispatch_completed': {
              const { projectId, employeeName } = parsed.data;
              toast.success(`✅ ${employeeName || '员工'} 已完成任务`, 5000);
              setTrackedDispatches((prev) => {
                const next = new Map(prev);
                next.delete(projectId);
                return next;
              });
              if (onActionComplete) onActionComplete();
              break;
            }
            case 'dispatch_failed': {
              const { projectId, employeeName } = parsed.data;
              toast.error(`❌ ${employeeName || '员工'} 的任务执行失败`, 5000);
              setTrackedDispatches((prev) => {
                const next = new Map(prev);
                next.delete(projectId);
                return next;
              });
              // Also remove from waiting feedbacks if present
              setWaitingFeedbacks((prev) => {
                const next = new Map(prev);
                next.delete(projectId);
                return next;
              });
              if (onActionComplete) onActionComplete();
              break;
            }
            case 'dispatch_feedback': {
              // Employee needs user confirmation
              const { projectId, employeeName } = parsed.data;
              console.log(`[HomeChatPanel] 📋 dispatch_feedback: ${employeeName} (${projectId}) 需要确认`);
              
              // Fetch the feedback question content
              fetch(`${API_BASE}/api/chat/home/reply-to-project?projectId=${projectId}`)
                .then((r) => r.json())
                .then((result) => {
                  if (result.success && result.data) {
                    setWaitingFeedbacks((prev) => {
                      const next = new Map(prev);
                      next.set(projectId, {
                        employeeName: result.data.employeeName || employeeName || '员工',
                        questionContent: result.data.questionContent,
                      });
                      return next;
                    });
                    toast.info(`📋 ${result.data.employeeName || employeeName || '员工'} 需要你的确认`, 5000);
                    // Scroll to bottom to show the new feedback message
                    setTimeout(() => scrollToBottom(), 100);
                  }
                })
                .catch((err) => {
                  console.error('[HomeChatPanel] Failed to fetch feedback question:', err);
                  // Still add to waitingFeedbacks with default values
                  setWaitingFeedbacks((prev) => {
                    const next = new Map(prev);
                    next.set(projectId, {
                      employeeName: employeeName || '员工',
                      questionContent: '员工需要你的确认',
                    });
                    return next;
                  });
                  setTimeout(() => scrollToBottom(), 100);
                });
              break;
            }
            case 'new_message': {
              const msg = parsed.data.message;
              if (msg) {
                setMessages((prev) => {
                  const isDup = prev.some(
                    (m) => m.timestamp === msg.timestamp && m.role === msg.role && m.content === msg.content
                  );
                  if (isDup) return prev;
                  return [...prev, msg];
                });
                setTimeout(() => scrollToBottom(), 100);
              }
              break;
            }
            case 'dashboard_refresh': {
              if (onActionComplete) onActionComplete();
              break;
            }
            case 'connected': {
              if (!hasConnectedOnce) {
                // 首次连接，不需要重新加载（初始 fetchSession 已加载）
                hasConnectedOnce = true;
                break;
              }
              // SSE 重连后，从服务端重新加载最新消息以防遗漏
              // 服务端缓存会推送断线期间的事件，但作为兜底也刷新一次
              fetch(`${API_BASE}/api/chat/home/secretary?page=1&limit=${PAGE_SIZE}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
              })
                .then((r) => r.json())
                .then((result) => {
                  if (result.success && result.data?.messages) {
                    const loaded: SecretaryMessage[] = result.data.messages;
                    if (loaded.length === 0) return;
                    setMessages((prev) => {
                      // 检查最新一条消息是否已存在
                      const lastLoaded = loaded[loaded.length - 1];
                      const alreadyHas = prev.some(
                        (m) => m.timestamp === lastLoaded.timestamp && m.role === lastLoaded.role && m.content === lastLoaded.content
                      );
                      if (alreadyHas) return prev;
                      // 有新消息 — 合并（去重）
                      const merged = [...prev];
                      for (const msg of loaded) {
                        const isDup = merged.some(
                          (m) => m.timestamp === msg.timestamp && m.role === msg.role && m.content === msg.content
                        );
                        if (!isDup) merged.push(msg);
                      }
                      return merged;
                    });
                    setTimeout(() => scrollToBottom(), 100);
                  }
                })
                .catch(() => { /* ignore */ });
              break;
            }
            // heartbeat — track liveness
            case 'heartbeat': {
              lastHeartbeat = Date.now();
              break;
            }
          }
        } catch { /* ignore parse errors */ }
      };

      // EventSource auto-reconnects on error; no manual reconnect needed
      // onerror fires on disconnect, browser will retry automatically
    }

    connect();

    // Watchdog: 如果超过 25 秒没收到 heartbeat（正常 8 秒一次），
    // 说明 SSE 连接可能已死但 EventSource 没检测到，主动重连
    const watchdog = setInterval(() => {
      if (closed) return;
      const elapsed = Date.now() - lastHeartbeat;
      if (elapsed > 25_000 && es) {
        console.warn(`[HomeChatPanel] SSE heartbeat 超时 (${Math.round(elapsed / 1000)}s)，主动重连`);
        es.close();
        es = null;
        hasConnectedOnce = true; // 确保重连后触发消息刷新
        connect();
      }
    }, 10_000);

    return () => {
      closed = true;
      clearInterval(watchdog);
      es?.close();
    };
  }, [initialLoading, toast, onActionComplete, scrollToBottom]);

  // ---- Send message handler ----
  const sendMessage = useCallback(
    async (messageText: string, imageAttachments?: Array<{ base64: string; mimeType: string }>, imageUrls?: string[], fileAttachments?: Array<{ name: string; mimeType: string; size: number; url?: string; absolutePath?: string }>): Promise<boolean> => {
      if (!messageText.trim() || loading) return false;
      const trimmedMessage = messageText.trim();
      const userMessage: SecretaryMessage = {
        role: 'user',
        content: trimmedMessage,
        timestamp: new Date().toISOString(),
        images: imageUrls && imageUrls.length > 0 ? imageUrls : undefined,
        attachments: fileAttachments && fileAttachments.length > 0 ? fileAttachments : undefined,
      };
      setMessages((prev) => [...prev, userMessage]);
      setLoading(true);
      
      // Scroll to bottom after adding user message
      setTimeout(() => scrollToBottom(), 50);
      
      try {
        // Build full message for AI including attachment info
        let apiMessage = trimmedMessage;
        if (fileAttachments && fileAttachments.length > 0) {
          const fileInfo = fileAttachments.map((a) => {
            const filePath = a.absolutePath || a.url || a.name;
            return `- ${a.name} (${a.mimeType}, ${(a.size / 1024).toFixed(1)}KB)\n  路径: ${filePath}`;
          }).join('\n');
          apiMessage += `\n\n[附件]\n${fileInfo}`;
        }
        const response = await fetch(`${API_BASE}/api/chat/home/secretary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: apiMessage,
            sessionId: sessionId ?? undefined,
            images: imageAttachments && imageAttachments.length > 0 ? imageAttachments : undefined,
          }),
        });
        const result: ApiResponse<SecretaryChatResponseData> = await response.json();
        if (result.success && result.data) {
          const { sessionId: newSessionId, reply, actions, confidence: respConfidence, candidates: respCandidates } = result.data;
          setSessionId(newSessionId);
          const assistantMessage: SecretaryMessage = { role: 'assistant', content: reply, actions, timestamp: new Date().toISOString() };
          setMessages((prev) => [...prev, assistantMessage]);
          // Store candidates if low confidence
          if (respCandidates && respCandidates.length > 0) {
            setPendingCandidates(respCandidates);
          }
          setTimeout(() => scrollToBottom(), 50);
          if (actions && actions.length > 0 && onActionComplete) onActionComplete();
          if (actions && actions.length > 0) {
            const newDispatches = actions.filter((a) => a.type === 'dispatch' && a.projectId);
            if (newDispatches.length > 0) {
              setTrackedDispatches((prev) => {
                const next = new Map(prev);
                for (const d of newDispatches) next.set(d.projectId!, { employeeName: d.employeeName || d.employeeId || '员工' });
                return next;
              });
            }
          }
          return true;
        } else {
          const errorMessage: SecretaryMessage = { role: 'assistant', content: result.error || '抱歉，处理您的请求时出现了错误。请稍后再试。', timestamp: new Date().toISOString() };
          setMessages((prev) => [...prev, errorMessage]);
          setTimeout(() => scrollToBottom(), 50);
          return true;
        }
      } catch (error) {
        console.error('[HomeChatPanel] Failed to send message:', error);
        const errorMessage: SecretaryMessage = { role: 'assistant', content: '网络错误，无法连接到服务器。请检查网络连接后重试。', timestamp: new Date().toISOString() };
        setMessages((prev) => [...prev, errorMessage]);
        setTimeout(() => scrollToBottom(), 50);
        return true;
      } finally {
        setLoading(false);
      }
    },
    [loading, sessionId, onActionComplete, scrollToBottom]
  );

  // ---- Handle candidate selection (low confidence) ----
  const handleCandidateSelect = useCallback(
    async (candidate: { label: string; action: SecretaryAction; instruction?: string }) => {
      setPendingCandidates(undefined);
      setLoading(true);

      try {
        // Use forceDispatchResult to execute the selected candidate without another AI call
        const instruction = candidate.instruction || '';
        const reply = `好的，${candidate.label}`;
        const response = await fetch(`${API_BASE}/api/chat/home/secretary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `请执行：${candidate.label}${instruction ? ' - ' + instruction : ''}`,
            sessionId: sessionId ?? undefined,
            forceDispatchResult: {
              reply,
              actions: [candidate.action],
            },
          }),
        });
        const result: ApiResponse<SecretaryChatResponseData> = await response.json();
        if (result.success && result.data) {
          setSessionId(result.data.sessionId);
          const assistantMessage: SecretaryMessage = {
            role: 'assistant',
            content: result.data.reply,
            actions: result.data.actions,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setTimeout(() => scrollToBottom(), 50);
          if (result.data.actions && onActionComplete) onActionComplete();
        }
      } catch (error) {
        console.error('[HomeChatPanel] Candidate selection failed:', error);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, scrollToBottom, onActionComplete]
  );

  // ---- Send reply to project (employee waiting for feedback) ----
  const sendReplyToProject = useCallback(
    async (projectId: string, message: string) => {
      if (!message.trim()) return;
      
      const feedback = waitingFeedbacks.get(projectId);
      if (!feedback) return;

      setReplyingToProject(projectId);
      setLoading(true);

      try {
        // Show user message in secretary chat
        const userMessage: SecretaryMessage = {
          role: 'user',
          content: `→ ${feedback.employeeName}: ${message}`,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMessage]);
        setTimeout(() => scrollToBottom(), 50);

        // Send to project
        const response = await fetch(`${API_BASE}/api/chat/home/reply-to-project`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            message: message.trim(),
          }),
        });
        const result = await response.json();

        if (result.success) {
          // Show confirmation message
          const assistantMessage: SecretaryMessage = {
            role: 'assistant',
            content: `✅ 已将回复发送给 ${feedback.employeeName}，任务继续执行中...`,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
          
          // Remove from waiting feedbacks
          setWaitingFeedbacks((prev) => {
            const next = new Map(prev);
            next.delete(projectId);
            return next;
          });
          
          // Clear reply state
          setReplyContent('');
          setReplyingToProject(null);
          
          // Add to tracked dispatches
          setTrackedDispatches((prev) => {
            const next = new Map(prev);
            next.set(projectId, { employeeName: feedback.employeeName });
            return next;
          });
          
          setTimeout(() => scrollToBottom(), 50);
          toast.success(`已发送回复给 ${feedback.employeeName}`);
        } else {
          toast.error(result.error || '发送回复失败');
        }
      } catch (error) {
        console.error('[HomeChatPanel] Failed to send reply to project:', error);
        toast.error('发送回复失败，请稍后重试');
      } finally {
        setLoading(false);
        setReplyingToProject(null);
      }
    },
    [waitingFeedbacks, scrollToBottom, toast]
  );

  // ---- Go to project chat page ----
  const goToProjectChat = useCallback((projectId: string) => {
    window.location.href = `/${projectId}/chat`;
  }, []);

  // ---- Direct dispatch: @employee + instruction → auto create project & dispatch ----
  const directDispatch = useCallback(
    async (employee: Employee, instruction: string, fullMessage: string, dispatchAttachments?: typeof attachments) => {
      // Show user message in chat
      const userMessage: SecretaryMessage = { role: 'user', content: fullMessage, timestamp: new Date().toISOString() };
      setMessages((prev) => [...prev, userMessage]);
      setLoading(true);
      setTimeout(() => scrollToBottom(), 50);

      try {
        const projectId = `p-${Math.random().toString(36).substring(2, 10)}`;
        // Detect Python employee by id or system_prompt content
        const isPython = employee.id === 'builtin-python-dev' ||
          employee.system_prompt?.toLowerCase().includes('fastapi') ||
          employee.description?.toLowerCase().includes('fastapi') ||
          employee.description?.toLowerCase().includes('python');
        const projectType = employee.mode !== 'code' ? 'default' : isPython ? 'python-fastapi' : 'nextjs';

        // Build instruction with attachment absolute paths so the CLI can find them
        let fullInstruction = instruction;
        if (dispatchAttachments && dispatchAttachments.length > 0) {
          const fileList = dispatchAttachments.map((a) => {
            const absPath = a.absolutePath || '';
            return `- 文件名: ${a.name}\n  绝对路径: ${absPath}\n  项目内路径: assets/${a.name}`;
          }).join('\n');
          fullInstruction = `${instruction}\n\n[附件文件 - 已复制到项目 assets/ 目录，也可通过绝对路径读取]\n${fileList}`;
        }

        const response = await fetch(`${API_BASE}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            name: instruction.slice(0, 50) || '秘书派活',
            description: instruction.slice(0, 200),
            initialPrompt: fullInstruction,
            preferredCli: 'claude',
            selectedModel: 'claude-sonnet-4-20250514',
            projectType,
            mode: employee.mode,
            employee_id: employee.id,
            autoStart: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`创建项目失败: ${response.status}`);
        }

        const result = await response.json();
        const createdProjectId = result.data?.project_id || result.data?.id || projectId;

        // Copy attachment files into the project's assets directory
        if (dispatchAttachments && dispatchAttachments.length > 0) {
          try {
            await fetch(`${API_BASE}/api/assets/${createdProjectId}/copy-from-secretary`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                files: dispatchAttachments.map((a) => ({
                  filename: a.id,
                  originalName: a.name,
                  absolutePath: a.absolutePath,
                })),
              }),
            });
          } catch {
            // Non-critical: files may still be accessible via absolute path
          }
        }

        // Save to secretary session via POST (so it persists in history)
        try {
          await fetch(`${API_BASE}/api/chat/home/secretary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: fullMessage,
              sessionId: sessionId ?? undefined,
              // Pass pre-computed dispatch result so the API can skip AI call
              forceDispatchResult: {
                reply: `已将任务分配给 ${employee.name}，正在执行中⏳ 完成后会自动通知你结果。`,
                actions: [{
                  type: 'dispatch',
                  employeeId: employee.id,
                  employeeName: employee.name,
                  projectId: createdProjectId,
                }],
              },
            }),
          });
        } catch {
          // Session save failure is non-critical
        }

        const assistantMessage: SecretaryMessage = {
          role: 'assistant',
          content: `已将任务分配给 ${employee.name}，正在执行中⏳ 完成后会自动通知你结果。`,
          actions: [{
            type: 'dispatch',
            employeeId: employee.id,
            employeeName: employee.name,
            projectId: createdProjectId,
          }],
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setTimeout(() => scrollToBottom(), 50);

        // Track dispatch for polling
        setTrackedDispatches((prev) => {
          const next = new Map(prev);
          next.set(createdProjectId, { employeeName: employee.name });
          return next;
        });

        if (onActionComplete) onActionComplete();
      } catch (error) {
        console.error('[HomeChatPanel] Direct dispatch failed:', error);
        const errorMessage: SecretaryMessage = {
          role: 'assistant',
          content: `分配任务给 ${employee.name} 失败：${error instanceof Error ? error.message : '未知错误'}`,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMessage]);
        setTimeout(() => scrollToBottom(), 50);
      } finally {
        setLoading(false);
      }
    },
    [loading, sessionId, onActionComplete, scrollToBottom]
  );

  const handleSubmit = () => {
    if ((!inputValue.trim() && attachments.length === 0) || loading) return;
    if (attachments.some((a) => a.uploading)) return; // wait for uploads
    setMention({ active: false, startIndex: 0, query: '' });

    const trimmed = inputValue.trim();

    // Build attachment info string for the AI (not displayed to user)
    const attachmentInfoForAI = attachments.length > 0
      ? '\n\n[附件]\n' + attachments.map((a) => {
          const absPath = a.absolutePath || a.publicUrl || a.name;
          return `- ${a.name} (${a.mimeType}, ${(a.size / 1024).toFixed(1)}KB)\n  路径: ${absPath}`;
        }).join('\n')
      : '';

    // Separate file attachments (non-image) for display
    const fileAttachmentsForDisplay = attachments
      .filter((a) => !a.mimeType.startsWith('image/'))
      .map((a) => ({ name: a.name, mimeType: a.mimeType, size: a.size, url: a.publicUrl || undefined, absolutePath: a.absolutePath }));

    const fullMessageForAI = trimmed + attachmentInfoForAI;
    const currentAttachments = [...attachments];
    setAttachments([]);

    // Detect @employeeName + instruction pattern for auto-dispatch
    // Match against actual employee names (which may contain spaces) instead of regex
    if (trimmed.startsWith('@')) {
      const afterAt = trimmed.slice(1);
      // Find the longest matching employee name at the start
      const matchedEmp = employees
        .filter((e) => afterAt.startsWith(e.name))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (matchedEmp) {
        const rest = afterAt.slice(matchedEmp.name.length).trim();
        if (rest) {
          // Has instruction text after the name — auto dispatch (with attachments)
          directDispatch(matchedEmp, rest, trimmed, currentAttachments);
          setInputValue('');
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
          return;
        }
      }
    }

    // Normal message — send to secretary AI
    const imageAttachments = currentAttachments
      .filter((a) => a.mimeType.startsWith('image/') && a.base64)
      .map((a) => ({ base64: a.base64!, mimeType: a.mimeType }));
    const imageUrls = currentAttachments
      .filter((a) => a.mimeType.startsWith('image/') && (a.publicUrl || a.base64))
      .map((a) => a.publicUrl || a.base64!);
    sendMessage(
      trimmed,
      imageAttachments.length > 0 ? imageAttachments : undefined,
      imageUrls.length > 0 ? imageUrls : undefined,
      fileAttachmentsForDisplay.length > 0 ? fileAttachmentsForDisplay : undefined,
    );
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  // Handle @mention detection in input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart ?? value.length;
    setInputValue(value);
    adjustHeight();

    // Check for active @ mention
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');
    if (atIndex >= 0) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1);
      // Only activate if no space in the query (still typing the name)
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        setMention({ active: true, startIndex: atIndex, query: textAfterAt });
        setMentionSelectedIdx(0);
        return;
      }
    }
    setMention({ active: false, startIndex: 0, query: '' });
  };

  // Insert @mention into input
  const handleMentionSelect = (employee: Employee) => {
    const before = inputValue.slice(0, mention.startIndex);
    const after = inputValue.slice(mention.startIndex + 1 + mention.query.length);
    const newValue = `${before}@${employee.name} ${after}`;
    setInputValue(newValue);
    setMention({ active: false, startIndex: 0, query: '' });
    // Focus textarea and set cursor after the inserted mention
    setTimeout(() => {
      if (textareaRef.current) {
        const cursorPos = before.length + 1 + employee.name.length + 1;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    }, 0);
  };

  // Insert @peer mention into input
  const handlePeerMentionSelect = (peer: PeerInfo) => {
    const before = inputValue.slice(0, mention.startIndex);
    const after = inputValue.slice(mention.startIndex + 1 + mention.query.length);
    const newValue = `${before}@${peer.name} ${after}`;
    setInputValue(newValue);
    setMention({ active: false, startIndex: 0, query: '' });
    setTimeout(() => {
      if (textareaRef.current) {
        const cursorPos = before.length + 1 + peer.name.length + 1;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Close mention menu on Escape
    if (e.key === 'Escape' && mention.active) {
      e.preventDefault();
      setMention({ active: false, startIndex: 0, query: '' });
      return;
    }
    // Arrow key navigation in mention menu
    if (mention.active && mentionFiltered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSelectedIdx((prev) => (prev + 1) % mentionFiltered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelectedIdx((prev) => (prev - 1 + mentionFiltered.length) % mentionFiltered.length);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !isComposing && !e.nativeEvent.isComposing) {
      if (mention.active) {
        // Select the highlighted mention item
        e.preventDefault();
        if (mentionFiltered.length > 0) {
          const item = mentionFiltered[mentionSelectedIdx];
          if (mentionGroup === '内部员工') {
            handleMentionSelect(item as Employee);
          } else {
            handlePeerMentionSelect(item as PeerInfo);
          }
        }
        return;
      }
      e.preventDefault();
      handleSubmit();
    }
  };

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
    }
  };

  // Upload a file to the secretary uploads folder
  const uploadFile = useCallback(async (file: File) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Add placeholder with uploading state
    const placeholder = {
      id: tempId,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      uploading: true,
      base64: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    };
    setAttachments((prev) => [...prev, placeholder]);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/api/assets/secretary/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId
              ? { ...a, id: data.filename, publicUrl: data.publicUrl, base64: data.base64 || a.base64, absolutePath: data.absolutePath, uploading: false }
              : a
          )
        );
      } else {
        setAttachments((prev) => prev.filter((a) => a.id !== tempId));
        toast.error(`上传失败: ${data.error || '未知错误'}`);
      }
    } catch {
      setAttachments((prev) => prev.filter((a) => a.id !== tempId));
      toast.error('上传失败，请检查网络');
    }
  }, [toast]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => uploadFile(f));
    e.target.value = ''; // reset so same file can be selected again
  }, [uploadFile]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Handle paste for images from clipboard
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const name = `clipboard-${Date.now()}.${file.type.split('/')[1] || 'png'}`;
          const renamedFile = new File([file], name, { type: file.type });
          uploadFile(renamedFile);
        }
        return; // only handle first image
      }
    }
  }, [uploadFile]);

  if (initialLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-text-secondary text-sm">加载中...</div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Message list */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-36 lg:px-8 lg:pt-8 flex flex-col gap-6">
        {/* Load more button at top */}
        {hasMore && (
          <div className="flex justify-center py-2">
            {loadingMore ? (
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>加载中...</span>
              </div>
            ) : (
              <button
                onClick={loadMoreMessages}
                className="text-xs text-primary hover:text-blue-600 font-medium px-4 py-1.5 rounded-full hover:bg-primary/5 border border-primary/20 transition-colors"
              >
                ↑ 查看更早的消息
              </button>
            )}
          </div>
        )}

        {messages.length === 0 && !loading ? (
          <>
            <div className="flex justify-center py-4">
              <span className="text-xs font-medium text-text-secondary bg-bg-subtle px-3 py-1 rounded-full border border-border-subtle">今天</span>
            </div>
            <div className="flex gap-4 max-w-3xl mr-auto group">
              <div className="shrink-0 flex flex-col items-center gap-1">
                <div className="w-10 h-10 rounded-full bg-primary shadow-lg shadow-primary/20 flex items-center justify-center text-white text-lg">🤖</div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-text-main">小G</span>
                  <span className="text-xs text-text-secondary">上午 9:41</span>
                </div>
                <div className="p-4 bg-white/40 dark:bg-[rgba(30,41,59,0.7)] backdrop-blur-md rounded-2xl rounded-tl-none border border-white/50 dark:border-white/[0.08] text-text-main text-sm leading-relaxed shadow-sm dark:backdrop-blur-sm">
                  <p>早上好。我们今天关注什么？</p>
                  <QuickActions onAction={(msg) => sendMessage(msg)} />
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity pl-1">
                  <button className="text-text-secondary hover:text-primary text-xs">👍</button>
                  <button className="text-text-secondary hover:text-primary text-xs">复制</button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {messages.map((msg, index) => {
              // Insert date separator when the date changes between messages
              const msgDate = new Date(msg.timestamp);
              const prevDate = index > 0 ? new Date(messages[index - 1].timestamp) : null;
              const showDateSep = !prevDate ||
                msgDate.getFullYear() !== prevDate.getFullYear() ||
                msgDate.getMonth() !== prevDate.getMonth() ||
                msgDate.getDate() !== prevDate.getDate();

              let dateLabel = '';
              if (showDateSep) {
                const today = new Date();
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                if (
                  msgDate.getFullYear() === today.getFullYear() &&
                  msgDate.getMonth() === today.getMonth() &&
                  msgDate.getDate() === today.getDate()
                ) {
                  dateLabel = '今天';
                } else if (
                  msgDate.getFullYear() === yesterday.getFullYear() &&
                  msgDate.getMonth() === yesterday.getMonth() &&
                  msgDate.getDate() === yesterday.getDate()
                ) {
                  dateLabel = '昨天';
                } else {
                  dateLabel = `${msgDate.getMonth() + 1}月${msgDate.getDate()}日`;
                }
              }

              return (
                <React.Fragment key={`${msg.timestamp}-${index}`}>
                  {showDateSep && (
                    <div className="flex justify-center py-4">
                      <span className="text-xs font-medium text-text-secondary bg-bg-subtle px-3 py-1 rounded-full border border-border-subtle">{dateLabel}</span>
                    </div>
                  )}
                  <MessageBubble message={msg} employees={employees} onImageClick={(url) => setLightboxUrl(url)} />
                </React.Fragment>
              );
            })}
            {loading && <LoadingIndicator />}
            {pendingCandidates && pendingCandidates.length > 0 && !loading && (
              <div className="flex gap-4 max-w-3xl mr-auto">
                <div className="shrink-0 w-10" />
                <div className="flex-1">
                  <CandidateSelector candidates={pendingCandidates} onSelect={handleCandidateSelect} />
                </div>
              </div>
            )}
            {/* Waiting feedback messages - displayed as chat messages */}
            {Array.from(waitingFeedbacks.entries()).map(([projectId, feedback]) => (
              <div key={`feedback-${projectId}`} className="flex gap-4 max-w-3xl mr-auto">
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <div className="w-10 h-10 rounded-full bg-amber-500 shadow-lg shadow-amber-500/20 flex items-center justify-center text-white text-lg">🔔</div>
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{feedback.employeeName}</span>
                    <span className="text-xs text-text-secondary">需要确认</span>
                  </div>
                  <div className="p-4 bg-amber-50/80 dark:bg-amber-900/20 backdrop-blur-md rounded-2xl rounded-tl-none border border-amber-200/50 dark:border-amber-700/30 text-text-main text-sm leading-relaxed">
                    {feedback.questionContent ? (
                      <div className="prose prose-sm prose-amber dark:prose-invert max-w-none overflow-x-auto">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {feedback.questionContent}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-text-secondary">员工需要你的确认</p>
                    )}
                    <div className="mt-3 pt-3 border-t border-amber-200/50 dark:border-amber-700/30 flex items-center gap-2">
                      <button
                        onClick={() => goToProjectChat(projectId)}
                        className="text-xs px-3 py-1.5 bg-primary text-white rounded-lg hover:opacity-90 transition-colors"
                      >
                        去回答
                      </button>
                      <button
                        onClick={() => {
                          if (replyingToProject === projectId) {
                            setReplyingToProject(null);
                            setReplyContent('');
                          } else {
                            setReplyingToProject(projectId);
                          }
                        }}
                        className="text-xs px-3 py-1.5 border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors"
                      >
                        {replyingToProject === projectId ? '取消' : '快速回复'}
                      </button>
                    </div>
                    {/* Quick reply input */}
                    {replyingToProject === projectId && (
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="text"
                          value={replyContent}
                          onChange={(e) => setReplyContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              sendReplyToProject(projectId, replyContent);
                            }
                          }}
                          placeholder="输入回复内容..."
                          className="flex-1 text-xs px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-primary"
                          autoFocus
                        />
                        <button
                          onClick={() => sendReplyToProject(projectId, replyContent)}
                          disabled={!replyContent.trim() || loading}
                          className="text-xs px-3 py-2 bg-primary text-white rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          发送
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating input area */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white/60 via-white/30 to-transparent dark:from-[#0f172a]/90 dark:via-[#0f172a]/60 dark:to-transparent pt-6 pb-6 px-4 lg:px-8 flex justify-center z-20">
        <div className="w-full max-w-3xl bg-white/50 dark:bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] border border-white/60 dark:border-border-subtle p-2 flex flex-col gap-2 relative">
          {/* @Mention dropdown */}
          {mention.active && (employees.length > 0 || lanPeers.length > 0) && (
            <PeerMentionMenu
              employees={employees}
              peers={lanPeers}
              query={mention.query}
              onSelectEmployee={handleMentionSelect}
              onSelectPeer={handlePeerMentionSelect}
              position={{ bottom: 100, left: 16 }}
              selectedIdx={mentionSelectedIdx}
              activeGroup={mentionGroup}
              onGroupChange={(g) => { setMentionGroup(g); setMentionSelectedIdx(0); }}
            />
          )}
          {/* Attachment preview strip */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-2">
              {attachments.map((att) => (
                <div key={att.id} className="relative group flex items-center gap-1.5 px-2 py-1.5 bg-bg-subtle dark:bg-white/5 border border-border-subtle rounded-lg text-xs">
                  {att.mimeType.startsWith('image/') && att.base64 ? (
                    <img src={att.base64} alt={att.name} className="w-8 h-8 rounded object-cover" />
                  ) : (
                    <FileTextIcon className="w-4 h-4 text-text-secondary" />
                  )}
                  <span className="text-text-main max-w-[120px] truncate">{att.name}</span>
                  {att.uploading && <span className="text-text-secondary animate-pulse">上传中...</span>}
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="ml-1 w-4 h-4 flex items-center justify-center rounded-full bg-gray-300 dark:bg-gray-600 text-white hover:bg-red-500 transition-colors"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.zip"
          />
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            className="w-full resize-none border-none bg-transparent focus:ring-0 focus:outline-none p-3 text-sm text-text-main placeholder-text-secondary/70 h-14 max-h-32"
            placeholder="给助手发送消息... 输入 @ 提及员工，粘贴图片或添加附件"
            disabled={loading}
          />
          <div className="flex justify-between items-center px-2 pb-1">
            <div className="flex items-center gap-1">
              <button type="button" onClick={handleFileSelect} className="p-2 text-text-secondary hover:text-primary hover:bg-bg-subtle rounded-lg transition-colors" title="添加附件">
                <Paperclip className="w-5 h-5" />
              </button>
              <button type="button" className="p-2 text-text-secondary hover:text-primary hover:bg-bg-subtle rounded-lg transition-colors" title="语音输入">
                <Mic className="w-5 h-5" />
              </button>
              <div className="h-4 w-px bg-border-subtle mx-1" />
              <button type="button" className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-text-secondary hover:text-text-main hover:bg-bg-subtle rounded-lg transition-colors">
                <Sparkles className="w-4 h-4" />
                <span>优化</span>
              </button>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || (!inputValue.trim() && attachments.length === 0) || attachments.some((a) => a.uploading)}
              className="w-9 h-9 bg-primary hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center justify-center transition-colors shadow-sm"
            >
              <ArrowUp className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Image lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X size={20} />
          </button>
          <img
            src={lightboxUrl}
            alt="预览"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

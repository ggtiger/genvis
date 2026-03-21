'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, FileText, FilePlus, FileEdit, Trash2, Search, Terminal, Sparkles, AlertCircle, Copy, Check } from 'lucide-react';
import type { ChatMessage } from '@/lib/services/lan-peer/types';

// ========== Action display config ==========

type ToolAction = 'Read' | 'Created' | 'Edited' | 'Deleted' | 'Searched' | 'Executed' | 'Generated';

const ACTION_CONFIG: Record<ToolAction, { icon: React.ComponentType<{ className?: string }>; label: string; color: string; bgClass: string; borderClass: string }> = {
  Read:      { icon: FileText,  label: '读取',   color: 'text-blue-600 dark:text-blue-400',   bgClass: 'bg-blue-50/60 dark:bg-blue-500/[0.06]',   borderClass: 'border-blue-200/50 dark:border-blue-500/20' },
  Created:   { icon: FilePlus,  label: '创建',   color: 'text-green-600 dark:text-green-400', bgClass: 'bg-green-50/60 dark:bg-green-500/[0.06]', borderClass: 'border-green-200/50 dark:border-green-500/20' },
  Edited:    { icon: FileEdit,  label: '编辑',   color: 'text-amber-600 dark:text-amber-400', bgClass: 'bg-amber-50/60 dark:bg-amber-500/[0.06]', borderClass: 'border-amber-200/50 dark:border-amber-500/20' },
  Deleted:   { icon: Trash2,    label: '删除',   color: 'text-red-600 dark:text-red-400',     bgClass: 'bg-red-50/60 dark:bg-red-500/[0.06]',     borderClass: 'border-red-200/50 dark:border-red-500/20' },
  Searched:  { icon: Search,    label: '搜索',   color: 'text-cyan-600 dark:text-cyan-400',   bgClass: 'bg-cyan-50/60 dark:bg-cyan-500/[0.06]',   borderClass: 'border-cyan-200/50 dark:border-cyan-500/20' },
  Executed:  { icon: Terminal,   label: '执行',   color: 'text-purple-600 dark:text-purple-400', bgClass: 'bg-purple-50/60 dark:bg-purple-500/[0.06]', borderClass: 'border-purple-200/50 dark:border-purple-500/20' },
  Generated: { icon: Sparkles,   label: '生成',   color: 'text-pink-600 dark:text-pink-400',   bgClass: 'bg-pink-50/60 dark:bg-pink-500/[0.06]',   borderClass: 'border-pink-200/50 dark:border-pink-500/20' },
};

function getActionConfig(action?: string) {
  return ACTION_CONFIG[(action as ToolAction)] || ACTION_CONFIG.Executed;
}

function truncatePath(p?: string, max = 50): string {
  if (!p) return '';
  return p.length > max ? '...' + p.slice(-max) : p;
}

// ========== Markdown rendering helpers ==========

function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join('');
  if (React.isValidElement(children)) {
    const props = children.props as Record<string, unknown>;
    return extractTextFromChildren(props.children as React.ReactNode);
  }
  return String(children ?? '');
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  let language: string | undefined;
  React.Children.forEach(children, child => {
    if (React.isValidElement(child)) {
      const p = child.props as Record<string, unknown>;
      if (typeof p?.className === 'string') {
        const m = /language-(\w+)/.exec(p.className);
        if (m) language = m[1];
      }
    }
  });
  const code = extractTextFromChildren(children);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };
  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-white/15 dark:border-white/[0.06]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 text-slate-300 dark:text-slate-600">
        <span className="text-[11px] font-mono">{language || 'code'}</span>
        <button onClick={handleCopy} className="px-2 py-0.5 rounded text-[11px] hover:bg-gray-700 flex items-center gap-1 transition-colors" title="复制">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 p-3 overflow-x-auto text-xs leading-5 m-0">{children}</pre>
    </div>
  );
}

const mdComponents = {
  p: ({ children }: any) => <p className="mb-2 last:mb-0 break-words">{children}</p>,
  strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
  code: ({ children, className }: any) => (
    className
      ? <code className={`${className}`}>{children}</code>  // inside pre, keep as-is
      : <code className="bg-white/15 dark:bg-white/10 px-1.5 py-0.5 rounded text-[13px] font-mono text-pink-600 dark:text-pink-400">{children}</code>
  ),
  pre: ({ children }: any) => <CodeBlock>{children}</CodeBlock>,
  ul: ({ children }: any) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
  li: ({ children }: any) => <li className="mb-0.5 break-words">{children}</li>,
  h1: ({ children }: any) => <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-sm font-bold mb-1.5 mt-2">{children}</h3>,
  blockquote: ({ children }: any) => <blockquote className="border-l-3 border-violet-300 dark:border-violet-500/40 pl-3 my-2 text-text-secondary italic">{children}</blockquote>,
  table: ({ children }: any) => <div className="overflow-x-auto my-2"><table className="min-w-full text-xs border-collapse border border-border-subtle">{children}</table></div>,
  th: ({ children }: any) => <th className="px-3 py-1.5 bg-bg-subtle border border-border-subtle text-left font-medium">{children}</th>,
  td: ({ children }: any) => <td className="px-3 py-1.5 border border-border-subtle">{children}</td>,
  a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">{children}</a>,
  hr: () => <hr className="my-3 border-border-subtle" />,
};

function MarkdownContent({ content }: { content: string }) {
  // Handle <thinking> blocks from Claude
  const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
  if (thinkingRegex.test(content)) {
    const parts: React.ReactElement[] = [];
    let lastIndex = 0;
    let idx = 0;
    thinkingRegex.lastIndex = 0;
    let match;
    while ((match = thinkingRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        const text = content.slice(lastIndex, match.index).trim();
        if (text) parts.push(<ReactMarkdown key={`t-${idx}`} remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown>);
      }
      const thinking = match[1].trim();
      if (thinking) {
        parts.push(
          <details key={`th-${idx}`} className="my-2 text-xs text-text-secondary">
            <summary className="cursor-pointer select-none opacity-60 hover:opacity-100">💭 思考过程</summary>
            <div className="mt-1 pl-3 border-l-2 border-violet-300/30 dark:border-violet-500/20 whitespace-pre-wrap">{thinking}</div>
          </details>
        );
      }
      lastIndex = thinkingRegex.lastIndex;
      idx++;
    }
    if (lastIndex < content.length) {
      const remaining = content.slice(lastIndex).trim();
      if (remaining) parts.push(<ReactMarkdown key={`t-${idx}`} remarkPlugins={[remarkGfm]} components={mdComponents}>{remaining}</ReactMarkdown>);
    }
    if (parts.length > 0) return <>{parts}</>;
  }
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{content}</ReactMarkdown>;
}

// ========== Collapsible Tool Result Block ==========

interface ToolResultBlockProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  bgClass: string;
  borderClass: string;
  toolName: string;
  filePath?: string;
  content: string;
  isError: boolean;
}

function ToolResultBlock({ icon: Icon, label, color, bgClass, borderClass, toolName, filePath, content, isError }: ToolResultBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!content.trim();

  return (
    <div className="flex gap-2.5 max-w-2xl ml-11">
      <div className="flex-1 min-w-0">
        <button
          onClick={() => hasContent && setExpanded(!expanded)}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${bgClass} ${borderClass} ${hasContent ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        >
          {hasContent ? (
            expanded
              ? <ChevronDown className={`w-3.5 h-3.5 shrink-0 ${color}`} />
              : <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${color}`} />
          ) : (
            <Icon className={`w-4 h-4 shrink-0 ${color}`} />
          )}
          <Icon className={`w-4 h-4 shrink-0 ${color}`} />
          <span className={`text-xs font-medium ${color}`}>{label}</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono">{toolName}</span>
          {filePath && (
            <span className="text-[10px] text-text-secondary font-mono truncate" title={filePath}>
              {truncatePath(filePath)}
            </span>
          )}
          {isError && <span className="text-[10px] text-red-500 ml-auto">error</span>}
        </button>
        {expanded && hasContent && (
          <div className={`mt-1 p-2 rounded-lg border ${bgClass} ${borderClass} max-h-60 overflow-y-auto`}>
            <pre className={`text-[11px] font-mono whitespace-pre-wrap break-all ${isError ? 'text-red-600 dark:text-red-400' : 'text-text-main'}`}>
              {content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

export default function ChatMessageBubble({ message, isStreaming }: ChatMessageBubbleProps) {
  const isSystem = message.messageType === 'system';
  const isSkillResult = message.messageType === 'skill_result';
  const isToolUse = message.messageType === 'tool_use';
  const isToolResult = message.messageType === 'tool_result';
  const isAI = message.senderId === 'ai-assistant';

  if (isSystem) {
    return (
      <div className="text-center py-1">
        <span className="text-[11px] text-text-secondary/50 bg-white/15 dark:bg-white/[0.03] px-3 py-1 rounded-full">
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

  // Tool use indicator — compact with action icon + file path
  if (isToolUse) {
    const toolName = (message.metadata?.toolName as string) || 'tool';
    const action = (message.metadata?.action as string) || undefined;
    const filePath = message.metadata?.filePath as string | undefined;
    const cfg = getActionConfig(action);
    const Icon = cfg.icon;

    return (
      <div className="flex gap-2.5 max-w-2xl ml-11">
        <div className="flex-1 min-w-0">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${cfg.bgClass} ${cfg.borderClass}`}>
            <Icon className={`w-4 h-4 shrink-0 ${cfg.color}`} />
            <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono">{toolName}</span>
            {filePath && (
              <span className="text-[10px] text-text-secondary font-mono truncate" title={filePath}>
                {truncatePath(filePath)}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Tool result display — collapsible with action-specific styling
  if (isToolResult) {
    const toolName = (message.metadata?.toolName as string) || 'tool';
    const action = (message.metadata?.action as string) || undefined;
    const filePath = message.metadata?.filePath as string | undefined;
    const isError = !!message.metadata?.isError;
    const toolResponse = (message.metadata?.toolResponse as string) || '';
    const toolError = (message.metadata?.toolError as string) || '';
    const displayContent = isError ? toolError : (toolResponse || message.content);
    const cfg = isError
      ? { icon: AlertCircle, label: '失败', color: 'text-red-600 dark:text-red-400', bgClass: 'bg-red-50/60 dark:bg-red-500/[0.06]', borderClass: 'border-red-200/50 dark:border-red-500/20' }
      : getActionConfig(action);
    const Icon = cfg.icon;

    return <ToolResultBlock
      icon={Icon}
      label={cfg.label}
      color={cfg.color}
      bgClass={cfg.bgClass}
      borderClass={cfg.borderClass}
      toolName={toolName}
      filePath={filePath}
      content={displayContent}
      isError={isError}
    />;
  }

  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex gap-2.5 max-w-2xl">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-medium shrink-0 ${
        isAI
          ? 'bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-500/15 dark:to-blue-500/15 text-violet-600 dark:text-violet-400'
          : 'bg-primary/8 text-primary'
      }`}>
        {isAI ? '✨' : message.senderName.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`text-[13px] font-medium ${
            isAI ? 'text-violet-600 dark:text-violet-400' : 'text-text-main'
          }`}>{message.senderName}</span>
          <span className="text-[10px] text-text-secondary/40">{time}</span>
          {isAI && (
            <span className="text-[9px] px-1.5 py-0.5 bg-violet-500/10 text-violet-500 dark:text-violet-400 rounded-md font-medium">AI</span>
          )}
          {isStreaming && (
            <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 text-blue-500 dark:text-blue-400 rounded-md animate-pulse font-medium">生成中...</span>
          )}
          {message.interactionMode === 'mention' && (
            <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 text-blue-500 dark:text-blue-400 rounded-md">@提及</span>
          )}
          {message.interactionMode === 'skill_invoke' && (
            <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/10 text-purple-500 dark:text-purple-400 rounded-md">技能调用</span>
          )}
        </div>
        <div className={`p-3 rounded-2xl rounded-tl-sm border text-sm ${
          isAI
            ? 'bg-white/40 dark:bg-white/[0.04] border-white/30 dark:border-white/[0.06] text-text-main'
            : 'bg-white/50 dark:bg-white/[0.06] border-white/40 dark:border-white/[0.08] text-text-main'
        }`}>
          <div className="break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <MarkdownContent content={message.content} />
          </div>
          {isStreaming && !message.content && (
            <div className="flex items-center gap-1 text-violet-400">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
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

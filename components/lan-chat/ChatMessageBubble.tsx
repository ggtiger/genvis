'use client';

import React, { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChevronDown, ChevronRight, FileText, FilePlus, FileEdit, Trash2,
  Search, Terminal, Sparkles, AlertCircle, Copy, Check, Zap,
  ExternalLink, FolderOpen, FileIcon, X,
} from 'lucide-react';
import VoicePlayer from '@/components/secretary/VoicePlayer';
import type { ChatMessage, InteractionMode } from '@/lib/services/lan-peer/types';

// ========== Helper Functions ==========

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileIcon(fileType: string): React.ReactNode {
  const type = fileType?.toLowerCase() || '';
  if (type.includes('pdf')) return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M10 12h4" /><path d="M10 16h4" /></svg>;
  if (type.includes('doc') || type.includes('word')) return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" /></svg>;
  if (type.includes('xls') || type.includes('excel') || type.includes('spreadsheet') || type.includes('csv')) return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><rect x="8" y="12" width="8" height="6" /></svg>;
  if (type.includes('ppt') || type.includes('presentation')) return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><rect x="8" y="11" width="8" height="5" rx="1" /></svg>;
  if (type.includes('zip') || type.includes('rar') || type.includes('7z') || type.includes('tar') || type.includes('gz')) return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>;
  if (type.includes('image') || type.includes('jpg') || type.includes('jpeg') || type.includes('png') || type.includes('gif') || type.includes('webp')) return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>;
  if (type.includes('video') || type.includes('mp4') || type.includes('avi') || type.includes('mov')) return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>;
  if (type.includes('audio') || type.includes('mp3') || type.includes('wav') || type.includes('m4a')) return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;
  return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
}

// ========== Action display config ==========

type ToolAction = 'Read' | 'Created' | 'Edited' | 'Deleted' | 'Searched' | 'Executed' | 'Generated';

const ACTION_CONFIG: Record<ToolAction, { icon: React.ComponentType<{ className?: string }>; label: string; color: string; bgClass: string; borderClass: string }> = {
  Read:      { icon: FileText,  label: '读取',   color: 'text-blue-600 dark:text-blue-400',   bgClass: 'bg-blue-50/60 dark:bg-blue-500/[0.06]',   borderClass: 'border-blue-200/50 dark:border-blue-500/20' },
  Created:   { icon: FilePlus,  label: '创建',   color: 'text-green-600 dark:text-green-400', bgClass: 'bg-green-50/60 dark:bg-green-500/[0.06]', borderClass: 'border-green-200/50 dark:border-green-500/20' },
  Edited:    { icon: FileEdit,  label: '编辑',   color: 'text-amber-600 dark:text-amber-400', bgClass: 'bg-amber-50/60 dark:bg-amber-500/[0.06]', borderClass: 'border-amber-200/50 dark:border-amber-500/20' },
  Deleted:   { icon: Trash2,    label: '删除',   color: 'text-red-600 dark:text-red-400',     bgClass: 'bg-red-50/60 dark:bg-red-500/[0.06]',     borderClass: 'border-red-200/50 dark:border-red-500/20' },
  Searched:  { icon: Search,    label: '搜索',   color: 'text-cyan-600 dark:text-cyan-400',   bgClass: 'bg-cyan-50/60 dark:bg-cyan-500/[0.06]',   borderClass: 'border-cyan-200/50 dark:border-cyan-500/20' },
  Executed:  { icon: Terminal,  label: '执行',   color: 'text-purple-600 dark:text-purple-400', bgClass: 'bg-purple-50/60 dark:bg-purple-500/[0.06]', borderClass: 'border-purple-200/50 dark:border-purple-500/20' },
  Generated: { icon: Sparkles,  label: '生成',   color: 'text-pink-600 dark:text-pink-400',   bgClass: 'bg-pink-50/60 dark:bg-pink-500/[0.06]',   borderClass: 'border-pink-200/50 dark:border-pink-500/20' },
};

function getActionConfig(action?: string) {
  return ACTION_CONFIG[(action as ToolAction)] || ACTION_CONFIG.Executed;
}

function truncatePath(p?: string, max = 50): string {
  if (!p) return '';
  return p.length > max ? '...' + p.slice(-max) : p;
}

// ========== External open helpers ==========

function handleOpenExternal(url: string) {
  if (typeof window !== 'undefined' && (window as any).desktopAPI?.openExternal) {
    (window as any).desktopAPI.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
function handleOpenFile(filePath: string) {
  if (typeof window !== 'undefined' && (window as any).desktopAPI?.openFile) {
    (window as any).desktopAPI.openFile(filePath);
  }
}
function handleShowInFolder(filePath: string) {
  if (typeof window !== 'undefined' && (window as any).desktopAPI?.showInFolder) {
    (window as any).desktopAPI.showInFolder(filePath);
  } else if (typeof window !== 'undefined' && (window as any).desktopAPI?.openFolder) {
    const parent = filePath.replace(/\/[^\/]+$/, '') || '/';
    (window as any).desktopAPI.openFolder(parent);
  }
}

// ========== Path / URL detection ==========

const LOCAL_PATH_RE = /(?:^|\s)(\/[\w.@\-\u4e00-\u9fff]+(?:\/[\w.@\-\u4e00-\u9fff]+)+\/?)/g;
const isLocalPath = (s: string) => /^\/[\w.@\-\u4e00-\u9fff]+\//.test(s) && !s.startsWith('http');
const isWebUrl = (s: string) => /^https?:\/\//.test(s);
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i;
const isImageUrl = (s: string) => isWebUrl(s) && IMAGE_EXT_RE.test(s);
const isLocalImagePath = (s: string) => isLocalPath(s) && IMAGE_EXT_RE.test(s);
const localPathToSrc = (p: string) => `/api/local-file?path=${encodeURIComponent(p)}`;

// Module-level callback for image preview overlay
let _openImagePreview: ((url: string) => void) | null = null;

// ========== Inline components ==========

function InlineImage({ src, alt }: { src: string; alt?: string }) {
  return (
    <span className="inline-block my-1 cursor-pointer group/img relative" onClick={() => _openImagePreview?.(src)} title="点击预览">
      <img src={src} alt={alt || '图片'} className="max-w-full max-h-[300px] rounded-lg border border-white/10 dark:border-white/[0.06] shadow-sm transition-transform group-hover/img:shadow-md" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      <span className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">点击预览</span>
    </span>
  );
}

export function ImagePreviewOverlay() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    _openImagePreview = (u: string) => setUrl(u);
    return () => { _openImagePreview = null; };
  }, []);
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setUrl(null)}>
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt="preview" className="max-w-full max-h-[85vh] rounded-xl shadow-2xl" />
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <button onClick={() => handleOpenExternal(url)} className="p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors" title="在浏览器中打开"><ExternalLink className="w-4 h-4" /></button>
          <button onClick={() => setUrl(null)} className="p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors" title="关闭"><X className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
}

function WebLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <button onClick={(e) => { e.preventDefault(); handleOpenExternal(href); }} className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:opacity-80 cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit" title={`在浏览器中打开: ${href}`}>
      {children || href}
      <ExternalLink className="inline w-3 h-3 ml-0.5 shrink-0 opacity-60" />
    </button>
  );
}

function LocalPathLink({ filePath }: { filePath: string }) {
  const hasDesktop = typeof window !== 'undefined' && !!(window as any).desktopAPI;
  const isImage = IMAGE_EXT_RE.test(filePath);
  return (
    <span className="inline-block">
      {isImage && (
        <span className="block my-1 cursor-pointer group/img relative" onClick={() => _openImagePreview?.(localPathToSrc(filePath))} title="点击预览">
          <img src={localPathToSrc(filePath)} alt={filePath.split('/').pop() || '图片'} className="max-w-full max-h-[300px] rounded-lg border border-white/10 dark:border-white/[0.06] shadow-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <span className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">点击预览</span>
        </span>
      )}
      <span className="inline-flex items-center gap-0.5 bg-blue-500/10 dark:bg-blue-400/10 rounded px-1.5 py-0.5 text-[13px] font-mono group">
        <FileIcon className="w-3 h-3 shrink-0 text-blue-500 dark:text-blue-400" />
        <span className="text-blue-600 dark:text-blue-400 break-all" title={filePath}>{filePath}</span>
        {hasDesktop && (
          <>
            <button onClick={() => handleOpenFile(filePath)} className="ml-1 p-0.5 rounded hover:bg-blue-500/20 transition-colors text-blue-500 dark:text-blue-400" title="打开文件"><ExternalLink className="w-3 h-3" /></button>
            <button onClick={() => handleShowInFolder(filePath)} className="p-0.5 rounded hover:bg-blue-500/20 transition-colors text-blue-500 dark:text-blue-400" title="打开所在位置"><FolderOpen className="w-3 h-3" /></button>
          </>
        )}
      </span>
    </span>
  );
}

// ========== Text with path detection ==========

function processTextWithPaths(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  LOCAL_PATH_RE.lastIndex = 0;
  while ((match = LOCAL_PATH_RE.exec(text)) !== null) {
    const fullMatch = match[1];
    const matchStart = match.index + (match[0].length - fullMatch.length);
    if (matchStart > lastIdx) result.push(text.slice(lastIdx, matchStart));
    result.push(<LocalPathLink key={`lp-${matchStart}`} filePath={fullMatch} />);
    lastIdx = matchStart + fullMatch.length;
  }
  if (lastIdx < text.length) result.push(text.slice(lastIdx));
  return result.length > 0 ? result : [text];
}

function withPathDetection(children: React.ReactNode): React.ReactNode {
  if (typeof children === 'string') {
    const nodes = processTextWithPaths(children);
    return nodes.length === 1 && typeof nodes[0] === 'string' ? children : <>{nodes}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        const nodes = processTextWithPaths(child);
        return nodes.length === 1 && typeof nodes[0] === 'string' ? child : <span key={i}>{nodes}</span>;
      }
      return child;
    });
  }
  return children;
}

// ========== Markdown ==========

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
  const codeTrimmed = code.trim();
  const isSingleLine = codeTrimmed.split('\n').length === 1;
  const isPathContent = isSingleLine && /^\/[\w.@\-\u4e00-\u9fff\/]+$/.test(codeTrimmed);
  const isUrlContent = isSingleLine && /^https?:\/\/\S+$/.test(codeTrimmed);
  const hasDesktopAPI = typeof window !== 'undefined' && !!(window as any).desktopAPI;
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-white/15 dark:border-white/[0.06]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 text-blue-400">
        <span className="text-[11px] font-mono">{language || 'code'}</span>
        <div className="flex items-center gap-1">
          {isUrlContent && (
            <button onClick={() => handleOpenExternal(codeTrimmed)} className="px-2 py-0.5 rounded text-[11px] hover:bg-gray-700 flex items-center gap-1 transition-colors text-blue-400" title="在浏览器中打开"><ExternalLink size={12} /><span>打开链接</span></button>
          )}
          {isPathContent && hasDesktopAPI && (
            <>
              <button onClick={() => { const p = codeTrimmed; if (p.endsWith('/') || !p.includes('.')) { if ((window as any).desktopAPI?.openFolder) (window as any).desktopAPI.openFolder(p); } else { handleOpenFile(p); } }} className="px-2 py-0.5 rounded text-[11px] hover:bg-gray-700 flex items-center gap-1 transition-colors text-blue-400" title={codeTrimmed.endsWith('/') || !codeTrimmed.includes('.') ? '打开目录' : '打开文件'}><ExternalLink size={12} /><span>{codeTrimmed.endsWith('/') || !codeTrimmed.includes('.') ? '打开目录' : '打开文件'}</span></button>
              <button onClick={() => handleShowInFolder(codeTrimmed)} className="px-2 py-0.5 rounded text-[11px] hover:bg-gray-700 flex items-center gap-1 transition-colors text-blue-400" title="在 Finder 中显示"><FolderOpen size={12} /><span>定位</span></button>
            </>
          )}
          <button onClick={handleCopy} className="px-2 py-0.5 rounded text-[11px] hover:bg-gray-700 flex items-center gap-1 transition-colors text-blue-400" title="复制">{copied ? <Check size={12} /> : <Copy size={12} />}<span>{copied ? '已复制' : '复制'}</span></button>
        </div>
      </div>
      <pre className="bg-gray-900 text-gray-100 p-3 overflow-x-auto text-xs leading-5 m-0 whitespace-pre-wrap break-words max-w-full">{children}</pre>
    </div>
  );
}

const mdComponents = {
  p: ({ children }: any) => <p className="mb-2 last:mb-0 break-words">{withPathDetection(children)}</p>,
  strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
  code: ({ children, className }: any) => {
    if (!className && typeof children === 'string') {
      const trimmed = children.trim();
      if (isLocalPath(trimmed)) return <LocalPathLink filePath={trimmed} />;
      if (isWebUrl(trimmed)) return <WebLink href={trimmed}><code className="bg-white/15 dark:bg-white/10 px-1.5 py-0.5 rounded text-[13px] font-mono text-primary">{children}</code></WebLink>;
    }
    return className
      ? <code className={className}>{children}</code>
      : <code className="bg-white/15 dark:bg-white/10 px-1.5 py-0.5 rounded text-[13px] font-mono text-pink-600 dark:text-pink-400">{children}</code>;
  },
  pre: ({ children }: any) => <CodeBlock>{children}</CodeBlock>,
  ul: ({ children }: any) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
  li: ({ children }: any) => <li className="mb-0.5 break-words">{withPathDetection(children)}</li>,
  h1: ({ children }: any) => <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-sm font-bold mb-1.5 mt-2">{children}</h3>,
  blockquote: ({ children }: any) => <blockquote className="border-l-3 border-violet-300 dark:border-violet-500/40 pl-3 my-2 text-text-secondary italic">{children}</blockquote>,
  a: ({ href, children }: any) => {
    if (href && isImageUrl(href)) return <InlineImage src={href} alt={typeof children === 'string' ? children : undefined} />;
    if (href && isLocalPath(href)) return <LocalPathLink filePath={href} />;
    if (href && isWebUrl(href)) return <WebLink href={href}>{children}</WebLink>;
    return <WebLink href={href || '#'}>{children}</WebLink>;
  },
  img: ({ src, alt }: any) => {
    if (src && typeof src === 'string') return <InlineImage src={src} alt={alt} />;
    return null;
  },
  table: ({ children }: any) => <div className="overflow-x-auto my-2"><table className="min-w-full text-xs border-collapse border border-border-subtle">{children}</table></div>,
  thead: ({ children }: any) => <thead>{children}</thead>,
  tbody: ({ children }: any) => <tbody>{children}</tbody>,
  tr: ({ children }: any) => <tr className="border-b border-border-subtle">{children}</tr>,
  th: ({ children }: any) => <th className="px-3 py-1.5 bg-bg-subtle border border-border-subtle text-left font-medium">{children}</th>,
  td: ({ children }: any) => <td className="px-3 py-1.5 border border-border-subtle">{withPathDetection(children)}</td>,
  hr: () => <hr className="my-3 border-border-subtle" />,
};

// ========== Formatted Message Content ==========

function FormattedMessageContent({ content, interactionMode }: { content: string; interactionMode?: InteractionMode }) {
  const displayContent = (() => {
    const trimmed = content.trim();
    if (interactionMode === 'no_ai' && trimmed.startsWith('#')) return trimmed.slice(1).trim();
    return content;
  })();

  if (interactionMode === 'mention' && displayContent.trim().startsWith('@')) {
    const trimmed = displayContent.trim();
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx > 1) {
      const mentionName = trimmed.slice(0, spaceIdx);
      const rest = trimmed.slice(spaceIdx + 1).trim();
      return (
        <>
          <span className="inline-block text-blue-500 dark:text-blue-400 font-medium bg-blue-500/10 px-1 rounded mr-1">{mentionName}</span>
          {rest && <MarkdownContent content={rest} />}
        </>
      );
    }
    return <span className="inline-block text-blue-500 dark:text-blue-400 font-medium bg-blue-500/10 px-1 rounded">{trimmed}</span>;
  }

  return <MarkdownContent content={displayContent} />;
}

function MarkdownContent({ content }: { content: string }) {
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

// ========== Tool Result Block ==========

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
    <div className="flex gap-2.5 ml-10 mr-2">
      <div className="flex-1 min-w-0 max-w-full">
        <button onClick={() => hasContent && setExpanded(!expanded)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${bgClass} ${borderClass} ${hasContent ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}>
          {hasContent ? (expanded ? <ChevronDown className={`w-3.5 h-3.5 shrink-0 ${color}`} /> : <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${color}`} />) : <Icon className={`w-4 h-4 shrink-0 ${color}`} />}
          <Icon className={`w-4 h-4 shrink-0 ${color}`} />
          <span className={`text-xs font-medium ${color}`}>{label}</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono shrink-0">{toolName}</span>
          {filePath && <span className="text-[10px] text-text-secondary font-mono truncate min-w-0" title={filePath}>{truncatePath(filePath)}</span>}
          {isError && <span className="text-[10px] text-red-500 ml-auto">error</span>}
        </button>
        {expanded && hasContent && (
          <div className={`mt-1 p-2 rounded-lg border ${bgClass} ${borderClass} max-h-60 overflow-y-auto`}>
            <pre className={`text-[11px] font-mono whitespace-pre-wrap break-words ${isError ? 'text-red-600 dark:text-red-400' : 'text-text-main'}`}>{content}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ========== Conversation Stats Display ==========

export function ConversationStatsDisplay({ stats }: { stats: {
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number };
  num_turns?: number;
} }) {
  return (
    <div className="text-[10px] text-slate-400 dark:text-slate-500 flex flex-wrap items-center gap-x-1 mt-1">
      {stats.duration_ms !== undefined && (
        <>
          <span>{(stats.duration_ms / 1000).toFixed(1)}s</span>
          {stats.duration_api_ms !== undefined && <span className="text-slate-300 dark:text-slate-600">(API {(stats.duration_api_ms / 1000).toFixed(1)}s)</span>}
        </>
      )}
      {stats.total_cost_usd !== undefined && (
        <><span className="text-slate-300 dark:text-slate-600">/</span><span>${stats.total_cost_usd.toFixed(4)}</span></>
      )}
      {stats.usage && (
        <>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <span>{((stats.usage.inputTokens || 0) / 1000).toFixed(1)}K in</span>
          <span>{((stats.usage.outputTokens || 0) / 1000).toFixed(1)}K out</span>
          {stats.usage.cacheReadInputTokens && stats.usage.cacheReadInputTokens > 0 && <span className="text-slate-300 dark:text-slate-600">({(stats.usage.cacheReadInputTokens / 1000).toFixed(1)}K cached)</span>}
        </>
      )}
      {stats.num_turns !== undefined && (
        <><span className="text-slate-300 dark:text-slate-600">/</span><span>{stats.num_turns} turns</span></>
      )}
    </div>
  );
}

// ========== Main Component ==========

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  localPeerId?: string;
}

export default function ChatMessageBubble({ message, isStreaming, localPeerId }: ChatMessageBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const isSystem = message.messageType === 'system';
  const isSkillResult = message.messageType === 'skill_result';
  const isToolUse = message.messageType === 'tool_use';
  const isToolResult = message.messageType === 'tool_result';
  const isAI = message.senderId === 'ai-assistant';
  const isSelf = !!localPeerId && message.senderId === localPeerId;

  const meta = message.metadata as Record<string, any> | undefined;

  if (isSystem) {
    return (
      <div className="text-center py-1">
        <span className="text-[11px] text-text-secondary/50 bg-white/15 dark:bg-white/[0.03] px-3 py-1 rounded-full">{message.content}</span>
      </div>
    );
  }

  if (isSkillResult) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl text-sm">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium mb-1"><Zap className="w-4 h-4" /><span>技能调用结果</span></div>
          <p className="text-text-main text-xs">{message.content}</p>
          {message.skillResult && (
            <div className="mt-2 text-[10px] text-text-secondary">
              耗时 {message.skillResult.executionTime}ms
              {!message.skillResult.success && message.skillResult.error && <span className="text-red-500 ml-2">错误: {message.skillResult.error}</span>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Tool use/result — support summary mode (from SecretaryPanel)
  if (isToolUse || isToolResult) {
    const pendingTools = meta?.pendingTools as Array<{ toolName: string; action?: string; filePath?: string; toolInput?: Record<string, unknown>; }> | undefined;
    const completedTools = meta?.completedTools as Array<{ toolName: string; action?: string; filePath?: string; toolInput?: Record<string, unknown>; toolResponse?: string; toolError?: string; isError?: boolean }> | undefined;
    const isSummaryMode = pendingTools || completedTools;
    const toolStatus = meta?.toolStatus as string | undefined;
    const isCompleted = toolStatus === 'completed';
    const conversationStats = meta?.conversationStats as any;

    if (isSummaryMode) {
      const pendingCount = pendingTools?.length || 0;
      const completedCount = completedTools?.length || 0;
      const totalCount = pendingCount + completedCount;
      const hasError = completedTools?.some(t => t.isError);

      const formatToolInput = (input?: Record<string, unknown>): string => {
        if (!input) return '';
        const keys = ['file_path', 'filePath', 'path', 'command', 'pattern', 'query', 'content', 'instruction'];
        for (const key of keys) {
          if (input[key]) { const val = String(input[key]); return val.length > 60 ? val.slice(0, 60) + '...' : val; }
        }
        const firstKey = Object.keys(input)[0];
        if (firstKey && input[firstKey]) { const val = String(input[firstKey]); return val.length > 60 ? val.slice(0, 60) + '...' : val; }
        return '';
      };

      const renderToolItem = (
        tool: { toolName: string; action?: string; filePath?: string; toolInput?: Record<string, unknown>; toolResponse?: string; toolError?: string; isError?: boolean },
        status: 'pending' | 'completed',
        idx: number
      ) => {
        const cfg = tool.isError ? { icon: AlertCircle, label: '失败', color: 'text-red-600 dark:text-red-400' } : getActionConfig(tool.action);
        const Icon = cfg.icon;
        const displayPath = tool.filePath || formatToolInput(tool.toolInput);
        const hasResponse = tool.toolResponse && tool.toolResponse.length > 0;
        return (
          <div key={`${status}-${idx}-${tool.toolName}`} className="py-1.5 border-b border-black/5 dark:border-white/5 last:border-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Icon className={`w-3.5 h-3.5 shrink-0 ${cfg.color}`} />
              <span className={`text-[11px] font-medium ${cfg.color}`}>{cfg.label}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono">{tool.toolName}</span>
              {status === 'pending' && <span className="text-[10px] text-purple-500 animate-pulse">执行中...</span>}
              {tool.isError && <span className="text-[10px] text-red-500">失败</span>}
            </div>
            {displayPath && <div className="mt-1 ml-5 text-[10px] text-text-secondary font-mono bg-black/[0.03] dark:bg-white/[0.03] px-2 py-1 rounded truncate" title={displayPath}>{displayPath}</div>}
            {hasResponse && (
              <details className="mt-1 ml-5">
                <summary className="text-[10px] text-blue-500 cursor-pointer hover:underline">查看结果</summary>
                <pre className="mt-1 text-[10px] text-text-secondary bg-black/[0.03] dark:bg-white/[0.03] p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">{tool.toolResponse!.length > 500 ? tool.toolResponse!.slice(0, 500) + '\n...(truncated)' : tool.toolResponse}</pre>
              </details>
            )}
            {tool.toolError && <div className="mt-1 ml-5 text-[10px] text-red-500 bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded">{tool.toolError.length > 300 ? tool.toolError.slice(0, 300) + '...' : tool.toolError}</div>}
          </div>
        );
      };

      return (
        <div className="flex flex-col gap-1 ml-10 mr-2">
          <button onClick={() => setExpanded(!expanded)} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left ${isCompleted ? hasError ? 'bg-red-50/60 dark:bg-red-500/[0.06] border-red-200/50 dark:border-red-500/20' : 'bg-green-50/60 dark:bg-green-500/[0.06] border-green-200/50 dark:border-green-500/20' : 'bg-purple-50/60 dark:bg-purple-500/[0.06] border-purple-200/50 dark:border-purple-500/20'}`}>
            {isCompleted ? (hasError ? <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" /> : <Check className="w-4 h-4 shrink-0 text-green-600 dark:text-green-400" />) : <Terminal className="w-4 h-4 shrink-0 text-purple-600 dark:text-purple-400 animate-pulse" />}
            <span className={`text-xs font-medium ${isCompleted ? hasError ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400' : 'text-purple-600 dark:text-purple-400'}`}>{isCompleted ? (hasError ? '部分完成' : '执行完成') : '执行中'}</span>
            <span className="text-[10px] text-text-secondary">共 {totalCount} 个工具调用</span>
            {expanded ? <ChevronDown className="w-3.5 h-3.5 text-text-secondary ml-auto" /> : <ChevronRight className="w-3.5 h-3.5 text-text-secondary ml-auto" />}
          </button>
          {expanded && (
            <div className="ml-4 pl-3 border-l-2 border-purple-200 dark:border-purple-500/30 space-y-0.5">
              {pendingTools?.map((t, i) => renderToolItem(t, 'pending', i))}
              {completedTools?.map((t, i) => renderToolItem(t, 'completed', i))}
            </div>
          )}
          {isCompleted && conversationStats && <div className="mt-1 ml-2"><ConversationStatsDisplay stats={conversationStats} /></div>}
        </div>
      );
    }

    // Single tool mode (fallback)
    const toolName = (meta?.toolName as string) || 'tool';
    const action = (meta?.action as string) || undefined;
    const filePath = meta?.filePath as string | undefined;
    const isError = !!meta?.isError;
    const toolResponse = (meta?.toolResponse as string) || '';
    const toolError = (meta?.toolError as string) || '';

    const cfg = isError
      ? { icon: AlertCircle, label: '失败', color: 'text-red-600 dark:text-red-400', bgClass: 'bg-red-50/60 dark:bg-red-500/[0.06]', borderClass: 'border-red-200/50 dark:border-red-500/20' }
      : getActionConfig(action);
    const Icon = cfg.icon;

    if (isToolUse) {
      return (
        <div className="flex gap-2.5 ml-10 mr-2 overflow-hidden">
          <div className="flex-1 min-w-0 max-w-full">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border overflow-hidden flex-wrap ${cfg.bgClass} ${cfg.borderClass}`}>
              <Icon className={`w-4 h-4 shrink-0 ${cfg.color}`} />
              <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono shrink-0">{toolName}</span>
              {filePath && <span className="text-[10px] text-text-secondary font-mono truncate min-w-0" title={filePath}>{truncatePath(filePath)}</span>}
            </div>
          </div>
        </div>
      );
    }

    const displayContent = isError ? toolError : (toolResponse || message.content);
    return <ToolResultBlock icon={cfg.icon} label={cfg.label} color={cfg.color} bgClass={cfg.bgClass} borderClass={cfg.borderClass} toolName={toolName} filePath={filePath} content={displayContent} isError={isError} />;
  }

  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const conversationStats = meta?.conversationStats as any;

  return (
    <div className={`flex gap-3 max-w-3xl group overflow-hidden ${isSelf ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}>
      {/* Avatar */}
      <div className="shrink-0">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium shadow-sm ${
          isAI
            ? 'bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-500/15 dark:to-blue-500/15 text-violet-600 dark:text-violet-400'
            : isSelf
              ? 'bg-white/20 dark:bg-white/10 border border-white/20 dark:border-white/10 text-text-main'
              : 'bg-primary/10 text-primary border border-primary/10'
        }`}>
          {isAI ? '✨' : message.senderName.charAt(0)}
        </div>
      </div>
      {/* Content */}
      <div className={`flex flex-col gap-1 min-w-0 ${isSelf ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-baseline gap-2 ${isSelf ? 'flex-row-reverse' : ''}`}>
          <span className={`text-[13px] font-medium ${isAI ? 'text-violet-600 dark:text-violet-400' : 'text-text-main'}`}>{message.senderName}</span>
          <span className="text-[10px] text-text-secondary/40">{time}</span>
          {isAI && <span className="text-[9px] px-1.5 py-0.5 bg-violet-500/10 text-violet-500 dark:text-violet-400 rounded-md font-medium">AI</span>}
          {isStreaming && <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 text-blue-500 dark:text-blue-400 rounded-md animate-pulse font-medium">生成中...</span>}
          {message.interactionMode === 'mention' && <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 text-blue-500 dark:text-blue-400 rounded-md">@提及</span>}
          {message.interactionMode === 'skill_invoke' && <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/10 text-purple-500 dark:text-purple-400 rounded-md">技能调用</span>}
          {message.interactionMode === 'no_ai' && <span className="text-[9px] px-1.5 py-0.5 bg-gray-500/10 text-gray-500 dark:text-gray-400 rounded-md">纯文本</span>}
        </div>
        <div className={`p-3.5 text-sm leading-relaxed break-words overflow-hidden max-w-full ${
          isSelf
            ? 'bg-primary text-white rounded-2xl rounded-tr-none shadow-lg shadow-primary/20'
            : isAI
              ? 'bg-white/40 dark:bg-[rgba(30,41,59,0.7)] backdrop-blur-md rounded-2xl rounded-tl-none border border-white/50 dark:border-white/[0.08] text-text-main shadow-sm'
              : 'bg-white/40 dark:bg-white/[0.06] backdrop-blur-sm rounded-2xl rounded-tl-none border border-white/30 dark:border-white/[0.06] text-text-main shadow-sm'
        }`}>
          <div className={`break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${isSelf ? '[&_code]:bg-white/20 [&_a]:text-white [&_a]:underline' : ''}`}>
            <FormattedMessageContent content={message.content} interactionMode={message.interactionMode} />
          </div>
          {isStreaming && !message.content && (
            <div className="flex items-center gap-1 text-violet-400">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
        </div>
        {/* Image message rendering */}
        {meta?.imageInfo && (
          <div className="mt-2 max-w-xs">
            {(meta.imageInfo as any).url ? (
              <div className="relative group">
                <img
                  src={(meta.imageInfo as any).url}
                  alt="图片消息"
                  className="rounded-lg max-w-full cursor-pointer hover:opacity-90 transition-opacity border border-border-subtle"
                  style={{ maxWidth: Math.min((meta.imageInfo as any).width || 300, 300), maxHeight: 400 }}
                  onClick={() => _openImagePreview?.((meta.imageInfo as any).url)}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white" onClick={(e) => { e.stopPropagation(); _openImagePreview?.((meta.imageInfo as any).url); }} title="查看原图">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M14 10l6.1-6.1M9 21H3v-6M10 14l-6.1 6.1" /></svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-gray-100 dark:bg-slate-700 rounded-lg text-text-secondary text-xs flex items-center gap-2">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                <span>图片{(meta.imageInfo as any).downloadError ? ' - 加载失败' : ''}</span>
              </div>
            )}
          </div>
        )}
        {/* File attachment rendering */}
        {meta?.fileInfo && (() => {
          const fileInfo = meta.fileInfo as any;
          const hasLocalPath = !!fileInfo.localPath;
          const isElectron = typeof window !== 'undefined' && 'desktopAPI' in window;
          const canOpenLocally = hasLocalPath && isElectron;
          const handleClick = async () => {
            if (canOpenLocally) {
              try {
                const result = await (window as any).desktopAPI.openFile(fileInfo.localPath);
                if (!result.success && fileInfo.url) {
                  const a = document.createElement('a'); a.href = `${fileInfo.url}?download=true`; a.download = fileInfo.name || 'download'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
                }
              } catch { /* ignore */ }
            } else if (fileInfo.url) {
              const a = document.createElement('a'); a.href = `${fileInfo.url}?download=true`; a.download = fileInfo.name || 'download'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
            }
          };
          return (
            <div className="mt-2 flex items-center gap-3 px-3 py-2.5 bg-white/40 dark:bg-slate-800/40 rounded-lg border border-border-subtle hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors cursor-pointer max-w-xs" onClick={handleClick}>
              <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 shrink-0">{getFileIcon(fileInfo.fileType || fileInfo.mimeType || '')}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{fileInfo.name}</div>
                <div className="text-xs text-text-secondary">{fileInfo.size ? formatFileSize(fileInfo.size) : '未知大小'}{fileInfo.downloadError && <span className="text-red-500 ml-2">下载失败</span>}</div>
              </div>
              {canOpenLocally ? (
                <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium shrink-0">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3l14 9-14 9V3z" fill="currentColor" /></svg>打开
                </div>
              ) : fileInfo.url ? (
                <svg className="w-5 h-5 text-text-secondary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              ) : null}
            </div>
          );
        })()}
        {/* Voice message rendering */}
        {meta?.voiceInfo && (
          <div className="mt-1.5 w-full max-w-xs">
            {(meta.voiceInfo as any).url ? (
              <VoicePlayer url={(meta.voiceInfo as any).url} duration={(meta.voiceInfo as any).duration} transcription={(meta.voiceInfo as any).transcription} />
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-slate-700 text-text-secondary">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
                  </div>
                  <div className="flex-1 h-1.5 bg-gray-200 dark:bg-slate-600 rounded-full" />
                  <span className="text-[11px] text-text-secondary min-w-[40px] text-right tabular-nums">{(meta.voiceInfo as any).duration ? `0:${String((meta.voiceInfo as any).duration).padStart(2, '0')}` : '--:--'}</span>
                </div>
                {(meta.voiceInfo as any).transcription && <div className="text-xs text-text-secondary pl-10 border-l-2 border-primary/20 ml-1">{(meta.voiceInfo as any).transcription}</div>}
              </div>
            )}
          </div>
        )}
        {/* File info from original ChatMessage.fileInfo (non-metadata) */}
        {!meta?.fileInfo && message.fileInfo && (
          <div className="mt-1 flex items-center gap-2 px-3 py-2 bg-white/30 dark:bg-slate-800/30 rounded-lg border border-border-subtle text-xs">
            {message.messageType === 'image' ? '🖼️' : '📎'}
            <span className="truncate">{message.fileInfo.name}</span>
            <span className="text-text-secondary">({(message.fileInfo.size / 1024).toFixed(1)}KB)</span>
          </div>
        )}
        {/* Conversation stats for AI messages */}
        {isAI && !isToolUse && !isToolResult && !isSkillResult && conversationStats && (
          <ConversationStatsDisplay stats={conversationStats} />
        )}
        {message.status === 'failed' && <span className="text-[10px] text-red-500 mt-1 inline-block">发送失败</span>}
      </div>
    </div>
  );
}


'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  ArrowUp,
  Bot,
  Settings,
  Trash2,
  X,
  Square,
  Clock,
  Plus,
  Minus,
  Play,
  Save,
  ChevronDown,
  ChevronRight,
  FileText,
  FilePlus,
  FileEdit,
  Search,
  Terminal,
  Sparkles,
  AlertCircle,
  Copy,
  Check,
  Zap,
  Paperclip,
  Mic,
  MicOff,
  User,
  FileText as FileTextIcon,
  Send,
  ScrollText,
  Filter,
  ExternalLink,
  FolderOpen,
  FileIcon,
  MessageSquare,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { Employee } from '@/types/backend/employee';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import VoicePlayer from './VoicePlayer';

const API_BASE = '';

// ========== Helper Functions ==========

/** Format file size to human readable string */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Get file icon based on file type */
function getFileIcon(fileType: string): React.ReactNode {
  const type = fileType?.toLowerCase() || '';
  // PDF
  if (type.includes('pdf')) {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M10 12h4" />
        <path d="M10 16h4" />
      </svg>
    );
  }
  // Word documents
  if (type.includes('doc') || type.includes('word')) {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    );
  }
  // Excel/Spreadsheet
  if (type.includes('xls') || type.includes('excel') || type.includes('spreadsheet') || type.includes('csv')) {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <rect x="8" y="12" width="8" height="6" />
      </svg>
    );
  }
  // PowerPoint
  if (type.includes('ppt') || type.includes('presentation')) {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <rect x="8" y="11" width="8" height="5" rx="1" />
      </svg>
    );
  }
  // Archive files
  if (type.includes('zip') || type.includes('rar') || type.includes('7z') || type.includes('tar') || type.includes('gz')) {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <line x1="9" y1="14" x2="15" y2="14" />
      </svg>
    );
  }
  // Images
  if (type.includes('image') || type.includes('jpg') || type.includes('jpeg') || type.includes('png') || type.includes('gif') || type.includes('webp')) {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    );
  }
  // Video
  if (type.includes('video') || type.includes('mp4') || type.includes('avi') || type.includes('mov')) {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    );
  }
  // Audio
  if (type.includes('audio') || type.includes('mp3') || type.includes('wav') || type.includes('m4a')) {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  // Default file icon
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

// ========== Types ==========

interface SecretaryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  messageType: 'text' | 'tool_use' | 'tool_result' | 'system' | 'skill_result' | 'image' | 'file' | 'voice';
  content: string;
  senderId: string;
  senderName: string;
  interactionMode?: 'mention' | 'no_ai' | 'skill_invoke' | 'text' | 'plain' | 'ai_chat';
  requestId?: string;
  toolStatus?: 'pending' | 'completed'; // pending: executing, completed: done
  toolKey?: string; // unique key for matching tool_use with tool_result
  metadata?: Record<string, unknown> & {
    skillResult?: {
      executionTime?: number;
      success?: boolean;
      error?: string;
    };
    fileInfo?: {
      id?: string | null;
      url?: string | null;
      localPath?: string | null;
      name: string;
      size?: number | null;
      mimeType?: string | null;
      fileType?: string | null;
      downloadError?: string | null;
    };
    voiceInfo?: {
      id: string;
      url: string;
      duration: number;
      format: string;
      size?: number;
      transcription?: string;
    };
    imageInfo?: {
      id?: string | null;
      url?: string | null;
      width?: number | null;
      height?: number | null;
      format?: string | null;
      size?: number | null;
      downloadError?: string | null;
    };
    toolResponse?: string;
    toolError?: string;
    isError?: boolean;
  };
  createdAt: string;
  isStreaming?: boolean;
  actions?: Array<{
    type: 'dispatch';
    employeeId: string;
    employeeName: string;
    projectId: string;
  }>;
  conversationStats?: {
    duration_ms?: number;
    duration_api_ms?: number;
    total_cost_usd?: number;
    usage?: { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number };
    num_turns?: number;
  };
}

interface SecretaryScheduledMessage {
  id: string;
  content: string;
  scheduleType: 'interval' | 'daily';
  intervalMinutes?: number;
  scheduledTime?: string;
  aiReply: boolean;
  enabled: boolean;
  lastSentAt?: number;
  /** Whether to send the result to IM channel */
  sendToIM?: boolean;
  /** Target IM platform (wechat_personal, dingtalk, feishu, qq) */
  imPlatform?: string;
  /** Target conversation ID (user_id / group_id) */
  imConversationId?: string;
  /** Display name for the conversation (optional, for UI) */
  imConversationName?: string;
}

interface IMChannelStatus {
  platform: string;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  configured: boolean;
}

interface SkillInfo {
  name: string;
  displayName?: string;
  description: string;
  hasSkill: boolean;
  hasApp: boolean;
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

/** Get display name for IM platform */
function getPlatformDisplayName(platform: string): string {
  const platformNames: Record<string, string> = {
    wechat_personal: '微信个人号',
    dingtalk: '钉钉',
    feishu: '飞书',
    qq: 'QQ',
  };
  return platformNames[platform] || platform;
}

function truncatePath(p?: string, max = 50): string {
  if (!p) return '';
  return p.length > max ? '...' + p.slice(-max) : p;
}

// ========== Markdown components ==========

function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractTextFromChildren((children.props as { children?: React.ReactNode }).children);
  }
  return String(children ?? '');
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  let language: string | undefined;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object' && 'props' in child) {
        const className = (child.props as { className?: string })?.className;
        if (typeof className === 'string') {
          const m = /language-(\w+)/.exec(className);
          if (m) language = m[1];
        }
      }
    }
  }
  const code = extractTextFromChildren(children);
  const codeTrimmed = code.trim();
  // Detect if the entire code block is a single local path/directory or URL
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
            <button
              onClick={() => handleOpenExternal(codeTrimmed)}
              className="px-2 py-0.5 rounded text-[11px] hover:bg-gray-700 flex items-center gap-1 transition-colors text-blue-400"
              title="在浏览器中打开"
            >
              <ExternalLink size={12} />
              <span>打开链接</span>
            </button>
          )}
          {isPathContent && hasDesktopAPI && (
            <>
              <button
                onClick={() => {
                  const p = codeTrimmed;
                  if (p.endsWith('/') || !p.includes('.')) {
                    if ((window as any).desktopAPI?.openFolder) (window as any).desktopAPI.openFolder(p);
                  } else {
                    handleOpenFile(p);
                  }
                }}
                className="px-2 py-0.5 rounded text-[11px] hover:bg-gray-700 flex items-center gap-1 transition-colors text-blue-400"
                title={codeTrimmed.endsWith('/') || !codeTrimmed.includes('.') ? '打开目录' : '打开文件'}
              >
                <ExternalLink size={12} />
                <span>{codeTrimmed.endsWith('/') || !codeTrimmed.includes('.') ? '打开目录' : '打开文件'}</span>
              </button>
              <button
                onClick={() => handleShowInFolder(codeTrimmed)}
                className="px-2 py-0.5 rounded text-[11px] hover:bg-gray-700 flex items-center gap-1 transition-colors text-blue-400"
                title="在 Finder 中显示"
              >
                <FolderOpen size={12} />
                <span>定位</span>
              </button>
            </>
          )}
          <button onClick={handleCopy} className="px-2 py-0.5 rounded text-[11px] hover:bg-gray-700 flex items-center gap-1 transition-colors text-blue-400" title="复制">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      </div>
      <pre className="bg-gray-900 text-gray-100 p-3 overflow-x-auto text-xs leading-5 m-0 whitespace-pre-wrap break-words max-w-full">{children}</pre>
    </div>
  );
}

// ========== Helper: detect local file path ==========
// Require at least 2 path segments to avoid matching API endpoints like /todos, /messages
const LOCAL_PATH_RE = /(?:^|\s)(\/[\w.@\-\u4e00-\u9fff]+(?:\/[\w.@\-\u4e00-\u9fff]+)+\/?)/g;
const isLocalPath = (s: string) => /^\/[\w.@\-\u4e00-\u9fff]+\//.test(s) && !s.startsWith('http');
const isWebUrl = (s: string) => /^https?:\/\//.test(s);
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i;
const isImageUrl = (s: string) => isWebUrl(s) && IMAGE_EXT_RE.test(s);
const isLocalImagePath = (s: string) => isLocalPath(s) && IMAGE_EXT_RE.test(s);
/** Convert local absolute path to API URL for serving */
const localPathToSrc = (p: string) => `/api/local-file?path=${encodeURIComponent(p)}`;

// Module-level callback for image preview overlay (connected by ImagePreviewOverlay component)
let _openImagePreview: ((url: string) => void) | null = null;

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
    // fallback: open parent directory
    const parent = filePath.replace(/\/[^\/]+$/, '') || '/';
    (window as any).desktopAPI.openFolder(parent);
  }
}

/** Inline image with click-to-preview */
function InlineImage({ src, alt }: { src: string; alt?: string }) {
  return (
    <span
      className="inline-block my-1 cursor-pointer group/img relative"
      onClick={() => _openImagePreview?.(src)}
      title="点击预览"
    >
      <img
        src={src}
        alt={alt || '图片'}
        className="max-w-full max-h-[300px] rounded-lg border border-white/10 dark:border-white/[0.06] shadow-sm transition-transform group-hover/img:shadow-md"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <span className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">点击预览</span>
    </span>
  );
}

/** Image preview overlay - rendered inside SecretaryPanel, connected via module-level callback */
function ImagePreviewOverlay() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    _openImagePreview = (u: string) => setUrl(u);
    return () => { _openImagePreview = null; };
  }, []);
  if (!url) return null;
  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={() => setUrl(null)}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt="preview" className="max-w-full max-h-[85vh] rounded-xl shadow-2xl" />
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <button
            onClick={() => handleOpenExternal(url)}
            className="p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors" title="在浏览器中打开"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={() => setUrl(null)}
            className="p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors" title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Render a web URL link that opens in external browser */
function WebLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); handleOpenExternal(href); }}
      className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:opacity-80 cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit"
      title={`在浏览器中打开: ${href}`}
    >
      {children || href}
      <ExternalLink className="inline w-3 h-3 ml-0.5 shrink-0 opacity-60" />
    </button>
  );
}

/** Render a local file path with open / reveal actions */
function LocalPathLink({ filePath }: { filePath: string }) {
  const hasDesktop = typeof window !== 'undefined' && !!(window as any).desktopAPI;
  const isImage = IMAGE_EXT_RE.test(filePath);

  return (
    <span className="inline-block">
      {/* If it's a local image, show it inline */}
      {isImage && (
        <span
          className="block my-1 cursor-pointer group/img relative"
          onClick={() => _openImagePreview?.(localPathToSrc(filePath))}
          title="点击预览"
        >
          <img
            src={localPathToSrc(filePath)}
            alt={filePath.split('/').pop() || '图片'}
            className="max-w-full max-h-[300px] rounded-lg border border-white/10 dark:border-white/[0.06] shadow-sm"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">点击预览</span>
        </span>
      )}
      {/* Path tag with action buttons */}
      <span className="inline-flex items-center gap-0.5 bg-blue-500/10 dark:bg-blue-400/10 rounded px-1.5 py-0.5 text-[13px] font-mono group">
        <FileIcon className="w-3 h-3 shrink-0 text-blue-500 dark:text-blue-400" />
        <span className="text-blue-600 dark:text-blue-400 break-all" title={filePath}>{filePath}</span>
        {hasDesktop && (
          <>
            <button
              onClick={() => handleOpenFile(filePath)}
              className="ml-1 p-0.5 rounded hover:bg-blue-500/20 transition-colors text-blue-500 dark:text-blue-400" title="打开文件"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
            <button
              onClick={() => handleShowInFolder(filePath)}
              className="p-0.5 rounded hover:bg-blue-500/20 transition-colors text-blue-500 dark:text-blue-400" title="打开所在位置"
            >
              <FolderOpen className="w-3 h-3" />
            </button>
          </>
        )}
      </span>
    </span>
  );
}

/** Process text children to detect and linkify local paths */
function processTextWithPaths(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  LOCAL_PATH_RE.lastIndex = 0;
  while ((match = LOCAL_PATH_RE.exec(text)) !== null) {
    const fullMatch = match[1];
    const matchStart = match.index + (match[0].length - fullMatch.length);
    if (matchStart > lastIdx) {
      result.push(text.slice(lastIdx, matchStart));
    }
    result.push(<LocalPathLink key={`lp-${matchStart}`} filePath={fullMatch} />);
    lastIdx = matchStart + fullMatch.length;
  }
  if (lastIdx < text.length) result.push(text.slice(lastIdx));
  return result.length > 0 ? result : [text];
}

/** Wrap children to detect local paths in text nodes */
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

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0 break-words">{withPathDetection(children)}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    // If inline code (no className = not inside pre block), check if content is a local path or URL
    if (!className && typeof children === 'string') {
      const trimmed = children.trim();
      if (isLocalPath(trimmed)) {
        return <LocalPathLink filePath={trimmed} />;
      }
      if (isWebUrl(trimmed)) {
        return <WebLink href={trimmed}><code className="bg-white/15 dark:bg-white/10 px-1.5 py-0.5 rounded text-[13px] font-mono text-primary">{children}</code></WebLink>;
      }
    }
    return className
      ? <code className={className}>{children}</code>
      : <code className="bg-white/15 dark:bg-white/10 px-1.5 py-0.5 rounded text-[13px] font-mono text-pink-600 dark:text-pink-400">{children}</code>;
  },
  pre: ({ children }: { children?: React.ReactNode }) => <CodeBlock>{children}</CodeBlock>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-0.5 break-words">{withPathDetection(children)}</li>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-bold mb-1.5 mt-2">{children}</h3>,
  blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="border-l-3 border-violet-300 dark:border-violet-500/40 pl-3 my-2 text-text-secondary italic">{children}</blockquote>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (href && isImageUrl(href)) return <InlineImage src={href} alt={typeof children === 'string' ? children : undefined} />;
    if (href && isLocalPath(href)) return <LocalPathLink filePath={href} />;
    if (href && isWebUrl(href)) return <WebLink href={href}>{children}</WebLink>;
    return <WebLink href={href || '#'}>{children}</WebLink>;
  },
  img: ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    if (src && typeof src === 'string') return <InlineImage src={src} alt={alt} />;
    return null;
  },
  table: ({ children }: { children?: React.ReactNode }) => <div className="overflow-x-auto my-2"><table className="min-w-full text-xs border-collapse border border-border-subtle">{children}</table></div>,
  thead: ({ children }: { children?: React.ReactNode }) => <thead>{children}</thead>,
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr className="border-b border-border-subtle">{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="px-3 py-1.5 bg-bg-subtle border border-border-subtle text-left font-medium">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="px-3 py-1.5 border border-border-subtle">{withPathDetection(children)}</td>,
  hr: () => <hr className="my-3 border-border-subtle" />,
};

// ========== Formatted Message Content ==========

function FormattedMessageContent({ content, interactionMode }: { content: string; interactionMode?: 'mention' | 'no_ai' | 'skill_invoke' | 'text' | 'plain' | 'ai_chat' }) {
  // Handle # prefix for no_ai mode
  const displayContent = (() => {
    const trimmed = content.trim();
    if (interactionMode === 'no_ai' && trimmed.startsWith('#')) {
      return trimmed.slice(1).trim();
    }
    return content;
  })();

  // Handle @mention mode - highlight @name
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
        <button
          onClick={() => hasContent && setExpanded(!expanded)}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${bgClass} ${borderClass} ${hasContent ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        >
          {hasContent ? (
            expanded ? <ChevronDown className={`w-3.5 h-3.5 shrink-0 ${color}`} /> : <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${color}`} />
          ) : (
            <Icon className={`w-4 h-4 shrink-0 ${color}`} />
          )}
          <Icon className={`w-4 h-4 shrink-0 ${color}`} />
          <span className={`text-xs font-medium ${color}`}>{label}</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono shrink-0">{toolName}</span>
          {filePath && (
            <span className="text-[10px] text-text-secondary font-mono truncate min-w-0" title={filePath}>
              {truncatePath(filePath)}
            </span>
          )}
          {isError && <span className="text-[10px] text-red-500 ml-auto">error</span>}
        </button>
        {expanded && hasContent && (
          <div className={`mt-1 p-2 rounded-lg border ${bgClass} ${borderClass} max-h-60 overflow-y-auto`}>
            <pre className={`text-[11px] font-mono whitespace-pre-wrap break-words ${isError ? 'text-red-600 dark:text-red-400' : 'text-text-main'}`}>
              {content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ========== Conversation Stats Display ==========

function ConversationStatsDisplay({ stats }: { stats: {
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
          {stats.duration_api_ms !== undefined && (
            <span className="text-slate-300 dark:text-slate-600">(API {(stats.duration_api_ms / 1000).toFixed(1)}s)</span>
          )}
        </>
      )}
      {stats.total_cost_usd !== undefined && (
        <>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <span>${stats.total_cost_usd.toFixed(4)}</span>
        </>
      )}
      {stats.usage && (
        <>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <span>{((stats.usage.inputTokens || 0) / 1000).toFixed(1)}K in</span>
          <span>{((stats.usage.outputTokens || 0) / 1000).toFixed(1)}K out</span>
          {stats.usage.cacheReadInputTokens && stats.usage.cacheReadInputTokens > 0 && (
            <span className="text-slate-300 dark:text-slate-600">({(stats.usage.cacheReadInputTokens / 1000).toFixed(1)}K cached)</span>
          )}
        </>
      )}
      {stats.num_turns !== undefined && (
        <>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <span>{stats.num_turns} turns</span>
        </>
      )}
    </div>
  );
}

// ========== Message Bubble ==========

function SecretaryMessageBubble({ message, isStreaming }: { message: SecretaryMessage; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isSystem = message.messageType === 'system';
  const isSkillResult = message.messageType === 'skill_result';
  const isToolUse = message.messageType === 'tool_use';
  const isToolResult = message.messageType === 'tool_result';
  const isAI = message.role === 'assistant';
  const isUser = message.role === 'user';

  if (isSystem) {
    return (
      <div className="text-center py-1">
        <span className="text-[11px] text-text-secondary/50 bg-white/15 dark:bg-white/[0.03] px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  // Skill result display - matches ChatMessageBubble
  if (isSkillResult) {
    const skillResult = message.metadata?.skillResult;
    return (
      <div className="max-w-lg mx-auto">
        <div className="p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl text-sm">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium mb-1">
            <Zap className="w-4 h-4" />
            <span>技能调用结果</span>
          </div>
          <p className="text-text-main text-xs">{message.content}</p>
          {skillResult && (
            <div className="mt-2 text-[10px] text-text-secondary">
              耗时 {skillResult.executionTime || 0}ms
              {!skillResult.success && skillResult.error && (
                <span className="text-red-500 ml-2">错误: {skillResult.error}</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Tool use/result unified display - check for summary mode first
  if (isToolUse || isToolResult) {
    const pendingTools = message.metadata?.pendingTools as Array<{ toolName: string; action?: string }> | undefined;
    const completedTools = message.metadata?.completedTools as Array<{ toolName: string; action?: string; isError?: boolean }> | undefined;
    const isSummaryMode = pendingTools || completedTools;
    const isCompleted = message.toolStatus === 'completed';

    // Summary mode: show all tools in one message with expand/collapse
    if (isSummaryMode) {
      const pendingCount = pendingTools?.length || 0;
      const completedCount = completedTools?.length || 0;
      const totalCount = pendingCount + completedCount;
      const hasError = completedTools?.some(t => t.isError);

      // Helper to format tool input for display
      const formatToolInput = (input?: Record<string, unknown>): string => {
        if (!input) return '';
        // Show key parameters concisely
        const keys = ['file_path', 'filePath', 'path', 'command', 'pattern', 'query', 'content', 'instruction'];
        for (const key of keys) {
          if (input[key]) {
            const val = String(input[key]);
            return val.length > 60 ? val.slice(0, 60) + '...' : val;
          }
        }
        // Fallback: show first parameter
        const firstKey = Object.keys(input)[0];
        if (firstKey && input[firstKey]) {
          const val = String(input[firstKey]);
          return val.length > 60 ? val.slice(0, 60) + '...' : val;
        }
        return '';
      };

      // Helper to render a single tool item with details
      const renderToolItem = (
        tool: { toolName: string; action?: string; filePath?: string; toolInput?: Record<string, unknown>; toolResponse?: string; toolError?: string; isError?: boolean },
        status: 'pending' | 'completed',
        idx: number
      ) => {
        const cfg = tool.isError
          ? { icon: AlertCircle, label: '失败', color: 'text-red-600 dark:text-red-400' }
          : getActionConfig(tool.action);
        const Icon = cfg.icon;
        const displayPath = tool.filePath || formatToolInput(tool.toolInput);
        const hasResponse = tool.toolResponse && tool.toolResponse.length > 0;

        return (
          <div key={`${status}-${idx}-${tool.toolName}`} className="py-1.5 border-b border-black/5 dark:border-white/5 last:border-0">
            {/* Tool header */}
            <div className="flex items-center gap-2 flex-wrap">
              <Icon className={`w-3.5 h-3.5 shrink-0 ${cfg.color}`} />
              <span className={`text-[11px] font-medium ${cfg.color}`}>{cfg.label}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono">{tool.toolName}</span>
              {status === 'pending' && (
                <span className="text-[10px] text-purple-500 animate-pulse">执行中...</span>
              )}
              {tool.isError && (
                <span className="text-[10px] text-red-500">失败</span>
              )}
            </div>
            {/* Tool input/path */}
            {displayPath && (
              <div className="mt-1 ml-5 text-[10px] text-text-secondary font-mono bg-black/[0.03] dark:bg-white/[0.03] px-2 py-1 rounded truncate" title={displayPath}>
                {displayPath}
              </div>
            )}
            {/* Tool response (collapsible) */}
            {hasResponse && (
              <details className="mt-1 ml-5">
                <summary className="text-[10px] text-blue-500 cursor-pointer hover:underline">查看结果</summary>
                <pre className="mt-1 text-[10px] text-text-secondary bg-black/[0.03] dark:bg-white/[0.03] p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
                  {tool.toolResponse!.length > 500 ? tool.toolResponse!.slice(0, 500) + '\n...(truncated)' : tool.toolResponse}
                </pre>
              </details>
            )}
            {/* Tool error */}
            {tool.toolError && (
              <div className="mt-1 ml-5 text-[10px] text-red-500 bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded">
                {tool.toolError.length > 300 ? tool.toolError.slice(0, 300) + '...' : tool.toolError}
              </div>
            )}
          </div>
        );
      };

      return (
        <div className="flex flex-col gap-1 ml-10 mr-2">
          {/* Header - always visible, clickable to expand/collapse */}
          <button
            onClick={() => setExpanded(!expanded)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left ${
              isCompleted
                ? hasError
                  ? 'bg-red-50/60 dark:bg-red-500/[0.06] border-red-200/50 dark:border-red-500/20'
                  : 'bg-green-50/60 dark:bg-green-500/[0.06] border-green-200/50 dark:border-green-500/20'
                : 'bg-purple-50/60 dark:bg-purple-500/[0.06] border-purple-200/50 dark:border-purple-500/20'
            }`}
          >
            {isCompleted ? (
              hasError ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
              ) : (
                <Check className="w-4 h-4 shrink-0 text-green-600 dark:text-green-400" />
              )
            ) : (
              <Terminal className="w-4 h-4 shrink-0 text-purple-600 dark:text-purple-400 animate-pulse" />
            )}
            <span className={`text-xs font-medium ${
              isCompleted
                ? hasError ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                : 'text-purple-600 dark:text-purple-400'
            }`}>
              {isCompleted ? (hasError ? '部分完成' : '执行完成') : '执行中'}
            </span>
            <span className="text-[10px] text-text-secondary">
              共 {totalCount} 个工具调用
            </span>
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-text-secondary ml-auto" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-text-secondary ml-auto" />
            )}
          </button>

          {/* Expanded content - show tool list */}
          {expanded && (
            <div className="ml-4 pl-3 border-l-2 border-purple-200 dark:border-purple-500/30 space-y-0.5">
              {pendingTools?.map((t, i) => renderToolItem(t, 'pending', i))}
              {completedTools?.map((t, i) => renderToolItem(t, 'completed', i))}
            </div>
          )}
          {/* Show conversation stats inside tool summary */}
          {isCompleted && message.conversationStats && (
            <div className="mt-1 ml-2">
              <ConversationStatsDisplay stats={message.conversationStats} />
            </div>
          )}
        </div>
      );
    }

    // Single tool mode (fallback)
    const toolName = (message.metadata?.toolName as string) || 'tool';
    const action = (message.metadata?.action as string) || undefined;
    const filePath = message.metadata?.filePath as string | undefined;
    const isError = !!message.metadata?.isError;
    const toolResponse = (message.metadata?.toolResponse as string) || '';
    const toolError = (message.metadata?.toolError as string) || '';

    const cfg = isError
      ? { icon: AlertCircle, label: '失败', color: 'text-red-600 dark:text-red-400', bgClass: 'bg-red-50/60 dark:bg-red-500/[0.06]', borderClass: 'border-red-200/50 dark:border-red-500/20' }
      : getActionConfig(action);
    const Icon = cfg.icon;

    if (!isCompleted) {
      return (
        <div className="flex gap-2.5 ml-10 mr-2">
          <div className="flex-1 min-w-0 max-w-full">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border flex-wrap ${cfg.bgClass} ${cfg.borderClass}`}>
              <Icon className={`w-4 h-4 shrink-0 ${cfg.color} animate-pulse`} />
              <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono shrink-0">{toolName}</span>
              {filePath && (
                <span className="text-[10px] text-text-secondary font-mono truncate min-w-0" title={filePath}>
                  {truncatePath(filePath)}
                </span>
              )}
              <span className="text-[10px] text-text-secondary animate-pulse">执行中...</span>
            </div>
          </div>
        </div>
      );
    }

    const displayContent = isError ? toolError : (toolResponse || message.content);
    return <ToolResultBlock
      icon={cfg.icon}
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

  const time = new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex gap-3 max-w-3xl group ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}>
      {/* Avatar */}
      <div className="shrink-0">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium shadow-sm ${
          isAI
            ? 'bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-500/15 dark:to-blue-500/15 text-violet-600 dark:text-violet-400'
            : isUser
              ? 'bg-white/20 dark:bg-white/10 border border-white/20 dark:border-white/10 text-text-main'
              : 'bg-primary/10 text-primary border border-primary/10'
        }`}>
          {isAI ? '✨' : (message.senderName?.charAt(0) || '👤')}
        </div>
      </div>
      {/* Content */}
      <div className={`flex flex-col gap-1 min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-baseline gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className={`text-[13px] font-medium ${isAI ? 'text-violet-600 dark:text-violet-400' : 'text-text-main'}`}>
            {message.senderName}
          </span>
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
          {message.interactionMode === 'no_ai' && (
            <span className="text-[9px] px-1.5 py-0.5 bg-gray-500/10 text-gray-500 dark:text-gray-400 rounded-md">纯文本</span>
          )}
        </div>
        <div className={`p-3.5 text-sm leading-relaxed break-words max-w-full ${
          isUser
            ? 'bg-primary text-white rounded-2xl rounded-tr-none shadow-lg shadow-primary/20'
            : isAI
              ? 'bg-white/40 dark:bg-slate-700/70 backdrop-blur-md rounded-2xl rounded-tl-none border border-white/50 dark:border-slate-600 text-text-main shadow-sm'
              : 'bg-white/40 dark:bg-slate-800/50 backdrop-blur-sm rounded-2xl rounded-tl-none border border-white/30 dark:border-slate-700 text-text-main shadow-sm'
        }`}>
          <div className={`break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${isUser ? '[&_code]:bg-white/20 [&_a]:text-white [&_a]:underline' : ''}`}>
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
        {message.metadata?.imageInfo && (
          <div className="mt-2 max-w-xs">
            {message.metadata.imageInfo.url ? (
              <div className="relative group">
                <img
                  src={message.metadata.imageInfo.url}
                  alt="图片消息"
                  className="rounded-lg max-w-full cursor-pointer hover:opacity-90 transition-opacity border border-border-subtle"
                  style={{
                    maxWidth: Math.min(message.metadata.imageInfo.width || 300, 300),
                    maxHeight: 400,
                  }}
                  onClick={() => window.open(message.metadata?.imageInfo?.url || '', '_blank')}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                  }}
                />
                <div className="hidden p-4 bg-red-50 dark:bg-red-500/10 rounded-lg text-red-600 dark:text-red-400 text-xs">
                  图片加载失败
                </div>
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white"
                    onClick={(e) => { e.stopPropagation(); window.open(message.metadata?.imageInfo?.url || '', '_blank'); }}
                    title="查看原图"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 3h6v6M14 10l6.1-6.1M9 21H3v-6M10 14l-6.1 6.1" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-gray-100 dark:bg-slate-700 rounded-lg text-text-secondary text-xs flex items-center gap-2">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
                <span>图片{message.metadata.imageInfo.downloadError ? ' - 加载失败' : ''}</span>
              </div>
            )}
          </div>
        )}
        {/* File attachment rendering */}
        {message.metadata?.fileInfo && ((
          () => {
            const fileInfo = message.metadata.fileInfo;
            const hasLocalPath = !!fileInfo.localPath;
            const isElectron = typeof window !== 'undefined' && 'desktopAPI' in window;
            const canOpenLocally = hasLocalPath && isElectron;

            const handleClick = async () => {
              if (canOpenLocally) {
                // Electron environment: open file with system default app
                try {
                  const result = await (window as any).desktopAPI.openFile(fileInfo.localPath);
                  if (!result.success) {
                    console.error('Failed to open file:', result.error);
                    // Fallback to download if open fails
                    if (fileInfo.url) {
                      const a = document.createElement('a');
                      a.href = `${fileInfo.url}?download=true`;
                      a.download = fileInfo.name || 'download';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }
                  }
                } catch (err) {
                  console.error('Error opening file:', err);
                }
              } else if (fileInfo.url) {
                // Web environment: trigger download
                const a = document.createElement('a');
                a.href = `${fileInfo.url}?download=true`;
                a.download = fileInfo.name || 'download';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }
            };

            return (
              <div
                className="mt-2 flex items-center gap-3 px-3 py-2.5 bg-white/40 dark:bg-slate-800/40 rounded-lg border border-border-subtle hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors cursor-pointer max-w-xs"
                onClick={handleClick}
              >
                {/* File type icon */}
                <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 shrink-0">
                  {getFileIcon(fileInfo.fileType || fileInfo.mimeType || '')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{fileInfo.name}</div>
                  <div className="text-xs text-text-secondary">
                    {fileInfo.size ? formatFileSize(fileInfo.size) : '未知大小'}
                    {fileInfo.downloadError && <span className="text-red-500 ml-2">下载失败</span>}
                  </div>
                </div>
                {/* Show "Open" button for local files, download icon for web */}
                {canOpenLocally ? (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium shrink-0">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 3l14 9-14 9V3z" fill="currentColor" />
                    </svg>
                    打开
                  </div>
                ) : fileInfo.url ? (
                  <svg className="w-5 h-5 text-text-secondary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                ) : null}
              </div>
            );
          }
        )())}
        {message.metadata?.voiceInfo && (
          <div className="mt-1.5 w-full max-w-xs">
            {message.metadata.voiceInfo.url ? (
              <VoicePlayer
                url={message.metadata.voiceInfo.url}
                duration={message.metadata.voiceInfo.duration}
                transcription={message.metadata.voiceInfo.transcription}
              />
            ) : (
              /* Voice message without audio file (download failed) - show simplified player */
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-slate-700 text-text-secondary">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                  </div>
                  <div className="flex-1 h-1.5 bg-gray-200 dark:bg-slate-600 rounded-full" />
                  <span className="text-[11px] text-text-secondary min-w-[40px] text-right tabular-nums">
                    {message.metadata.voiceInfo.duration ? `0:${String(message.metadata.voiceInfo.duration).padStart(2, '0')}` : '--:--'}
                  </span>
                </div>
                {message.metadata.voiceInfo.transcription && (
                  <div className="text-xs text-text-secondary pl-10 border-l-2 border-primary/20 ml-1">
                    {message.metadata.voiceInfo.transcription}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Conversation stats for AI messages */}
        {isAI && !isToolUse && !isToolResult && !isSkillResult && message.conversationStats && (
          <ConversationStatsDisplay stats={message.conversationStats} />
        )}
      </div>
    </div>
  );
}

// ========== Main Component ==========

interface SecretaryPanelProps {
  onOpenSettings?: (tab?: string) => void;
}

// ========== @Mention types ==========
interface MentionState {
  active: boolean;
  startIndex: number;
  query: string;
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

export default function SecretaryPanel({ onOpenSettings }: SecretaryPanelProps) {
  const [messages, setMessages] = useState<SecretaryMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<SecretaryMessage | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [aborting, setAborting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [scheduledMsgs, setScheduledMsgs] = useState<SecretaryScheduledMessage[]>([]);
  const [savingScheduled, setSavingScheduled] = useState(false);
  const [triggeringMsg, setTriggeringMsg] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [savingSkills, setSavingSkills] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [imChannelStatuses, setImChannelStatuses] = useState<IMChannelStatus[]>([]);
  const [trackedDispatches, setTrackedDispatches] = useState<Map<string, { employeeName: string }>>(new Map());
  const [waitingFeedbacks, setWaitingFeedbacks] = useState<Map<string, { employeeName: string; questionContent?: string }>>(new Map());
  const [replyingToProject, setReplyingToProject] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState<string>('');
  const [conversationStats, setConversationStats] = useState<{
    duration_ms?: number;
    duration_api_ms?: number;
    total_cost_usd?: number;
    usage?: { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number };
    num_turns?: number;
  } | null>(null);

  // New states for enhanced UI
  const [isComposing, setIsComposing] = useState(false);
  const [showScheduledPanel, setShowScheduledPanel] = useState(false);
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [logsContent, setLogsContent] = useState('');
  const [isLogsSseConnected, setIsLogsSseConnected] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const logsEventSourceRef = useRef<EventSource | null>(null);
  const toast = useToast();

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

  // Voice input state
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  // @Mention state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [mention, setMention] = useState<MentionState>({ active: false, startIndex: 0, query: '' });
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);

  // Compute filtered employees for keyboard navigation
  const mentionFiltered = mention.active
    ? employees.filter((e) => e.mode !== 'secretary' && e.name.toLowerCase().includes(mention.query.toLowerCase()))
    : [];

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scheduledMsgsRef = useRef(scheduledMsgs);
  const blurSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledPanelRef = useRef<HTMLDivElement>(null);
  scheduledMsgsRef.current = scheduledMsgs;

  // Check browser speech recognition support
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setVoiceSupported(!!SR);
  }, []);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // Click outside to close scheduled panel
  useEffect(() => {
    if (!showScheduledPanel) return;
    function handleClickOutside(e: MouseEvent) {
      if (scheduledPanelRef.current && !scheduledPanelRef.current.contains(e.target as Node)) {
        setShowScheduledPanel(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showScheduledPanel]);

  // Secretary logs SSE connection - real-time timeline streaming
  useEffect(() => {
    if (!showLogsPanel) return;
    if (typeof window === 'undefined') return;
    if (!('EventSource' in window)) return;

    let eventSource: EventSource | null = null;
    let disposed = false;

    const connectStream = () => {
      if (disposed) return;

      try {
        const streamUrl = `${API_BASE}/api/secretary/logs`;
        eventSource = new EventSource(streamUrl);
        logsEventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setIsLogsSseConnected(true);
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case 'connected':
                setIsLogsSseConnected(true);
                break;

              case 'content':
                // Initial full content
                if (data.isInitial) {
                  setLogsContent(data.data || '');
                }
                break;

              case 'update':
                // Incremental content - prepend (newest first)
                setLogsContent((prev) => (data.data || '') + prev);
                break;

              case 'heartbeat':
                // Keep-alive, no action needed
                break;
            }
          } catch { /* ignore parse errors */ }
        };

        eventSource.onerror = () => {
          setIsLogsSseConnected(false);
          eventSource?.close();

          // Reconnect after delay
          if (!disposed) {
            setTimeout(() => {
              if (!disposed) connectStream();
            }, 3000);
          }
        };
      } catch (err) {
        console.error('[SecretaryPanel] SSE connection failed:', err);
      }
    };

    connectStream();

    return () => {
      disposed = true;
      setIsLogsSseConnected(false);
      if (logsEventSourceRef.current) {
        logsEventSourceRef.current.close();
        logsEventSourceRef.current = null;
      }
    };
  }, [showLogsPanel]);

  // Load employees for @mention
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
        console.error('[SecretaryPanel] Failed to load employees:', error);
      }
    }
    fetchEmployees();
    return () => { cancelled = true; };
  }, []);

  const PAGE_SIZE = 50;

  // Track pending scroll restore
  const scrollRestoreRef = useRef<{ prevScrollHeight: number } | null>(null);
  const skipAutoScrollRef = useRef(false);

  // Scroll restore after prepending older messages
  useLayoutEffect(() => {
    if (scrollRestoreRef.current && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const { prevScrollHeight } = scrollRestoreRef.current;
      container.scrollTop = container.scrollHeight - prevScrollHeight;
      scrollRestoreRef.current = null;
      skipAutoScrollRef.current = true;
    }
  }, [messages]);

  // Load messages
  const loadMessages = useCallback(async (replace = false) => {
    try {
      const res = await fetch(`${API_BASE}/api/secretary/messages?limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.messages)) {
        const dbMsgs: SecretaryMessage[] = data.messages;
        setTotal(data.total || dbMsgs.length);
        setHasMore(dbMsgs.length >= PAGE_SIZE);
        setMessages((prev) => {
          // If DB returned empty but we have local messages, keep them (DB might be slow)
          if (dbMsgs.length === 0 && prev.length > 0) return prev;
          // Full replace mode or initial load
          if (replace || prev.length === 0) return dbMsgs;
          
          // Merge logic: keep SSE-only messages that are recent and not yet in DB
          const dbIdSet = new Set(dbMsgs.map(m => m.id));
          const now = Date.now();
          
          // Keep SSE messages if:
          // 1. Not in DB (not yet persisted)
          // 2. Created within last 60 seconds (increased from 30s for slow DB writes)
          // 3. OR it's a streaming message placeholder
          const sseOnly = prev.filter(m => {
            if (dbIdSet.has(m.id)) return false; // Already in DB, use DB version
            const age = now - new Date(m.createdAt).getTime();
            const isRecent = age < 60000; // 60 seconds window
            const isStreaming = (m as { isStreaming?: boolean }).isStreaming;
            return isRecent || isStreaming;
          });
          
          if (sseOnly.length === 0) return dbMsgs;
          
          // Merge and sort by timestamp
          const merged = [...dbMsgs, ...sseOnly];
          merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          return merged;
        });
      }
    } catch (err) {
      console.error('[SecretaryPanel] loadMessages failed:', err);
    }
  }, []);

  const loadOlderMessages = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const oldestMsg = messages[0];
      if (!oldestMsg) { setLoadingMore(false); return; }
      const res = await fetch(`${API_BASE}/api/secretary/messages?limit=${PAGE_SIZE}&before=${oldestMsg.id}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.messages)) {
        const olderMsgs: SecretaryMessage[] = data.messages;
        setHasMore(olderMsgs.length >= PAGE_SIZE);
        if (olderMsgs.length > 0) {
          const container = messagesContainerRef.current;
          scrollRestoreRef.current = { prevScrollHeight: container?.scrollHeight || 0 };
          setMessages((prev) => {
            const existingIds = new Set(prev.map(m => m.id));
            const newMsgs = olderMsgs.filter(m => !existingIds.has(m.id));
            return [...newMsgs, ...prev];
          });
        }
      }
    } catch { /* ignore */ }
    setLoadingMore(false);
  }, [messages, loadingMore, hasMore]);

  useEffect(() => {
    loadMessages(true);
  }, [loadMessages]);

  // Track last message id for auto-scroll
  const lastMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      return;
    }
    const currentLastId = messages.length > 0 ? messages[messages.length - 1].id : null;
    if (currentLastId !== lastMsgIdRef.current) {
      lastMsgIdRef.current = currentLastId;
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [messages]);

  useEffect(() => {
    if (streamingMessage?.content) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [streamingMessage?.content]);

  // SSE for real-time updates
  useEffect(() => {
    let toolMsgCounter = 0;
    // Unified tool tracking - all tools share one summary message per request
    const TOOL_SUMMARY_ID = 'tool-summary';
    const pendingTools: Array<{ toolUseId: string; toolName: string; action?: string; filePath?: string; toolInput?: Record<string, unknown> }> = [];
    const completedTools: Array<{ toolName: string; action?: string; filePath?: string; toolInput?: Record<string, unknown>; toolResponse?: string; toolError?: string; isError?: boolean }> = [];
    let currentRequestId: string | null = null;
    const es = new EventSource(`${API_BASE}/api/secretary/stream`);

    // Helper to update the unified tool summary message
    const updateToolSummary = () => {
      setMessages((prev) => {
        const hasPending = pendingTools.length > 0;
        const hasCompleted = completedTools.length > 0;

        // Remove existing summary
        const filtered = prev.filter((m) => m.id !== TOOL_SUMMARY_ID);

        // If no tools at all, don't add summary
        if (!hasPending && !hasCompleted) return filtered;

        // Build summary content
        const summaryMsg: SecretaryMessage = {
          id: TOOL_SUMMARY_ID,
          role: 'assistant',
          messageType: 'tool_use',
          senderId: 'secretary-ai',
          senderName: '小G',
          content: '',
          toolStatus: hasPending ? 'pending' : 'completed',
          metadata: {
            pendingTools: pendingTools.map(t => ({
              toolName: t.toolName,
              action: t.action,
              filePath: t.filePath,
              toolInput: t.toolInput,
            })),
            completedTools: completedTools.map(t => ({
              toolName: t.toolName,
              action: t.action,
              filePath: t.filePath,
              toolInput: t.toolInput,
              toolResponse: t.toolResponse,
              toolError: t.toolError,
              isError: t.isError,
            })),
          },
          createdAt: new Date().toISOString(),
        };
        return [...filtered, summaryMsg];
      });
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Track request ID for tool summary
        if (data.data?.requestId && data.data.requestId !== currentRequestId) {
          currentRequestId = data.data.requestId;
          // Clear previous tools for new request
          pendingTools.length = 0;
          completedTools.length = 0;
        }

        // New message (user messages, final non-streaming messages)
        if (data.type === 'new_message' && data.data?.message) {
          setMessages((prev) => {
            const msg = data.data.message as SecretaryMessage;
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }

        // AI streaming start - clear old tool summary for new request
        if (data.type === 'conversation_stats') {
          const stats = data.data || null;
          setConversationStats(stats);
          // Also inject stats into tool summary message for display in executing area
          if (stats) {
            setMessages((prev) => prev.map((m) =>
              m.id === TOOL_SUMMARY_ID
                ? { ...m, conversationStats: stats }
                : m
            ));
          }
        }

        if (data.type === 'ai_stream_start') {
          setConversationStats(null);
          setCurrentRequestId(data.data?.requestId || null);
          // Clear old tool summary for new request
          setMessages((prev) => prev.filter((m) => m.id !== TOOL_SUMMARY_ID));
          if (data.data?.resumed) loadMessages();
          setStreamingMessage({
            id: data.data?.requestId || 'streaming',
            role: 'assistant',
            messageType: 'text',
            senderId: 'secretary-ai',
            senderName: '小G',
            content: '',
            createdAt: new Date().toISOString(),
            isStreaming: true,
          });
        }

        // AI streaming delta
        if (data.type === 'ai_stream_delta') {
          setStreamingMessage((prev) => {
            if (!prev) return prev;
            return { ...prev, content: data.data?.content || prev.content };
          });
        }

        // AI streaming end - keep tool summary visible, will be cleared on next request
        if (data.type === 'ai_stream_end') {
          setStreamingMessage(null);
          setCurrentRequestId(null);
          setAborting(false);
          const endRequestId = data.data?.requestId;
          const persistSuccess = data.data?.persistSuccess !== false; // default to true for backward compat

          // Detect AI error in stream end (e.g. "AI 回复失败: Claude Code process exited with code 1")
          const streamEndError = data.data?.error;
          if (streamEndError && typeof streamEndError === 'string') {
            setLlmError(streamEndError);
          }
          
          // Refresh messages with retry mechanism to handle DB write delay
          const refreshWithRetry = async (attempt = 0) => {
            const prevMsgs = messages;
            await loadMessages();

            // Check if we got a new assistant message after this request
            // If persist was marked as failed, don't retry
            if (!persistSuccess) {
              console.log('[SecretaryPanel] Persist failed on server, skipping retry');
              return;
            }

            // Check current messages for new AI reply with embedded stats
            setMessages(currentMsgs => {
              const hasNewAIMsg = currentMsgs.length > prevMsgs.length ||
                (currentMsgs.length > 0 && currentMsgs[currentMsgs.length - 1].role === 'assistant');

              if (!hasNewAIMsg && attempt < 2) {
                setTimeout(() => refreshWithRetry(attempt + 1), 1500);
              }
              return currentMsgs;
            });

            // Use setTimeout to check after state update
            setTimeout(() => {
              setMessages(currentMsgs => {
                const lastMsg = currentMsgs[currentMsgs.length - 1];
                if (lastMsg?.role === 'assistant' && lastMsg?.conversationStats) {
                  // DB message has stats embedded, clear real-time one to avoid duplicate
                  setConversationStats(null);
                }
                return currentMsgs;
              });
            }, 50);
          };
          
          // Initial delay increased to 1500ms to give DB more time
          setTimeout(() => refreshWithRetry(0), 1500);
        }

        // AI tool use - add to pending list
        if (data.type === 'ai_tool_use') {
          const toolUseId = data.data?.toolUseId || `fallback-${Date.now()}-${++toolMsgCounter}`;
          pendingTools.push({
            toolUseId,
            toolName: data.data?.toolName || 'unknown',
            action: data.data?.action,
            filePath: data.data?.filePath,
            toolInput: data.data?.toolInput,
          });
          updateToolSummary();
        }

        // AI tool result - move from pending to completed
        if (data.type === 'ai_tool_result') {
          const resultToolUseId = data.data?.toolUseId;
          // Find and remove from pending, preserving details
          const pendingTool = pendingTools.find(t => t.toolUseId === resultToolUseId);
          const idx = pendingTools.findIndex(t => t.toolUseId === resultToolUseId);
          if (idx !== -1) {
            pendingTools.splice(idx, 1);
          }
          // Add to completed with full details
          completedTools.push({
            toolName: data.data?.toolName || pendingTool?.toolName || 'unknown',
            action: data.data?.action || pendingTool?.action,
            filePath: data.data?.filePath || pendingTool?.filePath,
            toolInput: pendingTool?.toolInput,
            toolResponse: data.data?.toolResponse,
            toolError: data.data?.toolError,
            isError: data.data?.isError,
          });
          updateToolSummary();
        }

        // AI notification from SDK
        if (data.type === 'ai_notification') {
          const { title, message: notifMsg, notificationType } = data.data || {};
          const displayMsg = [title, notifMsg].filter(Boolean).join(': ') || 'SDK 通知';
          if (notificationType === 'error') {
            toast.error(displayMsg, 5000);
            // Detect LLM API configuration errors
            const errText = displayMsg.toLowerCase();
            if (errText.includes('api') || errText.includes('key') || errText.includes('auth') ||
                errText.includes('model') || errText.includes('401') || errText.includes('403') ||
                errText.includes('unauthorized') || errText.includes('invalid') ||
                errText.includes('connection') || errText.includes('endpoint') ||
                errText.includes('apikey') || errText.includes('token')) {
              setLlmError(displayMsg);
            }
          } else {
            toast.info(displayMsg, 4000);
          }
        }

        // Error
        if (data.type === 'error') {
          const errMsg = data.data?.message || data.data?.error || '';
          if (errMsg) {
            toast.error(errMsg, 5000);
            // Detect LLM configuration issues
            const errText = errMsg.toLowerCase();
            if (errText.includes('api') || errText.includes('key') || errText.includes('auth') ||
                errText.includes('model') || errText.includes('401') || errText.includes('403') ||
                errText.includes('unauthorized') || errText.includes('connection') ||
                errText.includes('endpoint') || errText.includes('token')) {
              setLlmError(errMsg);
            }
          }
        }

        // Dispatch completed notification
        if (data.type === 'dispatch_completed') {
          const { projectId, employeeName } = data.data || {};
          toast.success(`✅ ${employeeName || '员工'} 已完成任务`, 5000);
          setTrackedDispatches((prev) => {
            const next = new Map(prev);
            next.delete(projectId);
            return next;
          });
        }

        // Dispatch failed notification
        if (data.type === 'dispatch_failed') {
          const { projectId, employeeName } = data.data || {};
          toast.error(`❌ ${employeeName || '员工'} 的任务执行失败`, 5000);
          setTrackedDispatches((prev) => {
            const next = new Map(prev);
            next.delete(projectId);
            return next;
          });
          setWaitingFeedbacks((prev) => {
            const next = new Map(prev);
            next.delete(projectId);
            return next;
          });
        }

        // Dispatch feedback - employee needs user confirmation
        if (data.type === 'dispatch_feedback') {
          const { projectId, employeeName } = data.data || {};
          console.log(`[SecretaryPanel] dispatch_feedback: ${employeeName} (${projectId}) needs confirmation`);

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
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 100);
              }
            })
            .catch((err) => {
              console.error('[SecretaryPanel] Failed to fetch feedback question:', err);
              setWaitingFeedbacks((prev) => {
                const next = new Map(prev);
                next.set(projectId, {
                  employeeName: employeeName || '员工',
                  questionContent: '员工需要你的确认',
                });
                return next;
              });
              setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 100);
            });
        }
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => es.close();
  }, [loadMessages]);

  // Direct dispatch: @employee + instruction → auto create project & dispatch
  const directDispatch = useCallback(
    async (employee: Employee, instruction: string, fullMessage: string, dispatchAttachments?: typeof attachments) => {
      setSending(true);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }, 50);

      try {
        const projectId = `p-${Math.random().toString(36).substring(2, 10)}`;
        const isPython = employee.id === 'builtin-python-dev' ||
          employee.system_prompt?.toLowerCase().includes('fastapi') ||
          employee.description?.toLowerCase().includes('fastapi') ||
          employee.description?.toLowerCase().includes('python');
        const projectType = employee.mode !== 'code' ? 'default' : isPython ? 'python-fastapi' : 'nextjs';

        // Build instruction with attachment absolute paths
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
          } catch { /* Non-critical */ }
        }

        // Save messages to database (will be displayed via SSE new_message event)
        const saveResponse = await fetch(`${API_BASE}/api/secretary/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: fullMessage,
            senderName: '我',
            enabledSkills,
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

        if (saveResponse.ok) {
          // Track dispatch for completion notification
          setTrackedDispatches((prev) => {
            const next = new Map(prev);
            next.set(createdProjectId, { employeeName: employee.name });
            return next;
          });

          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
          }, 100);

          toast.success(`任务已派发给 ${employee.name}`);
        } else {
          throw new Error('保存消息失败');
        }
      } catch (error) {
        console.error('[SecretaryPanel] Direct dispatch failed:', error);
        toast.error(`派发任务失败：${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        setSending(false);
      }
    },
    [toast, enabledSkills]
  );

  // Send reply to project (employee waiting for feedback)
  const sendReplyToProject = useCallback(
    async (projectId: string, message: string) => {
      if (!message.trim()) return;

      const feedback = waitingFeedbacks.get(projectId);
      if (!feedback) return;

      setReplyingToProject(projectId);
      setSending(true);

      try {
        // Show user message in chat
        const userMessage: SecretaryMessage = {
          id: `user-${Date.now()}`,
          role: 'user',
          messageType: 'text',
          content: `→ ${feedback.employeeName}: ${message}`,
          senderId: 'user',
          senderName: '我',
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMessage]);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 50);

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
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            messageType: 'text',
            content: `✅ 已将回复发送给 ${feedback.employeeName}，任务继续执行中...`,
            senderId: 'secretary-ai',
            senderName: '小G',
            createdAt: new Date().toISOString(),
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

          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 50);
          toast.success(`已发送回复给 ${feedback.employeeName}`);
        } else {
          toast.error(result.error || '发送回复失败');
        }
      } catch (error) {
        console.error('[SecretaryPanel] Failed to send reply to project:', error);
        toast.error('发送回复失败，请稍后重试');
      } finally {
        setSending(false);
        setReplyingToProject(null);
      }
    },
    [waitingFeedbacks, toast]
  );

  // Send message
  const handleSend = async () => {
    const content = inputValue.trim();
    if ((!content && attachments.length === 0) || sending) return;
    if (attachments.some((a) => a.uploading)) return; // wait for uploads
    setMention({ active: false, startIndex: 0, query: '' });

    // Detect @employeeName + instruction pattern for auto-dispatch
    if (content.startsWith('@')) {
      const afterAt = content.slice(1);
      const matchedEmp = employees
        .filter((e) => afterAt.startsWith(e.name))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (matchedEmp) {
        const rest = afterAt.slice(matchedEmp.name.length).trim();
        if (rest) {
          // Has instruction text after the name — auto dispatch
          directDispatch(matchedEmp, rest, content, attachments);
          setInputValue('');
          setAttachments([]);
          return;
        }
      }
    }

    setSending(true);
    setInputValue('');
    const currentAttachments = [...attachments];
    setAttachments([]);

    // Build attachment info for the message
    let messageContent = content;
    if (currentAttachments.length > 0) {
      const fileInfo = currentAttachments.map((a) => {
        const filePath = a.absolutePath || a.publicUrl || a.name;
        return `- ${a.name} (${a.mimeType}, ${(a.size / 1024).toFixed(1)}KB)\n  路径: ${filePath}`;
      }).join('\n');
      messageContent += `\n\n[附件]\n${fileInfo}`;
    }

    try {
      const res = await fetch(`${API_BASE}/api/secretary/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: messageContent,
          senderName: '我',
          enabledSkills,
        }),
      });
      const result = await res.json();
      if (result.success && result.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === result.message.id)) return prev;
          return [...prev, result.message];
        });
      }
    } catch { /* ignore */ }
    setSending(false);
    textareaRef.current?.focus();
  };

  // Optimize user input
  const handleOptimize = async () => {
    const content = inputValue.trim();
    if (!content || optimizing) return;

    setOptimizing(true);
    try {
      const res = await fetch(`${API_BASE}/api/secretary/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const result = await res.json();
      if (result.success && result.optimized) {
        setInputValue(result.optimized);
        toast.success('已优化输入内容');
      } else {
        toast.error(result.error || '优化失败');
      }
    } catch (err) {
      toast.error('优化请求失败');
    }
    setOptimizing(false);
  };

  // Abort AI response
  const handleAbort = async () => {
    if (aborting) return;
    setAborting(true);
    try {
      await fetch(`${API_BASE}/api/secretary/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: currentRequestId }),
      });
    } catch { /* ignore */ }
    setTimeout(() => {
      setStreamingMessage(null);
      setCurrentRequestId(null);
      setAborting(false);
    }, 3000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      if (mention.active) {
        // Select the highlighted mention item
        e.preventDefault();
        if (mentionFiltered.length > 0) {
          const emp = mentionFiltered[mentionSelectedIdx] as Employee;
          handleMentionSelect(emp);
        }
        return;
      }
      e.preventDefault();
      handleSend();
    }
  };

  // Handle @mention detection in input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart ?? value.length;
    setInputValue(value);

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

  // Voice input toggle
  const toggleVoiceInput = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error('当前浏览器不支持语音识别');
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = '';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim = transcript;
        }
      }
      setInputValue(finalTranscript + (interim ? interim : ''));
    };

    recognition.onstart = () => {
      setIsListening(true);
      finalTranscript = inputValue;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onerror = (event: any) => {
      console.warn('[Voice] Recognition error:', event.error);
      if (event.error === 'not-allowed') {
        toast.error('麦克风权限被拒绝，请在浏览器设置中允许');
      } else if (event.error === 'network') {
        toast.error('语音识别需要网络连接');
      } else if (event.error !== 'aborted') {
        toast.error(`语音识别出错: ${event.error}`);
      }
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isListening, inputValue, toast]);

  // Upload a file
  const uploadFile = useCallback(async (file: File) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
    e.target.value = '';
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
        return;
      }
    }
  }, [uploadFile]);

  // Clear chat
  const handleClearChat = async () => {
    if (!confirm('确定要清空所有对话记录吗？此操作不可撤销。')) return;
    try {
      await fetch(`${API_BASE}/api/secretary/messages`, { method: 'DELETE' });
      setMessages([]);
    } catch { /* ignore */ }
  };

  // Load scheduled messages
  useEffect(() => {
    async function fetchScheduled() {
      try {
        const res = await fetch(`${API_BASE}/api/chat/home/secretary/scheduled-messages`);
        if (res.ok) {
          const data = await res.json();
          if (data.data) setScheduledMsgs(data.data);
        }
      } catch { /* ignore */ }
    }
    fetchScheduled();
  }, []);

  // Reload scheduled messages when panel opens
  useEffect(() => {
    if (showScheduledPanel) {
      fetch(`${API_BASE}/api/chat/home/secretary/scheduled-messages`)
        .then(res => res.json())
        .then(data => {
          if (data.data) setScheduledMsgs(data.data);
        })
        .catch(() => {});
    }
  }, [showScheduledPanel]);

  // Load IM channel statuses
  useEffect(() => {
    async function fetchIMStatus() {
      try {
        const res = await fetch(`${API_BASE}/api/im/status`);
        if (res.ok) {
          const data = await res.json();
          setImChannelStatuses(data);
        }
      } catch { /* ignore */ }
    }
    fetchIMStatus();
  }, []);

  // Load skills
  useEffect(() => {
    async function fetchSkills() {
      setLoadingSkills(true);
      try {
        const res = await fetch(`${API_BASE}/api/secretary/skills`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setAvailableSkills(data.availableSkills || []);
            setEnabledSkills(data.enabledSkills || []);
          }
        }
      } catch { /* ignore */ }
      setLoadingSkills(false);
    }
    fetchSkills();
  }, []);

  // Scheduled messages CRUD
  const handleSaveScheduled = async (msgs: SecretaryScheduledMessage[]) => {
    setSavingScheduled(true);
    try {
      await fetch(`${API_BASE}/api/chat/home/secretary/scheduled-messages`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledMessages: msgs }),
      });
    } catch { /* ignore */ }
    setSavingScheduled(false);
  };

  const debouncedSave = (msgsOrEvent?: SecretaryScheduledMessage[] | React.FocusEvent) => {
    if (blurSaveTimer.current) clearTimeout(blurSaveTimer.current);
    const msgs = Array.isArray(msgsOrEvent) ? msgsOrEvent : scheduledMsgsRef.current;
    blurSaveTimer.current = setTimeout(() => handleSaveScheduled(msgs), 300);
  };

  const addScheduledMsg = () => {
    const newMsg: SecretaryScheduledMessage = {
      id: crypto.randomUUID(),
      content: '',
      scheduleType: 'interval',
      intervalMinutes: 60,
      aiReply: true,
      enabled: false,
    };
    const updated = [...scheduledMsgs, newMsg];
    setScheduledMsgs(updated);
    // Auto-save after adding new task
    handleSaveScheduled(updated);
  };

  const updateScheduledMsg = (id: string, partial: Partial<SecretaryScheduledMessage>) => {
    setScheduledMsgs(prev => {
      const next = prev.map(m => m.id === id ? { ...m, ...partial } : m);
      // Immediate save for checkbox/toggle changes, debounced for text/number inputs
      if (partial.enabled !== undefined || partial.aiReply !== undefined || partial.scheduleType !== undefined) {
        handleSaveScheduled(next);
      } else {
        // Trigger debounced save for intervalMinutes, scheduledTime, content
        debouncedSave(next);
      }
      return next;
    });
  };

  const removeScheduledMsg = (id: string) => {
    if (blurSaveTimer.current) clearTimeout(blurSaveTimer.current);
    const next = scheduledMsgs.filter(m => m.id !== id);
    setScheduledMsgs(next);
    handleSaveScheduled(next);
  };

  const handleTriggerScheduledMsg = async (msgId: string) => {
    setTriggeringMsg(msgId);
    try {
      // Trigger execution (backend will update lastSentAt)
      const res = await fetch(`${API_BASE}/api/chat/home/secretary/scheduled-messages/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msgId }),
      });
      const result = await res.json();
      if (result.success) {
        // Reload from server to get updated lastSentAt
        const reloadRes = await fetch(`${API_BASE}/api/chat/home/secretary/scheduled-messages`);
        if (reloadRes.ok) {
          const data = await reloadRes.json();
          if (data.data) setScheduledMsgs(data.data);
        }
      }
    } catch { /* ignore */ }
    setTriggeringMsg(null);
  };

  // Toggle skill
  const handleToggleSkill = async (skillName: string, enabled: boolean) => {
    const newEnabledSkills = enabled
      ? [...enabledSkills, skillName]
      : enabledSkills.filter(s => s !== skillName);
    
    setEnabledSkills(newEnabledSkills);
    setSavingSkills(true);
    
    try {
      await fetch(`${API_BASE}/api/secretary/skills`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledSkills: newEnabledSkills }),
      });
    } catch { /* ignore */ }
    
    setSavingSkills(false);
  };

  const isStreaming = !!streamingMessage;

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 relative">
      <ImagePreviewOverlay />
      {/* IM not connected banner */}
      {imChannelStatuses.length === 0 || !imChannelStatuses.some(s => s.connectionStatus === 'connected') ? (
        <button
          onClick={() => onOpenSettings?.('im-channels')}
          className="mx-4 mt-3 lg:mx-8 flex items-center gap-2 px-3 py-2 bg-amber-500/10 dark:bg-amber-400/10 border border-amber-500/20 dark:border-amber-400/20 rounded-xl text-amber-700 dark:text-amber-400 text-xs hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors cursor-pointer"
        >
          <MessageSquare className="w-4 h-4 shrink-0" />
          <span>未绑定 IM 渠道，无法接收即时消息。</span>
          <span className="ml-auto text-amber-600 dark:text-amber-300 font-medium underline underline-offset-2">前往设置 &rarr;</span>
        </button>
      ) : null}
      {/* LLM API error banner */}
      {llmError && (
        <div className="mx-4 mt-2 lg:mx-8 flex items-center gap-2 px-3 py-2 bg-red-500/10 dark:bg-red-400/10 border border-red-500/20 dark:border-red-400/20 rounded-xl text-red-700 dark:text-red-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 truncate">模型接口异常：{llmError}</span>
          <button
            onClick={() => { onOpenSettings?.('ai-agents'); setLlmError(null); }}
            className="ml-auto shrink-0 text-red-600 dark:text-red-300 font-medium underline underline-offset-2 hover:opacity-80"
          >
            配置 LLM API &rarr;
          </button>
          <button onClick={() => setLlmError(null)} className="p-0.5 hover:bg-red-500/20 rounded transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {/* Messages - with bottom padding for floating input */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-48 lg:px-8 lg:pt-6 flex flex-col gap-4">
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              onClick={loadOlderMessages}
              disabled={loadingMore}
              className="text-[11px] text-text-secondary/50 hover:text-primary/70 disabled:opacity-40 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/20 dark:hover:bg-white/[0.04]"
            >
              {loadingMore ? '加载中...' : '↑ 查看更早消息'}
            </button>
          </div>
        )}
        {messages.map((msg) => (
          <SecretaryMessageBubble key={msg.id} message={msg} />
        ))}
        {streamingMessage && (
          <SecretaryMessageBubble key="streaming" message={streamingMessage} isStreaming />
        )}
        {/* Waiting feedback messages - employee needs confirmation */}
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
                    onClick={() => window.location.href = `/${projectId}/chat`}
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
                      disabled={!replyContent.trim() || sending}
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
        <div ref={messagesEndRef} />
      </div>

      {/* Floating input area */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white/60 via-white/30 to-transparent dark:from-[#0f172a]/90 dark:via-[#0f172a]/60 dark:to-transparent pt-6 pb-6 px-4 lg:px-8 flex justify-center z-20">
        <div className="w-full max-w-3xl bg-white/50 dark:bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] border border-white/60 dark:border-border-subtle p-2 flex flex-col gap-2 relative">
          {/* Scheduled messages panel */}
          {showScheduledPanel && (
            <div ref={scheduledPanelRef} className="px-3 pt-3 pb-1 border-b border-border-subtle/30 max-h-[50vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-primary/70" />
                  <h3 className="text-[13px] font-semibold text-text-main">定时任务</h3>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={addScheduledMsg}
                    className="p-1.5 rounded-lg text-text-secondary/50 hover:text-primary hover:bg-primary/5 transition-colors"
                    title="添加定时任务"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setShowScheduledPanel(false)}
                    className="p-1.5 rounded-lg text-text-secondary/50 hover:text-text-main hover:bg-bg-subtle transition-colors"
                    title="关闭"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-text-secondary/50 mb-3">设置定时发送给秘书的消息（支持AI回复）</p>

              {scheduledMsgs.length === 0 ? (
                <p className="text-[11px] text-text-secondary/40 text-center py-3">暂无定时任务，点击 + 添加</p>
              ) : (
                <div className="space-y-3">
                  {scheduledMsgs.map((sm) => (
                    <div key={sm.id} className="p-3 rounded-xl bg-bg-subtle/50 dark:bg-white/[0.03] border border-border-subtle/40 dark:border-white/[0.05] space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={sm.enabled}
                            onChange={(e) => updateScheduledMsg(sm.id, { enabled: e.target.checked })}
                            className="w-4 h-4 rounded accent-primary"
                          />
                          <span className={`text-[12px] font-medium ${sm.enabled ? 'text-primary' : 'text-text-secondary/50'}`}>
                            {sm.enabled ? '已启用' : '已禁用'}
                          </span>
                        </label>
                        <div className="flex items-center gap-1">
                          <label className="flex items-center gap-1.5 cursor-pointer mr-2" title="AI回复">
                            <Bot className={`w-3.5 h-3.5 ${sm.aiReply !== false ? 'text-primary' : 'text-text-secondary/30'}`} />
                            <input
                              type="checkbox"
                              checked={sm.aiReply !== false}
                              onChange={(e) => updateScheduledMsg(sm.id, { aiReply: e.target.checked })}
                              className="w-3.5 h-3.5 rounded accent-primary"
                            />
                          </label>
                          <button
                            onClick={() => removeScheduledMsg(sm.id)}
                            className="p-1 rounded-md text-text-secondary/40 hover:text-red-400 hover:bg-red-500/5 transition-all"
                            title="删除"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={sm.content}
                        onChange={(e) => updateScheduledMsg(sm.id, { content: e.target.value })}
                        onBlur={debouncedSave}
                        placeholder="输入定时发送给秘书的消息内容..."
                        rows={2}
                        className="w-full px-2.5 py-1.5 text-[12px] rounded-lg border border-border-subtle/40 dark:border-white/[0.04] bg-white/60 dark:bg-white/[0.02] text-text-main focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none placeholder:text-text-secondary/30"
                      />
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-bg-subtle/80 dark:bg-white/[0.03] rounded-lg p-0.5">
                          <button
                            onClick={() => updateScheduledMsg(sm.id, { scheduleType: 'interval' })}
                            className={`px-2 py-0.5 text-[11px] rounded-md transition-all ${
                              (sm.scheduleType || 'interval') === 'interval'
                                ? 'bg-primary/15 text-primary font-medium'
                                : 'text-text-secondary/50 hover:text-text-main'
                            }`}
                          >
                            间隔
                          </button>
                          <button
                            onClick={() => updateScheduledMsg(sm.id, { scheduleType: 'daily' })}
                            className={`px-2 py-0.5 text-[11px] rounded-md transition-all ${
                              sm.scheduleType === 'daily'
                                ? 'bg-primary/15 text-primary font-medium'
                                : 'text-text-secondary/50 hover:text-text-main'
                            }`}
                          >
                            定时
                          </button>
                        </div>
                        {(sm.scheduleType || 'interval') === 'interval' ? (
                          <>
                            <span className="text-[11px] text-text-secondary/50 shrink-0">每隔</span>
                            <input
                              type="number"
                              min={1}
                              value={sm.intervalMinutes}
                              onChange={(e) => updateScheduledMsg(sm.id, { intervalMinutes: Math.max(1, parseInt(e.target.value) || 1) })}
                              onBlur={debouncedSave}
                              className="w-16 px-2 py-1 text-[12px] text-center rounded-lg border border-border-subtle/40 dark:border-white/[0.04] bg-white/60 dark:bg-white/[0.02] text-text-main focus:outline-none focus:ring-1 focus:ring-primary/20"
                            />
                            <span className="text-[11px] text-text-secondary/50">分钟</span>
                          </>
                        ) : (
                          <>
                            <span className="text-[11px] text-text-secondary/50 shrink-0">每天</span>
                            <input
                              type="time"
                              value={sm.scheduledTime || '09:00'}
                              onChange={(e) => updateScheduledMsg(sm.id, { scheduledTime: e.target.value })}
                              onBlur={debouncedSave}
                              className="px-2 py-1 text-[12px] rounded-lg border border-border-subtle/40 dark:border-white/[0.04] bg-white/60 dark:bg-white/[0.02] text-text-main focus:outline-none focus:ring-1 focus:ring-primary/20"
                            />
                            <span className="text-[11px] text-text-secondary/50">执行</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        {sm.lastSentAt ? (
                          <p className="text-[10px] text-text-secondary/40">上次发送: {new Date(sm.lastSentAt).toLocaleString('zh-CN')}</p>
                        ) : (
                          <p className="text-[10px] text-text-secondary/40">尚未发送</p>
                        )}
                        <button
                          onClick={() => handleTriggerScheduledMsg(sm.id)}
                          disabled={triggeringMsg === sm.id || !sm.content.trim()}
                          className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-primary/80 hover:text-primary hover:bg-primary/5 rounded-lg transition-all disabled:opacity-40"
                          title="立即执行"
                        >
                          <Play className="w-3 h-3" />
                          {triggeringMsg === sm.id ? '发送中...' : '立即执行'}
                        </button>
                      </div>

                      {/* IM Send Settings */}
                      <div className="mt-3 pt-3 border-t border-border-subtle/30 dark:border-white/[0.04] rounded-lg">
                        <div className="flex items-center gap-2">
                          <Send className="w-3.5 h-3.5 text-text-secondary" />
                          <span className="text-[11px] font-medium text-text-secondary/70">发送到 IM</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sm.sendToIM}
                              onChange={(e) => {
                                updateScheduledMsg(sm.id, {
                                  sendToIM: e.target.checked,
                                  // Default to wechat_personal when enabled
                                  imPlatform: e.target.checked ? (sm.imPlatform || 'wechat_personal') : undefined,
                                });
                              }}
                              className="w-3.5 h-3.5 rounded accent-primary"
                            />
                            <span className="text-[11px] text-text-secondary/60">
                              {sm.sendToIM ? '将自动发送给最近联系的用户' : '启用后自动发送'}
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {scheduledMsgs.length > 0 && (
                <button
                  onClick={() => handleSaveScheduled(scheduledMsgs)}
                  disabled={savingScheduled}
                  className="mt-3 mb-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] font-medium text-primary hover:bg-primary/5 rounded-xl transition-all disabled:opacity-40 border border-primary/20"
                >
                  <Save className="w-4 h-4" />
                  {savingScheduled ? '保存中...' : '保存定时配置'}
                </button>
              )}
            </div>
          )}
          {/* @Mention dropdown */}
          {mention.active && employees.length > 0 && (
            <EmployeeMentionMenu
              employees={employees}
              query={mention.query}
              onSelect={handleMentionSelect}
              position={{ bottom: 100, left: 16 }}
              selectedIdx={mentionSelectedIdx}
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
            placeholder={isStreaming ? 'AI 正在响应中...' : '给助手发送消息... 输入 @ 提及员工，粘贴图片或添加附件'}
            disabled={isStreaming}
          />
          <div className="flex justify-between items-center px-2 pb-1">
            <div className="flex items-center gap-1">
              <button type="button" onClick={handleFileSelect} className="p-2 text-text-secondary hover:text-primary hover:bg-bg-subtle rounded-lg transition-colors" title="添加附件">
                <Paperclip className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={toggleVoiceInput}
                disabled={!voiceSupported}
                className={`p-2 rounded-lg transition-colors ${
                  isListening
                    ? 'text-red-500 bg-red-500/10 animate-pulse'
                    : 'text-text-secondary hover:text-primary hover:bg-bg-subtle'
                } disabled:opacity-30 disabled:cursor-not-allowed`}
                title={isListening ? '停止语音输入' : '语音输入'}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={() => setShowScheduledPanel(!showScheduledPanel)}
                className={`p-2 rounded-lg transition-colors ${showScheduledPanel ? 'text-primary bg-primary/10' : 'text-text-secondary hover:text-primary hover:bg-bg-subtle'}`}
                title="定时任务"
              >
                <Clock className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setShowLogsPanel(!showLogsPanel)}
                className={`p-2 rounded-lg transition-colors ${showLogsPanel ? 'text-primary bg-primary/10' : 'text-text-secondary hover:text-primary hover:bg-bg-subtle'}`}
                title="Execution logs"
              >
                <ScrollText className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${showSettings ? 'text-primary bg-primary/10' : 'text-text-secondary hover:text-primary hover:bg-bg-subtle'}`}
                title="设置"
              >
                <Settings className="w-5 h-5" />
              </button>
              <div className="h-4 w-px bg-border-subtle mx-1" />
              <button
                type="button"
                onClick={handleOptimize}
                disabled={!inputValue.trim() || optimizing || sending || isStreaming}
                className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-text-secondary hover:text-text-main hover:bg-bg-subtle rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className={`w-4 h-4 ${optimizing ? 'animate-pulse' : ''}`} />
                <span>{optimizing ? '优化中...' : '优化'}</span>
              </button>
            </div>
            {isStreaming ? (
              <button
                type="button"
                onClick={handleAbort}
                disabled={aborting}
                className="w-9 h-9 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center justify-center transition-colors shadow-sm"
                title="终止AI响应"
              >
                <Square className="w-5 h-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || ((!inputValue.trim() && attachments.length === 0) || attachments.some((a) => a.uploading))}
                className="w-9 h-9 bg-primary hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center justify-center transition-colors shadow-sm"
              >
                <ArrowUp className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Settings Overlay */}
      {showSettings && (
        <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setShowSettings(false)}>
          <div className="bg-white/70 dark:bg-white/[0.06] backdrop-blur-xl rounded-2xl shadow-2xl border border-white/30 dark:border-white/[0.08] w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/20 dark:border-white/[0.06] bg-white/30 dark:bg-white/[0.03] shrink-0">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                <span className="text-[14px] font-semibold text-text-main">秘书设置</span>
              </div>
              <button onClick={() => setShowSettings(false)} className="p-2 rounded-xl hover:bg-white/30 dark:hover:bg-white/[0.06] text-text-secondary/60 hover:text-text-main transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Skills Management */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-primary/70" />
                    <h3 className="text-[13px] font-semibold text-text-main">技能管理</h3>
                  </div>
                  {savingSkills && (
                    <span className="text-[10px] text-primary/60">保存中...</span>
                  )}
                </div>
                <p className="text-[11px] text-text-secondary/50 mb-3">启用的技能将在AI回复时可用</p>

                {loadingSkills ? (
                  <p className="text-[11px] text-text-secondary/40 text-center py-3">加载技能列表...</p>
                ) : availableSkills.length === 0 ? (
                  <p className="text-[11px] text-text-secondary/40 text-center py-3">暂无可用技能</p>
                ) : (
                  <div className="space-y-2">
                    {availableSkills.map((skill) => {
                      const isEnabled = enabledSkills.includes(skill.name);
                      return (
                        <div key={skill.name} className="flex items-center justify-between p-2.5 rounded-xl bg-white/20 dark:bg-white/[0.03] border border-white/15 dark:border-white/[0.05]">
                          <div className="flex-1 min-w-0 mr-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] font-medium text-text-main truncate">
                                {skill.displayName || skill.name}
                              </span>
                              {skill.hasApp && (
                                <span className="text-[9px] px-1 py-0.5 bg-blue-500/10 text-blue-500 dark:text-blue-400 rounded">App</span>
                              )}
                            </div>
                            <p className="text-[10px] text-text-secondary/50 truncate mt-0.5">
                              {skill.description}
                            </p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={(e) => handleToggleSkill(skill.name, e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}

                {enabledSkills.length > 0 && (
                  <p className="text-[10px] text-text-secondary/40 mt-2 text-center">
                    已启用 {enabledSkills.length} 个技能
                  </p>
                )}
              </div>

              {/* Clear Chat */}
              <div className="pt-4 border-t border-white/10 dark:border-white/[0.04]">
                <button onClick={handleClearChat} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-[13px] text-red-400/80 hover:text-red-500 hover:bg-red-500/5 rounded-xl transition-all border border-white/10 dark:border-white/[0.04]">
                  <Trash2 className="w-4 h-4" />
                  清空对话记录
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Console Logs Panel */}
      {showLogsPanel && (
        <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setShowLogsPanel(false)}>
          <div className="bg-white/70 dark:bg-white/[0.06] backdrop-blur-xl rounded-2xl shadow-2xl border border-white/30 dark:border-white/[0.08] w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Console Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-white/30 dark:bg-white/[0.06] border-b border-white/20 dark:border-white/[0.06]">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-green-600 dark:text-green-400" strokeWidth="2">
                  <polyline points="4 17 10 11 4 5"></polyline>
                  <line x1="12" y1="19" x2="20" y2="19"></line>
                </svg>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Secretary Console</span>
                {/* Real-time connection indicator */}
                <div className="flex items-center gap-1.5 ml-2">
                  <div className={`w-2 h-2 rounded-full ${isLogsSseConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-400 dark:bg-slate-600'}`} />
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">{isLogsSseConnected ? 'Live' : 'Disconnected'}</span>
                </div>
              </div>
              <button onClick={() => setShowLogsPanel(false)} className="p-2 rounded-xl hover:bg-white/30 dark:hover:bg-white/[0.06] text-text-secondary/60 hover:text-text-main transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Console Content */}
            <div className="flex-1 overflow-y-auto bg-white/5 dark:bg-white/5 p-4 font-mono text-sm custom-scrollbar">
              {!logsContent ? (
                <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                  <div className="text-center">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="mx-auto mb-3 text-slate-400 dark:text-slate-500" strokeWidth="1.5">
                      <polyline points="4 17 10 11 4 5"></polyline>
                      <line x1="12" y1="19" x2="20" y2="19"></line>
                    </svg>
                    <p className="text-sm">No console output yet</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Secretary execution logs will appear here in real-time</p>
                  </div>
                </div>
              ) : (
                <div className="whitespace-pre-wrap">
                  {logsContent.split('\n').map((line, idx) => (
                    <div
                      key={idx}
                      className={`leading-relaxed ${
                        line.includes('error') || line.includes('ERROR')
                          ? 'text-red-600'
                          : line.includes('warn') || line.includes('WARN')
                          ? 'text-yellow-600'
                          : 'text-green-600'
                      }`}
                    >
                      {line}
                    </div>
                  ))}
                  <div ref={consoleEndRef} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Folder, FolderPlus, FilePlus, Upload, Download, Trash2, Pencil, Copy, Move, MoreHorizontal, BookmarkPlus, RotateCcw, Plus, Minus, History, GitCompare, ChevronRight } from 'lucide-react';
import type { GitFileStatus, GitStatusResult } from '@/types/shared/git';
import {
  WordIcon, ExcelIcon, PowerPointIcon, PdfIcon,
  JsIcon, TsIcon, TsxIcon, JsxIcon, CssIcon, HtmlIcon, JsonIcon, PyIcon, ShIcon,
  SqlIcon, YamlIcon, XmlIcon, PhpIcon, JavaIcon, CIcon, CppIcon, RustIcon, GoIcon,
  RubyIcon, VueIcon, SvelteIcon, ScssIcon, TomlIcon, MdIcon, TxtIcon,
  PngIcon, JpgIcon, SvgFileIcon, GifIcon, WebpIcon, Mp4Icon, VideoFileIcon, AudioFileIcon,
  ZipIcon, GenericFileIcon
} from '@/components/icons/FileTypeIcons';

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
  gitStatus?: GitFileStatus;
  dirChangedCount?: number;  // directories only: count of changed files inside
}

interface FileGridViewProps {
  files: FileItem[];
  projectId?: string;
  currentDir?: string;
  onFileClick?: (file: FileItem) => void;
  onFolderClick?: (folder: FileItem) => void;
  onRefresh?: () => void;
  /** Compact list mode for narrow panels (e.g. sidebar) */
  compact?: boolean;
  /** Download file handler */
  onDownload?: (file: FileItem) => void;
  /** Read-only mode: hide rename, delete, new file, new folder, upload, copy, move */
  readOnly?: boolean;
  // Git integration props (context menu only)
  gitInfo?: GitStatusResult;
  onGitStage?: (file: FileItem, action: 'stage' | 'restore' | 'restore-staged') => Promise<void>;
  onGitDiff?: (file: FileItem, from?: string, to?: string) => void;
  onGitLog?: (file?: FileItem) => void;
}

const API_BASE = typeof window !== 'undefined' && (window as any).__NEXT_DATA__?.runtimeConfig?.apiBase || '';

const truncateFileName = (name: string): string => {
  if (!name) return '';
  const chineseCharCount = (name.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherCharCount = name.length - chineseCharCount;
  const totalWeight = chineseCharCount * 2 + otherCharCount;
  const maxWeight = 25;
  if (totalWeight <= maxWeight) return name;
  let truncated = '';
  let currentWeight = 0;
  for (const char of name) {
    const isChinese = /[\u4e00-\u9fa5]/.test(char);
    const charWeight = isChinese ? 2 : 1;
    if (currentWeight + charWeight > maxWeight - 3) break;
    truncated += char;
    currentWeight += charWeight;
  }
  return truncated + '...';
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileIconSized(file: FileItem, size: number): React.ReactElement {
  if (file.type === 'directory') {
    return <Folder size={size} className="text-blue-500" />;
  }
  const ext = file.name.split('.').pop()?.toLowerCase();
  const s = size;
  switch (ext) {
    case 'png': return <PngIcon size={s} />;
    case 'jpg': case 'jpeg': return <JpgIcon size={s} />;
    case 'gif': return <GifIcon size={s} />;
    case 'svg': return <SvgFileIcon size={s} />;
    case 'webp': case 'bmp': case 'ico': return <WebpIcon size={s} />;
    case 'mp4': return <Mp4Icon size={s} />;
    case 'avi': case 'mov': case 'wmv': case 'flv': case 'webm': case 'mkv': return <VideoFileIcon size={s} />;
    case 'mp3': case 'wav': case 'ogg': case 'flac': case 'm4a': case 'aac': return <AudioFileIcon size={s} />;
    case 'doc': case 'docx': return <WordIcon size={s} />;
    case 'xls': case 'xlsx': return <ExcelIcon size={s} />;
    case 'ppt': case 'pptx': return <PowerPointIcon size={s} />;
    case 'pdf': return <PdfIcon size={s} />;
    case 'zip': case 'rar': case 'tar': case 'gz': case '7z': return <ZipIcon size={s} />;
    case 'tsx': return <TsxIcon size={s} />;
    case 'ts': return <TsIcon size={s} />;
    case 'jsx': return <JsxIcon size={s} />;
    case 'js': case 'mjs': return <JsIcon size={s} />;
    case 'css': return <CssIcon size={s} />;
    case 'scss': case 'sass': return <ScssIcon size={s} />;
    case 'html': case 'htm': return <HtmlIcon size={s} />;
    case 'json': return <JsonIcon size={s} />;
    case 'md': case 'markdown': return <MdIcon size={s} />;
    case 'txt': return <TxtIcon size={s} />;
    case 'py': return <PyIcon size={s} />;
    case 'sh': case 'bash': return <ShIcon size={s} />;
    case 'yaml': case 'yml': return <YamlIcon size={s} />;
    case 'xml': return <XmlIcon size={s} />;
    case 'sql': return <SqlIcon size={s} />;
    case 'php': return <PhpIcon size={s} />;
    case 'java': return <JavaIcon size={s} />;
    case 'c': return <CIcon size={s} />;
    case 'cpp': case 'cc': case 'cxx': return <CppIcon size={s} />;
    case 'rs': return <RustIcon size={s} />;
    case 'go': return <GoIcon size={s} />;
    case 'rb': return <RubyIcon size={s} />;
    case 'vue': return <VueIcon size={s} />;
    case 'svelte': return <SvelteIcon size={s} />;
    case 'toml': case 'ini': case 'conf': case 'config': return <TomlIcon size={s} />;
    default: return <GenericFileIcon size={s} />;
  }
}

function getFileIcon(file: FileItem): React.ReactElement {
  return getFileIconSized(file, 48);
}

export async function fileOp(projectId: string, body: Record<string, any>) {
  const r = await fetch(`${API_BASE}/api/repo/${projectId}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'Operation failed' }));
    throw new Error(err.error || 'Operation failed');
  }
  return r.json();
}

export async function uploadFiles(projectId: string, dir: string, files: FileList | File[]) {
  const formData = new FormData();
  formData.append('dir', dir);
  for (const f of Array.from(files)) {
    formData.append('files', f);
  }
  const r = await fetch(`${API_BASE}/api/repo/${projectId}/files`, {
    method: 'PUT',
    body: formData,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || 'Upload failed');
  }
  return r.json();
}

// Git status color and label maps
const GIT_STATUS_COLORS: Record<string, string> = {
  'M': '#F59E0B',  // yellow
  'A': '#10B981',  // green
  'D': '#EF4444',  // red
  '?': '#6B7280',  // gray
  'R': '#3B82F6',  // blue
  'MM': '#F97316', // orange
  'AM': '#F97316', // orange
};

const GIT_STATUS_LABELS: Record<string, string> = {
  'M': 'M', 'A': 'A', 'D': 'D', '?': 'U', 'R': 'R', 'MM': 'M', 'AM': 'A',
};

function getGitFileNameClass(status?: GitFileStatus): string {
  if (!status || status === 'clean') return 'text-gray-700 dark:text-gray-300';
  switch (status) {
    case 'M': case 'MM': return 'text-yellow-600 dark:text-yellow-400';
    case 'A': case '?': case 'AM': return 'text-green-600 dark:text-green-400';
    case 'D': return 'text-red-500 dark:text-red-400 line-through';
    case 'R': return 'text-blue-600 dark:text-blue-400';
    default: return 'text-gray-700 dark:text-gray-300';
  }
}

// Context menu component with viewport-aware positioning
export function ContextMenu({ x, y, file, onClose, onRename, onDelete, onCopy, onMove, containerRef, onNewFile, onNewFolder, onUpload, onAddToContext, onDownload, onGitStage, onGitDiff, onGitLog, readOnly }: {
  x: number; y: number; file: FileItem;
  onClose: () => void; onRename: () => void; onDelete: () => void;
  onCopy: () => void; onMove: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onUpload?: () => void;
  onAddToContext?: () => void;
  onDownload?: () => void;
  onGitStage?: (file: FileItem, action: 'stage' | 'restore' | 'restore-staged') => void;
  onGitDiff?: (file: FileItem, from?: string, to?: string) => void;
  onGitLog?: (file?: FileItem) => void;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Compute position once on mount, then reveal
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    requestAnimationFrame(() => {
      if (!ref.current) return;
      const menuRect = ref.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = x;
      let top = y;

      if (containerRef?.current) {
        const cRect = containerRef.current.getBoundingClientRect();
        left = x - cRect.left;
        top = y - cRect.top;
        const cw = cRect.width;
        const ch = cRect.height;
        if (left + menuRect.width > cw) left = cw - menuRect.width - 4;
        if (top + menuRect.height > ch) top = ch - menuRect.height - 4;
      } else {
        if (left + menuRect.width > vw - 8) left = vw - menuRect.width - 8;
        if (top + menuRect.height > vh - 8) top = vh - menuRect.height - 8;
      }
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      setPos({ left, top });
      setReady(true);
    });
  }, [x, y, containerRef]);

  const isDir = file.type === 'directory';
  const OFFICE_PDF_EXTS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.md']);
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()!.toLowerCase() : '';
  const isOfficePdf = !isDir && OFFICE_PDF_EXTS.has(ext);

  const items: { icon: React.ReactElement; label: string; action: () => void; danger?: boolean; separator?: boolean }[] = [];

  // Folder-specific: new file / new subfolder
  if (!readOnly && isDir && onNewFile) {
    items.push({ icon: <FilePlus size={14} />, label: '新建文件', action: onNewFile });
  }
  if (!readOnly && isDir && onNewFolder) {
    items.push({ icon: <FolderPlus size={14} />, label: '新建子文件夹', action: onNewFolder });
  }
  if (!readOnly && isDir && onUpload) {
    items.push({ icon: <Upload size={14} />, label: '上传文件到此', action: onUpload, separator: true });
  }

  // Common actions (hidden in readOnly mode)
  if (!readOnly) {
    items.push(
      { icon: <Pencil size={14} />, label: '重命名', action: onRename },
      { icon: <Copy size={14} />, label: '复制', action: onCopy },
      { icon: <Move size={14} />, label: '移动到...', action: onMove },
    );
  }
  if (!isDir && onDownload) {
    items.push({ icon: <Download size={14} className="text-blue-500" />, label: '下载', action: onDownload });
  }
  if (isOfficePdf && onAddToContext) {
    items.push({ icon: <BookmarkPlus size={14} className="text-blue-500" />, label: '加入上下文', action: onAddToContext, separator: true });
  }

  // Git operations
  if (file.gitStatus && file.gitStatus !== 'clean') {
    items.push({ icon: <span />, label: '', action: () => {}, separator: true });

    if (file.gitStatus === '?' || file.gitStatus === 'M' || file.gitStatus === 'MM' || file.gitStatus === 'AM') {
      items.push({
        icon: <Plus size={14} className="text-green-500" />,
        label: 'git add',
        action: () => onGitStage?.(file, 'stage')
      });
    }

    if (file.gitStatus === 'M' || file.gitStatus === 'MM') {
      items.push({
        icon: <RotateCcw size={14} className="text-yellow-500" />,
        label: '丢弃工作区改动',
        action: () => onGitStage?.(file, 'restore'),
        danger: true
      });
    }

    if (file.gitStatus === 'A' || file.gitStatus === 'MM' || file.gitStatus === 'AM') {
      items.push({
        icon: <Minus size={14} />,
        label: '取消暂存',
        action: () => onGitStage?.(file, 'restore-staged')
      });
    }

    if (['M', 'A', 'MM', 'AM', 'D'].includes(file.gitStatus)) {
      items.push({
        icon: <GitCompare size={14} className="text-blue-500" />,
        label: '查看改动差异',
        action: () => onGitDiff?.(file, 'HEAD', 'working')
      });
      if (file.gitStatus === 'A' || file.gitStatus === 'MM' || file.gitStatus === 'AM') {
        items.push({
          icon: <GitCompare size={14} />,
          label: '查看暂存差异',
          action: () => onGitDiff?.(file, 'HEAD', 'staged')
        });
      }
    }

    if (onGitLog) {
      items.push({
        icon: <History size={14} />,
        label: '查看提交历史',
        action: () => onGitLog(file)
      });
    }
  }

  if (!readOnly) {
    items.push(
      { icon: <Trash2 size={14} className="text-red-500" />, label: '删除', action: onDelete, danger: true },
    );
  }

  return (
    <div
      ref={ref}
      className={`${containerRef ? 'absolute' : 'fixed'} z-[9999] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[140px]`}
      style={{ left: pos.left, top: pos.top, visibility: ready ? 'visible' : 'hidden' }}
    >
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {item.separator && <div className="my-1 border-t border-gray-200 dark:border-gray-700" />}
          <button
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
              item.danger ? 'text-red-500' : 'text-gray-700 dark:text-gray-300'
            }`}
            onClick={() => { item.action(); onClose(); }}
          >
            {item.icon}
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

// Inline rename input
function InlineRename({ initialName, onConfirm, onCancel }: {
  initialName: string; onConfirm: (name: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Select name without extension
    const dotIdx = initialName.lastIndexOf('.');
    inputRef.current?.setSelectionRange(0, dotIdx > 0 ? dotIdx : initialName.length);
  }, [initialName]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && value.trim()) onConfirm(value.trim());
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onBlur={() => { if (value.trim() && value.trim() !== initialName) onConfirm(value.trim()); else onCancel(); }}
      className="w-full text-xs text-center bg-blue-50 dark:bg-blue-900/30 border border-blue-400 dark:border-blue-600 rounded px-1 py-0.5 outline-none"
      onClick={e => e.stopPropagation()}
    />
  );
}

// Confirm dialog
export function ConfirmDialog({ message, onConfirm, onCancel }: {
  message: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600">
            取消
          </button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm rounded-md bg-red-500 text-white hover:bg-red-600">
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

// Prompt dialog for new name / path
export function PromptDialog({ title, defaultValue, onConfirm, onCancel }: {
  title: string; defaultValue?: string; onConfirm: (val: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue || '');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 max-w-sm mx-4 w-full" onClick={e => e.stopPropagation()}>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">{title}</p>
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onConfirm(value.trim()); if (e.key === 'Escape') onCancel(); }}
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 outline-none focus:border-blue-500"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600">
            取消
          </button>
          <button onClick={() => value.trim() && onConfirm(value.trim())} className="px-3 py-1.5 text-sm rounded-md bg-blue-500 text-white hover:bg-blue-600">
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FileGridView({ files, projectId, currentDir = '.', onFileClick, onFolderClick, onRefresh, compact, onDownload, readOnly, gitInfo, onGitStage, onGitDiff, onGitLog }: FileGridViewProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileItem } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [promptDialog, setPromptDialog] = useState<{ title: string; defaultValue?: string; onConfirm: (v: string) => void } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);

  const refresh = useCallback(() => { onRefresh?.(); }, [onRefresh]);

  const handleClick = (file: FileItem) => {
    if (renamingPath) return;
    if (file.type === 'directory') {
      onFolderClick?.(file);
    } else {
      onFileClick?.(file);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    // Use nativeEvent.offsetX/offsetY won't work across nested elements,
    // so pass clientX/clientY and let ContextMenu compute relative to container
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  // Rename
  const handleRename = async (file: FileItem, newName: string) => {
    if (!projectId || newName === file.name) { setRenamingPath(null); return; }
    const dir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '.';
    const newPath = dir === '.' ? newName : `${dir}/${newName}`;
    try {
      await fileOp(projectId, { action: 'rename', oldPath: file.path, newPath });
      refresh();
    } catch (err: any) {
      alert('重命名失败: ' + err.message);
    }
    setRenamingPath(null);
  };

  // Delete
  const handleDelete = async () => {
    if (!projectId || !deleteTarget) return;
    try {
      await fileOp(projectId, { action: 'delete', path: deleteTarget.path });
      refresh();
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
    setDeleteTarget(null);
  };

  // Copy
  const handleCopy = (file: FileItem) => {
    if (!projectId) return;
    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    const baseName = ext ? file.name.slice(0, -ext.length) : file.name;
    const copyName = `${baseName} - 副本${ext}`;
    const dir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '.';
    const destPath = dir === '.' ? copyName : `${dir}/${copyName}`;
    fileOp(projectId, { action: 'copy', sourcePath: file.path, destPath })
      .then(refresh)
      .catch((err: any) => alert('复制失败: ' + err.message));
  };

  // Move
  const handleMove = (file: FileItem) => {
    setPromptDialog({
      title: `移动 "${file.name}" 到目录（相对路径）:`,
      defaultValue: currentDir === '.' ? '' : currentDir,
      onConfirm: async (destDir) => {
        if (!projectId) return;
        try {
          await fileOp(projectId, { action: 'move', sourcePath: file.path, destDir: destDir || '.' });
          refresh();
        } catch (err: any) {
          alert('移动失败: ' + err.message);
        }
        setPromptDialog(null);
      }
    });
  };

  // New folder
  const handleNewFolder = () => {
    setPromptDialog({
      title: '新建文件夹名称:',
      onConfirm: async (name) => {
        if (!projectId) return;
        const folderPath = currentDir === '.' ? name : `${currentDir}/${name}`;
        try {
          await fileOp(projectId, { action: 'mkdir', path: folderPath });
          refresh();
        } catch (err: any) {
          alert('创建文件夹失败: ' + err.message);
        }
        setPromptDialog(null);
      }
    });
  };

  // New file
  const handleNewFile = () => {
    setPromptDialog({
      title: '新建文件名称:',
      defaultValue: 'untitled.txt',
      onConfirm: async (name) => {
        if (!projectId) return;
        const filePath = currentDir === '.' ? name : `${currentDir}/${name}`;
        try {
          await fileOp(projectId, { action: 'createFile', path: filePath, content: '' });
          refresh();
        } catch (err: any) {
          alert('创建文件失败: ' + err.message);
        }
        setPromptDialog(null);
      }
    });
  };

  // Upload
  const handleUpload = async (fileList: FileList | File[]) => {
    if (!projectId) return;
    try {
      await uploadFiles(projectId, currentDir, fileList);
      refresh();
    } catch (err: any) {
      alert('上传失败: ' + err.message);
    }
  };

  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Drag & drop
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragOver(false);
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative h-full flex flex-col ${isDragOver ? 'ring-2 ring-blue-400 ring-inset bg-blue-50/30 dark:bg-blue-900/10' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* File grid / compact list */}
      {compact ? (
        <>
          {/* Compact toolbar: new file, new folder, upload */}
          {projectId && !readOnly && (
            <div className="flex items-center gap-1 px-2.5 py-2 border-b border-white/10 dark:border-white/[0.04] shrink-0">
              <button
                onClick={handleNewFile}
                className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded-lg hover:bg-white/25 dark:hover:bg-white/[0.06] text-text-secondary/70 hover:text-text-main transition-colors"
                title="新建文件"
              >
                <FilePlus size={13} />
                <span>新建文件</span>
              </button>
              <button
                onClick={handleNewFolder}
                className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded-lg hover:bg-white/25 dark:hover:bg-white/[0.06] text-text-secondary/70 hover:text-text-main transition-colors"
                title="新建文件夹"
              >
                <FolderPlus size={13} />
                <span>文件夹</span>
              </button>
              <button
                onClick={() => uploadInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded-lg hover:bg-white/25 dark:hover:bg-white/[0.06] text-text-secondary/70 hover:text-text-main transition-colors ml-auto"
                title="上传文件"
              >
                <Upload size={13} />
                <span>上传</span>
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files?.length) { handleUpload(e.target.files); e.target.value = ''; } }}
              />
            </div>
          )}
          <div className="flex flex-col p-2 gap-0.5 overflow-y-auto flex-1">
          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-gray-500">
              <Folder className="w-8 h-8 mb-2 opacity-40" />
              <span className="text-[11px]">暂无文件</span>
              <span className="text-[10px] mt-0.5">拖放文件或右键新建</span>
            </div>
          ) : files.map((file) => (
            <div
              key={file.path}
              data-file-item
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-white/25 dark:hover:bg-white/[0.06] transition-colors group"
              onClick={() => handleClick(file)}
              onContextMenu={(e) => handleContextMenu(e, file)}
              title={file.name}
            >
              <div className="relative shrink-0 flex items-center justify-center w-7 h-7">
                {getFileIconSized(file, 28)}
              </div>
              {renamingPath === file.path ? (
                <InlineRename
                  initialName={file.name}
                  onConfirm={(newName) => handleRename(file, newName)}
                  onCancel={() => setRenamingPath(null)}
                />
              ) : (
                <div className="flex-1 min-w-0">
                  <div className={`text-[12px] truncate ${getGitFileNameClass(file.gitStatus)}`}>{file.name}</div>
                  {file.type === 'file' && file.size !== undefined && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-500">{formatSize(file.size)}</div>
                  )}
                </div>
              )}
              {file.type === 'directory' && (
                <ChevronRight className="w-3 h-3 text-gray-400/40 shrink-0" />
              )}
              {projectId && file.type === 'file' && (
                <button
                  className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/30 dark:hover:bg-white/[0.08] text-gray-400 hover:text-blue-500 transition-all shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    const itemEl = (e.currentTarget as HTMLElement).closest('[data-file-item]') as HTMLElement;
                    if (itemEl) {
                      const rect = itemEl.getBoundingClientRect();
                      setContextMenu({ x: rect.right - 10, y: rect.bottom, file });
                    }
                  }}
                >
                  <MoreHorizontal size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        </>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3 p-4">
        {files.map((file) => (
          <div
            key={file.path}
            data-file-item
            className="flex flex-col items-center gap-1.5 p-2 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
            onClick={() => handleClick(file)}
            onContextMenu={(e) => handleContextMenu(e, file)}
            onDoubleClick={(e) => {
              e.preventDefault();
              if (projectId) setRenamingPath(file.path);
            }}
            title={file.name}
          >
            <div className="relative flex items-center justify-center w-12 h-12">
              {getFileIcon(file)}
              {/* Git status badge */}
              {file.gitStatus && file.gitStatus !== 'clean' && (
                file.type === 'directory' ? (
                  <span
                    className="absolute -bottom-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full text-[8px] flex items-center justify-center text-white font-bold shadow-sm bg-orange-500"
                  >
                    {file.dirChangedCount || '\u2022'}
                  </span>
                ) : (
                  <span
                    className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full text-[7px] flex items-center justify-center text-white font-bold shadow-sm"
                    style={{ backgroundColor: GIT_STATUS_COLORS[file.gitStatus] || '#6B7280' }}
                  >
                    {GIT_STATUS_LABELS[file.gitStatus] || '?'}
                  </span>
                )
              )}
              {/* More button on hover */}
              {projectId && (
                <button
                  className="absolute -top-1 -right-1 p-0.5 rounded bg-white dark:bg-gray-700 shadow opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Position menu right below the icon using the item element's rect
                    const itemEl = (e.currentTarget as HTMLElement).closest('[data-file-item]') as HTMLElement;
                    if (itemEl) {
                      const rect = itemEl.getBoundingClientRect();
                      setContextMenu({ x: rect.left + rect.width / 2, y: rect.bottom, file });
                    } else {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setContextMenu({ x: rect.left, y: rect.bottom + 2, file });
                    }
                  }}
                >
                  <MoreHorizontal size={12} className="text-gray-500 dark:text-gray-400" />
                </button>
              )}
            </div>
            {renamingPath === file.path ? (
              <InlineRename
                initialName={file.name}
                onConfirm={(newName) => handleRename(file, newName)}
                onCancel={() => setRenamingPath(null)}
              />
            ) : (
              <span className={`text-xs text-center leading-tight break-all line-clamp-2 ${getGitFileNameClass(file.gitStatus)}`}>
                {truncateFileName(file.name)}
              </span>
            )}
          </div>
        ))}
      </div>
      )}

      {/* Drag overlay */}
      {isDragOver && !readOnly && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-50/60 dark:bg-blue-900/20 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-blue-500">
            <Upload size={32} />
            <span className="text-sm font-medium">拖放文件到此处上传</span>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && !readOnly && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          containerRef={containerRef}
          onClose={() => setContextMenu(null)}
          onRename={() => setRenamingPath(contextMenu.file.path)}
          onDelete={() => setDeleteTarget(contextMenu.file)}
          onCopy={() => handleCopy(contextMenu.file)}
          onMove={() => handleMove(contextMenu.file)}
          onNewFile={projectId ? () => { setContextMenu(null); handleNewFile(); } : undefined}
          onNewFolder={projectId ? () => { setContextMenu(null); handleNewFolder(); } : undefined}
          onUpload={projectId ? () => { setContextMenu(null); uploadInputRef.current?.click(); } : undefined}
          onGitStage={onGitStage ? (file, action) => { onGitStage(file, action); setContextMenu(null); } : undefined}
          onGitDiff={onGitDiff ? (file, from, to) => { onGitDiff(file, from, to); setContextMenu(null); } : undefined}
          onGitLog={onGitLog ? (file) => { onGitLog(file); setContextMenu(null); } : undefined}
          onDownload={onDownload ? () => { onDownload(contextMenu.file); setContextMenu(null); } : undefined}
          onAddToContext={projectId ? () => {
            const f = contextMenu.file;
            fetch(`/api/context-files`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId, relativePath: f.path, name: f.name, size: f.size || 0 }),
            }).catch(() => {});
            setContextMenu(null);
          } : undefined}
        />
      )}
      {/* Read-only mode: show context menu with download only */}
      {contextMenu && readOnly && onDownload && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          containerRef={containerRef}
          readOnly
          onClose={() => setContextMenu(null)}
          onRename={() => {}}
          onDelete={() => {}}
          onCopy={() => {}}
          onMove={() => {}}
          onDownload={contextMenu.file.type !== 'directory' ? () => { onDownload(contextMenu.file); setContextMenu(null); } : undefined}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          message={`确定要删除 "${deleteTarget.name}" 吗？${deleteTarget.type === 'directory' ? '该文件夹及其所有内容将被永久删除。' : '此操作不可撤销。'}`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Prompt dialog */}
      {promptDialog && (
        <PromptDialog
          title={promptDialog.title}
          defaultValue={promptDialog.defaultValue}
          onConfirm={promptDialog.onConfirm}
          onCancel={() => setPromptDialog(null)}
        />
      )}

    </div>
  );
}

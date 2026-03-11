"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  GitBranch, ChevronDown, ChevronRight, Check, Plus, Minus,
  RotateCcw, FileText, FolderOpen, GitCompare, RefreshCw, Upload, Sparkles, Loader2,
  ExternalLink, Undo2
} from 'lucide-react';
import type { GitFileStatus, GitStatusResult } from '@/types/shared/git';
import type { FileItem } from './FileGridView';

// ─── Types ────────────────────────────────────────────────────
interface GitFileEntry {
  path: string;
  status: GitFileStatus;
  /** Display status for this specific section (e.g. 'M' for staged, 'M' for unstaged) */
  displayStatus: string;
}

interface SourceControlPanelProps {
  projectId: string;
  gitInfo?: GitStatusResult;
  branches?: string[];
  onGitStage?: (file: FileItem, action: 'stage' | 'restore' | 'restore-staged') => Promise<void>;
  onGitDiff?: (file: FileItem, from?: string, to?: string) => void;
  onGitCommit?: (message: string) => Promise<void>;
  onGitPush?: () => Promise<void>;
  onGitCheckout?: (branch: string) => void;
  onRefresh?: () => void;
  onFileClick?: (path: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  'M': 'text-yellow-600 dark:text-yellow-400',
  'A': 'text-green-600 dark:text-green-400',
  'D': 'text-red-500 dark:text-red-400',
  'U': 'text-green-600 dark:text-green-400',
  'R': 'text-blue-500 dark:text-blue-400',
};

const STATUS_TOOLTIPS: Record<string, string> = {
  'M': '已修改', 'A': '新文件', 'D': '已删除', 'U': '未跟踪', 'R': '已重命名',
};

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

function getDirName(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx > 0 ? path.substring(0, idx) : '';
}

function toFileItem(f: GitFileEntry): FileItem {
  return {
    name: getFileName(f.path),
    path: f.path,
    type: 'file',
    gitStatus: f.status,
  };
}

// ─── Categorize files using raw X/Y status from git porcelain ─────
function categorizeFiles(files: Array<{ path: string; status: GitFileStatus; indexStatus: string; workTreeStatus: string }>) {
  const staged: GitFileEntry[] = [];
  const unstaged: GitFileEntry[] = [];
  const untracked: GitFileEntry[] = [];

  for (const f of files) {
    const x = f.indexStatus;
    const y = f.workTreeStatus;

    if (x === '?' && y === '?') {
      // Untracked
      untracked.push({ path: f.path, status: '?', displayStatus: 'U' });
    } else {
      // Staged: X is not ' ' and not '?' (file has changes in index)
      if (x !== ' ' && x !== '?') {
        staged.push({ path: f.path, status: f.status, displayStatus: x === 'R' ? 'R' : x });
      }
      // Unstaged: Y is not ' ' and not '?' (file has changes in working tree)
      if (y !== ' ' && y !== '?') {
        unstaged.push({ path: f.path, status: f.status, displayStatus: y });
      }
    }
  }
  return { staged, unstaged, untracked };
}

// ─── File Row ─────────────────────────────────────────────────
function FileRow({ file, onStage, onRestore, onRestoreStaged, onDiff, onOpenFile }: {
  file: GitFileEntry;
  onStage?: () => void;
  onRestore?: () => void;
  onRestoreStaged?: () => void;
  onDiff?: () => void;
  onOpenFile?: () => void;
}) {
  const fileName = getFileName(file.path);
  const dirName = getDirName(file.path);
  const colorClass = STATUS_COLORS[file.displayStatus] || 'text-gray-500';
  const label = file.displayStatus;
  const tooltip = STATUS_TOOLTIPS[file.displayStatus] || file.displayStatus;

  return (
    <div
      className="group flex items-center h-[22px] px-2 pl-6 cursor-pointer hover:bg-white/10 dark:hover:bg-white/5 text-[12px]"
      onClick={onDiff}
      title={file.path}
    >
      {/* File icon */}
      <FileText size={14} className="text-gray-400 dark:text-gray-500 mr-1.5 flex-shrink-0" />

      {/* File name */}
      <span className={`truncate ${colorClass}`}>
        {fileName}
      </span>

      {/* Directory path */}
      {dirName && (
        <span className="ml-1.5 text-gray-400 dark:text-gray-500 truncate text-[11px]">
          {dirName}
        </span>
      )}

      <span className="flex-1" />

      {/* Hover action buttons */}
      <div className="hidden group-hover:flex items-center gap-0.5 mr-1">
        {onOpenFile && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenFile(); }}
            className="p-0.5 rounded hover:bg-white/20 dark:hover:bg-white/10"
            title="打开文件"
          >
            <ExternalLink size={12} className="text-gray-500 dark:text-gray-400" />
          </button>
        )}
        {onRestore && (
          <button
            onClick={(e) => { e.stopPropagation(); onRestore(); }}
            className="p-0.5 rounded hover:bg-white/20 dark:hover:bg-white/10"
            title="丢弃更改"
          >
            <RotateCcw size={12} className="text-gray-500 dark:text-gray-400" />
          </button>
        )}
        {onRestoreStaged && (
          <button
            onClick={(e) => { e.stopPropagation(); onRestoreStaged(); }}
            className="p-0.5 rounded hover:bg-white/20 dark:hover:bg-white/10"
            title="取消暂存"
          >
            <Minus size={12} className="text-gray-500 dark:text-gray-400" />
          </button>
        )}
        {onStage && (
          <button
            onClick={(e) => { e.stopPropagation(); onStage(); }}
            className="p-0.5 rounded hover:bg-white/20 dark:hover:bg-white/10"
            title="暂存更改"
          >
            <Plus size={12} className="text-gray-500 dark:text-gray-400" />
          </button>
        )}
      </div>

      {/* Status label */}
      <span className={`w-4 text-center text-[11px] font-medium flex-shrink-0 ${colorClass}`} title={tooltip}>
        {label}
      </span>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────
function SectionHeader({ title, count, expanded, onToggle, actions }: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="group flex items-center h-[22px] px-2 cursor-pointer hover:bg-white/10 dark:hover:bg-white/5 text-[11px] font-semibold text-slate-600 dark:text-slate-400 select-none">
      <button onClick={onToggle} className="flex items-center gap-0.5 flex-1 min-w-0">
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="truncate">{title}</span>
      </button>
      {actions && (
        <div className="hidden group-hover:flex items-center gap-0.5">
          {actions}
        </div>
      )}
      <span className="ml-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-slate-500/20 dark:bg-slate-400/15 text-[10px] font-medium text-slate-500 dark:text-slate-400">
        {count}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────
export default function SourceControlPanel({
  projectId, gitInfo, branches, onGitStage, onGitDiff, onGitCommit, onGitPush, onGitCheckout, onRefresh, onFileClick,
}: SourceControlPanelProps) {
  const [commitMsg, setCommitMsg] = useState('');
  const [showBranches, setShowBranches] = useState(false);
  const [expandStaged, setExpandStaged] = useState(true);
  const [expandChanges, setExpandChanges] = useState(true);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const branchRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Close branch dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (branchRef.current && !branchRef.current.contains(e.target as Node)) setShowBranches(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Categorize
  const { staged, unstaged, untracked } = useMemo(() => {
    if (!gitInfo?.files?.length) return { staged: [], unstaged: [], untracked: [] };
    return categorizeFiles(gitInfo.files);
  }, [gitInfo?.files]);

  // Merge unstaged + untracked into a single "Changes" list (VS Code style)
  const changes = useMemo(() => [...unstaged, ...untracked], [unstaged, untracked]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim() || !onGitCommit) return;
    setIsCommitting(true);
    try {
      await onGitCommit(commitMsg.trim());
      setCommitMsg('');
    } finally {
      setIsCommitting(false);
    }
  }, [commitMsg, onGitCommit]);

  const handleUndoCommit = useCallback(async () => {
    setIsUndoing(true);
    try {
      const res = await fetch(`/api/repo/${projectId}/git/undo-commit`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onRefresh?.();
      } else {
        console.error('[Undo commit]', data.error);
      }
    } catch (err) {
      console.error('[Undo commit]', err);
    } finally {
      setIsUndoing(false);
    }
  }, [projectId, onRefresh]);

  const handleGenerateMsg = useCallback(async () => {
    if (staged.length === 0) return;
    setIsGenerating(true);
    try {
      const res = await fetch(`/api/repo/${projectId}/git/generate-commit-msg`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.message) {
        setCommitMsg(data.message);
        // Auto-resize textarea
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 80) + 'px';
          }
        }, 0);
      } else {
        console.error('[AI commit msg]', data.error);
      }
    } catch (err) {
      console.error('[AI commit msg]', err);
    } finally {
      setIsGenerating(false);
    }
  }, [projectId, staged.length]);

  const handleStageAll = useCallback(() => {
    for (const f of unstaged) {
      onGitStage?.(toFileItem(f), 'stage');
    }
    for (const f of untracked) {
      onGitStage?.(toFileItem(f), 'stage');
    }
  }, [unstaged, untracked, onGitStage]);

  const handleUnstageAll = useCallback(() => {
    for (const f of staged) {
      onGitStage?.(toFileItem(f), 'restore-staged');
    }
  }, [staged, onGitStage]);

  const handleDiscardAll = useCallback(() => {
    if (!confirm('确定要丢弃所有工作区更改吗？此操作不可撤销。')) return;
    for (const f of unstaged) {
      if (f.status === 'M' || f.status === 'MM') {
        onGitStage?.(toFileItem(f), 'restore');
      }
    }
  }, [unstaged, onGitStage]);

  if (!gitInfo?.initialized) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 text-xs gap-2 px-4">
        <GitBranch size={24} />
        <span>此项目未初始化 Git 仓库</span>
      </div>
    );
  }

  const totalChanges = staged.length + changes.length;

  return (
    <div className="flex flex-col h-full text-[12px]">
      {/* ── Branch Bar ─────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/10 dark:border-white/[0.06]">
        <div ref={branchRef} className="relative flex-1 min-w-0">
          <button
            onClick={() => setShowBranches(!showBranches)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/15 dark:hover:bg-white/10 transition-colors text-slate-600 dark:text-slate-400 min-w-0"
          >
            <GitBranch size={12} className="flex-shrink-0" />
            <span className="font-medium truncate text-[11px]">{gitInfo.branch || 'HEAD'}</span>
            <ChevronDown size={10} className="flex-shrink-0" />
          </button>

          {showBranches && branches && branches.length > 0 && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px] max-h-[260px] overflow-y-auto">
              {branches.map(b => (
                <button
                  key={b}
                  onClick={() => {
                    if (b !== gitInfo.branch) onGitCheckout?.(b);
                    setShowBranches(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                    b === gitInfo.branch ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {b === gitInfo.branch ? <Check size={10} /> : <span className="w-[10px]" />}
                  {b}
                </button>
              ))}
            </div>
          )}
        </div>

        {onRefresh && (
          <button onClick={onRefresh} className="p-1 rounded hover:bg-white/15 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400" title="刷新">
            <RefreshCw size={12} />
          </button>
        )}
      </div>

      {/* ── Commit Input ───────────────────────────── */}
      <div className="px-2 py-2 border-b border-white/10 dark:border-white/[0.06]">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="提交信息 (⌘Enter 提交)"
            className="w-full px-2 py-1.5 pr-7 text-[12px] bg-white/10 dark:bg-white/5 border border-white/15 dark:border-white/10 rounded text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500/50 resize-none min-h-[28px] max-h-[80px]"
            rows={1}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                handleCommit();
              }
            }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 80) + 'px';
            }}
          />
          <button
            onClick={handleGenerateMsg}
            disabled={staged.length === 0 || isGenerating}
            className="absolute right-1.5 top-1.5 p-0.5 rounded transition-colors text-slate-400 hover:text-amber-500 dark:hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed"
            title="AI 生成提交信息"
          >
            {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          </button>
        </div>
        <div className="flex items-center gap-1 mt-1.5">
          <button
            onClick={handleCommit}
            disabled={!commitMsg.trim() || staged.length === 0 || isCommitting}
            className="flex-1 py-1 rounded text-[11px] font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isCommitting ? '提交中...' : `提交${staged.length > 0 ? ` (${staged.length})` : ''}`}
          </button>
          <button
            onClick={handleUndoCommit}
            disabled={isUndoing}
            className="px-2 py-1 rounded text-[11px] font-medium transition-colors bg-white/10 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-white/20 dark:hover:bg-white/10 border border-white/15 dark:border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title="撤销上次提交 (git reset --soft HEAD~1)"
          >
            {isUndoing ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
          </button>
          {gitInfo.hasRemote && onGitPush && (
            <button
              onClick={onGitPush}
              className="px-2 py-1 rounded text-[11px] font-medium transition-colors bg-white/10 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-white/20 dark:hover:bg-white/10 border border-white/15 dark:border-white/10"
              title="推送"
            >
              <Upload size={12} />
            </button>
          )}
        </div>
      </div>

      {/* ── File Sections ──────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {totalChanges === 0 ? (
          <div className="px-3 py-8 text-center text-[11px] text-slate-500 dark:text-slate-400 select-none">
            没有待处理的更改
          </div>
        ) : (
          <>
            {/* Staged Changes */}
            {staged.length > 0 && (
              <div>
                <SectionHeader
                  title="暂存的更改"
                  count={staged.length}
                  expanded={expandStaged}
                  onToggle={() => setExpandStaged(!expandStaged)}
                  actions={
                    <button
                      onClick={handleUnstageAll}
                      className="p-0.5 rounded hover:bg-white/20 dark:hover:bg-white/10"
                      title="全部取消暂存"
                    >
                      <Minus size={12} className="text-gray-500" />
                    </button>
                  }
                />
                {expandStaged && staged.map(f => (
                  <FileRow
                    key={`staged-${f.path}`}
                    file={f}
                    onRestoreStaged={() => onGitStage?.(toFileItem(f), 'restore-staged')}
                    onDiff={() => onGitDiff?.(toFileItem(f), 'HEAD', 'staged')}
                    onOpenFile={() => onFileClick?.(f.path)}
                  />
                ))}
              </div>
            )}

            {/* Changes (unstaged + untracked merged, like VS Code) */}
            {changes.length > 0 && (
              <div>
                <SectionHeader
                  title="更改"
                  count={changes.length}
                  expanded={expandChanges}
                  onToggle={() => setExpandChanges(!expandChanges)}
                  actions={
                    <>
                      <button
                        onClick={handleDiscardAll}
                        className="p-0.5 rounded hover:bg-white/20 dark:hover:bg-white/10"
                        title="丢弃所有更改"
                      >
                        <RotateCcw size={12} className="text-gray-500" />
                      </button>
                      <button
                        onClick={handleStageAll}
                        className="p-0.5 rounded hover:bg-white/20 dark:hover:bg-white/10"
                        title="全部暂存"
                      >
                        <Plus size={12} className="text-gray-500" />
                      </button>
                    </>
                  }
                />
                {expandChanges && changes.map(f => (
                  <FileRow
                    key={`changes-${f.path}`}
                    file={f}
                    onStage={() => onGitStage?.(toFileItem(f), 'stage')}
                    onRestore={(f.status === 'M' || f.status === 'MM') ? () => onGitStage?.(toFileItem(f), 'restore') : undefined}
                    onDiff={() => onGitDiff?.(toFileItem(f), 'HEAD', 'working')}
                    onOpenFile={() => onFileClick?.(f.path)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

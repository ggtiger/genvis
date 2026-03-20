"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, Columns, AlignJustify, ChevronUp, ChevronDown } from 'lucide-react';
import type { FileDiffResult, DiffLine, GitCommit } from '@/types/shared/git';

type ViewMode = 'split' | 'unified';

interface DiffViewerProps {
  projectId: string;
  filePath: string;
  diff: FileDiffResult;
  from: string;
  to: string;
  onClose: () => void;
  commits?: GitCommit[];
  onCommitChange?: (from: string, to: string) => void;
}

const LINE_STYLES: Record<string, string> = {
  add:     'bg-green-500/20 text-green-900 dark:text-green-100',
  remove:  'bg-red-500/20 text-red-900 dark:text-red-100',
  context: 'text-slate-800 dark:text-slate-200',
  header:  'bg-blue-500/15 text-blue-700 dark:text-blue-300 font-mono text-xs',
};

const LINE_NO_STYLES: Record<string, string> = {
  add:     'bg-green-500/25 text-green-700 dark:text-green-300',
  remove:  'bg-red-500/25 text-red-700 dark:text-red-300',
  context: 'bg-black/[0.03] dark:bg-white/[0.03] text-slate-500 dark:text-slate-400',
  header:  'bg-blue-500/15 text-blue-600 dark:text-blue-400',
};

/** Syntax highlight a line using highlight.js */
function useHighlighter(ext: string) {
  const [hljs, setHljs] = useState<any>(null);
  useEffect(() => {
    import('highlight.js/lib/common').then(mod => setHljs(mod.default)).catch(() => {});
  }, []);

  const highlight = useCallback((code: string) => {
    if (!hljs) return code;
    const lang = extToLang(ext);
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch {
        return hljs.highlightAuto(code).value;
      }
    }
    return hljs.highlightAuto(code).value;
  }, [hljs, ext]);

  return highlight;
}

function extToLang(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', swift: 'swift',
    css: 'css', scss: 'scss', html: 'html', xml: 'xml', json: 'json',
    yaml: 'yaml', yml: 'yaml', md: 'markdown', sql: 'sql', sh: 'bash',
    bash: 'bash', toml: 'ini', vue: 'xml', svelte: 'xml',
  };
  return map[ext.toLowerCase()] || '';
}

/** Compute indices of change block starts (first add/remove after context/header) */
function computeChangeBlocks(diff: FileDiffResult): number[] {
  const blocks: number[] = [];
  let globalRow = 0;
  let inChange = false;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add' || line.type === 'remove') {
        if (!inChange) {
          blocks.push(globalRow);
          inChange = true;
        }
      } else {
        inChange = false;
      }
      globalRow++;
    }
  }
  return blocks;
}

// =============== Unified View ===============
function UnifiedView({ diff, highlight, changeBlocks }: { diff: FileDiffResult; highlight: (code: string) => string; changeBlocks: number[] }) {
  const blockSet = useMemo(() => new Set(changeBlocks), [changeBlocks]);
  // Track global row index for change block markers
  let globalIdx = 0;
  return (
    <table className="w-full text-xs font-mono border-collapse">
      <tbody>
        {diff.hunks.map((hunk, hi) => {
          return hunk.lines.map((line, li) => {
            const idx = globalIdx;
            const isBlockStart = blockSet.has(idx);
            globalIdx++;
            return (
            <tr key={`${hi}-${li}`} className={LINE_STYLES[line.type]}
              {...(isBlockStart ? { 'data-change-block': String(changeBlocks.indexOf(idx)) } : {})}
            >
              <td className={`w-10 text-right px-2 py-0 select-none border-r border-white/10 dark:border-white/5 ${LINE_NO_STYLES[line.type]}`}>
                {line.oldLineNo ?? ''}
              </td>
              <td className={`w-10 text-right px-2 py-0 select-none border-r border-white/10 dark:border-white/5 ${LINE_NO_STYLES[line.type]}`}>
                {line.newLineNo ?? ''}
              </td>
              <td className="px-2 py-0 whitespace-pre-wrap break-all">
                {line.type === 'header' ? (
                  <span>{line.content}</span>
                ) : (
                  <>
                    <span className="select-none mr-1 opacity-60">
                      {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                    </span>
                    <span dangerouslySetInnerHTML={{ __html: highlight(line.content) }} />
                  </>
                )}
              </td>
            </tr>
            );
          });
        })}
      </tbody>
    </table>
  );
}

// =============== Split View ===============
function SplitView({ diff, highlight, changeBlocks }: { diff: FileDiffResult; highlight: (code: string) => string; changeBlocks: number[] }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const syncScroll = useCallback((source: 'left' | 'right') => {
    if (syncing.current) return;
    syncing.current = true;
    const from = source === 'left' ? leftRef.current : rightRef.current;
    const to = source === 'left' ? rightRef.current : leftRef.current;
    if (from && to) {
      to.scrollTop = from.scrollTop;
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  // Build left/right line pairs
  const pairs: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
  for (const hunk of diff.hunks) {
    // Add header to both sides
    const headerLine = hunk.lines.find(l => l.type === 'header');
    if (headerLine) {
      pairs.push({ left: headerLine, right: headerLine });
    }

    let i = 0;
    const lines = hunk.lines.filter(l => l.type !== 'header');
    while (i < lines.length) {
      const line = lines[i];
      if (line.type === 'context') {
        pairs.push({ left: line, right: line });
        i++;
      } else if (line.type === 'remove') {
        // Collect consecutive removes and adds
        const removes: DiffLine[] = [];
        while (i < lines.length && lines[i].type === 'remove') {
          removes.push(lines[i]);
          i++;
        }
        const adds: DiffLine[] = [];
        while (i < lines.length && lines[i].type === 'add') {
          adds.push(lines[i]);
          i++;
        }
        const maxLen = Math.max(removes.length, adds.length);
        for (let j = 0; j < maxLen; j++) {
          pairs.push({
            left: j < removes.length ? removes[j] : null,
            right: j < adds.length ? adds[j] : null,
          });
        }
      } else if (line.type === 'add') {
        pairs.push({ left: null, right: line });
        i++;
      } else {
        i++;
      }
    }
  }

  // Mark pairs that are the start of a change block (first add/remove after context)
  const changePairSet = useMemo(() => {
    const result = new Map<number, number>(); // pairIdx -> blockIdx
    let inChange = false;
    let blockIdx = 0;
    for (let pi = 0; pi < pairs.length; pi++) {
      const p = pairs[pi];
      const isChange = (p.left && (p.left.type === 'add' || p.left.type === 'remove')) ||
                       (p.right && (p.right.type === 'add' || p.right.type === 'remove'));
      if (isChange && !inChange) {
        result.set(pi, blockIdx++);
        inChange = true;
      } else if (!isChange) {
        inChange = false;
      }
    }
    return result;
  }, [pairs]);

  const renderSide = (line: DiffLine | null, side: 'left' | 'right') => {
    if (!line) {
      return (
        <tr className="bg-white/3 dark:bg-white/[0.02] h-5">
          <td className="w-10 border-r border-white/10 dark:border-white/5" />
          <td />
        </tr>
      );
    }
    const lineNo = side === 'left' ? line.oldLineNo : line.newLineNo;
    return (
      <tr className={LINE_STYLES[line.type]}>
        <td className={`w-10 text-right px-2 py-0 select-none border-r border-white/10 dark:border-white/5 text-xs ${LINE_NO_STYLES[line.type]}`}>
          {lineNo ?? ''}
        </td>
        <td className="px-2 py-0 whitespace-pre-wrap break-all text-xs">
          {line.type === 'header' ? (
            <span className="text-xs">{line.content}</span>
          ) : (
            <span dangerouslySetInnerHTML={{ __html: highlight(line.content) }} />
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="flex h-full">
      <div ref={leftRef} className="w-1/2 overflow-auto border-r border-white/10 dark:border-white/5" onScroll={() => syncScroll('left')}>
        <table className="w-full font-mono border-collapse">
          <tbody>
            {pairs.map((p, i) => (
              <React.Fragment key={i}>
                <tr style={{ height: 0, padding: 0, border: 'none' }}
                  {...(changePairSet.has(i) ? { 'data-change-block': String(changePairSet.get(i)) } : {})}
                />
                {renderSide(p.left, 'left')}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div ref={rightRef} className="w-1/2 overflow-auto" onScroll={() => syncScroll('right')}>
        <table className="w-full font-mono border-collapse">
          <tbody>
            {pairs.map((p, i) => (
              <React.Fragment key={i}>{renderSide(p.right, 'right')}</React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =============== Main DiffViewer ===============
export default function DiffViewer({ projectId, filePath, diff, from, to, onClose, commits, onCommitChange }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [currentChangeIdx, setCurrentChangeIdx] = useState(-1);
  const contentRef = useRef<HTMLDivElement>(null);
  const ext = filePath.split('.').pop() || '';
  const highlight = useHighlighter(ext);

  const changeBlocks = useMemo(() => computeChangeBlocks(diff), [diff]);
  const totalChanges = changeBlocks.length;

  const navigateChange = useCallback((direction: 'prev' | 'next') => {
    if (totalChanges === 0) return;
    let nextIdx: number;
    if (direction === 'next') {
      nextIdx = currentChangeIdx < totalChanges - 1 ? currentChangeIdx + 1 : 0;
    } else {
      nextIdx = currentChangeIdx > 0 ? currentChangeIdx - 1 : totalChanges - 1;
    }
    setCurrentChangeIdx(nextIdx);
    // Find the element with data-change-block attribute and scroll to it
    const container = contentRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-change-block="${nextIdx}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentChangeIdx, totalChanges]);

  // Keyboard shortcuts: Escape to close, F7/Shift+F7 or Alt+Down/Up to navigate
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'F7' && !e.shiftKey) { e.preventDefault(); navigateChange('next'); }
      if (e.key === 'F7' && e.shiftKey) { e.preventDefault(); navigateChange('prev'); }
      if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); navigateChange('next'); }
      if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); navigateChange('prev'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, navigateChange]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="rounded-xl shadow-2xl flex flex-col w-[90vw] max-w-5xl h-[80vh] overflow-hidden bg-white/95 dark:bg-slate-900/95 border border-white/30 dark:border-white/10"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200/50 dark:border-white/10 shrink-0 bg-white/40 dark:bg-white/[0.03]">
          <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {filePath}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {from} &rarr; {to}
          </span>

          <div className="flex-1" />

          {/* Stats */}
          <span className="text-xs text-green-600 dark:text-green-400 font-semibold">+{diff.addedLines}</span>
          <span className="text-xs text-red-600 dark:text-red-400 font-semibold">-{diff.removedLines}</span>

          {/* Change navigation */}
          {totalChanges > 0 && (
            <div className="flex items-center gap-0.5 bg-slate-200/50 dark:bg-white/10 rounded-md p-0.5">
              <button
                onClick={() => navigateChange('prev')}
                className="p-1 rounded hover:bg-white/60 dark:hover:bg-white/10 transition-colors"
                title="上一个修改 (Shift+F7)"
              >
                <ChevronUp size={14} />
              </button>
              <span className="text-[10px] text-slate-600 dark:text-slate-300 min-w-[32px] text-center tabular-nums">
                {currentChangeIdx >= 0 ? currentChangeIdx + 1 : '-'}/{totalChanges}
              </span>
              <button
                onClick={() => navigateChange('next')}
                className="p-1 rounded hover:bg-white/60 dark:hover:bg-white/10 transition-colors"
                title="下一个修改 (F7)"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}

          {/* View toggle */}
          <div className="flex items-center gap-0.5 bg-slate-200/50 dark:bg-white/10 rounded-md p-0.5">
            <button
              onClick={() => setViewMode('split')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'split' ? 'bg-white dark:bg-white/20 shadow-sm' : 'hover:bg-white/60 dark:hover:bg-white/10'}`}
              title="Split view"
            >
              <Columns size={14} />
            </button>
            <button
              onClick={() => setViewMode('unified')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'unified' ? 'bg-white dark:bg-white/20 shadow-sm' : 'hover:bg-white/60 dark:hover:bg-white/10'}`}
              title="Unified view"
            >
              <AlignJustify size={14} />
            </button>
          </div>

          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-auto">
          {diff.isBinary ? (
            <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
              Binary file, cannot display diff
            </div>
          ) : diff.hunks.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
              No changes
            </div>
          ) : diff.truncated ? (
            <div className="p-4">
              <div className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-lg p-3 text-sm mb-4">
                Diff exceeds 10,000 lines. Showing truncated result.
              </div>
              {viewMode === 'split'
                ? <SplitView diff={diff} highlight={highlight} changeBlocks={changeBlocks} />
                : <UnifiedView diff={diff} highlight={highlight} changeBlocks={changeBlocks} />
              }
            </div>
          ) : (
            viewMode === 'split'
              ? <SplitView diff={diff} highlight={highlight} changeBlocks={changeBlocks} />
              : <UnifiedView diff={diff} highlight={highlight} changeBlocks={changeBlocks} />
          )}
        </div>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState, useRef, useCallback, useMemo, type ChangeEvent, type KeyboardEvent, type UIEvent } from 'react';
import { AnimatePresence } from 'framer-motion';
import { MotionDiv, MotionH3, MotionP, MotionButton } from '@/lib/motion';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Code, Monitor, Smartphone, Play, Square, RefreshCw, Settings, Folder, FolderOpen,
  File as FileIcon, FileCode, Palette, Braces, Atom, Workflow, Ship, GitBranch, FileText,
  Database, Coffee, Triangle, Lock, Home, ChevronUp, ChevronRight, ChevronDown,
  ArrowLeft, ArrowRight, RotateCcw, Share2, Type, Bird, Gem, Flame, List, Plus,
  HelpCircle, Grid, Maximize2, User, QrCode, X as XIcon,
  FilePlus, FolderPlus, Upload
} from 'lucide-react';
import { Terminal } from 'lucide-react';
import ChatLog from '@/components/chat/ChatLog';
import PermissionConfirmCard from '@/components/chat/PermissionConfirmCard';
import { GeneralSettings } from '@/components/settings/GeneralSettings';
import { EnvironmentSettings } from '@/components/settings/EnvironmentSettings';
import GlobalSettings from '@/components/settings/GlobalSettings';
import { QRCodeSVG } from 'qrcode.react';
import ChatInput from '@/components/chat/ChatInput';
import TodoBar from '@/components/chat/TodoBar';
import { ChatErrorBoundary } from '@/components/ErrorBoundary';
import AppSidebar from '@/components/layout/AppSidebar';
import AnimatedBackground from '@/components/layout/AnimatedBackground';
import { useGlobalSettings } from '@/contexts/GlobalSettingsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSlimMode } from '@/hooks/useSlimMode';
import AliyunDeployPage from '@/components/deploy/AliyunDeployPage';
import LocalDeployPage from '@/components/deploy/LocalDeployPage';
import PreviewTabs from '@/components/preview/PreviewTabs';
import FileGridView, { fileOp, uploadFiles, ContextMenu, ConfirmDialog, PromptDialog, type FileItem } from '@/components/files/FileGridView';
import DiffViewer from '@/components/files/DiffViewer';
import SourceControlPanel from '@/components/files/SourceControlPanel';
import type { GitStatusResult, FileDiffResult } from '@/types/shared/git';
import WordPreview from '@/components/preview/WordPreview';
import ExcelPreview from '@/components/preview/ExcelPreview';
import PPTPreview from '@/components/preview/PPTPreview';
import EmployeeStatusPanel from '@/components/boss/EmployeeStatusPanel';
import ReactMarkdown from 'react-markdown';

// Dynamically import TerminalEmulator with SSR disabled (xterm.js requires browser APIs)
const TerminalEmulator = dynamic(
  () => import('@/components/terminal/TerminalEmulator'),
  { ssr: false }
);
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { WordIcon, ExcelIcon, PowerPointIcon, PdfIcon } from '@/components/icons/FileTypeIcons';
import {
  JsIcon, TsIcon, TsxIcon, JsxIcon, CssIcon, HtmlIcon, JsonIcon, PyIcon, ShIcon,
  SqlIcon, YamlIcon, XmlIcon, PhpIcon, JavaIcon, CIcon, CppIcon, RustIcon, GoIcon,
  RubyIcon, VueIcon, SvelteIcon, ScssIcon, TomlIcon, MdIcon, TxtIcon,
  PngIcon, JpgIcon, SvgFileIcon, GifIcon, WebpIcon, Mp4Icon, VideoFileIcon, AudioFileIcon,
  ZipIcon, GenericFileIcon
} from '@/components/icons/FileTypeIcons';
import { getDefaultModelForCli, getModelDisplayName } from '@/lib/constants/cliModels';
import {
  ACTIVE_CLI_BRAND_COLORS,
  ACTIVE_CLI_IDS,
  ACTIVE_CLI_MODEL_OPTIONS,
  ACTIVE_CLI_NAME_MAP,
  DEFAULT_ACTIVE_CLI,
  buildActiveModelOptions,
  normalizeModelForCli,
  sanitizeActiveCli,
  type ActiveCliId,
  type ActiveModelOption,
} from '@/lib/utils/cliOptions';

// No longer loading ProjectSettings (managed by global settings on main page)

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

let focusInputRefGlobal: { fn: null | (() => void) } | undefined;
let inputControlRefGlobal: { control: null | { focus: () => void; setMessage: (msg: string) => void } } | undefined;

const assistantBrandColors = ACTIVE_CLI_BRAND_COLORS;

const CLI_LABELS = ACTIVE_CLI_NAME_MAP;

const CLI_ORDER = ACTIVE_CLI_IDS;

const sanitizeCli = (cli?: string | null) => sanitizeActiveCli(cli, DEFAULT_ACTIVE_CLI);

const sanitizeModel = (cli: string, model?: string | null) => normalizeModelForCli(cli, model, DEFAULT_ACTIVE_CLI);

// Function to convert hex to CSS filter for tinting white images
// Since the original image is white (#FFFFFF), we can apply filters more accurately
const hexToFilter = (hex: string): string => {
  // For white source images, we need to invert and adjust
  const filters: { [key: string]: string } = {
    '#DE7356': 'brightness(0) saturate(100%) invert(52%) sepia(73%) saturate(562%) hue-rotate(336deg) brightness(95%) contrast(91%)',
    '#000000': 'brightness(0) saturate(100%)',
    '#11A97D': 'brightness(0) saturate(100%) invert(57%) sepia(30%) saturate(747%) hue-rotate(109deg) brightness(90%) contrast(92%)',
    '#1677FF': 'brightness(0) saturate(100%) invert(40%) sepia(86%) saturate(1806%) hue-rotate(201deg) brightness(98%) contrast(98%)',
  };
  return filters[hex] || filters['#DE7356'];
};

type Entry = { path: string; type: 'file'|'dir'; size?: number };
type ProjectStatus = 'initializing' | 'active' | 'failed';
type FilePreviewType = 'image' | 'video' | 'pdf' | 'word' | 'excel' | 'ppt' | 'markdown' | 'code';

// Office Document Preview Component
function OfficeDocumentPreview({ projectId, filePath, type, onToolbarChange }: { projectId: string; filePath: string; type: 'word' | 'excel' | 'ppt'; onToolbarChange?: (toolbar: { onSave?: () => void; onEdit?: () => void; onCancelEdit?: () => void; onDownload?: () => void; hasChanges?: boolean; saving?: boolean; isEditing?: boolean } | null) => void }) {
  console.log('[OfficeDocumentPreview] 组件渲染', { projectId, filePath, type });
  const [fileObj, setFileObj] = useState<File | null>(null);
  const [error, setError] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

  useEffect(() => {
    console.log('[OfficeDocumentPreview] useEffect 触发', { filePath, type });
    // Reset file when switching to prevent stale file being rendered with wrong preview type
    setFileObj(null);
    const loadFile = async () => {
      try {
        setError('');
        console.log('[OfficeDocumentPreview] 开始加载文件:', filePath);
        const response = await fetch(`${API_BASE}/api/repo/${projectId}/file?path=${encodeURIComponent(filePath)}&raw=true`, {
          cache: 'no-store',
        });
        console.log('[OfficeDocumentPreview] API 响应:', { ok: response.ok, status: response.status });
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.statusText}`);
        }
        const blob = await response.blob();
        console.log('[OfficeDocumentPreview] Blob 大小:', blob.size);
        const fileName = filePath.split('/').pop() || (type === 'word' ? 'document.docx' : type === 'excel' ? 'spreadsheet.xlsx' : 'presentation.pptx');
        const mimeType = type === 'word' 
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : type === 'excel' 
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        const file = new File([blob], fileName, { type: mimeType });
        console.log('[OfficeDocumentPreview] File 对象创建成功:', { name: file.name, size: file.size, type: file.type });
        setFileObj(file);
      } catch (err) {
        console.error(`[OfficeDocumentPreview] 加载 ${type} 文件失败:`, err);
        setError(err instanceof Error ? err.message : '文件加载失败');
      }
    };
    loadFile();
  }, [projectId, filePath, type, API_BASE]);

  const handleSave = async (file: File) => {
    console.log('[handleSave] 开始保存', { fileName: file.name, fileSize: file.size });
    setSaveStatus('saving');
    try {
      // 读取文件为 ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      console.log('[handleSave] ArrayBuffer 长度:', arrayBuffer.byteLength);
      
      // 转换为 Base64
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );
      console.log('[handleSave] Base64 长度:', base64.length);

      // 使用 PUT 请求保存二进制文件
      console.log('[handleSave] 发送 PUT 请求:', {
        url: `${API_BASE}/api/repo/${projectId}/file`,
        path: filePath,
        contentLength: base64.length,
        encoding: 'base64',
      });
      
      const response = await fetch(`${API_BASE}/api/repo/${projectId}/file`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: filePath,
          content: base64,
          encoding: 'base64',
        }),
      });

      console.log('[handleSave] fetch 完成');
      console.log('[handleSave] API 响应:', { status: response.status, ok: response.ok, statusText: response.statusText });
      
      if (!response.ok) {
        console.error('[handleSave] 响应不成功, status:', response.status);
        const errorData = await response.json().catch(() => null);
        console.error('[handleSave] API 错误:', errorData);
        throw new Error('保存失败');
      }

      console.log('[handleSave] 开始解析 JSON...');
      const result = await response.json();
      console.log('[handleSave] 保存成功:', result);
      
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('[handleSave] 保存失败:', err);
      setSaveStatus('error');
      setError(err instanceof Error ? err.message : '保存失败');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  console.log('[OfficeDocumentPreview] 开始渲染 return', { type, hasFileObj: !!fileObj, fileObjSize: fileObj?.size });

  if (error && !fileObj) {
    console.log('[OfficeDocumentPreview] 渲染错误状态');
    return (
      <div className="w-full h-full flex items-center justify-center bg-white/10 dark:bg-black/10">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  if (!fileObj) {
    console.log('[OfficeDocumentPreview] 渲染加载中状态');
    return (
      <div className="w-full h-full flex items-center justify-center bg-white/10 dark:bg-black/10">
        <div className="text-slate-500 dark:text-slate-400">加载中...</div>
      </div>
    );
  }

  console.log('[OfficeDocumentPreview] 渲染预览组件', { type });
  return (
    <div className="w-full h-full relative">
      {type === 'word' ? (
        <WordPreview file={fileObj} onSave={handleSave} editable={true} onToolbarChange={onToolbarChange} />
      ) : type === 'excel' ? (
        <ExcelPreview file={fileObj} onSave={handleSave} editable={true} onToolbarChange={onToolbarChange} />
      ) : (
        <PPTPreview file={fileObj} onToolbarChange={onToolbarChange} />
      )}
      
      {/* 保存状态提示 */}
      {saveStatus === 'success' && (
        <div className="absolute top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow-lg text-sm z-50">
          ✓ 保存成功
        </div>
      )}
      {saveStatus === 'error' && (
        <div className="absolute top-4 right-4 bg-red-500 text-white px-4 py-2 rounded shadow-lg text-sm z-50">
          ✗ 保存失败
        </div>
      )}
    </div>
  );
}

// Browser-compatible UUID generator (fallback for non-HTTPS or older browsers)
const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

interface PendingPermission {
  id: string;
  projectId: string;
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  inputPreview: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

// Detect file preview type based on extension
const getFilePreviewType = (path: string): FilePreviewType => {
  const ext = path.split('.').pop()?.toLowerCase() || '';

  // Image files
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
    return 'image';
  }

  // Video files
  if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext)) {
    return 'video';
  }

  // PDF files
  if (ext === 'pdf') {
    return 'pdf';
  }

  // Office documents
  if (['doc', 'docx'].includes(ext)) {
    return 'word';
  }
  if (['xls', 'xlsx'].includes(ext)) {
    return 'excel';
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return 'ppt';
  }

  // Markdown files
  if (['md', 'markdown', 'mdx'].includes(ext)) {
    return 'markdown';
  }

  // Default to code editor
  return 'code';
};

type CliStatusSnapshot = {
  available?: boolean;
  configured?: boolean;
  models?: string[];
};

type ModelOption = Omit<ActiveModelOption, 'cli'> & { cli: string };

const buildModelOptions = (statuses: Record<string, CliStatusSnapshot>): ModelOption[] =>
  buildActiveModelOptions(statuses).map(option => ({
    ...option,
    cli: option.cli,
  }));

// Truncate filename: max 25 chars for English, 12 chars for Chinese
const truncateFileName = (name: string): string => {
  if (!name) return '';

  const chineseCharCount = (name.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherCharCount = name.length - chineseCharCount;

  // Weight: Chinese char = 2, other char = 1
  const totalWeight = chineseCharCount * 2 + otherCharCount;
  const maxWeight = 25; // ~12 Chinese chars or 25 English chars

  if (totalWeight <= maxWeight) {
    return name;
  }

  // Truncate and add ellipsis
  let truncated = '';
  let currentWeight = 0;

  for (const char of name) {
    const isChinese = /[\u4e00-\u9fa5]/.test(char);
    const charWeight = isChinese ? 2 : 1;

    if (currentWeight + charWeight > maxWeight - 3) { // Reserve space for "..."
      break;
    }

    truncated += char;
    currentWeight += charWeight;
  }

  return truncated + '...';
};

// Git status color helpers for TreeView
const TREE_GIT_COLORS: Record<string, string> = {
  'M': 'text-yellow-600 dark:text-yellow-400',
  'MM': 'text-orange-500 dark:text-orange-400',
  'A': 'text-green-600 dark:text-green-400',
  'AM': 'text-orange-500 dark:text-orange-400',
  'D': 'text-red-500 dark:text-red-400',
  '?': 'text-green-600 dark:text-green-400',
  'R': 'text-blue-500 dark:text-blue-400',
};

const TREE_GIT_LABELS: Record<string, string> = {
  'M': 'M', 'MM': 'M', 'A': 'A', 'AM': 'A', 'D': 'D', '?': 'U', 'R': 'R',
};

// TreeView component for VSCode-style file explorer
interface TreeViewProps {
  entries: Entry[];
  selectedFile: string;
  expandedFolders: Set<string>;
  folderContents: Map<string, Entry[]>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  onLoadFolder: (path: string) => Promise<void>;
  level: number;
  parentPath?: string;
  getFileIcon: (entry: Entry) => React.ReactElement;
  onContextMenu?: (e: React.MouseEvent, entry: Entry) => void;
  renamingPath?: string | null;
  onRenameConfirm?: (entry: Entry, newName: string) => void;
  onRenameCancel?: () => void;
  gitInfo?: GitStatusResult;
}

function TreeView({ entries, selectedFile, expandedFolders, folderContents, onToggleFolder, onSelectFile, onLoadFolder, level, parentPath = '', getFileIcon, onContextMenu, renamingPath, onRenameConfirm, onRenameCancel, gitInfo }: TreeViewProps) {
  // Ensure entries is an array
  if (!entries || !Array.isArray(entries)) {
    return null;
  }
  
  // Group entries by directory
  const sortedEntries = [...entries].sort((a, b) => {
    // Directories first
    if (a.type === 'dir' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'dir') return 1;
    // Then alphabetical
    return a.path.localeCompare(b.path);
  });

  return (
    <>
      {sortedEntries.map((entry, index) => {
        // entry.path should already be the full path from API
        const fullPath = entry.path;
        let entryKey =
          fullPath && typeof fullPath === 'string' && fullPath.trim().length > 0
            ? fullPath.trim()
            : (entry as any)?.name && typeof (entry as any).name === 'string' && (entry as any).name.trim().length > 0
            ? `${parentPath || 'root'}::__named_${(entry as any).name.trim()}`
            : '';
        if (!entryKey || entryKey.trim().length === 0) {
          entryKey = `${parentPath || 'root'}::__entry_${level}_${index}_${entry.type}`;
        }
        const isExpanded = expandedFolders.has(fullPath);
        const indent = level * 8;
        
        return (
          <div key={entryKey}>
            <div
              className={`group flex items-center h-[22px] px-2 cursor-pointer ${
                selectedFile === fullPath 
                  ? 'bg-primary-subtle' 
                  : 'hover:bg-white/15 dark:hover:bg-white/5 '
              }`}
              style={{ paddingLeft: `${8 + indent}px` }}
              onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, entry); } }}
              onClick={async () => {
                if (entry.type === 'dir') {
                  // Load folder contents if not already loaded
                  if (!folderContents.has(fullPath)) {
                    await onLoadFolder(fullPath);
                  }
                  onToggleFolder(fullPath);
                } else {
                  onSelectFile(fullPath);
                }
              }}
            >
              {/* Chevron for folders */}
              <div className="w-4 flex items-center justify-center mr-0.5">
                {entry.type === 'dir' && (
                  isExpanded ? 
                    <span className="w-2.5 h-2.5 text-slate-600 dark:text-slate-400 flex items-center justify-center"><ChevronDown size={10} /></span> : 
                    <span className="w-2.5 h-2.5 text-slate-600 dark:text-slate-400 flex items-center justify-center"><ChevronRight size={10} /></span>
                )}
              </div>
              
              {/* Icon */}
              <span className="w-4 h-4 flex items-center justify-center mr-1.5">
                {entry.type === 'dir' ? (
                  isExpanded ? 
                    <span className="text-amber-600 w-4 h-4 flex items-center justify-center"><FolderOpen size={16} /></span> : 
                    <span className="text-amber-600 w-4 h-4 flex items-center justify-center"><Folder size={16} /></span>
                ) : (
                  getFileIcon(entry)
                )}
              </span>
              
              {/* File/Folder name */}
              {renamingPath === fullPath ? (
                <input
                  autoFocus
                  defaultValue={entry.path.split('/').pop() || entry.path}
                  className="text-[13px] leading-[22px] bg-blue-50 dark:bg-blue-900/30 border border-blue-400 dark:border-blue-600 rounded px-1 outline-none min-w-0"
                  style={{ fontFamily: "'Segoe UI', Tahoma, sans-serif" }}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val && onRenameConfirm) onRenameConfirm(entry, val);
                    }
                    if (e.key === 'Escape') onRenameCancel?.();
                  }}
                  onBlur={e => {
                    const val = e.target.value.trim();
                    const origName = entry.path.split('/').pop() || entry.path;
                    if (val && val !== origName && onRenameConfirm) onRenameConfirm(entry, val);
                    else onRenameCancel?.();
                  }}
                />
              ) : (() => {
                // Compute git status for this entry
                const gitFile = entry.type === 'file' ? gitInfo?.files?.find(f => f.path === fullPath) : undefined;
                const dirPrefix = entry.type === 'dir' ? (fullPath.endsWith('/') ? fullPath : fullPath + '/') : '';
                const dirHasChanges = entry.type === 'dir' && gitInfo?.files?.some(f => f.path.startsWith(dirPrefix));
                const gitStatus = gitFile?.status;
                const gitColor = gitStatus ? TREE_GIT_COLORS[gitStatus] : (dirHasChanges ? 'text-yellow-600 dark:text-yellow-400' : '');
                const nameColor = selectedFile === fullPath ? 'text-blue-600 dark:text-blue-400' : (gitColor || 'text-slate-700 dark:text-slate-300');
                return (
                  <>
                    <span className={`text-[13px] leading-[22px] truncate flex-1 min-w-0 ${nameColor}`} style={{ fontFamily: "'Segoe UI', Tahoma, sans-serif" }} title={entry.path.split('/').pop() || entry.path}>
                      {truncateFileName(entry.path.split('/').pop() || entry.path)}
                    </span>
                    {gitStatus && TREE_GIT_LABELS[gitStatus] && (
                      <span className={`ml-auto text-[10px] font-medium flex-shrink-0 ${gitColor}`}>
                        {TREE_GIT_LABELS[gitStatus]}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
            
            {/* Render children if expanded */}
            {entry.type === 'dir' && isExpanded && folderContents.has(fullPath) && (
              <TreeView
                entries={folderContents.get(fullPath) || []}
                selectedFile={selectedFile}
                expandedFolders={expandedFolders}
                folderContents={folderContents}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
                onLoadFolder={onLoadFolder}
                level={level + 1}
                parentPath={fullPath}
                getFileIcon={getFileIcon}
                onContextMenu={onContextMenu}
                renamingPath={renamingPath}
                onRenameConfirm={onRenameConfirm}
                onRenameCancel={onRenameCancel}
                gitInfo={gitInfo}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export default function ChatPage() {
  const params = useParams<{ project_id: string }>();
  const projectId = params?.project_id ?? '';
  const router = useRouter();
  const searchParams = useSearchParams();
  // Derive skill name from projectId (skill projects use "skill-{name}" format)
  const skillNameFromProject = projectId.startsWith('skill-') ? projectId.slice(6) : null;
  const [projectName, setProjectName] = useState<string>('');
  const [projectDescription, setProjectDescription] = useState<string>('');
  const [employeeName, setEmployeeName] = useState<string>('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleCustomizedRef = useRef(false);  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [previewInstanceId, setPreviewInstanceId] = useState<number | null>(null);
  const lastPreviewInstanceIdRef = useRef<number | null>(null);
  const [backendPreviewPhase, setBackendPreviewPhase] = useState<string>('stopped');
  const previewOrigin = useMemo(() => {
    if (!previewUrl) return '';
    try {
      const base = previewUrl.split('?')[0];
      return new URL(base).origin;
    } catch {
      return '';
    }
  }, [previewUrl]);
  const [tree, setTree] = useState<Entry[]>([]);
    const [gitInfo, setGitInfo] = useState<GitStatusResult | undefined>(undefined);
const [gitBranches, setGitBranches] = useState<string[]>([]);
    const [diffViewState, setDiffViewState] = useState<{ filePath: string; diff: FileDiffResult; from: string; to: string } | null>(null);
  const [content, setContent] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [mdPreviewMode, setMdPreviewMode] = useState<'source' | 'preview'>('preview');
  const [currentPath, setCurrentPath] = useState<string>('.');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['']));
  const [folderContents, setFolderContents] = useState<Map<string, Entry[]>>(new Map());
  const [prompt, setPrompt] = useState('');
  const [fileViewMode, setFileViewMode] = useState<'list' | 'grid'>('list');
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'scm'>('explorer');

  // Tree file operations state
  const [treeContextMenu, setTreeContextMenu] = useState<{ x: number; y: number; file: FileItem } | null>(null);
  const [treeDeleteTarget, setTreeDeleteTarget] = useState<FileItem | null>(null);
  const [treeRenamingPath, setTreeRenamingPath] = useState<string | null>(null);
  const [treePromptDialog, setTreePromptDialog] = useState<{ title: string; defaultValue?: string; onConfirm: (v: string) => void } | null>(null);

  // Ref to store add/remove message handlers from ChatLog
  const messageHandlersRef = useRef<{
    add: (message: any) => void;
    remove: (messageId: string) => void;
  } | null>(null);

  // Ref to store current requestId
  const currentRequestIdRef = useRef<string | null>(null);

  // Ref to track pending requests for deduplication
  const pendingRequestsRef = useRef<Set<string>>(new Set());

  // Stable message handlers to prevent reassignment issues
  const stableMessageHandlers = useRef<{
    add: (message: any) => void;
    remove: (messageId: string) => void;
  } | null>(null);

  // Track active optimistic messages by requestId
  const optimisticMessagesRef = useRef<Map<string, any>>(new Map());
  const [mode, setMode] = useState<'act' | 'chat'>('act');
  const [isRunning, setIsRunning] = useState(false);
  const [isSseFallbackActive, setIsSseFallbackActive] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [showConsole, setShowConsole] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [showEmployeeStatus, setShowEmployeeStatus] = useState(false);
  const [timelineContent, setTimelineContent] = useState<string>('');
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [isTimelineSseConnected, setIsTimelineSseConnected] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const timelineEventSourceRef = useRef<EventSource | null>(null);

  // Global slim mode - just for reading state, window resize is handled by hook
  useSlimMode();

  // Preview mode: fullscreen, normal, mobile (layout auto-adapts via CSS for slim windows)
  const [previewMode, setPreviewMode] = useState<'mobile' | 'normal' | 'fullscreen'>('normal');

  // Handle preview mode change
  const handlePreviewModeChange = (newMode: 'mobile' | 'normal' | 'fullscreen') => {
    setPreviewMode(newMode);
  };

  const [uploadedImages, setUploadedImages] = useState<{name: string; url: string; base64?: string; path?: string}[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  // Initialize states with default values, will be loaded from localStorage in useEffect
  const [hasInitialPrompt, setHasInitialPrompt] = useState<boolean>(false);
  const [agentWorkComplete, setAgentWorkComplete] = useState<boolean>(false);
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>('initializing');
  const [projectMode, setProjectMode] = useState<'code' | 'work' | 'boss' | 'cli'>('code'); // 项目模式
  const [workDirectory, setWorkDirectory] = useState<string>(''); // work 模式的工作目录
  const [projectPath, setProjectPath] = useState<string>(''); // 项目绝对路径
  const [initializationMessage, setInitializationMessage] = useState('Starting project initialization...');
  const [initialPromptSent, setInitialPromptSent] = useState(false);
  const initialPromptSentRef = useRef(false);
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const [deployChannel, setDeployChannel] = useState<'aliyun' | 'vercel'>('aliyun');
  const [publishLoading, setPublishLoading] = useState(false);
  const [settingsActiveTab, setSettingsActiveTab] = useState<'general' | 'environment'>('general');
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  const [vercelConnected, setVercelConnected] = useState<boolean | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [deploymentStatus, setDeploymentStatus] = useState<'idle' | 'deploying' | 'ready' | 'error'>('idle');
  const deployPollRef = useRef<NodeJS.Timeout | null>(null);
  const [showAliyunDeploy, setShowAliyunDeploy] = useState(false);
  const [showLocalDeploy, setShowLocalDeploy] = useState(false);
  // 从 URL 参数初始化 isDemo，避免时序问题
  const [isDemo, setIsDemo] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('demoReplay') === 'true';
  });
  const [demoDeployedUrl, setDemoDeployedUrl] = useState<string | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    const params = new URLSearchParams(window.location.search);
    return params.get('deployedUrl') || undefined;
  });
  const [isStartingPreview, setIsStartingPreview] = useState(false);
  const [previewInitializationMessage, setPreviewInitializationMessage] = useState('Starting development server...');
  const [isStopping, setIsStopping] = useState(false);
  const [cliStatuses, setCliStatuses] = useState<Record<string, CliStatusSnapshot>>({});
  const [conversationId, setConversationId] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    return '';
  });

  const [preferredCli, setPreferredCli] = useState<ActiveCliId>(DEFAULT_ACTIVE_CLI);
  const [selectedModel, setSelectedModel] = useState<string>(getDefaultModelForCli(DEFAULT_ACTIVE_CLI));
  const [permissionMode, setPermissionMode] = useState<'default' | 'acceptEdits' | 'bypassPermissions'>('default');
  const [usingGlobalDefaults, setUsingGlobalDefaults] = useState<boolean>(true);
  const [thinkingMode, setThinkingMode] = useState<boolean>(false);
  const [isUpdatingModel, setIsUpdatingModel] = useState<boolean>(false);
  const [currentRoute, setCurrentRoute] = useState<string>('/');
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Plan/Todo 标签状态
  const [activePreviewTab, setActivePreviewTab] = useState<'none' | 'activity' | 'todo'>('none');
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [currentTodos, setCurrentTodos] = useState<Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }>>([]);
  const [fileChanges, setFileChanges] = useState<Array<{ type: 'write' | 'edit'; filePath: string; content?: string; oldString?: string; newString?: string; timestamp: string }>>([]);
  const [pendingPlanApproval, setPendingPlanApproval] = useState<{ requestId: string } | null>(null);
  const [mobileViewMode, setMobileViewMode] = useState<'chat' | 'preview'>('chat');
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  // CLI mode: terminal session and display state
  const [cliSessionId, setCliSessionId] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [lanIP, setLanIP] = useState<string | null>(null);
  const [showQRCode, setShowQRCode] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([]);
  const approvedRequestIdsRef = useRef<Set<string>>(new Set());
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);
  const editedContentRef = useRef<string>('');
  const fileTreeContainerRef = useRef<HTMLDivElement>(null);
  const treeUploadRef = useRef<HTMLInputElement>(null);
  const treeUploadDirRef = useRef<string>('.');
  const [isFileUpdating, setIsFileUpdating] = useState(false);
  // Office document toolbar state — actions exposed by Word/Excel/PPT preview components
  const [officeToolbar, setOfficeToolbar] = useState<{
    onSave?: () => void;
    onEdit?: () => void;
    onCancelEdit?: () => void;
    onDownload?: () => void;
    hasChanges?: boolean;
    saving?: boolean;
    isEditing?: boolean;
  } | null>(null);
  const modelOptions = useMemo(() => buildModelOptions(cliStatuses), [cliStatuses]);
  const cliOptions = useMemo(
    () => CLI_ORDER.map(cli => ({
      id: cli,
      name: CLI_LABELS[cli] || cli,
      available: Boolean(cliStatuses[cli]?.available && cliStatuses[cli]?.configured)
    })),
    [cliStatuses]
  );

  const updatePreferredCli = useCallback((cli: string) => {
    const sanitized = sanitizeCli(cli);
    setPreferredCli(sanitized);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('selectedAssistant', sanitized);
    }
  }, []);

  const updateSelectedModel = useCallback((model: string, cliOverride?: string) => {
    const effectiveCli = cliOverride ? sanitizeCli(cliOverride) : preferredCli;
    const sanitized = sanitizeModel(effectiveCli, model);
    setSelectedModel(sanitized);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('selectedModel', sanitized);
    }
  }, [preferredCli]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  // Unified handler for preview ready events (idempotent by instanceId)
  const handlePreviewReady = useCallback((url: string | null, instanceId?: number) => {
    // Idempotent check: skip if same instanceId
    if (instanceId !== undefined && instanceId === lastPreviewInstanceIdRef.current) {
      return;
    }
    if (instanceId !== undefined) {
      lastPreviewInstanceIdRef.current = instanceId;
      setPreviewInstanceId(instanceId);
    }
    setPreviewUrl(url);
    if (url) {
      setCurrentRoute('/');
      setPreviewError(null);
    }
  }, []);

  const sendInitialPrompt = useCallback(async (initialPrompt: string) => {
    if (initialPromptSent) {
      return;
    }

    setAgentWorkComplete(false);
    localStorage.setItem(`project_${projectId}_taskComplete`, 'false');

    const requestId = generateUUID();

    try {
      try { console.log(`已发送初始提示，请求ID=${requestId}`); } catch {}
      setInitialPromptSent(true);

      const requestBody = {
        instruction: initialPrompt,
        images: [],
        isInitialPrompt: true,
        cliPreference: preferredCli,
        conversationId: conversationId || undefined,
        requestId,
        selectedModel,
      };

      const r = await fetch(`${API_BASE}/api/chat/${projectId}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!r.ok) {
        const errorText = await r.text();
        console.error('❌ API Error:', errorText);
        setInitialPromptSent(false);
        return;
      }

      const result = await r.json();

      const returnedConversationId =
        typeof result?.conversationId === 'string'
          ? result.conversationId
          : typeof result?.conversation_id === 'string'
          ? result.conversation_id
          : undefined;
      if (returnedConversationId) {
        setConversationId(returnedConversationId);
      }

      const resolvedRequestId =
        typeof result?.requestId === 'string'
          ? result.requestId
          : typeof result?.request_id === 'string'
          ? result.request_id
          : requestId;
      const userMessageId =
        typeof result?.userMessageId === 'string'
          ? result.userMessageId
          : typeof result?.user_message_id === 'string'
          ? result.user_message_id
          : '';

      setPrompt('');

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('initial_prompt');
      window.history.replaceState({}, '', newUrl.toString());
    } catch (error) {
      console.error('Error sending initial prompt:', error);
      setInitialPromptSent(false);
    } finally {
    }
  }, [initialPromptSent, preferredCli, conversationId, projectId, selectedModel]);

  // Guarded trigger that can be called from multiple places safely
  const triggerInitialPromptIfNeeded = useCallback(() => {
    const initialPromptFromUrl = searchParams?.get('initial_prompt');
    if (!initialPromptFromUrl) return;
    if (initialPromptSentRef.current) return;
    // Synchronously guard to prevent double ACT calls
    initialPromptSentRef.current = true;
    setInitialPromptSent(true);
    
    // Store the selected model and assistant in sessionStorage when returning
    const cliFromUrl = searchParams?.get('cli');
    const modelFromUrl = searchParams?.get('model');
    if (cliFromUrl) {
      const sanitizedCli = sanitizeCli(cliFromUrl);
      sessionStorage.setItem('selectedAssistant', sanitizedCli);
      if (modelFromUrl) {
        sessionStorage.setItem('selectedModel', sanitizeModel(sanitizedCli, modelFromUrl));
      }
    } else if (modelFromUrl) {
      sessionStorage.setItem('selectedModel', sanitizeModel(preferredCli, modelFromUrl));
    }
    
    // Don't show the initial prompt in the input field
    // setPrompt(initialPromptFromUrl);
    sendInitialPrompt(initialPromptFromUrl);
  }, [searchParams, sendInitialPrompt, preferredCli]);

const loadCliStatuses = useCallback(() => {
  const snapshot: Record<string, CliStatusSnapshot> = {};
  ACTIVE_CLI_IDS.forEach(id => {
    const models = ACTIVE_CLI_MODEL_OPTIONS[id]?.map(model => model.id) ?? [];
    snapshot[id] = {
      available: true,
      configured: true,
      models,
    };
  });
  setCliStatuses(snapshot);
}, []);

const persistProjectPreferences = useCallback(
  async (changes: { preferredCli?: string; selectedModel?: string; permissionMode?: string }) => {
    if (!projectId) return;
    const payload: Record<string, unknown> = {};
    if (changes.preferredCli) {
      const sanitizedPreferredCli = sanitizeCli(changes.preferredCli);
      payload.preferredCli = sanitizedPreferredCli;
      payload.preferred_cli = sanitizedPreferredCli;
    }
    if (changes.selectedModel) {
      const targetCli = sanitizeCli(changes.preferredCli ?? preferredCli);
      const normalized = sanitizeModel(targetCli, changes.selectedModel);
      payload.selectedModel = normalized;
      payload.selected_model = normalized;
    }
    if (changes.permissionMode) {
      payload.permissionMode = changes.permissionMode;
    }
    if (Object.keys(payload).length === 0) return;

    const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Failed to update project preferences');
    }

    const result = await response.json().catch(() => null);
    return result?.data ?? result;
  },
  [projectId, preferredCli]
);

  // Handle permission mode change
  const handlePermissionModeChange = useCallback(
    async (mode: 'default' | 'acceptEdits' | 'bypassPermissions') => {
      if (!projectId) return;
      const previousMode = permissionMode;
      setPermissionMode(mode);
      try {
        await persistProjectPreferences({ permissionMode: mode });
        console.log(`[Chat] Permission mode changed to: ${mode}`);
      } catch (error) {
        console.error('[Chat] Failed to persist permission mode:', error);
        setPermissionMode(previousMode);
      }
    },
    [projectId, permissionMode, persistProjectPreferences]
  );

  const handleModelChange = useCallback(
    async (option: ModelOption, opts?: { skipCliUpdate?: boolean; overrideCli?: string }) => {
      if (!projectId || !option) return;

      const { skipCliUpdate = false, overrideCli } = opts || {};
      const targetCli = sanitizeCli(overrideCli ?? option.cli);
      const sanitizedModelId = sanitizeModel(targetCli, option.id);

      const previousCli = preferredCli;
      const previousModel = selectedModel;

      if (targetCli === previousCli && sanitizedModelId === previousModel) {
        return;
      }

      setUsingGlobalDefaults(false);
      updatePreferredCli(targetCli);
      updateSelectedModel(option.id, targetCli);

      setIsUpdatingModel(true);

      try {
        const preferenceChanges: { preferredCli?: string; selectedModel?: string } = {
          selectedModel: sanitizedModelId,
        };
        if (!skipCliUpdate && targetCli !== previousCli) {
          preferenceChanges.preferredCli = targetCli;
        }

        await persistProjectPreferences(preferenceChanges);

        const cliLabel = CLI_LABELS[targetCli] || targetCli;
        const modelLabel = getModelDisplayName(targetCli, sanitizedModelId);
        try {
          await fetch(`${API_BASE}/api/chat/${projectId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: `Switched to ${cliLabel} (${modelLabel})`,
              role: 'system',
              message_type: 'info',
              cli_source: targetCli,
              conversation_id: conversationId || undefined,
            }),
          });
        } catch (messageError) {
          console.warn('Failed to record model switch message:', messageError);
        }

        loadCliStatuses();
      } catch (error) {
        console.error('Failed to update model preference:', error);
        updatePreferredCli(previousCli);
        updateSelectedModel(previousModel, previousCli);
        alert('Failed to update model. Please try again.');
      } finally {
        setIsUpdatingModel(false);
      }
    },
    [projectId, preferredCli, selectedModel, conversationId, loadCliStatuses, persistProjectPreferences, updatePreferredCli, updateSelectedModel]
  );

  useEffect(() => {
    loadCliStatuses();
  }, [loadCliStatuses]);

  const handleCliChange = useCallback(
    async (cliId: string) => {
      if (!projectId) return;
      if (cliId === preferredCli) return;

      setUsingGlobalDefaults(false);

      const candidateModels = modelOptions.filter(option => option.cli === cliId);
      const fallbackOption =
        candidateModels.find(option => option.id === selectedModel && option.available) ||
        candidateModels.find(option => option.available) ||
        candidateModels[0];

      if (fallbackOption) {
        await handleModelChange(fallbackOption, { overrideCli: cliId });
        return;
      }

      const previousCli = preferredCli;
      const previousModel = selectedModel;
      setIsUpdatingModel(true);

      try {
        updatePreferredCli(cliId);
        const defaultModel = getDefaultModelForCli(cliId);
        updateSelectedModel(defaultModel, cliId);
        await persistProjectPreferences({ preferredCli: cliId, selectedModel: defaultModel });
        loadCliStatuses();
      } catch (error) {
        console.error('Failed to update CLI preference:', error);
        updatePreferredCli(previousCli);
        updateSelectedModel(previousModel, previousCli);
        alert('Failed to update CLI. Please try again.');
      } finally {
        setIsUpdatingModel(false);
      }
    },
    [projectId, preferredCli, selectedModel, modelOptions, handleModelChange, loadCliStatuses, persistProjectPreferences, updatePreferredCli, updateSelectedModel]
  );

  // Handle work_directory change for work mode
  const handleWorkDirectoryChange = useCallback(
    async (newDirectory: string) => {
      if (!projectId || projectMode !== 'work') return;

      setWorkDirectory(newDirectory);

      try {
        const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ work_directory: newDirectory }),
        });

        if (!response.ok) {
          console.error('Failed to update work_directory');
        }
      } catch (error) {
        console.error('Failed to update work_directory:', error);
      }
    },
    [projectId, projectMode]
  );

  useEffect(() => {
    if (!modelOptions.length) return;
    const hasSelected = modelOptions.some(option => option.cli === preferredCli && option.id === selectedModel);
    if (!hasSelected) {
      const fallbackOption = modelOptions.find(option => option.cli === preferredCli && option.available)
        || modelOptions.find(option => option.cli === preferredCli)
        || modelOptions.find(option => option.available)
        || modelOptions[0];
      if (fallbackOption) {
        void handleModelChange(fallbackOption);
      }
    }
  }, [modelOptions, preferredCli, selectedModel, handleModelChange]);

  const loadDeployStatus = useCallback(async () => {
    try {
      // Use the same API as ServiceSettings to check actual project service connections
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/services`);
      if (response.status === 404) {
        setGithubConnected(false);
        setVercelConnected(false);
        setPublishedUrl(null);
        setDeploymentStatus('idle');
        return;
      }

      if (response.ok) {
        const connections = await response.json();
        const githubConnection = connections.find((conn: any) => conn.provider === 'github');
        const vercelConnection = connections.find((conn: any) => conn.provider === 'vercel');
        
        // Check actual project connections (not just token existence)
        setGithubConnected(!!githubConnection);
        setVercelConnected(!!vercelConnection);
        
        // Set published URL only if actually deployed
        if (vercelConnection && vercelConnection.service_data) {
          const sd = vercelConnection.service_data;
          // Only use actual deployment URLs, not predicted ones
          const rawUrl = sd.last_deployment_url || null;
          const url = rawUrl ? (String(rawUrl).startsWith('http') ? String(rawUrl) : `https://${rawUrl}`) : null;
          setPublishedUrl(url || null);
          if (url) {
            setDeploymentStatus('ready');
          } else {
            setDeploymentStatus('idle');
          }
        } else {
          setPublishedUrl(null);
          setDeploymentStatus('idle');
        }
      } else {
        setGithubConnected(false);
        setVercelConnected(false);
        setPublishedUrl(null);
        setDeploymentStatus('idle');
      }

    } catch (e) {
      console.warn('Failed to load deploy status', e);
      setGithubConnected(false);
      setVercelConnected(false);
      setPublishedUrl(null);
      setDeploymentStatus('idle');
    }
  }, [projectId]);

  const startDeploymentPolling = useCallback((depId: string) => {
    if (deployPollRef.current) clearInterval(deployPollRef.current);
    setDeploymentStatus('deploying');
    setDeploymentId(depId);
    
    console.log('🔍 Monitoring deployment:', depId);
    
    deployPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/projects/${projectId}/vercel/deployment/current`);
        if (r.status === 404) {
          setDeploymentStatus('idle');
          setDeploymentId(null);
          setPublishLoading(false);
          if (deployPollRef.current) {
            clearInterval(deployPollRef.current);
            deployPollRef.current = null;
          }
          return;
        }
        if (!r.ok) return;
        const data = await r.json();
        
        // Stop polling if no active deployment (completed)
        if (!data.has_deployment) {
          console.log('🔍 Deployment completed - no active deployment');

          // Set final deployment URL
          if (data.last_deployment_url) {
            const url = String(data.last_deployment_url).startsWith('http') ? data.last_deployment_url : `https://${data.last_deployment_url}`;
            console.log('🔍 Deployment complete! URL:', url);
            setPublishedUrl(url);
            setDeploymentStatus('ready');
          } else {
            setDeploymentStatus('idle');
          }
          
          // End publish loading state (important: release loading even if no deployment)
          setPublishLoading(false);
          
          if (deployPollRef.current) {
            clearInterval(deployPollRef.current);
            deployPollRef.current = null;
          }
          return;
        }
        
        // If there is an active deployment
        const status = data.status;
        
        // Log only status changes
        if (status && status !== 'QUEUED') {
          console.log('🔍 Deployment status:', status);
        }
        
        // Check if deployment is ready or failed
        const isReady = status === 'READY';
        const isBuilding = status === 'BUILDING' || status === 'QUEUED';
        const isError = status === 'ERROR';
        
        if (isError) {
          console.error('🔍 Deployment failed:', status);
          setDeploymentStatus('error');
          
          // End publish loading state
          setPublishLoading(false);
          
          // Close publish panel after error (with delay to show error message)
          setTimeout(() => {
            setShowPublishPanel(false);
          }, 3000); // Show error for 3 seconds before closing
          
          if (deployPollRef.current) {
            clearInterval(deployPollRef.current);
            deployPollRef.current = null;
          }
          return;
        }
        
        if (isReady && data.deployment_url) {
          const url = String(data.deployment_url).startsWith('http') ? data.deployment_url : `https://${data.deployment_url}`;
          console.log('🔍 Deployment complete! URL:', url);
          setPublishedUrl(url);
          setDeploymentStatus('ready');
          
          // End publish loading state
          setPublishLoading(false);
          
          // Keep panel open to show the published URL
          
          if (deployPollRef.current) {
            clearInterval(deployPollRef.current);
            deployPollRef.current = null;
          }
        } else if (isBuilding) {
          setDeploymentStatus('deploying');
        }
      } catch (error) {
        console.error('🔍 Polling error:', error);
      }
    }, 3000); // Poll every 3 seconds
  }, [projectId]);

  const checkCurrentDeployment = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/vercel/deployment/current`);
      if (response.status === 404) {
        return;
      }

      if (response.ok) {
        const data = await response.json();
        if (data.has_deployment) {
          setDeploymentId(data.deployment_id);
          setDeploymentStatus('deploying');
          setPublishLoading(false);
          setShowPublishPanel(true);
          startDeploymentPolling(data.deployment_id);
          console.log('🔍 Resuming deployment monitoring:', data.deployment_id);
        }
      }
    } catch (e) {
      console.warn('Failed to check current deployment', e);
    }
  }, [projectId, startDeploymentPolling]);

  const start = useCallback(async () => {
    try {
      setIsStartingPreview(true);
      setActivePreviewTab('none'); // 关闭 plan/todo 标签
      setPreviewError(null);
      setPreviewInitializationMessage('Starting preview...');
      try { await fetch(`${API_BASE}/api/projects/${projectId}/log/frontend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'trigger.preview.frontend', message: 'Frontend triggered preview start', level: 'info' }) }); } catch {}
      try { await fetch(`${API_BASE}/api/projects/${projectId}/log/frontend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'preview.start', message: 'Start preview', level: 'info' }) }); } catch {}

      const r = await fetch(`${API_BASE}/api/projects/${projectId}/preview/start`, { method: 'POST' });
      if (!r.ok) {
        console.error('Failed to start preview:', r.statusText);
        setPreviewInitializationMessage('Failed to start preview');
        setIsStartingPreview(false);
        try { await fetch(`${API_BASE}/api/projects/${projectId}/log/frontend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'preview.start.error', message: 'Failed to start preview', level: 'error' }) }); } catch {}
        return;
      }
      const payload = await r.json();
      const data = payload?.data ?? payload ?? {};

      setPreviewInitializationMessage('Preview ready');
      const url = typeof data.url === 'string' ? data.url : null;
      const instanceId = typeof data.instanceId === 'number' ? data.instanceId : undefined;
      handlePreviewReady(url, instanceId);
      // 不要在这里设置 setIsStartingPreview(false)，让 SSE 事件控制状态
      try { await fetch(`${API_BASE}/api/projects/${projectId}/log/frontend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'preview.ready', message: 'Preview ready', level: 'info', metadata: { url, instanceId } }) }); } catch {}
      // Health check moved to backend or skipped to avoid跨域
    } catch (error) {
      console.error('Error starting preview:', error);
      setPreviewInitializationMessage('An error occurred');
      setIsStartingPreview(false);
      try { await fetch(`${API_BASE}/api/projects/${projectId}/log/frontend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'preview.start.exception', message: String(error instanceof Error ? error.message : error), level: 'error' }) }); } catch {}
    }
  }, [projectId, handlePreviewReady]);

  // Navigate to specific route in iframe
  const navigateToRoute = (route: string) => {
    if (previewUrl && iframeRef.current) {
      const baseUrl = previewUrl.split('?')[0]; // Remove any query params
      // Ensure route starts with /
      const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
      const newUrl = `${baseUrl}${normalizedRoute}`;
      iframeRef.current.src = newUrl;
      setCurrentRoute(normalizedRoute);
      try { fetch(`${API_BASE}/api/projects/${projectId}/log/frontend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'preview.navigate', message: 'Navigate preview', level: 'info', metadata: { route: normalizedRoute, url: newUrl } }) }); } catch {}
    }
  };

  const refreshPreview = useCallback(() => {
    if (!previewUrl || !iframeRef.current) {
      return;
    }

    try {
      const normalizedRoute =
        currentRoute && currentRoute.startsWith('/')
          ? currentRoute
          : `/${currentRoute || ''}`;
      const baseUrl = previewUrl.split('?')[0] || previewUrl;
      const url = new URL(baseUrl + normalizedRoute);
      url.searchParams.set('_ts', Date.now().toString());
      iframeRef.current.src = url.toString();
    } catch (error) {
      console.warn('Failed to refresh preview iframe:', error);
    }
  }, [previewUrl, currentRoute]);


  const stop = useCallback(async () => {
    try {
      setIsStopping(true);
      await fetch(`${API_BASE}/api/projects/${projectId}/preview/stop`, { method: 'POST' });
      setPreviewUrl(null);
    } catch (error) {
      console.error('Error stopping preview:', error);
    } finally {
      setIsStopping(false);
    }
  }, [projectId]);

  // Load timeline.txt content
  const loadTimelineContent = useCallback(async () => {
    if (!projectId) return;

    setIsLoadingTimeline(true);
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/files/content?path=logs/timeline.txt`);
      const data = await response.json();

      if (data.success && data.data?.content) {
        setTimelineContent(data.data.content);
        // Auto-scroll to bottom
        setTimeout(() => {
          consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        setTimelineContent('');
      }
    } catch (error) {
      console.error('[Timeline] Failed to load timeline.txt:', error);
      setTimelineContent('Failed to load timeline logs');
    } finally {
      setIsLoadingTimeline(false);
    }
  }, [projectId]);

  // Timeline SSE connection - real-time log streaming
  useEffect(() => {
    if (!projectId) return;
    if (!showConsole) return;
    if (typeof window === 'undefined') return;
    if (!('EventSource' in window)) return;

    let eventSource: EventSource | null = null;
    let disposed = false;

    const connectTimelineStream = () => {
      if (disposed) return;

      try {
        const streamUrl = `${API_BASE}/api/projects/${projectId}/timeline/stream`;
        eventSource = new EventSource(streamUrl);
        timelineEventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setIsTimelineSseConnected(true);
        };

        eventSource.onmessage = (event) => {
          if (!event.data) return;

          try {
            const message = JSON.parse(event.data);

            if (message.type === 'content') {
              // Initial full content
              setTimelineContent(message.data || '');
              setTimeout(() => {
                consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }, 100);
            } else if (message.type === 'update') {
              // Incremental update - append to existing content
              setTimelineContent((prev) => prev + message.data);
              setTimeout(() => {
                consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }, 100);
            }
          } catch (error) {
            console.error('[Timeline SSE] Failed to parse message:', error);
          }
        };

        eventSource.onerror = () => {
          setIsTimelineSseConnected(false);
          if (disposed) return;

          eventSource?.close();
          // Auto-reconnect after 2 seconds
          setTimeout(() => {
            if (!disposed) {
              connectTimelineStream();
            }
          }, 2000);
        };
      } catch (error) {
        console.error('[Timeline SSE] Failed to establish connection:', error);
        setIsTimelineSseConnected(false);
      }
    };

    connectTimelineStream();

    return () => {
      disposed = true;
      setIsTimelineSseConnected(false);
      if (timelineEventSourceRef.current) {
        timelineEventSourceRef.current.close();
        timelineEventSourceRef.current = null;
      }
    };
  }, [projectId, showConsole]);

  const loadSubdirectory = useCallback(async (dir: string): Promise<Entry[]> => {
    try {
      const r = await fetch(`${API_BASE}/api/repo/${projectId}/tree?dir=${encodeURIComponent(dir)}`);
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Failed to load subdirectory:', error);
      return [];
    }
  }, [projectId]);

  const loadTree = useCallback(async (dir = '.') => {
    try {
      const r = await fetch(`${API_BASE}/api/repo/${projectId}/tree?dir=${encodeURIComponent(dir)}`);
      const data = await r.json();
      
      // Ensure data is an array
      if (Array.isArray(data)) {
        setTree(data);
        const newFolderContents = new Map();
        setFolderContents(newFolderContents);
      } else {
        console.error('Tree data is not an array:', data);
        setTree([]);
      }
      
      setCurrentPath(dir);
    } catch (error) {
      console.error('Failed to load tree:', error);
      setTree([]);
    }
    // Also load git status and branches in parallel
    try {
      const [statusRes, branchRes] = await Promise.all([
        fetch(`${API_BASE}/api/repo/${projectId}/git/status`),
        fetch(`${API_BASE}/api/repo/${projectId}/git/branches`),
      ]);
      if (statusRes.ok) {
        const status = await statusRes.json();
        setGitInfo(status);
      }
      if (branchRes.ok) {
        const { branches } = await branchRes.json();
        setGitBranches(branches || []);
      }
    } catch { /* ignore git errors */ }
  }, [projectId, loadSubdirectory]);

  // Load subdirectory contents

  // Load folder contents
  const handleLoadFolder = useCallback(async (path: string) => {
    const contents = await loadSubdirectory(path);
    setFolderContents(prev => {
      const newMap = new Map(prev);
      newMap.set(path, contents);
      
      // Also load nested directories
      for (const entry of contents) {
        if (entry.type === 'dir') {
          const fullPath = `${path}/${entry.path}`;
          // Don't load if already loaded
          if (!newMap.has(fullPath)) {
            loadSubdirectory(fullPath).then(subContents => {
              setFolderContents(prev2 => new Map(prev2).set(fullPath, subContents));
            });
          }
        }
      }
      
      return newMap;
    });
  }, [loadSubdirectory]);

  // Tree file operations
  const handleTreeContextMenu = useCallback((e: React.MouseEvent, entry: Entry) => {
    setTreeContextMenu({
      x: e.clientX,
      y: e.clientY,
      file: {
        name: entry.path.split('/').pop() || entry.path,
        path: entry.path,
        type: entry.type === 'dir' ? 'directory' : 'file',
      }
    });
  }, []);

  const handleTreeRename = useCallback(async (file: FileItem, newName: string) => {
    if (!projectId || newName === file.name) { setTreeRenamingPath(null); return; }
    const dir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '.';
    const newPath = dir === '.' ? newName : `${dir}/${newName}`;
    try {
      await fileOp(projectId, { action: 'rename', oldPath: file.path, newPath });
      loadTreeRef.current?.('.');
    } catch (err: any) {
      alert('重命名失败: ' + err.message);
    }
    setTreeRenamingPath(null);
  }, [projectId]);

  const handleTreeDelete = useCallback(async () => {
    if (!projectId || !treeDeleteTarget) return;
    try {
      await fileOp(projectId, { action: 'delete', path: treeDeleteTarget.path });
      loadTreeRef.current?.('.');
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
    setTreeDeleteTarget(null);
  }, [projectId, treeDeleteTarget]);

  const handleTreeCopy = useCallback((file: FileItem) => {
    if (!projectId) return;
    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    const baseName = ext ? file.name.slice(0, -ext.length) : file.name;
    const copyName = `${baseName} - 副本${ext}`;
    const dir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '.';
    const destPath = dir === '.' ? copyName : `${dir}/${copyName}`;
    fileOp(projectId, { action: 'copy', sourcePath: file.path, destPath })
      .then(() => loadTreeRef.current?.('.'))
      .catch((err: any) => alert('复制失败: ' + err.message));
  }, [projectId]);

  const handleTreeMove = useCallback((file: FileItem) => {
    const dir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '.';
    setTreePromptDialog({
      title: `移动 "${file.name}" 到目录（相对路径）:`,
      defaultValue: dir === '.' ? '' : dir,
      onConfirm: async (destDir) => {
        if (!projectId) return;
        try {
          await fileOp(projectId, { action: 'move', sourcePath: file.path, destDir: destDir || '.' });
          loadTreeRef.current?.('.');
        } catch (err: any) {
          alert('移动失败: ' + err.message);
        }
        setTreePromptDialog(null);
      }
    });
  }, [projectId]);

  // Toggle folder expansion
  function toggleFolder(path: string) {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }

  // Build tree structure from flat list
  function buildTreeStructure(entries: Entry[]): Map<string, Entry[]> {
    const structure = new Map<string, Entry[]>();
    
    // Initialize with root
    structure.set('', []);
    
    entries.forEach(entry => {
      const parts = entry.path.split('/');
      const parentPath = parts.slice(0, -1).join('/');
      
      if (!structure.has(parentPath)) {
        structure.set(parentPath, []);
      }
      structure.get(parentPath)?.push(entry);
      
      // If it's a directory, ensure it exists in the structure
      if (entry.type === 'dir') {
        if (!structure.has(entry.path)) {
          structure.set(entry.path, []);
        }
      }
    });
    
    return structure;
  }

  const openFile = useCallback(async (path: string) => {
    try {
      if (hasUnsavedChanges && path !== selectedFile) {
        const shouldDiscard =
          typeof window !== 'undefined'
            ? window.confirm('You have unsaved changes. Discard them and open the new file?')
            : true;
        if (!shouldDiscard) {
          return;
        }
      }

      setSaveFeedback('idle');
      setSaveError(null);

      // Check if file is binary (image/video/pdf/office) - skip text content loading
      const previewType = getFilePreviewType(path);
      if (
        previewType === 'image' || 
        previewType === 'video' || 
        previewType === 'pdf' ||
        previewType === 'word' ||
        previewType === 'excel' ||
        previewType === 'ppt'
      ) {
        setContent('');
        setEditedContent('');
        editedContentRef.current = '';
        setHasUnsavedChanges(false);
        setSelectedFile(path);
        setIsFileUpdating(false);
        return;
      }

      const r = await fetch(`${API_BASE}/api/repo/${projectId}/file?path=${encodeURIComponent(path)}`);
      
      if (!r.ok) {
        console.error('Failed to load file:', r.status, r.statusText);
        const fallback = '// Failed to load file content';
        setContent(fallback);
        setEditedContent(fallback);
        editedContentRef.current = fallback;
        setHasUnsavedChanges(false);
        setSelectedFile(path);
        return;
      }
      
      const data = await r.json();
      const fileContent = typeof data?.content === 'string' ? data.content : '';
      setContent(fileContent);
      setEditedContent(fileContent);
      editedContentRef.current = fileContent;
      setHasUnsavedChanges(false);
      setSelectedFile(path);
      setIsFileUpdating(false);

      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.scrollTop = 0;
          editorRef.current.scrollLeft = 0;
        }
        if (highlightRef.current) {
          highlightRef.current.scrollTop = 0;
          highlightRef.current.scrollLeft = 0;
        }
        if (lineNumberRef.current) {
          lineNumberRef.current.scrollTop = 0;
        }
      });
    } catch (error) {
      console.error('Error opening file:', error);
      const fallback = '// Error loading file';
      setContent(fallback);
      setEditedContent(fallback);
      editedContentRef.current = fallback;
      setHasUnsavedChanges(false);
      setSelectedFile(path);
    }
  }, [projectId, hasUnsavedChanges, selectedFile]);

  // Reload currently selected file
  const reloadCurrentFile = useCallback(async () => {
    if (selectedFile && !showPreview && !hasUnsavedChanges) {
      // Skip binary files and office documents - no need to poll for changes
      const previewType = getFilePreviewType(selectedFile);
      if (
        previewType === 'image' || 
        previewType === 'video' || 
        previewType === 'pdf' ||
        previewType === 'word' ||
        previewType === 'excel' ||
        previewType === 'ppt'
      ) {
        return;
      }

      try {
        const r = await fetch(`${API_BASE}/api/repo/${projectId}/file?path=${encodeURIComponent(selectedFile)}`);
        if (r.ok) {
          const data = await r.json();
          const newContent = data.content || '';
          if (newContent !== content) {
            setIsFileUpdating(true);
            setContent(newContent);
            setEditedContent(newContent);
            editedContentRef.current = newContent;
            setHasUnsavedChanges(false);
            setSaveFeedback('idle');
            setSaveError(null);
            setTimeout(() => setIsFileUpdating(false), 500);
          }
        }
      } catch (error) {
        // Silently fail - this is a background refresh
      }
    }
  }, [projectId, selectedFile, showPreview, hasUnsavedChanges, content]);

  // Lazy load highlight.js only when needed
  const [hljs, setHljs] = useState<any>(null);
  
  useEffect(() => {
    if (selectedFile && !hljs) {
      import('highlight.js/lib/common').then(mod => {
        setHljs(mod.default);
        // Load highlight.js CSS dynamically
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';
        document.head.appendChild(link);
      });
    }
  }, [selectedFile, hljs]);

  const highlightedCode = useMemo(() => {
    const code = editedContent ?? '';
    if (!code) {
      return '&nbsp;';
    }

    if (!hljs) {
      return escapeHtml(code);
    }

    const language = getFileLanguage(selectedFile);
    try {
      if (!language || language === 'plaintext') {
        return escapeHtml(code);
      }
      return hljs.highlight(code, { language }).value;
    } catch {
      try {
        return hljs.highlightAuto(code).value;
      } catch {
        return escapeHtml(code);
      }
    }
  }, [hljs, editedContent, selectedFile]);

  const onEditorChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setEditedContent(value);
    editedContentRef.current = value;
    setHasUnsavedChanges(value !== content);
    setSaveFeedback('idle');
    setSaveError(null);
    if (isFileUpdating) {
      setIsFileUpdating(false);
    }
  }, [content, isFileUpdating]);

  const handleEditorScroll = useCallback((event: UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = event.currentTarget;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
    }
    if (lineNumberRef.current) {
      lineNumberRef.current.scrollTop = scrollTop;
    }
  }, []);

  const handleSaveFile = useCallback(async () => {
    if (!selectedFile || isSavingFile || !hasUnsavedChanges) {
      return;
    }

    const contentToSave = editedContentRef.current;
    setIsSavingFile(true);
    setSaveFeedback('idle');
    setSaveError(null);

    try {
      const response = await fetch(`${API_BASE}/api/repo/${projectId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: contentToSave }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to save file';
        try {
          const data = await response.clone().json();
          errorMessage = data?.error || data?.message || errorMessage;
        } catch {
          const text = await response.text().catch(() => '');
          if (text) {
            errorMessage = text;
          }
        }
        throw new Error(errorMessage);
      }

      setContent(contentToSave);
      setSaveFeedback('success');

      if (editedContentRef.current === contentToSave) {
        setHasUnsavedChanges(false);
        setIsFileUpdating(true);
        setTimeout(() => setIsFileUpdating(false), 800);
      }

      refreshPreview();
    } catch (error) {
      console.error('Failed to save file:', error);
      setSaveFeedback('error');
      setSaveError(error instanceof Error ? error.message : 'Failed to save file');
    } finally {
      setIsSavingFile(false);
    }
  }, [selectedFile, isSavingFile, hasUnsavedChanges, projectId, refreshPreview]);

  const handleEditorKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      handleSaveFile();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const el = event.currentTarget;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const indent = '  ';
      const value = editedContent;
      const newValue = value.slice(0, start) + indent + value.slice(end);

      setEditedContent(newValue);
      editedContentRef.current = newValue;
      setHasUnsavedChanges(newValue !== content);
      setSaveFeedback('idle');
      setSaveError(null);
      if (isFileUpdating) {
        setIsFileUpdating(false);
      }

      requestAnimationFrame(() => {
        const position = start + indent.length;
        el.selectionStart = position;
        el.selectionEnd = position;
        if (highlightRef.current) {
          highlightRef.current.scrollTop = el.scrollTop;
          highlightRef.current.scrollLeft = el.scrollLeft;
        }
        if (lineNumberRef.current) {
          lineNumberRef.current.scrollTop = el.scrollTop;
        }
      });
    }
  }, [handleSaveFile, editedContent, content, isFileUpdating]);

  useEffect(() => {
    if (saveFeedback === 'success') {
      const timer = setTimeout(() => setSaveFeedback('idle'), 1800);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [saveFeedback]);

  useEffect(() => {
    if (editorRef.current && highlightRef.current && lineNumberRef.current) {
      const { scrollTop, scrollLeft } = editorRef.current;
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
      lineNumberRef.current.scrollTop = scrollTop;
    }
  }, [editedContent]);

  // Get file extension for syntax highlighting
  function getFileLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'tsx':
      case 'ts':
        return 'typescript';
      case 'jsx':
      case 'js':
      case 'mjs':
        return 'javascript';
      case 'css':
        return 'css';
      case 'scss':
      case 'sass':
        return 'scss';
      case 'html':
      case 'htm':
        return 'html';
      case 'json':
        return 'json';
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'py':
        return 'python';
      case 'sh':
      case 'bash':
        return 'bash';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'xml':
        return 'xml';
      case 'sql':
        return 'sql';
      case 'php':
        return 'php';
      case 'java':
        return 'java';
      case 'c':
        return 'c';
      case 'cpp':
      case 'cc':
      case 'cxx':
        return 'cpp';
      case 'rs':
        return 'rust';
      case 'go':
        return 'go';
      case 'rb':
        return 'ruby';
      case 'vue':
        return 'vue';
      case 'svelte':
        return 'svelte';
      case 'dockerfile':
        return 'dockerfile';
      case 'toml':
        return 'toml';
      case 'ini':
        return 'ini';
      case 'conf':
      case 'config':
        return 'nginx';
      default:
        return 'plaintext';
    }
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Get file icon based on type
  function getFileIcon(entry: Entry): React.ReactElement {
    if (entry.type === 'dir') {
      return <span className="text-blue-500"><Folder size={16} /></span>;
    }
    
    const ext = entry.path.split('.').pop()?.toLowerCase();
    const filename = entry.path.split('/').pop()?.toLowerCase();
    
    // Special files
    if (filename === 'package.json') return <JsonIcon size={16} />;
    if (filename === 'dockerfile') return <span className="text-blue-400"><Ship size={16} /></span>;
    if (filename?.startsWith('.env')) return <span className="text-yellow-500"><Lock size={16} /></span>;
    
    switch (ext) {
      // Images
      case 'png': return <PngIcon size={16} />;
      case 'jpg': case 'jpeg': return <JpgIcon size={16} />;
      case 'gif': return <GifIcon size={16} />;
      case 'svg': return <SvgFileIcon size={16} />;
      case 'webp': case 'bmp': case 'ico': return <WebpIcon size={16} />;
      // Video
      case 'mp4': return <Mp4Icon size={16} />;
      case 'avi': case 'mov': case 'wmv': case 'flv': case 'webm': case 'mkv': return <VideoFileIcon size={16} />;
      // Audio
      case 'mp3': case 'wav': case 'ogg': case 'flac': case 'm4a': case 'aac': return <AudioFileIcon size={16} />;
      // Office
      case 'doc': case 'docx': return <WordIcon size={16} />;
      case 'xls': case 'xlsx': return <ExcelIcon size={16} />;
      case 'ppt': case 'pptx': return <PowerPointIcon size={16} />;
      case 'pdf': return <PdfIcon size={16} />;
      // Archive
      case 'zip': case 'rar': case 'tar': case 'gz': case '7z': return <ZipIcon size={16} />;
      // Code
      case 'tsx': return <TsxIcon size={16} />;
      case 'ts': return <TsIcon size={16} />;
      case 'jsx': return <JsxIcon size={16} />;
      case 'js': case 'mjs': return <JsIcon size={16} />;
      case 'css': return <CssIcon size={16} />;
      case 'scss': case 'sass': return <ScssIcon size={16} />;
      case 'html': case 'htm': return <HtmlIcon size={16} />;
      case 'json': return <JsonIcon size={16} />;
      case 'md': case 'markdown': return <MdIcon size={16} />;
      case 'txt': return <TxtIcon size={16} />;
      case 'py': return <PyIcon size={16} />;
      case 'sh': case 'bash': return <ShIcon size={16} />;
      case 'yaml': case 'yml': return <YamlIcon size={16} />;
      case 'xml': return <XmlIcon size={16} />;
      case 'sql': return <SqlIcon size={16} />;
      case 'php': return <PhpIcon size={16} />;
      case 'java': return <JavaIcon size={16} />;
      case 'c': return <CIcon size={16} />;
      case 'cpp': case 'cc': case 'cxx': return <CppIcon size={16} />;
      case 'rs': return <RustIcon size={16} />;
      case 'go': return <GoIcon size={16} />;
      case 'rb': return <RubyIcon size={16} />;
      case 'vue': return <VueIcon size={16} />;
      case 'svelte': return <SvelteIcon size={16} />;
      case 'toml': case 'ini': case 'conf': case 'config': return <TomlIcon size={16} />;
      default: return <GenericFileIcon size={16} />;
    }
  }

  

  const loadSettings = useCallback(async (projectSettings?: { cli?: string; model?: string }) => {
    try {
      console.log('🔧 loadSettings called with project settings:', projectSettings);

      const hasCliSet = projectSettings?.cli || preferredCli;
      const hasModelSet = projectSettings?.model || selectedModel;

      if (!hasCliSet || !hasModelSet) {
        console.log('⚠️ Missing CLI or model, loading global settings');
        const globalResponse = await fetch(`${API_BASE}/api/settings/global`);
        if (globalResponse.ok) {
          const globalSettings = await globalResponse.json();
          const defaultCli = sanitizeCli(globalSettings.default_cli || globalSettings.defaultCli);
          const cliToUse = sanitizeCli(hasCliSet || defaultCli);

          if (!hasCliSet) {
            console.log('🔄 Setting CLI from global:', cliToUse);
            updatePreferredCli(cliToUse);
          }

          if (!hasModelSet) {
            const cliSettings = globalSettings.cli_settings?.[cliToUse] || globalSettings.cliSettings?.[cliToUse];
            if (cliSettings?.model) {
              updateSelectedModel(cliSettings.model, cliToUse);
            } else {
              updateSelectedModel(getDefaultModelForCli(cliToUse), cliToUse);
            }
          }
        } else {
          const response = await fetch(`${API_BASE}/api/settings`);
          if (response.ok) {
            const settings = await response.json();
            if (!hasCliSet) updatePreferredCli(settings.preferred_cli || settings.default_cli || DEFAULT_ACTIVE_CLI);
            if (!hasModelSet) {
              const cli = sanitizeCli(settings.preferred_cli || settings.default_cli || preferredCli || DEFAULT_ACTIVE_CLI);
              updateSelectedModel(getDefaultModelForCli(cli), cli);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      const hasCliSet = projectSettings?.cli || preferredCli;
      const hasModelSet = projectSettings?.model || selectedModel;
      if (!hasCliSet) updatePreferredCli(DEFAULT_ACTIVE_CLI);
      if (!hasModelSet) updateSelectedModel(getDefaultModelForCli(DEFAULT_ACTIVE_CLI), DEFAULT_ACTIVE_CLI);
    }
  }, [preferredCli, selectedModel, updatePreferredCli, updateSelectedModel]);

  const loadProjectInfo = useCallback(async (): Promise<{ cli?: string; model?: string; status?: ProjectStatus }> => {
    try {
      const r = await fetch(`${API_BASE}/api/projects/${projectId}`);
      if (!r.ok) {
        setProjectName(`Project ${projectId.slice(0, 8)}`);
        setProjectDescription('');
        setHasInitialPrompt(false);
        localStorage.setItem(`project_${projectId}_hasInitialPrompt`, 'false');
        setProjectStatus('active');
        setIsInitializing(false);
        setUsingGlobalDefaults(true);
        return {};
      }

      const payload = await r.json();
      const project = payload?.data ?? payload;
      const rawPreferredCli =
        typeof project?.preferredCli === 'string'
          ? project.preferredCli
          : typeof project?.preferred_cli === 'string'
          ? project.preferred_cli
          : undefined;
      const rawSelectedModel =
        typeof project?.selectedModel === 'string'
          ? project.selectedModel
          : typeof project?.selected_model === 'string'
          ? project.selected_model
          : undefined;
      const rawPermissionMode = project?.permissionMode as 'default' | 'acceptEdits' | 'bypassPermissions' | undefined;

      console.log('📋 Loading project info:', {
        preferredCli: rawPreferredCli,
        selectedModel: rawSelectedModel,
        permissionMode: rawPermissionMode,
      });

      setProjectName(project.name || `Project ${projectId.slice(0, 8)}`);

      // Load employee name if employee_id exists
      const employeeId = project.employee_id;
      if (employeeId) {
        try {
          const empRes = await fetch(`${API_BASE}/api/employees/${employeeId}`);
          if (empRes.ok) {
            const empPayload = await empRes.json();
            const emp = empPayload?.data ?? empPayload;
            if (emp?.name) {
              // Only set employeeName if user hasn't customized the title
              // and the project name still matches the employee name or is a default
              if (!titleCustomizedRef.current) {
                const pName = project.name || '';
                const isDefaultName = !pName || pName === emp.name || pName.startsWith('Project ') || pName.startsWith('p-');
                if (isDefaultName) {
                  setEmployeeName(emp.name);
                }
              }
            }
          }
        } catch {
          // Ignore employee fetch errors
        }
      }

      const projectCli = sanitizeCli(rawPreferredCli || preferredCli);
      if (rawPreferredCli) {
        updatePreferredCli(projectCli);
      }
      if (rawSelectedModel) {
        updateSelectedModel(rawSelectedModel, projectCli);
      } else {
        updateSelectedModel(getDefaultModelForCli(projectCli), projectCli);
      }
      // Load permission mode
      if (rawPermissionMode) {
        setPermissionMode(rawPermissionMode);
      }

      const followGlobal = !rawPreferredCli && !rawSelectedModel;
      setUsingGlobalDefaults(followGlobal);
      setProjectDescription(project.description || '');
      const mode = project.mode || 'code';
      setProjectMode(mode); // 设置项目模式
      setWorkDirectory(project.work_directory || ''); // 设置工作目录
      setProjectPath(project.absolutePath || ''); // 设置项目绝对路径

      // work 模式默认显示文件标签和图标视图
      // boss 模式默认显示员工状态（派工）页
      if (mode === 'work') {
        setShowPreview(false);
        setShowConsole(false);
        setShowSettings(false);
        setShowAliyunDeploy(false);
        setShowLocalDeploy(false);
        setShowEmployeeStatus(false);
        setShowTerminal(false);
        setFileViewMode('grid'); // 默认图标模式
      } else if (mode === 'boss') {
        setShowPreview(false);
        setShowConsole(false);
        setShowSettings(false);
        setShowAliyunDeploy(false);
        setShowLocalDeploy(false);
        setShowEmployeeStatus(true); // 默认显示派工页
        setShowTerminal(false);
      } else if (mode === 'cli') {
        // CLI mode: show terminal in the right panel
        setShowPreview(false);
        setShowConsole(false);
        setShowSettings(false);
        setShowAliyunDeploy(false);
        setShowLocalDeploy(false);
        setShowEmployeeStatus(false);
        setShowTerminal(true);
        setCliSessionId(`cli-${projectId}`);
      } else {
        // code mode (default): reset all special panels
        setShowPreview(true);
        setShowConsole(false);
        setShowSettings(false);
        setShowAliyunDeploy(false);
        setShowLocalDeploy(false);
        setShowEmployeeStatus(false);
        setShowTerminal(false);
      }

      if (project.initial_prompt) {
        setHasInitialPrompt(true);
        localStorage.setItem(`project_${projectId}_hasInitialPrompt`, 'true');
      } else {
        setHasInitialPrompt(false);
        localStorage.setItem(`project_${projectId}_hasInitialPrompt`, 'false');
      }

      if (project.status === 'initializing') {
        setProjectStatus('initializing');
        setIsInitializing(true);
      } else {
        setProjectStatus('active');
        setIsInitializing(false);
        triggerInitialPromptIfNeeded();
      }

      const normalizedModel = rawSelectedModel
        ? sanitizeModel(projectCli, rawSelectedModel)
        : getDefaultModelForCli(projectCli);

      return {
        cli: rawPreferredCli ? projectCli : undefined,
        model: normalizedModel,
        status: project.status as ProjectStatus | undefined,
      };
    } catch (error) {
      console.error('Failed to load project info:', error);
      setProjectName(`Project ${projectId.slice(0, 8)}`);
      setProjectDescription('');
      setHasInitialPrompt(false);
      localStorage.setItem(`project_${projectId}_hasInitialPrompt`, 'false');
      setProjectStatus('active');
      setIsInitializing(false);
      setUsingGlobalDefaults(true);
      return {};
    }
  }, [
    projectId,
    triggerInitialPromptIfNeeded,
    updatePreferredCli,
    updateSelectedModel,
    preferredCli,
  ]);

  const loadProjectInfoRef = useRef(loadProjectInfo);
  useEffect(() => {
    loadProjectInfoRef.current = loadProjectInfo;
  }, [loadProjectInfo]);

  useEffect(() => {
    if (!searchParams) return;
    const cliParam = searchParams.get('cli');
    const modelParam = searchParams.get('model');
    if (!cliParam && !modelParam) {
      return;
    }
    const sanitizedCli = cliParam ? sanitizeCli(cliParam) : preferredCli;
    if (cliParam) {
      setUsingGlobalDefaults(false);
      updatePreferredCli(sanitizedCli);
    }
    if (modelParam) {
      setUsingGlobalDefaults(false);
      updateSelectedModel(modelParam, sanitizedCli);
    }
  }, [searchParams, preferredCli, updatePreferredCli, updateSelectedModel, setUsingGlobalDefaults]);

  // Work 模式下自动加载文件树
  useEffect(() => {
    if (projectMode === 'work' && fileViewMode === 'grid' && (!tree || tree.length === 0)) {
      loadTree('.');
    }
  }, [projectMode, fileViewMode, tree, loadTree]);

  const loadSettingsRef = useRef(loadSettings);
  useEffect(() => {
    loadSettingsRef.current = loadSettings;
  }, [loadSettings]);

  const loadTreeRef = useRef(loadTree);
  useEffect(() => {
    loadTreeRef.current = loadTree;
  }, [loadTree]);

  const loadDeployStatusRef = useRef(loadDeployStatus);
  useEffect(() => {
    loadDeployStatusRef.current = loadDeployStatus;
  }, [loadDeployStatus]);

  const checkCurrentDeploymentRef = useRef(checkCurrentDeployment);
  useEffect(() => {
    checkCurrentDeploymentRef.current = checkCurrentDeployment;
  }, [checkCurrentDeployment]);

  // Stable message handlers with useCallback to prevent reassignment
  const createStableMessageHandlers = useCallback(() => {
    const addMessage = (message: any) => {
      console.log('🔄 [StableHandler] Adding message via stable handler:', {
        messageId: message.id,
        role: message.role,
        isOptimistic: message.isOptimistic,
        requestId: message.requestId
      });

      // Track optimistic messages by requestId
      if (message.isOptimistic && message.requestId) {
        optimisticMessagesRef.current.set(message.requestId, message);
        console.log('🔄 [StableHandler] Tracking optimistic message:', {
          requestId: message.requestId,
          tempId: message.id
        });
      }

      // Also call the current handlers if they exist
      if (messageHandlersRef.current) {
        messageHandlersRef.current.add(message);
      }
    };

    const removeMessage = (messageId: string) => {
      console.log('🔄 [StableHandler] Removing message via stable handler:', messageId);

      // Remove from optimistic messages tracking if it's an optimistic message
      const optimisticMessage = Array.from(optimisticMessagesRef.current.values())
        .find(msg => msg.id === messageId);
      if (optimisticMessage && optimisticMessage.requestId) {
        optimisticMessagesRef.current.delete(optimisticMessage.requestId);
        console.log('🔄 [StableHandler] Removed optimistic message tracking:', {
          requestId: optimisticMessage.requestId,
          tempId: messageId
        });
      }

      // Also call the current handlers if they exist
      if (messageHandlersRef.current) {
        messageHandlersRef.current.remove(messageId);
      }
    };

    return { add: addMessage, remove: removeMessage };
  }, []);

  // Initialize stable handlers once
  useEffect(() => {
    stableMessageHandlers.current = createStableMessageHandlers();
    const optimisticMessages = optimisticMessagesRef.current;

    return () => {
      stableMessageHandlers.current = null;
      optimisticMessages.clear();
    };
  }, [createStableMessageHandlers]);

  // Handle image upload with base64 conversion
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        if (file.type.startsWith('image/')) {
          const url = URL.createObjectURL(file);
          
          // Convert to base64
          const reader = new FileReader();
          reader.onload = (e) => {
            const base64 = e.target?.result as string;
            setUploadedImages(prev => [...prev, {
              name: file.name,
              url,
              base64
            }]);
          };
          reader.readAsDataURL(file);
        }
      });
    }
  };

  // Remove uploaded image
  const removeUploadedImage = (index: number) => {
    setUploadedImages(prev => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].url);
      newImages.splice(index, 1);
      return newImages;
    });
  };

  async function runAct(messageOverride?: string, externalImages?: any[]): Promise<boolean> {
    let finalMessage = messageOverride || prompt;
    const imagesToUse = externalImages || uploadedImages;

    if (!finalMessage.trim() && imagesToUse.length === 0) {
      alert('Please enter a task description or upload an image.');
      return false;
    }

    // Add additional instructions in Chat Mode
    if (mode === 'chat') {
      finalMessage = finalMessage + "\n\nDo not modify code, only answer to the user's request.";
    }

    // Create request fingerprint for deduplication
    const requestFingerprint = JSON.stringify({
      message: finalMessage.trim(),
      imageCount: imagesToUse.length,
      cliPreference: preferredCli,
      model: selectedModel,
      mode
    });

    // Check for duplicate pending requests
    if (pendingRequestsRef.current.has(requestFingerprint)) {
      // 注释掉，减少干扰
      // console.log('🔄 [DEBUG] Duplicate request detected, skipping:', requestFingerprint);
      return false;
    }

    const requestId = generateUUID();
    currentRequestIdRef.current = requestId;  // 保存当前requestId
    setIsRunning(true);
    console.log(`[中断按钮] ===请求开始=== requestId=${requestId}, mode=${mode}, isRunning=true`);
    let tempUserMessageId: string | null = null;

    // Add to pending requests
    pendingRequestsRef.current.add(requestFingerprint);

    try {
      const uploadImageFromBase64 = async (img: { base64: string; name?: string }) => {
        const base64String = img.base64;
        const match = base64String.match(/^data:(.*?);base64,(.*)$/);
        const mimeType = match && match[1] ? match[1] : 'image/png';
        const base64Data = match && match[2] ? match[2] : base64String;

        const byteString = atob(base64Data);
        const buffer = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i += 1) {
          buffer[i] = byteString.charCodeAt(i);
        }

        const extension = (() => {
          if (mimeType.includes('png')) return 'png';
          if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
          if (mimeType.includes('gif')) return 'gif';
          if (mimeType.includes('webp')) return 'webp';
          if (mimeType.includes('svg')) return 'svg';
          return 'png';
        })();

        const inferredName = img.name && img.name.trim().length > 0 ? img.name.trim() : `image-${crypto.randomUUID()}.${extension}`;
        const hasExtension = /\.[a-zA-Z0-9]+$/.test(inferredName);
        const filename = hasExtension ? inferredName : `${inferredName}.${extension}`;

        const file = new File([buffer], filename, { type: mimeType });
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_BASE}/api/assets/${projectId}/upload`, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Upload failed');
        }

        const result = await response.json();
        return {
          name: result.filename || filename,
          path: result.absolute_path,
          url: `/api/assets/${projectId}/${result.filename}`,
          public_url: typeof result.public_url === 'string' ? result.public_url : undefined,
          publicUrl: typeof result.public_url === 'string' ? result.public_url : undefined,
        };
      };

      console.log('🖼️ Processing images in runAct:', {
          imageCount: imagesToUse.length,
          cli: preferredCli,
          requestId
        });
      const processedImages: { name: string; path: string; url?: string; public_url?: string; publicUrl?: string }[] = [];

      for (let i = 0; i < imagesToUse.length; i += 1) {
        const image = imagesToUse[i];
        console.log(`🖼️ Processing image ${i}:`, {
          id: image.id,
          filename: image.filename,
          hasPath: !!image.path,
          hasPublicUrl: !!image.publicUrl,
          hasAssetUrl: !!image.assetUrl
        });
        if (image?.path) {
          const name = image.filename || image.name || `Image ${i + 1}`;
          const candidateUrl = typeof image.assetUrl === 'string' ? image.assetUrl : undefined;
          const candidatePublicUrl = typeof image.publicUrl === 'string' ? image.publicUrl : undefined;
          const processedImage = {
            name,
            path: image.path,
            url: candidateUrl && candidateUrl.startsWith('/') ? candidateUrl : undefined,
            public_url: candidatePublicUrl,
            publicUrl: candidatePublicUrl,
          };
          console.log(`🖼️ Created processed image ${i}:`, processedImage);
          processedImages.push(processedImage);
          continue;
        }

        if (image?.base64) {
          try {
            const uploaded = await uploadImageFromBase64({ base64: image.base64, name: image.name });
            processedImages.push(uploaded);
          } catch (uploadError) {
            console.error('Image upload failed:', uploadError);
            alert('Failed to upload image. Please try again.');
            setIsRunning(false);
            // Remove from pending requests
            pendingRequestsRef.current.delete(requestFingerprint);
            return false;
          }
        }
      }

      const requestBody = {
        instruction: finalMessage,
        images: processedImages,
        isInitialPrompt: false,
        cliPreference: preferredCli,
        conversationId: conversationId || undefined,
        requestId,
        selectedModel,
      };

      console.log('📸 Sending request to act API:', {
        messageLength: finalMessage.length,
        imageCount: processedImages.length,
        cli: preferredCli,
        requestId,
        images: processedImages.map(img => ({
          name: img.name,
          hasPath: !!img.path,
          hasUrl: !!img.url,
          hasPublicUrl: !!img.publicUrl
        }))
      });

      // Optimistically add user message to UI BEFORE API call for instant feedback
      tempUserMessageId = requestId + '-user-temp';
      if (messageHandlersRef.current) {
        const optimisticUserMessage = {
          id: tempUserMessageId,
          projectId: projectId,
          role: 'user' as const,
          messageType: 'chat' as const,
          content: finalMessage,
          conversationId: conversationId || null,
          requestId: requestId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isStreaming: false,
          isFinal: false,
          isOptimistic: true,
          metadata:
            processedImages.length > 0
              ? {
                  attachments: processedImages.map((img) => ({
                    name: img.name,
                    path: img.path,
                    url: img.url,
                    publicUrl: img.publicUrl ?? img.public_url,
                  })),
                }
              : undefined,
        };
        console.log('🔄 [Optimistic] Adding optimistic user message via stable handler:', {
          tempId: tempUserMessageId,
          requestId,
          content: finalMessage.substring(0, 50) + '...'
        });

        // Use stable handlers instead of direct messageHandlersRef to prevent reassignment issues
        if (stableMessageHandlers.current) {
          stableMessageHandlers.current.add(optimisticUserMessage);
        } else if (messageHandlersRef.current) {
          // Fallback to direct handlers if stable handlers aren't ready yet
          messageHandlersRef.current.add(optimisticUserMessage);
        }
      }

      // Add timeout to prevent indefinite waiting
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      let r: Response;
      try {
        r = await fetch(`${API_BASE}/api/chat/${projectId}/act`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!r.ok) {
          const errorText = await r.text();
          console.error('API Error:', errorText);

          if (tempUserMessageId) {
            console.log('🔄 [Optimistic] Removing optimistic user message due to API error via stable handler:', tempUserMessageId);
            if (stableMessageHandlers.current) {
              stableMessageHandlers.current.remove(tempUserMessageId);
            } else if (messageHandlersRef.current) {
              messageHandlersRef.current.remove(tempUserMessageId);
            }
          }

          alert(`Failed to send message: ${r.status} ${r.statusText}\n${errorText}`);
          return false;
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          if (tempUserMessageId) {
            console.log('🔄 [Optimistic] Removing optimistic user message due to timeout via stable handler:', tempUserMessageId);
            if (stableMessageHandlers.current) {
              stableMessageHandlers.current.remove(tempUserMessageId);
            } else if (messageHandlersRef.current) {
              messageHandlersRef.current.remove(tempUserMessageId);
            }
          }

          alert('Request timed out after 60 seconds. Please check your connection and try again.');
          return false;
        }
        throw fetchError;
      }

      const result = await r.json();

      console.log('📸 Act API response received:', {
        success: result.success,
        userMessageId: result.userMessageId,
        conversationId: result.conversationId,
        requestId: result.requestId,
        hasAttachments: processedImages.length > 0,
        demoMode: result.demoMode,
      });

      const returnedConversationId =
        typeof result?.conversationId === 'string'
          ? result.conversationId
          : typeof result?.conversation_id === 'string'
          ? result.conversation_id
          : undefined;
      if (returnedConversationId) {
        setConversationId(returnedConversationId);
      }

      const resolvedRequestId =
        typeof result?.requestId === 'string'
          ? result.requestId
          : typeof result?.request_id === 'string'
          ? result.request_id
          : requestId;
      const userMessageId =
        typeof result?.userMessageId === 'string'
          ? result.userMessageId
          : typeof result?.user_message_id === 'string'
          ? result.user_message_id
          : '';

      // Refresh data after completion
      await loadTree('.');

      // Don't clear prompt here - let ChatInput handle it based on return value
      // setPrompt('');
      // if (uploadedImages && uploadedImages.length > 0) {
      //   uploadedImages.forEach(img => {
      //     if (img.url) URL.revokeObjectURL(img.url);
      //   });
      //   setUploadedImages([]);
      // }

      return true; // Success

    } catch (error: any) {
      console.error('Act execution error:', error);

      if (tempUserMessageId) {
        console.log('🔄 [Optimistic] Removing optimistic user message due to execution error via stable handler:', tempUserMessageId);
        if (stableMessageHandlers.current) {
          stableMessageHandlers.current.remove(tempUserMessageId);
        } else if (messageHandlersRef.current) {
          messageHandlersRef.current.remove(tempUserMessageId);
        }
      }

      const errorMessage = error?.message || String(error);
      alert(`Failed to send message: ${errorMessage}\n\nPlease try again. If the problem persists, check the console for details.`);

      // 仅在API调用失败时设为false，成功时由SSE事件控制
      setIsRunning(false);
      console.log(`[中断按钮] setIsRunning(false) - 来源: API失败`);
      return false; // Failure
    } finally {
      // Remove from pending requests
      pendingRequestsRef.current.delete(requestFingerprint);
    }
  }


  // 停止任务
  const handleStopTask = async () => {
    console.log('[中断按钮] 🛑 用户点击中断按钮');
    console.log('[中断按钮] 当前 isRunning:', isRunning);

    if (!isRunning) {
      console.log('[中断按钮] ❌ isRunning=false，无活跃请求，忽略');
      return;
    }

    const requestId = currentRequestIdRef.current;
    console.log('[中断按钮] 当前 requestId:', requestId);

    if (!requestId) {
      console.log('[中断按钮] ❌ requestId 为空，无法中断');
      return;
    }

    console.log(`[中断按钮] 🔄 发送中断请求: ${requestId}`);

    try {
      const response = await fetch(`${API_BASE}/api/chat/${projectId}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });

      const result = await response.json();
      console.log('[中断按钮] API 响应:', result);

      if (!response.ok) {
        throw new Error(result.error || `Failed to stop task: ${response.status}`);
      }

      console.log('[中断按钮] ✅ 中断请求成功发送');
      currentRequestIdRef.current = null;  // 清空

      // 显示成功提示
      console.log('[中断按钮] 💡 等待后端处理中断...');
    } catch (error: any) {
      console.error('[StopTask] ❌ Error:', error);
      alert(`停止任务失败: ${error.message}\n\n请重试或查看控制台获取详细信息`);
    }
  };


  // Handle permission request from ChatLog SSE
  const handlePermissionRequest = useCallback((permission: PendingPermission) => {
    console.log('[Page] Permission request received:', permission.id, permission.toolName);
    setPendingPermissions(prev => {
      // Avoid duplicates
      if (prev.some(p => p.id === permission.id)) {
        return prev;
      }
      return [...prev, permission];
    });
  }, []);

  // Handle permission resolved (approved or denied)
  const handlePermissionResolved = useCallback((permissionId: string, approved: boolean) => {
    console.log('[Page] Permission resolved:', permissionId, approved ? 'approved' : 'denied');
    setPendingPermissions(prev => prev.filter(p => p.id !== permissionId));
  }, []);

  // Handle project status updates via callback from ChatLog
  const handleProjectStatusUpdate = (status: string, message?: string) => {
    const previousStatus = projectStatus;
    
    // Ignore if status is the same (prevent duplicates)
    if (previousStatus === status) {
      return;
    }
    
    setProjectStatus(status as ProjectStatus);
    if (message) {
      setInitializationMessage(message);
    }
    
    // If project becomes active, stop showing loading UI
    if (status === 'active') {
      setIsInitializing(false);
      
      // Handle only when transitioning from initializing → active
      if (previousStatus === 'initializing') {
        loadTreeRef.current?.('.');
      }
      
      // Initial prompt: trigger once with shared guard (handles active-via-WS case)
      triggerInitialPromptIfNeeded();
    } else if (status === 'failed') {
      setIsInitializing(false);
    }
  };

  // Function to start dependency installation in background
  const handleRetryInitialization = async () => {
    setProjectStatus('initializing');
    setIsInitializing(true);
    setInitializationMessage('Retrying project initialization...');
    
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/retry-initialization`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error('Failed to retry initialization');
      }
    } catch (error) {
      console.error('Failed to retry initialization:', error);
      setProjectStatus('failed');
      setInitializationMessage('Failed to retry initialization. Please try again.');
    }
  };

  // Load states from localStorage when projectId changes
  useEffect(() => {
    if (typeof window !== 'undefined' && projectId) {
      const storedHasInitialPrompt = localStorage.getItem(`project_${projectId}_hasInitialPrompt`);
      const storedTaskComplete = localStorage.getItem(`project_${projectId}_taskComplete`);
      
      if (storedHasInitialPrompt !== null) {
        setHasInitialPrompt(storedHasInitialPrompt === 'true');
      }
      if (storedTaskComplete !== null) {
        setAgentWorkComplete(storedTaskComplete === 'true');
      }
    }
  }, [projectId]);

  // 处理演示模式：检测 URL 参数并设置状态
  useEffect(() => {
    if (!projectId || !searchParams) return;

    const demoReplay = searchParams.get('demoReplay');
    const deployedUrl = searchParams.get('deployedUrl');

    if (demoReplay === 'true') {
      setIsDemo(true);
      if (deployedUrl) {
        setDemoDeployedUrl(deployedUrl);
      }

      // 清除 URL 参数
      const url = new URL(window.location.href);
      url.searchParams.delete('demoReplay');
      url.searchParams.delete('deployedUrl');
      window.history.replaceState({}, '', url.toString());
    }
  }, [projectId, searchParams]);



  // Poll for file changes in code view
  useEffect(() => {
    if (!showPreview && selectedFile && !hasUnsavedChanges) {
      const interval = setInterval(() => {
        reloadCurrentFile();
      }, 5000); // Check every 5 seconds

      return () => clearInterval(interval);
    }
  }, [showPreview, selectedFile, hasUnsavedChanges, reloadCurrentFile]);


  useEffect(() => {
    if (!projectId) {
      return;
    }

    // For skill singleton projects (skill-{name}), default to fullscreen preview mode
    if (projectId.startsWith('skill-')) {
      setPreviewMode('fullscreen');
    }

    let canceled = false;

    const initializeChat = async () => {
      try {
        const projectSettingsPromise = loadProjectInfoRef.current?.();
        const parallelTasks: Promise<any>[] = [];
        const t2 = loadDeployStatusRef.current?.();
        const t3 = checkCurrentDeploymentRef.current?.();
        if (t2) parallelTasks.push(t2);
        if (t3) parallelTasks.push(t3);
        await Promise.all(parallelTasks);
        if (canceled) return;

        const projectSettings = await projectSettingsPromise;
        if (canceled) return;
        await loadSettingsRef.current?.(projectSettings);
      } catch (error) {
        console.error('Failed to initialize chat view:', error);
      }
    };

    initializeChat();

    try {
      router.prefetch('/');
    } catch {}

    const handleServicesUpdate = () => {
      loadDeployStatusRef.current?.();
    };

    const handleBeforeUnload = () => {
      // 技能项目（skill-*）不应在页面卸载时停止，因为它们需要持久运行
      if (!projectId.startsWith('skill-')) {
        navigator.sendBeacon(`${API_BASE}/api/projects/${projectId}/preview/stop`);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('services-updated', handleServicesUpdate);

    return () => {
      canceled = true;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('services-updated', handleServicesUpdate);

      const currentPreview = previewUrlRef.current;
      // 技能项目（skill-*）不应在离开页面时停止，因为它们需要持久运行
      if (currentPreview && !projectId.startsWith('skill-')) {
        fetch(`${API_BASE}/api/projects/${projectId}/preview/stop`, { method: 'POST' }).catch(() => {});
      }
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    fetch(`${API_BASE}/api/projects`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (!active || !payload) return;
        const items = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload)
          ? payload
          : [];
        try {
          sessionStorage.setItem('projectsCache', JSON.stringify(items));
        } catch {}
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let canceled = false;
    const run = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/projects/${projectId}/preview/status`, { cache: 'no-store' });
        if (!r.ok) return;
        const payload = await r.json();
        const data = payload?.data ?? payload ?? {};
        const status = typeof data?.status === 'string' ? data.status : undefined;
        const url = typeof data?.url === 'string' ? data.url : null;
        const instanceId = typeof data?.instanceId === 'number' ? data.instanceId : undefined;
        try { console.log('[PreviewStatus.HTTP]', { status, url, instanceId, data }); } catch {}
        if (status) {
          setBackendPreviewPhase(status);
        }
        if (canceled) return;
        if (url) {
          handlePreviewReady(url, instanceId);
          // 不要在轮询中设置 setIsStartingPreview(false)，让 SSE 事件控制
        } else {
          // 不要在轮询中设置 setIsStartingPreview(false)，让 SSE 事件控制
          if (status === 'error') {
            setPreviewError('预览启动失败');
          }
        }
      } catch {}
    };
    run();
    return () => {
      canceled = true;
    };
  }, [projectId, handlePreviewReady]);

  // Cleanup pending requests on unmount
  useEffect(() => {
    const pendingRequests = pendingRequestsRef.current;
    return () => {
      pendingRequests.clear();
    };
  }, []);

  // React to global settings changes when using global defaults
  const { settings: globalSettings } = useGlobalSettings();
  const { bgUrl, bgCss, primaryHex, theme, toggleTheme } = useTheme();

  // Track client mount to avoid hydration mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!usingGlobalDefaults) return;
    if (!globalSettings) return;

    const cli = sanitizeCli(globalSettings.default_cli);
    updatePreferredCli(cli);

    const modelFromGlobal = globalSettings.cli_settings?.[cli]?.model;
    if (modelFromGlobal) {
      updateSelectedModel(modelFromGlobal, cli);
    } else {
      updateSelectedModel(getDefaultModelForCli(cli), cli);
    }
  }, [globalSettings, usingGlobalDefaults, updatePreferredCli, updateSelectedModel]);

  // Detect mobile device (simple width check)
  useEffect(() => {
    const checkMobile = () => {
      if (typeof window === 'undefined') return;
      const isMobile = window.innerWidth < 768;
      setIsMobileDevice(isMobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  // Fetch LAN IP for mobile access QR code
  useEffect(() => {
    const fetchLanIP = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/network/lan-ip`);
        if (response.ok) {
          const data = await response.json();
          setLanIP(data?.data?.primaryIP || null);
        }
      } catch (error) {
        console.error('Failed to fetch LAN IP:', error);
      }
    };

    fetchLanIP();
  }, []);

  // Generate mobile access URL
  const mobileAccessUrl = useMemo(() => {
    if (!lanIP) return null;
    const currentPort = typeof window !== 'undefined' ? window.location.port || '80' : '3000';
    return `http://${lanIP}:${currentPort}/${projectId}/chat`;
  }, [lanIP, projectId]);

  // Show loading UI if project is initializing

  const [isNavigatingHome, setIsNavigatingHome] = useState(false);
  const [sidebarActiveItem, setSidebarActiveItem] = useState<'home' | 'templates' | 'apps' | 'help'>('apps'); // Sidebar shows 'apps' as active
  const [currentView, setCurrentView] = useState<'home' | 'templates' | 'apps' | 'help' | 'chat'>('chat'); // Content shows chat
  const [projects, setProjects] = useState<any[]>([]);

  // Load projects list for "My Apps" view
  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/projects`);
      if (!r.ok) return;
      const payload = await r.json();
      const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
      setProjects(items);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <>
      <style jsx global>{`
        /* Light theme syntax highlighting */
        .hljs {
          background: #f9fafb !important;
          color: #374151 !important;
        }
        
        .hljs-punctuation,
        .hljs-bracket,
        .hljs-operator {
          color: #1f2937 !important;
          font-weight: 600 !important;
        }
        
        .hljs-built_in,
        .hljs-keyword {
          color: #7c3aed !important;
          font-weight: 600 !important;
        }
        
        .hljs-string {
          color: #059669 !important;
        }
        
        .hljs-number {
          color: #dc2626 !important;
        }
        
        .hljs-comment {
          color: #6b7280 !important;
          font-style: italic;
        }
        
        .hljs-function,
        .hljs-title {
          color: #2563eb !important;
          font-weight: 600 !important;
        }
        
        .hljs-variable,
        .hljs-attr {
          color: #dc2626 !important;
        }
        
        .hljs-tag,
        .hljs-name {
          color: #059669 !important;
        }
        
        /* Make parentheses, brackets, and braces more visible */
        .hljs-punctuation:is([data-char="("], [data-char=")"], [data-char="["], [data-char="]"], [data-char="{"], [data-char="}"]) {
          color: #1f2937 !important;
          font-weight: bold !important;
          background: rgba(59, 130, 246, 0.1);
          border-radius: 2px;
          padding: 0 1px;
        }

        /* Dark theme syntax highlighting */
        .dark .hljs {
          background: rgba(15, 23, 42, 0.5) !important;
          color: #e2e8f0 !important;
        }
        .dark .hljs-punctuation,
        .dark .hljs-bracket,
        .dark .hljs-operator {
          color: #cbd5e1 !important;
        }
        .dark .hljs-built_in,
        .dark .hljs-keyword {
          color: #a78bfa !important;
        }
        .dark .hljs-string {
          color: #34d399 !important;
        }
        .dark .hljs-number {
          color: #f87171 !important;
        }
        .dark .hljs-comment {
          color: #64748b !important;
        }
        .dark .hljs-function,
        .dark .hljs-title {
          color: #60a5fa !important;
        }
        .dark .hljs-variable,
        .dark .hljs-attr {
          color: #fb923c !important;
        }
        .dark .hljs-tag,
        .dark .hljs-name {
          color: #34d399 !important;
        }
        
      `}</style>

      <div className="h-screen flex items-center justify-center p-0 md:p-0 overflow-hidden">
      {/* Animated Background */}
      <AnimatedBackground bgUrl={bgUrl} bgCss={bgCss} />
      <div className="glass flex h-full w-full max-w-[1600px] rounded-none md:rounded-2xl shadow-2xl overflow-hidden relative">
        {/* App Sidebar */}
        <AppSidebar
          currentPage={sidebarActiveItem}
          theme={theme}
          mounted={mounted}
          onToggleTheme={toggleTheme}
          onNavigate={(page) => {
            if (page === 'settings') {
              setShowGlobalSettings(true);
            } else if (page === 'home') {
              router.push('/workspace');
            } else if (page === 'apps') {
              router.push('/workspace?view=apps');
            } else if (page === 'templates') {
              router.push('/workspace?view=templates');
            } else {
              router.push(`/workspace?view=${page}`);
            }
          }}
        />

        <div className="h-[calc(100%-16px)] flex-1 flex min-w-0 overflow-hidden relative glass-card m-2 rounded-2xl">
          {/* Mobile view toggle - fixed at top, always visible */}
          {isMobileDevice && (
            <div className="absolute top-0 left-0 right-0 z-50 bg-white/30 dark:bg-slate-900/30 backdrop-blur-md border-b border-white/10 px-4 py-2 flex items-center justify-center gap-1">
              <button
                onClick={() => setMobileViewMode('chat')}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mobileViewMode === 'chat'
                    ? 'bg-white/50 dark:bg-white/10 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/30 dark:hover:bg-white/5'
                }`}
              >
                聊天
              </button>
              <button
                onClick={() => setMobileViewMode('preview')}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mobileViewMode === 'preview'
                    ? 'bg-white/50 dark:bg-white/10 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/30 dark:hover:bg-white/5'
                }`}
              >
                预览
              </button>
            </div>
          )}

          {/* Left: Chat window or Main Content */}
          <div
            style={{
              width: isMobileDevice
                ? (mobileViewMode === 'chat' ? '100%' : '0')
                : (currentView === 'chat'
                  ? (previewMode === 'fullscreen' ? '0' : previewMode === 'mobile' ? '60%' : '35%')
                  : '100%'),
              display: isMobileDevice && mobileViewMode === 'preview' ? 'none' : undefined,
              overflow: previewMode === 'fullscreen' ? 'hidden' : undefined,
              paddingTop: isMobileDevice ? '52px' : undefined
            }}
            className="h-full border-r border-white/15 dark:border-white/[0.06] flex flex-col min-w-0 flex-shrink-0 overflow-hidden transition-all duration-300 chat-panel-responsive"
          >
            {currentView === 'chat' && (
              <>
            {/* Chat header */}
            <div className="bg-white/30 dark:bg-white/[0.06] backdrop-blur-md border-b border-white/20 dark:border-white/[0.06] px-4 h-12 flex items-center">
              {/* Left: Back button */}
              <button
                onClick={() => {
                  if (window.history.length > 1) {
                    router.back();
                  } else {
                    router.push('/workspace');
                  }
                }}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-white/20 dark:hover:bg-white/10 transition-colors mr-3"
                title="返回"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 12H5M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {/* Center: Employee/Project info */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-white/30 dark:bg-white/10 flex items-center justify-center">
                  <User className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                </div>
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    value={editingTitleValue}
                    onChange={(e) => setEditingTitleValue(e.target.value)}
                    onBlur={async () => {
                      const newName = editingTitleValue.trim();
                      setIsEditingTitle(false);
                      if (newName && newName !== (employeeName || projectName)) {
                        titleCustomizedRef.current = true;
                        setProjectName(newName);
                        setEmployeeName('');
                        try {
                          await fetch(`${API_BASE}/api/projects/${projectId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: newName }),
                          });
                        } catch (e: unknown) {
                          console.error('Failed to update project name:', e);
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        (e.target as HTMLInputElement).blur();
                      } else if (e.key === 'Escape') {
                        setIsEditingTitle(false);
                      }
                    }}
                    className="text-base font-semibold text-slate-800 dark:text-white bg-transparent border-b border-primary outline-none px-0 py-0 w-48"
                    autoFocus
                  />
                ) : (
                  <span
                    className="text-base font-semibold text-slate-800 dark:text-white truncate cursor-pointer hover:text-primary transition-colors"
                    onClick={() => {
                      setEditingTitleValue(employeeName || projectName || '');
                      setIsEditingTitle(true);
                      setTimeout(() => titleInputRef.current?.select(), 0);
                    }}
                    title="点击修改标题"
                  >
                    {employeeName || projectName || 'Loading...'}
                  </span>
                )}
              </div>
            </div>

            {/* Chat log area */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <ChatErrorBoundary>
              {(() => {
                const focusInputRef = focusInputRefGlobal || (focusInputRefGlobal = { fn: null as null | (() => void) });
                return null;
              })()}
              <ChatLog
                projectId={projectId}
                isDemoReplay={isDemo}
                onFocusInput={() => {
                  try {
                    const f = (focusInputRefGlobal && focusInputRefGlobal.fn) as undefined | (() => void);
                    if (typeof f === 'function') f();
                  } catch {}
                }}
                onAddUserMessage={(handlers) => {
                  messageHandlersRef.current = handlers;
                  // Update stable handlers reference if exists
                  if (stableMessageHandlers.current) {
                    // Note: stableMessageHandlers.current already has its own add/remove logic
                  }
                }}
                onSessionStatusChange={(isRunningValue, requestId) => {
                  console.log(`[中断按钮] onSessionStatusChange 回调触发: ${isRunningValue ? 'true' : 'false'}, requestId=${requestId}`);
                  setIsRunning(isRunningValue);
                  // Sync requestId for multi-window interrupt support
                  if (isRunningValue && requestId) {
                    currentRequestIdRef.current = requestId;
                  } else if (!isRunningValue) {
                    currentRequestIdRef.current = null;
                  }
                  console.log(`[中断按钮] setIsRunning(${isRunningValue}) - 来源: onSessionStatusChange`);
                }}
                onSseFallbackActive={(active) => {
                  // 注释掉，减少干扰
                  // console.log('🔄 [SSE] Fallback status:', active);
                  setIsSseFallbackActive(active);
                }}
                onProjectStatusUpdate={handleProjectStatusUpdate}
                onPreviewReady={(url, instanceId) => {
                  handlePreviewReady(url, instanceId);
                  try { fetch(`${API_BASE}/api/projects/${projectId}/log/frontend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'preview.ready.auto_switch', message: 'Auto switch to preview URL', level: 'info', metadata: { url, instanceId } }) }); } catch {}
                }}
                onPreviewError={(message) => {
                  const msg = typeof message === 'string' && message.trim().length > 0 ? message : '预览启动失败';
                  setPreviewError(msg);
                  try { fetch(`${API_BASE}/api/projects/${projectId}/log/frontend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'preview.error.ui', message: msg, level: 'error' }) }); } catch {}
                }}
                onPreviewPhaseChange={(phase) => {
                  setBackendPreviewPhase(phase);
                  if (phase === 'preview_starting' || phase === 'preview_installing' || phase === 'preview_running') {
                    setIsStartingPreview(true);
                  } else if (phase === 'preview_ready') {
                    setIsStartingPreview(false);
                  } else if (phase === 'error' || phase === 'preview_error') {
                    setIsStartingPreview(false);
                  }
                  // 不要响应 'stopped', 'idle', 'running' 来关闭加载，避免与启动流程冲突
                }}
                onPlanningCompleted={(planMd, requestId, isApproved) => {
                  // 如果这个 requestId 已经确认过，忽略后续的 planning_completed
                  if (approvedRequestIdsRef.current.has(requestId)) {
                    return;
                  }
                  setPlanContent(planMd);
                  // 如果已确认，不显示确认按钮；否则显示
                  if (isApproved) {
                    approvedRequestIdsRef.current.add(requestId);
                    setPendingPlanApproval(null);
                  } else {
                    setPendingPlanApproval({ requestId });
                  }
                  setActivePreviewTab('activity');
                }}
                onPlanApproved={(requestId) => {
                  approvedRequestIdsRef.current.add(requestId);
                  setPendingPlanApproval(null);
                  // 不关闭标签页，让 plan 内容继续显示
                }}
                onTodoUpdate={(todos) => {
                  setCurrentTodos(todos);
                }}
                onFileChange={(change) => {
                  setFileChanges(prev => {
                    const updated = [...prev, change];
                    // 限制最多保留100条，超出时移除最旧的
                    return updated.length > 100 ? updated.slice(-100) : updated;
                  });
                  // 有新的代码变更时，如果当前没有显示任何标签，自动显示执行动态标签
                  setActivePreviewTab(current => current === 'none' ? 'activity' : current);
                }}
                onDemoStart={(deployedUrl) => {
                  console.log('[DemoMode] Demo started, deployedUrl:', deployedUrl);
                  setIsDemo(true);
                  setDemoDeployedUrl(deployedUrl);
                }}
                onDemoReplayComplete={() => {
                  // sourceProjectId 模式回放完成后，自动启动预览
                  // 注：此回调只会被 sourceProjectId 模式触发（前端延迟回放），模板回放走后端 SSE 不会触发
                  console.log('[DemoMode] Replay complete, starting preview...');
                  start();
                }}
                onPermissionRequest={handlePermissionRequest}
                onPermissionResolved={handlePermissionResolved}
              />
              </ChatErrorBoundary>
            </div>

            {/* Pending permission requests */}
            {pendingPermissions.length > 0 && (
              <div className="px-4 pb-2">
                {pendingPermissions.map((permission) => (
                  <PermissionConfirmCard
                    key={permission.id}
                    permission={permission}
                    onResolved={handlePermissionResolved}
                  />
                ))}
              </div>
            )}

            {/* Todo progress bar - show above input */}
            <TodoBar todos={currentTodos} />

            {/* Simple input area */}
            <div className="px-2 pt-1 pb-2 rounded-bl-2xl">
              <ChatInput
                onSendMessage={async (message, images) => {
                  // Pass images to runAct
                  return await runAct(message, images);
                }}
                onStopTask={handleStopTask}
                placeholder={
                  projectMode === 'boss'
                    ? "告诉我要给哪位员工派什么任务..."
                    : projectMode === 'work'
                    ? "工作模式..."
                    : mode === 'act'
                    ? "写代码模式..."
                    : "闲聊模式..."
                }
                mode={mode}
                onModeChange={setMode}
                workMode={projectMode}
                work_directory={workDirectory}
                onWork_directoryChange={handleWorkDirectoryChange}
                projectId={projectId}
                preferredCli={preferredCli}
                selectedModel={selectedModel}
                thinkingMode={thinkingMode}
                onThinkingModeChange={setThinkingMode}
                modelOptions={modelOptions}
                onModelChange={handleModelChange}
                modelChangeDisabled={isUpdatingModel}
                cliOptions={cliOptions}
                onCliChange={handleCliChange}
                cliChangeDisabled={isUpdatingModel}
                permissionMode={permissionMode}
                onPermissionModeChange={handlePermissionModeChange}
                isRunning={isRunning}
                onExposeFocus={(fn) => {
                  try {
                    if (!focusInputRefGlobal) {
                      focusInputRefGlobal = { fn } as any;
                    } else {
                      focusInputRefGlobal.fn = fn;
                    }
                  } catch {}
                }}
                onExposeInputControl={(control) => {
                  try {
                    if (!inputControlRefGlobal) {
                      inputControlRefGlobal = { control } as any;
                    } else {
                      inputControlRefGlobal.control = control;
                    }
                  } catch {}
                }}
              />
            </div>
              </>
            )}

            {/* Home View */}
            {currentView === 'home' && (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="w-full max-w-2xl">
                  <h1 className="text-4xl font-bold text-slate-800 dark:text-white mb-2 text-center">
                    开始新项目
                  </h1>
                  <p className="text-slate-600 dark:text-slate-400 mb-8 text-center">
                    描述你想要构建的应用，AI会帮你生成代码
                  </p>
                  <ChatInput
                    onSendMessage={async (message, images) => {
                      const success = await runAct(message, images);
                      if (success) {
                        setCurrentView('chat');
                      }
                      return success;
                    }}
                    placeholder="描述你想要创建的应用..."
                    mode={mode}
                    onModeChange={setMode}
                    workMode={projectMode}
                    work_directory={workDirectory}
                    onWork_directoryChange={handleWorkDirectoryChange}
                    projectId={projectId}
                    preferredCli={preferredCli}
                    selectedModel={selectedModel}
                    thinkingMode={thinkingMode}
                    onThinkingModeChange={setThinkingMode}
                    modelOptions={modelOptions}
                    onModelChange={handleModelChange}
                    modelChangeDisabled={isUpdatingModel}
                    cliOptions={cliOptions}
                    onCliChange={handleCliChange}
                    cliChangeDisabled={isUpdatingModel}
                    permissionMode={permissionMode}
                    onPermissionModeChange={handlePermissionModeChange}
                    isRunning={isRunning}
                  />
                </div>
              </div>
            )}

            {/* Templates View */}
            {currentView === 'templates' && (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center">
                  <div className="w-16 h-16 bg-white/15 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Folder className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                  </div>
                  <h2 className="text-2xl font-semibold text-slate-800 dark:text-white mb-2">模板库</h2>
                  <p className="text-slate-500 dark:text-slate-400">即将推出...</p>
                </div>
              </div>
            )}

            {/* My Apps View */}
            {currentView === 'apps' && (
              <div className="flex-1 overflow-y-auto p-8">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">牛马记录</h2>
                {projects.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-slate-500 dark:text-slate-400">还没有项目</p>
                  </div>
                ) : (
                  <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(305px, 1fr))' }}>
                    {projects.map((project: any) => (
                      <div
                        key={project.id}
                        className="glass-card rounded-lg p-4 cursor-pointer"
                        onClick={() => {
                          router.push(`/${project.id}/chat`);
                        }}
                      >
                        <h3 className="font-semibold text-slate-800 dark:text-white mb-2 truncate">
                          {project.name}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                          {new Date(project.updated_at || project.updatedAt || project.created_at || project.createdAt).toLocaleDateString()}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              // Edit functionality
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            编辑
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              // Delete functionality
                            }}
                            className="text-xs text-red-600 hover:text-red-800"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Help View */}
            {currentView === 'help' && (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center">
                  <div className="w-16 h-16 bg-white/15 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                    <HelpCircle className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                  </div>
                  <h2 className="text-2xl font-semibold text-slate-800 dark:text-white mb-2">帮助文档</h2>
                  <p className="text-slate-500 dark:text-slate-400 mb-4">即将推出...</p>
                </div>
              </div>
            )}
          </div>

          {/* Right: Preview/Code area - Only show in chat view */}
          {currentView === 'chat' && (
            <div
              className="h-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden transition-all duration-300 preview-panel-responsive"
              style={{
                width: isMobileDevice
                  ? (mobileViewMode === 'preview' ? '100%' : '0')
                  : (previewMode === 'fullscreen' ? '100%' : previewMode === 'mobile' ? '40%' : '65%'),
                display: isMobileDevice && mobileViewMode === 'chat' ? 'none' : undefined,
                paddingTop: isMobileDevice ? '52px' : undefined
              }}
            >
            {/* Content area */}
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Controls Bar */}
              <div className="bg-white/30 dark:bg-white/[0.06] backdrop-blur-md border-b border-white/20 dark:border-white/[0.06] px-3 h-12 flex items-center relative">
                <div className="flex items-center gap-2">
                  {/* Back button - show in fullscreen mode */}
                  {previewMode === 'fullscreen' && (
                    <button
                      aria-label="返回"
                      className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/20 dark:hover:bg-white/10 transition-colors"
                      onClick={() => {
                        if (window.history.length > 1) {
                          router.back();
                        } else {
                          router.push('/workspace');
                        }
                      }}
                      title="返回"
                    >
                      <ArrowLeft size={16} />
                    </button>
                  )}
                  {/* Preview Mode Toggle - hide on mobile */}
                  {!isMobileDevice && (
                  <div className="h-8 flex items-center gap-0.5 bg-white/20 dark:bg-white/5 rounded-lg px-0.5 border border-white/20 dark:border-white/10">
                    <button
                      aria-label="全屏模式"
                      className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                        previewMode === 'fullscreen'
                          ? 'text-primary bg-primary-subtle'
                          : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 '
                      }`}
                      onClick={() => handlePreviewModeChange('fullscreen')}
                      title="全屏模式"
                    >
                      <Maximize2 size={14} />
                    </button>
                    <button
                      aria-label="正常模式"
                      className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                        previewMode === 'normal'
                          ? 'text-primary bg-primary-subtle'
                          : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 '
                      }`}
                      onClick={() => handlePreviewModeChange('normal')}
                      title="正常模式"
                    >
                      <Monitor size={14} />
                    </button>
                    <button
                      aria-label="手机模式"
                      className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                        previewMode === 'mobile'
                          ? 'text-primary bg-primary-subtle'
                          : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 '
                      }`}
                      onClick={() => handlePreviewModeChange('mobile')}
                      title="手机模式"
                    >
                      <Smartphone size={14} />
                    </button>
                  </div>
                  )}

                  {/* Mobile Access QR Code Button - Hide on mobile, always show on desktop */}
                  {!isMobileDevice && mobileAccessUrl && (
                    <button
                      className="h-8 w-8 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/20 dark:hover:bg-white/10 rounded-lg transition-colors ml-2"
                      onClick={() => setShowQRCode(true)}
                      title="手机访问"
                    >
                      <QrCode size={16} />
                    </button>
                  )}

                  {/* Toggle switch */}
                  <div className="flex items-center bg-white/20 dark:bg-white/5 rounded-lg p-0.5 border border-white/15 dark:border-white/[0.06]">
                      <button
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center ${
                          showPreview && !showConsole && !showSettings && !showAliyunDeploy && !showLocalDeploy && !showEmployeeStatus && !showTerminal
                            ? 'bg-white/50 dark:bg-white/10 text-slate-900 dark:text-white '
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white '
                        }`}
                        onClick={() => { setShowPreview(true); setShowConsole(false); setShowSettings(false); setShowAliyunDeploy(false); setShowLocalDeploy(false); setShowEmployeeStatus(false); setShowTerminal(false); try { fetch(`${API_BASE}/api/projects/${projectId}/log/frontend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'preview.toggle', message: 'Show preview', level: 'info' }) }); } catch {} }}
                        title="Preview"
                      >
                        <span className="w-4 h-4 flex items-center justify-center"><Monitor size={14} /></span>
                        {showPreview && !showConsole && !showSettings && !showAliyunDeploy && !showLocalDeploy && !showEmployeeStatus && !showTerminal && <span className="ml-1">预览</span>}
                      </button>
                    <button
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center ${
                        !showPreview && !showConsole && !showSettings && !showAliyunDeploy && !showLocalDeploy && !showEmployeeStatus && !showTerminal
                          ? 'bg-white/50 dark:bg-white/10 text-slate-900 dark:text-white '
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white '
                      }`}
                      onClick={() => {
                        setShowPreview(false);
                        setShowConsole(false);
                        setShowSettings(false);
                        setShowAliyunDeploy(false);
                        setShowLocalDeploy(false);
                        setShowEmployeeStatus(false);
                        setShowTerminal(false);
                        if (tree.length === 0) {
                          loadTreeRef.current?.('.');
                        }
                      }}
                      title="Code"
                    >
                      <span className="w-4 h-4 flex items-center justify-center"><Code size={14} /></span>
                      {!showPreview && !showConsole && !showSettings && !showAliyunDeploy && !showLocalDeploy && !showEmployeeStatus && !showTerminal && <span className="ml-1">文件</span>}
                    </button>
                    <button
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center ${
                        showConsole
                          ? 'bg-white/50 dark:bg-white/10 text-slate-900 dark:text-white '
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white '
                      }`}
                      onClick={() => {
                        setShowConsole(true);
                        setShowPreview(false);
                        setShowSettings(false);
                        setShowAliyunDeploy(false);
                        setShowLocalDeploy(false);
                        setShowEmployeeStatus(false);
                        setShowTerminal(false);
                        loadTimelineContent();
                      }}
                      title="Console"
                    >
                      <span className="w-4 h-4 flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="4 17 10 11 4 5"></polyline>
                          <line x1="12" y1="19" x2="20" y2="19"></line>
                        </svg>
                      </span>
                      {showConsole && <span className="ml-1">控制台</span>}
                    </button>
                    <button
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center ${
                        showSettings
                          ? 'bg-white/50 dark:bg-white/10 text-slate-900 dark:text-white '
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white '
                      }`}
                      onClick={() => {
                        setShowSettings(true);
                        setShowPreview(false);
                        setShowConsole(false);
                        setShowAliyunDeploy(false);
                        setShowLocalDeploy(false);
                        setShowEmployeeStatus(false);
                        setShowTerminal(false);
                      }}
                      title="Settings"
                    >
                      <span className="w-4 h-4 flex items-center justify-center"><Settings size={14} /></span>
                      {showSettings && <span className="ml-1">设置</span>}
                    </button>
                    {/* 派工按钮 - 只在 boss 模式下显示 */}
                    {projectMode === 'boss' && (
                      <button
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center ${
                          showEmployeeStatus
                            ? 'bg-white/50 dark:bg-white/10 text-slate-900 dark:text-white '
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white '
                        }`}
                        onClick={() => {
                          setShowEmployeeStatus(true);
                          setShowPreview(false);
                          setShowConsole(false);
                          setShowSettings(false);
                          setShowAliyunDeploy(false);
                          setShowLocalDeploy(false);
                          setShowTerminal(false);
                        }}
                        title="Employee Status"
                      >
                        <span className="w-4 h-4 flex items-center justify-center"><User size={14} /></span>
                        {showEmployeeStatus && <span className="ml-1">派工</span>}
                      </button>
                    )}
                    {/* 只在 code 模式下显示发布按钮 */}
                    {projectMode === 'code' && (
                      <button
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center ${
                          showAliyunDeploy
                            ? 'bg-white/50 dark:bg-white/10 text-slate-900 dark:text-white '
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white '
                        }`}
                        onClick={() => {
                          setShowAliyunDeploy(true);
                          setShowLocalDeploy(false);
                          setShowPreview(false);
                          setShowConsole(false);
                          setShowSettings(false);
                          setShowEmployeeStatus(false);
                          setShowTerminal(false);
                        }}
                        title="Deploy to Aliyun"
                      >
                        <span className="w-4 h-4 flex items-center justify-center"><Share2 size={14} /></span>
                        {showAliyunDeploy && <span className="ml-1">发布</span>}
                      </button>
                    )}
                    {/* 本地部署按钮 - 仅 skill 项目显示 */}
                    {skillNameFromProject && (
                      <button
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center ${
                          showLocalDeploy
                            ? 'bg-white/50 dark:bg-white/10 text-slate-900 dark:text-white '
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white '
                        }`}
                        onClick={() => {
                          setShowLocalDeploy(true);
                          setShowAliyunDeploy(false);
                          setShowPreview(false);
                          setShowConsole(false);
                          setShowSettings(false);
                          setShowEmployeeStatus(false);
                          setShowTerminal(false);
                        }}
                        title="Local Deploy"
                      >
                        <span className="w-4 h-4 flex items-center justify-center"><Terminal size={14} /></span>
                        {showLocalDeploy && <span className="ml-1">本地部署</span>}
                      </button>
                    )}
                    {/* 终端按钮 - CLI 模式下显示 */}
                    {projectMode === 'cli' && (
                      <button
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center ${
                          showTerminal
                            ? 'bg-white/50 dark:bg-white/10 text-slate-900 dark:text-white '
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white '
                        }`}
                        onClick={() => {
                          setShowTerminal(true);
                          setShowPreview(false);
                          setShowConsole(false);
                          setShowSettings(false);
                          setShowAliyunDeploy(false);
                          setShowLocalDeploy(false);
                          setShowEmployeeStatus(false);
                        }}
                        title="Terminal"
                      >
                        <span className="w-4 h-4 flex items-center justify-center"><Code size={14} /></span>
                        {showTerminal && <span className="ml-1">终端</span>}
                      </button>
                    )}
                  </div>

                  {/* Center Controls - Only show when preview URL is available and not mobile */}
                  {showPreview && previewUrl && !isMobileDevice && (
                    <div className="flex items-center gap-2">
                      {/* Route Navigation */}
                      <div className="h-8 flex items-center bg-white/20 dark:bg-white/5 rounded-lg px-2 border border-white/20 dark:border-white/10 ">
                        <span className="text-slate-400 dark:text-slate-500 mr-1.5 cursor-help" title={previewUrl || ''}>
                          <Home size={11} />
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">/</span>
                        <input
                          type="text"
                          value={currentRoute.startsWith('/') ? currentRoute.slice(1) : currentRoute}
                          onChange={(e) => {
                            const value = e.target.value;
                            setCurrentRoute(value ? `/${value}` : '/');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              navigateToRoute(currentRoute);
                            }
                          }}
                          className="bg-transparent text-xs text-slate-700 dark:text-slate-300 outline-none w-10"
                          placeholder="route"
                        />
                      <button
                        onClick={() => navigateToRoute(currentRoute)}
                        className="ml-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white "
                      >
                        <ArrowRight size={11} />
                      </button>
                      </div>

                      {/* Refresh Button */}
                      <button
                        className="h-8 w-8 flex items-center justify-center bg-white/20 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/10 rounded-lg transition-colors"
                        onClick={() => {
                          const iframe = document.querySelector('iframe');
                          if (iframe) {
                            iframe.src = iframe.src;
                          }
                          try { fetch(`${API_BASE}/api/projects/${projectId}/log/frontend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'preview.refresh', message: 'Refresh preview', level: 'info', metadata: { url: iframe?.src } }) }); } catch {}
                        }}
                        title="Refresh preview"
                      >
                        <RotateCcw size={13} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 ml-auto">
                  {/* Preview Button - Show when preview is not running */}
                  {showPreview && !previewUrl && !isStartingPreview && (
                    <button
                      className="h-8 px-3 bg-black dark:bg-white text-white dark:text-black hover:opacity-90 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                      onClick={start}
                    >
                      启动
                    </button>
                  )}

                  {/* Stop Button - Show when preview is running */}
                  {showPreview && previewUrl && (
                    <button
                      className="h-8 px-3 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={stop}
                      disabled={isStopping}
                    >
                      Stop
                    </button>
                  )}
                </div>
              </div>

              {/* Content Area */}
              <div className="flex-1 relative bg-white/10 dark:bg-black/5 overflow-hidden">
                <AnimatePresence initial={false}>
                  {showLocalDeploy && skillNameFromProject ? (
                  <MotionDiv
                    key="local-deploy"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full flex flex-col bg-white/10 dark:bg-black/5"
                  >
                    <LocalDeployPage
                      skillName={skillNameFromProject}
                      onClose={() => {
                        setShowLocalDeploy(false);
                        setShowPreview(true);
                      }}
                      onCopyErrorToChat={(msg) => {
                        try {
                          if (inputControlRefGlobal?.control) {
                            inputControlRefGlobal.control.setMessage(msg);
                          }
                        } catch {}
                      }}
                    />
                  </MotionDiv>
                  ) : showAliyunDeploy ? (
                  <MotionDiv
                    key="aliyun-deploy"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full flex flex-col bg-white/10 dark:bg-black/5"
                  >
                    <AliyunDeployPage
                      projectId={projectId}
                      onClose={() => {
                        setShowAliyunDeploy(false);
                        setShowPreview(true);
                      }}
                      isDemo={isDemo}
                      deployedUrl={demoDeployedUrl}
                    />
                  </MotionDiv>
                  ) : showTerminal && cliSessionId ? (
                  <MotionDiv
                    key="terminal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{ height: '100%' }}
                  >
                    <TerminalEmulator
                      sessionId={cliSessionId}
                      onSessionEnd={() => {
                        setCliSessionId(null);
                      }}
                    />
                  </MotionDiv>
                  ) : showSettings ? (
                  <MotionDiv
                    key="settings"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full flex flex-col bg-white/10 dark:bg-black/5"
                  >
                    {/* Settings Header with Tabs */}
                    <div className="border-b border-white/20 dark:border-white/[0.06] bg-white/30 dark:bg-white/[0.06] backdrop-blur-md">
                      <div className="flex gap-2 p-4">
                        <button
                          onClick={() => setSettingsActiveTab('general')}
                          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            settingsActiveTab === 'general'
                              ? 'bg-white/40 dark:bg-white/10 text-slate-900 dark:text-white border border-white/30 dark:border-white/10'
                              : 'bg-white/15 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-white/25 dark:hover:bg-white/10'
                          }`}
                        >
                          常规
                        </button>
                        <button
                          onClick={() => setSettingsActiveTab('environment')}
                          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            settingsActiveTab === 'environment'
                              ? 'bg-white/40 dark:bg-white/10 text-slate-900 dark:text-white border border-white/30 dark:border-white/10'
                              : 'bg-white/15 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-white/25 dark:hover:bg-white/10'
                          }`}
                        >
                          环境变量
                        </button>
                      </div>
                    </div>

                    {/* Settings Content */}
                    <div className="flex-1 overflow-y-auto bg-white/10 dark:bg-black/5 p-6">
                      {settingsActiveTab === 'general' && (
                        <GeneralSettings
                          projectId={projectId}
                          projectName={projectName}
                          projectDescription={projectDescription ?? ''}
                          onProjectUpdated={({ name, description }) => {
                            setProjectName(name);
                            setProjectDescription(description ?? '');
                          }}
                        />
                      )}

                      {settingsActiveTab === 'environment' && (
                        <EnvironmentSettings projectId={projectId} />
                      )}
                    </div>
                  </MotionDiv>
                  ) : showConsole ? (
                  <MotionDiv
                    key="console"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full flex flex-col bg-white/10 dark:bg-black/5"
                  >
                    {/* Console Header */}
                    <div className="flex items-center justify-between px-4 py-2 bg-white/30 dark:bg-white/[0.06] backdrop-blur-md border-b border-white/20 dark:border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-green-600 dark:text-green-400" strokeWidth="2">
                          <polyline points="4 17 10 11 4 5"></polyline>
                          <line x1="12" y1="19" x2="20" y2="19"></line>
                        </svg>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Console Output</span>
                        {/* Real-time connection indicator */}
                        <div className="flex items-center gap-1.5 ml-2">
                          <div className={`w-2 h-2 rounded-full ${isTimelineSseConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-400 dark:bg-slate-600'}`} />
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {isTimelineSseConnected ? 'Live' : 'Offline'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={loadTimelineContent}
                        disabled={isLoadingTimeline}
                        className="px-2 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-white hover:bg-white/15 dark:bg-white/5 rounded transition-colors disabled:opacity-50"
                        title="Manual refresh (backup)"
                      >
                        {isLoadingTimeline ? 'Loading...' : 'Refresh'}
                      </button>
                    </div>

                    {/* Console Content */}
                    <div className="flex-1 overflow-y-auto bg-white/5 dark:bg-white/5 p-4 font-mono text-sm custom-scrollbar">
                      {!timelineContent ? (
                        <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                          <div className="text-center">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="mx-auto mb-3 text-slate-400 dark:text-slate-500" strokeWidth="1.5">
                              <polyline points="4 17 10 11 4 5"></polyline>
                              <line x1="12" y1="19" x2="20" y2="19"></line>
                            </svg>
                            <p className="text-sm">No console output yet</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Build and preview logs will appear here</p>
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">
                          {timelineContent.split('\n').map((line, idx) => (
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
                  </MotionDiv>
                  ) : showPreview ? (
                  <MotionDiv
                    key="preview"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{ height: '100%' }}
                  >
                {previewUrl ? (
                  <div className="relative w-full h-full bg-white/15 dark:bg-white/5 flex items-center justify-center">
                    {/* Mobile: Show open button instead of iframe */}
                    {isMobileDevice ? (
                      <div className="flex flex-col items-center justify-center p-8 text-center">
                        <div className="w-20 h-20 mb-6 flex items-center justify-center bg-white/30 dark:bg-white/10 rounded-full shadow-lg">
                          <Monitor size={40} className="text-slate-700 dark:text-slate-300" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-800 dark:text-white mb-3">
                          预览已就绪
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-xs">
                          在新窗口中打开预览页面
                        </p>
                        <button
                          onClick={() => {
                            if (previewUrl) {
                              try {
                                // Replace localhost with current hostname (for LAN access on mobile)
                                const previewUrlObj = new URL(previewUrl);
                                previewUrlObj.hostname = window.location.hostname;
                                window.open(previewUrlObj.toString(), '_blank');
                              } catch {
                                // Fallback to original URL if parsing fails
                                window.open(previewUrl, '_blank');
                              }
                            }
                          }}
                          className="px-6 py-3 bg-black hover:opacity-90 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-md"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                          在浏览器中打开
                        </button>
                        {previewError && (
                          <div className="mt-4 px-4 py-2 rounded-md border border-red-200 bg-red-50 text-red-700 text-sm max-w-xs">
                            {previewError}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Desktop: Show iframe as before */
                      <div className="bg-white dark:bg-slate-900 w-full h-full overflow-hidden">
                        {previewError && (
                          <div className="absolute top-2 left-2 right-2 z-20 flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-red-200 bg-red-50 text-red-700 shadow">
                            <span className="text-sm truncate flex-1 min-w-0">{previewError}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700"
                                onClick={() => {
                                  try {
                                    const guidance = `错误摘要：${previewError}\n请先查看后端日志：projects/${projectId}/logs/timeline.txt（最近200行），并据此给出修复建议。`;
                                    if (inputControlRefGlobal?.control) {
                                      inputControlRefGlobal.control.setMessage(guidance);
                                    }
                                  } catch {}
                                }}
                              >复制到聊天框</button>
                              <button
                                className="px-2 py-1 text-xs rounded bg-white/20 dark:bg-white/10 text-slate-700 dark:text-slate-300 hover:bg-white/25 dark:bg-white/15"
                                onClick={() => setPreviewError(null)}
                              >关闭</button>
                            </div>
                          </div>
                        )}
                        <iframe
                          key={`${previewUrl || 'empty'}-${previewInstanceId ?? 0}`}
                          ref={iframeRef}
                          className="w-full h-full border-none bg-white dark:bg-slate-900 "
                          src={previewUrl || ''}
                          onError={() => {
                            // Show error overlay
                            const overlay = document.getElementById('iframe-error-overlay');
                            if (overlay) overlay.style.display = 'flex';
                          }}
                          onLoad={() => {
                            // Hide error overlay when loaded successfully
                            const overlay = document.getElementById('iframe-error-overlay');
                            if (overlay) overlay.style.display = 'none';
                          }}
                        />

                        {/* Error overlay */}
                      <div
                        id="iframe-error-overlay"
                        className="absolute inset-0 bg-white/5 dark:bg-white/5 flex items-center justify-center z-10"
                        style={{ display: 'none' }}
                      >
                        <div className="text-center max-w-md mx-auto p-6">
                          <div className="text-4xl mb-4">🔄</div>
                          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">
                            Connection Issue
                          </h3>
                          <p className="text-slate-600 dark:text-slate-400 mb-4">
                            The preview couldn&apos;t load properly. Try clicking the refresh button to reload the page.
                          </p>
                          <button
                            className="flex items-center gap-2 mx-auto px-4 py-2 btn-primary rounded-lg transition-colors"
                            onClick={() => {
                              const iframe = document.querySelector('iframe');
                              if (iframe) {
                                iframe.src = iframe.src;
                              }
                              const overlay = document.getElementById('iframe-error-overlay');
                              if (overlay) overlay.style.display = 'none';
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M1 4v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            Refresh Now
                          </button>
                        </div>
                      </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-white/5 dark:bg-white/5 relative">
                    {/* Plan/Todo/Code 标签面板 */}
                    {(planContent || currentTodos.length > 0 || fileChanges.length > 0) && activePreviewTab !== 'none' && (
                      <PreviewTabs
                        planContent={planContent}
                        todos={currentTodos}
                        fileChanges={fileChanges}
                        activeTab={activePreviewTab}
                        onTabChange={setActivePreviewTab}
                        pendingApproval={!!pendingPlanApproval}
                        onApprovePlan={async () => {
                          if (pendingPlanApproval) {
                            const rid = pendingPlanApproval.requestId;
                            approvedRequestIdsRef.current.add(rid);
                            setPendingPlanApproval(null);
                            // 不关闭标签页，只隐藏确认按钮
                            try {
                              await fetch(`${API_BASE}/api/chat/${projectId}/approve-plan`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ requestId: rid, approve: true }),
                              });
                            } catch {}
                          }
                        }}
                      />
                    )}
                    {/* 标签按钮（当有内容但未选中时显示） */}
                    {(planContent || currentTodos.length > 0 || fileChanges.length > 0) && activePreviewTab === 'none' && (
                      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
                        {/* 执行动态按钮 - 放在第一位 */}
                        {(planContent || fileChanges.length > 0) && (
                          <button
                            onClick={() => setActivePreviewTab('activity')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                              pendingPlanApproval
                                ? 'bg-white/20 dark:bg-white/10 text-slate-800 dark:text-white'
                                : 'bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-300 hover:bg-white/15 dark:bg-white/5'
                            }`}
                          >
                            执行动态
                            <span className="text-slate-400 dark:text-slate-500">
                              {(planContent ? 1 : 0) + fileChanges.length}
                            </span>
                            {pendingPlanApproval && (
                              <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
                            )}
                          </button>
                        )}
                        {/* 任务进度按钮 */}
                        {currentTodos.length > 0 && (
                          <button
                            onClick={() => setActivePreviewTab('todo')}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-300 hover:bg-white/15 dark:bg-white/5"
                          >
                            任务进度
                            <span className="text-slate-400 dark:text-slate-500">
                              {currentTodos.filter(t => t.status === 'completed').length}/{currentTodos.length}
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                    {previewError && (
                      <div className="absolute top-2 left-2 right-2 z-20 flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-red-200 bg-red-50 text-red-700 shadow">
                        <span className="text-sm truncate flex-1 min-w-0">{previewError}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700"
                              onClick={() => {
                                try {
                                  const guidance = `错误摘要：${previewError}\n请先查看后端日志：projects/${projectId}/logs/timeline.txt（最近200行），并据此给出修复建议。`;
                                  if (inputControlRefGlobal?.control) {
                                    inputControlRefGlobal.control.setMessage(guidance);
                                  }
                                } catch {}
                              }}
                            >复制到聊天框</button>
                          <button
                            className="px-2 py-1 text-xs rounded bg-white/20 dark:bg-white/10 text-slate-700 dark:text-slate-300 hover:bg-white/25 dark:bg-white/15"
                            onClick={() => setPreviewError(null)}
                          >关闭</button>
                        </div>
                      </div>
                    )}
                    {/* Content */}
                    <div className="relative w-full h-full flex items-center justify-center">
                    {isStartingPreview ? (
                      <MotionDiv
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="text-center"
                      >
                        {/* Loading spinner */}
                        <div className="w-16 h-16 mx-auto mb-6">
                          <div
                            className="w-full h-full border-4 rounded-full animate-spin"
                            style={{
                              borderTopColor: 'transparent',
                              borderRightColor: '#000000',
                              borderBottomColor: '#000000',
                              borderLeftColor: '#000000',
                            }}
                          />
                        </div>
                        
                        {/* Content */}
                        <h3 className="text-xl font-semibold text-slate-800 dark:text-white mb-3">
                          Starting Preview Server
                        </h3>
                        
                        <div className="flex items-center justify-center gap-1 text-slate-600 dark:text-slate-400 ">
                          <span>{previewInitializationMessage}</span>
                          <MotionDiv
                            className="flex gap-1 ml-2"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                          >
                            <MotionDiv
                              animate={{ opacity: [0, 1, 0] }}
                              transition={{ duration: 1.5, repeat: Infinity, delay: 0 }}
                              className="w-1 h-1 bg-slate-600 dark:bg-slate-400 rounded-full"
                            />
                            <MotionDiv
                              animate={{ opacity: [0, 1, 0] }}
                              transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
                              className="w-1 h-1 bg-slate-600 dark:bg-slate-400 rounded-full"
                            />
                            <MotionDiv
                              animate={{ opacity: [0, 1, 0] }}
                              transition={{ duration: 1.5, repeat: Infinity, delay: 0.6 }}
                              className="w-1 h-1 bg-slate-600 dark:bg-slate-400 rounded-full"
                            />
                          </MotionDiv>
                        </div>
                      </MotionDiv>
                    ) : (
                    <div className="text-center">
                      <MotionDiv
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                      >
                        {/* Building Status */}
                        {(backendPreviewPhase === 'preview_starting' || backendPreviewPhase === 'preview_installing' || backendPreviewPhase === 'preview_running') ? (
                          <>
                            <h3 className="text-2xl font-bold mb-3 relative overflow-hidden inline-block">
                              <span 
                                className="relative"
                                style={{
                                  background: `linear-gradient(90deg, 
                                    #6b7280 0%, 
                                    #6b7280 30%, 
                                    #ffffff 50%, 
                                    #6b7280 70%, 
                                    #6b7280 100%)`,
                                  backgroundSize: '200% 100%',
                                  WebkitBackgroundClip: 'text',
                                  backgroundClip: 'text',
                                  WebkitTextFillColor: 'transparent',
                                  animation: 'shimmerText 5s linear infinite'
                                }}
                              >
                                Building...
                              </span>
                              <style>{`
                                @keyframes shimmerText {
                                  0% {
                                    background-position: 200% center;
                                  }
                                  100% {
                                    background-position: -200% center;
                                  }
                                }
                              `}</style>
                            </h3>
                          </>
                        ) : (
                          <>
                            <div
                              onClick={!isRunning && !isStartingPreview ? start : undefined}
                              className={`w-20 h-20 mx-auto mb-6 flex items-center justify-center ${!isRunning && !isStartingPreview ? 'cursor-pointer group' : ''}`}
                            >
                              {/* Icon in Center - Play or Loading */}
                              {isStartingPreview ? (
                                <div
                                  className="w-16 h-16 border-4 rounded-full animate-spin"
                                  style={{
                                    borderTopColor: 'transparent',
                                    borderRightColor: '#000000',
                                    borderBottomColor: '#000000',
                                    borderLeftColor: '#000000',
                                  }}
                                />
                              ) : (
                                <MotionDiv
                                  className="flex items-center justify-center"
                                  whileHover={{ scale: 1.2 }}
                                  whileTap={{ scale: 0.9 }}
                                >
                                  <Play
                                    size={48}
                                    className="text-slate-700 dark:text-slate-300"
                                  />
                                </MotionDiv>
                              )}
                            </div>

                            <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-3">
                              Preview Not Running
                            </h3>
                            
                            <p className="text-slate-600 dark:text-slate-400 max-w-lg mx-auto">
                              Start your development server to see live changes
                            </p>
                          </>
                        )}
                      </MotionDiv>
                    </div>
                    )}
                    </div>
                  </div>
                )}
                  </MotionDiv>
                ) : (
              <MotionDiv
                key={showEmployeeStatus ? 'employee-status' : 'code'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex bg-white/10 dark:bg-black/5 "
              >
                {/* Employee Status Panel - shown when派工 tab is active */}
                {showEmployeeStatus ? (
                  <div className="flex-1 bg-white/5 dark:bg-white/5">
                    <EmployeeStatusPanel />
                  </div>
                ) : (
                <>
                {/* Left Sidebar - File Explorer (VS Code style) */}
                <div className={`${fileViewMode === 'grid' && sidebarTab === 'explorer' ? 'flex-1' : 'w-64 flex-shrink-0'} bg-white/5 dark:bg-white/5 border-r border-white/15 dark:border-white/[0.06] flex flex-col`}>
                  {/* Sidebar Tab Bar */}
                  <div className="flex items-center justify-between px-1 py-1 bg-white/15 dark:bg-white/5 border-b border-white/15 dark:border-white/[0.06]">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => setSidebarTab('explorer')}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                          sidebarTab === 'explorer'
                            ? 'bg-white/20 dark:bg-white/10 text-slate-800 dark:text-slate-200'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-white/15 dark:hover:bg-white/5'
                        }`}
                        title="文件资源管理器"
                      >
                        <Code size={12} />
                        <span>文件</span>
                      </button>
                      <button
                        onClick={() => setSidebarTab('scm')}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors relative ${
                          sidebarTab === 'scm'
                            ? 'bg-white/20 dark:bg-white/10 text-slate-800 dark:text-slate-200'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-white/15 dark:hover:bg-white/5'
                        }`}
                        title="源代码管理"
                      >
                        <GitBranch size={12} />
                        <span>SCM</span>
                        {((gitInfo?.stagedCount || 0) + (gitInfo?.unstagedCount || 0) + (gitInfo?.untrackedCount || 0)) > 0 && (
                          <span className="ml-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center">
                            {(gitInfo?.stagedCount || 0) + (gitInfo?.unstagedCount || 0) + (gitInfo?.untrackedCount || 0)}
                          </span>
                        )}
                      </button>
                    </div>
                    {/* Action buttons - only show for explorer tab */}
                    {sidebarTab === 'explorer' && (
                      <div className="flex items-center gap-0.5">
                        {fileViewMode === 'grid' && (workDirectory || projectPath) && (
                          <button
                            onClick={async () => {
                              const folderPath = workDirectory || projectPath;
                              if (typeof window !== 'undefined' && (window as any).desktopAPI?.openFolder) {
                                try {
                                  await (window as any).desktopAPI.openFolder(folderPath);
                                } catch (error) {
                                  console.error('Failed to open folder:', error);
                                }
                              }
                            }}
                            className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-white hover:bg-white/25 dark:hover:bg-white/15 rounded transition-colors"
                            title={`打开 ${workDirectory ? '工作区' : '项目'}目录`}
                          >
                            <FolderOpen size={12} />
                          </button>
                        )}
                      <button
                        onClick={() => {
                          setTreePromptDialog({
                            title: '新建文件夹名称:',
                            onConfirm: async (name) => {
                              if (!projectId) return;
                              try {
                                await fileOp(projectId, { action: 'mkdir', path: name });
                                loadTreeRef.current?.('.');
                              } catch (err: any) { alert('创建文件夹失败: ' + err.message); }
                              setTreePromptDialog(null);
                            }
                          });
                        }}
                        className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-white hover:bg-white/25 dark:hover:bg-white/15 rounded transition-colors"
                        title="新建文件夹"
                      >
                        <FolderPlus size={12} />
                      </button>
                      <button
                        onClick={() => {
                          setTreePromptDialog({
                            title: '新建文件名称:',
                            defaultValue: 'untitled.txt',
                            onConfirm: async (name) => {
                              if (!projectId) return;
                              try {
                                await fileOp(projectId, { action: 'createFile', path: name, content: '' });
                                loadTreeRef.current?.('.');
                              } catch (err: any) { alert('创建文件失败: ' + err.message); }
                              setTreePromptDialog(null);
                            }
                          });
                        }}
                        className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-white hover:bg-white/25 dark:hover:bg-white/15 rounded transition-colors"
                        title="新建文件"
                      >
                        <FilePlus size={12} />
                      </button>
                      <button
                        onClick={() => {
                          treeUploadDirRef.current = '.';
                          treeUploadRef.current?.click();
                        }}
                        className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-white hover:bg-white/25 dark:hover:bg-white/15 rounded transition-colors"
                        title="上传文件"
                      >
                        <Upload size={12} />
                      </button>
                      <button
                        onClick={() => setFileViewMode(fileViewMode === 'list' ? 'grid' : 'list')}
                        className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-white hover:bg-white/25 dark:hover:bg-white/15 rounded transition-colors"
                        title={fileViewMode === 'list' ? '切换到网格视图' : '切换到列表视图'}
                      >
                        {fileViewMode === 'list' ? <Grid size={12} /> : <List size={12} />}
                      </button>
                      <button
                        onClick={() => {
                          if (loadTreeRef.current) {
                            loadTreeRef.current('.');
                          }
                        }}
                        className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-white hover:bg-white/25 dark:hover:bg-white/15 rounded transition-colors"
                        title="刷新文件树"
                      >
                        <RefreshCw size={12} />
                      </button>
                    </div>
                    )}
                  </div>
                  <div ref={fileTreeContainerRef} className="flex-1 overflow-y-auto bg-white/5 dark:bg-white/5 custom-scrollbar relative">
                    {sidebarTab === 'scm' ? (
                      <SourceControlPanel
                        projectId={projectId}
                        gitInfo={gitInfo}
                        branches={gitBranches}
                        onGitStage={async (file, action) => {
                          try {
                            await fetch(`${API_BASE}/api/repo/${projectId}/git/stage`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ path: file.path, action }),
                            });
                            loadTreeRef.current?.('.');
                          } catch (err) {
                            console.error('Git stage failed:', err);
                          }
                        }}
                        onGitDiff={async (file, from, to) => {
                          try {
                            const params = new URLSearchParams();
                            params.set('path', file.path);
                            if (from) params.set('from', from);
                            if (to) params.set('to', to);
                            if (to === 'staged') params.set('staged', 'true');
                            params.set('fullContext', 'true');
                            const r = await fetch(`${API_BASE}/api/repo/${projectId}/git/diff?${params}`);
                            if (r.ok) {
                              const diff = await r.json();
                              setDiffViewState({ filePath: file.path, diff, from: from || 'HEAD', to: to || 'working' });
                            }
                          } catch (err) {
                            console.error('Git diff failed:', err);
                          }
                        }}
                        onGitCommit={async (message) => {
                          try {
                            await fetch(`${API_BASE}/api/repo/${projectId}/git/commit`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ message }),
                            });
                            loadTreeRef.current?.('.');
                          } catch (err) {
                            console.error('Git commit failed:', err);
                          }
                        }}
                        onGitPush={async () => {
                          try {
                            await fetch(`${API_BASE}/api/projects/${projectId}/github/push`, { method: 'POST' });
                          } catch (err) {
                            console.error('Git push failed:', err);
                          }
                        }}
                        onGitCheckout={async (branch) => {
                          try {
                            await fetch(`${API_BASE}/api/repo/${projectId}/git/checkout`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ branch }),
                            });
                            loadTreeRef.current?.('.');
                          } catch (err) {
                            console.error('Git checkout failed:', err);
                          }
                        }}
                        onRefresh={() => loadTreeRef.current?.('.')}
                        onFileClick={(filePath) => {
                          openFile(filePath);
                        }}
                      />
                    ) : !tree || tree.length === 0 ? (
                      <div className="px-3 py-8 text-center text-[11px] text-slate-600 dark:text-slate-400 select-none">
                        No files found
                      </div>
                    ) : fileViewMode === 'grid' ? (
                      <FileGridView
                        files={tree.map(entry => {
                          if (entry.type === 'dir') {
                            // Aggregate git status for directories
                            const dirPrefix = entry.path.endsWith('/') ? entry.path : entry.path + '/';
                            const childFiles = gitInfo?.files?.filter(f => f.path.startsWith(dirPrefix)) || [];
                            const dirChangedCount = childFiles.length;
                            // Pick highest-priority status: M > A > D > ? > R
                            const STATUS_PRIORITY: Record<string, number> = { 'M': 5, 'MM': 5, 'AM': 4, 'A': 4, 'D': 3, '?': 2, 'R': 1 };
                            let dirStatus: string | undefined;
                            let maxPriority = 0;
                            for (const f of childFiles) {
                              const p = STATUS_PRIORITY[f.status] || 0;
                              if (p > maxPriority) { maxPriority = p; dirStatus = f.status; }
                            }
                            return {
                              name: entry.path.split('/').pop() || entry.path,
                              path: entry.path,
                              type: 'directory' as const,
                              gitStatus: dirChangedCount > 0 ? (dirStatus as any) : undefined,
                              dirChangedCount: dirChangedCount > 0 ? dirChangedCount : undefined,
                            };
                          }
                          const gitFile = gitInfo?.files?.find(f => f.path === entry.path);
                          return {
                            name: entry.path.split('/').pop() || entry.path,
                            path: entry.path,
                            type: 'file' as const,
                            extension: entry.path.split('.').pop(),
                            gitStatus: gitFile?.status,
                          };
                        })}
                        projectId={projectId}
                        currentDir={currentPath}
                        gitInfo={gitInfo}
                        onFileClick={(file) => {
                          setFileViewMode('list');
                          openFile(file.path);
                        }}
                        onFolderClick={(folder) => {
                          setFileViewMode('list');
                          toggleFolder(folder.path);
                        }}
                        onRefresh={() => loadTreeRef.current?.('.')}
                        onGitStage={async (file, action) => {
                          try {
                            await fetch(`${API_BASE}/api/repo/${projectId}/git/stage`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ path: file.path, action }),
                            });
                            loadTreeRef.current?.('.');
                          } catch (err) {
                            console.error('Git stage failed:', err);
                          }
                        }}
                        onGitDiff={async (file, from, to) => {
                          try {
                            const params = new URLSearchParams();
                            params.set('path', file.path);
                            if (from) params.set('from', from);
                            if (to) params.set('to', to);
                            if (to === 'staged') params.set('staged', 'true');
                            params.set('fullContext', 'true');
                            const r = await fetch(`${API_BASE}/api/repo/${projectId}/git/diff?${params}`);
                            if (r.ok) {
                              const diff = await r.json();
                              setDiffViewState({ filePath: file.path, diff, from: from || 'HEAD', to: to || 'working' });
                            }
                          } catch (err) {
                            console.error('Git diff failed:', err);
                          }
                        }}
                      />
                    ) : (
                      <TreeView
                        entries={tree || []}
                        selectedFile={selectedFile}
                        expandedFolders={expandedFolders}
                        folderContents={folderContents}
                        onToggleFolder={toggleFolder}
                        onSelectFile={openFile}
                        onLoadFolder={handleLoadFolder}
                        level={0}
                        parentPath=""
                        getFileIcon={getFileIcon}
                        onContextMenu={handleTreeContextMenu}
                        renamingPath={treeRenamingPath}
                        onRenameConfirm={(entry, newName) => {
                          handleTreeRename({
                            name: entry.path.split('/').pop() || entry.path,
                            path: entry.path,
                            type: entry.type === 'dir' ? 'directory' : 'file',
                          }, newName);
                        }}
                        onRenameCancel={() => setTreeRenamingPath(null)}
                        gitInfo={gitInfo}
                      />
                    )}

                    {/* Tree context menu */}
                    {treeContextMenu && (
                      <ContextMenu
                        x={treeContextMenu.x}
                        y={treeContextMenu.y}
                        file={treeContextMenu.file}
                        containerRef={fileTreeContainerRef}
                        onClose={() => setTreeContextMenu(null)}
                        onRename={() => { setTreeRenamingPath(treeContextMenu.file.path); setTreeContextMenu(null); }}
                        onDelete={() => { setTreeDeleteTarget(treeContextMenu.file); setTreeContextMenu(null); }}
                        onCopy={() => { handleTreeCopy(treeContextMenu.file); setTreeContextMenu(null); }}
                        onMove={() => { handleTreeMove(treeContextMenu.file); setTreeContextMenu(null); }}
                        onNewFile={() => {
                          const dir = treeContextMenu.file.path;
                          setTreeContextMenu(null);
                          setTreePromptDialog({
                            title: `在 "${treeContextMenu.file.name}" 中新建文件:`,
                            defaultValue: 'untitled.txt',
                            onConfirm: async (name) => {
                              if (!projectId) return;
                              try {
                                await fileOp(projectId, { action: 'createFile', path: `${dir}/${name}`, content: '' });
                                loadTreeRef.current?.('.');
                              } catch (err: any) { alert('创建文件失败: ' + err.message); }
                              setTreePromptDialog(null);
                            }
                          });
                        }}
                        onNewFolder={() => {
                          const dir = treeContextMenu.file.path;
                          setTreeContextMenu(null);
                          setTreePromptDialog({
                            title: `在 "${treeContextMenu.file.name}" 中新建子文件夹:`,
                            onConfirm: async (name) => {
                              if (!projectId) return;
                              try {
                                await fileOp(projectId, { action: 'mkdir', path: `${dir}/${name}` });
                                loadTreeRef.current?.('.');
                              } catch (err: any) { alert('创建文件夹失败: ' + err.message); }
                              setTreePromptDialog(null);
                            }
                          });
                        }}
                        onUpload={() => {
                          treeUploadDirRef.current = treeContextMenu.file.path;
                          setTreeContextMenu(null);
                          treeUploadRef.current?.click();
                        }}
                        onAddToContext={projectId ? () => {
                          const f = treeContextMenu.file;
                          fetch(`/api/context-files`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ projectId, relativePath: f.path, name: f.name, size: f.size || 0 }),
                          }).catch(() => {});
                          setTreeContextMenu(null);
                        } : undefined}
                      />
                    )}
                    {treeDeleteTarget && (
                      <ConfirmDialog
                        message={`确定要删除 "${treeDeleteTarget.name}" 吗？${treeDeleteTarget.type === 'directory' ? '该文件夹及其所有内容将被永久删除。' : '此操作不可撤销。'}`}
                        onConfirm={handleTreeDelete}
                        onCancel={() => setTreeDeleteTarget(null)}
                      />
                    )}
                    {treePromptDialog && (
                      <PromptDialog
                        title={treePromptDialog.title}
                        defaultValue={treePromptDialog.defaultValue}
                        onConfirm={treePromptDialog.onConfirm}
                        onCancel={() => setTreePromptDialog(null)}
                      />
                    )}
                    <input
                      ref={treeUploadRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        if (!e.target.files?.length || !projectId) return;
                        try {
                          await uploadFiles(projectId, treeUploadDirRef.current, e.target.files);
                          loadTreeRef.current?.('.');
                        } catch (err: any) {
                          alert('上传失败: ' + err.message);
                        }
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>

                {/* Right Editor Area - Only show in list/scm mode */}
                {(fileViewMode === 'list' || sidebarTab === 'scm') && (
                  <div className="flex-1 flex flex-col bg-white/10 dark:bg-black/10 min-w-0">
                  {selectedFile ? (
                    <>
                      {/* File Tab */}
                      <div className="flex-shrink-0 bg-white/15 dark:bg-white/5 ">
                        <div className="flex items-center gap-3 bg-white/30 dark:bg-white/[0.08] px-3 py-1.5 border-t-2 border-t-blue-500 ">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-4 h-4 flex items-center justify-center">
                              {getFileIcon(tree.find(e => e.path === selectedFile) || { path: selectedFile, type: 'file' })}
                            </span>
                            <span className="truncate text-[13px] text-slate-700 dark:text-slate-300 " style={{ fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
                              {selectedFile.split('/').pop()}
                            </span>
                          </div>
                          {hasUnsavedChanges && (
                            <span className="text-[11px] text-amber-600 ">
                              • Unsaved changes
                            </span>
                          )}
                          {!hasUnsavedChanges && saveFeedback === 'success' && (
                            <span className="text-[11px] text-green-600 ">
                              Saved
                            </span>
                          )}
                          {saveFeedback === 'error' && (
                            <span
                              className="text-[11px] text-red-600 truncate max-w-[160px]"
                              title={saveError ?? 'Failed to save file'}
                            >
                              Save error
                            </span>
                          )}
                          {!hasUnsavedChanges && saveFeedback !== 'success' && isFileUpdating && (
                            <span className="text-[11px] text-green-600 ">
                              Updated
                            </span>
                          )}
                          <div className="ml-auto flex items-center gap-2">
                            {/* MD Preview Toggle - only show for markdown files */}
                            {getFilePreviewType(selectedFile) === 'markdown' && (
                              <div className="flex items-center bg-white/15 dark:bg-white/5 rounded-md p-0.5">
                                <button
                                  onClick={() => setMdPreviewMode('source')}
                                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                                    mdPreviewMode === 'source'
                                      ? 'bg-white/50 dark:bg-white/10 text-slate-800 dark:text-white shadow-sm'
                                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  源码
                                </button>
                                <button
                                  onClick={() => setMdPreviewMode('preview')}
                                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                                    mdPreviewMode === 'preview'
                                      ? 'bg-white/50 dark:bg-white/10 text-slate-800 dark:text-white shadow-sm'
                                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  预览
                                </button>
                              </div>
                            )}
                            {/* Save button - only show for editable files */}
                            {(getFilePreviewType(selectedFile) === 'code' ||
                              (getFilePreviewType(selectedFile) === 'markdown' && mdPreviewMode === 'source')) && (
                            <button
                              className="px-3 py-1 text-xs font-medium rounded btn-primary disabled:bg-white/25 dark:disabled:bg-white/15 disabled:text-slate-600 dark:disabled:text-slate-400 disabled:cursor-not-allowed "
                              onClick={handleSaveFile}
                              disabled={!hasUnsavedChanges || isSavingFile}
                              title="Save (Ctrl+S)"
                            >
                              {isSavingFile ? 'Saving…' : 'Save'}
                            </button>
                            )}
                            {/* Office document toolbar buttons */}
                            {(['word', 'excel', 'ppt'].includes(getFilePreviewType(selectedFile))) && officeToolbar && (
                              <>
                                {officeToolbar.isEditing ? (
                                  <>
                                    <button
                                      className="px-3 py-1 text-xs font-medium rounded bg-white/5 dark:bg-white/50 text-white hover:bg-slate-600 dark:hover:bg-slate-500"
                                      onClick={officeToolbar.onCancelEdit}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      className="px-3 py-1 text-xs font-medium rounded btn-primary disabled:bg-white/25 dark:disabled:bg-white/15 disabled:text-slate-600 dark:disabled:text-slate-400 disabled:cursor-not-allowed"
                                      onClick={officeToolbar.onSave}
                                      disabled={!officeToolbar.hasChanges || officeToolbar.saving}
                                    >
                                      {officeToolbar.saving ? 'Saving…' : 'Save'}
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {officeToolbar.onEdit && (
                                      <button
                                        className="px-3 py-1 text-xs font-medium rounded bg-white/5 dark:bg-white/50 text-white hover:bg-slate-600 dark:hover:bg-slate-500"
                                        onClick={officeToolbar.onEdit}
                                      >
                                        Edit
                                      </button>
                                    )}
                                    {/* Excel: show Save when cells have been edited (no explicit edit mode) */}
                                    {!officeToolbar.onEdit && officeToolbar.onSave && (
                                      <button
                                        className="px-3 py-1 text-xs font-medium rounded btn-primary disabled:bg-white/25 dark:disabled:bg-white/15 disabled:text-slate-600 dark:disabled:text-slate-400 disabled:cursor-not-allowed"
                                        onClick={officeToolbar.onSave}
                                        disabled={!officeToolbar.hasChanges || officeToolbar.saving}
                                      >
                                        {officeToolbar.saving ? 'Saving…' : 'Save'}
                                      </button>
                                    )}
                                  </>
                                )}
                                {officeToolbar.onDownload && (
                                  <button
                                    className="px-3 py-1 text-xs font-medium rounded bg-white/5 dark:bg-white/50 text-white hover:bg-slate-600 dark:hover:bg-slate-500"
                                    onClick={officeToolbar.onDownload}
                                  >
                                    Download
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              className="text-slate-700 dark:text-slate-300 hover:bg-white/25 dark:hover:bg-white/15 px-1 rounded"
                              onClick={() => {
                                if (hasUnsavedChanges) {
                                  const confirmClose =
                                    typeof window !== 'undefined'
                                      ? window.confirm('You have unsaved changes. Close without saving?')
                                      : true;
                                  if (!confirmClose) {
                                    return;
                                  }
                                }
                                setSelectedFile('');
                                setContent('');
                                setEditedContent('');
                                editedContentRef.current = '';
                                setHasUnsavedChanges(false);
                                setSaveFeedback('idle');
                                setSaveError(null);
                                setIsFileUpdating(false);
                                setOfficeToolbar(null);
                              }}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* File Content Area */}
                      <div className="flex-1 overflow-hidden">
                        {(() => {
                          const previewType = getFilePreviewType(selectedFile);

                          // Image Preview
                          if (previewType === 'image') {
                            return (
                              <div className="w-full h-full flex items-center justify-center bg-white/15 dark:bg-white/5 p-4">
                                <img
                                  src={`${API_BASE}/api/repo/${projectId}/file?path=${encodeURIComponent(selectedFile)}&raw=true`}
                                  alt={selectedFile.split('/').pop() || 'Image'}
                                  className="max-w-full max-h-full object-contain rounded shadow-lg"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                    target.parentElement!.innerHTML = '<div class="text-center text-slate-500 dark:text-slate-400"><p>Failed to load image</p></div>';
                                  }}
                                />
                              </div>
                            );
                          }

                          // Video Preview
                          if (previewType === 'video') {
                            return (
                              <div className="w-full h-full flex items-center justify-center bg-black p-4">
                                <video
                                  src={`${API_BASE}/api/repo/${projectId}/file?path=${encodeURIComponent(selectedFile)}&raw=true`}
                                  controls
                                  className="max-w-full max-h-full"
                                >
                                  Your browser does not support video playback.
                                </video>
                              </div>
                            );
                          }

                          // PDF Preview
                          if (previewType === 'pdf') {
                            return (
                              <div className="w-full h-full bg-white/20 dark:bg-white/10">
                                <embed
                                  src={`${API_BASE}/api/repo/${projectId}/file?path=${encodeURIComponent(selectedFile)}&raw=true`}
                                  type="application/pdf"
                                  className="w-full h-full"
                                />
                              </div>
                            );
                          }

                          // Word Preview
                          if (previewType === 'word') {
                            return <OfficeDocumentPreview projectId={projectId} filePath={selectedFile} type="word" onToolbarChange={setOfficeToolbar} />;
                          }

                          // Excel Preview
                          if (previewType === 'excel') {
                            return <OfficeDocumentPreview projectId={projectId} filePath={selectedFile} type="excel" onToolbarChange={setOfficeToolbar} />;
                          }

                          // PPT Preview
                          if (previewType === 'ppt') {
                            return <OfficeDocumentPreview projectId={projectId} filePath={selectedFile} type="ppt" onToolbarChange={setOfficeToolbar} />;
                          }

                          // Markdown Preview
                          if (previewType === 'markdown' && mdPreviewMode === 'preview') {
                            // Get directory of current file for resolving relative paths
                            const fileDir = selectedFile.includes('/')
                              ? selectedFile.substring(0, selectedFile.lastIndexOf('/'))
                              : '';

                            // Resolve relative path to API URL
                            const resolveMediaPath = (src: string | undefined): string => {
                              if (!src || typeof src !== 'string') return '';
                              if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
                                return src;
                              }
                              const mediaPath = src.startsWith('/')
                                ? src
                                : fileDir
                                  ? `${fileDir}/${src}`
                                  : src;
                              return `${API_BASE}/api/repo/${projectId}/file?path=${encodeURIComponent(mediaPath)}&raw=true`;
                            };

                            return (
                              <div className="w-full h-full overflow-auto bg-white/10 dark:bg-black/10 p-6">
                                <div className="max-w-3xl mx-auto prose prose-sm prose-slate dark:prose-invert prose-headings:font-semibold prose-a:text-blue-600 prose-code:bg-white/15 dark:prose-code:bg-white/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-white/15 dark:prose-pre:bg-white/5 prose-pre:text-slate-800 dark:prose-pre:text-slate-200">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    rehypePlugins={[rehypeRaw]}
                                    components={{
                                      img: ({ src, alt, ...props }) => (
                                        <img src={resolveMediaPath(src as string)} alt={alt || ''} {...props} className="max-w-full rounded" />
                                      ),
                                      video: ({ src, ...props }) => (
                                        <video src={resolveMediaPath(src as string)} controls {...props} className="max-w-full rounded" />
                                      ),
                                      audio: ({ src, ...props }) => (
                                        <audio src={resolveMediaPath(src as string)} controls {...props} className="w-full" />
                                      ),
                                      source: ({ src, ...props }) => (
                                        <source src={resolveMediaPath(src as string)} {...props} />
                                      ),
                                      a: ({ href, children, ...props }) => {
                                        // Check if link points to a local file (not http/https/mailto/tel)
                                        const isLocalFile = href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('#');
                                        const resolvedHref = isLocalFile ? resolveMediaPath(href) : href;
                                        return <a href={resolvedHref} {...props} target={isLocalFile ? '_blank' : undefined}>{children}</a>;
                                      },
                                    }}
                                  >
                                    {editedContent || ''}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            );
                          }

                          // Code Editor (default, also for markdown source mode)
                          return (
                            <div className="w-full h-full flex bg-white/10 dark:bg-black/10 overflow-hidden">
                              {/* Line Numbers */}
                              <div
                                ref={lineNumberRef}
                                className="bg-white/5 dark:bg-white/5 px-3 py-4 select-none flex-shrink-0 overflow-y-auto overflow-x-hidden custom-scrollbar pointer-events-none"
                                aria-hidden="true"
                              >
                                <div className="text-[13px] font-mono text-slate-500 dark:text-slate-400 leading-[19px]">
                                  {(editedContent || '').split('\n').map((_, index) => (
                                    <div key={index} className="text-right pr-2">
                                      {index + 1}
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {/* Code Content */}
                              <div className="relative flex-1">
                                <pre
                                  ref={highlightRef}
                                  aria-hidden="true"
                                  className="absolute inset-0 m-0 p-4 overflow-hidden text-[13px] leading-[19px] font-mono text-slate-800 dark:text-slate-200 whitespace-pre pointer-events-none"
                                  style={{ fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace" }}
                                >
                                  <code
                                    className={`language-${getFileLanguage(selectedFile)}`}
                                    dangerouslySetInnerHTML={{ __html: highlightedCode }}
                                  />
                                  <span className="block h-full min-h-[1px]" />
                                </pre>
                                <textarea
                                  ref={editorRef}
                                  value={editedContent}
                                  onChange={onEditorChange}
                                  onScroll={handleEditorScroll}
                                  onKeyDown={handleEditorKeyDown}
                                  spellCheck={false}
                                  autoCorrect="off"
                                  autoCapitalize="none"
                                  autoComplete="off"
                                  wrap="off"
                                  aria-label="Code editor"
                                  className="absolute inset-0 w-full h-full resize-none bg-transparent text-transparent caret-slate-800 dark:caret-white outline-none font-mono text-[13px] leading-[19px] p-4 whitespace-pre overflow-auto custom-scrollbar"
                                  style={{ fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace" }}
                                />
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </>
                  ) : (
                    /* Welcome Screen */
                    <div className="flex-1 flex items-center justify-center bg-white/10 dark:bg-black/10 ">
                      <div className="text-center">
                        <span className="w-16 h-16 mb-4 opacity-10 text-slate-400 dark:text-slate-500 mx-auto flex items-center justify-center"><Code size={64} /></span>
                        <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Welcome to Code Editor
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 ">
                          Select a file from the explorer to start viewing code
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                )}
                </>
                )}
              </MotionDiv>
                )}
                </AnimatePresence>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>
      </div>

      {/* Global Settings Modal */}
      <GlobalSettings
        isOpen={showGlobalSettings}
        onClose={() => setShowGlobalSettings(false)}
      />

      {/* Mobile Access QR Code Modal */}
      {showQRCode && mobileAccessUrl && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowQRCode(false)}
        >
          <div
            className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-xl p-6 shadow-2xl max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-slate-800 dark:text-white">手机打开，远程监工</h3>
              <button
                onClick={() => setShowQRCode(false)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:text-slate-400 transition-colors"
              >
                <XIcon size={20} />
              </button>
            </div>

            <div className="flex flex-col items-center gap-4">
              {lanIP === '127.0.0.1' || !lanIP ? (
                <div className="text-center py-8 px-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                    当前为本地地址，无法远程访问
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    请先前往<span className="font-medium text-slate-700 dark:text-slate-300">设置中心 → 基本设置</span>，开启远程访问服务
                  </p>
                </div>
              ) : (
                <>
                  <QRCodeSVG
                    value={mobileAccessUrl}
                    size={160}
                    level="M"
                    includeMargin={false}
                  />

                  <div className="text-center w-full">
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">用手机扫码，随时监工 AI 干活</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                      需先在<span className="text-slate-600 dark:text-slate-400">设置中心 → 基本设置</span>开启远程访问服务
                    </p>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(mobileAccessUrl);
                          alert('地址已复制');
                        } catch (error) {
                          console.error('Failed to copy:', error);
                        }
                      }}
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-300 transition-colors px-4 py-2 bg-white/5 dark:bg-white/5 hover:bg-white/15 dark:bg-white/5 rounded-lg w-full"
                      title={mobileAccessUrl}
                    >
                      {(() => {
                        const currentPort = typeof window !== 'undefined' ? window.location.port || '80' : '3000';
                        return `${lanIP}:${currentPort}`;
                      })()}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Git Diff Viewer Modal */}
      {diffViewState && (
        <DiffViewer
          projectId={projectId}
          filePath={diffViewState.filePath}
          diff={diffViewState.diff}
          from={diffViewState.from}
          to={diffViewState.to}
          onClose={() => setDiffViewState(null)}
        />
      )}
    </>
  );
}

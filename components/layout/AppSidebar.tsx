"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Settings, PanelLeftClose, PanelLeft, Rocket, FileText, FolderOpen, Table, Pin, X } from 'lucide-react';
import packageJson from '@/package.json';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

interface SkillDeployInfo {
  name: string;
  deployStatus?: string;
  deployPort?: number;
}

interface AppSidebarProps {
  currentPage: 'home' | 'templates' | 'apps' | 'employees' | 'skills' | 'help' | 'settings' | 'boss' | 'lan-chat';
  onNavigate?: (page: string) => void;
  projectsCount?: number;
  recentApps?: { id: string; name: string; color?: string; statusLabel?: string; status?: string; deployedUrl?: string; dependenciesInstalled?: boolean }[];
  theme?: string;
  mounted?: boolean;
  onToggleTheme?: () => void;
}

const defaultRecentApps: AppSidebarProps['recentApps'] = [
  { id: '1', name: '', color: '' },
];

export default function AppSidebar({
  currentPage,
  onNavigate,
  recentApps,
  theme,
  mounted: mountedProp,
  onToggleTheme,
}: AppSidebarProps) {
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [appVersion, setAppVersion] = useState(packageJson.version);
  const [skillsDeployInfo, setSkillsDeployInfo] = useState<SkillDeployInfo[]>([]);

  // Context files state
  interface CtxFile { id: string; name: string; absolutePath: string; mimeType: string; size: number; type: string; pinned: boolean; createdAt: string; exists?: boolean }
  const [contextFiles, setContextFiles] = useState<CtxFile[]>([]);

  const loadContextFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/context-files`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.files)) setContextFiles(data.files);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadContextFiles();
    const interval = setInterval(loadContextFiles, 15000);
    return () => clearInterval(interval);
  }, [loadContextFiles]);

  const handleDeleteCtx = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/api/context-files`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      setContextFiles((prev) => prev.filter((f) => f.id !== id));
    } catch { /* ignore */ }
  };

  const handlePinCtx = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/api/context-files`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      setContextFiles((prev) => {
        const updated = prev.map((f) => f.id === id ? { ...f, pinned: !f.pinned } : f);
        updated.sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        return updated;
      });
    } catch { /* ignore */ }
  };

  const handleOpenCtxFile = (file: CtxFile) => {
    if (!file.exists) return;
    const api = typeof window !== 'undefined' ? (window as any).desktopAPI : null;
    if (api?.openFolder) {
      api.openFolder(file.absolutePath);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatTimeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}天前`;
    return new Date(iso).toLocaleDateString('zh-CN');
  };

  // Fetch skills deploy status independently so all pages get consistent sidebar
  const loadSkillsDeployInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/skills`);
      if (res.ok) {
        const payload = await res.json();
        const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
        setSkillsDeployInfo(list.map((s: any) => ({
          name: s.name,
          deployStatus: s.deployStatus,
          deployPort: s.deployPort,
        })));
      }
    } catch {
      // Silently ignore — sidebar is non-critical
    }
  }, []);

  useEffect(() => {
    loadSkillsDeployInfo();
    // Refresh every 5s to pick up status changes (building → deployed)
    const interval = setInterval(loadSkillsDeployInfo, 5000);
    return () => clearInterval(interval);
  }, [loadSkillsDeployInfo]);

  // Enrich recentApps with skill deploy status
  const enrichedRecentApps = useMemo(() => {
    const apps = (recentApps && recentApps.length > 0 ? recentApps : defaultRecentApps) || [];
    return apps.slice(0, 5).map((app) => {
      let color = app.color || 'bg-gray-300';
      let statusLabel = app.statusLabel || '';

      if (app.id.startsWith('skill-')) {
        const skillName = app.id.replace(/^skill-/, '');
        const skill = skillsDeployInfo.find(s => s.name === skillName);
        if (skill?.deployStatus === 'deployed') {
          color = 'bg-green-400';
          statusLabel = '运行中';
        } else if (skill?.deployStatus === 'building') {
          color = 'bg-yellow-400';
          statusLabel = '启动中';
        } else if (skill?.deployStatus === 'build_failed') {
          color = 'bg-red-400';
          statusLabel = '失败';
        } else if (skill?.deployStatus === 'stopped') {
          color = 'bg-gray-400';
          statusLabel = '已停止';
        }
      } else if (app.status === 'running') {
        color = 'bg-green-400';
        statusLabel = '运行中';
      } else if (app.deployedUrl) {
        color = 'bg-green-400';
      } else if (app.dependenciesInstalled) {
        color = 'bg-blue-400';
      }

      return { ...app, color, statusLabel };
    });
  }, [recentApps, skillsDeployInfo]);


  useEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved !== null) {
      setIsCollapsed(saved === 'true');
    }
    if (typeof window !== 'undefined' && (window as any).desktopAPI?.getAppVersion) {
      const version = (window as any).desktopAPI.getAppVersion();
      if (version && version !== 'Unknown') {
        setAppVersion(version);
      }
    }
  }, []);

  const toggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', String(newState));
  };

  const handleNavigate = async (pageId: string) => {
    if (pageId === 'help') {
      const helpUrl = 'https://100agents.feishu.cn/wiki/H0XHwKUz0izSeGkhhzUcmhwZn7b';
      if (typeof window !== 'undefined' && (window as any).desktopAPI?.openExternal) {
        await (window as any).desktopAPI.openExternal(helpUrl);
      } else {
        window.open(helpUrl, '_blank');
      }
      return;
    }
    if (onNavigate) {
      onNavigate(pageId);
    } else {
      if (pageId === 'settings') {
        window.open('/settings', '_blank');
      } else if (pageId === 'boss') {
        router.push('/workspace?view=boss');
      } else if (pageId === 'home') {
        router.push('/workspace');
      } else if (pageId === 'apps') {
        router.push('/workspace?view=apps');
      } else if (pageId === 'templates') {
        router.push('/workspace?view=templates');
      } else if (pageId === 'skills') {
        window.open('/settings?tab=skills', '_blank');
      } else if (pageId === 'employees') {
        router.push('/workspace?view=employees');
      } else if (pageId === 'lan-chat') {
        router.push('/workspace?view=lan-chat');
      } else {
        router.push(`/workspace?view=${pageId}`);
      }
    }
  };

  // When collapsed, always w-20. When expanded, w-20 on small screens, w-64 on lg+.
  const showText = !isCollapsed; // text only visible when NOT collapsed (and lg+ via CSS)

  return (
    <aside className={`flex flex-col glass-card m-2 rounded-2xl h-[calc(100%-16px)] transition-all duration-300 ${
      isCollapsed ? 'w-20' : 'w-20 lg:w-64'
    }`}>
      {/* Logo area */}
      <div className="p-4 lg:p-5 flex items-center gap-3 border-b border-white/10 relative group">
        <div className="relative cursor-pointer" onClick={isCollapsed ? toggleCollapse : undefined}>
          <Image
            src="/resources/icon.png?2"
            alt="Logo"
            width={40}
            height={40}
            className="rounded-full shadow-sm border border-white"
            unoptimized
          />
          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border border-white" />
        </div>
        {showText && (
          <div className="hidden lg:flex flex-col overflow-hidden">
            <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">G.E.N.V.I.S</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">预览版v{appVersion}</p>
          </div>
        )}
        {/* Collapse toggle - visible on hover when expanded */}
        {!isCollapsed && (
          <button
            onClick={toggleCollapse}
            className="absolute top-6 right-2 p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-white/30 rounded-md transition-all opacity-0 group-hover:opacity-100 hidden lg:block"
            title="收起侧边栏"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
        {/* Expand toggle - visible when collapsed */}
        {isCollapsed && (
          <button
            onClick={toggleCollapse}
            className="absolute top-6 right-0 p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-white/30 rounded-md transition-all opacity-0 group-hover:opacity-100"
            title="展开侧边栏"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 lg:px-4 py-2 flex flex-col gap-1">
        {/* 最近应用 section */}
        {showText && (
          <>
            <div className="hidden lg:flex items-center justify-between mb-2 mt-4 px-2">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2 text-auto-contrast">
                <Rocket className="w-4 h-4 text-primary" />
                最近工作
              </h2>
              <span
                onClick={() => handleNavigate('apps')}
                className="text-xs font-medium text-primary cursor-pointer hover:underline"
              >
                更多
              </span>
            </div>
            <div className="hidden lg:flex flex-col gap-1">
              {enrichedRecentApps.map((app) => (
                <a
                  key={app.id}
                  className="flex items-center gap-3 px-3 py-1.5 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-white/20 dark:hover:bg-white/5 transition-all text-sm truncate cursor-pointer text-auto-contrast"
                  onClick={() => router.push(`/${app.id}/chat`)}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${app.color || 'bg-gray-300'} shrink-0`} />
                  <span className="truncate flex-1" title={app.name}>{app.name}</span>
                  {app.statusLabel && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 backdrop-blur-md text-auto-contrast ${
                      app.statusLabel === '运行中' ? 'text-green-800 bg-green-500/20' :
                      app.statusLabel === '启动中' ? 'text-yellow-800 bg-yellow-500/20' :
                      app.statusLabel === '失败' ? 'text-red-800 bg-red-500/20' :
                      'text-gray-800 bg-gray-500/20'
                    }`}>
                      {app.statusLabel}
                    </span>
                  )}
                </a>
              ))}
            </div>
          </>
        )}

        {/* 上下文 section */}
        {showText && (
          <>
            <div className="hidden lg:flex items-center justify-between mb-2 mt-6 px-2">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2 text-auto-contrast">
                <FolderOpen className="w-4 h-4 text-primary" />
                上下文
              </h2>
            </div>
            <div className="hidden lg:flex flex-col gap-1">
              {contextFiles.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 pl-3 py-2 text-auto-contrast">暂无文件记录</p>
              )}
              {contextFiles.map((file) => (
                <div
                  key={file.id}
                  onClick={() => handleOpenCtxFile(file)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all group/ctx relative text-auto-contrast ${
                    file.exists
                      ? 'text-slate-700 dark:text-slate-300 hover:bg-white/20 dark:hover:bg-white/5 cursor-pointer'
                      : 'text-slate-400 dark:text-slate-600 line-through cursor-default opacity-60'
                  }`}
                >
                  {file.pinned && <span className="absolute top-1 right-1 text-[8px] text-amber-500">📌</span>}
                  {file.type === 'pdf' ? (
                    <FileText className="w-[18px] h-[18px] text-red-500 shrink-0" />
                  ) : file.type === 'xlsx' || file.type === 'xls' ? (
                    <Table className="w-[18px] h-[18px] text-green-500 shrink-0" />
                  ) : file.type === 'doc' || file.type === 'docx' ? (
                    <FileText className="w-[18px] h-[18px] text-blue-500 shrink-0" />
                  ) : file.type === 'ppt' || file.type === 'pptx' ? (
                    <FileText className="w-[18px] h-[18px] text-orange-500 shrink-0" />
                  ) : file.type === 'md' ? (
                    <FileText className="w-[18px] h-[18px] text-purple-500 shrink-0" />
                  ) : (
                    <FileText className="w-[18px] h-[18px] text-gray-400 shrink-0" />
                  )}
                  <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                    <span className="text-sm font-medium truncate" title={file.name}>{file.name}</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{formatFileSize(file.size)} • {formatTimeAgo(file.createdAt)}</span>
                  </div>
                  {/* Hover actions */}
                  <div className="flex gap-0.5 opacity-0 group-hover/ctx:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={(e) => handlePinCtx(file.id, e)}
                      className={`p-1 rounded hover:bg-white/30 dark:hover:bg-white/10 ${file.pinned ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                      title={file.pinned ? '取消置顶' : '置顶'}
                    >
                      <Pin className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteCtx(file.id, e)}
                      className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-white/30 dark:hover:bg-white/10"
                      title="删除记录"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Settings & Theme */}
      <div className="p-3 lg:p-4 border-t border-white/10 mt-auto">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => handleNavigate('lan-chat')}
            title="局域网聊天"
            className={`flex items-center ${isCollapsed ? 'justify-center' : ''} gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group text-auto-contrast ${
              currentPage === 'lan-chat'
                ? 'bg-white/40 dark:bg-white/10 shadow-sm text-primary'
                : 'text-slate-700 dark:text-slate-300 hover:bg-white/20 dark:hover:bg-white/5'
            }`}
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            {showText && <span className="hidden lg:block">局域网聊天</span>}
          </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleNavigate('settings')}
            title="设置"
            className={`flex-1 flex items-center ${isCollapsed ? 'justify-center' : ''} gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group text-auto-contrast ${
              currentPage === 'settings'
                ? 'bg-white/40 dark:bg-white/10 shadow-sm text-primary'
                : 'text-slate-700 dark:text-slate-300 hover:bg-white/20 dark:hover:bg-white/5'
            }`}
          >
            <Settings className="w-5 h-5 group-hover:rotate-90 transition-transform shrink-0" />
            {showText && <span className="hidden lg:block">设置</span>}
          </button>
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              title={mountedProp ? (theme === 'light' ? '切换暗色模式' : theme === 'dark' ? '切换新春模式' : '切换亮色模式') : '切换主题'}
              className="p-2.5 rounded-xl text-sm font-medium transition-all text-slate-700 dark:text-slate-300 hover:bg-white/20 dark:hover:bg-white/5 shrink-0 text-auto-contrast"
            >
              <span className="text-base w-5 h-5 flex items-center justify-center">
                {mountedProp ? (theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🧧') : '☀️'}
              </span>
            </button>
          )}
        </div>
        </div>
      </div>
    </aside>
  );
}

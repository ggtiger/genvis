'use client';

import React, { useEffect, useState, useRef } from 'react';

type UpdaterEvent =
  | { type: 'update-available'; version: string; releaseNotes: string; releaseDate: string }
  | { type: 'update-not-available'; version: string }
  | { type: 'download-progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { type: 'update-downloaded'; version: string }
  | { type: 'error'; message: string };

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSpeed(bps: number) {
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}

export default function AboutTab() {
  const isDesktop = typeof window !== 'undefined' && !!(window as any).desktopAPI;
  const updaterAPI = isDesktop ? (window as any).desktopAPI?.updater : null;

  const [currentVersion, setCurrentVersion] = useState<string>('...');
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [newVersion, setNewVersion] = useState<string>('');
  const [releaseNotes, setReleaseNotes] = useState<string>('');
  const [progress, setProgress] = useState<{ percent: number; transferred: number; total: number; speed: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // 获取当前版本
    if (updaterAPI) {
      updaterAPI.getVersion().then((v: string) => setCurrentVersion(v)).catch(() => {
        const v = (window as any).desktopAPI?.getAppVersion?.() ?? 'Unknown';
        setCurrentVersion(v);
      });
      // 注册事件监听
      unsubRef.current = updaterAPI.onEvent((event: UpdaterEvent) => {
        switch (event.type) {
          case 'update-available':
            setStatus('available');
            setNewVersion(event.version);
            setReleaseNotes(event.releaseNotes || '');
            break;
          case 'update-not-available':
            setStatus('not-available');
            break;
          case 'download-progress':
            setStatus('downloading');
            setProgress({
              percent: event.percent,
              transferred: event.transferred,
              total: event.total,
              speed: event.bytesPerSecond,
            });
            break;
          case 'update-downloaded':
            setStatus('downloaded');
            setNewVersion(event.version);
            setProgress(null);
            break;
          case 'error':
            setStatus('error');
            setErrorMsg(event.message);
            break;
        }
      });
    } else {
      setCurrentVersion((window as any).desktopAPI?.getAppVersion?.() ?? 'Web 版本');
    }
    return () => {
      unsubRef.current?.();
    };
  }, []);

  async function handleCheck() {
    if (!updaterAPI) return;
    setStatus('checking');
    setErrorMsg('');
    setProgress(null);
    try {
      await updaterAPI.checkForUpdates();
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e?.message ?? '检查失败');
    }
  }

  async function handleDownload() {
    if (!updaterAPI) return;
    setStatus('downloading');
    try {
      await updaterAPI.downloadUpdate();
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e?.message ?? '下载失败');
    }
  }

  function handleInstall() {
    updaterAPI?.quitAndInstall();
  }

  const statusLabel: Record<UpdateStatus, string> = {
    idle: '',
    checking: '检查中...',
    available: `发现新版本 v${newVersion}`,
    'not-available': '已是最新版本',
    downloading: '下载中...',
    downloaded: `v${newVersion} 下载完成，可以安装`,
    error: `错误：${errorMsg}`,
  };

  const statusColor: Record<UpdateStatus, string> = {
    idle: '',
    checking: 'text-blue-500',
    available: 'text-emerald-600 dark:text-emerald-400',
    'not-available': 'text-slate-500',
    downloading: 'text-blue-500',
    downloaded: 'text-emerald-600 dark:text-emerald-400',
    error: 'text-red-500',
  };

  return (
    <div className="space-y-6 p-1">
      {/* 应用信息 */}
      <div className="flex items-center gap-4 p-5 bg-white/40 dark:bg-white/8 rounded-xl border border-gray-200/60 dark:border-white/15">
        <img src="/favicon-32.png" alt="Genvis" className="w-12 h-12 rounded-xl shadow" />
        <div>
          <div className="text-base font-semibold text-gray-900 dark:text-white">Genvis</div>
          <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            当前版本：<span className="font-mono font-medium text-slate-700 dark:text-slate-200">v{currentVersion}</span>
          </div>
        </div>
      </div>

      {/* 更新区域 */}
      {isDesktop && updaterAPI ? (
        <div className="p-5 bg-white/40 dark:bg-white/8 rounded-xl border border-gray-200/60 dark:border-white/15 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">应用更新</div>
              <div className="text-xs text-slate-500 mt-0.5">支持增量更新，只下载变化部分</div>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-2">
              {status === 'idle' || status === 'not-available' || status === 'error' ? (
                <button
                  onClick={handleCheck}
                  className="px-4 py-1.5 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
                >
                  检查更新
                </button>
              ) : status === 'checking' ? (
                <button disabled className="px-4 py-1.5 text-sm rounded-lg bg-slate-100 dark:bg-white/10 text-slate-400 cursor-not-allowed">
                  检查中...
                </button>
              ) : status === 'available' ? (
                <button
                  onClick={handleDownload}
                  className="px-4 py-1.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors font-medium"
                >
                  下载更新
                </button>
              ) : status === 'downloaded' ? (
                <button
                  onClick={handleInstall}
                  className="px-4 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors font-medium"
                >
                  立即安装
                </button>
              ) : null}
            </div>
          </div>

          {/* 状态提示 */}
          {status !== 'idle' && (
            <div className={`text-sm ${statusColor[status]}`}>
              {statusLabel[status]}
            </div>
          )}

          {/* 下载进度条 */}
          {status === 'downloading' && progress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{formatBytes(progress.transferred)} / {formatBytes(progress.total)}</span>
                <span>{formatSpeed(progress.speed)}</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-white/10 rounded-full h-2 overflow-hidden">
                <div
                  className="h-2 rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="text-xs text-slate-400 text-right">{progress.percent}%</div>
            </div>
          )}

          {/* 更新说明 */}
          {status === 'available' && releaseNotes && (
            <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-white/5 rounded-lg p-3 max-h-24 overflow-y-auto whitespace-pre-wrap">
              {releaseNotes}
            </div>
          )}
        </div>
      ) : (
        <div className="p-5 bg-white/40 dark:bg-white/8 rounded-xl border border-gray-200/60 dark:border-white/15">
          <div className="text-sm text-slate-500">在线升级仅在桌面客户端中可用。</div>
        </div>
      )}
    </div>
  );
}

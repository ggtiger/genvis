"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Square, RotateCcw, Play, Terminal, ChevronUp, ChevronDown, X, Copy, ExternalLink } from 'lucide-react';
import type { DeployStatus } from '@/lib/services/deploy-manager';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface LocalDeployPageProps {
  skillName: string;
  onClose: () => void;
  onCopyErrorToChat?: (errorMessage: string) => void;
}

export default function LocalDeployPage({ skillName, onClose, onCopyErrorToChat }: LocalDeployPageProps) {
  const [status, setStatus] = useState<DeployStatus>('not_deployed');
  const [port, setPort] = useState<number | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const [loading, setLoading] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}/deploy`);
      const data = await res.json();
      if (data.success) {
        const { local } = data.data;
        setStatus(local?.status ?? 'not_deployed');
        setPort(local?.port ?? null);
      }
    } catch { /* ignore */ }
  }, [skillName]);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}/deploy/logs`);
      const data = await res.json();
      if (data.success && data.data?.logs) { setLogs(data.data.logs); }
    } catch { /* ignore */ }
  }, [skillName]);

  useEffect(() => {
    (async () => { await refreshStatus(); await fetchLogs(); setLoading(false); })();
  }, [refreshStatus, fetchLogs]);

  useEffect(() => {
    if (status !== 'building') return;
    const interval = setInterval(refreshStatus, 3000);
    return () => clearInterval(interval);
  }, [status, refreshStatus]);

  useEffect(() => {
    if ((status !== 'building' && status !== 'deployed') || !showLogs) return;
    const interval = setInterval(fetchLogs, status === 'building' || deploying ? 1500 : 5000);
    return () => clearInterval(interval);
  }, [status, showLogs, deploying, fetchLogs]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleDeploy = async () => {
    setDeploying(true);
    setShowLogs(true);
    if (status === 'stopped') {
      setLogs(prev => [...prev, '[启动中...] 正在启动生产服务']);
    } else {
      setStatus('building');
      setLogs([]);
    }
    try {
      const action = status === 'stopped' ? 'start' : undefined;
      const res = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'local', ...(action && { action }) }),
      });
      await res.json();
    } catch { /* ignore */ }
    setDeploying(false);
    await refreshStatus();
    await fetchLogs();
  };

  const handleStop = async () => {
    setDeploying(true);
    try {
      await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}/deploy/stop`, { method: 'POST' });
    } catch { /* ignore */ }
    setDeploying(false);
    await refreshStatus();
  };

  const handleRedeploy = async () => {
    setDeploying(true);
    setStatus('building');
    setLogs([]);
    setShowLogs(true);
    try {
      await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}/deploy/redeploy`, { method: 'POST' });
    } catch { /* ignore */ }
    setDeploying(false);
    await refreshStatus();
    await fetchLogs();
  };

  const extractErrors = (): string => {
    const errorLines = logs.filter(
      l => l.includes('[ERROR]') || l.includes('error') || l.includes('Error') || l.includes('FAILED'),
    );
    return errorLines.length > 0 ? errorLines.slice(-20).join('\n') : logs.slice(-30).join('\n');
  };

  const handleCopyError = () => {
    const errorText = extractErrors();
    const guidance = `本地部署错误（技能：${skillName}）：\n\`\`\`\n${errorText}\n\`\`\`\n请分析以上错误日志并给出修复建议。`;
    onCopyErrorToChat?.(guidance);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400 dark:text-slate-500" />
      </div>
    );
  }

  const statusLabel: Record<DeployStatus, { text: string; color: string }> = {
    not_deployed: { text: '未部署', color: 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-400' },
    building: { text: '构建中...', color: 'bg-yellow-50 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' },
    deployed: { text: '运行中', color: 'bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-400' },
    build_failed: { text: '构建失败', color: 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-400' },
    stopped: { text: '已停止', color: 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-400' },
  };

  const badge = statusLabel[status];
  const btnSecondary = "flex items-center gap-1 px-2.5 py-1 text-xs text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-white/10 rounded-lg transition-colors disabled:opacity-50";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-white/10 bg-white/60 dark:bg-white/[0.12] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-gray-500 dark:text-slate-400" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">本地部署</h2>
          <span className="text-xs text-gray-500 dark:text-slate-500">({skillName})</span>
        </div>
        <button onClick={onClose} className="p-1 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-white rounded transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Status + Actions */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.06] bg-white/15 dark:bg-white/[0.03] flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${badge.color}`}>
            {status === 'building' && <Loader2 className="w-3 h-3 animate-spin" />}
            {badge.text}
            {status === 'deployed' && port && <span>(:{ port })</span>}
          </span>

          {(status === 'not_deployed' || status === 'stopped') && (
            <button onClick={handleDeploy} disabled={deploying}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-900 dark:bg-white/15 hover:bg-gray-800 dark:hover:bg-white/20 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50">
              <Play className="w-3 h-3" />
              {status === 'stopped' ? '启动' : '部署'}
            </button>
          )}

          {status === 'deployed' && (
            <>
              <button onClick={handleStop} disabled={deploying} className={btnSecondary}>
                <Square className="w-3 h-3" /> 停止
              </button>
              <button onClick={handleRedeploy} disabled={deploying} className={btnSecondary}>
                <RotateCcw className="w-3 h-3" /> 重新部署
              </button>
              {port && (
                <button
                  onClick={() => {
                    const url = `http://localhost:${port}`;
                    if (typeof window !== 'undefined' && (window as any).desktopAPI?.openExternal) {
                      (window as any).desktopAPI.openExternal(url);
                    } else { window.open(url, '_blank'); }
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 border border-blue-200 dark:border-blue-500/20 rounded-lg transition-colors">
                  <ExternalLink className="w-3 h-3" /> 打开
                </button>
              )}
            </>
          )}

          {status === 'build_failed' && (
            <>
              <button onClick={handleRedeploy} disabled={deploying} className={btnSecondary}>
                <RotateCcw className="w-3 h-3" /> 重试
              </button>
              {onCopyErrorToChat && (
                <button onClick={handleCopyError}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 border border-red-200 dark:border-red-500/20 rounded-lg transition-colors">
                  <Copy className="w-3 h-3" /> 复制错误到聊天框
                </button>
              )}
            </>
          )}

          <button
            onClick={() => { const next = !showLogs; setShowLogs(next); if (next) fetchLogs(); }}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-white transition-colors ml-auto">
            日志
            {showLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {status === 'build_failed' && onCopyErrorToChat && (
        <div className="mx-4 mt-2 flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 shadow-sm flex-shrink-0">
          <span className="text-xs truncate flex-1 min-w-0">构建失败，查看日志了解详情</span>
          <button className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 flex-shrink-0" onClick={handleCopyError}>
            复制到聊天框
          </button>
        </div>
      )}

      {/* Logs panel */}
      {showLogs && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-transparent flex-shrink-0">
            <span className="text-xs text-gray-700 dark:text-gray-400 font-medium">部署日志</span>
            {status === 'building' && (
              <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
                <Loader2 className="w-3 h-3 animate-spin" /> 构建中
              </span>
            )}
            {status === 'deployed' && <span className="text-xs text-green-600 dark:text-green-400">运行中</span>}
            {status === 'build_failed' && <span className="text-xs text-red-600 dark:text-red-400">构建失败</span>}
          </div>
          <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-transparent p-3 font-mono text-xs leading-5">
            {logs.length === 0 ? (
              <span className="text-gray-400 dark:text-slate-500">暂无日志</span>
            ) : (
              logs.map((line, i) => (
                <div key={i} className={`whitespace-pre-wrap break-all ${
                  line.includes('[ERROR]') || line.includes('error') || line.includes('Error')
                    ? 'text-red-600 dark:text-red-400' : line.includes('[DeployManager]') ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-300'
                }`}>{line}</div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {!showLogs && (
        <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-white/5">
          <p className="text-sm text-gray-400 dark:text-slate-500">展开日志查看部署详情</p>
        </div>
      )}
    </div>
  );
}

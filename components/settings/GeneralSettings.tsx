/**
 * General Settings Component
 * Project general settings tab
 */
import React, { useEffect, useMemo, useState } from 'react';
import { validateProjectName } from '@/lib/utils';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface GeneralSettingsProps {
  projectId: string;
  projectName: string;
  projectDescription?: string | null;
  onProjectUpdated?: (update: { name: string; description?: string | null }) => void;
}

type StatusMessage = { type: 'success' | 'error'; text: string } | null;

export function GeneralSettings({
  projectId,
  projectName,
  projectDescription = '',
  onProjectUpdated,
}: GeneralSettingsProps) {
  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState(projectDescription ?? '');
  const [originalName, setOriginalName] = useState(projectName);
  const [originalDescription, setOriginalDescription] = useState(projectDescription ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [absolutePath, setAbsolutePath] = useState<string>('');
  const [workDirectory, setWorkDirectory] = useState<string>('');
  const [projectMode, setProjectMode] = useState<string>('');
  const [projectType, setProjectType] = useState<string>('');

  // Fetch project data (including absolute path, mode, type, work_directory)
  useEffect(() => {
    if (!projectId || projectId === 'global-settings') return;

    const fetchProjectPath = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/projects/${projectId}`);
        if (response.ok) {
          const data = await response.json();
          setAbsolutePath(data?.data?.absolutePath || '');
          setProjectMode(data?.data?.mode || 'code');
          setProjectType(data?.data?.projectType || '');
          setWorkDirectory(data?.data?.work_directory || '');
        }
      } catch (error) {
        console.error('Failed to fetch project path:', error);
      }
    };

    fetchProjectPath();
  }, [projectId]);

  useEffect(() => {
    setName(projectName);
    setOriginalName(projectName);
  }, [projectName]);

  useEffect(() => {
    const nextDescription = projectDescription ?? '';
    setDescription(nextDescription);
    setOriginalDescription(nextDescription);
  }, [projectDescription]);

  useEffect(() => {
    if (status?.type === 'success') {
      const timeout = window.setTimeout(() => setStatus(null), 3000);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [status]);

  const normalizedName = useMemo(() => name.trim(), [name]);
  const normalizedDescription = useMemo(() => description.trim(), [description]);
  const normalizedOriginalName = useMemo(() => originalName.trim(), [originalName]);
  const normalizedOriginalDescription = useMemo(
    () => (originalDescription ?? '').trim(),
    [originalDescription]
  );

  const isProjectScoped = Boolean(projectId && projectId !== 'global-settings');
  const isDirty =
    normalizedName !== normalizedOriginalName ||
    normalizedDescription !== normalizedOriginalDescription;
  const isSaveDisabled =
    !isProjectScoped ||
    isSaving ||
    !normalizedName ||
    !validateProjectName(normalizedName) ||
    !isDirty;

  const copyTextSafe = async (text: string): Promise<boolean> => {
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function' &&
        (typeof document === 'undefined' || document.hasFocus())
      ) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      throw new Error('clipboard_unavailable');
    } catch {
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('readonly', '');
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        if (!ok) throw new Error('exec_command_failed');
        return true;
      } catch {
        return false;
      }
    }
  };

  const handleSave = async () => {
    if (isSaveDisabled) return;
    setIsSaving(true);
    setStatus(null);

    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: normalizedName,
          description: normalizedDescription || null,
        }),
      });

      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message =
          payload?.error ||
          payload?.message ||
          payload?.detail ||
          'Failed to update project settings.';
        throw new Error(message);
      }

      const updated = payload?.data ?? payload ?? {};
      const updatedName =
        typeof updated.name === 'string' && updated.name.trim()
          ? updated.name.trim()
          : normalizedName;
      const updatedDescriptionRaw =
        typeof updated.description === 'string' ? updated.description : normalizedDescription;
      const updatedDescription = (updatedDescriptionRaw ?? '').trim();

      setName(updatedName);
      setDescription(updatedDescription);
      setOriginalName(updatedName);
      setOriginalDescription(updatedDescription);
      onProjectUpdated?.({
        name: updatedName,
        description: updatedDescription || null,
      });

      setStatus({ type: 'success', text: '保存成功' });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : '保存失败';
      setStatus({ type: 'error', text: message });
    } finally {
      setIsSaving(false);
    }
  };

  const nameError =
    normalizedName && !validateProjectName(normalizedName)
      ? '支持中文、英文、数字、空格、连字符、下划线，1-50字符'
      : null;

  const handleExport = async () => {
    if (!isProjectScoped || isExporting) return;
    setIsExporting(true);
    setStatus(null);

    try {
      const params = new URLSearchParams();
      if (normalizedName) params.set('name', normalizedName);
      if (normalizedDescription) params.set('description', normalizedDescription);

      const response = await fetch(
        `${API_BASE}/api/projects/${projectId}/export?${params.toString()}`
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Export failed');
      }

      // Download the zip file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${normalizedName || projectId}-template.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setStatus({ type: 'success', text: '模板导出成功' });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : '导出失败';
      setStatus({ type: 'error', text: message });
    } finally {
      setIsExporting(false);
    }
  };

  const inputClass = "w-full rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-white/20 placeholder:text-gray-400 dark:placeholder:text-slate-500";
  const disabledInputClass = "w-full cursor-not-allowed rounded-lg border border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] px-3 py-2 text-gray-500 dark:text-slate-400";
  const labelClass = "mb-2 block text-sm font-medium text-gray-700 dark:text-slate-300";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">基本设置</h3>

        {!isProjectScoped ? (
          <div className="rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-3 text-sm text-gray-600 dark:text-slate-400">
            请选择一个项目以编辑设置
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <label className={labelClass}>项目名称</label>
              <input
                type="text"
                value={name}
                onChange={event => {
                  setName(event.target.value);
                  if (status?.type) setStatus(null);
                }}
                className={inputClass}
                placeholder="输入项目名称"
              />
              {nameError && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                  {nameError}
                </p>
              )}
            </div>

            <div>
              <label className={labelClass}>项目 ID</label>
              <input
                type="text"
                value={projectId}
                disabled
                className={disabledInputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>项目模式</label>
                <input
                  type="text"
                  value={projectMode === 'work' ? 'Work (文件操作)' : projectMode === 'code' ? 'Code (开发)' : projectMode}
                  disabled
                  className={disabledInputClass}
                />
              </div>
              <div>
                <label className={labelClass}>项目类型</label>
                <input
                  type="text"
                  value={projectType === 'nextjs' ? 'Next.js' : projectType === 'python-fastapi' ? 'Python FastAPI' : projectType}
                  disabled
                  className={disabledInputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>项目路径</label>
              <div className="relative">
                <input
                  type="text"
                  value={absolutePath}
                  disabled
                  className={`${disabledInputClass} font-mono text-xs`}
                  title={absolutePath}
                />
                {absolutePath && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-gray-50 dark:bg-slate-800 pl-2">
                    <button
                      onClick={async () => {
                        if (typeof window !== 'undefined' && (window as any).desktopAPI?.openFolder) {
                          try {
                            await (window as any).desktopAPI.openFolder(absolutePath);
                          } catch (error) {
                            console.error('Failed to open folder:', error);
                            setStatus({ type: 'error', text: '打开失败' });
                          }
                        }
                      }}
                      className="px-2 py-1 text-xs text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 rounded transition-colors"
                      title="在资源管理器中打开"
                    >
                      打开
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await copyTextSafe(absolutePath);
                        setStatus(
                          ok
                            ? { type: 'success', text: '路径已复制' }
                            : { type: 'error', text: '复制失败' }
                        );
                      }}
                      className="px-2 py-1 text-xs text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 rounded transition-colors"
                      title="复制路径"
                    >
                      复制
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                系统分配的项目目录
              </p>
            </div>

            {/* Work mode: show work directory */}
            {projectMode === 'work' && (
              <div>
                <label className={labelClass}>工作区目录</label>
                <div className="relative">
                  <input
                    type="text"
                    value={workDirectory}
                    disabled
                    className={`${disabledInputClass} font-mono text-xs`}
                    title={workDirectory}
                  />
                  {workDirectory && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-gray-50 dark:bg-slate-800 pl-2">
                      <button
                        onClick={async () => {
                          if (typeof window !== 'undefined' && (window as any).desktopAPI?.openFolder) {
                            try {
                              await (window as any).desktopAPI.openFolder(workDirectory);
                            } catch (error) {
                              console.error('Failed to open folder:', error);
                              setStatus({ type: 'error', text: '打开失败' });
                            }
                          }
                        }}
                        className="px-2 py-1 text-xs text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 rounded transition-colors"
                        title="在资源管理器中打开"
                      >
                        打开
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await copyTextSafe(workDirectory);
                          setStatus(
                            ok
                              ? { type: 'success', text: '路径已复制' }
                              : { type: 'error', text: '复制失败' }
                          );
                        }}
                        className="px-2 py-1 text-xs text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 rounded transition-colors"
                        title="复制路径"
                      >
                        复制
                      </button>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                  所有文件操作将在此目录内进行
                </p>
              </div>
            )}

            <div>
              <label className={labelClass}>项目描述</label>
              <textarea
                value={description}
                onChange={event => {
                  setDescription(event.target.value);
                  if (status?.type) setStatus(null);
                }}
                rows={4}
                className={inputClass}
                placeholder="描述你的项目..."
              />
            </div>

            {status && (
              <div
                className={`rounded-lg px-4 py-3 text-sm ${
                  status.type === 'success'
                    ? 'border border-green-200 dark:border-green-500/20 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
                }`}
              >
                {status.text}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={handleExport}
                disabled={!isProjectScoped || isExporting}
                className="rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 px-4 py-2 text-gray-700 dark:text-slate-300 transition-colors hover:bg-gray-50 dark:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExporting ? '导出中...' : '导出为模板'}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaveDisabled}
                className="rounded-lg border border-gray-300 dark:border-white/10 bg-gray-900 dark:bg-white/15 px-4 py-2 text-white transition-colors hover:bg-gray-800 dark:hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

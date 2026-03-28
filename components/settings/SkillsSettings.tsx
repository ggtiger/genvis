"use client";

import { useState, useEffect, useCallback, memo } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, AlertTriangle, X, Store, Folder } from 'lucide-react';
import SkillDetailPanel from '@/components/skills/SkillDetailPanel';
import SkillMarketPanel from '@/components/skills/SkillMarketPanel';
import { useToast } from '@/contexts/ToastContext';
import type { SkillMeta } from '@/lib/services/skill-service';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

// Memoized skill card component to prevent unnecessary re-renders
interface SkillCardProps {
  skill: SkillMeta & { enabled?: boolean; hasUnfilledRequiredVars?: boolean };
  onClick: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onRun: () => void;
}

const SkillCard = memo(({ skill, onClick, onToggleEnabled, onRun }: SkillCardProps) => {
  const handleToggleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleEnabled(!skill.enabled);
  }, [skill.enabled, onToggleEnabled]);

  const handleRunClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRun();
  }, [onRun]);

  return (
    <div
      className={`glass-card rounded-2xl p-4 group cursor-pointer ${!skill.enabled ? 'opacity-60' : ''}`}
      onClick={onClick}
    >
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-gray-900 dark:text-white text-base truncate">
            {skill.displayName || skill.name}
          </h3>
          <span className={`text-xs px-2 py-0.5 rounded ${
            skill.source === 'builtin' ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-white/50 dark:bg-white/10 text-gray-600 dark:text-gray-300'
          }`}>
            {skill.source === 'builtin' ? '内置' : '导入'}
          </span>
          {skill.hasSkill && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-50 dark:bg-green-500/20 text-green-600 dark:text-green-400">Skills</span>
          )}
          {skill.hasApp && (
            <span className="text-xs px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">App</span>
          )}
          {skill.deployStatus === 'deployed' && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-50 dark:bg-green-500/20 text-green-700 dark:text-green-400 font-medium">
              已部署{skill.deployPort ? ` :${skill.deployPort}` : ''}
            </span>
          )}
          {skill.deployStatus === 'building' && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-50 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 font-medium">构建中</span>
          )}
          {skill.deployStatus === 'stopped' && (
            <span className="text-xs px-2 py-0.5 rounded bg-white/50 dark:bg-white/10 text-gray-600 dark:text-gray-300 font-medium">已停止</span>
          )}
          {skill.deployStatus === 'build_failed' && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-50 dark:bg-red-500/20 text-red-600 dark:text-red-400 font-medium">构建失败</span>
          )}
        </div>
        {skill.description && (
          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-2">{skill.description}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          {skill.author && (<><span>作者: {skill.author}</span><span>·</span></>)}
          {skill.version && (<><span>v{skill.version}</span><span>·</span></>)}
          <span>大小: {formatSize(skill.size)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {skill.hasUnfilledRequiredVars && (
          <span className="relative group/warning cursor-help" title="有必填的环境变量未配置">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          </span>
        )}
        {skill.hasSkill && (
          <button
            onClick={handleToggleClick}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              skill.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}
            title={skill.enabled ? '点击禁用' : '点击启用'}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              skill.enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        )}
        <button
          onClick={onClick}
          className="px-3 py-1.5 bg-white/50 dark:bg-white/10 hover:bg-white/60 dark:hover:bg-white/15 text-gray-700 dark:text-gray-200 text-sm font-medium rounded transition-colors"
        >
          设置
        </button>
        {skill.hasApp && skill.deployStatus !== 'deployed' && skill.deployStatus !== 'building' && (
          <button
            onClick={handleRunClick}
            className="px-3 py-1.5 bg-gray-900 dark:bg-white/15 hover:bg-gray-800 dark:hover:bg-white/20 text-white dark:text-gray-100 text-sm font-medium rounded transition-all opacity-0 group-hover:opacity-100"
          >
            运行
          </button>
        )}
      </div>
    </div>
  );
});

SkillCard.displayName = 'SkillCard';

export default function SkillsSettings() {
  const router = useRouter();
  const toast = useToast();
  const [skills, setSkills] = useState<(SkillMeta & { enabled?: boolean; hasUnfilledRequiredVars?: boolean })[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true); // Start with loading state
  const [initialLoad, setInitialLoad] = useState(true); // Track first load
  const [importing, setImporting] = useState(false);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [skillFilter, setSkillFilter] = useState<'all' | 'app' | 'skill'>('all');
  const [activeTab, setActiveTab] = useState<'my-skills' | 'market'>('my-skills');
  const [thirdPartyOpen, setThirdPartyOpen] = useState(false);
  const [thirdPartyUrl, setThirdPartyUrl] = useState('');
  const [thirdPartyLoading, setThirdPartyLoading] = useState(false);
  const [thirdPartyProgress, setThirdPartyProgress] = useState('');
  const [thirdPartyError, setThirdPartyError] = useState('');
  const [thirdPartyMode, setThirdPartyMode] = useState<'url' | 'file'>('file');

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/skills`);
      if (response.ok) {
        const data = await response.json();
        const skillsData = data.data || [];
        // 先立即渲染列表（不等env检查）
        setSkills(skillsData.map((s: SkillMeta) => ({ ...s, hasUnfilledRequiredVars: false })));

        // 延迟检查环境变量（不阻塞首屏）
        const skillsNeedCheck = skillsData.filter((s: SkillMeta) => s.envVars?.some(v => v.required));
        if (skillsNeedCheck.length > 0) {
          const envResults = await Promise.all(
            skillsNeedCheck.map(async (skill: SkillMeta) => {
              try {
                const envResponse = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skill.name)}/env`);
                const envData = await envResponse.json();
                const envValues = envData.success ? envData.data : {};
                const missingVars = (skill.envVars?.filter(v => v.required) || []).filter(v => !envValues[v.key]);
                return { name: skill.name, hasUnfilledRequiredVars: missingVars.length > 0 };
              } catch {
                return { name: skill.name, hasUnfilledRequiredVars: true };
              }
            })
          );
          const envMap = new Map(envResults.map(r => [r.name, r.hasUnfilledRequiredVars]));
          setSkills(prev => prev.map(s => ({
            ...s,
            hasUnfilledRequiredVars: envMap.get(s.name) ?? false,
          })));
        }
      }
    } catch (error) {
      console.error('Failed to load skills:', error);
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const deleteSkill = async (skillName: string) => {
    if (!confirm(`确定要删除技能 "${skillName}" 吗？`)) return;
    try {
      const response = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}`, { method: 'DELETE' });
      if (response.ok) {
        setSkills(prev => prev.filter(s => s.name !== skillName));
        toast.success('已删除');
      } else {
        const data = await response.json();
        toast.error(data.error || '删除失败');
      }
    } catch {
      toast.error('删除失败');
    }
  };

  const toggleSkillEnabled = async (skillName: string, enabled: boolean) => {
    if (enabled) {
      const skill = skills.find(s => s.name === skillName);
      const requiredEnvVars = skill?.envVars?.filter(v => v.required) || [];
      if (requiredEnvVars.length > 0) {
        try {
          const response = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}/env`);
          const data = await response.json();
          const envValues = data.success ? data.data : {};
          const missingVars = requiredEnvVars.filter(v => !envValues[v.key]);
          if (missingVars.length > 0) {
            toast.warning(`请先设置必填环境变量: ${missingVars.map(v => v.label || v.key).join(', ')}`);
            setSelectedSkillName(skillName);
            return;
          }
        } catch {
          // ignore
        }
      }
    }
    try {
      const response = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (response.ok) {
        setSkills(prev => prev.map(s => s.name === skillName ? { ...s, enabled } : s));
        toast.success(enabled ? '已启用' : '已禁用');
      } else {
        const data = await response.json();
        toast.error(data.error || '操作失败');
      }
    } catch {
      toast.error('操作失败');
    }
  };

  const handleRunSkill = async (skillName: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}/run`, { method: 'POST' });
      const data = await response.json();
      if (data.success && data.data?.projectId) {
        router.push(`/${data.data.projectId}/chat`);
      } else {
        toast.error(data.error || '运行失败');
      }
    } catch {
      toast.error('运行失败');
    }
  };

  const handleForkSkill = async (skillName: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}/fork`, { method: 'POST' });
      const data = await response.json();
      if (data.success && data.data?.projectId) {
        router.push(`/${data.data.projectId}/chat`);
      } else {
        toast.error(data.error || '二开失败');
      }
    } catch {
      toast.error('二开失败');
    }
  };

  const importSkillFromFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    if (!file.name.endsWith('.zip')) {
      toast.error('只支持 .zip 格式文件');
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${API_BASE}/api/skills/import`, { method: 'POST', body: formData });
      const data = await response.json();
      if (response.ok) {
        toast.success('导入成功');
        await loadSkills();
      } else {
        toast.error(data.error || '导入失败');
      }
    } catch {
      toast.error('导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleThirdPartyImport = async () => {
    if (!thirdPartyUrl.trim()) return;
    setThirdPartyLoading(true);
    setThirdPartyError('');
    setThirdPartyProgress('正在导入...');
    try {
      const response = await fetch(`${API_BASE}/api/skills/import-third-party`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: thirdPartyUrl.trim() }),
      });
      const data = await response.json();
      if (data.success) {
        setThirdPartyOpen(false);
        setThirdPartyUrl('');
        setThirdPartyProgress('');
        toast.success('第三方 Skill 导入成功');
        await loadSkills();
      } else {
        setThirdPartyError(data.error || '导入失败');
        setThirdPartyProgress('');
      }
    } catch {
      setThirdPartyError('网络错误，请重试');
      setThirdPartyProgress('');
    } finally {
      setThirdPartyLoading(false);
    }
  };

  const handleThirdPartyFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    if (!file.name.endsWith('.zip')) {
      setThirdPartyError('只支持 .zip 格式文件');
      return;
    }
    setThirdPartyLoading(true);
    setThirdPartyError('');
    setThirdPartyProgress('正在上传并转换...');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${API_BASE}/api/skills/import-third-party`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        setThirdPartyOpen(false);
        setThirdPartyProgress('');
        toast.success('第三方 Skill 导入成功');
        await loadSkills();
      } else {
        setThirdPartyError(data.error || '导入失败');
        setThirdPartyProgress('');
      }
    } catch {
      setThirdPartyError('网络错误，请重试');
      setThirdPartyProgress('');
    } finally {
      setThirdPartyLoading(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        {/* Tab Navigation */}
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 pb-3">
          <button
            onClick={() => setActiveTab('my-skills')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'my-skills'
                ? 'bg-gray-900 dark:bg-white/20 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Folder className="w-4 h-4" />
            我的技能
          </button>
          <button
            onClick={() => setActiveTab('market')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'market'
                ? 'bg-gray-900 dark:bg-white/20 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Store className="w-4 h-4" />
            技能市场
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'market' ? (
          <SkillMarketPanel
            installedSkillNames={skills.map(s => s.name)}
            onSkillInstalled={loadSkills}
          />
        ) : (
          <>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">我的技能</h3>
          <div className="flex items-center gap-2">
            {skills.length > 0 && (
              <>
                {([
                  { key: 'all' as const, label: '全部' },
                  { key: 'app' as const, label: 'App' },
                  { key: 'skill' as const, label: 'Skills' },
                ] as const).map(({ key, label }) => {
                  const count = key === 'all'
                    ? skills.length
                    : key === 'app'
                    ? skills.filter(s => s.hasApp).length
                    : skills.filter(s => s.hasSkill).length;
                  const isActive = skillFilter === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setSkillFilter(key)}
                      className={`px-3 py-1 text-sm rounded-full transition-colors ${
                        isActive
                          ? 'bg-white/40 dark:bg-white/10 text-gray-900 dark:text-white font-medium shadow-sm'
                          : 'bg-white/20 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-white/30 dark:hover:bg-white/10'
                      }`}
                    >
                      {label}({count})
                    </button>
                  );
                })}
              </>
            )}
            <input
              type="file"
              id="skill-import-input-settings"
              accept=".zip"
              onChange={importSkillFromFile}
              className="hidden"
              disabled={importing}
            />
            <label
              htmlFor="skill-import-input-settings"
              className={`px-4 py-2 ${
                importing ? 'bg-gray-400 dark:bg-gray-500 cursor-not-allowed' : 'bg-gray-900 dark:bg-white/20 hover:bg-gray-800 dark:hover:bg-white/25 cursor-pointer'
              } text-white text-sm font-medium rounded-lg transition-colors inline-block`}
            >
              {importing ? '导入中...' : '导入技能'}
            </label>
            <button
              onClick={() => { setThirdPartyOpen(true); setThirdPartyError(''); setThirdPartyProgress(''); }}
              className="px-4 py-2 bg-gray-900 dark:bg-white/20 hover:bg-gray-800 dark:hover:bg-white/25 text-white text-sm font-medium rounded-lg transition-colors"
            >
              导入第三方
            </button>
          </div>
        </div>

        {/* Skills List */}
        {skillsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500 dark:text-gray-400">加载中...</div>
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-white/50 dark:bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-gray-500 dark:text-gray-400">暂无技能</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">导入技能包或将内置技能放入 skills 目录</p>
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
            {skills
              .filter((skill) => {
                if (skillFilter === 'all') return true;
                if (skillFilter === 'app') return skill.hasApp;
                if (skillFilter === 'skill') return skill.hasSkill;
                return true;
              })
              .map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  onClick={() => setSelectedSkillName(skill.name)}
                  onToggleEnabled={(enabled) => toggleSkillEnabled(skill.name, enabled)}
                  onRun={() => handleRunSkill(skill.name)}
                />
              ))}
          </div>
        )}
          </>
        )}
      </div>

      <SkillDetailPanel
        open={!!selectedSkillName}
        skillName={selectedSkillName}
        onClose={() => setSelectedSkillName(null)}
        onEnvSaved={() => loadSkills()}
        onRunSkill={handleRunSkill}
        onForkSkill={handleForkSkill}
        onDeleteSkill={deleteSkill}
      />

      {/* Third-Party Import Dialog */}
      {thirdPartyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !thirdPartyLoading && setThirdPartyOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">导入第三方 Skill</h3>
              <button
                onClick={() => !thirdPartyLoading && setThirdPartyOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Mode Toggle */}
            <div className="flex gap-2 mb-4">
              {([
                { key: 'file' as const, label: '上传压缩包' },
                { key: 'url' as const, label: '输入 URL' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setThirdPartyMode(key); setThirdPartyError(''); }}
                  disabled={thirdPartyLoading}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                    thirdPartyMode === key
                      ? 'bg-gray-900 dark:bg-white/20 text-white font-medium'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  } disabled:opacity-50`}
                >
                  {label}
                </button>
              ))}
            </div>
            {thirdPartyMode === 'file' ? (
              <>
                <input
                  type="file"
                  id="third-party-file-input"
                  accept=".zip"
                  onChange={handleThirdPartyFileImport}
                  className="hidden"
                  disabled={thirdPartyLoading}
                />
                <label
                  htmlFor="third-party-file-input"
                  className={`flex items-center justify-center w-full px-4 py-8 border-2 border-dashed rounded-lg transition-colors ${
                    thirdPartyLoading
                      ? 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 cursor-not-allowed opacity-50'
                      : 'border-gray-300 dark:border-gray-500 bg-gray-50 dark:bg-gray-700/50 hover:border-gray-400 dark:hover:border-gray-400 cursor-pointer'
                  }`}
                >
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {thirdPartyLoading ? '处理中...' : '点击选择 .zip 文件，或将文件拖入此处'}
                  </span>
                </label>
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  支持从 ClawHub 等平台导出的 skill 压缩包（包含 SKILL.md 或 openclaw.yaml）
                </p>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={thirdPartyUrl}
                  onChange={(e) => setThirdPartyUrl(e.target.value)}
                  placeholder="输入 ClawHub skill URL"
                  disabled={thirdPartyLoading}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  onKeyDown={(e) => e.key === 'Enter' && !thirdPartyLoading && handleThirdPartyImport()}
                />
              </>
            )}
            {thirdPartyProgress && (
              <p className="mt-3 text-sm text-blue-600 dark:text-blue-400">{thirdPartyProgress}</p>
            )}
            {thirdPartyError && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{thirdPartyError}</p>
            )}
            {thirdPartyMode === 'url' && (
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => { setThirdPartyOpen(false); setThirdPartyUrl(''); setThirdPartyError(''); }}
                  disabled={thirdPartyLoading}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleThirdPartyImport}
                  disabled={thirdPartyLoading || !thirdPartyUrl.trim()}
                  className="px-4 py-2 bg-gray-900 dark:bg-white/20 hover:bg-gray-800 dark:hover:bg-white/25 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {thirdPartyLoading ? '导入中...' : '开始导入'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

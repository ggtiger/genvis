"use client";

import { useState, useEffect } from 'react';
import { X, User, Code, Terminal, Briefcase, FileText, Table, PresentationIcon, Globe, Rss, Video, Brain, Shield, Sparkles, Bot, Cpu, Palette, Music, Camera, Heart, Star, Zap, Rocket, Coffee, Headphones, Gamepad2, BookOpen, GraduationCap, Mic, PenTool, Search, ShoppingBag, Truck, Wrench, Landmark, Leaf } from 'lucide-react';
import type {
  Employee,
  EmployeeCategoryKey,
  EmployeeMode,
} from '@/types/backend/employee';
import { DEFAULT_EMPLOYEE_CATEGORIES } from '@/types/backend/employee';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

// Avatar icon options
const AVATAR_ICONS = [
  { id: 'user', icon: User, label: '用户' },
  { id: 'code', icon: Code, label: '代码' },
  { id: 'terminal', icon: Terminal, label: '终端' },
  { id: 'briefcase', icon: Briefcase, label: '公文包' },
  { id: 'file-text', icon: FileText, label: '文档' },
  { id: 'table', icon: Table, label: '表格' },
  { id: 'presentation', icon: PresentationIcon, label: 'PPT' },
  { id: 'globe', icon: Globe, label: '浏览器' },
  { id: 'rss', icon: Rss, label: '订阅' },
  { id: 'video', icon: Video, label: '视频' },
  { id: 'brain', icon: Brain, label: '智能' },
  { id: 'shield', icon: Shield, label: '安全' },
  { id: 'sparkles', icon: Sparkles, label: '魔法' },
  { id: 'bot', icon: Bot, label: '机器人' },
  { id: 'cpu', icon: Cpu, label: '芯片' },
  { id: 'palette', icon: Palette, label: '设计' },
  { id: 'music', icon: Music, label: '音乐' },
  { id: 'camera', icon: Camera, label: '相机' },
  { id: 'heart', icon: Heart, label: '健康' },
  { id: 'star', icon: Star, label: '收藏' },
  { id: 'zap', icon: Zap, label: '闪电' },
  { id: 'rocket', icon: Rocket, label: '火箭' },
  { id: 'coffee', icon: Coffee, label: '咖啡' },
  { id: 'headphones', icon: Headphones, label: '耳机' },
  { id: 'gamepad', icon: Gamepad2, label: '游戏' },
  { id: 'book', icon: BookOpen, label: '书籍' },
  { id: 'graduation', icon: GraduationCap, label: '教育' },
  { id: 'mic', icon: Mic, label: '麦克风' },
  { id: 'pen', icon: PenTool, label: '画笔' },
  { id: 'search', icon: Search, label: '搜索' },
  { id: 'shopping', icon: ShoppingBag, label: '购物' },
  { id: 'truck', icon: Truck, label: '物流' },
  { id: 'wrench', icon: Wrench, label: '工具' },
  { id: 'landmark', icon: Landmark, label: '金融' },
  { id: 'leaf', icon: Leaf, label: '环保' },
] as const;

export type AvatarIconId = typeof AVATAR_ICONS[number]['id'];

// Export for use in EmployeeList
export function getAvatarIcon(id?: string) {
  const found = AVATAR_ICONS.find(a => a.id === id);
  return found?.icon || User;
}

interface EmployeeFormModalProps {
  open: boolean;
  employee: Employee | null;
  onClose: () => void;
  onSave: () => void;
}

export default function EmployeeFormModal({
  open,
  employee,
  onClose,
  onSave,
}: EmployeeFormModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<string>('user');
  const [category, setCategory] = useState<EmployeeCategoryKey>('other');
  const [mode, setMode] = useState<EmployeeMode>('work');
  const [firstPrompt, setFirstPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [systemPromptPlan, setSystemPromptPlan] = useState('');
  const [systemPromptExecution, setSystemPromptExecution] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const isEditing = !!employee;
  const isBuiltin = employee?.is_builtin ?? false;

  useEffect(() => {
    if (open) {
      if (employee) {
        setName(employee.name);
        setDescription(employee.description || '');
        setAvatar(employee.avatar || 'user');
        setCategory(employee.category);
        setMode(employee.mode);
        setFirstPrompt(employee.first_prompt || '');
        setSystemPrompt(employee.system_prompt || '');
        setSystemPromptPlan(employee.system_prompt_plan || '');
        setSystemPromptExecution(employee.system_prompt_execution || '');
      } else {
        setName('');
        setDescription('');
        setAvatar('user');
        setCategory('other');
        setMode('work');
        setFirstPrompt('');
        setSystemPrompt('');
        setSystemPromptPlan('');
        setSystemPromptExecution('');
      }
      setError('');
      setShowDeleteConfirm(false);
      setShowAvatarPicker(false);
    }
  }, [open, employee]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');

    if (!isBuiltin) {
      if (!name.trim()) { setError('请输入员工名称'); return; }
    }
    if (mode !== 'code' && !systemPrompt.trim()) { setError('请输入 System Prompt'); return; }
    if (mode === 'code' && (!systemPromptPlan.trim() || !systemPromptExecution.trim())) {
      setError('请输入 Plan 和 Execution 提示词'); return;
    }

    setLoading(true);
    try {
      const payload = isBuiltin
        ? {
            avatar,
            first_prompt: firstPrompt.trim() || undefined,
            system_prompt: mode !== 'code' ? systemPrompt.trim() : '',
            system_prompt_plan: mode === 'code' ? systemPromptPlan.trim() : undefined,
            system_prompt_execution: mode === 'code' ? systemPromptExecution.trim() : undefined,
          }
        : {
            name: name.trim(),
            description: description.trim() || undefined,
            avatar,
            category,
            mode,
            first_prompt: firstPrompt.trim() || undefined,
            system_prompt: mode !== 'code' ? systemPrompt.trim() : '',
            system_prompt_plan: mode === 'code' ? systemPromptPlan.trim() : undefined,
            system_prompt_execution: mode === 'code' ? systemPromptExecution.trim() : undefined,
          };

      const url = isEditing
        ? `${API_BASE}/api/employees/${employee.id}`
        : `${API_BASE}/api/employees`;

      const response = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) { setError(data.error || '保存失败'); return; }
      onSave();
    } catch (err) {
      setError('保存失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!employee) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/employees/${employee.id}`, { method: 'DELETE' });
      if (!response.ok) { const data = await response.json(); setError(data.error || '删除失败'); return; }
      onSave();
    } catch (err) {
      setError('删除失败，请重试');
    } finally {
      setLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  if (!open) return null;

  const SelectedAvatarIcon = getAvatarIcon(avatar);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col glass rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/15 dark:border-white/[0.06] shrink-0">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white">
            {isEditing ? '编辑数字员工' : '新建数字员工'}
          </h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/20 dark:hover:bg-white/10 transition-colors text-slate-500 dark:text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5">
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {/* Avatar picker */}
            <div className="flex flex-col items-center gap-3 py-2">
              <button
                type="button"
                onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                className="w-24 h-24 rounded-full bg-white/50 dark:bg-white/10 border-2 border-dashed border-white/40 dark:border-white/20 flex items-center justify-center hover:bg-white/60 dark:hover:bg-white/15 transition-all group relative"
                style={{ boxShadow: '0 0 20px rgba(255,255,255,0.2)' }}
              >
                <SelectedAvatarIcon className="w-10 h-10 text-slate-600 dark:text-slate-300 group-hover:scale-110 transition-transform" />
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-xs shadow-lg">
                  <PenTool className="w-3.5 h-3.5" />
                </div>
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">点击选择头像</span>
            </div>

            {/* Avatar icon grid */}
            {showAvatarPicker && (
              <div className="glass-card rounded-2xl p-4">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">选择头像图标</div>
                <div className="grid grid-cols-7 gap-2">
                  {AVATAR_ICONS.map((item) => {
                    const Icon = item.icon;
                    const isSelected = avatar === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => { setAvatar(item.id); setShowAvatarPicker(false); }}
                        title={item.label}
                        className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-primary/20 border-2 border-primary text-primary shadow-sm'
                            : 'bg-white/20 dark:bg-white/5 border border-white/20 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-white/40 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Name */}
            <div className="flex items-center gap-4">
              <label className="w-24 text-sm text-slate-600 dark:text-slate-400 shrink-0">
                名称 {!isBuiltin && <span className="text-red-400">*</span>}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：Python 程序员"
                disabled={isBuiltin}
                className={`flex-1 px-4 py-2.5 rounded-xl bg-white/20 dark:bg-white/5 border border-white/20 dark:border-white/10 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/30 dark:focus:bg-white/10 transition-all ${isBuiltin ? 'opacity-50 cursor-not-allowed' : ''}`}
                maxLength={50}
              />
            </div>

            {/* Category */}
            <div className="flex items-center gap-4">
              <label className="w-24 text-sm text-slate-600 dark:text-slate-400 shrink-0">类型</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as EmployeeCategoryKey)}
                disabled={isBuiltin}
                className={`flex-1 px-4 py-2.5 rounded-xl bg-white/20 dark:bg-white/5 border border-white/20 dark:border-white/10 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:border-primary/50 transition-all ${isBuiltin ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {DEFAULT_EMPLOYEE_CATEGORIES.map((cat) => (
                  <option key={cat.key} value={cat.key}>{cat.name}</option>
                ))}
              </select>
            </div>

            {/* Mode */}
            <div className="flex items-center gap-4">
              <label className="w-24 text-sm text-slate-600 dark:text-slate-400 shrink-0">
                模式 {!isBuiltin && <span className="text-red-400">*</span>}
              </label>
              <div className={`flex items-center gap-3 ${isBuiltin ? 'opacity-50' : ''}`}>
                {(['code', 'work'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => !isBuiltin && setMode(m)}
                    disabled={isBuiltin}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      mode === m
                        ? 'bg-primary/20 text-primary border border-primary/30'
                        : 'bg-white/15 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-white/20 dark:border-white/10 hover:bg-white/25 dark:hover:bg-white/10'
                    } ${isBuiltin ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {m === 'code' ? 'Code（编程）' : 'Work（工作）'}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div className="flex items-start gap-4">
              <label className="w-24 text-sm text-slate-600 dark:text-slate-400 shrink-0 pt-2.5">描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简要描述员工职责..."
                rows={2}
                disabled={isBuiltin}
                className={`flex-1 px-4 py-2.5 rounded-xl bg-white/20 dark:bg-white/5 border border-white/20 dark:border-white/10 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/30 dark:focus:bg-white/10 transition-all resize-none ${isBuiltin ? 'opacity-50 cursor-not-allowed' : ''}`}
                maxLength={200}
              />
            </div>

            {/* First Prompt */}
            <div className="flex items-start gap-4">
              <label className="w-24 text-sm text-slate-600 dark:text-slate-400 shrink-0 pt-2.5">第一句话</label>
              <textarea
                value={firstPrompt}
                onChange={(e) => setFirstPrompt(e.target.value)}
                placeholder="派活时自动发送的第一句话..."
                rows={2}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/20 dark:bg-white/5 border border-white/20 dark:border-white/10 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/30 dark:focus:bg-white/10 transition-all resize-none"
                maxLength={500}
              />
            </div>

            {/* Divider */}
            <div className="border-t border-white/10 dark:border-white/[0.06] pt-4">
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {mode === 'code' ? '编程模式使用 Plan + Execution 双提示词' : `${mode === 'work' ? '工作' : mode === 'boss' ? 'Boss' : mode === 'cli' ? 'CLI' : '秘书'}模式使用单一提示词`}
              </p>
            </div>

            {/* Prompts */}
            {(mode === 'work' || mode === 'secretary' || mode === 'boss' || mode === 'cli') && (
              <div className="flex flex-col gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">
                  System Prompt <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="输入系统提示词..."
                  className="w-full min-h-[300px] px-4 py-3 rounded-xl bg-white/20 dark:bg-white/5 border border-white/20 dark:border-white/10 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-primary/50 focus:bg-white/30 dark:focus:bg-white/10 transition-all"
                  style={{ resize: 'vertical' }}
                />
              </div>
            )}
            {mode === 'code' && (
              <>
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-slate-600 dark:text-slate-400">
                    System Prompt - Plan <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={systemPromptPlan}
                    onChange={(e) => setSystemPromptPlan(e.target.value)}
                    placeholder="输入规划阶段的系统提示词..."
                    className="w-full min-h-[200px] px-4 py-3 rounded-xl bg-white/20 dark:bg-white/5 border border-white/20 dark:border-white/10 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-primary/50 focus:bg-white/30 dark:focus:bg-white/10 transition-all"
                    style={{ resize: 'vertical' }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-slate-600 dark:text-slate-400">
                    System Prompt - Execution <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={systemPromptExecution}
                    onChange={(e) => setSystemPromptExecution(e.target.value)}
                    placeholder="输入执行阶段的系统提示词..."
                    className="w-full min-h-[200px] px-4 py-3 rounded-xl bg-white/20 dark:bg-white/5 border border-white/20 dark:border-white/10 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-primary/50 focus:bg-white/30 dark:focus:bg-white/10 transition-all"
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-between items-center gap-3 px-6 py-4 border-t border-white/15 dark:border-white/[0.06] shrink-0">
          <div>
            {isEditing && !isBuiltin && !showDeleteConfirm && (
              <button type="button" onClick={() => setShowDeleteConfirm(true)} disabled={loading}
                className="px-4 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors disabled:opacity-50">
                删除
              </button>
            )}
            {showDeleteConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 dark:text-slate-400">确定删除？</span>
                <button type="button" onClick={handleDelete} disabled={loading}
                  className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-xl transition-colors disabled:opacity-50">
                  确定
                </button>
                <button type="button" onClick={() => setShowDeleteConfirm(false)} disabled={loading}
                  className="px-3 py-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
                  取消
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-white/20 dark:hover:bg-white/10 rounded-xl transition-colors">
              取消
            </button>
            <button onClick={handleSubmit} disabled={loading}
              className="px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg">
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

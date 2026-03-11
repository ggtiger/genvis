'use client';

import { useState, useEffect } from 'react';
import { Plus, Clock, Trash2, Power, PowerOff, Pencil, X, Send, MessageSquare, ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, Play } from 'lucide-react';

interface ScheduledTask {
  id: string;
  name: string;
  message: string;
  triggerTime: string | null;
  repeatType: string;
  cronExpression: string | null;
  enabled: boolean;
  notifyIM: boolean;
  lastTriggeredAt: string | null;
  nextTriggerAt: string | null;
  triggerCount: number;
  createdAt: string;
}

interface TaskLog {
  id: string;
  taskId: string;
  status: string;
  secretaryReply: string | null;
  imPushResult: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

const REPEAT_LABELS: Record<string, string> = {
  once: '一次性',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  success: { icon: CheckCircle, color: 'text-green-500', label: '成功' },
  failed: { icon: XCircle, color: 'text-red-500', label: '失败' },
  pending: { icon: Loader2, color: 'text-yellow-500', label: '执行中' },
};

export default function ScheduledTasksContent() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, TaskLog[]>>({});
  const [loadingLogs, setLoadingLogs] = useState<Set<string>>(new Set());
  const [triggeringTasks, setTriggeringTasks] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    name: '',
    message: '',
    triggerTime: '',
    repeatType: 'once',
    notifyIM: false,
  });

  useEffect(() => { fetchTasks(); }, []);

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/scheduled-tasks');
      if (res.ok) {
        const data = await res.json();
        setTasks(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  };

  const toggleLogs = async (taskId: string) => {
    if (expandedLogs[taskId]) {
      const next = { ...expandedLogs };
      delete next[taskId];
      setExpandedLogs(next);
      return;
    }
    setLoadingLogs(prev => new Set(prev).add(taskId));
    try {
      const res = await fetch(`/api/scheduled-tasks/${taskId}/logs`);
      if (res.ok) {
        const data = await res.json();
        setExpandedLogs(prev => ({ ...prev, [taskId]: data.data || [] }));
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoadingLogs(prev => { const s = new Set(prev); s.delete(taskId); return s; });
    }
  };

  const handleTrigger = async (task: ScheduledTask) => {
    if (triggeringTasks.has(task.id)) return;
    setTriggeringTasks(prev => new Set(prev).add(task.id));
    try {
      const res = await fetch(`/api/scheduled-tasks/${task.id}/trigger`, { method: 'POST' });
      if (res.ok) {
        fetchTasks();
        // 如果日志已展开，刷新日志
        if (expandedLogs[task.id]) {
          const logRes = await fetch(`/api/scheduled-tasks/${task.id}/logs`);
          if (logRes.ok) {
            const data = await logRes.json();
            setExpandedLogs(prev => ({ ...prev, [task.id]: data.data || [] }));
          }
        }
      }
    } catch (err) {
      console.error('Failed to trigger task:', err);
    } finally {
      setTriggeringTasks(prev => { const s = new Set(prev); s.delete(task.id); return s; });
    }
  };

  const openAddModal = () => {
    setEditingTask(null);
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30);
    setFormData({
      name: '',
      message: '',
      triggerTime: now.toISOString().slice(0, 16),
      repeatType: 'once',
      notifyIM: false,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (task: ScheduledTask) => {
    setEditingTask(task);
    setFormData({
      name: task.name,
      message: task.message,
      triggerTime: task.triggerTime ? new Date(task.triggerTime).toISOString().slice(0, 16) : '',
      repeatType: task.repeatType,
      notifyIM: task.notifyIM,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: formData.name,
      message: formData.message,
      triggerTime: formData.triggerTime || undefined,
      repeatType: formData.repeatType,
      notifyIM: formData.notifyIM,
    };
    try {
      const url = editingTask ? `/api/scheduled-tasks/${editingTask.id}` : '/api/scheduled-tasks';
      const method = editingTask ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) { setIsModalOpen(false); fetchTasks(); }
    } catch (err) {
      console.error('Failed to save task:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个定时任务吗？')) return;
    try {
      const res = await fetch(`/api/scheduled-tasks/${id}`, { method: 'DELETE' });
      if (res.ok) fetchTasks();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const handleToggle = async (task: ScheduledTask) => {
    try {
      await fetch(`/api/scheduled-tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !task.enabled }),
      });
      fetchTasks();
    } catch (err) {
      console.error('Failed to toggle task:', err);
    }
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const formatFullTime = (iso: string) => {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Clock className="w-6 h-6 text-purple-500" />
          <h1 className="text-xl font-bold text-gray-900">定时任务</h1>
          <span className="text-sm text-gray-500">到期自动发送消息给秘书</span>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建任务
        </button>
      </div>

      {/* 任务列表 */}
      <div className="space-y-3">
        {tasks.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>还没有定时任务</p>
            <button onClick={openAddModal} className="mt-4 text-purple-500 hover:underline">
              创建第一个定时任务
            </button>
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className={`bg-white rounded-xl shadow-sm border transition-all ${task.enabled ? 'border-gray-100' : 'border-gray-200 opacity-60'}`}>
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Send className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      <h3 className="font-medium text-gray-900 truncate">{task.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${task.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {task.enabled ? '启用' : '已停用'}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        {REPEAT_LABELS[task.repeatType] || task.repeatType}
                      </span>
                      {task.notifyIM && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />IM
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mb-2 line-clamp-2">📨 {task.message}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      {task.nextTriggerAt && <span>下次触发: {formatTime(task.nextTriggerAt)}</span>}
                      {task.lastTriggeredAt && <span>上次触发: {formatTime(task.lastTriggeredAt)}</span>}
                      <span>已触发 {task.triggerCount} 次</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                    <button onClick={() => toggleLogs(task.id)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="查看执行日志">
                      {expandedLogs[task.id] ? <ChevronDown className="w-4 h-4 text-purple-500" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    </button>
                    <button
                      onClick={() => handleTrigger(task)}
                      disabled={triggeringTasks.has(task.id)}
                      className="p-2 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
                      title="手动执行一次"
                    >
                      {triggeringTasks.has(task.id)
                        ? <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                        : <Play className="w-4 h-4 text-purple-500" />
                      }
                    </button>
                    <button onClick={() => handleToggle(task)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title={task.enabled ? '停用' : '启用'}>
                      {task.enabled ? <Power className="w-4 h-4 text-green-500" /> : <PowerOff className="w-4 h-4 text-gray-400" />}
                    </button>
                    <button onClick={() => openEditModal(task)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                      <Pencil className="w-4 h-4 text-gray-400" />
                    </button>
                    <button onClick={() => handleDelete(task.id)} className="p-2 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 执行日志展开区域 */}
              {loadingLogs.has(task.id) && (
                <div className="px-4 pb-4 text-sm text-gray-400 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载日志...
                </div>
              )}
              {expandedLogs[task.id] && (
                <div className="border-t border-gray-100 px-4 pb-4">
                  <div className="pt-3 text-xs font-medium text-gray-500 mb-2">执行日志（最近 50 条）</div>
                  {expandedLogs[task.id].length === 0 ? (
                    <div className="text-xs text-gray-400 py-2">暂无执行记录</div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {expandedLogs[task.id].map((log) => {
                        const cfg = STATUS_CONFIG[log.status] || STATUS_CONFIG.pending;
                        const Icon = cfg.icon;
                        return (
                          <div key={log.id} className="text-xs bg-gray-50 rounded-lg p-3 space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                                <span className={cfg.color}>{cfg.label}</span>
                                <span className="text-gray-400">{formatFullTime(log.createdAt)}</span>
                              </div>
                              {log.durationMs != null && (
                                <span className="text-gray-400">{log.durationMs}ms</span>
                              )}
                            </div>
                            {log.secretaryReply && (
                              <div className="text-gray-600 mt-1">
                                <span className="text-gray-400">秘书回复: </span>
                                <span className="line-clamp-3">{log.secretaryReply}</span>
                              </div>
                            )}
                            {log.error && (
                              <div className="text-red-500 mt-1">
                                <span className="text-red-400">错误: </span>{log.error}
                              </div>
                            )}
                            {log.imPushResult && (
                              <div className="text-blue-500 mt-1">
                                <span className="text-blue-400">IM推送: </span>
                                <span className="line-clamp-2">{log.imPushResult}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 添加/编辑弹窗 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">{editingTask ? '编辑定时任务' : '新建定时任务'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">任务名称 *</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="例如：每日站会提醒" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">发送给秘书的消息 *</label>
                <textarea value={formData.message} onChange={(e) => setFormData({ ...formData, message: e.target.value })} required rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="到期时自动发送给秘书的消息，秘书会按照消息内容执行操作" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">触发时间</label>
                  <input type="datetime-local" value={formData.triggerTime} onChange={(e) => setFormData({ ...formData, triggerTime: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">重复方式</label>
                  <select value={formData.repeatType} onChange={(e) => setFormData({ ...formData, repeatType: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <option value="once">一次性</option>
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                  </select>
                </div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3 text-sm text-purple-700">
                💡 到期时，消息会自动发送给秘书。秘书会根据消息内容智能执行操作，比如派发任务、查询信息等。
              </div>
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.notifyIM} onChange={(e) => setFormData({ ...formData, notifyIM: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500" />
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                  <span className="text-sm text-blue-700">同时发送执行结果到已连接的 IM（钉钉/飞书等）</span>
                </label>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600">{editingTask ? '保存' : '创建'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

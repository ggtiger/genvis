'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Target, MoreHorizontal, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEmbeddedPage } from '@/contexts/EmbeddedPageContext';

interface Todo { id: string; title: string; status: string; [key: string]: any; }
interface Schedule { id: string; title: string; startTime: string; endTime?: string; [key: string]: any; }
interface Note { id: string; title: string; content?: string; createdAt?: string; updatedAt?: string; [key: string]: any; }
interface EmployeeStatus { id: string; name: string; description?: string; category?: string; mode?: string; first_prompt?: string; is_builtin?: boolean; runningTasks: any[]; totalTaskCount: number; }

interface DashboardData {
  todos: { pending: number; inProgress: number; completed: number; items: Todo[] };
  schedules: { today: Schedule[]; upcoming: Schedule[] };
  employees: { active: number; idle: number; items: EmployeeStatus[] };
  notes: { recent: Note[] };
  skillNotRunning?: string;
  skillUrl?: string;
}

interface HomeDashboardProps { refreshTrigger?: number; layout?: 'grid' | 'sidebar'; onEmployeesLoaded?: (employees: EmployeeStatus[]) => void; }
interface ApiResponse<T = any> { success: boolean; data?: T; error?: string; }

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

function formatScheduleDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const scheduleDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  if (scheduleDay.getTime() === today.getTime()) return '今天';
  if (scheduleDay.getTime() === tomorrow.getTime()) return '明天';
  return `${date.getMonth() + 1}/${date.getDate()} ${weekdays[date.getDay()]}`;
}

function isExpired(dateStr: string): boolean { return new Date(dateStr) < new Date(); }

// ========== Sidebar Layout Components (matching code.html exactly) ==========

function SidebarFocusSection({ todos, skillUrl }: { todos: DashboardData['todos']; skillUrl: string | null }) {
  const { openPage } = useEmbeddedPage();

  const handleToggleTodo = (todoId: string, currentStatus: string) => {
    if (!skillUrl) return;
    
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    
    fetch(`${skillUrl}/api/todos/${todoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
      .then(() => {
        window.location.reload();
      })
      .catch((error) => {
        console.error('Failed to toggle todo:', error);
      });
  };

  const handleViewAll = () => {
    if (skillUrl) {
      openPage(`${skillUrl}/todos`, '待办事项');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-main flex items-center gap-2 text-contrast">
          <Target className="w-5 h-5 text-primary" />
          专注模式
        </h2>
        <button className="text-text-secondary hover:text-text-main">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>
      <div className="bg-white/40 dark:bg-white/5 backdrop-blur-md rounded-xl border border-white/50 dark:border-border-subtle p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-secondary uppercase text-contrast">即将到来的任务</span>
          <span 
            onClick={handleViewAll}
            className="text-xs font-medium text-primary cursor-pointer hover:underline"
          >
            查看全部
          </span>
        </div>
        {todos.items.length === 0 ? (
          <p className="text-xs text-text-secondary text-center py-2 text-contrast">暂无待办</p>
        ) : (
          todos.items.slice(0, 3).map((todo) => (
            <label key={todo.id} className="flex items-start gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                className="mt-1 rounded border-gray-300 dark:border-slate-600 text-primary focus:ring-primary/20 dark:bg-slate-700" 
                checked={todo.status === 'completed'}
                onChange={() => handleToggleTodo(todo.id, todo.status)}
              />
              <div className="flex flex-col">
                <span className="text-sm text-text-main font-medium group-hover:text-primary transition-colors text-contrast">{todo.title}</span>
                <span className="text-xs text-text-secondary text-contrast">
                  {todo.status === 'pending' ? '待处理' : todo.status === 'in_progress' ? '进行中' : '已完成'}
                </span>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function SidebarNotesSection({ notes, skillUrl }: { notes: DashboardData['notes']; skillUrl: string | null }) {
  const { openPage } = useEmbeddedPage();

  const handleAddNote = () => {
    if (skillUrl) {
      openPage(`${skillUrl}/notes?action=add`, '笔记');
    }
  };

  const handleNoteClick = (noteId: string) => {
    if (skillUrl) {
      openPage(`${skillUrl}/notes?id=${noteId}`, '笔记');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-main flex items-center gap-2 text-contrast">
          📝 近期笔记
        </h2>
        <button 
          onClick={handleAddNote}
          className="text-primary hover:opacity-80 text-xs font-medium bg-primary/10 px-2 py-1 rounded-md transition-colors flex items-center gap-1"
        >
          <Plus className="w-4 h-4" />
          添加笔记
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {notes.recent.length === 0 ? (
          <div className="bg-white/40 dark:bg-white/5 backdrop-blur-md border border-white/50 dark:border-border-subtle rounded-xl p-3 text-xs text-text-secondary text-center text-contrast">暂无笔记</div>
        ) : (
          notes.recent.slice(0, 3).map((note) => (
            <div 
              key={note.id} 
              onClick={() => handleNoteClick(note.id)}
              className="flex flex-col p-3 bg-white/40 dark:bg-white/5 backdrop-blur-md border border-white/50 dark:border-border-subtle rounded-xl hover:shadow-md transition-shadow group gap-1 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-main truncate text-contrast">{note.title}</span>
                <span className="text-[10px] text-text-secondary shrink-0 ml-2 text-contrast">
                  {note.updatedAt ? new Date(note.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>
              {note.content && (
                <p className="text-xs text-text-secondary line-clamp-2 text-contrast">{note.content}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function MiniCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  // Get first day of month and total days
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Build calendar grid
  const cells: { day: number; isCurrentMonth: boolean; isToday: boolean }[] = [];
  // Previous month trailing days
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, isCurrentMonth: false, isToday: false });
  }
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, isCurrentMonth: true, isToday: d === today });
  }
  // Only show first row (7 cells) for compact view like code.html
  const visibleCells = cells.slice(0, 7);

  return (
    <div className="mt-auto bg-white/40 dark:bg-white/5 backdrop-blur-md rounded-xl border border-white/50 dark:border-border-subtle p-4 shadow-sm flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-text-main">{year}年 {monthNames[month]}</span>
        <div className="flex gap-1">
          <button className="text-text-secondary hover:text-text-main"><ChevronLeft className="w-4 h-4" /></button>
          <button className="text-text-secondary hover:text-text-main"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-text-secondary mb-1">
        <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
      </div>
      <div className="grid grid-cols-7 text-center text-xs font-medium gap-y-2">
        {visibleCells.map((cell, idx) => (
          <span
            key={idx}
            className={
              !cell.isCurrentMonth
                ? 'text-gray-300 dark:text-slate-600'
                : cell.isToday
                ? 'bg-primary text-white rounded-full cursor-pointer py-1'
                : 'hover:bg-bg-subtle rounded-full cursor-pointer py-1'
            }
          >
            {cell.day}
          </span>
        ))}
      </div>
    </div>
  );
}

// ========== Grid Layout Components ==========

function DashboardCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/40 dark:bg-white/5 backdrop-blur-md rounded-xl border border-white/50 dark:border-border-subtle p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{icon}</span>
        <h3 className="text-sm font-semibold text-text-secondary">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white/40 dark:bg-white/5 backdrop-blur-md rounded-xl border border-white/50 dark:border-border-subtle p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3"><div className="w-5 h-5 bg-gray-200 dark:bg-slate-700 rounded" /><div className="h-4 w-24 bg-gray-200 dark:bg-slate-700 rounded" /></div>
      <div className="space-y-2"><div className="h-3 w-full bg-gray-100 dark:bg-slate-700 rounded" /><div className="h-3 w-3/4 bg-gray-100 dark:bg-slate-700 rounded" /><div className="h-3 w-1/2 bg-gray-100 dark:bg-slate-700 rounded" /></div>
    </div>
  );
}

function DonutChart({ pending, inProgress, completed }: { pending: number; inProgress: number; completed: number }) {
  const total = pending + inProgress + completed;
  if (total === 0) return <div className="flex items-center justify-center"><div className="w-24 h-24 rounded-full border-4 border-gray-200 dark:border-slate-700 flex items-center justify-center"><span className="text-xs text-gray-400 dark:text-slate-500">暂无数据</span></div></div>;
  const completedPct = (completed / total) * 100;
  const inProgressPct = (inProgress / total) * 100;
  const gradient = `conic-gradient(#22c55e 0% ${completedPct}%, #3b82f6 ${completedPct}% ${completedPct + inProgressPct}%, #f59e0b ${completedPct + inProgressPct}% 100%)`;
  return (
    <div className="flex items-center justify-center">
      <div className="w-24 h-24 rounded-full flex items-center justify-center" style={{ background: gradient }}>
        <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center"><span className="text-lg font-bold text-text-main">{total}</span></div>
      </div>
    </div>
  );
}

function TodoOverviewCard({ todos }: { todos: DashboardData['todos'] }) {
  return (
    <DashboardCard title="待办概览" icon="📋">
      <div className="flex items-center gap-4">
        <DonutChart pending={todos.pending} inProgress={todos.inProgress} completed={todos.completed} />
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-400 shrink-0" /><span className="text-text-secondary">待处理</span><span className="font-semibold text-text-main ml-auto">{todos.pending}</span></div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500 shrink-0" /><span className="text-text-secondary">进行中</span><span className="font-semibold text-text-main ml-auto">{todos.inProgress}</span></div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500 shrink-0" /><span className="text-text-secondary">已完成</span><span className="font-semibold text-text-main ml-auto">{todos.completed}</span></div>
        </div>
      </div>
    </DashboardCard>
  );
}

function ScheduleCard({ schedules }: { schedules: DashboardData['schedules'] }) {
  const sorted = [...schedules.today, ...schedules.upcoming].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return (
    <DashboardCard title="日程安排" icon="📅">
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-4 text-text-secondary text-sm"><span className="text-2xl mb-1">🎉</span><span>暂无日程安排</span></div>
      ) : (
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {sorted.map((s) => {
            const t = new Date(s.startTime);
            const timeStr = t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const dateLabel = formatScheduleDate(s.startTime);
            const expired = isExpired(s.startTime);
            return (
              <div key={s.id} className={`flex items-start gap-3 text-sm ${expired ? 'opacity-50' : ''}`}>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${expired ? 'text-gray-400 bg-gray-100 dark:bg-white/5 line-through' : dateLabel === '今天' ? 'text-primary bg-primary-subtle' : 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10'}`}>{dateLabel} {timeStr}</span>
                <span className={`truncate ${expired ? 'text-gray-400' : 'text-text-main'}`}>{s.title}</span>
              </div>
            );
          })}
        </div>
      )}
    </DashboardCard>
  );
}

function EmployeeStatusCard({ employees }: { employees: DashboardData['employees'] }) {
  const total = employees.active + employees.idle;
  return (
    <DashboardCard title="员工状态" icon="👥">
      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-4 text-text-secondary text-sm"><span className="text-2xl mb-1">🤷</span><span>暂无员工数据</span></div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="flex-1 flex items-center gap-2 bg-green-50 dark:bg-green-500/10 rounded-lg px-3 py-2"><span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" /><div><div className="text-lg font-bold text-green-700 dark:text-green-400">{employees.active}</div><div className="text-xs text-green-600 dark:text-green-500">活跃</div></div></div>
            <div className="flex-1 flex items-center gap-2 bg-gray-50 dark:bg-white/5 rounded-lg px-3 py-2"><span className="w-2.5 h-2.5 rounded-full bg-gray-400" /><div><div className="text-lg font-bold text-gray-700 dark:text-slate-300">{employees.idle}</div><div className="text-xs text-gray-500 dark:text-slate-400">空闲</div></div></div>
          </div>
          <div className="text-xs text-text-secondary text-center">共 {total} 名员工</div>
        </div>
      )}
    </DashboardCard>
  );
}

function RecentNotesCard({ notes }: { notes: DashboardData['notes'] }) {
  return (
    <DashboardCard title="最近笔记" icon="📝">
      {notes.recent.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-4 text-text-secondary text-sm"><span className="text-2xl mb-1">📭</span><span>暂无笔记</span></div>
      ) : (
        <ul className="space-y-1.5 max-h-40 overflow-y-auto">
          {notes.recent.map((note) => (
            <li key={note.id} className="flex items-center gap-2 text-sm text-text-main py-1 px-2 rounded hover:bg-bg-subtle transition-colors">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" /><span className="truncate">{note.title}</span>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

// ========== Main Component ==========

export default function HomeDashboard({ refreshTrigger, layout = 'grid', onEmployeesLoaded }: HomeDashboardProps) {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchDashboard = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/chat/home/dashboard`, { method: 'GET', headers: { 'Content-Type': 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`请求失败 (${response.status})`);
      const result: ApiResponse<DashboardData> = await response.json();
      if (result.success && result.data) {
        setDashboardData(result.data);
        if (result.data.employees?.items && onEmployeesLoaded) {
          onEmployeesLoaded(result.data.employees.items);
        }
      }
      else throw new Error(result.error || '获取仪表盘数据失败');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[HomeDashboard] Failed to fetch dashboard data:', err);
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { fetchDashboard(); return () => { abortRef.current?.abort(); }; }, [fetchDashboard]);
  useEffect(() => { if (refreshTrigger !== undefined && refreshTrigger > 0) fetchDashboard(); }, [refreshTrigger, fetchDashboard]);

  if (loading && !dashboardData) {
    if (layout === 'sidebar') {
      return <div className="flex flex-col gap-6 p-6 animate-pulse"><div className="h-32 bg-gray-100 dark:bg-white/5 rounded-xl" /><div className="h-24 bg-gray-100 dark:bg-white/5 rounded-xl" /><div className="h-20 bg-gray-100 dark:bg-white/5 rounded-xl" /></div>;
    }
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;
  }

  if (error && !dashboardData) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-text-secondary">
        <span className="text-3xl mb-3">⚠️</span>
        <p className="text-sm mb-3">{error}</p>
        <button onClick={fetchDashboard} className="px-4 py-2 text-sm btn-primary rounded-lg transition-colors">重试</button>
      </div>
    );
  }

  if (!dashboardData) return null;

  const skillWarning = dashboardData.skillNotRunning ? (
    <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
      <span className="text-lg shrink-0">⚡</span>
      <div><p className="font-medium mb-1">技能未启动</p><p className="text-amber-700 dark:text-amber-400 text-xs">{dashboardData.skillNotRunning}</p></div>
    </div>
  ) : null;

  // Sidebar layout - matches code.html right aside exactly
  if (layout === 'sidebar') {
    return (
      <div className="flex flex-col gap-6 p-6 overflow-y-auto h-full">
        {skillWarning}
        <SidebarFocusSection todos={dashboardData.todos} skillUrl={dashboardData.skillUrl || null} />
        <SidebarNotesSection notes={dashboardData.notes} skillUrl={dashboardData.skillUrl || null} />
        <MiniCalendar />
      </div>
    );
  }

  // Grid layout (original)
  return (
    <div className="space-y-4">
      {skillWarning}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TodoOverviewCard todos={dashboardData.todos} />
        <ScheduleCard schedules={dashboardData.schedules} />
        <EmployeeStatusCard employees={dashboardData.employees} />
        <RecentNotesCard notes={dashboardData.notes} />
      </div>
    </div>
  );
}

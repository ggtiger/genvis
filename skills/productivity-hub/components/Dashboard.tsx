'use client';

import { Calendar, Clock, FileText, CheckSquare, Plus } from 'lucide-react';

interface Schedule {
  id: string;
  title: string;
  startTime: string;
  allDay: boolean;
  color?: string;
}

interface Note {
  id: string;
  title: string;
  updatedAt: string;
  isPinned: boolean;
}

interface Todo {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueDate?: string;
}

interface DashboardProps {
  schedules: Schedule[];
  notes: Note[];
  todos: Todo[];
  onAddSchedule: () => void;
  onAddNote: () => void;
  onAddTodo: () => void;
}

export default function Dashboard({
  schedules,
  notes,
  todos,
  onAddSchedule,
  onAddNote,
  onAddTodo,
}: DashboardProps) {
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const pendingTodos = todos.filter((t) => t.status !== 'completed');
  const completedTodos = todos.filter((t) => t.status === 'completed');

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* 日程卡片 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden card-hover">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-gray-900">今日日程3</h3>
          </div>
          <span className="text-sm text-gray-500">{schedules.length} 项</span>
        </div>
        <div className="p-4 space-y-3 min-h-[200px]">
          {schedules.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">今天没有日程安排</p>
          ) : (
            schedules.slice(0, 5).map((schedule) => (
              <div key={schedule.id} className="flex items-center gap-3">
                <div
                  className="w-1 h-8 rounded-full"
                  style={{ backgroundColor: schedule.color || '#3b82f6' }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{schedule.title}</p>
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {schedule.allDay ? '全天' : formatTime(schedule.startTime)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
        <button
          onClick={onAddSchedule}
          className="w-full p-3 text-sm text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1 border-t border-gray-100"
        >
          <Plus className="w-4 h-4" />
          新增日程
        </button>
      </div>

      {/* 笔记卡片 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden card-hover">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-500" />
            <h3 className="font-semibold text-gray-900">最近笔记</h3>
          </div>
          <span className="text-sm text-gray-500">{notes.length} 篇</span>
        </div>
        <div className="p-4 space-y-3 min-h-[200px]">
          {notes.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">还没有笔记</p>
          ) : (
            notes.slice(0, 5).map((note) => (
              <div key={note.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1">
                    {note.isPinned && <span className="text-amber-500">📌</span>}
                    {note.title}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(note.updatedAt).toLocaleDateString('zh-CN')}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
        <button
          onClick={onAddNote}
          className="w-full p-3 text-sm text-amber-600 hover:bg-amber-50 transition-colors flex items-center justify-center gap-1 border-t border-gray-100"
        >
          <Plus className="w-4 h-4" />
          新增笔记
        </button>
      </div>

      {/* 待办卡片 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden card-hover">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-green-500" />
            <h3 className="font-semibold text-gray-900">待办事项</h3>
          </div>
          <span className="text-sm text-gray-500">
            {pendingTodos.length} 待办 / {completedTodos.length} 完成
          </span>
        </div>
        <div className="p-4 space-y-3 min-h-[200px]">
          {todos.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">没有待办事项</p>
          ) : (
            todos.slice(0, 5).map((todo) => (
              <div key={todo.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={todo.status === 'completed'}
                  readOnly
                  className="w-4 h-4 rounded border-gray-300 text-green-500 focus:ring-green-500"
                />
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium truncate ${
                      todo.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-900'
                    }`}
                  >
                    {todo.title}
                  </p>
                  {todo.priority === 'high' && (
                    <span className="text-xs text-red-500">高优先级</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <button
          onClick={onAddTodo}
          className="w-full p-3 text-sm text-green-600 hover:bg-green-50 transition-colors flex items-center justify-center gap-1 border-t border-gray-100"
        >
          <Plus className="w-4 h-4" />
          新增待办
        </button>
      </div>
    </div>
  );
}

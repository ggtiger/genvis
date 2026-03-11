'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import ScheduleCard from '@/components/ScheduleCard';
import { Plus, Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

interface Schedule {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime?: string;
  allDay: boolean;
  reminderMinutes?: number;
  repeatType?: string;
  color?: string;
}

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
];

export default function SchedulesContent() {
  const searchParams = useSearchParams();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startTime: '',
    endTime: '',
    allDay: false,
    reminderMinutes: '',
    repeatType: 'none',
    color: COLORS[0],
  });

  useEffect(() => {
    fetchSchedules();
    if (searchParams?.get('action') === 'add') {
      openAddModal();
    }
  }, [searchParams]);

  const fetchSchedules = async () => {
    try {
      const response = await fetch('/api/schedules');
      if (response.ok) {
        const data = await response.json();
        setSchedules(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch schedules:', error);
    }
  };

  const openAddModal = () => {
    setEditingSchedule(null);
    const now = new Date();
    const startTime = new Date(now.getTime() + 60 * 60 * 1000);
    setFormData({
      title: '',
      description: '',
      startTime: startTime.toISOString().slice(0, 16),
      endTime: '',
      allDay: false,
      reminderMinutes: '15',
      repeatType: 'none',
      color: COLORS[0],
    });
    setIsModalOpen(true);
  };

  const openEditModal = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setFormData({
      title: schedule.title,
      description: schedule.description || '',
      startTime: new Date(schedule.startTime).toISOString().slice(0, 16),
      endTime: schedule.endTime ? new Date(schedule.endTime).toISOString().slice(0, 16) : '',
      allDay: schedule.allDay,
      reminderMinutes: schedule.reminderMinutes?.toString() || '',
      repeatType: schedule.repeatType || 'none',
      color: schedule.color || COLORS[0],
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      title: formData.title,
      description: formData.description || undefined,
      startTime: formData.startTime,
      endTime: formData.endTime || undefined,
      allDay: formData.allDay,
      reminderMinutes: formData.reminderMinutes ? parseInt(formData.reminderMinutes) : undefined,
      repeatType: formData.repeatType !== 'none' ? formData.repeatType : undefined,
      color: formData.color,
    };
    try {
      const url = editingSchedule ? `/api/schedules/${editingSchedule.id}` : '/api/schedules';
      const method = editingSchedule ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        setIsModalOpen(false);
        fetchSchedules();
      }
    } catch (error) {
      console.error('Failed to save schedule:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个日程吗？')) return;
    try {
      const response = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (response.ok) { fetchSchedules(); }
    } catch (error) {
      console.error('Failed to delete schedule:', error);
    }
  };

  const navigateMonth = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + direction);
    setCurrentDate(newDate);
  };

  const groupedSchedules = schedules.reduce((acc, schedule) => {
    const date = new Date(schedule.startTime).toDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(schedule);
    return acc;
  }, {} as Record<string, Schedule[]>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Calendar className="w-6 h-6 text-blue-500" />
          <h1 className="text-xl font-bold text-gray-900">日程管理</h1>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新增日程
        </button>
      </div>

      {/* 月份导航 */}
      <div className="flex items-center justify-center gap-4 bg-white rounded-lg p-4 shadow-sm border border-gray-100">
        <button onClick={() => navigateMonth(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-lg font-medium">
          {currentDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}
        </span>
        <button onClick={() => navigateMonth(1)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* 日程列表 */}
      <div className="space-y-4">
        {Object.keys(groupedSchedules).length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>还没有日程安排</p>
            <button onClick={openAddModal} className="mt-4 text-blue-500 hover:underline">
              添加第一个日程
            </button>
          </div>
        ) : (
          Object.entries(groupedSchedules)
            .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
            .map(([date, items]) => (
              <div key={date}>
                <h3 className="text-sm font-medium text-gray-500 mb-2">
                  {new Date(date).toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}
                </h3>
                <div className="space-y-2">
                  {items.map((schedule) => (
                    <ScheduleCard key={schedule.id} schedule={schedule} onEdit={openEditModal} onDelete={handleDelete} />
                  ))}
                </div>
              </div>
            ))
        )}
      </div>

      {/* 添加/编辑弹窗 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">
                {editingSchedule ? '编辑日程' : '新增日程'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">标题 *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="日程标题"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="日程描述（可选）"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="allDay"
                  checked={formData.allDay}
                  onChange={(e) => setFormData({ ...formData, allDay: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <label htmlFor="allDay" className="text-sm text-gray-700">全天</label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">开始时间 *</label>
                  <input
                    type="datetime-local"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">结束时间</label>
                  <input
                    type="datetime-local"
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">提前提醒</label>
                  <select
                    value={formData.reminderMinutes}
                    onChange={(e) => setFormData({ ...formData, reminderMinutes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">不提醒</option>
                    <option value="5">5分钟前</option>
                    <option value="15">15分钟前</option>
                    <option value="30">30分钟前</option>
                    <option value="60">1小时前</option>
                    <option value="1440">1天前</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">重复</label>
                  <select
                    value={formData.repeatType}
                    onChange={(e) => setFormData({ ...formData, repeatType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="none">不重复</option>
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">颜色标记</label>
                <div className="flex gap-2">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFormData({ ...formData, color })}
                      className={`w-8 h-8 rounded-full transition-transform ${formData.color === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  {editingSchedule ? '保存' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

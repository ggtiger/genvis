'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Dashboard from '@/components/Dashboard';
import { Search } from 'lucide-react';

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

export default function HomePage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<string | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // 获取今日日程
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
      const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();
      
      const [schedulesRes, notesRes, todosRes] = await Promise.all([
        fetch(`/api/schedules?startDate=${startOfDay}&endDate=${endOfDay}`),
        fetch('/api/notes'),
        fetch('/api/todos'),
      ]);

      if (schedulesRes.ok) {
        const data = await schedulesRes.json();
        setSchedules(data.data || []);
      }
      if (notesRes.ok) {
        const data = await notesRes.json();
        setNotes(data.data || []);
      }
      if (todosRes.ok) {
        const data = await todosRes.json();
        setTodos(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
  };

  const handleQuery = async () => {
    if (!query.trim()) return;
    
    setIsQuerying(true);
    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setQueryResult(data.response || '没有找到相关信息');
      }
    } catch (error) {
      console.error('Query failed:', error);
      setQueryResult('查询失败，请稍后重试');
    } finally {
      setIsQuerying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900">欢迎使用个人效率助手</h1>
        <p className="text-gray-500 mt-1">管理你的日程、笔记和待办事项</p>
      </div>

      <Dashboard
        schedules={schedules}
        notes={notes}
        todos={todos}
        onAddSchedule={() => router.push('/schedules?action=add')}
        onAddNote={() => router.push('/notes?action=add')}
        onAddTodo={() => router.push('/todos?action=add')}
      />

      {/* 查询输入框 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
              placeholder="试试问我：今天有什么安排？还有哪些任务没完成？"
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={handleQuery}
            disabled={isQuerying || !query.trim()}
            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isQuerying ? '查询中...' : '查询'}
          </button>
        </div>
        
        {queryResult && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{queryResult}</p>
          </div>
        )}
      </div>
    </div>
  );
}

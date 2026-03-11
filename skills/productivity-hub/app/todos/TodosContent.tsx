'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import TodoCard from '@/components/TodoCard';
import { Plus, CheckSquare, X, Filter } from 'lucide-react';

interface Todo {
  id: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  dueDate?: string;
  completedAt?: string;
}

export default function TodosContent() {
  const searchParams = useSearchParams();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'pending',
    dueDate: '',
  });

  useEffect(() => {
    fetchTodos();
    if (searchParams?.get('action') === 'add') {
      openAddModal();
    }
  }, [searchParams]);

  const fetchTodos = async () => {
    try {
      let url = '/api/todos';
      const params = new URLSearchParams();
      if (filterStatus) params.append('status', filterStatus);
      if (filterPriority) params.append('priority', filterPriority);
      if (params.toString()) url += `?${params.toString()}`;

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setTodos(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch todos:', error);
    }
  };

  useEffect(() => {
    fetchTodos();
  }, [filterStatus, filterPriority]);

  const openAddModal = () => {
    setEditingTodo(null);
    setFormData({
      title: '',
      description: '',
      priority: 'medium',
      status: 'pending',
      dueDate: '',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (todo: Todo) => {
    setEditingTodo(todo);
    setFormData({
      title: todo.title,
      description: todo.description || '',
      priority: todo.priority,
      status: todo.status,
      dueDate: todo.dueDate ? new Date(todo.dueDate).toISOString().slice(0, 10) : '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload = {
      title: formData.title,
      description: formData.description || undefined,
      priority: formData.priority,
      status: formData.status,
      dueDate: formData.dueDate || undefined,
    };

    try {
      const url = editingTodo ? `/api/todos/${editingTodo.id}` : '/api/todos';
      const method = editingTodo ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setIsModalOpen(false);
        fetchTodos();
      }
    } catch (error) {
      console.error('Failed to save todo:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个待办吗？')) return;

    try {
      const response = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
      if (response.ok) {
        fetchTodos();
      }
    } catch (error) {
      console.error('Failed to delete todo:', error);
    }
  };

  const handleToggleStatus = async (id: string, status: string) => {
    try {
      const response = await fetch(`/api/todos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (response.ok) {
        fetchTodos();
      }
    } catch (error) {
      console.error('Failed to toggle status:', error);
    }
  };

  // 按状态分组
  const pendingTodos = todos.filter((t) => t.status === 'pending');
  const inProgressTodos = todos.filter((t) => t.status === 'in_progress');
  const completedTodos = todos.filter((t) => t.status === 'completed');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <CheckSquare className="w-6 h-6 text-green-500" />
          <h1 className="text-xl font-bold text-gray-900">待办管理</h1>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新增待办
        </button>
      </div>

      {/* 筛选器 */}
      <div className="flex flex-wrap gap-4 items-center">
        <Filter className="w-4 h-4 text-gray-400" />

        <div className="flex gap-2">
          <span className="text-sm text-gray-500">状态:</span>
          {[
            { value: null, label: '全部' },
            { value: 'pending', label: '待办' },
            { value: 'in_progress', label: '进行中' },
            { value: 'completed', label: '已完成' },
          ].map((option) => (
            <button
              key={option.value || 'all'}
              onClick={() => setFilterStatus(option.value)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                filterStatus === option.value
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <span className="text-sm text-gray-500">优先级:</span>
          {[
            { value: null, label: '全部' },
            { value: 'high', label: '高' },
            { value: 'medium', label: '中' },
            { value: 'low', label: '低' },
          ].map((option) => (
            <button
              key={option.value || 'all'}
              onClick={() => setFilterPriority(option.value)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                filterPriority === option.value
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* 待办看板 */}
      {!filterStatus ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 待办列 */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-medium text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-gray-400 rounded-full" />
              待办 ({pendingTodos.length})
            </h3>
            <div className="space-y-3">
              {pendingTodos.map((todo) => (
                <TodoCard
                  key={todo.id}
                  todo={todo}
                  onEdit={openEditModal}
                  onDelete={handleDelete}
                  onToggleStatus={handleToggleStatus}
                />
              ))}
            </div>
          </div>

          {/* 进行中列 */}
          <div className="bg-blue-50 rounded-lg p-4">
            <h3 className="font-medium text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-400 rounded-full" />
              进行中 ({inProgressTodos.length})
            </h3>
            <div className="space-y-3">
              {inProgressTodos.map((todo) => (
                <TodoCard
                  key={todo.id}
                  todo={todo}
                  onEdit={openEditModal}
                  onDelete={handleDelete}
                  onToggleStatus={handleToggleStatus}
                />
              ))}
            </div>
          </div>

          {/* 已完成列 */}
          <div className="bg-green-50 rounded-lg p-4">
            <h3 className="font-medium text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-green-400 rounded-full" />
              已完成 ({completedTodos.length})
            </h3>
            <div className="space-y-3">
              {completedTodos.map((todo) => (
                <TodoCard
                  key={todo.id}
                  todo={todo}
                  onEdit={openEditModal}
                  onDelete={handleDelete}
                  onToggleStatus={handleToggleStatus}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {todos.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>没有符合条件的待办</p>
            </div>
          ) : (
            todos.map((todo) => (
              <TodoCard
                key={todo.id}
                todo={todo}
                onEdit={openEditModal}
                onDelete={handleDelete}
                onToggleStatus={handleToggleStatus}
              />
            ))
          )}
        </div>
      )}

      {/* 添加/编辑弹窗 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">
                {editingTodo ? '编辑待办' : '新增待办'}
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
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="待办标题"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="详细描述（可选）"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">优先级</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="pending">待办</option>
                    <option value="in_progress">进行中</option>
                    <option value="completed">已完成</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">截止日期</label>
                <input
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
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
                  className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                  {editingTodo ? '保存' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

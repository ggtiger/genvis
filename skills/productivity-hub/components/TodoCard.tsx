'use client';

import { Calendar, Trash2, Edit2, CheckCircle2, Circle, Clock } from 'lucide-react';

interface Todo {
  id: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  dueDate?: string;
  completedAt?: string;
}

interface TodoCardProps {
  todo: Todo;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (id: string, status: string) => void;
}

export default function TodoCard({ todo, onEdit, onDelete, onToggleStatus }: TodoCardProps) {
  const isCompleted = todo.status === 'completed';
  const isOverdue = todo.dueDate && !isCompleted && new Date(todo.dueDate) < new Date();

  const getPriorityConfig = (priority: string) => {
    const configs: Record<string, { label: string; className: string }> = {
      high: { label: '高', className: 'bg-red-100 text-red-700' },
      medium: { label: '中', className: 'bg-yellow-100 text-yellow-700' },
      low: { label: '低', className: 'bg-green-100 text-green-700' },
    };
    return configs[priority] || configs.medium;
  };

  const priorityConfig = getPriorityConfig(todo.priority);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const handleToggle = () => {
    const newStatus = isCompleted ? 'pending' : 'completed';
    onToggleStatus(todo.id, newStatus);
  };

  return (
    <div className={`bg-white rounded-lg border p-4 hover:shadow-md transition-shadow ${
      isCompleted ? 'opacity-60' : ''
    } ${isOverdue ? 'border-red-200' : 'border-gray-200'}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={handleToggle}
          className={`flex-shrink-0 mt-0.5 transition-colors ${
            isCompleted ? 'text-green-500' : 'text-gray-300 hover:text-green-500'
          }`}
        >
          {isCompleted ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <Circle className="w-5 h-5" />
          )}
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className={`font-medium truncate ${
              isCompleted ? 'text-gray-400 line-through' : 'text-gray-900'
            }`}>
              {todo.title}
            </h3>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => onEdit(todo)}
                className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => onDelete(todo.id)}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {todo.description && (
            <p className={`text-sm mt-1 line-clamp-2 ${
              isCompleted ? 'text-gray-400' : 'text-gray-500'
            }`}>
              {todo.description}
            </p>
          )}
          
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${priorityConfig.className}`}>
              {priorityConfig.label}优先级
            </span>
            
            {todo.dueDate && (
              <span className={`inline-flex items-center gap-1 text-xs ${
                isOverdue ? 'text-red-500' : 'text-gray-500'
              }`}>
                <Calendar className="w-3.5 h-3.5" />
                {isOverdue ? '已逾期: ' : ''}{formatDate(todo.dueDate)}
              </span>
            )}
            
            {isCompleted && todo.completedAt && (
              <span className="inline-flex items-center gap-1 text-xs text-green-500">
                <Clock className="w-3.5 h-3.5" />
                完成于 {formatDate(todo.completedAt)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

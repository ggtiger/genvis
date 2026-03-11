'use client';

import { ChevronUp, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

interface TodoBarProps {
  todos: Todo[];
}

export default function TodoBar({ todos }: TodoBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (todos.length === 0) {
    return null;
  }

  // Find current in-progress task
  const inProgressTodo = todos.find(t => t.status === 'in_progress');
  const completedCount = todos.filter(t => t.status === 'completed').length;

  return (
    <div className="border-t border-white/15 dark:border-white/[0.06] bg-white dark:bg-gray-900">
      {/* Collapsed view - only show in-progress task */}
      {!isExpanded && inProgressTodo && (
        <div className="px-4 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Spinning indicator */}
            <div className="w-3 h-3 rounded-full border-2 border-gray-400 border-t-transparent animate-spin flex-shrink-0" />
            {/* Task label */}
            <span className="text-xs font-bold text-slate-800 dark:text-white flex-shrink-0">Tasks</span>
            {/* Task text */}
            <span className="text-sm text-slate-700 dark:text-slate-300 truncate">
              {inProgressTodo.activeForm || inProgressTodo.content}
            </span>
            {/* Progress */}
            <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
              {completedCount}/{todos.length}
            </span>
          </div>
          {/* Expand button */}
          <button
            onClick={() => setIsExpanded(true)}
            className="ml-2 p-1 hover:bg-white/15 dark:bg-white/5 rounded transition-colors flex-shrink-0"
            title="Expand tasks"
          >
            <ChevronUp size={16} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>
      )}

      {/* Collapsed view - no in-progress task, show summary */}
      {!isExpanded && !inProgressTodo && (
        <div className="px-4 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800 dark:text-white">
              Tasks: {completedCount}/{todos.length}
            </span>
          </div>
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1 hover:bg-white/15 dark:bg-white/5 rounded transition-colors"
            title="Expand tasks"
          >
            <ChevronUp size={16} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>
      )}

      {/* Expanded view - show all tasks */}
      {isExpanded && (
        <div className="px-4 py-1.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-800 dark:text-white">
              Tasks ({completedCount}/{todos.length})
            </span>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 hover:bg-white/15 dark:bg-white/5 rounded transition-colors"
              title="Collapse tasks"
            >
              <ChevronDown size={16} className="text-slate-500 dark:text-slate-400" />
            </button>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {todos.map((todo, index) => (
              <div key={index} className="flex items-center gap-2">
                {/* Status indicator */}
                <div className="flex-shrink-0">
                  {todo.status === 'completed' ? (
                    <div className="w-3 h-3 rounded-full bg-green-500 flex items-center justify-center">
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  ) : todo.status === 'in_progress' ? (
                    <div className="w-3 h-3 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
                  ) : (
                    <div className="w-3 h-3 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                  )}
                </div>
                {/* Task text */}
                <span className={`text-sm truncate ${
                  todo.status === 'completed'
                    ? 'text-slate-500 dark:text-slate-400 line-through'
                    : todo.status === 'in_progress'
                    ? 'text-slate-800 dark:text-white font-medium'
                    : 'text-slate-600 dark:text-slate-400'
                }`}>
                  {todo.status === 'in_progress' ? (todo.activeForm || todo.content) : todo.content}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

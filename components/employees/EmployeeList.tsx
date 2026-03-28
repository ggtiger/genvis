"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { User, CheckCircle, Loader2, ExternalLink } from 'lucide-react';
import type { Employee } from '@/types/backend/employee';
import EmployeeFormModal from './EmployeeFormModal';
import { getAvatarIcon } from './EmployeeFormModal';


const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface EmployeeStats {
  task_count: number;
  total_tokens: number;
}

interface RunningTask {
  id: string;
  name: string;
  status: string;
  instruction?: string;
  createdAt: string;
}

interface EmployeeListProps {
  onAssignWork?: (employee: Employee, shiftKey?: boolean) => void;
  createTrigger?: number;
}

// Mode badge color mapping
function getModeBadgeClasses(mode: string): string {
  switch (mode) {
    case 'code': return 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300';
    case 'work': return 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300';
    case 'secretary': return 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300';
    case 'boss': return 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900 dark:text-yellow-300';
    case 'cli': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
    default: return 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300';
  }
}

export default function EmployeeList({ onAssignWork, createTrigger }: EmployeeListProps) {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stats, setStats] = useState<Record<string, EmployeeStats>>({});
  const [runningStatus, setRunningStatus] = useState<Record<string, RunningTask[]>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  const loadEmployees = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/employees`);
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load employees:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/employees/stats`);
      if (response.ok) {
        const data = await response.json();
        setStats(data.data || {});
      }
    } catch (error) {
      console.error('Failed to load employee stats:', error);
    }
  };

  const loadRunningStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/boss/employees-status`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
          const statusMap: Record<string, RunningTask[]> = {};
          for (const emp of data.data) {
            if (emp.runningTasks && emp.runningTasks.length > 0) {
              statusMap[emp.id] = emp.runningTasks;
            }
          }
          setRunningStatus(statusMap);
        }
      }
    } catch (error) {
      console.error('Failed to load running status:', error);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
    loadStats();
    loadRunningStatus();
    const interval = setInterval(loadRunningStatus, 15_000);
    return () => clearInterval(interval);
  }, [loadRunningStatus]);

  const handleCreate = () => {
    setEditingEmployee(null);
    setIsModalOpen(true);
  };

  // External trigger to open create modal
  useEffect(() => {
    if (createTrigger && createTrigger > 0) {
      handleCreate();
    }
  }, [createTrigger]);

  const handleEdit = (employee: Employee) => {
    setEditingEmployee(employee);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    setIsModalOpen(false);
    setEditingEmployee(null);
    await loadEmployees();
    setMessage({ type: 'success', text: editingEmployee ? '更新成功' : '创建成功' });
    setTimeout(() => setMessage(null), 2000);
  };

  const handleAssignWork = (employee: Employee, shiftKey?: boolean) => {
    if (onAssignWork) {
      onAssignWork(employee, shiftKey);
    }
  };

  const handleTaskClick = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    router.push(`/${projectId}/chat`);
  };

  // Collect all running tasks across employees for top summary
  const allRunningTasks = Object.entries(runningStatus).flatMap(([empId, tasks]) =>
    tasks.map(t => ({ ...t, empId }))
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">

      {/* Message */}
      {message && (
        <div className={`mx-6 mb-2 px-4 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* Running Tasks Summary Bar */}
      {allRunningTasks.length > 0 && (
        <div className="mx-6 mb-3 p-3 rounded-xl bg-green-50/80 dark:bg-green-500/10 border border-green-200/50 dark:border-green-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400 animate-spin" />
            <span className="text-xs font-semibold text-green-700 dark:text-green-400">
              {allRunningTasks.length} 个任务执行中
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allRunningTasks.slice(0, 6).map((task) => {
              const emp = employees.find(e => e.id === task.empId);
              return (
                <button
                  key={task.id}
                  onClick={(e) => handleTaskClick(e, task.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/60 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 border border-green-200/30 dark:border-green-500/15 text-xs transition-colors group"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
                  <span className="text-green-800 dark:text-green-300 truncate max-w-[120px] font-medium">
                    {emp?.name || '员工'}
                  </span>
                  <span className="text-green-600/50 dark:text-green-400/40 truncate max-w-[100px]">
                    {task.instruction || task.name}
                  </span>
                  <ExternalLink className="w-3 h-3 text-green-500/40 group-hover:text-green-600 dark:group-hover:text-green-300 shrink-0" />
                </button>
              );
            })}
            {allRunningTasks.length > 6 && (
              <span className="text-[10px] text-green-600/50 dark:text-green-400/40 self-center px-1">
                +{allRunningTasks.length - 6} 更多
              </span>
            )}
          </div>
        </div>
      )}

      {/* Employee Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-slate-500 dark:text-slate-400">加载中...</div>
          </div>
        ) : employees.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-20 h-20 rounded-full bg-white/50 dark:bg-white/10 border border-white/30 flex items-center justify-center mx-auto mb-4">
              <User className="w-10 h-10 text-slate-500 dark:text-slate-400" />
            </div>
            <p className="text-slate-500 dark:text-slate-400">暂无员工</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-2">点击右上角新建按钮创建员工</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-6">
            {employees.map((employee) => {
              const empStats = stats[employee.id];
              const taskCount = empStats?.task_count || 0;
              const hasTask = taskCount > 0;
              const empRunning = runningStatus[employee.id] || [];

              return (
                <div
                  key={employee.id}
                  className="glass-card rounded-2xl p-6 flex flex-col items-center text-center relative group cursor-pointer"
                  onClick={(e) => handleAssignWork(employee, e.shiftKey)}
                >
                  {/* Mode badge */}
                  <div className="absolute top-4 right-4">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${getModeBadgeClasses(employee.mode)}`}>
                      {employee.mode}
                    </span>
                  </div>

                  {/* Avatar with running indicator */}
                  {(() => {
                    const AvatarIcon = getAvatarIcon(employee.avatar);
                    const isRunning = empRunning.length > 0;
                    return (
                      <div className="w-20 h-20 rounded-full bg-white/50 dark:bg-white/10 flex items-center justify-center mb-4 border border-white/30 relative"
                        style={isRunning
                          ? { boxShadow: '0 0 0 3px rgba(34, 197, 94, 0.3), 0 0 20px rgba(34, 197, 94, 0.2)' }
                          : { boxShadow: '0 0 15px rgba(255, 255, 255, 0.3)' }
                        }
                      >
                        <AvatarIcon className="w-10 h-10 text-slate-700 dark:text-slate-300" />
                        {isRunning && (
                          <div className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center animate-pulse">
                            <span className="text-[9px] text-white font-bold">{empRunning.length}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Name */}
                  <h3 className="font-bold text-lg text-slate-800 dark:text-white mb-1">{employee.name}</h3>

                  {/* Description */}
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 h-8 line-clamp-2 px-2">
                    {employee.description || '\u00A0'}
                  </p>

                  {/* Running tasks indicator */}
                  {empRunning.length > 0 && (
                    <div className="w-full mb-2 space-y-1">
                      {empRunning.slice(0, 2).map((task) => (
                        <button
                          key={task.id}
                          onClick={(e) => handleTaskClick(e, task.id)}
                          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50/80 dark:bg-green-500/10 border border-green-200/40 dark:border-green-500/15 text-left hover:bg-green-100 dark:hover:bg-green-500/15 transition-colors"
                        >
                          <Loader2 className="w-3 h-3 text-green-500 animate-spin shrink-0" />
                          <span className="text-[11px] text-green-700 dark:text-green-400 truncate flex-1">
                            {task.instruction || task.name}
                          </span>
                          <ExternalLink className="w-3 h-3 text-green-400/50 shrink-0" />
                        </button>
                      ))}
                      {empRunning.length > 2 && (
                        <span className="text-[10px] text-green-600/50 dark:text-green-400/40 block text-center">
                          +{empRunning.length - 2} 个更多任务
                        </span>
                      )}
                    </div>
                  )}

                  {/* Task count pill */}
                  <div className={`mt-auto flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg w-full justify-center ${
                    hasTask
                      ? 'text-green-600 dark:text-green-400 bg-green-500/10'
                      : 'text-slate-500 dark:text-slate-400 bg-slate-500/10'
                  }`}>
                    <CheckCircle className="w-4 h-4" />
                    <span>已完成 {taskCount} 任务</span>
                  </div>

                  {/* Hover actions overlay */}
                  <div className="absolute inset-0 rounded-2xl bg-black/40 dark:bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAssignWork(employee, e.shiftKey); }}
                      className="px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-medium rounded-xl transition-colors shadow-lg"
                    >
                      派活
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEdit(employee); }}
                      className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white text-sm font-medium rounded-xl transition-colors backdrop-blur-sm"
                    >
                      设置
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      <EmployeeFormModal
        open={isModalOpen}
        employee={editingEmployee}
        onClose={() => {
          setIsModalOpen(false);
          setEditingEmployee(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
}

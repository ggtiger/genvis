"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';
const REFRESH_INTERVAL = Number(process.env.NEXT_PUBLIC_EMPLOYEE_STATUS_REFRESH_INTERVAL) * 1000 || 15000;

interface RunningTask {
  id: string;
  name: string;
  status: string;
  instruction?: string;
  createdAt: string;
}

interface EmployeeStatus {
  id: string;
  name: string;
  description?: string;
  category: string;
  mode: string;
  runningTasks: RunningTask[];
  totalTaskCount: number;
}

export default function EmployeeStatusPanel() {
  const [employees, setEmployees] = useState<EmployeeStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/boss/employees-status`);
        const data = await res.json();
        if (data.success) { setEmployees(data.data); }
      } catch (error) { console.error('Failed to fetch employee status:', error); }
      finally { setLoading(false); }
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  const handleTaskClick = (projectId: string) => {
    if (typeof window !== 'undefined' && (window as any).desktopAPI) {
      (window as any).desktopAPI.openNewWindow({ url: `/${projectId}/chat` }).catch((err: Error) => {
        console.error('Failed to open new window:', err);
        router.push(`/${projectId}/chat`);
      });
    } else {
      router.push(`/${projectId}/chat`);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-500 dark:text-slate-400">加载中...</div>
      </div>
    );
  }

  const refreshSeconds = REFRESH_INTERVAL / 1000;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">员工状态</h2>
        <span className="text-sm text-gray-500 dark:text-slate-500">自动刷新: {refreshSeconds}秒</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        {employees.map((employee) => {
          const isWorking = employee.runningTasks.length > 0;
          return (
            <div key={employee.id}
              className="bg-white/30 dark:bg-white/[0.06] backdrop-blur-sm rounded-lg shadow-sm hover:shadow-md transition-shadow border border-white/20 dark:border-white/10 p-3 relative">
              <div className="absolute top-2 right-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-400">
                  {employee.mode}
                </span>
              </div>
              <div className="flex justify-center mb-2">
                <User className="w-10 h-10 text-gray-400 dark:text-slate-500" />
              </div>
              <h3 className="font-semibold text-base text-gray-900 dark:text-white text-center mb-3 truncate px-1">
                {employee.name}
              </h3>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full ${
                  isWorking ? 'bg-green-50 dark:bg-green-500/15' : 'bg-gray-50 dark:bg-white/5'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isWorking ? 'bg-green-500' : 'bg-gray-400 dark:bg-slate-500'}`}></div>
                  <span className={`font-bold text-base ${isWorking ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-slate-400'}`}>{employee.runningTasks.length}</span>
                  <span className={`text-xs whitespace-nowrap ${isWorking ? 'text-green-700 dark:text-green-400' : 'text-gray-500 dark:text-slate-400'}`}>活动</span>
                </div>
                <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/10">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-slate-500"></div>
                  <span className="text-gray-600 dark:text-slate-300 font-semibold text-sm">{employee.totalTaskCount}</span>
                  <span className="text-gray-600 dark:text-slate-400 text-xs whitespace-nowrap">总计</span>
                </div>
              </div>
              {isWorking && (
                <div className="space-y-2 border-t border-gray-100 dark:border-white/10 pt-3">
                  {employee.runningTasks.slice(0, 2).map((task) => (
                    <div key={task.id}
                      className="flex items-start gap-2 text-sm bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 p-2 rounded cursor-pointer transition-colors group"
                      onClick={() => handleTaskClick(task.id)}>
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0 mt-1"></div>
                      <p className="text-gray-900 dark:text-white truncate flex-1 group-hover:text-gray-700 dark:group-hover:text-slate-200">{task.name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

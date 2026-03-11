'use client';

import { Clock, MapPin, Bell, Repeat, Trash2, Edit2 } from 'lucide-react';

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

interface ScheduleCardProps {
  schedule: Schedule;
  onEdit: (schedule: Schedule) => void;
  onDelete: (id: string) => void;
}

export default function ScheduleCard({ schedule, onEdit, onDelete }: ScheduleCardProps) {
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const getRepeatLabel = (type?: string) => {
    const labels: Record<string, string> = {
      daily: '每天',
      weekly: '每周',
      monthly: '每月',
    };
    return type ? labels[type] : null;
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div
          className="w-1 h-full min-h-[60px] rounded-full flex-shrink-0"
          style={{ backgroundColor: schedule.color || '#3b82f6' }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium text-gray-900 truncate">{schedule.title}</h3>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => onEdit(schedule)}
                className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => onDelete(schedule.id)}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {schedule.description && (
            <p className="text-sm text-gray-500 mt-1 line-clamp-2">{schedule.description}</p>
          )}
          
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {schedule.allDay ? (
                '全天'
              ) : (
                <>
                  {formatTime(schedule.startTime)}
                  {schedule.endTime && ` - ${formatTime(schedule.endTime)}`}
                </>
              )}
            </span>
            
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {formatDate(schedule.startTime)}
            </span>
            
            {schedule.reminderMinutes && (
              <span className="flex items-center gap-1 text-amber-600">
                <Bell className="w-3.5 h-3.5" />
                提前{schedule.reminderMinutes}分钟
              </span>
            )}
            
            {schedule.repeatType && schedule.repeatType !== 'none' && (
              <span className="flex items-center gap-1 text-blue-600">
                <Repeat className="w-3.5 h-3.5" />
                {getRepeatLabel(schedule.repeatType)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

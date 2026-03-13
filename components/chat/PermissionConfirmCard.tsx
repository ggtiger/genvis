"use client";

import { useState, useEffect } from 'react';
import { Check, X, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface PendingPermission {
  id: string;
  projectId: string;
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  inputPreview: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  securityWarning?: string;
}

interface PermissionConfirmCardProps {
  permission: PendingPermission;
  onResolved: (permissionId: string, approved: boolean) => void;
  isHistorical?: boolean;  // For displaying resolved permissions in history
}

// Tool name to Chinese label mapping
const TOOL_LABELS: Record<string, string> = {
  'Write': '写入文件',
  'Edit': '编辑文件',
  'Bash': '执行命令',
  'MultiEdit': '批量编辑',
  'NotebookEdit': '编辑笔记本',
};

export default function PermissionConfirmCard({
  permission,
  onResolved,
  isHistorical = false,
}: PermissionConfirmCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [remainingTime, setRemainingTime] = useState(0);

  // Calculate remaining time (only for pending permissions)
  useEffect(() => {
    if (isHistorical || permission.status !== 'pending') return;

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, permission.expiresAt - now);
      setRemainingTime(remaining);

      if (remaining === 0) {
        onResolved(permission.id, false);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [permission.expiresAt, permission.id, permission.status, isHistorical, onResolved]);

  const handleConfirm = async (approved: boolean) => {
    if (isSubmitting || isHistorical) return;
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/api/permissions/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissionId: permission.id,
          approved,
        }),
      });

      if (response.ok) {
        onResolved(permission.id, approved);
      } else {
        console.error('Failed to confirm permission');
        setIsSubmitting(false);
      }
    } catch (error) {
      console.error('Error confirming permission:', error);
      setIsSubmitting(false);
    }
  };

  const remainingSeconds = Math.ceil(remainingTime / 1000);
  const toolLabel = TOOL_LABELS[permission.toolName] || permission.toolName;
  const isPending = permission.status === 'pending' && !isHistorical;
  const hasSecurityWarning = !!permission.securityWarning;

  // Status indicator for historical permissions
  const getStatusBadge = () => {
    if (isPending) return null;

    switch (permission.status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
            <Check className="h-3 w-3" />
            已允许
          </span>
        );
      case 'denied':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded">
            <X className="h-3 w-3" />
            已拒绝
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-white/15 dark:bg-white/5 text-slate-500 dark:text-slate-400 rounded">
            已超时
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="my-2">
      {/* Inline card - flat design with subtle border */}
      <div className={`border rounded-lg p-3 ${
        hasSecurityWarning
          ? 'border-red-400 dark:border-red-500/60 bg-red-50/80 dark:bg-red-950/20'
          : isPending
            ? 'border-gray-300 bg-white/5 dark:bg-white/5'
            : 'border-white/15 dark:border-white/[0.06] bg-white'
      }`}>
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {hasSecurityWarning && (
              <ShieldAlert className="h-4 w-4 text-red-500 dark:text-red-400 flex-shrink-0" />
            )}
            <span className={`text-sm font-medium ${
              hasSecurityWarning
                ? 'text-red-700 dark:text-red-300'
                : 'text-slate-800 dark:text-white'
            }`}>
              {toolLabel}
            </span>
            {isPending && !hasSecurityWarning && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                需要确认
              </span>
            )}
            {isPending && hasSecurityWarning && (
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                越界操作 · 需要确认
              </span>
            )}
            {getStatusBadge()}
          </div>

          {/* Timer for pending */}
          {isPending && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {remainingSeconds}s
            </span>
          )}
        </div>

        {/* Security warning banner */}
        {hasSecurityWarning && (
          <div className="mt-2 p-2 bg-red-100/80 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 rounded text-xs">
            <pre className="text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">
              {permission.securityWarning}
            </pre>
          </div>
        )}

        {/* Preview toggle */}
        {permission.inputPreview && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 mt-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-300"
          >
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span>{isExpanded ? '收起' : '详情'}</span>
          </button>
        )}

        {/* Expanded preview */}
        {isExpanded && (
          <div className="mt-2 p-2 bg-white/15 dark:bg-white/5 rounded text-xs">
            <pre className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {permission.inputPreview}
            </pre>
          </div>
        )}

        {/* Action buttons - only for pending */}
        {isPending && (
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => handleConfirm(false)}
              disabled={isSubmitting}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 bg-white border border-gray-300 rounded hover:bg-white/5 dark:bg-white/5 disabled:opacity-50 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              <span>拒绝</span>
            </button>
            <button
              type="button"
              onClick={() => handleConfirm(true)}
              disabled={isSubmitting}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              <span>允许</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import React, { ReactNode, useCallback, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface PreviewErrorBoundaryProps {
  children: ReactNode;
  fileName?: string;
}

function PreviewErrorFallback({
  fileName,
  onRetry,
}: {
  fileName?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200 dark:border-red-800">
      <AlertTriangle className="w-10 h-10 text-red-500 mb-4" />
      <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
        预览加载失败
      </h2>
      {fileName && (
        <p className="text-sm text-red-600 dark:text-red-300 mb-1">
          文件：{fileName}
        </p>
      )}
      <p className="text-sm text-red-600 dark:text-red-300 mb-4 text-center max-w-md">
        渲染文档时发生错误，请点击重试按钮重新加载。
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        重试
      </button>
    </div>
  );
}

export function PreviewErrorBoundary({ children, fileName }: PreviewErrorBoundaryProps) {
  const [resetKey, setResetKey] = useState(0);

  const handleRetry = useCallback(() => {
    setResetKey((prev) => prev + 1);
  }, []);

  return (
    <ErrorBoundary
      key={resetKey}
      fallback={<PreviewErrorFallback fileName={fileName} onRetry={handleRetry} />}
      onError={(error) => {
        console.error(`[PreviewErrorBoundary] ${fileName ?? '未知文件'} 渲染失败:`, error);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

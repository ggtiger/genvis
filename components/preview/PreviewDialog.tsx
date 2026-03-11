'use client';

import { X } from 'lucide-react';
import DocumentPreview from './DocumentPreview';

interface PreviewDialogProps {
  file: File | null;
  onClose: () => void;
}

export default function PreviewDialog({ file, onClose }: PreviewDialogProps) {
  if (!file) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* 半透明遮罩 */}
      <div className="absolute inset-0 bg-black/50" />

      {/* 对话框 */}
      <div
        className="relative bg-white rounded-lg shadow-2xl flex flex-col"
        style={{ width: '90vw', height: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部：文件名 + 关闭按钮 */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 flex-shrink-0">
          <h3 className="text-sm font-medium text-gray-900 truncate">
            {file.name}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容区：DocumentPreview */}
        <div className="flex-1 overflow-auto">
          <DocumentPreview file={file} />
        </div>
      </div>
    </div>
  );
}

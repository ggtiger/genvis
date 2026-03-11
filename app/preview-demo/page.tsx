'use client';

import { useState, useRef } from 'react';
import DocumentPreview from '@/components/preview/DocumentPreview';
import { Upload, X } from 'lucide-react';

export default function DocumentPreviewDemo() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError('');
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError('');
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleClose = () => {
    setSelectedFile(null);
    setError('');
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* 头部 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-900">Office 文档预览测试</h1>
        <p className="text-sm text-gray-500 mt-1">
          支持 Word (.docx)、Excel (.xlsx)、PDF (.pdf) 格式预览
        </p>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 overflow-hidden">
        {!selectedFile ? (
          // 文件上传区域
          <div className="h-full flex items-center justify-center p-8">
            <div
              className="max-w-xl w-full border-2 border-dashed border-gray-300 rounded-lg p-12 text-center cursor-pointer hover:border-gray-400 transition-colors bg-white"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                上传文档进行预览
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                拖拽文件到此处,或点击选择文件
              </p>
              <p className="text-xs text-gray-400">
                支持格式: .docx, .xlsx, .pdf
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".doc,.docx,.xls,.xlsx,.pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>
        ) : (
          // 文档预览区域
          <div className="h-full relative">
            {/* 关闭按钮 */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 z-10 p-2 bg-white rounded-full shadow-md hover:bg-gray-100 transition-colors"
              title="关闭预览"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>

            {/* 预览组件 */}
            <DocumentPreview
              file={selectedFile}
              onError={(err) => setError(err)}
              onClose={handleClose}
            />

            {/* 错误提示 */}
            {error && (
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-50 border border-red-200 rounded-lg px-4 py-2 shadow-md">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

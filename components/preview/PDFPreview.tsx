'use client';

import { useState, useEffect } from 'react';
import { FileText, Loader2, AlertCircle, ZoomIn, ZoomOut } from 'lucide-react';

interface PDFPreviewProps {
  file: File;
  onError?: (error: string) => void;
}

export default function PDFPreview({ file, onError }: PDFPreviewProps) {
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [zoom, setZoom] = useState<number>(100);

  useEffect(() => {
    loadPDF();
    
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [file]);

  async function loadPDF() {
    setLoading(true);
    setError('');
    
    try {
      // 创建 Blob URL 用于 iframe 显示
      const url = URL.createObjectURL(file);
      setPdfUrl(url);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '未知错误';
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  const handleZoomIn = () => {
    setZoom(prev => Math.min(200, prev + 10));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(50, prev - 10));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-white">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin mb-3" />
        <p className="text-sm text-gray-500">正在加载 PDF 文档...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-white">
        <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
        <p className="text-sm text-red-600 mb-2">文档加载失败</p>
        <p className="text-xs text-gray-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-white overflow-hidden flex flex-col">
      {/* 头部工具栏 */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-medium text-gray-700">{file.name}</span>
          <span className="text-xs text-gray-400">
            {(file.size / 1024).toFixed(1)} KB
          </span>
        </div>

        {/* 缩放控制 */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded hover:bg-gray-200 transition-colors"
            title="缩小"
          >
            <ZoomOut className="w-4 h-4 text-gray-600" />
          </button>
          <span className="text-xs text-gray-600 min-w-[3rem] text-center">
            {zoom}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded hover:bg-gray-200 transition-colors"
            title="放大"
          >
            <ZoomIn className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* PDF 内容 */}
      <div className="flex-1 overflow-auto bg-gray-100 p-4">
        <div 
          className="mx-auto bg-white shadow-lg"
          style={{ 
            width: `${zoom}%`,
            minHeight: '100%'
          }}
        >
          <iframe
            src={`${pdfUrl}#toolbar=1&navpanes=1&scrollbar=1`}
            className="w-full h-full min-h-[600px]"
            title={file.name}
          />
        </div>
      </div>
    </div>
  );
}

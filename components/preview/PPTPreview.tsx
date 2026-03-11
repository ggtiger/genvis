'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, AlertCircle, ZoomIn, ZoomOut } from 'lucide-react';

interface PPTPreviewProps {
  file: File;
  onError?: (error: string) => void;
  onToolbarChange?: (toolbar: {
    onSave?: () => void;
    onEdit?: () => void;
    onCancelEdit?: () => void;
    onDownload?: () => void;
    hasChanges?: boolean;
    saving?: boolean;
    isEditing?: boolean;
  } | null) => void;
}

export default function PPTPreview({ file, onError, onToolbarChange }: PPTPreviewProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [totalSlides, setTotalSlides] = useState<number>(0);
  const [scale, setScale] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const pptxPreviewRef = useRef<any>(null);
  const downloadRef = useRef<() => void>(() => {});
  const onToolbarChangeRef = useRef(onToolbarChange);
  onToolbarChangeRef.current = onToolbarChange;

  useEffect(() => {
    let isMounted = true;

    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
    pptxPreviewRef.current = null;

    async function loadPPTXPreview() {
      if (!containerRef.current) return;

      setLoading(true);
      setError('');

      try {
        const { init } = await import('pptx-preview');

        if (!isMounted || !containerRef.current) return;

        containerRef.current.innerHTML = '';

        const arrayBuffer = await file.arrayBuffer();

        if (!isMounted || !containerRef.current) return;

        const previewer = init(containerRef.current, {
          width: 960,
          height: 540,
        });

        pptxPreviewRef.current = previewer;

        await previewer.preview(arrayBuffer);

        if (!isMounted) return;

        const slideCount = previewer.slideCount || 0;
        setTotalSlides(slideCount);
      } catch (err) {
        console.error('[PPTPreview] PPT 渲染失败:', err);
        if (isMounted) {
          const errorMsg = err instanceof Error ? err.message : '未知错误';
          setError(errorMsg);
          onError?.(errorMsg);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadPPTXPreview();

    return () => {
      isMounted = false;
      pptxPreviewRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [file]);

  // Keep download ref up to date
  downloadRef.current = () => {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const stableDownload = useCallback(() => { downloadRef.current(); }, []);

  // Expose toolbar
  useEffect(() => {
    if (!loading && !error) {
      onToolbarChangeRef.current?.({
        onDownload: stableDownload,
      });
    } else {
      onToolbarChangeRef.current?.(null);
    }
  }, [loading, error]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { onToolbarChangeRef.current?.(null); };
  }, []);

  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.1, 2));
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.1, 0.5));

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-white">
        <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
        <p className="text-sm text-red-600 mb-2">文档渲染失败</p>
        <p className="text-xs text-gray-500 mb-4">{error}</p>
        <button
          onClick={stableDownload}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          下载查看完整内容
        </button>
      </div>
    );
  }

  return (
    <div className="h-full bg-white overflow-hidden flex flex-col relative">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-50">
          <Loader2 className="w-8 h-8 text-gray-400 animate-spin mb-3" />
          <p className="text-sm text-gray-500">正在渲染 PPT 文档...</p>
          <p className="text-xs text-gray-400 mt-1">首次加载可能需要几秒钟</p>
        </div>
      )}

      {/* Zoom controls — inline, no header bar */}
      {!loading && totalSlides > 0 && (
        <div className="flex items-center gap-1 px-4 py-1.5 bg-gray-50 border-b border-gray-200">
          <span className="text-xs text-gray-500 mr-2">{totalSlides} slides</span>
          <button onClick={handleZoomOut} className="p-1 rounded hover:bg-gray-200" title="Zoom out">
            <ZoomOut className="w-3.5 h-3.5 text-gray-600" />
          </button>
          <span className="text-xs text-gray-600 font-medium min-w-[3rem] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button onClick={handleZoomIn} className="p-1 rounded hover:bg-gray-200" title="Zoom in">
            <ZoomIn className="w-3.5 h-3.5 text-gray-600" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center p-6">
        <div
          ref={containerRef}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top center',
            transition: 'transform 0.2s ease',
          }}
          className="pptx-preview-container"
        />
      </div>
    </div>
  );
}

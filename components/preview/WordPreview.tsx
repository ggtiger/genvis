'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, AlertCircle } from 'lucide-react';
import { markdownToWord, type ConversionResult } from '@/lib/services/document-converter';
import dynamic from 'next/dynamic';

const SimpleMDE = dynamic(() => import('react-simplemde-editor'), { ssr: false });

interface WordPreviewProps {
  file: File;
  onError?: (error: string) => void;
  onSave?: (file: File) => Promise<void>;
  editable?: boolean;
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

export default function WordPreview({ file, onError, onSave, editable = false, onToolbarChange }: WordPreviewProps) {
  const [markdown, setMarkdown] = useState<string>('');
  const [editedMarkdown, setEditedMarkdown] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [mdeReady, setMdeReady] = useState<boolean>(false);

  // Refs to hold latest implementations — avoids unstable deps in toolbar effect
  const saveRef = useRef<() => void>(() => {});
  const editRef = useRef<() => void>(() => {});
  const cancelEditRef = useRef<() => void>(() => {});
  const downloadRef = useRef<() => void>(() => {});
  const onToolbarChangeRef = useRef(onToolbarChange);
  onToolbarChangeRef.current = onToolbarChange;

  useEffect(() => {
    let cancelled = false;

    async function convertDocument() {
      setLoading(true);
      setError('');
      
      try {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        const response = await fetch('/api/convert/word-to-markdown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: base64 }),
        });

        if (cancelled) return;

        const result: ConversionResult = await response.json();
        
        if (result.success) {
          setMarkdown(result.markdown);
          setEditedMarkdown(result.markdown);
        } else {
          const errorMsg = result.error || 'Word 文档转换失败';
          setError(errorMsg);
          onError?.(errorMsg);
        }
      } catch (err) {
        if (cancelled) return;
        const errorMsg = err instanceof Error ? err.message : '未知错误';
        setError(errorMsg);
        onError?.(errorMsg);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    convertDocument();
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    if (typeof window !== 'undefined' && !mdeReady) {
      import('easymde/dist/easymde.min.css').then(() => setMdeReady(true));
    }
  }, [mdeReady]);

  // Keep refs up to date with latest closures
  saveRef.current = async () => {
    if (!onSave || !hasChanges) return;
    setSaving(true);
    try {
      const newFile = await markdownToWord(editedMarkdown, file.name);
      await onSave(newFile);
      setMarkdown(editedMarkdown);
      setHasChanges(false);
      setIsEditing(false);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  editRef.current = () => { setIsEditing(true); };

  cancelEditRef.current = () => {
    setEditedMarkdown(markdown);
    setIsEditing(false);
    setHasChanges(false);
  };

  downloadRef.current = async () => {
    try {
      const docFile = await markdownToWord(editedMarkdown, file.name);
      const url = URL.createObjectURL(docFile);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '下载失败');
    }
  };

  const handleMarkdownChange = useCallback((value: string) => {
    setEditedMarkdown(value);
    setHasChanges(value !== markdown);
  }, [markdown]);

  // Stable wrapper functions that delegate to refs
  const stableSave = useCallback(() => { saveRef.current(); }, []);
  const stableEdit = useCallback(() => { editRef.current(); }, []);
  const stableCancelEdit = useCallback(() => { cancelEditRef.current(); }, []);
  const stableDownload = useCallback(() => { downloadRef.current(); }, []);

  // Expose toolbar — only re-fires when primitive state values change
  useEffect(() => {
    if (!loading && !error) {
      onToolbarChangeRef.current?.({
        onSave: stableSave,
        onEdit: editable ? stableEdit : undefined,
        onCancelEdit: stableCancelEdit,
        onDownload: stableDownload,
        hasChanges,
        saving,
        isEditing,
      });
    } else {
      onToolbarChangeRef.current?.(null);
    }
  }, [loading, error, hasChanges, saving, isEditing, editable]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { onToolbarChangeRef.current?.(null); };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-white">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin mb-3" />
        <p className="text-sm text-gray-500">正在解析 Word 文档...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-white">
        <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
        <p className="text-sm text-red-600 mb-2">文档解析失败</p>
        <p className="text-xs text-gray-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-white overflow-hidden flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {isEditing ? (
          mdeReady && (
            <div className="h-full">
              <SimpleMDE
                value={editedMarkdown}
                onChange={handleMarkdownChange}
                options={{
                  spellChecker: false,
                  status: false,
                  toolbar: [
                    'bold', 'italic', 'heading', '|',
                    'quote', 'unordered-list', 'ordered-list', '|',
                    'link', 'image', '|',
                    'preview', 'side-by-side', 'fullscreen',
                  ],
                }}
              />
            </div>
          )
        ) : (
          <div className="px-6 py-6">
            <div className="max-w-4xl mx-auto">
              <article className="prose prose-sm max-w-none
                prose-headings:text-gray-900
                prose-h1:text-2xl prose-h1:font-bold prose-h1:mb-4 prose-h1:mt-6
                prose-h2:text-xl prose-h2:font-bold prose-h2:mb-3 prose-h2:mt-5
                prose-h3:text-lg prose-h3:font-semibold prose-h3:mb-2 prose-h3:mt-4
                prose-p:text-gray-700 prose-p:leading-relaxed prose-p:mb-4
                prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                prose-strong:text-gray-900 prose-strong:font-semibold
                prose-ul:list-disc prose-ul:pl-6 prose-ul:mb-4
                prose-ol:list-decimal prose-ol:pl-6 prose-ol:mb-4
                prose-li:text-gray-700 prose-li:mb-1
                prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
                prose-pre:bg-gray-100 prose-pre:p-4 prose-pre:rounded prose-pre:overflow-x-auto
                prose-blockquote:border-l-4 prose-blockquote:border-gray-300 prose-blockquote:pl-4 prose-blockquote:italic
                prose-table:border-collapse prose-table:w-full
                prose-th:bg-gray-100 prose-th:border prose-th:border-gray-300 prose-th:px-3 prose-th:py-2 prose-th:text-left
                prose-td:border prose-td:border-gray-300 prose-td:px-3 prose-td:py-2
                prose-img:rounded prose-img:shadow-sm
              ">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {markdown}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

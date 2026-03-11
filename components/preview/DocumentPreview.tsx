'use client';

import { detectFileType } from '@/lib/services/document-converter';
import WordPreview from './WordPreview';
import ExcelPreview from './ExcelPreview';
import PDFPreview from './PDFPreview';
import PPTPreview from './PPTPreview';
import { PreviewErrorBoundary } from './PreviewErrorBoundary';
import { AlertCircle } from 'lucide-react';

interface DocumentPreviewProps {
  file: File;
  onError?: (error: string) => void;
  onClose?: () => void;
  editable?: boolean;
  onSave?: (file: File) => Promise<void>;
}

export default function DocumentPreview({ file, onError, onClose, editable, onSave }: DocumentPreviewProps) {
  const fileType = detectFileType(file);

  switch (fileType) {
    case 'word':
      return (
        <PreviewErrorBoundary fileName={file.name}>
          <WordPreview file={file} onError={onError} editable={editable} onSave={onSave} />
        </PreviewErrorBoundary>
      );
    case 'excel':
      return (
        <PreviewErrorBoundary fileName={file.name}>
          <ExcelPreview file={file} onError={onError} editable={editable} onSave={onSave} />
        </PreviewErrorBoundary>
      );
    case 'ppt':
      return (
        <PreviewErrorBoundary fileName={file.name}>
          <PPTPreview file={file} onError={onError} />
        </PreviewErrorBoundary>
      );
    case 'pdf':
      return (
        <PreviewErrorBoundary fileName={file.name}>
          <PDFPreview file={file} onError={onError} />
        </PreviewErrorBoundary>
      );
    default:
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-white">
          <AlertCircle className="w-8 h-8 text-gray-400 mb-3" />
          <p className="text-sm text-gray-600 mb-2">不支持的文件类型</p>
          <p className="text-xs text-gray-500">
            当前仅支持 .docx, .xlsx, .pptx, .pdf 格式
          </p>
        </div>
      );
  }
}

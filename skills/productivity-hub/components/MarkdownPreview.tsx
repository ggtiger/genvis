'use client';

import { useEffect, useRef } from 'react';
import Vditor from 'vditor';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export default function MarkdownPreview({
  content,
  className = ''
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !content) return;

    // 使用 Vditor 的预览功能渲染 Markdown
    Vditor.preview(containerRef.current, content, {
      mode: 'light',
      cdn: 'https://unpkg.com/vditor@3.11.2',
    });
  }, [content]);

  return (
    <div
      ref={containerRef}
      className={`vditor-preview ${className}`}
    />
  );
}

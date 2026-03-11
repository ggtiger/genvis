'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';

interface EmbeddedPageViewProps {
  url: string;
  title?: string;
  onBack: () => void;
}

/**
 * Full-area embedded page view with a back button header.
 * Renders an iframe that fills the entire content area, 
 * matching the project's glass-card style.
 */
export default function EmbeddedPageView({ url, title, onBack }: EmbeddedPageViewProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden glass-card m-2 rounded-2xl h-[calc(100%-16px)]">
      {/* Header with back button */}
      <header className="h-12 flex items-center justify-between px-4 shrink-0 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回</span>
          </button>
          {title && (
            <>
              <div className="w-px h-4 bg-slate-300/40 dark:bg-white/10" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</span>
            </>
          )}
        </div>
        <button
          onClick={() => window.open(url, '_blank')}
          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-white/30 dark:hover:bg-white/10 rounded-lg transition-colors"
          title="在新窗口打开"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </header>

      {/* Iframe content */}
      <div className="flex-1 overflow-hidden rounded-b-2xl">
        <iframe
          src={url}
          className="w-full h-full border-0"
          title={title || '页面'}
        />
      </div>
    </div>
  );
}

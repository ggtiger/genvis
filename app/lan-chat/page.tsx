'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import LanChatLayout from '@/components/lan-chat/LanChatLayout';

export default function LanChatPage() {
  const router = useRouter();

  return (
    <div className="h-screen flex items-center justify-center p-0 md:p-0 overflow-hidden">
      <div className="glass flex flex-col h-full w-full rounded-none md:rounded-3xl shadow-2xl overflow-hidden relative">
        <header className="h-14 flex items-center px-6 shrink-0 backdrop-blur-md border-b border-white/10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/workspace')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/10 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>返回</span>
            </button>
            <div className="w-px h-4 bg-slate-300/40 dark:bg-white/10" />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">局域网聊天</span>
          </div>
        </header>
        <div className="flex-1 overflow-hidden">
          <LanChatLayout />
        </div>
      </div>
    </div>
  );
}

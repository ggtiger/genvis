'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Radio } from 'lucide-react';
import LanChatLayout from '@/components/lan-chat/LanChatLayout';

export default function LanChatPage() {
  const router = useRouter();

  return (
    <div className="h-screen flex items-center justify-center p-0 md:p-0 overflow-hidden">
      <div className="glass flex flex-col h-full w-full rounded-none md:rounded-3xl shadow-2xl overflow-hidden relative">
        <header className="h-12 flex items-center px-5 shrink-0 border-b border-white/8 dark:border-white/[0.03] backdrop-blur-sm bg-white/20 dark:bg-white/[0.01]">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => router.push('/workspace')}
              className="flex items-center gap-1 px-2 py-1.5 text-[13px] text-text-secondary/70 hover:text-text-main hover:bg-white/30 dark:hover:bg-white/5 rounded-lg transition-all"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回</span>
            </button>
            <div className="w-px h-3.5 bg-white/10 dark:bg-white/[0.06]" />
            <div className="flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-primary/60" />
              <span className="text-[13px] font-semibold text-text-main">局域网聊天</span>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-hidden">
          <LanChatLayout />
        </div>
      </div>
    </div>
  );
}

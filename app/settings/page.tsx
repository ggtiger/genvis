"use client";

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppSidebar from '@/components/layout/AppSidebar';
import GlobalSettings from '@/components/settings/GlobalSettings';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

function SettingsContent() {
  const [isClosing, setIsClosing] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab') as 'ai-agents' | 'services' | 'skills' | null;

  const loadProjects = useCallback(async () => {
    try {
      // Use optimized recent projects endpoint - only fetches 5 items
      const r = await fetch(`${API_BASE}/api/projects/recent`);
      if (!r.ok) return;
      const payload = await r.json();
      const items = payload.success && Array.isArray(payload.data) ? payload.data : [];
      setProjects(items);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div className="h-screen flex items-center justify-center p-0 md:p-4 overflow-hidden"
      style={{
        background: "url('https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=2070') no-repeat center center fixed",
        backgroundSize: 'cover',
        // Performance optimization for scroll
        transform: 'translateZ(0)',
        willChange: 'transform',
      }}
    >
      <div className="flex h-full w-full max-w-[1600px] glass rounded-none md:rounded-2xl shadow-xl overflow-hidden">
      {/* App Sidebar */}
      <AppSidebar
        currentPage="settings"
        onNavigate={(page) => {
          if (page === 'settings') {
            return;
          }
          if (window.opener) {
            window.opener.focus();
            window.close();
          } else {
            window.location.href = '/';
          }
        }}
      />

      {/* Settings Content */}
      <div className="flex-1 overflow-hidden">
        <GlobalSettings
          isOpen={true}
          embedded={true}
          onClose={() => {
            setIsClosing(true);
            setTimeout(() => {
              if (window.opener) {
                window.close();
              } else {
                window.location.href = '/';
              }
            }, 200);
          }}
          initialTab={tabParam || "ai-agents"}
        />
      </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-white/20 dark:bg-slate-900/50 flex items-center justify-center text-slate-900 dark:text-slate-100">加载中...</div>}>
      <SettingsContent />
    </Suspense>
  );
}

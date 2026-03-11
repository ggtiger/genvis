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
      const r = await fetch(`${API_BASE}/api/projects`);
      if (!r.ok) return;
      const payload = await r.json();
      const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
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
        recentApps={projects.slice(0, 5).map((p: any, i: number) => ({
          id: p.id || p.project_id || String(i),
          name: p.name || p.description?.slice(0, 20) || '未命名项目',
          status: p.status,
          deployedUrl: p.deployedUrl,
          dependenciesInstalled: p.dependenciesInstalled,
        }))}
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

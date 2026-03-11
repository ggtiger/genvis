/**
 * Project Settings Component (Refactored)
 * Main settings modal with tabs
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Settings, Lock } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { GeneralSettings } from './GeneralSettings';
import { EnvironmentSettings } from './EnvironmentSettings';

interface ProjectSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  projectDescription?: string | null;
  initialTab?: SettingsTab;
  onProjectUpdated?: (update: { name: string; description?: string | null }) => void;
}

type SettingsTab = 'general' | 'environment';

export function ProjectSettings({
  isOpen,
  onClose,
  projectId,
  projectName,
  projectDescription = '',
  initialTab = 'general',
  onProjectUpdated,
}: ProjectSettingsProps) {
  const isProjectScoped = Boolean(projectId && projectId !== 'global-settings');

  const tabs = useMemo(
    () =>
      [
        {
          id: 'general' as SettingsTab,
          label: '基本设置',
          icon: <span className="w-4 h-4 inline-flex"><Settings className="w-4 h-4" /></span>,
          hidden: !isProjectScoped,
        },
        {
          id: 'environment' as SettingsTab,
          label: '环境变量',
          icon: <span className="w-4 h-4 inline-flex"><Lock className="w-4 h-4" /></span>,
        },
      ].filter(tab => !('hidden' in tab) || !tab.hidden),
    [isProjectScoped]
  );

  const resolvedInitialTab = useMemo<SettingsTab>(() => {
    const availableTabs = tabs.map(tab => tab.id);
    if (initialTab && availableTabs.includes(initialTab)) {
      return initialTab;
    }
    return tabs[0]?.id ?? 'environment';
  }, [initialTab, tabs]);

  const [activeTab, setActiveTab] = useState<SettingsTab>(resolvedInitialTab);

  useEffect(() => {
    setActiveTab(resolvedInitialTab);
  }, [resolvedInitialTab]);

  const availableTabs = tabs.length ? tabs : [
    {
      id: 'environment' as SettingsTab,
      label: '环境变量',
      icon: <span className="w-4 h-4 inline-flex"><Lock className="w-4 h-4" /></span>,
    },
  ];

  return (
    <>
    <SettingsModal
      isOpen={isOpen}
      onClose={onClose}
      title="Project Settings"
      icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>}
    >
        <div className="flex h-full">
          {/* Sidebar Tabs */}
          <div className="w-56 bg-white/80 dark:bg-white/[0.04] border-r border-gray-200 dark:border-white/10">
          <nav className="p-4">
            <div className="rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden">
            {availableTabs.map((tab, index) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-200 ${
                  index > 0 ? 'border-t border-gray-200 dark:border-white/10' : ''
                } ${
                  activeTab === tab.id
                    ? 'bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white'
                    : 'hover:bg-gray-50 dark:hover:bg-white/5 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <span className={activeTab === tab.id ? 'text-gray-700 dark:text-slate-300' : 'text-gray-400 dark:text-slate-500'}>
                  {tab.icon}
                </span>
                <span className="text-sm font-medium">{tab.label}</span>
              </button>
            ))}
            </div>
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-white/80 dark:bg-transparent">
          {activeTab === 'general' && isProjectScoped && (
            <GeneralSettings
              projectId={projectId}
              projectName={projectName}
              projectDescription={projectDescription ?? ''}
              onProjectUpdated={onProjectUpdated}
            />
          )}

          {activeTab === 'environment' && (
            <EnvironmentSettings projectId={projectId} />
          )}
        </div>
      </div>
    </SettingsModal>
    </>
  );
}

export default ProjectSettings;

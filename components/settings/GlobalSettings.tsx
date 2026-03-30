"use client";
import { useState, useEffect, useCallback, useMemo, memo, lazy, Suspense } from 'react';
import Image from 'next/image';
import { Settings } from 'lucide-react';
import { MemorySettingsPanel } from '@/components/settings/MemorySettingsPanel';
import SoulSettings from '@/components/settings/SoulSettings';
import SkillsSettings from '@/components/settings/SkillsSettings';
import IMChannelSettings from '@/components/settings/IMChannelSettings';
import LanPeerSettings from '@/components/settings/LanPeerSettings';
import { useGlobalSettings } from '@/contexts/GlobalSettingsContext';
import { useTheme, THEME_OPTIONS, PRIMARY_COLORS } from '@/contexts/ThemeContext';
import { getModelDefinitionsForCli, normalizeModelId } from '@/lib/constants/cliModels';
import { fetchCliStatusSnapshot, createCliStatusFallback } from '@/hooks/useCLI';
import type { CLIStatus } from '@/types/cli';

// Lazy load tabs for better initial load performance
const AppearanceTab = lazy(() => import('./tabs/AppearanceTab'));
const ASRTab = lazy(() => import('./tabs/ASRTab'));
const BasicTab = lazy(() => import('./tabs/BasicTab'));
const ServicesTab = lazy(() => import('./tabs/ServicesTab'));
const AboutTab = lazy(() => import('./tabs/AboutTab'));

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface GlobalSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: string;
  embedded?: boolean; // New prop for non-modal mode
}

interface CLIOption {
  id: string;
  name: string;
  icon: string;
  description: string;
  models: { id: string; name: string; }[];
  color: string;
  brandColor: string;
  downloadUrl: string;
  installCommand: string;
  enabled?: boolean;
}

const CLI_OPTIONS: CLIOption[] = [
  {
    id: 'claude',
    name: 'Claude兼容API',
    icon: '',
    description: '暂时不支持openai API',
    color: 'from-gray-700 to-gray-900',
    brandColor: '#374151',
    downloadUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    enabled: true,
    models: getModelDefinitionsForCli('claude').map(({ id, name }) => ({ id, name })),
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    icon: '',
    description: 'OpenAI Codex agent with GPT-5 support',
    color: 'from-slate-900 to-gray-700',
    brandColor: '#000000',
    downloadUrl: 'https://github.com/openai/codex',
    installCommand: 'npm install -g @openai/codex',
    enabled: false,
    models: getModelDefinitionsForCli('codex').map(({ id, name }) => ({ id, name })),
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    icon: '',
    description: 'Cursor CLI with multi-model router and autonomous tooling',
    color: 'from-slate-500 to-gray-600',
    brandColor: '#6B7280',
    downloadUrl: 'https://docs.cursor.com/en/cli/overview',
    installCommand: 'curl https://cursor.com/install -fsS | bash',
    enabled: false,
    models: getModelDefinitionsForCli('cursor').map(({ id, name }) => ({ id, name })),
  },
  {
    id: 'qwen',
    name: 'Qwen Coder',
    icon: '',
    description: 'Alibaba Qwen Code CLI with sandbox capabilities',
    color: 'from-emerald-500 to-teal-600',
    brandColor: '#11A97D',
    downloadUrl: 'https://github.com/QwenLM/qwen-code',
    installCommand: 'npm install -g @qwen-code/qwen-code',
    enabled: false,
    models: getModelDefinitionsForCli('qwen').map(({ id, name }) => ({ id, name })),
  },
  {
    id: 'glm',
    name: 'GLM CLI',
    icon: '',
    description: 'Zhipu GLM agent running on Claude Code runtime',
    color: 'from-blue-500 to-indigo-600',
    brandColor: '#1677FF',
    downloadUrl: 'https://docs.z.ai/devpack/tool/claude',
    installCommand: 'zai devpack install claude',
    enabled: false,
    models: getModelDefinitionsForCli('glm').map(({ id, name }) => ({ id, name })),
  },
];

// Global settings are provided by context

type SettingsTabId = 'general' | 'ai-agents' | 'asr' | 'services' | 'basic' | 'memory' | 'soul' | 'skills' | 'im-channels' | 'lan-peer' | 'appearance' | 'about';

/** Tab configuration - defined outside component to avoid recreation on each render */
const SETTINGS_TABS: { id: SettingsTabId; label: string; icon: React.ReactNode }[] = [
  { id: 'ai-agents', label: 'LLM API', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> },
  { id: 'appearance', label: '外观', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> },
  { id: 'asr', label: 'ASR', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> },
  { id: 'skills', label: '技能', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> },
  { id: 'im-channels', label: 'IM 渠道', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
  { id: 'lan-peer', label: '局域网聊天', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  { id: 'services', label: 'Services', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
  { id: 'memory', label: '记忆管理', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> },
  { id: 'soul', label: '灵魂设定', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> },
  { id: 'basic', label: 'Basic', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg> },
  { id: 'about', label: '关于', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
];

/** Memoized child components to prevent re-render on tab switch */
const MemoizedSkillsSettings = memo(SkillsSettings);
const MemoizedIMChannelSettings = memo(IMChannelSettings);
const MemoizedLanPeerSettings = memo(LanPeerSettings);
const MemoizedMemorySettingsPanel = memo(MemorySettingsPanel);
const MemoizedSoulSettings = memo(SoulSettings);

export default function GlobalSettings({ isOpen, onClose, initialTab = 'ai-agents', embedded = false }: GlobalSettingsProps) {
  // Parse skills-market as skills tab with market sub-tab
  const resolvedTab = initialTab === 'skills-market' ? 'skills' : (initialTab === 'general' ? 'ai-agents' : initialTab);
  const skillsSubTab = initialTab === 'skills-market' ? 'market' : undefined;
  const [activeTab, setActiveTab] = useState<SettingsTabId>(resolvedTab as SettingsTabId);
  const [skillsInitialSubTab, setSkillsInitialSubTab] = useState<'my-skills' | 'market' | undefined>(skillsSubTab);
  const [visitedTabs, setVisitedTabs] = useState<Set<SettingsTabId>>(() => new Set([activeTab]));
  const [cliStatus, setCLIStatus] = useState<CLIStatus>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { settings: globalSettings, setSettings: setGlobalSettings, refresh: refreshGlobalSettings } = useGlobalSettings();
  const [isLoading, setIsLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [selectedCLI, setSelectedCLI] = useState<CLIOption | null>(null);
  const [apiKeyVisibility, setApiKeyVisibility] = useState<Record<string, boolean>>({});
  const [apiTestState, setApiTestState] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [apiTestMessage, setApiTestMessage] = useState<Record<string, string>>({});

  // Sync active tab when initialTab changes (e.g., opened from a specific banner)
  useEffect(() => {
    if (isOpen && initialTab) {
      const tab = (initialTab === 'skills-market' ? 'skills' : initialTab === 'general' ? 'ai-agents' : initialTab) as SettingsTabId;
      if (SETTINGS_TABS.some(t => t.id === tab)) {
        setActiveTab(tab);
        setVisitedTabs(prev => new Set([...prev, tab]));
      }
      // Handle skills-market sub-tab
      setSkillsInitialSubTab(initialTab === 'skills-market' ? 'market' : undefined);
    }
  }, [isOpen, initialTab]);

  // Show toast function
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const copyTextSafe = async (text: string): Promise<boolean> => {
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function' &&
        (typeof document === 'undefined' || document.hasFocus())
      ) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      throw new Error('clipboard_unavailable');
    } catch {
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('readonly', '');
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        if (!ok) throw new Error('exec_command_failed');
        return true;
      } catch {
        return false;
      }
    }
  };

  const loadGlobalSettings = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/settings/global`);
      if (response.ok) {
        const settings = await response.json();
        if (settings?.cli_settings) {
          for (const [cli, config] of Object.entries(settings.cli_settings)) {
            if (config && typeof config === 'object' && 'model' in config) {
              (config as any).model = normalizeModelId(cli, (config as any).model as string);
            }
          }
        }
        setGlobalSettings(settings);
      }
    } catch (error) {
      console.error('Failed to load global settings:', error);
    }
  }, [setGlobalSettings]);

  const checkCLIStatus = useCallback(async () => {
    const checkingStatus: CLIStatus = CLI_OPTIONS.reduce((acc, cli) => {
      acc[cli.id] = { installed: true, checking: true };
      return acc;
    }, {} as CLIStatus);
    setCLIStatus(checkingStatus);

    try {
      const status = await fetchCliStatusSnapshot();
      setCLIStatus(status);
    } catch (error) {
      console.error('Error checking CLI status:', error);
      setCLIStatus(createCliStatusFallback());
    }
  }, []);

  // Load all service tokens and CLI data
  useEffect(() => {
    if (isOpen) {
      // 并行加载 settings
      loadGlobalSettings();
      // 延迟 CLI 状态检查，不阻塞首屏渲染
      const timer = setTimeout(() => checkCLIStatus(), 500);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Track visited tabs for instant switching (display:none + lazy mount)
  useEffect(() => {
    setVisitedTabs(prev => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  const saveGlobalSettings = async () => {
    setIsLoading(true);
    setSaveMessage(null);
    
    try {
      const payload = JSON.parse(JSON.stringify(globalSettings));
      if (payload?.cli_settings) {
        for (const [cli, config] of Object.entries(payload.cli_settings)) {
          if (config && typeof config === 'object' && 'model' in config) {
            (config as any).model = normalizeModelId(cli, (config as any).model as string);
          }
        }
      }

      const response = await fetch(`${API_BASE}/api/settings/global`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error('Failed to save settings');
      }
      
      setSaveMessage({ 
        type: 'success', 
        text: 'Settings saved successfully!' 
      });
      // make sure context stays in sync
      try {
        await refreshGlobalSettings();
      } catch {}
      
      // Clear message after 3 seconds
      setTimeout(() => setSaveMessage(null), 3000);
      
    } catch (error) {
      console.error('Failed to save global settings:', error);
      setSaveMessage({ 
        type: 'error', 
        text: 'Failed to save settings. Please try again.' 
      });
      
      // Clear error message after 5 seconds
      setTimeout(() => setSaveMessage(null), 5000);
    } finally {
      setIsLoading(false);
    }
  };


  const setDefaultCLI = (cliId: string) => {
    const cliInstalled = cliStatus[cliId]?.installed;
    if (!cliInstalled) return;
    
    setGlobalSettings(prev => ({
      ...prev,
      default_cli: cliId
    }));
  };

  const setDefaultModel = (cliId: string, modelId: string) => {
    setGlobalSettings(prev => ({
      ...prev,
      cli_settings: {
        ...(prev?.cli_settings ?? {}),
        [cliId]: {
          ...(prev?.cli_settings?.[cliId] ?? {}),
          model: normalizeModelId(cliId, modelId)
        }
      }
    }));
  };

  const setCliApiKey = (cliId: string, apiKey: string) => {
    setGlobalSettings(prev => {
      const nextCliSettings = { ...(prev?.cli_settings ?? {}) };
      const existing = { ...(nextCliSettings[cliId] ?? {}) };
      const trimmed = apiKey.trim();

      if (trimmed.length > 0) {
        existing.apiKey = trimmed;
        nextCliSettings[cliId] = existing;
      } else {
        delete existing.apiKey;
        if (Object.keys(existing).length > 0) {
          nextCliSettings[cliId] = existing;
        } else {
          delete nextCliSettings[cliId];
        }
      }

      return {
        ...prev,
        cli_settings: nextCliSettings,
      };
    });
  };

  const setCliApiUrl = (cliId: string, apiUrl: string) => {
    setGlobalSettings(prev => {
      const nextCliSettings = { ...(prev?.cli_settings ?? {}) };
      const existing = { ...(nextCliSettings[cliId] ?? {}) };
      const trimmed = apiUrl.trim();

      if (trimmed.length > 0) {
        existing.apiUrl = trimmed;
        nextCliSettings[cliId] = existing;
      } else {
        delete existing.apiUrl;
        if (Object.keys(existing).length > 0) {
          nextCliSettings[cliId] = existing;
        } else {
          delete nextCliSettings[cliId];
        }
      }

      return {
        ...prev,
        cli_settings: nextCliSettings,
      };
    });
  };

  const setCliCustomModel = (cliId: string, customModel: string) => {
    setGlobalSettings(prev => {
      const nextCliSettings = { ...(prev?.cli_settings ?? {}) };
      const existing = { ...(nextCliSettings[cliId] ?? {}) };
      const trimmed = customModel.trim();

      if (trimmed.length > 0) {
        existing.customModel = trimmed;
        nextCliSettings[cliId] = existing;
      } else {
        delete existing.customModel;
        if (Object.keys(existing).length > 0) {
          nextCliSettings[cliId] = existing;
        } else {
          delete nextCliSettings[cliId];
        }
      }

      return {
        ...prev,
        cli_settings: nextCliSettings,
      };
    });
  };

  const toggleApiKeyVisibility = (cliId: string) => {
    setApiKeyVisibility(prev => ({
      ...prev,
      [cliId]: !prev[cliId],
    }));
  };

  const testClaudeApi = async (cliId: string) => {
    const settings = globalSettings.cli_settings[cliId] || {};
    const apiKey = settings.apiKey;
    const apiUrl = settings.apiUrl;

    if (!apiKey) {
      setApiTestState(prev => ({ ...prev, [cliId]: 'error' }));
      setApiTestMessage(prev => ({ ...prev, [cliId]: 'API Key is required' }));
      setTimeout(() => {
        setApiTestState(prev => ({ ...prev, [cliId]: 'idle' }));
        setApiTestMessage(prev => ({ ...prev, [cliId]: '' }));
      }, 3000);
      return;
    }

    setApiTestState(prev => ({ ...prev, [cliId]: 'testing' }));
    setApiTestMessage(prev => ({ ...prev, [cliId]: '' }));

    try {
      const response = await fetch(`${API_BASE}/api/settings/test-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliId,
          apiKey,
          apiUrl: apiUrl || undefined,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setApiTestState(prev => ({ ...prev, [cliId]: 'success' }));
        setApiTestMessage(prev => ({ ...prev, [cliId]: result.message || 'Connection successful' }));
      } else {
        setApiTestState(prev => ({ ...prev, [cliId]: 'error' }));
        setApiTestMessage(prev => ({ ...prev, [cliId]: result.message || 'Connection failed' }));
      }
    } catch (error) {
      setApiTestState(prev => ({ ...prev, [cliId]: 'error' }));
      setApiTestMessage(prev => ({ ...prev, [cliId]: 'Network error: ' + (error instanceof Error ? error.message : 'Unknown error') }));
    }

    setTimeout(() => {
      setApiTestState(prev => ({ ...prev, [cliId]: 'idle' }));
      setApiTestMessage(prev => ({ ...prev, [cliId]: '' }));
    }, 3000);
  };

  if (!isOpen) return null;

  const containerClass = embedded
    ? "relative glass w-full h-full flex flex-col"
    : "relative glass rounded-2xl shadow-2xl w-full max-w-[90vw] h-[680px] flex flex-col overflow-hidden";

  const content = (
    <div
      className={containerClass}
    >
      <div className="flex h-full overflow-hidden">
          {/* Left Sidebar Navigation */}
          <div className="w-52 flex-shrink-0 border-r border-gray-200/60 dark:border-white/10 bg-white/50 dark:bg-white/[0.03] flex flex-col relative">
            {/* Close button - sidebar top right */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 z-10 p-1 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </button>
            {/* Sidebar Header */}
            <div className="px-5 py-4 flex items-center gap-2.5">
              <Settings size={18} className="text-gray-500 dark:text-gray-400" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">系统设置</h2>
            </div>
            {/* Nav Items */}
            <nav className="flex-1 px-3 py-1 space-y-0.5">
              {SETTINGS_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors ${
                    activeTab === tab.id
                      ? 'bg-white/80 dark:bg-white/10 text-gray-900 dark:text-white font-medium shadow-sm border border-white/40 dark:border-white/[0.08]'
                      : 'text-gray-600 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-white/5'
                  }`}
                >
                  <span className={activeTab === tab.id ? 'text-gray-700 dark:text-white' : 'text-gray-500 dark:text-gray-400'}>{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Right Content Area */}
          <div className="glass flex-1 flex flex-col min-w-0 dark:border-white/10 bg-white/50 dark:bg-white/[0.03]">

          {/* Tab Content */}
          <div className="flex-1 p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-white/30 scrollbar-track-transparent">
            <div style={{ display: activeTab === 'general' ? undefined : 'none' }}>
            {visitedTabs.has('general') && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Preferences</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-4 bg-white/40 dark:bg-white/8 rounded-xl border border-gray-200/60 dark:border-white/15">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">Auto-save projects</p>
                        <p className="text-sm text-gray-600 dark:text-gray-300">Automatically save changes to projects</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" defaultChecked />
                        <div className="w-11 h-6 bg-white/90 dark:bg-white/10 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-white/40 dark:bg-white/8 rounded-xl border border-gray-200/60 dark:border-white/15">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white ">Show file extensions</p>
                        <p className="text-sm text-gray-600 dark:text-gray-300 ">Display file extensions in code explorer</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" defaultChecked />
                        <div className="w-11 h-6 bg-white/90 dark:bg-white/10 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}
            </div>

            <div style={{ display: activeTab === 'ai-agents' ? undefined : 'none' }}>
            {visitedTabs.has('ai-agents') && (
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Claude兼容API（暂不支持OpenAI）</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">配置您的大语言模型接口连接参数。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {saveMessage && (
                      <span className={`text-xs ${saveMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                        {saveMessage.text}
                      </span>
                    )}
                    <button
                      onClick={saveGlobalSettings}
                      disabled={isLoading}
                      className="px-4 py-1.5 text-sm font-medium bg-slate-800 dark:bg-white/20 hover:bg-slate-700 dark:hover:bg-white/30 text-white dark:text-slate-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isLoading ? '保存...' : '保存'}
                    </button>
                  </div>
                </div>

                {/* CLI Agents Grid */}
                <div className="divide-y divide-gray-200/40 dark:divide-white/10">
                  {CLI_OPTIONS.filter(cli => cli.enabled !== false).map((cli) => {
                    const status = cliStatus[cli.id];
                    const settings = globalSettings.cli_settings[cli.id] || {};
                    const isChecking = status?.checking || false;
                    const isInstalled = status?.installed || false;
                    const isDefault = globalSettings.default_cli === cli.id;

                    return (
                      <div
                        key={cli.id}
                        className="py-4 first:pt-0"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className="flex-shrink-0">
                            {cli.id === 'claude' && (
                              <Image src="/claude.png" alt="Claude" width={24} height={24} className="w-6 h-6" />
                            )}
                            {cli.id === 'cursor' && (
                              <Image src="/cursor.png" alt="Cursor" width={24} height={24} className="w-6 h-6" />
                            )}
                            {cli.id === 'codex' && (
                              <Image src="/oai.png" alt="Codex" width={24} height={24} className="w-6 h-6" />
                            )}
                            {cli.id === 'qwen' && (
                              <Image src="/qwen.png" alt="Qwen" width={24} height={24} className="w-6 h-6" />
                            )}
                            {cli.id === 'glm' && (
                              <Image src="/glm.svg" alt="GLM" width={24} height={24} className="w-6 h-6" />
                            )}
                            {cli.id === 'gemini' && (
                              <Image src="/gemini.png" alt="Gemini" width={24} height={24} className="w-6 h-6" />
                            )}
                          </div>
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{cli.name}</span>
                        </div>

                        {/* Model Selection and API Configuration */}
                        <div className="space-y-3 pl-9">
                            {cli.id !== 'claude' && (
                              <select
                                value={settings.model || ''}
                                onChange={(e) => setDefaultModel(cli.id, e.target.value)}
                                className="w-full px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-gray-700 dark:text-gray-200 text-xs focus:outline-none"
                              >
                                <option value="">Select model</option>
                                {cli.models.map(model => (
                                  <option key={model.id} value={model.id}>
                                    {model.name}
                                  </option>
                                ))}
                              </select>
                            )}

                            {cli.id === 'glm' && (
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">API Key</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type={apiKeyVisibility[cli.id] ? 'text' : 'password'}
                                    value={settings.apiKey ?? ''}
                                    onChange={(e) => setCliApiKey(cli.id, e.target.value)}
                                    placeholder="Enter GLM API key"
                                    className="flex-1 px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleApiKeyVisibility(cli.id); }}
                                    className="px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-700 dark:text-gray-200 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10"
                                  >
                                    {apiKeyVisibility[cli.id] ? 'Hide' : 'Show'}
                                  </button>
                                </div>
                              </div>
                            )}
                            {cli.id === 'cursor' && (
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">API Key (optional)</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type={apiKeyVisibility[cli.id] ? 'text' : 'password'}
                                    value={settings.apiKey ?? ''}
                                    onChange={(e) => setCliApiKey(cli.id, e.target.value)}
                                    placeholder="Enter Cursor API key"
                                    className="flex-1 px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleApiKeyVisibility(cli.id); }}
                                    className="px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-700 dark:text-gray-200 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10"
                                  >
                                    {apiKeyVisibility[cli.id] ? 'Hide' : 'Show'}
                                  </button>
                                </div>
                              </div>
                            )}
                            {cli.id === 'claude' && (
                              <div className="space-y-3">
                                {/* 古德白推荐 */}
                                <div className="flex items-center gap-3 px-3 py-2 border border-orange-200 bg-orange-50 rounded">
                                  <span className="text-orange-500 text-sm">⭐</span>
                                  <div className="flex-1 flex items-center gap-2 text-[12px]">
                                    <span className="font-medium text-orange-700">古德白推荐</span>
                                    <button
                                      type="button"
                                      onClick={async (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const registerUrl = 'https://api.100agent.co/register?aff=H7ZZ';
                                        if (typeof window !== 'undefined' && (window as any).desktopAPI?.openExternal) {
                                          await (window as any).desktopAPI.openExternal(registerUrl);
                                        } else {
                                          window.open(registerUrl, '_blank');
                                        }
                                      }}
                                      className="text-blue-600 hover:underline font-medium"
                                    >
                                      算力平台 →
                                    </button>
                                    <span className="text-gray-500 dark:text-gray-400">注册 → 充值 → 添加令牌 → 复制密钥</span>
                                  </div>
                                </div>

                                {/* API Key */}
                                <div className="space-y-1">
                                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">API Key</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type={apiKeyVisibility[cli.id] ? 'text' : 'password'}
                                      value={settings.apiKey ?? ''}
                                      onChange={(e) => setCliApiKey(cli.id, e.target.value)}
                                      placeholder="sk-ant-xxx or custom auth token"
                                      className="flex-1 px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleApiKeyVisibility(cli.id); }}
                                      className="px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-700 dark:text-gray-200 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10"
                                    >
                                      {apiKeyVisibility[cli.id] ? 'Hide' : 'Show'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); testClaudeApi(cli.id); }}
                                      disabled={apiTestState[cli.id] === 'testing'}
                                      className={`px-2 py-1.5 text-xs border rounded ${
                                        apiTestState[cli.id] === 'testing' ? 'text-gray-400 dark:text-gray-500 border-gray-200/60 dark:border-white/15' :
                                        apiTestState[cli.id] === 'success' ? 'text-green-600 border-green-300' :
                                        apiTestState[cli.id] === 'error' ? 'text-red-600 border-red-300' :
                                        'text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-white/15 hover:text-gray-700 dark:text-gray-200'
                                      }`}
                                    >
                                      {apiTestState[cli.id] === 'testing' ? '...' :
                                       apiTestState[cli.id] === 'success' ? '✓' :
                                       apiTestState[cli.id] === 'error' ? '✗' : '测试'}
                                    </button>
                                  </div>
                                  {apiTestMessage[cli.id] && (
                                    <p className={`text-[11px] ${apiTestState[cli.id] === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                                      {apiTestMessage[cli.id]}
                                    </p>
                                  )}
                                </div>

                                {/* API Base URL */}
                                <div className="space-y-1">
                                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">API Base URL (Optional)</label>
                                  <input
                                    type="text"
                                    value={typeof settings.apiUrl === 'string' ? settings.apiUrl : ''}
                                    onChange={(e) => setCliApiUrl(cli.id, e.target.value)}
                                    placeholder="https://api.100agent.co (默认)"
                                    className="w-full px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none"
                                  />
                                </div>

                                {/* Model Selection */}
                                <div className="space-y-1">
                                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">模型 (Optional)</label>
                                  <select
                                    value={settings.model || ''}
                                    onChange={(e) => setDefaultModel(cli.id, e.target.value)}
                                    className="w-full px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-gray-700 dark:text-gray-200 text-sm focus:outline-none"
                                  >
                                    <option value="">Select model</option>
                                    {cli.models.map(model => (
                                      <option key={model.id} value={model.id}>
                                        {model.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                {/* Custom Model ID */}
                                <div className="space-y-1">
                                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">自定义模型 ID (Optional)</label>
                                  <input
                                    type="text"
                                    value={typeof settings.customModel === 'string' ? settings.customModel : ''}
                                    onChange={(e) => setCliCustomModel(cli.id, e.target.value)}
                                    placeholder="如: doubao-seed-code-preview-251028"
                                    className="w-full px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none"
                                  />
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">用于第三方兼容API，填写后覆盖上方模型选择器</p>
                                </div>
                              </div>
                            )}
                          </div>
                      </div>
                    );
                  })}

                </div>
              </div>
            )}
            </div>

            <div style={{ display: activeTab === 'asr' ? undefined : 'none' }}>
            {visitedTabs.has('asr') && (
              <Suspense fallback={<div className="flex items-center justify-center py-8 text-sm text-gray-400">Loading...</div>}>
                <ASRTab />
              </Suspense>
            )}
            </div>

            <div style={{ display: activeTab === 'services' ? undefined : 'none' }}>
            {visitedTabs.has('services') && (
              <Suspense fallback={<div className="flex items-center justify-center py-8 text-sm text-gray-400">Loading...</div>}>
                <ServicesTab />
              </Suspense>
            )}
            </div>

            <div style={{ display: activeTab === 'appearance' ? undefined : 'none' }}>
            {visitedTabs.has('appearance') && (
              <Suspense fallback={<div className="flex items-center justify-center py-8 text-sm text-gray-400">Loading...</div>}>
                <AppearanceTab />
              </Suspense>
            )}
            </div>

            <div style={{ display: activeTab === 'basic' ? undefined : 'none' }}>
            {visitedTabs.has('basic') && (
              <Suspense fallback={<div className="flex items-center justify-center py-8 text-sm text-gray-400">Loading...</div>}>
                <BasicTab />
              </Suspense>
            )}
            </div>

            <div style={{ display: activeTab === 'memory' ? undefined : 'none' }}>
            {visitedTabs.has('memory') && (
              <MemoizedMemorySettingsPanel />
            )}
            </div>

            <div style={{ display: activeTab === 'soul' ? undefined : 'none' }}>
            {visitedTabs.has('soul') && (
              <MemoizedSoulSettings />
            )}
            </div>

            <div style={{ display: activeTab === 'skills' ? undefined : 'none' }}>
            {visitedTabs.has('skills') && (
              <MemoizedSkillsSettings initialActiveTab={skillsInitialSubTab} />
            )}
            </div>

            <div style={{ display: activeTab === 'im-channels' ? undefined : 'none' }}>
            {visitedTabs.has('im-channels') && (
              <MemoizedIMChannelSettings />
            )}
            </div>

            <div style={{ display: activeTab === 'lan-peer' ? undefined : 'none' }}>
            {visitedTabs.has('lan-peer') && (
              <MemoizedLanPeerSettings />
            )}
            </div>

            <div style={{ display: activeTab === 'about' ? undefined : 'none' }}>
            {visitedTabs.has('about') && (
              <Suspense fallback={<div className="flex items-center justify-center py-8 text-sm text-gray-400">Loading...</div>}>
                <AboutTab />
              </Suspense>
            )}
            </div>
          </div>
          </div>
      </div>
        </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/70"
          onClick={onClose}
        />
        {content}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-[80] px-4 py-3 rounded-lg shadow-2xl transition-all transform animate-slide-in-up ${
          toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          <div className="flex items-center gap-2">
            {toast.type === 'success' && (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span className="font-medium">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Install Guide Modal */}
      {installModalOpen && selectedCLI && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" key={`modal-${selectedCLI.id}`}>
          <div 
            className="absolute inset-0 bg-black/70"
            onClick={() => {
              setInstallModalOpen(false);
              setSelectedCLI(null);
            }}
          />
          
          <div 
            className="relative bg-white/90 dark:bg-white/10 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200/60 dark:border-white/15 transform"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 border-b border-gray-200/60 dark:border-white/15 ">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {selectedCLI.id === 'claude' && (
                    <Image src="/claude.png" alt="Claude" width={32} height={32} className="w-8 h-8" />
                  )}
                  {selectedCLI.id === 'cursor' && (
                    <Image src="/cursor.png" alt="Cursor" width={32} height={32} className="w-8 h-8" />
                  )}
                  {selectedCLI.id === 'codex' && (
                    <Image src="/oai.png" alt="Codex" width={32} height={32} className="w-8 h-8" />
                  )}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white ">
                      Install {selectedCLI.name}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300 ">
                      Follow these steps to get started
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setInstallModalOpen(false);
                    setSelectedCLI(null);
                  }}
                  className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:text-white transition-colors p-1 hover:bg-white/50 dark:bg-white/8 rounded-lg"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Step 1: Install */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white ">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full text-white text-xs" style={{ backgroundColor: selectedCLI.brandColor }}>
                    1
                  </span>
                  Install CLI
                </div>
                <div className="ml-8 flex items-center gap-2 bg-white/50 dark:bg-white/8 rounded-lg px-3 py-2">
                  <code className="text-sm text-gray-800 dark:text-gray-100 flex-1">
                    {selectedCLI.installCommand}
                  </code>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      (async () => {
                        const ok = await copyTextSafe(selectedCLI.installCommand);
                        showToast(ok ? 'Command copied to clipboard' : 'Failed to copy command', ok ? 'success' : 'error');
                      })();
                    }}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200 "
                    title="Copy command"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9 3h10a2 2 0 012 2v10M9 3H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-2M9 3v2a2 2 0 002 2h6a2 2 0 002-2V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Step 2: Authenticate */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white ">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full text-white text-xs" style={{ backgroundColor: selectedCLI.brandColor }}>
                    2
                  </span>
                  {selectedCLI.id === 'gemini' && 'Authenticate (OAuth or API Key)'}
                  {selectedCLI.id === 'glm' && 'Authenticate (Z.ai DevPack login)'}
                  {selectedCLI.id === 'qwen' && 'Authenticate (Qwen OAuth or API Key)'}
                  {selectedCLI.id === 'codex' && 'Start Codex and sign in'}
                  {selectedCLI.id === 'claude' && 'Start Claude and sign in'}
                  {selectedCLI.id === 'cursor' && 'Start Cursor CLI and sign in'}
                </div>
                <div className="ml-8 flex items-center gap-2 bg-white/50 dark:bg-white/8 rounded-lg px-3 py-2">
                  <code className="text-sm text-gray-800 dark:text-gray-100 flex-1">
                    {selectedCLI.id === 'claude' ? 'claude' :
                     selectedCLI.id === 'cursor' ? 'cursor-agent' :
                     selectedCLI.id === 'codex' ? 'codex' :
                     selectedCLI.id === 'qwen' ? 'qwen' :
                     selectedCLI.id === 'glm' ? 'zai' :
                     selectedCLI.id === 'gemini' ? 'gemini' : ''}
                  </code>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const authCmd = selectedCLI.id === 'claude' ? 'claude' :
                                      selectedCLI.id === 'cursor' ? 'cursor-agent' :
                                      selectedCLI.id === 'codex' ? 'codex' :
                                      selectedCLI.id === 'qwen' ? 'qwen' :
                                      selectedCLI.id === 'glm' ? 'zai' :
                                      selectedCLI.id === 'gemini' ? 'gemini' : '';
                      (async () => {
                        const ok = authCmd ? await copyTextSafe(authCmd) : false;
                        showToast(ok ? 'Command copied to clipboard' : 'Failed to copy command', ok ? 'success' : 'error');
                      })();
                    }}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200 "
                    title="Copy command"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9 3h10a2 2 0 012 2v10M9 3H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-2M9 3v2a2 2 0 002 2h6a2 2 0 002-2V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Step 3: Test */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white ">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full text-white text-xs" style={{ backgroundColor: selectedCLI.brandColor }}>
                    3
                  </span>
                  Test your installation
                </div>
                <div className="ml-8 flex items-center gap-2 bg-white/50 dark:bg-white/8 rounded-lg px-3 py-2">
                  <code className="text-sm text-gray-800 dark:text-gray-100 flex-1">
                    {selectedCLI.id === 'claude' ? 'claude --version' :
                     selectedCLI.id === 'cursor' ? 'cursor-agent --version' :
                     selectedCLI.id === 'codex' ? 'codex --version' :
                     selectedCLI.id === 'qwen' ? 'qwen --version' :
                     selectedCLI.id === 'glm' ? 'zai --version' :
                     selectedCLI.id === 'gemini' ? 'gemini --version' : ''}
                  </code>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const versionCmd = selectedCLI.id === 'claude' ? 'claude --version' :
                                        selectedCLI.id === 'cursor' ? 'cursor-agent --version' :
                                        selectedCLI.id === 'codex' ? 'codex --version' :
                                        selectedCLI.id === 'qwen' ? 'qwen --version' :
                                        selectedCLI.id === 'glm' ? 'zai --version' :
                                        selectedCLI.id === 'gemini' ? 'gemini --version' : '';
                      (async () => {
                        const ok = versionCmd ? await copyTextSafe(versionCmd) : false;
                        showToast(ok ? 'Command copied to clipboard' : 'Failed to copy command', ok ? 'success' : 'error');
                      })();
                    }}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200 "
                    title="Copy command"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9 3h10a2 2 0 012 2v10M9 3H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-2M9 3v2a2 2 0 002 2h6a2 2 0 002-2V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Minimal guide only; removed extra info */}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-gray-200/60 dark:border-white/15 flex justify-between">
              <button
                onClick={() => checkCLIStatus()}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:text-white transition-colors"
              >
                Refresh Status
              </button>
              <button
                onClick={() => {
                  setInstallModalOpen(false);
                  setSelectedCLI(null);
                }}
                className="px-4 py-2 text-sm bg-slate-800 dark:bg-white/20 hover:bg-slate-700 dark:hover:bg-white/30 text-white dark:text-slate-100 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

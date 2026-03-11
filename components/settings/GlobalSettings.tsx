"use client";
import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { AnimatePresence } from 'framer-motion';
import { MotionDiv } from '@/lib/motion';
import ServiceConnectionModal from '@/components/modals/ServiceConnectionModal';
import { Settings } from 'lucide-react';
import { MemorySettingsPanel } from '@/components/settings/MemorySettingsPanel';
import SoulSettings from '@/components/settings/SoulSettings';
import SkillsSettings from '@/components/settings/SkillsSettings';
import IMChannelSettings from '@/components/settings/IMChannelSettings';
import LanPeerSettings from '@/components/settings/LanPeerSettings';
import { useGlobalSettings } from '@/contexts/GlobalSettingsContext';
import { useTheme, THEME_OPTIONS, BG_OPTIONS, BG_CATEGORIES, PRIMARY_COLORS, ANIMATION_OPTIONS, type BgOption } from '@/contexts/ThemeContext';
import { getModelDefinitionsForCli, normalizeModelId } from '@/lib/constants/cliModels';
import { fetchCliStatusSnapshot, createCliStatusFallback } from '@/hooks/useCLI';
import type { CLIStatus } from '@/types/cli';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface GlobalSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'general' | 'ai-agents' | 'services' | 'skills' | 'appearance';
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

interface ServiceToken {
  id: string;
  provider: string;
  token: string;
  name?: string;
  created_at: string;
  last_used?: string;
}

function AppearanceTab() {
  const { theme, setTheme, bgId, setBgId, primaryColorId, setPrimaryColorId, primaryHex, animationEffect, setAnimationEffect, customBgs, addCustomBg, removeCustomBg } = useTheme();
  const [bgCategory, setBgCategory] = useState('nature');
  const sectionClass = "space-y-3";
  const titleClass = "text-sm font-medium text-gray-700 dark:text-gray-200 mb-3";

  const allBgs: BgOption[] = [...BG_OPTIONS, ...customBgs];
  const filteredBgs = allBgs.filter(bg => bg.category === bgCategory);

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { alert('图片不能超过 10MB'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const name = file.name.replace(/\.[^.]+$/, '').slice(0, 10);
        addCustomBg(name || '自定义', dataUrl);
        setBgCategory('custom');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  // Active selection style using primary color
  const activeRing = `border-[var(--primary-hex)] ring-2 ring-[var(--primary-hex)]/30`;
  const activeBg = `bg-[var(--primary-hex)]/10`;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">外观设置</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            当前编辑：{THEME_OPTIONS.find(o => o.id === theme)?.emoji} {THEME_OPTIONS.find(o => o.id === theme)?.label}主题 · 壁纸和主题色会独立保存到每个主题
          </p>
        </div>
      </div>

      {/* Theme mode */}
      <div className={sectionClass}>
        <div className={titleClass}>主题模式</div>
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setTheme(opt.id)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                theme === opt.id
                  ? 'shadow-sm'
                  : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
              }`}
              style={theme === opt.id ? { borderColor: primaryHex, backgroundColor: `${primaryHex}15` } : undefined}
            >
              <span className="text-2xl">{opt.emoji}</span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{opt.label}</span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Background with categories */}
      <div className={sectionClass}>
        <div className="flex items-center justify-between">
          <div className={titleClass}>背景壁纸</div>
          <button
            onClick={handleUpload}
            className="text-xs px-3 py-1 rounded-lg transition-colors text-white"
            style={{ backgroundColor: primaryHex }}
          >
            + 上传壁纸
          </button>
        </div>
        {/* Category tabs */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {BG_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setBgCategory(cat.id)}
              className={`text-xs px-2.5 py-1 rounded-full transition-all ${
                bgCategory === cat.id
                  ? 'text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
              }`}
              style={bgCategory === cat.id ? { backgroundColor: primaryHex } : undefined}
            >
              {cat.label}
              {cat.id === 'custom' && customBgs.length > 0 && ` (${customBgs.length})`}
            </button>
          ))}
        </div>
        {/* Anime/Donghua category tip */}
        {(bgCategory === 'anime' || bgCategory === 'donghua') && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-400 mb-2">
            <span>💡</span>
            <span>{bgCategory === 'anime' ? '以下为动漫色调壁纸，想要真正的二次元壁纸？' : '以下为国漫风格色调壁纸，想要真正的国漫壁纸？'}点击右上角「上传壁纸」添加你喜欢的图片</span>
          </div>
        )}
        {/* Wallpaper grid */}
        {filteredBgs.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
            {bgCategory === 'custom' ? '还没有上传壁纸，点击上方按钮上传' : '该分类暂无壁纸'}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filteredBgs.map(bg => (
              <div key={bg.id} className="relative group">
                <button
                  onClick={() => setBgId(bg.id)}
                  className={`relative rounded-xl overflow-hidden border-2 transition-all aspect-video w-full ${
                    bgId === bg.id
                      ? 'shadow-md'
                      : 'border-gray-200 dark:border-white/10 hover:border-gray-300'
                  }`}
                  style={bgId === bg.id ? { borderColor: primaryHex, boxShadow: `0 0 0 2px ${primaryHex}30` } : undefined}
                >
                  {bg.thumb ? (
                    <img src={bg.thumb} alt={bg.label} className="w-full h-full object-cover" loading="lazy" />
                  ) : bg.css ? (
                    <div className="w-full h-full" style={{ background: bg.css }} />
                  ) : (
                    <div className="w-full h-full bg-gray-200 dark:bg-gray-700" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                    <span className="text-[11px] text-white font-medium">{bg.label}</span>
                  </div>
                  {bgId === bg.id && (
                    <div className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryHex }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                  )}
                </button>
                {/* Delete button for custom wallpapers */}
                {bg.category === 'custom' && (
                  <button
                    onClick={() => removeCustomBg(bg.id)}
                    className="absolute top-1 left-1 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Primary color */}
      <div className={sectionClass}>
        <div className={titleClass}>主题色</div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">主题色将应用于按钮、选中状态、光效等全局元素</p>
        <div className="flex flex-wrap gap-3">
          {PRIMARY_COLORS.map(c => (
            <button
              key={c.id}
              onClick={() => setPrimaryColorId(c.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${
                primaryColorId === c.id
                  ? ''
                  : 'border-gray-200 dark:border-white/10 hover:border-gray-300'
              }`}
              style={primaryColorId === c.id ? { borderColor: c.hex, backgroundColor: `${c.hex}15` } : undefined}
            >
              <span className="w-5 h-5 rounded-full border border-white/30 shadow-sm" style={{ background: c.hex }} />
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Animation effects */}
      <div className={sectionClass}>
        <div className={titleClass}>动画效果</div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">为背景添加动态粒子动画，营造氛围感</p>
        <div className="grid grid-cols-3 gap-3">
          {ANIMATION_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setAnimationEffect(opt.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 transition-all text-left ${
                animationEffect === opt.id
                  ? 'border-current bg-primary/10'
                  : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
              }`}
              style={animationEffect === opt.id ? { borderColor: primaryHex } : undefined}
            >
              <span className="text-lg">{opt.emoji}</span>
              <div>
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{opt.label}</div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500">{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function GlobalSettings({ isOpen, onClose, initialTab = 'ai-agents', embedded = false }: GlobalSettingsProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'ai-agents' | 'asr' | 'services' | 'basic' | 'memory' | 'soul' | 'skills' | 'im-channels' | 'lan-peer' | 'appearance'>(initialTab === 'general' ? 'ai-agents' : initialTab === 'appearance' ? 'appearance' : (initialTab as 'ai-agents' | 'asr' | 'services' | 'skills'));
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'github' | 'supabase' | 'vercel' | null>(null);
  const [tokens, setTokens] = useState<{ [key: string]: ServiceToken | null }>({
    aliyun: null,
    github: null,
    supabase: null,
    vercel: null
  });
  const [aliyunKeyId, setAliyunKeyId] = useState('');
  const [aliyunKeySecret, setAliyunKeySecret] = useState('');
  const [aliyunKeyVisible, setAliyunKeyVisible] = useState(false);
  const [aliyunSaving, setAliyunSaving] = useState(false);
  const [aliyunTesting, setAliyunTesting] = useState(false);
  const [aliyunMessage, setAliyunMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [cliStatus, setCLIStatus] = useState<CLIStatus>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { settings: globalSettings, setSettings: setGlobalSettings, refresh: refreshGlobalSettings } = useGlobalSettings();
  const [isLoading, setIsLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [allowRemoteAccess, setAllowRemoteAccess] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [selectedCLI, setSelectedCLI] = useState<CLIOption | null>(null);
  const [apiKeyVisibility, setApiKeyVisibility] = useState<Record<string, boolean>>({});
  const [apiTestState, setApiTestState] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [apiTestMessage, setApiTestMessage] = useState<Record<string, string>>({});
  // ASR settings state
  const [asrEnabled, setAsrEnabled] = useState(false);
  const [asrBaseUrl, setAsrBaseUrl] = useState('');
  const [asrSubmitUrl, setAsrSubmitUrl] = useState('');
  const [asrQueryUrlTemplate, setAsrQueryUrlTemplate] = useState('');
  const [asrSaving, setAsrSaving] = useState(false);
  const [asrMessage, setAsrMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  const loadAllTokens = useCallback(async () => {
    const providers = ['aliyun', 'github', 'supabase', 'vercel'];
    const newTokens: { [key: string]: ServiceToken | null } = {};

    for (const provider of providers) {
      try {
        const response = await fetch(`${API_BASE}/api/tokens/${provider}`);
        if (response.ok) {
          const tokenData = await response.json();
          newTokens[provider] = tokenData;
          // 如果是阿里云且有 token，解析并填充输入框
          if (provider === 'aliyun' && tokenData?.token) {
            try {
              const parsed = JSON.parse(tokenData.token);
              setAliyunKeyId(parsed.id || '');
              setAliyunKeySecret(parsed.secret || '');
            } catch {
              // token 格式不是 JSON，忽略
            }
          }
        } else {
          newTokens[provider] = null;
        }
      } catch {
        newTokens[provider] = null;
      }
    }

    setTokens(newTokens);
  }, []);

  const handleServiceClick = (provider: 'github' | 'supabase' | 'vercel') => {
    setSelectedProvider(provider);
    setServiceModalOpen(true);
  };

  const handleServiceModalClose = () => {
    setServiceModalOpen(false);
    setSelectedProvider(null);
    loadAllTokens(); // Reload tokens after modal closes
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
        // Load ASR settings
        if (settings?.ai_services?.asr) {
          const asr = settings.ai_services.asr;
          setAsrEnabled(asr.enabled || false);
          if (asr.wanjie) {
            setAsrBaseUrl(asr.wanjie.base_url || '');
            setAsrSubmitUrl(asr.wanjie.submit_url || '');
            setAsrQueryUrlTemplate(asr.wanjie.query_url_template || '');
          }
        }
        // Load server settings
        if (settings?.server) {
          setAllowRemoteAccess(settings.server.allow_remote_access || false);
        }
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
      loadAllTokens();
      loadGlobalSettings();
      checkCLIStatus();
    }
  }, [isOpen, loadAllTokens, loadGlobalSettings, checkCLIStatus]);

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

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'github':
        return (
          <svg width="20" height="20" viewBox="0 0 98 96" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" clipRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" fill="currentColor"/>
          </svg>
        );
      case 'supabase':
        return (
          <svg width="20" height="20" viewBox="0 0 109 113" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint0_linear)"/>
            <path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E"/>
            <defs>
              <linearGradient id="paint0_linear" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse">
                <stop stopColor="#249361"/>
                <stop offset="1" stopColor="#3ECF8E"/>
              </linearGradient>
            </defs>
          </svg>
        );
      case 'vercel':
        return (
          <svg width="20" height="20" viewBox="0 0 76 65" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="currentColor"/>
          </svg>
        );
      case 'aliyun':
        return (
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 4L4 9.5V16C4 23 10 27.5 16 28C22 27.5 28 23 28 16V9.5L16 4Z" fill="#FF6A00"/>
            <path d="M16 8L10 10.5V14.5C10 18.5 13 21 16 21.5C19 21 22 18.5 22 14.5V10.5L16 8Z" fill="white"/>
          </svg>
        );
      default:
        return null;
    }
  };

  // 阿里云 AccessKey 保存
  const handleSaveAliyunKey = async () => {
    if (!aliyunKeyId.trim() || !aliyunKeySecret.trim()) {
      setAliyunMessage({ type: 'error', text: 'AccessKeyId 和 AccessKeySecret 都是必填项' });
      setTimeout(() => setAliyunMessage(null), 3000);
      return;
    }

    setAliyunSaving(true);
    try {
      const tokenValue = JSON.stringify({ id: aliyunKeyId.trim(), secret: aliyunKeySecret.trim() });
      const response = await fetch(`${API_BASE}/api/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'aliyun',
          token: tokenValue,
          name: 'Aliyun AccessKey'
        })
      });

      if (response.ok) {
        setAliyunMessage({ type: 'success', text: '阿里云 AccessKey 保存成功' });
        loadAllTokens();
      } else {
        const error = await response.text();
        setAliyunMessage({ type: 'error', text: `保存失败: ${error}` });
      }
    } catch (error) {
      setAliyunMessage({ type: 'error', text: '保存失败，请重试' });
    } finally {
      setAliyunSaving(false);
      setTimeout(() => setAliyunMessage(null), 3000);
    }
  };

  // 阿里云 AccessKey 删除
  const handleDeleteAliyunKey = async () => {
    const aliyunToken = tokens.aliyun;
    if (!aliyunToken) return;

    if (!confirm('确定要删除阿里云 AccessKey 吗？')) return;

    setAliyunSaving(true);
    try {
      const response = await fetch(`${API_BASE}/api/tokens/${aliyunToken.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setAliyunKeyId('');
        setAliyunKeySecret('');
        setAliyunMessage({ type: 'success', text: 'AccessKey 已删除' });
        loadAllTokens();
      } else {
        setAliyunMessage({ type: 'error', text: '删除失败' });
      }
    } catch {
      setAliyunMessage({ type: 'error', text: '删除失败，请重试' });
    } finally {
      setAliyunSaving(false);
      setTimeout(() => setAliyunMessage(null), 3000);
    }
  };

  // 阿里云 AccessKey 验证
  const handleTestAliyunKey = async () => {
    if (!aliyunKeyId.trim() || !aliyunKeySecret.trim()) {
      setAliyunMessage({ type: 'error', text: 'AccessKeyId 和 AccessKeySecret 都是必填项' });
      setTimeout(() => setAliyunMessage(null), 3000);
      return;
    }

    setAliyunTesting(true);
    setAliyunMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/settings/test-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliId: 'aliyun',
          accessKeyId: aliyunKeyId.trim(),
          accessKeySecret: aliyunKeySecret.trim(),
        }),
      });

      const result = await response.json();

      if (result.success) {
        setAliyunMessage({ type: 'success', text: result.message });
      } else {
        setAliyunMessage({ type: 'error', text: result.message });
      }
    } catch (error) {
      setAliyunMessage({ type: 'error', text: '网络错误，请重试' });
    } finally {
      setAliyunTesting(false);
      setTimeout(() => setAliyunMessage(null), 5000);
    }
  };

  if (!isOpen) return null;

  const containerClass = embedded
    ? "relative glass w-full h-full flex flex-col"
    : "relative glass rounded-2xl shadow-2xl w-full max-w-[90vw] h-[680px] flex flex-col overflow-hidden";

  const ContentWrapper = embedded ? 'div' : MotionDiv;
  const contentProps = embedded ? {} : {
    initial: { opacity: 0, scale: 0.95, y: 20 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.95, y: 20 },
    transition: { duration: 0.2 }
  };

  const content = (
    <ContentWrapper
      className={containerClass}
      {...contentProps}
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
              {[
                { id: 'ai-agents' as const, label: 'LLM API', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                )},
                { id: 'appearance' as const, label: '外观', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                )},
                { id: 'asr' as const, label: 'ASR', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                )},
                { id: 'skills' as const, label: '技能', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                )},
                { id: 'im-channels' as const, label: 'IM 渠道', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                )},
                { id: 'lan-peer' as const, label: '局域网聊天', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                )},
                { id: 'services' as const, label: 'Services', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                )},
                { id: 'memory' as const, label: '记忆管理', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                )},
                { id: 'soul' as const, label: '灵魂设定', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                )},
                { id: 'basic' as const, label: 'Basic', icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
                )},
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all ${
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
          <div className="flex-1 flex flex-col min-w-0">

          {/* Tab Content */}
          <div className="flex-1 p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-white/30 scrollbar-track-transparent">
            {activeTab === 'general' && (
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

            {activeTab === 'ai-agents' && (
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

            {activeTab === 'asr' && (
              <div className="space-y-6">
                {/* ASR Service Configuration */}
                <div className="border border-gray-200/60 dark:border-white/15 rounded-xl p-6">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl ring-1 ring-inset ring-white/20 dark:ring-white/10 bg-white/90 dark:bg-white/10 flex items-center justify-center">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-gray-900 dark:text-white text-sm">ASR Speech Recognition (Wanjie)</h4>
                        {asrEnabled && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-emerald-700 bg-emerald-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Enabled
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300">
                        Configure ASR service for speech-to-text in sub-projects and Skills
                      </p>
                    </div>
                  </div>

                  {/* Enable Toggle */}
                  <div className="flex items-center justify-between p-3 mb-4 bg-white/40 dark:bg-white/8 border border-gray-200/60 dark:border-white/15 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Enable ASR Service</p>
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Inject ASR config into sub-projects and Skills</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={asrEnabled}
                        onChange={(e) => setAsrEnabled(e.target.checked)}
                      />
                      <div className="w-11 h-6 bg-white/40 dark:bg-white/10 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300/60 dark:border-white/15 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                    </label>
                  </div>

                  {/* ASR URLs Configuration */}
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Base URL</label>
                      <input
                        type="text"
                        value={asrBaseUrl}
                        onChange={(e) => setAsrBaseUrl(e.target.value)}
                        placeholder="http://your-asr-server:port"
                        className="w-full px-3 py-1.5 rounded-lg border border-gray-200/60 dark:border-white/15 bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/20 dark:ring-white/10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Submit URL</label>
                      <input
                        type="text"
                        value={asrSubmitUrl}
                        onChange={(e) => setAsrSubmitUrl(e.target.value)}
                        placeholder="http://your-asr-server:port/v1/audio/transcriptions"
                        className="w-full px-3 py-1.5 rounded-lg border border-gray-200/60 dark:border-white/15 bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/20 dark:ring-white/10"
                      />
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">Endpoint for submitting audio files</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Query URL Template</label>
                      <input
                        type="text"
                        value={asrQueryUrlTemplate}
                        onChange={(e) => setAsrQueryUrlTemplate(e.target.value)}
                        placeholder="http://your-asr-server:port/v1/audio/transcriptions/{task_id}"
                        className="w-full px-3 py-1.5 rounded-lg border border-gray-200/60 dark:border-white/15 bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/20 dark:ring-white/10"
                      />
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">Use {'{task_id}'} as placeholder for task ID</p>
                    </div>

                    {/* Message */}
                    {asrMessage && (
                      <p className={`text-[11px] leading-snug ${asrMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                        {asrMessage.text}
                      </p>
                    )}

                    {/* Save Button */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={async () => {
                          setAsrSaving(true);
                          setAsrMessage(null);
                          try {
                            const response = await fetch(`${API_BASE}/api/settings/global`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                ai_services: {
                                  asr: {
                                    enabled: asrEnabled,
                                    provider: 'wanjie',
                                    wanjie: {
                                      base_url: asrBaseUrl.trim(),
                                      submit_url: asrSubmitUrl.trim(),
                                      query_url_template: asrQueryUrlTemplate.trim(),
                                    }
                                  }
                                }
                              })
                            });
                            if (response.ok) {
                              setAsrMessage({ type: 'success', text: 'ASR settings saved successfully' });
                              await refreshGlobalSettings();
                            } else {
                              setAsrMessage({ type: 'error', text: 'Failed to save ASR settings' });
                            }
                          } catch (error) {
                            setAsrMessage({ type: 'error', text: 'Network error, please try again' });
                          } finally {
                            setAsrSaving(false);
                            setTimeout(() => setAsrMessage(null), 3000);
                          }
                        }}
                        disabled={asrSaving}
                        className="px-4 py-1.5 text-sm font-medium bg-slate-800 dark:bg-white/20 hover:bg-slate-700 dark:hover:bg-white/30 text-white dark:text-slate-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {asrSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Info Box */}
                <div className="p-4 bg-white/40 dark:bg-white/8 rounded-xl border border-gray-200/60 dark:border-white/15">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-gray-500 dark:text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                        How it works
                      </h3>
                      <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                        <p>
                          When enabled, ASR configuration will be automatically injected into:
                        </p>
                        <ul className="list-disc list-inside mt-1 text-xs text-gray-600 dark:text-gray-300">
                          <li>Sub-project preview processes (as environment variables)</li>
                          <li>Claude Agent system prompts (with usage examples)</li>
                          <li>Skill execution environments</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'services' && (
              <div className="space-y-6">
                {/* 阿里云 AccessKey 配置卡片 - 放在第一个 */}
                <div className="border border-gray-200/60 dark:border-white/15 rounded-xl p-6">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl ring-1 ring-inset ring-white/20 dark:ring-white/10 bg-white/90 dark:bg-white/10 flex items-center justify-center">
                      {getProviderIcon('aliyun')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-gray-900 dark:text-white text-sm">阿里云 AccessKey</h4>
                        {tokens.aliyun && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-emerald-700 bg-emerald-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            已配置
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300">
                        用于部署项目到阿里云函数计算（Function Compute），Serverless 架构，国内访问更快
                      </p>
                    </div>
                  </div>

                  {/* 获取引导 */}
                  <div className="flex items-center gap-3 p-3 mb-4 bg-white/90 dark:bg-white/10 border border-gray-200/60 dark:border-white/15 rounded-lg">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/50 dark:bg-white/8 flex items-center justify-center">
                      {getProviderIcon('aliyun')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-200">
                        前往阿里云控制台创建 AccessKey，建议使用 RAM 子用户并授予<strong className="font-medium text-gray-900 dark:text-white">函数计算权限</strong>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const url = 'https://ram.console.aliyun.com/manage/ak';
                        if (typeof window !== 'undefined' && (window as any).desktopAPI?.openExternal) {
                          await (window as any).desktopAPI.openExternal(url);
                        } else {
                          window.open(url, '_blank');
                        }
                      }}
                      className="flex-shrink-0 px-3.5 py-2 bg-white/50 dark:bg-white/8 hover:bg-white/40 dark:bg-white/10 text-gray-700 dark:text-gray-200 text-[13px] font-normal rounded border border-gray-200/60 dark:border-white/15 transition-colors whitespace-nowrap"
                    >
                      获取 AccessKey
                    </button>
                  </div>

                  {/* AccessKey 输入 */}
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">AccessKey ID</label>
                      <input
                        type="text"
                        value={aliyunKeyId}
                        onChange={(e) => setAliyunKeyId(e.target.value)}
                        placeholder="LTAI5t..."
                        className="w-full px-3 py-1.5 rounded-lg border border-gray-200/60 dark:border-white/15 bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/20 dark:ring-white/10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">AccessKey Secret</label>
                      <div className="flex items-center gap-2">
                        <input
                          type={aliyunKeyVisible ? 'text' : 'password'}
                          value={aliyunKeySecret}
                          onChange={(e) => setAliyunKeySecret(e.target.value)}
                          placeholder="输入 AccessKey Secret"
                          className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200/60 dark:border-white/15 bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/20 dark:ring-white/10"
                        />
                        <button
                          type="button"
                          onClick={() => setAliyunKeyVisible(!aliyunKeyVisible)}
                          className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:text-white border border-gray-200/60 dark:border-white/15 rounded-lg bg-white/90 dark:bg-white/10 transition-colors"
                        >
                          {aliyunKeyVisible ? '隐藏' : '显示'}
                        </button>
                      </div>
                    </div>

                    {/* 消息提示 */}
                    {aliyunMessage && (
                      <p className={`text-[11px] leading-snug ${aliyunMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                        {aliyunMessage.text}
                      </p>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={handleTestAliyunKey}
                        disabled={aliyunTesting || !aliyunKeyId.trim() || !aliyunKeySecret.trim()}
                        className="px-4 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:text-white border border-gray-200/60 dark:border-white/15 hover:border-gray-300/60 dark:border-white/15 rounded-lg bg-white/90 dark:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {aliyunTesting ? '验证中...' : '验证'}
                      </button>
                      <button
                        onClick={handleSaveAliyunKey}
                        disabled={aliyunSaving || (!aliyunKeyId.trim() && !aliyunKeySecret.trim())}
                        className="px-4 py-1.5 text-sm font-medium bg-slate-800 dark:bg-white/20 hover:bg-slate-700 dark:hover:bg-white/30 text-white dark:text-slate-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {aliyunSaving ? '保存中...' : '保存'}
                      </button>
                      {tokens.aliyun && (
                        <button
                          onClick={handleDeleteAliyunKey}
                          disabled={aliyunSaving}
                          className="px-4 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-lg transition-colors disabled:opacity-50"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* 其他 Service Tokens */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">其他服务</h3>

                  <div className="space-y-4">
                    {Object.entries(tokens)
                      .filter(([provider]) => provider !== 'aliyun')
                      .map(([provider, token]) => (
                      <div key={provider} className="flex items-center justify-between p-4 rounded-xl border border-gray-200/60 dark:border-white/15 ">
                        <div className="flex items-center gap-3">
                          <div className="text-gray-700 dark:text-gray-200 ">
                            {getProviderIcon(provider)}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white capitalize">{provider}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-300 ">
                              {token ? (
                                <>
                                  Token configured • Added {new Date(token.created_at).toLocaleDateString()}
                                </>
                              ) : (
                                'Token not configured'
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {token && (
                            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                          )}
                          <button
                            onClick={() => handleServiceClick(provider as 'github' | 'supabase' | 'vercel')}
                            className="px-3 py-1.5 text-sm border border-gray-200/60 dark:border-white/15 hover:bg-white/40 dark:hover:bg-white/10 text-gray-700 dark:text-gray-200 rounded-lg transition-all"
                          >
                            {token ? 'Update Token' : 'Add Token'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 p-4 rounded-xl border border-gray-200/60 dark:border-white/15 ">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-gray-500 dark:text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-white ">
                          Token Configuration
                        </h3>
                        <div className="mt-2 text-sm text-gray-700 dark:text-gray-200 ">
                          <p>
                            Tokens configured here will be available for all projects. To connect a project to specific repositories
                            and services, use the Project Settings in each individual project.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <AppearanceTab />
            )}

            {activeTab === 'basic' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Basic Settings</span>
                  <div className="flex items-center gap-2">
                    {saveMessage && (
                      <span className={`text-xs ${saveMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                        {saveMessage.text}
                      </span>
                    )}
                    <button
                      onClick={saveGlobalSettings}
                      disabled={isLoading}
                      className="px-3 py-1 text-xs font-medium bg-slate-800 dark:bg-white/20 hover:bg-slate-700 dark:hover:bg-white/30 text-white dark:text-slate-100 rounded transition-colors disabled:opacity-50"
                    >
                      {isLoading ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-gray-200/40 dark:divide-white/10">
                  {/* Remote Access Setting */}
                  <div className="py-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">Allow Remote Access</p>
                        <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">Restart Required</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={allowRemoteAccess}
                          onChange={(e) => {
                            const newValue = e.target.checked;
                            setAllowRemoteAccess(newValue);
                            setGlobalSettings({
                              ...globalSettings,
                              server: { allow_remote_access: newValue }
                            });
                          }}
                        />
                        <div className="w-11 h-6 bg-white/40 dark:bg-white/10 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                      </label>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
                      Enable listening on 0.0.0.0 to allow LAN devices to access the server
                    </p>
                    <div className="p-2.5 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div className="flex items-start gap-1.5 text-xs text-yellow-800">
                        <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span>Security Warning: Only enable this in trusted networks</span>
                      </div>
                    </div>
                  </div>

                  {/* Future settings can be added here as new items in the divide-y list */}
                </div>
              </div>
            )}

            {activeTab === 'memory' && (
              <MemorySettingsPanel />
            )}

            {activeTab === 'soul' && (
              <SoulSettings />
            )}

            {activeTab === 'skills' && (
              <SkillsSettings />
            )}

            {activeTab === 'im-channels' && (
              <IMChannelSettings />
            )}

            {activeTab === 'lan-peer' && (
              <LanPeerSettings />
            )}
          </div>
          </div>
      </div>
        </ContentWrapper>
  );

  if (embedded) {
    return content;
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
          onClick={onClose}
        />
        {content}
      </div>

      {/* Service Connection Modal */}
      {selectedProvider && (
        <ServiceConnectionModal
          isOpen={serviceModalOpen}
          onClose={handleServiceModalClose}
          provider={selectedProvider}
        />
      )}

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
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
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
    </AnimatePresence>
  );
}

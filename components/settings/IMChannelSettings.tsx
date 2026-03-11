'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, AlertCircle, Loader2, Eye, EyeOff, Copy, Check } from 'lucide-react';
import type { IMPlatform, IMChannelConfig, ChannelStatus, ConnectionStatus } from '@/lib/services/im/types';
import { STREAM_PLATFORMS, WEBHOOK_PLATFORMS } from '@/lib/services/im/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

/** 平台显示名称 */
const PLATFORM_NAMES: Record<IMPlatform, string> = {
  dingtalk: '钉钉',
  feishu: '飞书',
  qq: 'QQ',
  wechat: '微信',
  wecom: '企业微信',
};

/** 连接状态显示配置 */
const STATUS_CONFIG: Record<ConnectionStatus, { label: string; color: string; dotColor: string }> = {
  connected: { label: '已连接', color: 'text-green-600 dark:text-green-400', dotColor: 'bg-green-500' },
  connecting: { label: '连接中', color: 'text-yellow-600 dark:text-yellow-400', dotColor: 'bg-yellow-500' },
  reconnecting: { label: '重连中', color: 'text-yellow-600 dark:text-yellow-400', dotColor: 'bg-yellow-500' },
  error: { label: '连接异常', color: 'text-red-600 dark:text-red-400', dotColor: 'bg-red-500' },
  disconnected: { label: '未配置', color: 'text-gray-500 dark:text-gray-400', dotColor: 'bg-gray-400' },
};

/** 默认空配置 */
function emptyConfig(receiveMode: 'stream' | 'webhook'): IMChannelConfig {
  return { enabled: false, receiveMode, appId: '', appSecret: '', token: '', encodingAESKey: '' };
}

export default function IMChannelSettings() {
  const [configs, setConfigs] = useState<Partial<Record<IMPlatform, IMChannelConfig>>>({});
  const [statuses, setStatuses] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<IMPlatform | null>(null);
  const [reconnecting, setReconnecting] = useState<IMPlatform | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [secretVisible, setSecretVisible] = useState<Partial<Record<IMPlatform, boolean>>>({});
  const [copiedUrl, setCopiedUrl] = useState<IMPlatform | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [configRes, statusRes] = await Promise.all([
        fetch(`${API_BASE}/api/settings/im-channels`),
        fetch(`${API_BASE}/api/im/status`),
      ]);
      if (configRes.ok) {
        const data = await configRes.json();
        setConfigs(data);
      }
      if (statusRes.ok) {
        const data = await statusRes.json();
        setStatuses(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load IM channel data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const getConfig = (platform: IMPlatform): IMChannelConfig => {
    return configs[platform] ?? emptyConfig(STREAM_PLATFORMS.includes(platform) ? 'stream' : 'webhook');
  };

  const getStatus = (platform: IMPlatform): ChannelStatus | undefined => {
    return statuses.find(s => s.platform === platform);
  };

  const updateLocalConfig = (platform: IMPlatform, patch: Partial<IMChannelConfig>) => {
    setConfigs(prev => ({
      ...prev,
      [platform]: { ...getConfig(platform), ...patch },
    }));
  };

  const handleSave = async (platform: IMPlatform) => {
    setSaving(platform);
    try {
      const config = getConfig(platform);
      const res = await fetch(`${API_BASE}/api/settings/im-channels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, config }),
      });
      if (!res.ok) throw new Error('Save failed');
      showMessage('success', `${PLATFORM_NAMES[platform]} 配置已保存`);
      await loadData();
    } catch {
      showMessage('error', `${PLATFORM_NAMES[platform]} 配置保存失败`);
    } finally {
      setSaving(null);
    }
  };

  const handleReconnect = async (platform: IMPlatform) => {
    setReconnecting(platform);
    try {
      const res = await fetch(`${API_BASE}/api/im/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      if (!res.ok) throw new Error('Reconnect failed');
      showMessage('success', `${PLATFORM_NAMES[platform]} 正在重新连接`);
      setTimeout(() => loadData(), 2000);
    } catch {
      showMessage('error', `${PLATFORM_NAMES[platform]} 重连失败`);
    } finally {
      setReconnecting(null);
    }
  };

  const copyWebhookUrl = async (platform: IMPlatform) => {
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/im/${platform}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(platform);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch { /* ignore */ }
  };

  const renderStatusBadge = (platform: IMPlatform) => {
    const status = getStatus(platform);
    const config = getConfig(platform);
    const isStream = STREAM_PLATFORMS.includes(platform);

    let connectionStatus: ConnectionStatus = 'disconnected';
    if (isStream && status) {
      connectionStatus = status.connectionStatus;
    } else if (!isStream) {
      connectionStatus = config.enabled && config.appId ? 'connected' : 'disconnected';
    }

    const display = isStream
      ? STATUS_CONFIG[connectionStatus]
      : {
          label: config.enabled && config.appId ? '已配置' : '未配置',
          color: config.enabled && config.appId ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400',
          dotColor: config.enabled && config.appId ? 'bg-green-500' : 'bg-gray-400',
        };

    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${display.color}`}>
        <span className={`w-2 h-2 rounded-full ${display.dotColor}`} />
        {display.label}
      </span>
    );
  };

  const renderCredentialFields = (platform: IMPlatform) => {
    const config = getConfig(platform);
    const isVisible = secretVisible[platform] ?? false;
    const isWebhook = WEBHOOK_PLATFORMS.includes(platform);

    return (
      <div className="space-y-3 mt-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">App ID</label>
          <input
            type="text"
            value={config.appId}
            onChange={e => updateLocalConfig(platform, { appId: e.target.value })}
            placeholder="输入 App ID"
            className="w-full px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">App Secret</label>
          <div className="flex items-center gap-2">
            <input
              type={isVisible ? 'text' : 'password'}
              value={config.appSecret}
              onChange={e => updateLocalConfig(platform, { appSecret: e.target.value })}
              placeholder="输入 App Secret"
              className="flex-1 px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
            <button
              type="button"
              onClick={() => setSecretVisible(prev => ({ ...prev, [platform]: !isVisible }))}
              className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10"
            >
              {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Token</label>
          <input
            type="text"
            value={config.token}
            onChange={e => updateLocalConfig(platform, { token: e.target.value })}
            placeholder="输入 Token"
            className="w-full px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
        </div>
        {isWebhook && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Encoding AES Key</label>
            <input
              type="text"
              value={config.encodingAESKey ?? ''}
              onChange={e => updateLocalConfig(platform, { encodingAESKey: e.target.value })}
              placeholder="输入 Encoding AES Key"
              className="w-full px-3 py-1.5 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          </div>
        )}
      </div>
    );
  };

  const renderPlatformCard = (platform: IMPlatform) => {
    const config = getConfig(platform);
    const isStream = STREAM_PLATFORMS.includes(platform);
    const isSaving = saving === platform;
    const isReconnecting = reconnecting === platform;

    return (
      <div
        key={platform}
        className="p-4 bg-white/40 dark:bg-white/[0.06] rounded-xl border border-gray-200/60 dark:border-white/10"
      >
        {/* Header: name + status + toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {PLATFORM_NAMES[platform]}
            </span>
            {renderStatusBadge(platform)}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 font-mono">
              {isStream ? 'Stream' : 'Webhook'}
            </span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={config.enabled}
              onChange={e => updateLocalConfig(platform, { enabled: e.target.checked })}
            />
            <div className="w-9 h-5 bg-gray-300 dark:bg-white/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500" />
          </label>
        </div>

        {/* Credential fields */}
        {renderCredentialFields(platform)}

        {/* Webhook URL for webhook platforms */}
        {!isStream && (
          <div className="mt-3 space-y-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Webhook URL</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-1.5 text-xs bg-gray-50 dark:bg-white/5 border border-gray-200/60 dark:border-white/10 rounded text-gray-600 dark:text-gray-300 truncate">
                {typeof window !== 'undefined' ? window.location.origin : ''}/api/im/{platform}
              </code>
              <button
                type="button"
                onClick={() => copyWebhookUrl(platform)}
                className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200/60 dark:border-white/15 rounded bg-white/90 dark:bg-white/10"
                title="复制 Webhook URL"
              >
                {copiedUrl === platform ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}

        {/* Actions: save + reconnect */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => handleSave(platform)}
            disabled={isSaving}
            className="px-3 py-1.5 text-xs font-medium bg-slate-800 dark:bg-white/20 hover:bg-slate-700 dark:hover:bg-white/30 text-white dark:text-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
          {isStream && (
            <button
              onClick={() => handleReconnect(platform)}
              disabled={isReconnecting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-200/60 dark:border-white/15 rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={isReconnecting ? 'animate-spin' : ''} />
              重新连接
            </button>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">IM 渠道配置</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            配置各 IM 平台的连接凭证，启用后即可通过对应渠道与秘书交互。
          </p>
        </div>
        <button
          onClick={loadData}
          className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-white/50 dark:hover:bg-white/10 rounded-lg transition-colors"
          title="刷新"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {message && (
        <div className={`px-4 py-2 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-500/20'
            : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20'
        }`}>
          {message.text}
        </div>
      )}

      {/* Stream 平台 */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          <Wifi size={14} />
          Stream 模式（长连接）
        </h4>
        <div className="space-y-3">
          {STREAM_PLATFORMS.map(p => renderPlatformCard(p))}
        </div>
      </div>

      {/* Webhook 平台 */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          <WifiOff size={14} />
          Webhook 模式（HTTP 回调）
        </h4>
        <div className="space-y-3">
          {WEBHOOK_PLATFORMS.map(p => renderPlatformCard(p))}
        </div>
      </div>
    </div>
  );
}

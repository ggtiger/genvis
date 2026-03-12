"use client";

import { useState, useEffect } from 'react';
import ServiceConnectionModal from '@/components/modals/ServiceConnectionModal';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface ServiceToken {
  id: string;
  provider: string;
  token: string;
  name?: string;
  created_at: string;
  last_used?: string;
}

interface ServicesTabProps {
  // Props can be added here if needed
}

function getProviderIcon(provider: string) {
  switch (provider) {
    case 'aliyun':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    case 'github':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      );
    case 'supabase':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 12l10 10 10-10L12 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    case 'vercel':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 22h20L12 2z"/>
        </svg>
      );
    default:
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
      );
  }
}

export default function ServicesTab(_props: ServicesTabProps) {
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
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'github' | 'supabase' | 'vercel' | null>(null);

  const loadAllTokens = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tokens`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.tokens)) {
          const tokenMap = data.tokens.reduce((acc: { [key: string]: ServiceToken }, token: ServiceToken) => {
            acc[token.provider] = token;
            return acc;
          }, {} as { [key: string]: ServiceToken });
          setTokens({ ...tokens, ...tokenMap });
        }
      }
    } catch (error) {
      console.error('Failed to load tokens:', error);
    }
  };

  useEffect(() => {
    loadAllTokens();
  }, []);

  const handleTestAliyunKey = async () => {
    setAliyunTesting(true);
    setAliyunMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/tokens/aliyun/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_key_id: aliyunKeyId.trim(), access_key_secret: aliyunKeySecret.trim() })
      });
      const data = await response.json();
      if (data.success) {
        setAliyunMessage({ type: 'success', text: 'AccessKey 验证成功' });
      } else {
        setAliyunMessage({ type: 'error', text: data.message || 'AccessKey 验证失败' });
      }
    } catch (error) {
      setAliyunMessage({ type: 'error', text: '网络错误，请重试' });
    } finally {
      setAliyunTesting(false);
    }
  };

  const handleSaveAliyunKey = async () => {
    setAliyunSaving(true);
    setAliyunMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/tokens/aliyun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_key_id: aliyunKeyId.trim(), access_key_secret: aliyunKeySecret.trim() })
      });
      const data = await response.json();
      if (data.success) {
        setAliyunMessage({ type: 'success', text: 'AccessKey 已保存' });
        setAliyunKeyId('');
        setAliyunKeySecret('');
        loadAllTokens();
      } else {
        setAliyunMessage({ type: 'error', text: data.message || '保存失败' });
      }
    } catch (error) {
      setAliyunMessage({ type: 'error', text: '网络错误，请重试' });
    } finally {
      setAliyunSaving(false);
      setTimeout(() => setAliyunMessage(null), 3000);
    }
  };

  const handleDeleteAliyunKey = async () => {
    const aliyunToken = tokens.aliyun;
    if (!aliyunToken) return;

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
    } catch (error) {
      setAliyunMessage({ type: 'error', text: '网络错误，请重试' });
    } finally {
      setTimeout(() => setAliyunMessage(null), 3000);
    }
  };

  const handleServiceClick = (provider: 'github' | 'supabase' | 'vercel') => {
    setSelectedProvider(provider);
    setServiceModalOpen(true);
  };

  return (
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
                  <div className="w-2 h-2 bg-green-400 rounded-full" />
                )}
                <button
                  onClick={() => handleServiceClick(provider as 'github' | 'supabase' | 'vercel')}
                  className="px-3 py-1.5 text-sm border border-gray-200/60 dark:border-white/15 hover:bg-white/40 dark:hover:bg-white/10 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
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

      {/* ServiceConnectionModal */}
      {serviceModalOpen && selectedProvider && (
        <ServiceConnectionModal
          isOpen={serviceModalOpen}
          onClose={() => {
            setServiceModalOpen(false);
            setSelectedProvider(null);
            loadAllTokens();
          }}
          provider={selectedProvider}
        />
      )}
    </div>
  );
}

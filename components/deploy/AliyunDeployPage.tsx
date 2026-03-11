"use client";
import { useState, useEffect, useRef } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface DeployConfig {
  customDomain?: string;
  region: string;
}

interface DeployStep {
  id: number;
  name: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
}

interface DeployLog {
  timestamp: string;
  level: 'info' | 'success' | 'error' | 'warning';
  message: string;
}

interface DeployResult {
  success: boolean;
  url?: string;
  functionName?: string;
  deployedAt?: string;
  error?: string;
}

interface DeploymentInfo {
  deployed: boolean;
  url?: string;
  functionName?: string;
  region?: string;
  customDomain?: string;
  deployedAt?: string;
}

interface AliyunDeployPageProps {
  projectId: string;
  onClose: () => void;
  isDemo?: boolean;
  deployedUrl?: string;
}

export default function AliyunDeployPage({ projectId, onClose, isDemo = false, deployedUrl }: AliyunDeployPageProps) {
  const [config, setConfig] = useState<DeployConfig>({
    customDomain: '',
    region: 'cn-hangzhou'
  });

  const [deploymentInfo, setDeploymentInfo] = useState<DeploymentInfo | null>(null);

  const isValidDomain = (domain: string): boolean => {
    if (!domain) return true;
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    return domainRegex.test(domain);
  };

  const domainError = config.customDomain && !isValidDomain(config.customDomain)
    ? '请输入有效的域名格式，如: fc.example.com'
    : '';

  const [steps, setSteps] = useState<DeployStep[]>([
    { id: 1, name: '检查环境', status: 'waiting' },
    { id: 2, name: '准备依赖', status: 'waiting' },
    { id: 3, name: '部署函数', status: 'waiting' },
    { id: 4, name: '配置域名', status: 'waiting' }
  ]);

  const [logs, setLogs] = useState<DeployLog[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [projectType, setProjectType] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Load project info and deployment status
  useEffect(() => {
    const loadData = async () => {
      try {
        const projectRes = await fetch(`${API_BASE}/api/projects/${projectId}`);
        if (projectRes.ok) {
          const response = await projectRes.json();
          setProjectType(response.data?.projectType || '');
        }

        const statusRes = await fetch(`${API_BASE}/api/projects/${projectId}/aliyun/status`);
        if (statusRes.ok) {
          const info = await statusRes.json();
          setDeploymentInfo(info);
          if (info.deployed) {
            setConfig({
              customDomain: info.customDomain || '',
              region: info.region || 'cn-hangzhou'
            });
          }
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [projectId]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (level: DeployLog['level'], message: string) => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs(prev => [...prev, { timestamp, level, message }]);
  };

  const updateStepStatus = (stepId: number, status: DeployStep['status']) => {
    setSteps(prev => prev.map(step =>
      step.id === stepId ? { ...step, status } : step
    ));
  };

  const handleDemoDeploy = async () => {
    if (!deployedUrl) {
      addLog('error', '演示模式配置错误：缺少 deployedUrl');
      return;
    }

    setDeploying(true);
    setResult(null);
    setLogs([]);
    setSteps(prev => prev.map(step => ({ ...step, status: 'waiting' })));

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    try {
      updateStepStatus(1, 'running');
      addLog('info', '检查 AccessKey 配置...');
      await delay(800);
      addLog('success', 'AccessKey 配置检查通过');
      addLog('info', '项目类型: python-fastapi');
      updateStepStatus(1, 'completed');

      updateStepStatus(2, 'running');
      addLog('info', '开始安装 Linux 依赖包...');
      await delay(1200);
      addLog('success', '依赖安装完成 (12个包)');
      updateStepStatus(2, 'completed');

      updateStepStatus(3, 'running');
      addLog('info', '开始部署函数到阿里云 FC...');
      await delay(600);
      addLog('info', '上传代码包...');
      await delay(800);
      addLog('info', '创建函数...');
      await delay(1000);
      addLog('success', '函数部署成功');
      updateStepStatus(3, 'completed');

      updateStepStatus(4, 'running');
      addLog('info', '使用默认 FC 域名');
      await delay(500);
      updateStepStatus(4, 'completed');

      const newResult = {
        success: true,
        url: deployedUrl,
        functionName: 'demo-function',
        deployedAt: new Date().toLocaleString('zh-CN')
      };

      setResult(newResult);
      setDeploymentInfo({
        deployed: true,
        url: newResult.url,
        functionName: newResult.functionName,
        region: config.region,
        deployedAt: newResult.deployedAt
      });

      addLog('success', '部署完成！');
    } catch (error: any) {
      addLog('error', error.message || '演示模式执行失败');
      setResult({ success: false, error: error.message });
    } finally {
      setDeploying(false);
    }
  };

  const handleDeploy = async () => {
    if (projectType !== 'python-fastapi') {
      addLog('error', '仅支持 Python FastAPI 项目部署到阿里云 FC');
      return;
    }

    setDeploying(true);
    setResult(null);
    setLogs([]);
    setSteps(prev => prev.map(step => ({ ...step, status: 'waiting' })));

    try {
      updateStepStatus(1, 'running');
      addLog('info', '检查 AccessKey 配置...');

      const tokenRes = await fetch(`${API_BASE}/api/tokens/aliyun`);
      if (!tokenRes.ok) {
        throw new Error('未配置阿里云 AccessKey，请先在设置中配置');
      }

      addLog('success', 'AccessKey 配置检查通过');
      addLog('info', `项目类型: ${projectType}`);
      updateStepStatus(1, 'completed');

      updateStepStatus(2, 'running');
      addLog('info', '开始安装 Linux 依赖包...');

      const prepareRes = await fetch(`${API_BASE}/api/projects/${projectId}/aliyun/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (!prepareRes.ok) {
        const error = await prepareRes.text();
        throw new Error(`依赖准备失败: ${error}`);
      }

      const prepareData = await prepareRes.json();
      addLog('success', `依赖安装完成 (${prepareData.packageCount || 0}个包)`);
      updateStepStatus(2, 'completed');

      updateStepStatus(3, 'running');
      addLog('info', deploymentInfo?.deployed ? '开始更新函数...' : '开始部署函数到阿里云 FC...');

      const deployRes = await fetch(`${API_BASE}/api/projects/${projectId}/aliyun/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (!deployRes.ok) {
        const error = await deployRes.text();
        throw new Error(`部署失败: ${error}`);
      }

      const deployData = await deployRes.json();
      addLog('info', '上传代码包...');
      addLog('info', deploymentInfo?.deployed ? '更新函数配置...' : '创建函数...');
      addLog('success', deploymentInfo?.deployed ? '函数更新成功' : '函数部署成功');
      updateStepStatus(3, 'completed');

      updateStepStatus(4, 'running');
      if (config.customDomain) {
        addLog('info', `配置自定义域名: ${config.customDomain}...`);
        addLog('success', '域名绑定成功');
      } else {
        addLog('info', '使用默认 FC 域名');
      }
      updateStepStatus(4, 'completed');

      const newResult = {
        success: true,
        url: deployData.url || deployData.deploymentUrl,
        functionName: deployData.functionName,
        deployedAt: new Date().toLocaleString('zh-CN')
      };

      setResult(newResult);
      setDeploymentInfo({
        deployed: true,
        url: newResult.url,
        functionName: newResult.functionName,
        region: config.region,
        customDomain: config.customDomain,
        deployedAt: newResult.deployedAt
      });

      addLog('success', deploymentInfo?.deployed ? '更新完成！' : '部署完成！');
    } catch (error: any) {
      const currentStep = steps.find(s => s.status === 'running');
      if (currentStep) {
        updateStepStatus(currentStep.id, 'failed');
      }

      addLog('error', error.message);
      setResult({
        success: false,
        error: error.message
      });
    } finally {
      setDeploying(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    addLog('info', '访问地址已复制到剪贴板');
  };

  const handleOpenUrl = async (url: string) => {
    if (typeof window !== 'undefined' && (window as any).desktopAPI?.openExternal) {
      await (window as any).desktopAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const getLogColor = (level: DeployLog['level']) => {
    switch (level) {
      case 'success': return 'text-green-600 dark:text-green-400';
      case 'error': return 'text-red-600 dark:text-red-400';
      case 'warning': return 'text-yellow-600 dark:text-yellow-400';
      default: return 'text-gray-600 dark:text-slate-400';
    }
  };

  const getRegionName = (region: string) => {
    const regionMap: Record<string, string> = {
      'cn-hangzhou': '华东1 (杭州)',
      'cn-shanghai': '华东2 (上海)',
      'cn-beijing': '华北2 (北京)',
      'cn-shenzhen': '华南1 (深圳)',
      'cn-chengdu': '西南1 (成都)',
      'cn-guangzhou': '华南3 (广州)',
      'cn-hongkong': '中国香港',
      'ap-southeast-1': '新加坡',
      'ap-northeast-1': '日本 (东京)',
      'us-west-1': '美国 (硅谷)',
    };
    return regionMap[region] || region;
  };

  const isAlreadyDeployed = deploymentInfo?.deployed;

  return (
    <div className="h-full flex flex-col bg-transparent">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-white/10 px-6 py-4 flex items-center justify-between">
        <h2 className="text-base font-medium text-gray-900 dark:text-white">
          一键部署到阿里云函数计算{isDemo && <span className="text-orange-500 ml-1">(演示)</span>}
        </h2>
        <button
          onClick={onClose}
          className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-white transition"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Current Deployment Info */}
          {isAlreadyDeployed && !result && (
            <div className="bg-gray-50 dark:bg-white/5 rounded-lg p-4 border border-gray-200 dark:border-white/10">
              <div className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-3 flex items-center justify-between">
                <span>当前部署</span>
                <button
                  onClick={() => handleOpenUrl(`https://fcnext.console.aliyun.com/${deploymentInfo.region}/functions`)}
                  className="text-xs text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition flex items-center gap-1 font-normal"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  阿里云函数计算控制台
                </button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-500">访问地址</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenUrl(deploymentInfo.url!)}
                      className="font-mono text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[300px] text-left"
                    >
                      {deploymentInfo.url}
                    </button>
                    <button
                      onClick={() => handleCopyUrl(deploymentInfo.url!)}
                      className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-white"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-500">函数名称</span>
                  <span className="font-mono text-gray-700 dark:text-slate-300">{deploymentInfo.functionName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-500">部署区域</span>
                  <span className="text-gray-700 dark:text-slate-300">{getRegionName(deploymentInfo.region!)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-500">上次部署</span>
                  <span className="text-gray-700 dark:text-slate-300">{deploymentInfo.deployedAt}</span>
                </div>
              </div>
            </div>
          )}

          {/* Config Section */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                自定义域名 (可选，仅支持 dns 解析在阿里云的域名)
              </label>
              <input
                type="text"
                value={config.customDomain}
                onChange={(e) => setConfig({ ...config, customDomain: e.target.value })}
                placeholder="fc-myapp.example.com"
                className={`w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:ring-1 focus:ring-gray-900 dark:focus:ring-white/30 focus:border-gray-900 dark:focus:border-white/20 placeholder:text-gray-400 dark:placeholder:text-slate-500 ${domainError ? 'border-red-400' : 'border-gray-300 dark:border-white/10'}`}
                disabled={deploying}
              />
              {domainError && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{domainError}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                部署区域
                {isAlreadyDeployed && <span className="text-gray-400 dark:text-slate-500 font-normal ml-1">(已锁定)</span>}
              </label>
              <select
                value={config.region}
                onChange={(e) => setConfig({ ...config, region: e.target.value })}
                className={`w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg text-sm bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:ring-1 focus:ring-gray-900 dark:focus:ring-white/30 focus:border-gray-900 dark:focus:border-white/20 ${isAlreadyDeployed ? 'bg-gray-100 dark:bg-white/[0.03] text-gray-500 dark:text-slate-400' : ''}`}
                disabled={deploying || isAlreadyDeployed}
              >
                <optgroup label="中国大陆">
                  <option value="cn-hangzhou">华东1 (杭州)</option>
                  <option value="cn-shanghai">华东2 (上海)</option>
                  <option value="cn-beijing">华北2 (北京)</option>
                  <option value="cn-shenzhen">华南1 (深圳)</option>
                  <option value="cn-chengdu">西南1 (成都)</option>
                  <option value="cn-guangzhou">华南3 (广州)</option>
                </optgroup>
                <optgroup label="港澳台及海外">
                  <option value="cn-hongkong">中国香港</option>
                  <option value="ap-southeast-1">新加坡</option>
                  <option value="ap-northeast-1">日本 (东京)</option>
                  <option value="us-west-1">美国 (硅谷)</option>
                </optgroup>
              </select>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-between py-4 border-y border-gray-100 dark:border-white/10">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                    step.status === 'completed' ? 'bg-green-500 text-white' :
                    step.status === 'running' ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900' :
                    step.status === 'failed' ? 'bg-red-500 text-white' :
                    'bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-slate-400'
                  }`}>
                    {step.status === 'completed' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    ) : step.status === 'running' ? (
                      <div className="w-3 h-3 border-2 border-white dark:border-gray-900 border-t-transparent rounded-full animate-spin" />
                    ) : step.status === 'failed' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    ) : (
                      step.id
                    )}
                  </div>
                  <div className="mt-1.5 text-xs font-medium text-gray-700 dark:text-slate-300">{step.name}</div>
                </div>
                {index < steps.length - 1 && (
                  <div className={`h-px flex-1 mx-2 ${
                    steps[index + 1].status === 'completed' || steps[index + 1].status === 'running'
                      ? 'bg-gray-900 dark:bg-white'
                      : 'bg-gray-200 dark:bg-white/10'
                  }`} />
                )}
              </div>
            ))}
          </div>

          {/* Logs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-slate-300">部署日志</span>
            </div>
            <div className="bg-gray-50 dark:bg-white/5 rounded-lg p-3 h-40 overflow-y-auto font-mono text-xs space-y-0.5">
              {logs.length === 0 ? (
                <div className="text-gray-400 dark:text-slate-500 text-center py-6">
                  {isAlreadyDeployed ? '点击更新部署查看日志' : '点击开始部署查看日志'}
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className={getLogColor(log.level)}>
                    <span className="text-gray-400 dark:text-slate-500">[{log.timestamp}]</span> {log.message}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* Result */}
          {result && (
            <div className={`p-4 rounded-lg ${result.success ? 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20' : 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20'}`}>
              {result.success ? (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-green-800 dark:text-green-400 flex items-center justify-between">
                    <span>{isAlreadyDeployed ? '更新成功' : '部署成功'}</span>
                    <button
                      onClick={() => handleOpenUrl(`https://fcnext.console.aliyun.com/${config.region}/functions`)}
                      className="text-xs text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition flex items-center gap-1 font-normal"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      控制台
                    </button>
                  </div>
                  <div className="flex items-center justify-between bg-white dark:bg-white/5 rounded-lg p-3 border border-green-200 dark:border-green-500/20">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-500 dark:text-slate-500 mb-0.5">访问地址</div>
                      <div className="font-mono text-sm text-blue-600 dark:text-blue-400 truncate">{result.url}</div>
                    </div>
                    <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleCopyUrl(result.url!)}
                        className="px-3 py-1.5 bg-gray-900 dark:bg-white/15 hover:bg-gray-800 dark:hover:bg-white/20 text-white text-xs rounded-lg transition"
                      >
                        复制
                      </button>
                      <button
                        onClick={() => {
                          if (result?.url) {
                            handleOpenUrl(result.url);
                          }
                        }}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg transition"
                      >
                        打开
                      </button>
                    </div>
                  </div>
                  {result.functionName && (
                    <div className="text-xs text-gray-600 dark:text-slate-400">
                      <span className="text-gray-500 dark:text-slate-500">函数名称:</span> {result.functionName}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="text-sm font-medium text-red-800 dark:text-red-400 mb-2">部署失败</div>
                  <div className="text-sm text-red-700 dark:text-red-300">{result.error}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-white/10 px-6 py-4 flex items-center justify-end gap-3">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition"
          disabled={deploying}
        >
          {result ? '关闭' : '取消'}
        </button>

        {(!result || !result.success) && (
          <button
            onClick={isDemo ? handleDemoDeploy : handleDeploy}
            disabled={deploying || loading || !!domainError}
            className="px-5 py-2 bg-gray-900 dark:bg-white/15 hover:bg-gray-800 dark:hover:bg-white/20 text-white text-sm rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deploying
              ? (isAlreadyDeployed ? '更新中...' : '部署中...')
              : result?.success === false
                ? '重试'
                : isAlreadyDeployed
                  ? '更新部署'
                  : '开始部署'
            }
          </button>
        )}

        {result?.success && result.url && (
          <button
            onClick={() => handleOpenUrl(result.url!)}
            className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-medium transition"
          >
            访问应用
          </button>
        )}
      </div>
    </div>
  );
}

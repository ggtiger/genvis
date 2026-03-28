"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppSidebar from '@/components/layout/AppSidebar';
import ThemeAnimations from '@/components/layout/ThemeAnimations';
import AnimatedBackground from '@/components/layout/AnimatedBackground';
import ChatInput from '@/components/chat/ChatInput';
import EmployeeList from '@/components/employees/EmployeeList';
import EmployeeStatusPanel from '@/components/boss/EmployeeStatusPanel';
import SecretaryPanel from '@/components/secretary/SecretaryPanel';
import HomeDashboard from '@/components/secretary/HomeDashboard';
import LanChatLayout from '@/components/lan-chat/LanChatLayout';
import EmbeddedPageView from '@/components/layout/EmbeddedPageView';
import { EmbeddedPageProvider, useEmbeddedPage } from '@/contexts/EmbeddedPageContext';
import { ArrowLeft, Folder, FolderOpen, HelpCircle, ShoppingBag, CheckCircle, FileText, Receipt, Users } from 'lucide-react';

import { useGlobalSettings } from '@/contexts/GlobalSettingsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSlimMode } from '@/hooks/useSlimMode';
import { getDefaultModelForCli } from '@/lib/constants/cliModels';
import type { Employee } from '@/types/backend/employee';
import { useToast } from '@/contexts/ToastContext';
import GlobalSettings from '@/components/settings/GlobalSettings';
import {
  ACTIVE_CLI_MODEL_OPTIONS,
  DEFAULT_ACTIVE_CLI,
  normalizeModelForCli,
  sanitizeActiveCli,
  buildActiveModelOptions,
  type ActiveCliId,
  type ActiveModelOption,
} from '@/lib/utils/cliOptions';
import { ONLINE_TEMPLATES } from '@/lib/mock/onlineTemplates';
import { getTemplateDisplayChar } from '@/lib/utils/colorGenerator';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface Template {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  previewUrl?: string;
  author?: string;
  version?: string;
  isDownloaded?: boolean;
}

interface EnvVarConfig {
  key: string;
  label: string;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  default?: string;
}

interface SkillMeta {
  name: string;
  displayName?: string;
  description: string;
  path: string;
  source: 'builtin' | 'user';
  size: number;
  enabled: boolean;
  // Extended fields
  category?: string;
  tags?: string[];
  version?: string;
  author?: string;
  preview?: string;
  projectType?: 'nextjs' | 'python-fastapi';
  envVars?: EnvVarConfig[];
  // Capability flags
  hasSkill: boolean;
  hasApp: boolean;
  // Deploy fields
  deployStatus?: 'not_deployed' | 'building' | 'deployed' | 'build_failed' | 'stopped';
  deployPort?: number;
  // Runtime check
  hasUnfilledRequiredVars?: boolean;
}

function WorkspaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Helper: determine if a project is "running" (preview or deploy)
  const getRunningStatus = useCallback((project: any, skillsList: SkillMeta[]) => {
    // For skill projects, check deploy status
    if (project.id?.startsWith('skill-')) {
      const skillName = project.id.replace(/^skill-/, '');
      const skill = skillsList.find(s => s.name === skillName);
      if (skill?.deployStatus === 'deployed') return '运行中';
      if (skill?.deployStatus === 'building') return '构建中';
    }
    // Fall back to preview status
    if (project.status === 'running') return '运行中';
    return '';
  }, []);

  // Helper: determine project progress status (已部署/已安装/已生成/已确认/新建)
  const getProjectProgressStatus = useCallback((project: any, skillsList: SkillMeta[]) => {
    if (project.deployedUrl) return '已部署';
    if (project.id?.startsWith('skill-')) {
      const skillName = project.id.replace(/^skill-/, '');
      const skill = skillsList.find(s => s.name === skillName);
      if (skill?.deployStatus === 'deployed' || skill?.deployStatus === 'stopped') return '已部署';
      if (skill?.deployStatus === 'building') return '构建中';
    }
    if (project.dependenciesInstalled) return '已安装';
    if (project.latestRequestStatus === 'completed') return '已生成';
    if (project.planConfirmed) return '已确认';
    return '新建';
  }, []);
  const toast = useToast();
  const { theme, toggleTheme, bgUrl, bgCss, primaryHex } = useTheme();
  // Track client mount to avoid hydration mismatch for client-only UI (theme icon, desktopAPI buttons)
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // 获取 IM 渠道连接状态
  useEffect(() => {
    let cancelled = false;
    async function fetchIMStatus() {
      try {
        const resp = await fetch(`${API_BASE}/api/im/status`);
        if (resp.ok) {
          const data = await resp.json();
          if (!cancelled && Array.isArray(data)) setImStatuses(data);
        }
      } catch { /* ignore */ }
    }
    fetchIMStatus();
    const interval = setInterval(fetchIMStatus, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  const viewParam = searchParams?.get('view') as 'home' | 'templates' | 'apps' | 'employees' | 'skills' | 'help' | 'boss' | 'lan-chat' | null;
  const employeeIdParam = searchParams?.get('employee_id');
  const autoSendParam = searchParams?.get('auto_send') === 'true';
  const [currentView, setCurrentView] = useState<'home' | 'templates' | 'apps' | 'employees' | 'skills' | 'help' | 'boss' | 'lan-chat'>(viewParam || 'home');
  const [projects, setProjects] = useState<any[]>([]);
  const [projectsPage, setProjectsPage] = useState(1);
  const [projectsPageSize] = useState(20);
  const [projectsTotalPages, setProjectsTotalPages] = useState(1);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [preferredCli, setPreferredCli] = useState<ActiveCliId>(DEFAULT_ACTIVE_CLI);
  const [selectedModel, setSelectedModel] = useState<string>(getDefaultModelForCli(DEFAULT_ACTIVE_CLI));
  const [thinkingMode, setThinkingMode] = useState(false);
  const [projectType, setProjectType] = useState<'nextjs' | 'python-fastapi'>('nextjs');
  const [workMode, setWorkMode] = useState<'code' | 'work' | 'boss' | 'secretary' | 'cli'>('code');

  // IM 渠道连接状态
  const [imStatuses, setImStatuses] = useState<Array<{ platform: string; connectionStatus: string; configured: boolean }>>([]);
  const [workModeReady, setWorkModeReady] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [inputControl, setInputControl] = useState<{ focus: () => void; setMessage: (msg: string) => void } | null>(null);
  const { settings: globalSettings } = useGlobalSettings();
  const [showSettings, setShowSettings] = useState(false);

  // Embedded page view from context
  const { openPage: openEmbeddedPage, closePage: closeEmbeddedPage, currentPage: embeddedPage } = useEmbeddedPage();

  // Global slim mode - enables window size toggle from title bar
  useSlimMode();

  // Employee state
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  // Cache input content per employee
  const employeeInputCacheRef = useRef<Record<string, string>>({});
  // Current input message (synced with ChatInput via inputControl)
  const currentInputRef = useRef<string>('');

  // Secretary mode: dashboard refresh trigger
  const [secretaryRefreshTrigger, setSecretaryRefreshTrigger] = useState(0);
  const [employeeCreateTrigger, setEmployeeCreateTrigger] = useState(0);
  const employeesLoadedRef = useRef(false);

  // Employee working status (for header badge)
  const [workingEmployeeCount, setWorkingEmployeeCount] = useState(0);
  const [totalEmployeeCount, setTotalEmployeeCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function fetchEmployeeStatus() {
      try {
        const res = await fetch(`${API_BASE}/api/boss/employees-status`);
        const data = await res.json();
        if (!cancelled && data.success && Array.isArray(data.data)) {
          const working = data.data.filter((e: any) => e.runningTasks.length > 0).length;
          setWorkingEmployeeCount(working);
          setTotalEmployeeCount(data.data.length);
        }
      } catch { /* ignore */ }
    }
    fetchEmployeeStatus();
    const interval = setInterval(fetchEmployeeStatus, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const employeesAbortRef = useRef<AbortController | null>(null);

  // Handle employees loaded from dashboard (secretary mode avoids separate /api/employees call)
  const handleDashboardEmployees = useCallback((items: Array<{ id: string; name: string; description?: string; category?: string; mode?: string; first_prompt?: string; is_builtin?: boolean }>) => {
    if (!employeesLoadedRef.current && items.length > 0) {
      employeesLoadedRef.current = true;
      // Abort any in-flight /api/employees request
      employeesAbortRef.current?.abort();
      setEmployees(items.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        category: (item.category || 'other') as any,
        mode: (item.mode || 'code') as any,
        first_prompt: item.first_prompt,
        system_prompt: '',
        is_builtin: item.is_builtin ?? false,
        created_at: '',
        updated_at: '',
      })));
    }
  }, []);

  // Load employees for display
  const loadEmployees = useCallback(async () => {
    if (employeesLoadedRef.current) return;
    const controller = new AbortController();
    employeesAbortRef.current = controller;
    try {
      const response = await fetch(`${API_BASE}/api/employees`, { signal: controller.signal });
      if (response.ok) {
        const data = await response.json();
        if (!employeesLoadedRef.current) {
          employeesLoadedRef.current = true;
          setEmployees(data.data || []);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Failed to load employees:', error);
    }
  }, []);

  // 通知 Electron 主进程：页面已渲染完成，可以关闭启动页
  const appReadyNotifiedRef = useRef(false);
  useEffect(() => {
    if (appReadyNotifiedRef.current) return;
    // 等 projects 或 templates 加载完成后通知（首页默认加载这两个）
    if (projects.length > 0 || templates.length > 0 || employees.length > 0) {
      appReadyNotifiedRef.current = true;
      requestAnimationFrame(() => {
        if (typeof window !== 'undefined' && (window as any).desktopAPI?.appReady) {
          (window as any).desktopAPI.appReady().catch(() => {});
        }
      });
    }
  }, [projects, templates, employees]);

  // 兜底：5 秒后无论如何都通知（防止数据为空时永远不通知）
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!appReadyNotifiedRef.current) {
        appReadyNotifiedRef.current = true;
        if (typeof window !== 'undefined' && (window as any).desktopAPI?.appReady) {
          (window as any).desktopAPI.appReady().catch(() => {});
        }
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // Load default employee from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('selected_employee_id');
    if (saved) {
      setSelectedEmployeeId(saved);
    } else {
      setSelectedEmployeeId('builtin-python-dev');
    }
    // Employees will be loaded either via dashboard callback (secretary mode)
    // or via loadEmployees in the view-based useEffect below
  }, []);

  // Handle employee selection - with input cache
  const handleEmployeeSelect = (employee: Employee) => {
    // Save current input for previous employee
    if (selectedEmployeeId && currentInputRef.current) {
      employeeInputCacheRef.current[selectedEmployeeId] = currentInputRef.current;
    }

    setSelectedEmployeeId(employee.id);
    localStorage.setItem('selected_employee_id', employee.id);
    // Auto switch workMode based on employee mode
    setWorkMode(employee.mode);

    // Always sync projectType when switching employees
    const isPythonEmployee = employee.id === 'builtin-python-dev' || 
      employee.system_prompt_execution?.toLowerCase().includes('fastapi') ||
      employee.system_prompt?.toLowerCase().includes('fastapi');
    setProjectType(isPythonEmployee ? 'python-fastapi' : 'nextjs');

    // Restore cached input or use first_prompt
    const cachedInput = employeeInputCacheRef.current[employee.id];
    const inputToSet = cachedInput ?? employee.first_prompt ?? '';

    if (inputControl) {
      inputControl.setMessage(inputToSet);
      currentInputRef.current = inputToSet;
    }
  };

  // Sync workMode and first_prompt with selected employee after employees loaded
  useEffect(() => {
    if (employees.length > 0 && selectedEmployeeId) {
      const emp = employees.find(e => e.id === selectedEmployeeId);
      if (emp) {
        if (emp.mode !== workMode) {
          setWorkMode(emp.mode);
        }
        // Sync projectType based on employee
        const isPythonEmployee = emp.id === 'builtin-python-dev' || 
          emp.system_prompt_execution?.toLowerCase().includes('fastapi') ||
          emp.system_prompt?.toLowerCase().includes('fastapi');
        const expectedProjectType = isPythonEmployee ? 'python-fastapi' : 'nextjs';
        if (projectType !== expectedProjectType) {
          setProjectType(expectedProjectType);
        }
        // Set first_prompt to input if no cached input exists
        if (inputControl && !employeeInputCacheRef.current[selectedEmployeeId]) {
          const prompt = emp.first_prompt ?? '';
          inputControl.setMessage(prompt);
          currentInputRef.current = prompt;
        }
      }
    }
  }, [employees, selectedEmployeeId, inputControl]);

  // Get employee name by ID for display
  const getEmployeeName = (employeeId: string | null | undefined): string | null => {
    if (!employeeId) return null;
    const emp = employees.find(e => e.id === employeeId);
    return emp?.name || null;
  };

  // Skills state
  const [skills, setSkills] = useState<SkillMeta[]>([]);

  // Build model options
  const modelOptions: ActiveModelOption[] = buildActiveModelOptions({});
  const cliOptions = Object.keys(ACTIVE_CLI_MODEL_OPTIONS).map(id => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    available: true
  }));

  // Load projects (for main content, need all projects)
  const loadProjects = useCallback(async (page = 1) => {
    try {
      const r = await fetch(`${API_BASE}/api/projects?page=${page}&pageSize=${projectsPageSize}`);
      if (!r.ok) return;
      const payload = await r.json();
      const items = Array.isArray(payload?.data?.projects) ? payload.data.projects :
                     Array.isArray(payload?.data) ? payload.data : [];
      setProjects(items);
      if (payload?.data?.pagination) {
        setProjectsTotalPages(payload.data.pagination.totalPages);
        setProjectsPage(page);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  }, [projectsPageSize]);

  // Load templates
  const loadTemplates = useCallback(async () => {
    // No /api/templates route exists — use online templates directly
    setTemplates(ONLINE_TEMPLATES);
  }, []);

  // Load skills (for project status display)
  const loadSkills = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/skills`);
      if (response.ok) {
        const data = await response.json();
        setSkills(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load skills:', error);
    }
  }, []);

  // Sync currentView with URL parameter
  useEffect(() => {
    if (viewParam && viewParam !== currentView) {
      setCurrentView(viewParam);
    }
  }, [viewParam]);

  // Restore workMode from localStorage (client-only to avoid hydration mismatch)
  useEffect(() => {
    const saved = localStorage.getItem('workspace_work_mode');
    if (saved === 'work' || saved === 'code' || saved === 'secretary' || saved === 'boss' || saved === 'cli') {
      setWorkMode(saved);
    }
    setWorkModeReady(true);
  }, []);

  // 保存 workMode 到 localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('workspace_work_mode', workMode);
    }
  }, [workMode]);


  useEffect(() => {
    if (currentView === 'home') {
      loadTemplates();
      loadProjects();
    } else if (currentView === 'apps') {
      loadProjects(1);
      loadSkills();
      loadEmployees();
    } else if (currentView === 'templates') {
      loadTemplates();
    } else if (currentView === 'employees') {
      loadEmployees();
    }
  }, [currentView, loadProjects, loadTemplates, loadSkills, loadEmployees]);

  // Load employees for non-secretary home view
  // In secretary mode, employees are provided by the dashboard callback
  useEffect(() => {
    if (!workModeReady) return; // Wait for localStorage restore
    if (currentView === 'home' && workMode !== 'secretary') {
      loadEmployees();
    }
  }, [currentView, workMode, workModeReady, loadEmployees]);

  // Sync with global settings
  useEffect(() => {
    if (globalSettings?.default_cli) {
      const sanitized = sanitizeActiveCli(globalSettings.default_cli, DEFAULT_ACTIVE_CLI);
      setPreferredCli(sanitized);

      const cliConfig = globalSettings.cli_settings?.[sanitized];
      if (cliConfig?.model) {
        const normalized = normalizeModelForCli(sanitized, cliConfig.model, DEFAULT_ACTIVE_CLI);
        setSelectedModel(normalized);
      } else {
        setSelectedModel(getDefaultModelForCli(sanitized));
      }
    }
  }, [globalSettings]);

  // Create project and navigate
  // employeeId param allows overriding selectedEmployeeId (fixes async state update issue)
  const handleCreateProject = useCallback(async (message: string, images?: any[], employeeId?: string): Promise<boolean> => {
    if (isCreating) return false;

    setIsCreating(true);

    try {
      // Generate short project ID (8 chars)
      const projectId = `p-${Math.random().toString(36).substring(2, 10)}`;

      // Get the actual employee to use their mode
      const actualEmployeeId = employeeId ?? selectedEmployeeId;
      const selectedEmployee = employees.find(e => e.id === actualEmployeeId);
      const actualMode = selectedEmployee?.mode || workMode;

      // Determine project type based on mode and employee
      // work, boss, cli modes use 'default' project type
      // code mode: detect Python employee, otherwise use user-selected projectType
      let actualProjectType: string;
      if (actualMode === 'work' || actualMode === 'boss' || actualMode === 'cli') {
        actualProjectType = 'default';
      } else if (selectedEmployee) {
        const isPython = selectedEmployee.id === 'builtin-python-dev' ||
          selectedEmployee.system_prompt_execution?.toLowerCase().includes('fastapi') ||
          selectedEmployee.system_prompt?.toLowerCase().includes('fastapi') ||
          selectedEmployee.description?.toLowerCase().includes('fastapi') ||
          selectedEmployee.description?.toLowerCase().includes('python');
        actualProjectType = isPython ? 'python-fastapi' : projectType;
      } else {
        actualProjectType = projectType;
      }

      const response = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          name: message.slice(0, 50) || 'New Project',
          description: message.slice(0, 200),
          initialPrompt: message,
          preferredCli,
          selectedModel,
          projectType: actualProjectType,
          mode: actualMode,
          employee_id: actualEmployeeId ?? undefined,
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Create project failed:', response.status, errorText);
        throw new Error(`Failed to create project: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      // 演示模式：sourceProjectId 模式直接跳转到源项目
      if (data.data?.demoRedirect?.projectId) {
        const { projectId: targetProjectId, deployedUrl } = data.data.demoRedirect;
        console.log('[DemoMode] Redirecting to sourceProjectId:', targetProjectId);
        const targetUrl = `/${targetProjectId}/chat?demoReplay=true&deployedUrl=${encodeURIComponent(deployedUrl || '')}`;
        router.push(targetUrl);
        return true;
      }

      // Navigate to project chat page with initial prompt
      const encodedPrompt = encodeURIComponent(message);
      router.push(`/${projectId}/chat?initial_prompt=${encodedPrompt}`);
      return true; // Success
    } catch (error) {
      console.error('Failed to create project:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to create project';
      alert(errorMsg);
      return false; // Failure
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, preferredCli, selectedModel, projectType, workMode, selectedEmployeeId, employees, router]);

  // Handle auto_send from URL params (for shift+派活 new window)
  const autoSendTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoSendTriggeredRef.current) return;
    if (!autoSendParam || !employeeIdParam || employees.length === 0) return;

    const employee = employees.find(e => e.id === employeeIdParam);
    if (!employee) return;

    // Mark as triggered to prevent re-execution
    autoSendTriggeredRef.current = true;

    // Set employee and mode
    setSelectedEmployeeId(employee.id);
    localStorage.setItem('selected_employee_id', employee.id);
    setWorkMode(employee.mode);

    // Auto send first_prompt if exists (skip for secretary mode - no project creation)
    if (employee.mode !== 'secretary' && employee.first_prompt) {
      handleCreateProject(employee.first_prompt, undefined, employee.id);
    }
  }, [autoSendParam, employeeIdParam, employees, handleCreateProject]);

  const handleModelChange = (option: any) => {
    if (option && typeof option.id === 'string') {
      setSelectedModel(option.id);
    }
  };

  const handleCliChange = (cliId: string) => {
    const sanitized = sanitizeActiveCli(cliId, DEFAULT_ACTIVE_CLI);
    setPreferredCli(sanitized);
    setSelectedModel(getDefaultModelForCli(sanitized));
  };

  // Create project from template
  const handleUseTemplate = async (templateId: string, templateName: string) => {
    if (creatingTemplateId) return;
    setCreatingTemplateId(templateId);

    try {
      const response = await fetch(`${API_BASE}/api/templates/${templateId}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: templateName }),
      });

      if (!response.ok) {
        throw new Error('Failed to create project from template');
      }

      const data = await response.json();
      const projectId = data.data?.projectId;

      if (projectId) {
        router.push(`/${projectId}/chat`);
      }
    } catch (error) {
      console.error('Failed to create project from template:', error);
      alert('创建项目失败，请重试');
    } finally {
      setCreatingTemplateId(null);
    }
  };

  // Delete project
  const handleDeleteProject = async (projectId: string, projectName: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm(`确定要删除项目 "${projectName}" 吗？此操作不可恢复。`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete project');
      }

      // Refresh projects list
      await loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
      alert('删除项目失败，请重试');
    }
  };

  // Merge forked project back to source skill
  const handleMergeToSkill = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm('确定要将代码合并回主技能吗？只会同步代码文件，不会覆盖数据和环境配置。')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/merge-to-skill`, {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        const skillName = data.data.skillName;
        toast.success(`已合并回技能 ${skillName}，同步 ${data.data.filesCopied} 个文件，跳过 ${data.data.filesSkipped} 个数据文件`);

        // Check if the skill has a local deploy and prompt for redeploy
        try {
          const deployRes = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}/deploy`);
          const deployData = await deployRes.json();
          if (deployData.success) {
            const localStatus = deployData.data?.local?.status;
            if (localStatus === 'deployed' || localStatus === 'stopped') {
              toast.showActionToast(
                '代码已更新，是否重新部署？',
                {
                  label: '重新部署',
                  onClick: async () => {
                    try {
                      const redeployRes = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skillName)}/deploy/redeploy`, {
                        method: 'POST',
                      });
                      const redeployData = await redeployRes.json();
                      if (redeployData.success) {
                        toast.success('重新部署已启动');
                      } else {
                        toast.error(redeployData.error || '重新部署失败');
                      }
                    } catch {
                      toast.error('重新部署请求失败');
                    }
                  },
                },
                'info',
                10000,
              );
            }
          }
        } catch {
          // Silently ignore deploy status check failures
        }
      } else {
        toast.error(data.error || '合并失败');
      }
    } catch (error) {
      toast.error('合并失败');
    }
  };

  // Import template
  const handleImportTemplate = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input
    event.target.value = '';

    if (!file.name.endsWith('.zip')) {
      alert('只支持 .zip 格式文件');
      return;
    }

    setIsImporting(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/api/templates/import`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!result.success) {
        alert(result.error || '导入失败');
        return;
      }

      alert(result.data.message || '导入成功');

      // Refresh templates list
      await loadTemplates();
    } catch (error) {
      console.error('Failed to import template:', error);
      alert('导入失败，请重试');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center p-0 md:p-0 overflow-hidden">
    {/* Animated Background */}
    <AnimatedBackground bgUrl={bgUrl} bgCss={bgCss} />
    <ThemeAnimations />
    {/* Refresh & DevTools - top right corner */}
    {mounted && (window as any).desktopAPI && (
      <div className="fixed top-[10px] right-4 flex items-center gap-1" style={{ zIndex: 10000, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          className="p-1.5 rounded-lg hover:bg-white/20 active:bg-white/30 transition-colors text-slate-500 dark:text-slate-400"
          onClick={() => (window as any).desktopAPI?.navigationControls?.refresh()}
          title="刷新页面"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
        <button
          className="p-1.5 rounded-lg hover:bg-white/20 active:bg-white/30 transition-colors text-slate-500 dark:text-slate-400"
          onClick={() => (window as any).desktopAPI?.navigationControls?.toggleDevTools()}
          title="开发者工具 (F12)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </button>
      </div>
    )}
    <div className="glass flex h-full w-full  rounded-none md:rounded-2xl shadow-2xl overflow-hidden relative">
      <AppSidebar
        currentPage={currentView}
        onNavigate={(page) => {
          if (page === 'settings') {
            setShowSettings(true);
          } else {
            router.push(`/workspace?view=${page}`);
          }
        }}
        theme={theme}
        mounted={mounted}
        onToggleTheme={toggleTheme}
      />

      <div className="flex-1 flex flex-col min-w-0 ">
        {/* Embedded Page View (iframe) - replaces all other views when active */}
        {embeddedPage ? (
          <EmbeddedPageView
            url={embeddedPage.url}
            title={embeddedPage.title}
            onBack={() => closeEmbeddedPage()}
          />
        ) : (<>
        {/* Home View */}
        {currentView === 'home' && (
          <>
          {/* Secretary mode: 3-column layout (sidebar | chat | dashboard) */}
            <div className="flex-1 flex h-full overflow-hidden">
              {/* Main Chat Area */}
              <main className="flex-1 flex flex-col relative min-w-0 overflow-hidden glass-card m-2 rounded-2xl h-[calc(100%-16px)]">
                {/* Header */}
                <header className="h-16 flex items-center justify-between px-8 border-b border-white/10 z-10 sticky top-0">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-lg text-slate-900 dark:text-slate-100"></span>
                    {(() => {
                      const connected = imStatuses.filter(s => s.connectionStatus === 'connected');
                      const PLATFORM_NAMES: Record<string, string> = {
                        dingtalk: '钉钉', feishu: '飞书', wechat: '微信', wecom: '企微', qq: 'QQ', wechat_personal: '个人微信',
                      };
                      if (connected.length > 0) {
                        const names = connected.map(s => PLATFORM_NAMES[s.platform] || s.platform).join('、');
                        return (
                          <span className="flex items-center gap-1 bg-green-500/20 text-green-600 dark:text-green-400 text-[10px] px-2 py-0.5 rounded-full font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            {names} 已连接
                          </span>
                        );
                      }
                      return (
                        <span className="bg-gray-500/20 text-gray-500 dark:text-gray-400 text-[10px] px-2 py-0.5 rounded-full font-medium">
                          未连接渠道
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      className="p-2 rounded-full hover:bg-white/20 transition-colors text-slate-600 dark:text-slate-300 relative"
                      title="智能小弟"
                      onClick={() => router.push('/workspace?view=employees')}
                    >
                      <Users className="w-5 h-5" />
                      {workingEmployeeCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-green-500 rounded-full leading-none shadow-sm">
                          {workingEmployeeCount}
                        </span>
                      )}
                    </button>
                    {totalEmployeeCount > 0 && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {workingEmployeeCount > 0 ? (
                          <span className="text-green-600 dark:text-green-400">{workingEmployeeCount}人工作中</span>
                        ) : (
                          <span>全部空闲</span>
                        )}
                      </span>
                    )}
                  </div>
                </header>
                {/* Chat Panel fills the rest */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <SecretaryPanel />
                </div>
              </main>
              {/* Right Sidebar - Dashboard */}
              <aside className="hidden min-[1224px]:flex flex-col w-80 shrink-0 glass-card m-2 rounded-2xl h-[calc(100%-16px)] overflow-y-auto">
                <HomeDashboard refreshTrigger={secretaryRefreshTrigger} layout="sidebar" onEmployeesLoaded={handleDashboardEmployees} />
              </aside>
            </div>
          </>
        )}
        {/* Templates View */}
        {currentView === 'templates' && (
          <div className="flex-1 overflow-y-auto p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">模板市场</h2>
              <div>
                <input
                  type="file"
                  id="template-import-input"
                  accept=".zip"
                  onChange={handleImportTemplate}
                  className="hidden"
                  disabled={isImporting}
                />
                <label
                  htmlFor="template-import-input"
                  className={`px-4 py-2 ${
                    isImporting
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-black hover:bg-gray-900 cursor-pointer'
                  } text-white text-sm font-medium rounded-lg transition-colors inline-block`}
                >
                  {isImporting ? '导入中...' : '导入模板'}
                </label>
              </div>
            </div>
            {templates.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Folder className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-500 dark:text-slate-400">暂无可用模板</p>
                <p className="text-sm text-gray-400 dark:text-slate-500 mt-2">加载中...</p>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
                {templates.map((template) => {
                  const isDownloaded = template.isDownloaded !== false;

                  return (
                    <div
                      key={template.id}
                      className="glass-card rounded-2xl p-4 hover:shadow-lg transition-shadow flex items-start gap-4 group"
                    >
                      {/* Icon */}
                      <div className="w-16 h-16 rounded-xl flex items-center justify-center bg-gray-100 dark:bg-white/10 flex-shrink-0">
                        {isDownloaded ? (
                          <CheckCircle className="w-8 h-8 text-green-500" />
                        ) : (
                          <ShoppingBag className="w-8 h-8 text-gray-500 dark:text-slate-400" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Title */}
                        <h3 className="font-semibold text-gray-900 dark:text-slate-100 text-base mb-1 truncate">
                          {template.name}
                        </h3>

                        {/* Author and Status */}
                        <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
                          作者：{template.author || '古德白'}
                          {template.version && ` v${template.version}`} · {isDownloaded ? '本地' : '在线'}
                        </p>

                        {/* Description */}
                        {template.description && (
                          <p className="text-sm text-gray-600 dark:text-slate-300 line-clamp-2">
                            {template.description}
                          </p>
                        )}
                      </div>

                      {/* Action Button */}
                      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isDownloaded ? (
                          <button
                            onClick={() => handleUseTemplate(template.id, template.name)}
                            disabled={creatingTemplateId !== null}
                            className="px-4 py-2 bg-black hover:bg-gray-900 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                          >
                            {creatingTemplateId === template.id ? '创建中...' : '使用'}
                          </button>
                        ) : (
                          <button
                            disabled
                            title="即将推出"
                            className="px-4 py-2 bg-gray-300 text-gray-500 text-sm font-medium rounded-lg cursor-not-allowed whitespace-nowrap"
                          >
                            下载
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* My Apps View */}
        {currentView === 'apps' && (
          <div className="flex-1 flex flex-col overflow-hidden glass-card m-2 rounded-2xl h-[calc(100%-16px)]">
            {/* Header with back button */}
            <header className="h-14 flex items-center justify-between px-6 shrink-0 border-b border-white/10">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setCurrentView('home');
                    router.push('/workspace');
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/10 rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>返回</span>
                </button>
                <div className="w-px h-4 bg-slate-300/40 dark:bg-white/10" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">牛马记录</span>
              </div>
              {projects.length > 0 && (
                <div className="flex items-center gap-2">
                  {[
                    { key: null, label: '全部' },
                    { key: '已部署', label: '已部署' },
                    { key: '已安装', label: '已安装' },
                    { key: '已生成', label: '已生成' },
                    { key: '已确认', label: '已确认' },
                    { key: '新建', label: '新建' },
                  ].map(({ key, label }) => {
                    const count = key === null
                      ? projects.length
                      : projects.filter((p: any) => {
                          return getProjectProgressStatus(p, skills) === key;
                        }).length;
                    const isActive = filterStatus === key;
                    return (
                      <button
                        key={label}
                        onClick={() => setFilterStatus(key)}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${
                          isActive
                            ? 'bg-white/40 dark:bg-white/10 text-slate-900 dark:text-slate-100 font-medium shadow-sm'
                            : 'bg-white/20 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-white/30 dark:hover:bg-white/10'
                        }`}
                      >
                        {label}({count})
                      </button>
                    );
                  })}
                </div>
              )}
            </header>
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
            {projects.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-slate-400">还没有项目</p>
              </div>
            ) : (
              <>
              <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
                {projects
                  .filter((project: any) => {
                    if (filterStatus === null) return true;
                    return getProjectProgressStatus(project, skills) === filterStatus;
                  })
                  .map((project: any) => {
                  // Display employee name or fallback to projectType
                  const employeeName = getEmployeeName(project.employee_id);
                  const displayType = employeeName || (project.projectType === 'python-fastapi' ? 'Python FastAPI' : project.mode === 'work' ? '工作模式' : 'Next.js');
                  const updateTime = new Date(project.updated_at || project.updatedAt || project.created_at || project.createdAt);
                  const updateDate = updateTime.toLocaleDateString();
                  const updateTimeStr = updateTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

                  // 项目主进度状态（5个）
                  const latestRequestStatus = project.latestRequestStatus;
                  let progressStatus = '';
                  let progressStatusColor = '';

                  const computedStatus = getProjectProgressStatus(project, skills);
                  progressStatus = computedStatus;
                  if (computedStatus === '已部署') {
                    progressStatusColor = 'bg-green-500/20 dark:bg-green-500/20 text-green-800 dark:text-green-400 font-medium';
                  } else if (computedStatus === '构建中') {
                    progressStatusColor = 'bg-yellow-500/20 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 font-medium';
                  } else if (computedStatus === '已安装') {
                    progressStatusColor = 'bg-purple-500/20 dark:bg-purple-500/20 text-purple-800 dark:text-purple-400 font-medium';
                  } else if (computedStatus === '已生成') {
                    progressStatusColor = 'bg-blue-500/20 dark:bg-blue-500/20 text-blue-800 dark:text-blue-400 font-medium';
                  } else if (computedStatus === '已确认') {
                    progressStatusColor = 'bg-yellow-500/20 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 font-medium';
                  } else {
                    progressStatusColor = 'bg-gray-500/20 dark:bg-white/10 text-gray-800 dark:text-slate-400 font-medium';
                  }

                  // 运行状态：预览或部署
                  const previewStatusText = getRunningStatus(project, skills);

                  return (
                    <div
                      key={project.id}
                      className="glass-card rounded-2xl p-4 hover:shadow-lg transition-shadow flex items-start gap-4 cursor-pointer group relative"
                      onClick={() => router.push(`/${project.id}/chat`)}
                    >
                      {/* Icon */}
                      <div className="w-16 h-16 rounded-xl flex items-center justify-center bg-gray-100 dark:bg-white/10 flex-shrink-0">
                        <Folder className="w-8 h-8 text-gray-500 dark:text-slate-400" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Title + Status */}
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-gray-950 dark:text-slate-100 text-base truncate">
                            {project.name}
                          </h3>
                          <div className="ml-auto flex items-center gap-1.5 shrink-0">
                            {progressStatus && (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${progressStatusColor}`}>
                                {progressStatus}
                              </span>
                            )}
                            {previewStatusText && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-green-500/20 dark:bg-green-500/20 text-green-800 dark:text-green-400">
                                {previewStatusText}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Description */}
                        {project.description && (
                          <p className="text-sm text-gray-800 dark:text-slate-300 mb-2 line-clamp-2">
                            {project.description}
                          </p>
                        )}

                        {/* Type and Time */}
                        <div className="flex items-center gap-1.5 text-xs text-gray-800 dark:text-slate-400">
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-500/20 dark:bg-blue-500/20 text-blue-800 dark:text-blue-400 font-medium whitespace-nowrap max-w-[120px] truncate">
                            {displayType}
                          </span>
                          <span>·</span>
                          <span className="whitespace-nowrap">更新于 {updateDate} {updateTimeStr}</span>
                        </div>
                      </div>

                      {/* Delete Button */}
                      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                        {project.fromTemplate?.startsWith('skill:') && (
                          <button
                            onClick={(e) => handleMergeToSkill(project.id, e)}
                            className="px-3 py-1.5 text-white text-sm font-medium rounded-lg transition-colors"
                            style={{ backgroundColor: primaryHex }}
                            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.9)'}
                            onMouseLeave={e => e.currentTarget.style.filter = ''}
                          >
                            合并回主技能
                          </button>
                        )}
                        <button
                          onClick={(e) => handleDeleteProject(project.id, project.name, e)}
                          className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {projectsTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-white/10">
                  <button
                    onClick={() => loadProjects(projectsPage - 1)}
                    disabled={projectsPage <= 1}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white/50 dark:bg-white/10 hover:bg-white/40 dark:hover:bg-white/20 text-slate-700 dark:text-slate-300"
                  >
                    上一页
                  </button>
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    第 {projectsPage} / {projectsTotalPages} 页
                  </span>
                  <button
                    onClick={() => loadProjects(projectsPage + 1)}
                    disabled={projectsPage >= projectsTotalPages}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white/50 dark:bg-white/10 hover:bg-white/40 dark:hover:bg-white/20 text-slate-700 dark:text-slate-300"
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
            )}
          </div>
          </div>
        )}

        {/* Employees View */}
        {currentView === 'employees' && (
          <div className="flex-1 flex flex-col overflow-hidden glass-card m-2 rounded-2xl h-[calc(100%-16px)]">
            {/* Header with back button */}
            <header className="h-14 flex items-center justify-between px-6 shrink-0 border-b border-white/10">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setCurrentView('home');
                    router.push('/workspace');
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/10 rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>返回</span>
                </button>
                <div className="w-px h-4 bg-slate-300/40 dark:bg-white/10" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">智能小弟</span>
              </div>
              <button
                onClick={() => setEmployeeCreateTrigger(prev => prev + 1)}
                className="bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity px-3 py-1.5 rounded-lg flex items-center gap-1 shadow text-xs font-bold"
              >
                + 新建
              </button>
            </header>
            {/* Content */}
            <div className="flex-1 overflow-hidden">
          <EmployeeList
            createTrigger={employeeCreateTrigger}
            onAssignWork={async (employee, shiftKey) => {
              // Shift+click: open in new slim window
              if (shiftKey && typeof window !== 'undefined' && (window as any).desktopAPI) {
                try {
                  const result = await (window as any).desktopAPI.openNewWindow({
                    slimMode: true,
                    url: `/workspace?view=home&employee_id=${employee.id}&auto_send=true`
                  });
                  if (!result?.success) {
                    console.error('Failed to open new window:', result?.error);
                  }
                } catch (error) {
                  console.error('Failed to open new window:', error);
                }
                return;
              }

              // Normal click: handle in current window
              setSelectedEmployeeId(employee.id);
              localStorage.setItem('selected_employee_id', employee.id);
              setWorkMode(employee.mode);

              // Secretary mode: go to home page (no project creation)
              if (employee.mode === 'secretary') {
                setCurrentView('home');
                return;
              }

              // If employee has first_prompt, create project and send directly
              if (employee.first_prompt) {
                await handleCreateProject(employee.first_prompt, undefined, employee.id);
              } else {
                // No first_prompt, go to home page
                setCurrentView('home');
              }
            }}
          />
            </div>
          </div>
        )}

        {/* Help View */}
        {currentView === 'help' && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 dark:bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <HelpCircle className="w-8 h-8 text-gray-400 dark:text-slate-500" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-slate-100 mb-2">帮助文档</h2>
              <p className="text-gray-500 dark:text-slate-400">即将推出...</p>
            </div>
          </div>
        )}

        {/* Boss View */}
        {currentView === 'boss' && (
          <div className="flex-1 overflow-hidden">
            <EmployeeStatusPanel />
          </div>
        )}

        {/* LAN Chat View */}
        {currentView === 'lan-chat' && (
          <div className="flex-1 flex flex-col overflow-hidden glass-card m-2 rounded-2xl h-[calc(100%-16px)]">
            <header className="h-14 flex items-center justify-between px-6 shrink-0 border-b border-white/10">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setCurrentView('home');
                    router.push('/workspace');
                  }}
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
        )}
        </>)}
      </div>

      {/* Skill Detail Panel */}
    </div>

    {/* Settings Modal */}
    <GlobalSettings
      isOpen={showSettings}
      onClose={() => setShowSettings(false)}
    />
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <EmbeddedPageProvider>
      <Suspense fallback={<div className="h-screen bg-white dark:bg-slate-900 flex items-center justify-center text-slate-900 dark:text-slate-100">加载中...</div>}>
        <WorkspaceContent />
      </Suspense>
    </EmbeddedPageProvider>
  );
}

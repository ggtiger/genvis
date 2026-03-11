/**
 * Dashboard Data API Route
 * GET /api/chat/home/dashboard
 *
 * Aggregates data from multiple sources to provide a unified dashboard view:
 * - Todos (from productivity-hub skill API)
 * - Schedules (from productivity-hub skill API)
 * - Employee status (from boss employees-status API)
 * - Notes (from productivity-hub skill API)
 *
 * Each data source is fetched independently with its own try-catch,
 * so partial failures do not affect the overall response.
 *
 * Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { NextResponse } from 'next/server';
import { callSkillApi, ensureSkillRunning, type SkillCallOptions } from '@/lib/services/secretary-skill-caller';
import { db } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// ========== Interfaces ==========

interface Todo {
  id: string;
  title: string;
  status: string;
  [key: string]: any;
}

interface Schedule {
  id: string;
  title: string;
  startTime: string;
  endTime?: string;
  [key: string]: any;
}

interface Note {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

interface EmployeeStatus {
  id: string;
  name: string;
  description?: string;
  category?: string;
  mode?: string;
  first_prompt?: string;
  is_builtin?: boolean;
  runningTasks: any[];
  totalTaskCount: number;
}

interface DashboardData {
  todos: {
    pending: number;
    inProgress: number;
    completed: number;
    items: Todo[];
  };
  schedules: {
    today: Schedule[];
    upcoming: Schedule[];
  };
  employees: {
    active: number;
    idle: number;
    items: EmployeeStatus[];
  };
  notes: {
    recent: Note[];
  };
  /** If productivity-hub skill is not running, this will contain a hint message */
  skillNotRunning?: string;
  /** The preview URL of the productivity-hub skill (if running) */
  skillUrl?: string;
}

// ========== Helper Functions ==========

/**
 * Check if a schedule's startTime falls within the current calendar day.
 */
function isToday(startTime: string): boolean {
  const scheduleDate = new Date(startTime);
  const now = new Date();

  return (
    scheduleDate.getFullYear() === now.getFullYear() &&
    scheduleDate.getMonth() === now.getMonth() &&
    scheduleDate.getDate() === now.getDate()
  );
}

/**
 * Count todos by status category.
 * Maps various status strings to pending/inProgress/completed.
 */
function countTodosByStatus(todos: Todo[]): {
  pending: number;
  inProgress: number;
  completed: number;
} {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;

  for (const todo of todos) {
    const status = (todo.status || '').toLowerCase().replace(/[-_\s]/g, '');
    if (status === 'completed' || status === 'done') {
      completed++;
    } else if (status === 'inprogress' || status === 'doing' || status === 'active') {
      inProgress++;
    } else {
      // pending, todo, or any other status
      pending++;
    }
  }

  return { pending, inProgress, completed };
}

// ========== Data Fetchers ==========

/**
 * Fetch todos from productivity-hub via skill API.
 */
async function fetchTodos(options?: SkillCallOptions): Promise<DashboardData['todos']> {
  const result = await callSkillApi('productivity-hub', 'GET', '/api/todos', undefined, undefined, options);

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to fetch todos');
  }

  // The skill API may return { data: [...] } or just [...]
  const allItems: Todo[] = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.data?.data)
      ? result.data.data
      : [];

  const counts = countTodosByStatus(allItems);

  // Filter out completed todos for the items list (used in sidebar display)
  const items = allItems.filter((todo) => {
    const status = (todo.status || '').toLowerCase().replace(/[-_\s]/g, '');
    return status !== 'completed' && status !== 'done';
  });

  return {
    ...counts,
    items,
  };
}

/**
 * Fetch schedules from productivity-hub via skill API,
 * filtered to only include today's events.
 */
async function fetchSchedules(options?: SkillCallOptions): Promise<DashboardData['schedules']> {
  const result = await callSkillApi('productivity-hub', 'GET', '/api/schedules', undefined, undefined, options);

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to fetch schedules');
  }

  // The skill API may return { data: [...] } or just [...]
  const allSchedules: Schedule[] = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.data?.data)
      ? result.data.data
      : [];

  // Split into today and upcoming (future, not today)
  const now = new Date();
  const today = allSchedules.filter(
    (schedule) => schedule.startTime && isToday(schedule.startTime)
  );
  const upcoming = allSchedules.filter(
    (schedule) => schedule.startTime && !isToday(schedule.startTime) && new Date(schedule.startTime) > now
  );

  return { today, upcoming };
}

/**
 * Fetch employee status directly from the service layer (no HTTP round-trip).
 * Mirrors the logic from /api/boss/employees-status.
 */
async function fetchEmployeeStatus(): Promise<DashboardData['employees']> {
  const t0 = Date.now();
  const { getAllEmployees } = await import('@/lib/services/employee-service');
  const { getActiveTaskForProject } = await import('@/lib/services/user-requests');
  const { db: dbClient } = await import('@/lib/db/client');
  const { projects: projectsTable } = await import('@/lib/db/schema');
  const { eq: eqFn } = await import('drizzle-orm');
  console.log(`[Dashboard API] fetchEmployeeStatus: imports took ${Date.now() - t0}ms`);

  const employees = await getAllEmployees();
  console.log(`[Dashboard API] fetchEmployeeStatus: getAllEmployees (${employees.length}) took ${Date.now() - t0}ms`);

  let active = 0;
  let idle = 0;
  const items: EmployeeStatus[] = [];

  for (const employee of employees) {
    const employeeProjects = await dbClient
      .select()
      .from(projectsTable)
      .where(eqFn(projectsTable.employee_id, employee.id));

    // Check for active tasks (within 60 minutes) — same as boss API
    const runningTasks: any[] = [];
    for (const project of employeeProjects) {
      const activeTask = await getActiveTaskForProject(project.id, 60);
      if (activeTask) {
        runningTasks.push({
          id: project.id,
          name: (project as any).name,
          status: activeTask.status,
          instruction: activeTask.instruction,
        });
      }
    }

    if (runningTasks.length > 0) {
      active++;
    } else {
      idle++;
    }

    items.push({
      id: employee.id,
      name: employee.name,
      description: employee.description,
      category: employee.category,
      mode: employee.mode,
      first_prompt: employee.first_prompt,
      is_builtin: employee.is_builtin,
      runningTasks,
      totalTaskCount: employeeProjects.length,
    });
  }

  return { active, idle, items };
  // Note: total fetchEmployeeStatus time is logged by the timed() wrapper in GET handler
}

/**
 * Fetch notes from productivity-hub via skill API,
 * limited to the most recent 5.
 */
async function fetchNotes(options?: SkillCallOptions): Promise<DashboardData['notes']> {
  const result = await callSkillApi('productivity-hub', 'GET', '/api/notes', undefined, undefined, options);

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to fetch notes');
  }

  // The skill API may return { data: [...] } or just [...]
  const allNotes: Note[] = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.data?.data)
      ? result.data.data
      : [];

  // Sort by updatedAt or createdAt descending, then limit to 5
  const sorted = [...allNotes].sort((a, b) => {
    const dateA = a.updatedAt || a.createdAt || '';
    const dateB = b.updatedAt || b.createdAt || '';
    return dateB.localeCompare(dateA);
  });

  return { recent: sorted.slice(0, 5) };
}

// ========== Default Data ==========

const defaultTodos: DashboardData['todos'] = {
  pending: 0,
  inProgress: 0,
  completed: 0,
  items: [],
};

const defaultSchedules: DashboardData['schedules'] = {
  today: [],
  upcoming: [],
};

const defaultEmployees: DashboardData['employees'] = {
  active: 0,
  idle: 0,
  items: [],
};

const defaultNotes: DashboardData['notes'] = {
  recent: [],
};

// ========== Route Handler ==========

export async function GET() {
  const t0 = Date.now();

  let todos: DashboardData['todos'] = defaultTodos;
  let schedules: DashboardData['schedules'] = defaultSchedules;
  let employees: DashboardData['employees'] = defaultEmployees;
  let notes: DashboardData['notes'] = defaultNotes;

  // Single skill availability check + auto-start BEFORE parallel fetches.
  await ensureSkillRunning('productivity-hub');
  const tEnsure = Date.now();
  console.log(`[Dashboard API] ensureSkillRunning took ${tEnsure - t0}ms`);

  // Fetch all data sources in parallel, each with independent error handling.
  // skipAutoStart: true — the skill was already ensured running above.
  const skillOpts: SkillCallOptions = { skipAutoStart: true };

  const todosP = fetchTodos(skillOpts);
  const schedulesP = fetchSchedules(skillOpts);
  const employeesP = fetchEmployeeStatus();
  const notesP = fetchNotes(skillOpts);

  // Wrap each to log individual timing
  const timed = <T,>(label: string, p: Promise<T>): Promise<T> =>
    p.then(v => { console.log(`[Dashboard API] ${label} took ${Date.now() - tEnsure}ms`); return v; })
     .catch(e => { console.log(`[Dashboard API] ${label} failed after ${Date.now() - tEnsure}ms`); throw e; });

  const [todosResult, schedulesResult, employeesResult, notesResult] =
    await Promise.allSettled([
      timed('fetchTodos', todosP),
      timed('fetchSchedules', schedulesP),
      timed('fetchEmployeeStatus', employeesP),
      timed('fetchNotes', notesP),
    ]);

  const tFetch = Date.now();
  console.log(`[Dashboard API] All parallel fetches took ${tFetch - tEnsure}ms (total so far ${tFetch - t0}ms)`);

  let skillNotRunning: string | undefined;
  let skillUrl: string | undefined;

  // Try to get the productivity-hub skill's URL (deploy takes priority over preview)
  try {
    const { deployManager } = await import('@/lib/services/deploy-manager');
    const deployInfo = deployManager.getStatus('productivity-hub');
    if (deployInfo.status === 'deployed' && deployInfo.port) {
      skillUrl = `http://localhost:${deployInfo.port}`;
    }
  } catch {
    // DeployManager not available, continue
  }

  if (!skillUrl) {
    try {
      const skillProject = await db
        .select({ previewUrl: projects.previewUrl })
        .from(projects)
        .where(eq(projects.id, 'skill-productivity-hub'))
        .limit(1);
      
      if (skillProject[0]?.previewUrl) {
        skillUrl = skillProject[0].previewUrl;
      }
    } catch (error) {
      console.error('[Dashboard API] Failed to fetch skill URL:', error);
    }
  }

  if (todosResult.status === 'fulfilled') {
    todos = todosResult.value;
  } else {
    const reason = String(todosResult.reason);
    console.error('[Dashboard API] Failed to fetch todos:', reason);
    if (reason.includes('未运行') || reason.includes('SKILL_NOT_RUNNING')) {
      skillNotRunning = '效率助手（productivity-hub）技能未启动。请在工作区中找到该技能项目并点击部署或启动，等待服务启动后刷新仪表盘。';
    }
  }

  if (schedulesResult.status === 'fulfilled') {
    schedules = schedulesResult.value;
  } else {
    console.error('[Dashboard API] Failed to fetch schedules:', schedulesResult.reason);
  }

  if (employeesResult.status === 'fulfilled') {
    employees = employeesResult.value;
  } else {
    console.error('[Dashboard API] Failed to fetch employees:', employeesResult.reason);
  }

  if (notesResult.status === 'fulfilled') {
    notes = notesResult.value;
  } else {
    console.error('[Dashboard API] Failed to fetch notes:', notesResult.reason);
  }

  const dashboardData: DashboardData = {
    todos,
    schedules,
    employees,
    notes,
    ...(skillNotRunning ? { skillNotRunning } : {}),
    ...(skillUrl ? { skillUrl } : {}),
  };

  console.log(`[Dashboard API] Total GET handler took ${Date.now() - t0}ms`);

  return NextResponse.json({
    success: true,
    data: dashboardData,
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

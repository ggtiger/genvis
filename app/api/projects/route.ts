/**
 * Projects API Routes
 * GET /api/projects - Get all projects
 * POST /api/projects - Create new project
 */

import { NextRequest } from 'next/server';
import { getAllProjects, createProject } from '@/lib/services/project';
import type { CreateProjectInput } from '@/types/backend';
import { serializeProjects, serializeProject } from '@/lib/serializers/project';
import { getDefaultModelForCli, normalizeModelId } from '@/lib/constants/cliModels';
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/utils/api-response';
import { matchDemoKeyword } from '@/lib/services/demo-mode';

/**
 * GET /api/projects
 * Get projects list with optional pagination
 * Query params:
 *   - page: page number (default: 1)
 *   - pageSize: items per page (default: 20, no pagination if not specified)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('pageSize');

    // Only paginate if both params are provided
    const page = pageParam ? parseInt(pageParam) : undefined;
    const pageSize = pageSizeParam ? parseInt(pageSizeParam) : undefined;

    const result = await getAllProjects(
      (page !== undefined && pageSize !== undefined)
        ? { page, pageSize }
        : undefined
    );

    // Handle paginated vs non-paginated response
    if (result && typeof result === 'object' && 'projects' in result) {
      // Paginated response
      return createSuccessResponse({
        projects: serializeProjects(result.projects),
        pagination: result.pagination,
      });
    } else {
      // Non-paginated response (legacy)
      return createSuccessResponse(serializeProjects(result as any[]));
    }
  } catch (error) {
    return handleApiError(error, 'API', 'Failed to fetch projects');
  }
}

/**
 * POST /api/projects
 * Create new project
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const preferredCli = String(body.preferredCli || body.preferred_cli || 'claude').toLowerCase();
    const requestedModel = body.selectedModel || body.selected_model;
    const projectType = body.projectType || body.project_type || 'nextjs';
    const mode = body.mode || 'code'; // 'code' | 'work' | 'boss'
    const work_directory = body.work_directory;
    const employee_id = body.employee_id;
    const autoStart = body.autoStart === true;

    const input: CreateProjectInput = {
      project_id: body.project_id,
      name: body.name,
      initialPrompt: body.initialPrompt || body.initial_prompt,
      preferredCli,
      selectedModel: normalizeModelId(preferredCli, requestedModel ?? getDefaultModelForCli(preferredCli)),
      description: body.description,
      projectType,
      mode,
      work_directory,
      employee_id,
      // 有关联员工的项目默认全放行权限，无需手动确认
      permissionMode: employee_id ? 'bypassPermissions' : (body.permissionMode || undefined),
    };

    // Validation
    if (!input.project_id || !input.name) {
      return createErrorResponse('project_id and name are required', undefined, 400);
    }

    // work mode: work_directory is optional, defaults to project directory

    // Debug log
    console.log(`[API] 📝 Creating project:`);
    console.log(`  - project_id: ${input.project_id}`);
    console.log(`  - mode: ${mode}`);
    console.log(`  - projectType: ${projectType}`);
    console.log(`  - work_directory: ${work_directory || '(will use project directory)'}`);
    console.log(`  - autoStart: ${autoStart}`);

    // 演示模式前置检测：sourceProjectId 模式直接跳转，不创建新项目
    if (input.initialPrompt) {
      const demoConfig = await matchDemoKeyword(input.initialPrompt);
      if (demoConfig && demoConfig.sourceProjectId && !demoConfig.skillId) {
        console.log(`[API] Demo mode (sourceProjectId) detected, redirecting to: ${demoConfig.sourceProjectId}`);
        return createSuccessResponse({
          demoRedirect: {
            projectId: demoConfig.sourceProjectId,
            deployedUrl: demoConfig.deployedUrl,
          },
        });
      }
    }

    const project = await createProject(input);

    // Register dispatch tracking when employee_id is provided (secretary dispatch)
    // so that CLI completion triggers notification back to secretary
    if (employee_id) {
      try {
        const { getEmployeeById } = await import('@/lib/services/employee-service');
        const { trackDispatch } = await import('@/lib/services/dispatch-tracker');
        const emp = await getEmployeeById(employee_id);
        trackDispatch({
          projectId: input.project_id,
          employeeName: emp?.name || '员工',
          source: 'web',
          createdAt: Date.now(),
        });
        console.log(`[API] Dispatch tracking registered for project: ${input.project_id} (employee: ${emp?.name || employee_id})`);
      } catch (err) {
        console.warn(`[API] Failed to register dispatch tracking:`, err);
      }
    }

    // Auto-start task if autoStart flag is set and initialPrompt exists
    if (autoStart && input.initialPrompt) {
      console.log(`[API] 🚀 Auto-starting task for project: ${input.project_id}`);

      // Trigger act API in background (fire and forget)
      const actUrl = `${request.nextUrl.origin}/api/chat/${input.project_id}/act`;
      fetch(actUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: input.initialPrompt,
          cliPreference: preferredCli,
          selectedModel: input.selectedModel,
          isInitialPrompt: true,
        }),
      }).catch(err => {
        console.error(`[API] Failed to auto-start task for ${input.project_id}:`, err);
      });

      console.log(`[API] ✅ Task auto-start triggered (background)`);
    }

    return createSuccessResponse(serializeProject(project), 201);
  } catch (error) {
    return handleApiError(error, 'API', 'Failed to create project');
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

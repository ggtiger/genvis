/**
 * Secretary Dispatch Service
 *
 * Dispatches tasks to other employees by creating projects
 * and auto-starting them. Used by the secretary employee to
 * coordinate work across different digital employees.
 *
 * Requirements: 3.1, 3.2
 */

import { getEmployeeById } from './employee-service';
import { createProject, getProjectById } from './project';
import { createMessage } from './message';
import { generateId } from '@/lib/utils/id';
import {
  upsertUserRequest,
  markUserRequestAsProcessing,
} from './user-requests';
import path from 'path';

/**
 * Result of dispatching a task to an employee
 */
export interface DispatchResult {
  success: boolean;
  projectId?: string;
  employeeId: string;
  employeeName: string;
  error?: string;
}

/**
 * Image file info for dispatch with images
 */
export interface DispatchImageFile {
  /** Filename on disk (in secretary-uploads dir) */
  filename: string;
  /** Original display name */
  originalName: string;
  /** Absolute path on disk */
  absolutePath: string;
}

/**
 * Dispatch a task to a specific employee by creating a new project
 * assigned to that employee and auto-starting the task.
 *
 * Instead of calling the act API via HTTP (which has port mismatch issues),
 * this directly invokes the execution logic from the service layer.
 */
export async function dispatchToEmployee(
  employeeId: string,
  instruction: string,
  imageFiles?: DispatchImageFile[],
): Promise<DispatchResult> {
  console.log(`\n[SecretaryDispatch] ========== dispatchToEmployee 开始 ==========`);
  console.log(`[SecretaryDispatch] 👤 employeeId=${employeeId}`);
  console.log(`[SecretaryDispatch] 📝 instruction="${instruction.slice(0, 150)}"`);
  console.log(`[SecretaryDispatch] 📎 imageFiles=${imageFiles?.length || 0}`);

  // 1. Look up the employee by ID
  let employee;
  try {
    employee = await getEmployeeById(employeeId);
  } catch (error) {
    return {
      success: false,
      employeeId,
      employeeName: '',
      error: `查找员工失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }

  if (!employee) {
    return {
      success: false,
      employeeId,
      employeeName: '',
      error: `员工不存在: ${employeeId}`,
    };
  }

  // 2. Create a new project assigned to the target employee
  const projectId = `dispatch-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  const projectName = `${employee.name} - ${instruction.slice(0, 30)}${instruction.length > 30 ? '...' : ''}`;
  const mode = employee.mode === 'secretary' ? 'work' : (employee.mode as 'code' | 'work' | 'boss' | 'cli') || 'work';

  // Detect Python employee for correct project type
  const isPython = employee.id === 'builtin-python-dev' ||
    employee.system_prompt_execution?.toLowerCase().includes('fastapi') ||
    employee.system_prompt?.toLowerCase().includes('fastapi');
  const projectType = mode !== 'code' ? 'default' : isPython ? 'python-fastapi' : 'nextjs';

  try {
    const project = await createProject({
      project_id: projectId,
      name: projectName,
      initialPrompt: instruction,
      mode,
      employee_id: employeeId,
      projectType,
      permissionMode: 'bypassPermissions',
    });
    console.log(`[SecretaryDispatch] 📁 项目创建成功: id=${project.id}, name="${projectName}", mode=${mode}, type=${projectType}`);

    // Copy images to project assets if provided
    let finalInstruction = instruction;
    if (imageFiles && imageFiles.length > 0) {
      try {
        const { PROJECTS_DIR_ABSOLUTE } = await import('@/lib/config/paths');
        const fs = await import('fs/promises');
        const projectAssetsDir = path.join(PROJECTS_DIR_ABSOLUTE, project.id, 'assets');
        await fs.mkdir(projectAssetsDir, { recursive: true });

        const copiedPaths: string[] = [];
        for (const img of imageFiles) {
          try {
            const destPath = path.join(projectAssetsDir, img.originalName);
            await fs.copyFile(img.absolutePath, destPath);
            copiedPaths.push(destPath);
          } catch (err) {
            console.warn(`[SecretaryDispatch] Failed to copy image ${img.originalName}:`, err);
          }
        }

        if (copiedPaths.length > 0) {
          const relPaths = copiedPaths.map(p => `assets/${path.basename(p)}`);
          const imageList = relPaths.map(p => `  - ${p}`).join('\n');
          finalInstruction = `${instruction}\n\n[附件图片 - 位于项目工作目录下]\n${imageList}\n请直接读取并处理这些图片文件。`;
        }
      } catch (err) {
        console.warn('[SecretaryDispatch] Failed to copy images to project:', err);
      }
    }

    // Prepend current datetime so the employee knows the time context
    const now = new Date();
    const datePrefix = `[当前时间: ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]\n`;
    finalInstruction = datePrefix + finalInstruction;

    // 3. Auto-start: directly invoke the execution logic (no HTTP round-trip)
    autoStartTask(project.id, finalInstruction, mode).catch(async (err) => {
      console.error(`[SecretaryDispatch] Failed to auto-start task for ${project.id}:`, err);
      // If autoStartTask itself fails before the executor runs, there may be
      // an orphan UserRequest stuck in processing. We can't easily recover the
      // requestId here because it's generated inside autoStartTask, but the
      // 60-minute time window in getActiveTaskForProject will eventually expire it.
    });

    console.log(`[SecretaryDispatch] ✅ Dispatched to ${employee.name} (${employeeId}), project: ${project.id}`);

    return {
      success: true,
      projectId: project.id,
      employeeId,
      employeeName: employee.name,
    };
  } catch (error) {
    console.error(`[SecretaryDispatch] Failed to create project for dispatch:`, error);
    return {
      success: false,
      employeeId,
      employeeName: employee.name,
      error: `创建项目失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}


/**
 * Auto-start a dispatched task by directly invoking the CLI execution logic.
 * Mirrors the logic from POST /api/chat/[project_id]/act for work/boss mode.
 */
async function autoStartTask(
  projectId: string,
  instruction: string,
  mode: string
): Promise<void> {
  const { PROJECTS_DIR_ABSOLUTE } = await import('@/lib/config/paths');
  const { streamManager } = await import('@/lib/services/stream');
  const { serializeMessage } = await import('@/lib/serializers/chat');
  const { updateProjectActivity } = await import('@/lib/services/project');
  const { getDefaultModelForCli, normalizeModelId } = await import('@/lib/constants/cliModels');

  const project = await getProjectById(projectId);
  if (!project) {
    console.error(`[SecretaryDispatch] Project ${projectId} not found for auto-start`);
    return;
  }

  const cliPreference = project.preferredCli || 'claude';
  const selectedModel = normalizeModelId(cliPreference, project.selectedModel || getDefaultModelForCli(cliPreference));
  const requestId = generateId();

  // Determine project working path
  const workDirectory = (project as any).work_directory;
  const projectPath = (mode === 'work' || mode === 'boss') && workDirectory
    ? workDirectory
    : (project.repoPath || path.join(PROJECTS_DIR_ABSOLUTE, projectId));

  // Create user message in DB
  const userMessage = await createMessage({
    projectId,
    role: 'user',
    messageType: 'chat',
    content: instruction,
    cliSource: cliPreference,
    requestId,
  });

  // Create user request record
  await upsertUserRequest({
    id: requestId,
    projectId,
    instruction,
    cliPreference,
  });
  await markUserRequestAsProcessing(requestId);

  // Publish message via WebSocket
  streamManager.publish(projectId, {
    type: 'message',
    data: serializeMessage(userMessage, { requestId }),
  });

  await updateProjectActivity(projectId);

  // Dynamically import the appropriate CLI executor
  // work/boss mode uses applyChanges (not initializeProject)
  // Wrapped in try-catch so that if executor setup fails, the UserRequest
  // is marked as failed instead of being stuck in 'processing' forever.
  try {
    const { applyChanges: applyClaudeChanges } = await import('@/lib/services/cli/claude');

    let executor: typeof applyClaudeChanges;

    if (cliPreference === 'codex') {
      const { applyChanges } = await import('@/lib/services/cli/codex');
      executor = applyChanges;
    } else if (cliPreference === 'cursor') {
      const { applyChanges } = await import('@/lib/services/cli/cursor');
      executor = applyChanges;
    } else if (cliPreference === 'qwen') {
      const { applyChanges } = await import('@/lib/services/cli/qwen');
      executor = applyChanges;
    } else if (cliPreference === 'glm') {
      const { applyChanges } = await import('@/lib/services/cli/glm');
      executor = applyChanges;
    } else {
      executor = applyClaudeChanges;
    }

    // Resume existing session if available
    const sessionId = cliPreference === 'claude'
      ? project.activeClaudeSessionId || undefined
      : cliPreference === 'cursor'
      ? (project as any).activeCursorSessionId || undefined
      : undefined;

    console.log(`[SecretaryDispatch] 🚀 Auto-starting task for ${projectId} via ${cliPreference} (${selectedModel}), path=${projectPath}`);
    console.log(`[SecretaryDispatch] 📝 requestId=${requestId}, sessionId=${sessionId || 'none'}`);

    // Fire the executor (async, don't await — it runs in background)
    executor(
      projectId,
      projectPath,
      instruction,
      selectedModel,
      sessionId,
      requestId,
    ).catch(async (error) => {
      console.error(`[SecretaryDispatch] Task execution failed for ${projectId}:`, error);
      // Mark the UserRequest as failed so the boss panel doesn't show it as perpetually active
      try {
        const { markUserRequestAsFailed } = await import('./user-requests');
        await markUserRequestAsFailed(requestId, error instanceof Error ? error.message : 'Task execution failed');
        console.log(`[SecretaryDispatch] Marked request ${requestId} as failed after executor error`);
      } catch (markError) {
        console.error(`[SecretaryDispatch] Failed to mark request ${requestId} as failed:`, markError);
      }
    });
  } catch (setupError) {
    // Executor setup failed (e.g. import error) — mark request as failed
    console.error(`[SecretaryDispatch] Executor setup failed for ${projectId}:`, setupError);
    try {
      const { markUserRequestAsFailed } = await import('./user-requests');
      await markUserRequestAsFailed(requestId, setupError instanceof Error ? setupError.message : 'Executor setup failed');
    } catch (markError) {
      console.error(`[SecretaryDispatch] Failed to mark request ${requestId} as failed:`, markError);
    }
  }
}

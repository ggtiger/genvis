import type { Project as ProjectEntity } from '@/types/backend';
import type { Project } from '@/types';
import path from 'path';
import { PROJECTS_DIR_ABSOLUTE } from '@/lib/config/paths';

export function serializeProject(project: ProjectEntity): Project {
  // absolutePath is always the project directory (repo_path or computed from id)
  const absolutePath = project.repoPath
    ? path.normalize(project.repoPath)
    : path.normalize(path.join(PROJECTS_DIR_ABSOLUTE, project.id));

  // 获取项目类型（work 模式可以是 default）
  const projectType = (project as any).projectType;
  const mode = (project as any).mode || 'code';
  const work_directory = (project as any).work_directory;
  if (!projectType) {
    throw new Error(`项目 ${project.id} 缺失 projectType 字段`);
  }

  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    status: project.status,
    previewUrl: project.previewUrl ?? null,
    previewPort: project.previewPort ?? null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastActiveAt: project.lastActiveAt ?? null,
    initialPrompt: project.initialPrompt ?? null,
    preferredCli: (project.preferredCli ?? null) as Project['preferredCli'],
    selectedModel: project.selectedModel ?? null,
    fallbackEnabled: project.fallbackEnabled,
    planConfirmed: (project as any).planConfirmed ?? false,
    dependenciesInstalled: (project as any).dependenciesInstalled ?? false,
    projectType,
    absolutePath,
    mode, // 添加项目模式
    work_directory: work_directory ?? null, // 添加工作目录
    employee_id: (project as any).employee_id ?? null, // 添加员工 ID
    latestRequestStatus: (project as any).latestRequestStatus ?? null,
    deployedUrl: (project as any).deployedUrl ?? null,
    fromTemplate: (project as any).fromTemplate ?? null,
  };
}

export function serializeProjects(projects: ProjectEntity[]): Project[] {
  return projects.map((project) => serializeProject(project));
}

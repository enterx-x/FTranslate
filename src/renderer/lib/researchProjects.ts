import type { PaperRecord } from './papers';
import { resolveChinesePdfPath } from '../../shared/pdfTranslation';

export const RESEARCH_PROJECTS_KEY = 'pdfTranslationReader:researchProjects';

export type ResearchProjectStatus = 'active' | 'paused' | 'archived';

export interface ResearchProjectDecisionEntry {
  id: string;
  title: string;
  evidenceIds: string[];
  createdAt: string;
}

export interface ResearchProject {
  id: string;
  name: string;
  description: string;
  status: ResearchProjectStatus;
  paperIds: string[];
  codeRepositoryPaths: string[];
  experimentIds: string[];
  runtimeTaskIds: string[];
  decisionLog: ResearchProjectDecisionEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWorkspaceSnapshot {
  activeProject: ResearchProject;
  projectCount: number;
  linkedPaperCount: number;
  evidenceCount: number;
  chinesePdfCount: number;
  projectStatusText: string;
  nextActions: string[];
}

export interface CreateResearchProjectInput {
  name: string;
  description?: string;
  paperIds?: readonly string[];
}

export function buildDefaultResearchProject(
  papers: PaperRecord[],
  now = Date.now()
): ResearchProject {
  const timestamp = new Date(now).toISOString();
  return {
    id: 'local-ai-rd-workspace',
    name: '本地 AI 科创研发项目',
    description: '把当前论文库、研究表格、知识图谱和 AI 助手组织为一个可追踪的研发闭环。',
    status: 'active',
    paperIds: papers.map((paper) => paper.id),
    codeRepositoryPaths: [],
    experimentIds: [],
    runtimeTaskIds: [],
    decisionLog: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function ensureResearchProjects(
  projects: ResearchProject[],
  papers: PaperRecord[],
  now = Date.now()
): ResearchProject[] {
  if (projects.length > 0) {
    return projects;
  }

  return [buildDefaultResearchProject(papers, now)];
}

export function createResearchProject(
  projects: readonly ResearchProject[],
  input: CreateResearchProjectInput,
  now = Date.now()
): ResearchProject | null {
  const name = input.name.trim();
  if (!name) {
    return null;
  }

  const timestamp = new Date(now).toISOString();
  const baseId = `research-project-${now.toString(36)}`;
  const existingIds = new Set(projects.map((project) => project.id));
  let id = baseId;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return {
    id,
    name,
    description: input.description?.trim() ?? '',
    status: 'active',
    paperIds: mergeUniqueValues([...(input.paperIds ?? [])]),
    codeRepositoryPaths: [],
    experimentIds: [],
    runtimeTaskIds: [],
    decisionLog: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function updateProjectPaperMembership(
  projects: ResearchProject[],
  projectId: string,
  paperIds: readonly string[],
  mode: 'add' | 'remove',
  now = new Date().toISOString()
): ResearchProject[] {
  const selectedPaperIds = new Set(
    paperIds.map((paperId) => paperId.trim()).filter(Boolean)
  );

  if (!projectId.trim() || selectedPaperIds.size === 0) {
    return projects;
  }

  return projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    const nextPaperIds =
      mode === 'add'
        ? mergeUniqueValues([...project.paperIds, ...selectedPaperIds])
        : project.paperIds.filter((paperId) => !selectedPaperIds.has(paperId));
    const unchanged =
      nextPaperIds.length === project.paperIds.length &&
      nextPaperIds.every((paperId, index) => paperId === project.paperIds[index]);

    return unchanged
      ? project
      : {
          ...project,
          paperIds: nextPaperIds,
          updatedAt: now
        };
  });
}

export function buildProjectWorkspaceSnapshot(
  projects: ResearchProject[],
  papers: PaperRecord[]
): ProjectWorkspaceSnapshot {
  const ensuredProjects = ensureResearchProjects(projects, papers);
  const activeProject = ensuredProjects.find((project) => project.status === 'active') ?? ensuredProjects[0];
  const linkedPaperIds = new Set(activeProject.paperIds);
  const linkedPapers = papers.filter((paper) => linkedPaperIds.has(paper.id));
  const evidenceCount = linkedPapers.reduce(
    (count, paper) =>
      count +
      (paper.notes.trim() ? 1 : 0) +
      (resolveChinesePdfPath(paper) ? 1 : 0) +
      (paper.aiCachePath ? 1 : 0),
    0
  );
  const chinesePdfCount = linkedPapers.filter((paper) => resolveChinesePdfPath(paper)).length;

  return {
    activeProject,
    projectCount: ensuredProjects.length,
    linkedPaperCount: linkedPapers.length,
    evidenceCount,
    chinesePdfCount,
    projectStatusText: toProjectStatusText(activeProject.status),
    nextActions: buildNextActions({
      linkedPaperCount: linkedPapers.length,
      evidenceCount,
      hasCodeRepository: activeProject.codeRepositoryPaths.length > 0,
      hasExperiments: activeProject.experimentIds.length > 0
    })
  };
}

export function parseResearchProjects(value: string | null): ResearchProject[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeResearchProject)
      .filter((project): project is ResearchProject => Boolean(project));
  } catch {
    return [];
  }
}

export function serializeResearchProjects(projects: ResearchProject[]): string {
  return JSON.stringify(projects);
}

export function linkCodeRepositoryPath(
  project: ResearchProject,
  rootPath: string,
  now = new Date().toISOString()
): ResearchProject {
  const normalizedPath = rootPath.trim();
  if (!normalizedPath || project.codeRepositoryPaths.includes(normalizedPath)) {
    return project;
  }

  return {
    ...project,
    codeRepositoryPaths: [...project.codeRepositoryPaths, normalizedPath],
    updatedAt: now
  };
}

function normalizeResearchProject(value: unknown): ResearchProject | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNonEmptyString(value.id);
  const name = readNonEmptyString(value.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    description: typeof value.description === 'string' ? value.description : '',
    status: normalizeProjectStatus(value.status),
    paperIds: readStringArray(value.paperIds),
    codeRepositoryPaths: readStringArray(value.codeRepositoryPaths),
    experimentIds: readStringArray(value.experimentIds),
    runtimeTaskIds: readStringArray(value.runtimeTaskIds),
    decisionLog: readDecisionLog(value.decisionLog),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : ''
  };
}

function buildNextActions(input: {
  linkedPaperCount: number;
  evidenceCount: number;
  hasCodeRepository: boolean;
  hasExperiments: boolean;
}): string[] {
  if (input.linkedPaperCount === 0) {
    return ['导入第一篇论文', '搜索 arXiv 候选论文', '配置本地 AI Runtime'];
  }

  if (input.evidenceCount === 0) {
    return ['生成 Paper-to-Method 方法卡', '提取图表和文本证据', '把关键论文绑定到实验矩阵'];
  }

  const actions = ['生成 Paper-to-Method 方法卡', '把关键论文绑定到实验矩阵'];
  if (!input.hasCodeRepository) {
    actions.push('检查本地 AI Runtime 状态');
    return actions;
  }
  if (!input.hasExperiments) {
    actions.push('创建 baseline / ablation 实验矩阵');
    return actions;
  }
  actions.push('审查证据链和下一步实验');
  return actions;
}

function toProjectStatusText(status: ResearchProjectStatus): string {
  if (status === 'paused') {
    return 'Paused';
  }
  if (status === 'archived') {
    return 'Archived';
  }
  return 'Active';
}

function readDecisionLog(value: unknown): ResearchProjectDecisionEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): ResearchProjectDecisionEntry | null => {
      if (!isRecord(entry)) {
        return null;
      }
      const id = readNonEmptyString(entry.id);
      const title = readNonEmptyString(entry.title);
      if (!id || !title) {
        return null;
      }
      return {
        id,
        title,
        evidenceIds: readStringArray(entry.evidenceIds),
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : ''
      };
    })
    .filter((entry): entry is ResearchProjectDecisionEntry => Boolean(entry));
}

function normalizeProjectStatus(value: unknown): ResearchProjectStatus {
  if (value === 'paused' || value === 'archived') {
    return value;
  }
  return 'active';
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return mergeUniqueValues(
    value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  );
}

function mergeUniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

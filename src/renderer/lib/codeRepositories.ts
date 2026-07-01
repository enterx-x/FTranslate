export const CODE_REPOSITORIES_KEY = 'pdfTranslationReader:codeRepositories';

export interface CodeRepositoryRecord {
  id: string;
  projectId: string;
  rootPath: string;
  scannedAt: string;
  techStack: string[];
  manifests: Array<{ filePath: string; fileName: string; kind: string; dependencies: string[] }>;
  entryPoints: Array<{ filePath: string; kind: string; commandCandidate: string; reason: string }>;
  configFiles: Array<{ filePath: string; role: string; excerpt: string }>;
  risks: string[];
}

export function serializeCodeRepositories(records: CodeRepositoryRecord[]): string {
  return JSON.stringify(records, null, 2);
}

export function parseCodeRepositories(value: string | null): CodeRepositoryRecord[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map(normalizeCodeRepository).filter((record): record is CodeRepositoryRecord => Boolean(record))
      : [];
  } catch {
    return [];
  }
}

export function buildCodeRepositoryRecord(input: {
  projectId: string;
  scan: {
    id: string;
    rootPath: string;
    scannedAt: string;
    manifests: CodeRepositoryRecord['manifests'];
    entryPoints: CodeRepositoryRecord['entryPoints'];
    configFiles: CodeRepositoryRecord['configFiles'];
    risks: string[];
  };
}): CodeRepositoryRecord {
  return {
    id: input.scan.id,
    projectId: input.projectId,
    rootPath: input.scan.rootPath,
    scannedAt: input.scan.scannedAt,
    techStack: inferTechStack(input.scan.manifests, input.scan.entryPoints),
    manifests: input.scan.manifests,
    entryPoints: input.scan.entryPoints,
    configFiles: input.scan.configFiles,
    risks: input.scan.risks
  };
}

function normalizeCodeRepository(value: unknown): CodeRepositoryRecord | null {
  if (!isRecord(value)) return null;
  const id = readNonEmptyString(value.id);
  const projectId = readNonEmptyString(value.projectId);
  const rootPath = readNonEmptyString(value.rootPath);
  const scannedAt = readNonEmptyString(value.scannedAt);
  if (!id || !projectId || !rootPath || !scannedAt) return null;
  return {
    id,
    projectId,
    rootPath,
    scannedAt,
    techStack: readStringArray(value.techStack),
    manifests: readObjectArray(value.manifests).map(normalizeManifest),
    entryPoints: readObjectArray(value.entryPoints).map(normalizeEntryPoint),
    configFiles: readObjectArray(value.configFiles).map(normalizeConfigFile),
    risks: readStringArray(value.risks)
  };
}

function normalizeManifest(value: Record<string, unknown>): CodeRepositoryRecord['manifests'][number] {
  return {
    filePath: readNonEmptyString(value.filePath),
    fileName: readNonEmptyString(value.fileName),
    kind: readNonEmptyString(value.kind),
    dependencies: readStringArray(value.dependencies)
  };
}

function normalizeEntryPoint(value: Record<string, unknown>): CodeRepositoryRecord['entryPoints'][number] {
  return {
    filePath: readNonEmptyString(value.filePath),
    kind: readNonEmptyString(value.kind),
    commandCandidate: readNonEmptyString(value.commandCandidate),
    reason: readNonEmptyString(value.reason)
  };
}

function normalizeConfigFile(value: Record<string, unknown>): CodeRepositoryRecord['configFiles'][number] {
  return {
    filePath: readNonEmptyString(value.filePath),
    role: readNonEmptyString(value.role),
    excerpt: typeof value.excerpt === 'string' ? value.excerpt : ''
  };
}

function inferTechStack(
  manifests: CodeRepositoryRecord['manifests'],
  entryPoints: CodeRepositoryRecord['entryPoints']
): string[] {
  const stack = new Set<string>();
  for (const manifest of manifests) {
    if (['requirements', 'environment', 'pyproject', 'setup-py'].includes(manifest.kind)) stack.add('python');
    if (manifest.kind === 'package-json') stack.add('node');
    for (const dependency of manifest.dependencies) {
      const normalized = dependency.toLowerCase();
      if (normalized.includes('torch') || normalized.includes('pytorch')) stack.add('pytorch');
      if (normalized.includes('tensorflow')) stack.add('tensorflow');
      if (normalized.includes('jax')) stack.add('jax');
      if (normalized.includes('gym')) stack.add('gymnasium');
      if (normalized.includes('mujoco')) stack.add('mujoco');
    }
  }
  for (const entry of entryPoints) {
    if (entry.filePath.endsWith('.py')) stack.add('python');
    if (/\.(ts|js)$/u.test(entry.filePath)) stack.add('node');
  }
  return [...stack];
}

function readObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    )
  ];
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

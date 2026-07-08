import type { CodeRepositoryRecord } from './codeRepositories';

export interface ReproductionLogDiagnosis {
  id: string;
  repositoryId: string;
  createdAt: string;
  status: 'clean' | 'blocked' | 'needs-review';
  issues: ReproductionLogIssue[];
}

export interface ReproductionLogIssue {
  id: string;
  kind: 'missing-dependency' | 'missing-file' | 'cuda-unavailable' | 'cuda-oom' | 'runtime-exception';
  severity: 'blocked' | 'warning';
  title: string;
  summary: string;
  evidenceLines: Array<{ lineNumber: number; text: string }>;
  relatedFiles: string[];
  relatedManifests: string[];
  nextActions: string[];
  commandCandidates: string[];
}

export function diagnoseReproductionLog(input: {
  repository: CodeRepositoryRecord;
  logText: string;
  now: string;
}): ReproductionLogDiagnosis {
  const lines = splitLogLines(input.logText);
  const issues = [
    ...diagnoseMissingDependencies(input.repository, lines),
    ...diagnoseMissingFiles(input.repository, lines)
  ];

  return {
    id: `${input.repository.id}:diagnosis:${hashString(`${input.now}|${input.logText}`)}`,
    repositoryId: input.repository.id,
    createdAt: input.now,
    status: issues.length > 0 ? 'blocked' : 'clean',
    issues
  };
}

function diagnoseMissingDependencies(
  repository: CodeRepositoryRecord,
  lines: Array<{ lineNumber: number; text: string }>
): ReproductionLogIssue[] {
  return lines.flatMap((line) => {
    const moduleName = readMissingModuleName(line.text);
    if (!moduleName) return [];

    const relatedFiles = readTracebackFiles(repository, lines);
    const matchingManifests = repository.manifests.filter((manifest) =>
      manifest.dependencies.some((dependency) => dependencyMatchesModule(dependency, moduleName))
    );
    const pythonManifests = repository.manifests.filter((manifest) =>
      ['requirements', 'environment', 'pyproject', 'setup-py'].includes(manifest.kind)
    );
    const relatedManifests = matchingManifests.length > 0 ? matchingManifests : pythonManifests;
    const declared = matchingManifests.length > 0;
    const installCommand = buildInstallCommand(relatedManifests[0]?.filePath);

    return [
      {
        id: `missing-dependency:${normalizeToken(moduleName)}`,
        kind: 'missing-dependency',
        severity: 'blocked',
        title: `缺少 Python 依赖：${moduleName}`,
        summary: declared
          ? `${moduleName} 已在依赖清单中声明，优先检查当前解释器/虚拟环境是否安装了对应依赖。`
          : `${moduleName} 未在已扫描依赖清单中出现，优先确认论文代码是否遗漏安装说明或依赖清单未同步。`,
        evidenceLines: [line],
        relatedFiles,
        relatedManifests: relatedManifests.map((manifest) => manifest.filePath),
        nextActions: declared
          ? [
              '确认当前终端使用的是项目隔离环境，而不是系统 Python。',
              '重新安装依赖清单后再运行 smoke test。',
              '如果仍失败，检查 README 中是否要求额外安装环境、数据集或 simulator。'
            ]
          : [
              `确认 ${moduleName} 是否应加入 requirements / environment / pyproject。`,
              '检查 README、论文附录或原仓库 issue，确认该依赖的正确包名和版本。',
              '补齐依赖清单前不要直接修改训练代码绕过 import。'
            ],
        commandCandidates: installCommand ? [installCommand] : []
      }
    ];
  });
}

function diagnoseMissingFiles(
  repository: CodeRepositoryRecord,
  lines: Array<{ lineNumber: number; text: string }>
): ReproductionLogIssue[] {
  return lines.flatMap((line) => {
    const missingPath = readMissingFilePath(line.text);
    if (!missingPath) return [];

    const relatedFiles = uniqueStrings([
      ...readTracebackFiles(repository, lines),
      ...readRelatedConfigFiles(repository, missingPath)
    ]);

    return [
      {
        id: `missing-file:${hashString(missingPath)}`,
        kind: 'missing-file',
        severity: 'blocked',
        title: `缺少文件：${missingPath}`,
        summary: `日志显示运行时找不到 ${missingPath}，优先检查路径、配置文件和数据集/环境文件是否已放到仓库约定位置。`,
        evidenceLines: [line],
        relatedFiles,
        relatedManifests: [],
        nextActions: [
          '确认命令中的相对路径是否以代码仓库根目录为基准。',
          '检查 README 或 config 文件中是否定义了数据集、checkpoint 或环境资源路径。',
          '不要用空文件占位绕过错误；先确认该文件应由下载、预处理还是训练过程生成。'
        ],
        commandCandidates: []
      }
    ];
  });
}

function readMissingModuleName(line: string): string {
  const match =
    line.match(/ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/u) ??
    line.match(/ImportError:\s+No module named ['"]([^'"]+)['"]/u);
  return match?.[1]?.trim() ?? '';
}

function readMissingFilePath(line: string): string {
  const match =
    line.match(/FileNotFoundError:\s+\[Errno 2\][^'"]+['"]([^'"]+)['"]/u) ??
    line.match(/No such file or directory:\s*['"]([^'"]+)['"]/u);
  return match?.[1]?.trim() ?? '';
}

function readTracebackFiles(
  repository: CodeRepositoryRecord,
  lines: Array<{ lineNumber: number; text: string }>
): string[] {
  const scannedPaths = [
    ...repository.entryPoints.map((entry) => entry.filePath),
    ...repository.configFiles.map((file) => file.filePath)
  ];
  const tracebackPaths = lines
    .map((line) => line.text.match(/File\s+["']([^"']+)["']/u)?.[1] ?? '')
    .filter(Boolean)
    .map((filePath) => normalizeRepositoryPath(repository, filePath, scannedPaths))
    .filter(Boolean);
  return uniqueStrings(tracebackPaths);
}

function readRelatedConfigFiles(repository: CodeRepositoryRecord, missingPath: string): string[] {
  const normalizedMissingPath = missingPath.replace(/\\/gu, '/').toLowerCase();
  if (!/\.(yaml|yml|json|toml|ini|cfg)$/u.test(normalizedMissingPath)) {
    return [];
  }
  return repository.configFiles.map((file) => file.filePath);
}

function normalizeRepositoryPath(repository: CodeRepositoryRecord, filePath: string, candidates: string[]): string {
  const normalizedPath = filePath.replace(/\\/gu, '/');
  const normalizedRoot = repository.rootPath.replace(/\\/gu, '/').replace(/\/$/u, '');
  const relativeToRoot = normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
  const byExactPath = candidates.find((candidate) => candidate.replace(/\\/gu, '/') === relativeToRoot);
  if (byExactPath) return byExactPath;

  const fileName = relativeToRoot.split('/').pop() ?? relativeToRoot;
  return candidates.find((candidate) => candidate.replace(/\\/gu, '/').endsWith(`/${fileName}`) || candidate === fileName) ?? relativeToRoot;
}

function buildInstallCommand(manifestPath: string | undefined): string {
  if (!manifestPath) return '';
  const normalizedPath = manifestPath.replace(/\\/gu, '/');
  if (normalizedPath.endsWith('requirements.txt')) {
    return `python -m pip install -r ${normalizedPath}`;
  }
  if (normalizedPath.endsWith('environment.yml') || normalizedPath.endsWith('environment.yaml')) {
    return `conda env update -f ${normalizedPath}`;
  }
  if (normalizedPath.endsWith('pyproject.toml')) {
    return 'python -m pip install -e .';
  }
  return '';
}

function dependencyMatchesModule(dependency: string, moduleName: string): boolean {
  const normalizedDependency = normalizeDependencyName(dependency);
  const normalizedModule = normalizeToken(moduleName);
  return normalizedDependency === normalizedModule || normalizedDependency.startsWith(`${normalizedModule}[`);
}

function normalizeDependencyName(dependency: string): string {
  return normalizeToken(dependency.split(/[<>=~!; ]/u)[0] ?? '');
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/_/gu, '-');
}

function splitLogLines(logText: string): Array<{ lineNumber: number; text: string }> {
  return logText.replace(/\r\n/gu, '\n').split('\n').map((text, index) => ({
    lineNumber: index + 1,
    text
  }));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

import fs from 'node:fs/promises';
import path from 'node:path';

export interface CodeRepositoryScanRequest {
  rootPath: string;
  now: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
}

export interface CodeRepositoryFileSummary {
  filePath: string;
  fileName: string;
  extension: string;
  bytes: number;
  role: 'readme' | 'manifest' | 'entry' | 'config' | 'script' | 'source' | 'other';
  excerpt: string;
}

export interface CodeRepositoryManifest {
  filePath: string;
  fileName: string;
  kind: 'requirements' | 'environment' | 'pyproject' | 'package-json' | 'setup-py' | 'dockerfile' | 'makefile';
  dependencies: string[];
}

export interface CodeRepositoryEntryPoint {
  filePath: string;
  kind: 'train' | 'eval' | 'test' | 'main' | 'script' | 'notebook';
  commandCandidate: string;
  reason: string;
}

export interface CodeRepositoryScanResult {
  id: string;
  rootPath: string;
  scannedAt: string;
  files: CodeRepositoryFileSummary[];
  manifests: CodeRepositoryManifest[];
  entryPoints: CodeRepositoryEntryPoint[];
  configFiles: CodeRepositoryFileSummary[];
  risks: string[];
}

const DEFAULT_MAX_FILES = 300;
const DEFAULT_MAX_BYTES_PER_FILE = 120 * 1024;
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'dist-renderer',
  'build',
  '.venv',
  'venv',
  '__pycache__',
  'checkpoints',
  'checkpoint',
  'datasets',
  'dataset',
  'data',
  'models',
  'logs',
  'runs',
  'wandb'
]);
const TEXT_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.sh',
  '.ps1',
  '.ipynb'
]);
const MANIFEST_NAMES = new Set([
  'requirements.txt',
  'environment.yml',
  'environment.yaml',
  'pyproject.toml',
  'setup.py',
  'package.json',
  'dockerfile',
  'makefile'
]);

export async function scanCodeRepository(request: CodeRepositoryScanRequest): Promise<CodeRepositoryScanResult> {
  const rootPath = path.resolve(request.rootPath);
  const rootStats = await fs.stat(rootPath).catch((error: unknown) => {
    throw new Error(`Code repository root is not a directory: ${formatError(error)}`);
  });

  if (!rootStats.isDirectory()) {
    throw new Error(`Code repository root is not a directory: ${rootPath}`);
  }

  const files: CodeRepositoryFileSummary[] = [];
  const risks: string[] = [];
  await walkRepository(rootPath, rootPath, {
    files,
    risks,
    maxFiles: Math.max(1, request.maxFiles ?? DEFAULT_MAX_FILES),
    maxBytesPerFile: Math.max(1024, request.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE)
  });

  return {
    id: `code-repo-${hashString(`${rootPath}|${request.now}`)}`,
    rootPath,
    scannedAt: request.now,
    files,
    manifests: files
      .filter((file) => file.role === 'manifest')
      .map(toManifest)
      .filter((manifest): manifest is CodeRepositoryManifest => Boolean(manifest)),
    entryPoints: files
      .map(toEntryPoint)
      .filter((entryPoint): entryPoint is CodeRepositoryEntryPoint => Boolean(entryPoint)),
    configFiles: files.filter((file) => file.role === 'config'),
    risks
  };
}

async function walkRepository(
  rootPath: string,
  currentDir: string,
  context: {
    files: CodeRepositoryFileSummary[];
    risks: string[];
    maxFiles: number;
    maxBytesPerFile: number;
  }
): Promise<void> {
  if (context.files.length >= context.maxFiles) {
    return;
  }

  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childPath = path.resolve(currentDir, entry.name);
    assertInsideRoot(rootPath, childPath);

    if (entry.isSymbolicLink()) {
      context.risks.push(`Skipped symbolic link: ${toRelativePath(rootPath, childPath)}`);
      continue;
    }

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name.toLowerCase())) {
        await walkRepository(rootPath, childPath, context);
      }
      continue;
    }

    if (!entry.isFile() || !isTextLikeFile(entry.name)) {
      continue;
    }

    if (context.files.length >= context.maxFiles) {
      context.risks.push(`Stopped after ${context.maxFiles} text files; repository scan is partial.`);
      return;
    }

    const stats = await fs.stat(childPath);
    const relativePath = toRelativePath(rootPath, childPath);
    const excerpt =
      stats.size <= context.maxBytesPerFile ? normalizeExcerpt(await fs.readFile(childPath, 'utf8')) : '';

    if (stats.size > context.maxBytesPerFile) {
      context.risks.push(`Skipped large text file excerpt: ${relativePath} (${stats.size} bytes).`);
    }

    context.files.push({
      filePath: relativePath,
      fileName: entry.name,
      extension: path.extname(entry.name).toLowerCase(),
      bytes: stats.size,
      role: classifyFile(relativePath, entry.name),
      excerpt
    });
  }
}

function assertInsideRoot(rootPath: string, childPath: string): void {
  const relative = path.relative(rootPath, childPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to scan outside repository root: ${childPath}`);
  }
}

function isTextLikeFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return TEXT_EXTENSIONS.has(path.extname(lowerName)) || MANIFEST_NAMES.has(lowerName);
}

function classifyFile(relativePath: string, fileName: string): CodeRepositoryFileSummary['role'] {
  const normalizedPath = relativePath.replace(/\\/gu, '/').toLowerCase();
  const lowerName = fileName.toLowerCase();

  if (lowerName.startsWith('readme')) return 'readme';
  if (MANIFEST_NAMES.has(lowerName)) return 'manifest';
  if (isEntryFile(normalizedPath, lowerName)) return 'entry';
  if (normalizedPath.startsWith('configs/') || normalizedPath.includes('/configs/') || isConfigFile(lowerName)) {
    return 'config';
  }
  if (lowerName.endsWith('.sh') || lowerName.endsWith('.ps1')) return 'script';
  if (/\.(py|ts|tsx|js|jsx)$/u.test(lowerName)) return 'source';
  return 'other';
}

function isEntryFile(normalizedPath: string, lowerName: string): boolean {
  if (/^(train|main|eval|evaluate|test|run)(?:[_.-].*)?\.(py|js|ts|sh|ps1)$/u.test(lowerName)) {
    return true;
  }
  if (normalizedPath.startsWith('scripts/') && /(?:train|eval|test|run|main)/u.test(lowerName)) {
    return true;
  }
  return lowerName.endsWith('.ipynb') && /(?:train|eval|test|demo|run)/u.test(lowerName);
}

function isConfigFile(lowerName: string): boolean {
  return /\.(yaml|yml|toml|ini|cfg|json)$/u.test(lowerName) && lowerName !== 'package.json';
}

function toManifest(file: CodeRepositoryFileSummary): CodeRepositoryManifest | null {
  const kind = readManifestKind(file.fileName.toLowerCase());
  return kind
    ? {
        filePath: file.filePath,
        fileName: file.fileName,
        kind,
        dependencies: extractDependencies(kind, file.excerpt)
      }
    : null;
}

function readManifestKind(fileName: string): CodeRepositoryManifest['kind'] | null {
  if (fileName === 'requirements.txt') return 'requirements';
  if (fileName === 'environment.yml' || fileName === 'environment.yaml') return 'environment';
  if (fileName === 'pyproject.toml') return 'pyproject';
  if (fileName === 'package.json') return 'package-json';
  if (fileName === 'setup.py') return 'setup-py';
  if (fileName === 'dockerfile') return 'dockerfile';
  if (fileName === 'makefile') return 'makefile';
  return null;
}

function extractDependencies(kind: CodeRepositoryManifest['kind'], excerpt: string): string[] {
  if (!excerpt) {
    return [];
  }
  if (kind === 'requirements') {
    return excerpt
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .slice(0, 50);
  }
  if (kind === 'package-json') {
    return Array.from(excerpt.matchAll(/"([^"]+)":\s*"[^"]+"/gu))
      .map((match) => match[1])
      .filter((name) => !['name', 'version', 'description', 'main', 'private'].includes(name))
      .slice(0, 80);
  }
  return excerpt
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-A-Za-z0-9_@./]+(?:[=<>~: ].*)?$/u.test(line))
    .slice(0, 50);
}

function toEntryPoint(file: CodeRepositoryFileSummary): CodeRepositoryEntryPoint | null {
  if (file.role !== 'entry') {
    return null;
  }
  const kind = readEntryKind(file.filePath.replace(/\\/gu, '/').toLowerCase());
  return {
    filePath: file.filePath,
    kind,
    commandCandidate: buildCommandCandidate(file.filePath, kind),
    reason: `${file.fileName} matches a ${kind} entry-point naming pattern.`
  };
}

function readEntryKind(filePath: string): CodeRepositoryEntryPoint['kind'] {
  const fileName = filePath.split('/').pop() ?? filePath;
  if (/train/u.test(fileName)) return 'train';
  if (/eval|evaluate/u.test(fileName)) return 'eval';
  if (/test/u.test(fileName)) return 'test';
  if (/main/u.test(fileName)) return 'main';
  if (/\.ipynb$/u.test(fileName)) return 'notebook';
  return 'script';
}

function buildCommandCandidate(filePath: string, kind: CodeRepositoryEntryPoint['kind']): string {
  const normalizedPath = filePath.replace(/\\/gu, '/');
  if (kind === 'notebook') return `jupyter notebook ${normalizedPath}`;
  if (normalizedPath.endsWith('.py')) return `python ${normalizedPath}`;
  if (normalizedPath.endsWith('.js')) return `node ${normalizedPath}`;
  if (normalizedPath.endsWith('.ts')) return `npx tsx ${normalizedPath}`;
  return normalizedPath;
}

function toRelativePath(rootPath: string, childPath: string): string {
  return path.relative(rootPath, childPath).replace(/\\/gu, '/');
}

function normalizeExcerpt(content: string): string {
  return content.replace(/\r\n/gu, '\n').slice(0, DEFAULT_MAX_BYTES_PER_FILE);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

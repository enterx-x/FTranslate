import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  SCIENTIFIC_PLOT_SCHEMA_VERSION,
  assertPlotDataTable,
  normalizeScientificPlotSpec,
  type PlotDataTable,
  type ScientificPlotSpec
} from '../shared/scientificPlot';

export interface ScientificPlotProjectManifest {
  schemaVersion: '1.0';
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  rendererLanguage: ScientificPlotSpec['renderer']['language'];
  dataSnapshotHash?: string;
  links: ScientificPlotSpec['links'];
}

export interface ScientificPlotProjectLoadResult {
  manifest: ScientificPlotProjectManifest;
  spec: ScientificPlotSpec;
  data?: PlotDataTable;
}

export interface ScientificPlotStoreOptions {
  now?: () => string;
  randomId?: () => string;
}

export interface ExportFplotOptions {
  includeRawData?: boolean;
  includeDerivedData?: boolean;
}

export interface FplotInspection {
  schemaVersion: string;
  projectId: string;
  title: string;
  files: string[];
  includesRawData: boolean;
  includesDerivedData: boolean;
  totalUncompressedBytes: number;
}

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const MAX_PACKAGE_FILES = 2_000;
const MAX_PACKAGE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const ALLOWED_ARTIFACT_ROOTS = ['analysis', 'scripts', 'renders', 'logs', 'themes', 'data/derived'];

export class ScientificPlotStore {
  readonly rootPath: string;
  private readonly now: () => string;
  private readonly randomId: () => string;

  constructor(rootPath: string, options: ScientificPlotStoreOptions = {}) {
    this.rootPath = path.resolve(rootPath);
    this.now = options.now ?? (() => new Date().toISOString());
    this.randomId = options.randomId ?? (() => `plot-${randomUUID()}`);
  }

  async createProject(specValue: ScientificPlotSpec, rawData?: PlotDataTable): Promise<ScientificPlotProjectManifest> {
    const spec = normalizeScientificPlotSpec(specValue);
    const projectPath = this.projectPath(spec.id);
    if (await exists(projectPath)) throw new Error(`Plot project already exists: ${spec.id}`);
    await this.ensureProjectDirectories(spec.id);
    if (rawData) {
      assertPlotDataTable(rawData);
      const snapshot = cloneData(rawData);
      const hash = sha256(JSON.stringify(snapshot));
      snapshot.contentHash = hash;
      spec.snapshotId = snapshot.id;
      spec.dataSource = { ...snapshot.source };
      spec.provenance.dataSnapshotHash = hash;
      await atomicWriteJson(path.join(projectPath, 'data', 'raw', 'data.json'), snapshot);
    }
    await atomicWriteJson(path.join(projectPath, 'plot-spec.json'), spec);
    const manifest = this.buildManifest(spec, spec.provenance.createdAt || this.now());
    await atomicWriteJson(path.join(projectPath, 'manifest.json'), manifest);
    return manifest;
  }

  async saveSpec(specValue: ScientificPlotSpec): Promise<ScientificPlotProjectManifest> {
    const spec = normalizeScientificPlotSpec(specValue);
    const projectPath = this.projectPath(spec.id);
    if (!(await exists(projectPath))) throw new Error(`Plot project does not exist: ${spec.id}`);
    const previous = await this.readManifest(spec.id);
    spec.provenance.createdAt = previous.createdAt;
    spec.provenance.updatedAt = this.now();
    await atomicWriteJson(path.join(projectPath, 'plot-spec.json'), spec);
    const manifest = this.buildManifest(spec, previous.createdAt);
    await atomicWriteJson(path.join(projectPath, 'manifest.json'), manifest);
    return manifest;
  }

  async saveRawSnapshot(projectId: string, table: PlotDataTable): Promise<string> {
    assertPlotDataTable(table);
    const target = path.join(this.projectPath(projectId), 'data', 'raw', 'data.json');
    if (await exists(target)) throw new Error('Raw data snapshot is immutable; create a new snapshot instead.');
    const snapshot = cloneData(table);
    const hash = sha256(JSON.stringify(snapshot));
    snapshot.contentHash = hash;
    await atomicWriteJson(target, snapshot);
    return hash;
  }

  async listProjects(): Promise<ScientificPlotProjectManifest[]> {
    await mkdir(this.rootPath, { recursive: true });
    const entries = await readdir(this.rootPath, { withFileTypes: true });
    const manifests = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try {
        return await this.readManifest(entry.name);
      } catch {
        return null;
      }
    }));
    return manifests
      .filter((item): item is ScientificPlotProjectManifest => Boolean(item))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async loadProject(projectId: string): Promise<ScientificPlotProjectLoadResult> {
    const projectPath = this.projectPath(projectId);
    const spec = normalizeScientificPlotSpec(JSON.parse(await readFile(path.join(projectPath, 'plot-spec.json'), 'utf8')));
    const manifest = await this.readManifest(projectId);
    const rawPath = path.join(projectPath, 'data', 'raw', 'data.json');
    let data: PlotDataTable | undefined;
    if (await exists(rawPath)) {
      const value = JSON.parse(await readFile(rawPath, 'utf8')) as unknown;
      if (!assertPlotDataTable(value)) throw new Error('Stored plot data is invalid.');
      data = cloneData(value);
    }
    return { manifest, spec, data };
  }

  async writeArtifact(projectId: string, relativePath: string, content: string | Uint8Array): Promise<{ filePath: string; sha256: string }> {
    const normalized = normalizeArchivePath(relativePath);
    if (!ALLOWED_ARTIFACT_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
      throw new Error(`Invalid artifact path: ${relativePath}`);
    }
    const target = this.resolveInsideProject(projectId, normalized);
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    await atomicWrite(target, bytes);
    return { filePath: target, sha256: sha256(bytes) };
  }

  getProjectDirectory(projectId: string): string {
    return this.projectPath(projectId);
  }

  resolveProjectFile(projectId: string, relativePath: string): string {
    return this.resolveInsideProject(projectId, relativePath);
  }

  async exportFplot(projectId: string, options: ExportFplotOptions = {}): Promise<Uint8Array> {
    const projectPath = this.projectPath(projectId);
    const files = await listFiles(projectPath);
    const archive: Record<string, Uint8Array> = {};
    for (const filePath of files) {
      const relative = normalizeArchivePath(path.relative(projectPath, filePath));
      if (relative.startsWith('data/raw/') && !options.includeRawData) continue;
      if (relative.startsWith('data/derived/') && !options.includeDerivedData) continue;
      if (relative.startsWith('logs/')) continue;
      archive[relative] = new Uint8Array(await readFile(filePath));
    }
    const manifest = await this.readManifest(projectId);
    archive['fplot-package.json'] = strToU8(JSON.stringify({
      schemaVersion: '1.0',
      projectId,
      title: manifest.title,
      exportedAt: this.now(),
      includesRawData: options.includeRawData === true,
      includesDerivedData: options.includeDerivedData === true,
      files: Object.keys(archive).sort()
    }, null, 2));
    return zipSync(archive, { level: 6 });
  }

  inspectFplot(bytes: Uint8Array): FplotInspection {
    const files = this.readArchive(bytes);
    const packageEntry = files['fplot-package.json'];
    if (!packageEntry) throw new Error('Invalid .fplot package: fplot-package.json is missing.');
    const info = JSON.parse(strFromU8(packageEntry)) as Record<string, unknown>;
    const projectId = requireString(info.projectId, 'package project id');
    validateProjectId(projectId);
    const fileNames = Object.keys(files).filter((name) => name !== 'fplot-package.json').sort();
    return {
      schemaVersion: requireString(info.schemaVersion, 'package schema version'),
      projectId,
      title: requireString(info.title, 'package title'),
      files: fileNames,
      includesRawData: fileNames.some((file) => file.startsWith('data/raw/')),
      includesDerivedData: fileNames.some((file) => file.startsWith('data/derived/')),
      totalUncompressedBytes: Object.values(files).reduce((sum, value) => sum + value.byteLength, 0)
    };
  }

  async importFplot(bytes: Uint8Array): Promise<{ projectId: string; inspection: FplotInspection }> {
    const files = this.readArchive(bytes);
    const inspection = this.inspectFplot(bytes);
    const specEntry = files['plot-spec.json'];
    if (!specEntry) throw new Error('Invalid .fplot package: plot-spec.json is missing.');
    const importedSpec = normalizeScientificPlotSpec(JSON.parse(strFromU8(specEntry)));
    let projectId = inspection.projectId;
    if (await exists(this.projectPath(projectId))) projectId = this.randomId();
    validateProjectId(projectId);
    importedSpec.id = projectId;
    importedSpec.title = inspection.title;
    importedSpec.provenance.createdAt = this.now();
    importedSpec.provenance.updatedAt = this.now();
    await this.ensureProjectDirectories(projectId);
    for (const [relativePath, content] of Object.entries(files)) {
      if (relativePath === 'fplot-package.json' || relativePath === 'plot-spec.json' || relativePath === 'manifest.json') continue;
      const target = this.resolveInsideProject(projectId, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await atomicWrite(target, content);
    }
    await atomicWriteJson(path.join(this.projectPath(projectId), 'plot-spec.json'), importedSpec);
    await atomicWriteJson(path.join(this.projectPath(projectId), 'manifest.json'), this.buildManifest(importedSpec, this.now()));
    return { projectId, inspection: { ...inspection, projectId } };
  }

  private readArchive(bytes: Uint8Array): Record<string, Uint8Array> {
    const archive = unzipSync(bytes);
    const entries = Object.entries(archive);
    if (entries.length > MAX_PACKAGE_FILES) throw new Error(`.fplot package exceeds ${MAX_PACKAGE_FILES} files.`);
    let total = 0;
    const normalized: Record<string, Uint8Array> = {};
    for (const [fileName, content] of entries) {
      const safeName = normalizeArchivePath(fileName);
      total += content.byteLength;
      if (total > MAX_PACKAGE_UNCOMPRESSED_BYTES) throw new Error('The .fplot package is too large after extraction.');
      normalized[safeName] = content;
    }
    return normalized;
  }

  private async readManifest(projectId: string): Promise<ScientificPlotProjectManifest> {
    const value = JSON.parse(await readFile(path.join(this.projectPath(projectId), 'manifest.json'), 'utf8')) as Record<string, unknown>;
    return {
      schemaVersion: '1.0',
      id: requireString(value.id, 'manifest id'),
      title: requireString(value.title, 'manifest title'),
      createdAt: requireString(value.createdAt, 'manifest createdAt'),
      updatedAt: requireString(value.updatedAt, 'manifest updatedAt'),
      rendererLanguage: value.rendererLanguage as ScientificPlotSpec['renderer']['language'],
      dataSnapshotHash: typeof value.dataSnapshotHash === 'string' ? value.dataSnapshotHash : undefined,
      links: Array.isArray(value.links) ? value.links as ScientificPlotSpec['links'] : []
    };
  }

  private buildManifest(spec: ScientificPlotSpec, createdAt: string): ScientificPlotProjectManifest {
    return {
      schemaVersion: '1.0',
      id: spec.id,
      title: spec.title,
      createdAt,
      updatedAt: this.now(),
      rendererLanguage: spec.renderer.language,
      dataSnapshotHash: spec.provenance.dataSnapshotHash,
      links: spec.links.map((link) => ({ ...link }))
    };
  }

  private async ensureProjectDirectories(projectId: string): Promise<void> {
    const projectPath = this.projectPath(projectId);
    await Promise.all([
      'data/raw', 'data/derived', 'analysis', 'scripts', 'renders', 'logs', 'themes'
    ].map((directory) => mkdir(path.join(projectPath, ...directory.split('/')), { recursive: true })));
  }

  private projectPath(projectId: string): string {
    validateProjectId(projectId);
    return resolveInside(this.rootPath, projectId, 'project id');
  }

  private resolveInsideProject(projectId: string, relativePath: string): string {
    return resolveInside(this.projectPath(projectId), normalizeArchivePath(relativePath), 'artifact path');
  }
}

function validateProjectId(projectId: string): void {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error(`Invalid project id: ${projectId}`);
}

function normalizeArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid artifact path: ${value}`);
  }
  return normalized;
}

function resolveInside(root: string, relativePath: string, label: string): string {
  const resolved = path.resolve(root, relativePath);
  const rootWithSeparator = `${path.resolve(root)}${path.sep}`;
  if (resolved !== path.resolve(root) && !resolved.startsWith(rootWithSeparator)) throw new Error(`Invalid ${label}: ${relativePath}`);
  return resolved;
}

async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  await atomicWrite(target, Buffer.from(JSON.stringify(value, null, 2), 'utf8'));
}

async function atomicWrite(target: string, content: Uint8Array): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const token = `${process.pid}-${randomUUID()}`;
  const temporary = `${target}.tmp-${token}`;
  const backup = `${target}.bak-${token}`;
  await writeFile(temporary, content);
  const hadTarget = await exists(target);
  try {
    if (hadTarget) await rename(target, backup);
    await rename(temporary, target);
    if (hadTarget) await rm(backup, { force: true });
  } catch (error) {
    if (hadTarget && await exists(backup) && !(await exists(target))) await rename(backup, target);
    await rm(temporary, { force: true });
    throw error;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) result.push(target);
    }
  }
  await visit(root);
  return result.sort();
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function cloneData(table: PlotDataTable): PlotDataTable {
  return {
    ...table,
    source: { ...table.source },
    columns: table.columns.map((column) => ({ ...column })),
    rows: table.rows.map((row) => [...row])
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

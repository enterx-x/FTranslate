import {
  assertPlotDataTable,
  normalizeScientificPlotSpec,
  type PlotDataTable,
  type ScientificPlotSpec
} from '../../../shared/scientificPlot';
import type { AsyncOrSync, IpcMainLike } from './types';

export interface ScientificPlotIpcHandlerDependencies {
  listProjects: () => AsyncOrSync<unknown>;
  createProject: (spec: ScientificPlotSpec, data?: PlotDataTable) => AsyncOrSync<unknown>;
  loadProject: (projectId: string) => AsyncOrSync<unknown>;
  saveSpec: (spec: ScientificPlotSpec) => AsyncOrSync<unknown>;
  selectDataFile: () => AsyncOrSync<unknown>;
  readDataFile: (request: Record<string, unknown>) => AsyncOrSync<unknown>;
  detectRuntimes: () => AsyncOrSync<unknown>;
  readInstallerIntent: () => AsyncOrSync<unknown>;
  startRuntimeInstall: (language: 'python' | 'r', targetRoot?: string) => AsyncOrSync<unknown>;
  getRuntimeInstallJob: (jobId: string) => AsyncOrSync<unknown>;
  cancelRuntimeInstall: (jobId: string) => AsyncOrSync<unknown>;
  removeManagedRuntime: (language: 'python' | 'r', targetRoot?: string) => AsyncOrSync<unknown>;
  submitRender: (request: { projectId: string; spec: ScientificPlotSpec; data: PlotDataTable; force?: boolean }) => AsyncOrSync<unknown>;
  getRenderJob: (jobId: string) => AsyncOrSync<unknown>;
  cancelRender: (jobId: string) => AsyncOrSync<unknown>;
  exportFplot: (projectId: string, options: { includeRawData: boolean; includeDerivedData: boolean }) => AsyncOrSync<unknown>;
  importFplot: () => AsyncOrSync<unknown>;
  exportArtifact: (filePath: string, defaultFileName: string) => AsyncOrSync<unknown>;
}

export function registerScientificPlotIpcHandlers(
  ipcMain: IpcMainLike,
  deps: ScientificPlotIpcHandlerDependencies
): void {
  ipcMain.handle('scientific-plot:list-projects', async () => deps.listProjects());
  ipcMain.handle('scientific-plot:create-project', async (_event, request) => {
    const record = asRecord(request, 'create project request');
    const spec = normalizeScientificPlotSpec(record.spec);
    const data = optionalData(record.data);
    return deps.createProject(spec, data);
  });
  ipcMain.handle('scientific-plot:load-project', async (_event, request) => {
    const projectId = readProjectId(asRecord(request, 'load project request').projectId);
    return deps.loadProject(projectId);
  });
  ipcMain.handle('scientific-plot:save-spec', async (_event, request) => {
    const spec = normalizeScientificPlotSpec(asRecord(request, 'save spec request').spec);
    return deps.saveSpec(spec);
  });
  ipcMain.handle('scientific-plot:select-data-file', async () => deps.selectDataFile());
  ipcMain.handle('scientific-plot:read-data-file', async (_event, request) => {
    const record = asRecord(request, 'read data file request');
    requireString(record.filePath, 'file path', 32_768);
    return deps.readDataFile(record);
  });
  ipcMain.handle('scientific-plot:detect-runtimes', async () => deps.detectRuntimes());
  ipcMain.handle('scientific-plot:installer-intent', async () => deps.readInstallerIntent());
  ipcMain.handle('scientific-plot:start-runtime-install', async (_event, request) => {
    const record = asRecord(request, 'runtime install request');
    const language = readManagedLanguage(record.language);
    const targetRoot = optionalString(record.targetRoot, 32_768);
    return deps.startRuntimeInstall(language, targetRoot);
  });
  ipcMain.handle('scientific-plot:get-runtime-install-job', async (_event, request) =>
    deps.getRuntimeInstallJob(readJobId(asRecord(request, 'runtime job request').jobId))
  );
  ipcMain.handle('scientific-plot:cancel-runtime-install', async (_event, request) =>
    deps.cancelRuntimeInstall(readJobId(asRecord(request, 'cancel runtime request').jobId))
  );
  ipcMain.handle('scientific-plot:remove-managed-runtime', async (_event, request) => {
    const record = asRecord(request, 'remove runtime request');
    return deps.removeManagedRuntime(readManagedLanguage(record.language), optionalString(record.targetRoot, 32_768));
  });
  ipcMain.handle('scientific-plot:submit-render', async (_event, request) => {
    const record = asRecord(request, 'render request');
    const projectId = readProjectId(record.projectId);
    const spec = normalizeScientificPlotSpec(record.spec);
    const data = requireData(record.data);
    if (spec.id !== projectId) throw new Error('Plot spec id must match project id.');
    return deps.submitRender({ projectId, spec, data, force: record.force === true });
  });
  ipcMain.handle('scientific-plot:get-render-job', async (_event, request) =>
    deps.getRenderJob(readJobId(asRecord(request, 'render job request').jobId))
  );
  ipcMain.handle('scientific-plot:cancel-render', async (_event, request) =>
    deps.cancelRender(readJobId(asRecord(request, 'cancel render request').jobId))
  );
  ipcMain.handle('scientific-plot:export-fplot', async (_event, request) => {
    const record = asRecord(request, 'export fplot request');
    return deps.exportFplot(readProjectId(record.projectId), {
      includeRawData: record.includeRawData === true,
      includeDerivedData: record.includeDerivedData === true
    });
  });
  ipcMain.handle('scientific-plot:import-fplot', async () => deps.importFplot());
  ipcMain.handle('scientific-plot:export-artifact', async (_event, request) => {
    const record = asRecord(request, 'export artifact request');
    return deps.exportArtifact(
      requireString(record.filePath, 'artifact path', 32_768),
      requireString(record.defaultFileName, 'default file name', 240)
    );
  });
}

function requireData(value: unknown): PlotDataTable {
  if (!assertPlotDataTable(value)) throw new Error('Invalid plot data table.');
  return value;
}

function optionalData(value: unknown): PlotDataTable | undefined {
  return value === undefined ? undefined : requireData(value);
}

function readProjectId(value: unknown): string {
  const id = requireString(value, 'project id', 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(id)) throw new Error('Invalid plot project id.');
  return id;
}

function readJobId(value: unknown): string {
  const id = requireString(value, 'job id', 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(id)) throw new Error('Invalid plot job id.');
  return id;
}

function readManagedLanguage(value: unknown): 'python' | 'r' {
  if (value !== 'python' && value !== 'r') throw new Error('Only Python and R can be installed by FTranslate.');
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`Invalid ${label}.`);
  return value.trim();
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= maxLength ? value.trim() : undefined;
}

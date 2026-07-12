import { registerAiIpcHandlers, type AiIpcHandlerDependencies } from './ai';
import { registerArxivIpcHandlers, type ArxivIpcHandlerDependencies } from './arxiv';
import { registerCodeRepositoryIpcHandlers, type CodeRepositoryIpcHandlerDependencies } from './codeRepository';
import { registerFileIpcHandlers, type FileIpcHandlerDependencies } from './file';
import { registerPdfIpcHandlers, type PdfIpcHandlerDependencies } from './pdf';
import { registerProjectIpcHandlers, type ProjectIpcHandlerDependencies } from './project';
import { registerRuntimeIpcHandlers, type RuntimeIpcHandlerDependencies } from './runtime';
import { registerScientificPlotIpcHandlers, type ScientificPlotIpcHandlerDependencies } from './scientificPlot';
import type { IpcMainLike } from './types';

export interface AppIpcHandlerDependencies {
  ai: AiIpcHandlerDependencies;
  pdf: PdfIpcHandlerDependencies;
  arxiv: ArxivIpcHandlerDependencies;
  file: FileIpcHandlerDependencies;
  project: ProjectIpcHandlerDependencies;
  runtime: RuntimeIpcHandlerDependencies;
  codeRepository: CodeRepositoryIpcHandlerDependencies;
  scientificPlot: ScientificPlotIpcHandlerDependencies;
}

export function registerAppIpcHandlers(
  ipcMain: IpcMainLike,
  deps: AppIpcHandlerDependencies
): void {
  registerAiIpcHandlers(ipcMain, deps.ai);
  registerPdfIpcHandlers(ipcMain, deps.pdf);
  registerProjectIpcHandlers(ipcMain, deps.project);
  registerFileIpcHandlers(ipcMain, deps.file);
  registerArxivIpcHandlers(ipcMain, deps.arxiv);
  registerRuntimeIpcHandlers(ipcMain, deps.runtime);
  registerCodeRepositoryIpcHandlers(ipcMain, deps.codeRepository);
  registerScientificPlotIpcHandlers(ipcMain, deps.scientificPlot);
}

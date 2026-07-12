import { describe, expect, it } from 'vitest';
import { registerAppIpcHandlers } from './index';

describe('registerAppIpcHandlers', () => {
  it('registers IPC handlers by feature domain', () => {
    const channels: string[] = [];
    const ipcMain = {
      handle(channel: string) {
        channels.push(channel);
      }
    };
    const noop = () => null;
    const deps = {
      ai: {
        loadAiSettings: noop,
        saveAiSettings: noop,
        translateWithAi: noop,
        completeWithAi: noop,
        fillSheetCellWithAi: noop,
        fillSheetCellsWithAi: noop,
        analyzeLiteratureWithAi: noop,
        testAiConnection: noop,
        getAiBalance: noop,
        getAiModels: noop,
        getLocalTranslationStatus: noop,
        checkLocalTranslationInstall: noop,
        warmUpNllbTranslator: noop,
        translateWithLocalEngine: noop
      },
      pdf: {
        checkPdfTranslationEngine: noop,
        translatePdfWithSidecar: noop,
        handlePdfTranslationError: noop,
        openPdfDialog: noop,
        openTranslationDialog: noop,
        openTranslatedPdfDialog: noop,
        selectDirectoryDialog: noop,
        exportPdf: noop
      },
      arxiv: {
        searchArxiv: noop,
        translateArxivPaper: noop,
        translateArxivPapers: noop,
        downloadArxivPdf: noop
      },
      file: {
        openExternalUrl: noop,
        fileExists: () => false,
        saveText: noop,
        saveTranslationCache: noop,
        exportMarkdown: noop,
        exportPptx: noop,
        exportResearchWorkbookToExcel: noop,
        importResearchWorkbookFromExcel: noop
      },
      project: {
        loadProject: noop
      },
      runtime: {
        getRuntimeCenterSnapshot: noop,
        checkRuntimeCenter: noop
      },
      codeRepository: {
        selectCodeRepository: noop,
        scanCodeRepository: noop
      },
      scientificPlot: {
        listProjects: noop,
        createProject: noop,
        loadProject: noop,
        saveSpec: noop,
        selectDataFile: noop,
        readDataFile: noop,
        detectRuntimes: noop,
        readInstallerIntent: noop,
        startRuntimeInstall: noop,
        getRuntimeInstallJob: noop,
        cancelRuntimeInstall: noop,
        removeManagedRuntime: noop,
        submitRender: noop,
        getRenderJob: noop,
        cancelRender: noop,
        exportFplot: noop,
        importFplot: noop,
        exportArtifact: noop
      }
    };

    registerAppIpcHandlers(ipcMain, deps);

    expect(channels).toEqual([
      'ai-settings:load',
      'ai-settings:save',
      'ai:translate',
      'ai:complete',
      'ai:fill-sheet-cell',
      'ai:fill-sheet-cells',
      'ai:analyze-literature',
      'ai:test-connection',
      'ai:balance',
      'ai:models',
      'local-translation:status',
      'local-translation:install-check',
      'local-translation:warmup',
      'local-translation:translate-batch',
      'pdf-translation:check-engine',
      'pdf-translation:translate',
      'dialog:open-pdf',
      'dialog:open-translation',
      'dialog:open-translated-pdf',
      'dialog:select-directory',
      'file:export-pdf',
      'project:load',
      'shell:open-external-url',
      'file:path-exists',
      'file:save-text',
      'file:save-translation-cache',
      'file:export-markdown',
      'file:export-pptx',
      'research-workbook:export-excel',
      'research-workbook:import-excel',
      'arxiv:search',
      'arxiv:translate-title-abstract',
      'arxiv:translate-title-abstract-batch',
      'arxiv:download-pdf',
      'runtime-center:snapshot',
      'runtime-center:check',
      'code-repository:select',
      'code-repository:scan',
      'scientific-plot:list-projects',
      'scientific-plot:create-project',
      'scientific-plot:load-project',
      'scientific-plot:save-spec',
      'scientific-plot:select-data-file',
      'scientific-plot:read-data-file',
      'scientific-plot:detect-runtimes',
      'scientific-plot:installer-intent',
      'scientific-plot:start-runtime-install',
      'scientific-plot:get-runtime-install-job',
      'scientific-plot:cancel-runtime-install',
      'scientific-plot:remove-managed-runtime',
      'scientific-plot:submit-render',
      'scientific-plot:get-render-job',
      'scientific-plot:cancel-render',
      'scientific-plot:export-fplot',
      'scientific-plot:import-fplot',
      'scientific-plot:export-artifact'
    ]);
  });
});

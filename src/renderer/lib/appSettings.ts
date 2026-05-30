export const APP_SETTINGS_KEY = 'pdfTranslationReader:appSettings';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ReferenceTranslationStrategy = 'keep-original' | 'translate-title' | 'skip';
export type FormulaRenderMode = 'blur-preview' | 'preview-only' | 'source';
export type KnowledgeGraphLabelStrategy = 'core' | 'hover' | 'all';

export interface ExportPathSettings {
  defaultExportPath: string;
  pdfExportPath: string;
  bilingualPdfExportPath: string;
  translationJsonExportPath: string;
  knowledgeGraphImageExportPath: string;
  knowledgeGraphJsonExportPath: string;
  notesExportPath: string;
  researchSheetExportPath: string;
  askBeforeExport: boolean;
  createFolderByPaperTitle: boolean;
  createDateSubfolder: boolean;
}

export interface AppSettings {
  general: {
    themeMode: ThemeMode;
    uiScale: number;
    defaultHome: 'workspace' | 'library' | 'researchSheet' | 'reader';
    language: 'zh-CN' | 'en-US';
    autoSave: boolean;
    autoSaveIntervalSeconds: number;
  };
  pdf: {
    defaultMode: 'source' | 'parallel' | 'translated';
    defaultScale: number;
    pageTurnMode: 'scroll' | 'single-page';
    rememberLastPage: boolean;
    showPageNumber: boolean;
    referenceTranslationStrategy: ReferenceTranslationStrategy;
    pdfMathTranslatePath: string;
  };
  ai: {
    defaultThinkingMode: 'auto' | 'enabled' | 'disabled';
    defaultReasoningEffort: 'auto' | 'low' | 'medium' | 'high';
  };
  researchSheet: {
    defaultSheetName: string;
    defaultFontSize: number;
    defaultRowHeight: number;
    formulaRenderEnabled: boolean;
    formulaRenderMode: FormulaRenderMode;
    showFormulaHelp: boolean;
    enableCellPreview: boolean;
    rememberZoom: boolean;
  };
  notes: {
    defaultNoteType: string;
    autoLinkCurrentPaper: boolean;
    autoLinkPdfPage: boolean;
    markdownPreview: boolean;
    formulaRender: boolean;
    autoSaveIntervalSeconds: number;
  };
  knowledgeGraph: {
    defaultSource: 'merged' | 'workbook' | 'library';
    defaultGraphType: 'all' | 'paper-method' | 'topic' | 'author' | 'timeline';
    defaultMaxNodes: number;
    labelStrategy: KnowledgeGraphLabelStrategy;
    neuronLayout: boolean;
    showAuthorNodes: boolean;
    showYearNodes: boolean;
  };
  exportPaths: ExportPathSettings;
  layout: {
    aiAssistantMainRatio: number;
    graphLeftWidth: number;
    graphRightWidth: number;
    pdfRightPanelWidth: number;
  };
}

export function buildDefaultAppSettings(): AppSettings {
  return {
    general: {
      themeMode: 'system',
      uiScale: 1,
      defaultHome: 'workspace',
      language: 'zh-CN',
      autoSave: true,
      autoSaveIntervalSeconds: 20
    },
    pdf: {
      defaultMode: 'source',
      defaultScale: 1,
      pageTurnMode: 'scroll',
      rememberLastPage: true,
      showPageNumber: true,
      referenceTranslationStrategy: 'keep-original',
      pdfMathTranslatePath: ''
    },
    ai: {
      defaultThinkingMode: 'auto',
      defaultReasoningEffort: 'auto'
    },
    researchSheet: {
      defaultSheetName: '论文研究表',
      defaultFontSize: 12,
      defaultRowHeight: 28,
      formulaRenderEnabled: true,
      formulaRenderMode: 'blur-preview',
      showFormulaHelp: true,
      enableCellPreview: true,
      rememberZoom: true
    },
    notes: {
      defaultNoteType: '核心结论',
      autoLinkCurrentPaper: true,
      autoLinkPdfPage: true,
      markdownPreview: true,
      formulaRender: true,
      autoSaveIntervalSeconds: 10
    },
    knowledgeGraph: {
      defaultSource: 'merged',
      defaultGraphType: 'paper-method',
      defaultMaxNodes: 80,
      labelStrategy: 'core',
      neuronLayout: true,
      showAuthorNodes: false,
      showYearNodes: true
    },
    exportPaths: {
      defaultExportPath: '',
      pdfExportPath: '',
      bilingualPdfExportPath: '',
      translationJsonExportPath: '',
      knowledgeGraphImageExportPath: '',
      knowledgeGraphJsonExportPath: '',
      notesExportPath: '',
      researchSheetExportPath: '',
      askBeforeExport: true,
      createFolderByPaperTitle: true,
      createDateSubfolder: false
    },
    layout: {
      aiAssistantMainRatio: 0.68,
      graphLeftWidth: 260,
      graphRightWidth: 330,
      pdfRightPanelWidth: 360
    }
  };
}

export function parseAppSettings(rawValue: string | null): AppSettings {
  if (!rawValue) {
    return buildDefaultAppSettings();
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return mergeAppSettings(buildDefaultAppSettings(), parsed);
  } catch {
    return buildDefaultAppSettings();
  }
}

export function serializeAppSettings(settings: AppSettings): string {
  return JSON.stringify(settings, null, 2);
}

export function mergeAppSettings(defaults: AppSettings, value: unknown): AppSettings {
  if (!isObjectRecord(value)) {
    return defaults;
  }

  return {
    general: {
      ...defaults.general,
      ...pickObject(value.general)
    },
    pdf: {
      ...defaults.pdf,
      ...pickObject(value.pdf),
      referenceTranslationStrategy: readReferenceStrategy(
        pickObject(value.pdf).referenceTranslationStrategy,
        defaults.pdf.referenceTranslationStrategy
      )
    },
    ai: {
      ...defaults.ai,
      ...pickObject(value.ai)
    },
    researchSheet: {
      ...defaults.researchSheet,
      ...pickObject(value.researchSheet)
    },
    notes: {
      ...defaults.notes,
      ...pickObject(value.notes)
    },
    knowledgeGraph: {
      ...defaults.knowledgeGraph,
      ...pickObject(value.knowledgeGraph)
    },
    exportPaths: {
      ...defaults.exportPaths,
      ...pickObject(value.exportPaths)
    },
    layout: normalizeLayout({
      ...defaults.layout,
      ...pickObject(value.layout)
    })
  };
}

export function updateExportPath(
  settings: AppSettings,
  key: keyof ExportPathSettings,
  value: string | boolean
): AppSettings {
  return {
    ...settings,
    exportPaths: {
      ...settings.exportPaths,
      [key]: value
    }
  };
}

export function describeReferenceStrategy(strategy: ReferenceTranslationStrategy): string {
  if (strategy === 'skip') {
    return '跳过参考文献翻译，保留编号、换行和条目结构。';
  }
  if (strategy === 'translate-title') {
    return '只尝试翻译参考文献标题，作者、编号、期刊、DOI 保持原文。';
  }
  return '默认保持参考文献原文，避免编号、换行和列表结构错乱。';
}

function normalizeLayout(layout: AppSettings['layout']): AppSettings['layout'] {
  return {
    aiAssistantMainRatio: clampNumber(layout.aiAssistantMainRatio, 0.56, 0.78, 0.68),
    graphLeftWidth: clampNumber(layout.graphLeftWidth, 220, 340, 260),
    graphRightWidth: clampNumber(layout.graphRightWidth, 280, 440, 330),
    pdfRightPanelWidth: clampNumber(layout.pdfRightPanelWidth, 300, 520, 360)
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function readReferenceStrategy(
  value: unknown,
  fallback: ReferenceTranslationStrategy
): ReferenceTranslationStrategy {
  return value === 'keep-original' || value === 'translate-title' || value === 'skip'
    ? value
    : fallback;
}

function pickObject(value: unknown): Record<string, unknown> {
  return isObjectRecord(value) ? value : {};
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

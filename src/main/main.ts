import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, safeStorage } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  AI_PROVIDER_PRESETS,
  applyAiTranslationResult,
  buildAiBalanceRequest,
  buildChatCompletionRequest,
  buildGenericChatCompletionRequest,
  buildAiModelsRequest,
  mergeAiModelOptions,
  normalizeAiProviderSettings,
  parseAiModelsResponse,
  parseAiBalanceResponse,
  resolveAiRuntimeOptions,
  shouldTranslateItem,
  AI_PROVIDER_MODEL_OPTIONS,
  type AiProviderId,
  type AiProviderSettings,
  type AiModelOption,
  type AiTranslationItem
} from '../shared/aiTranslation';
import {
  buildKimiFileExtractRequest,
  buildOpenAiResponsesRequest,
  buildOpenAiPdfDataResponseRequest,
  buildOpenAiPdfResponseRequest,
  getPaperContextStrategy,
  type PaperContextStrategyMode
} from '../shared/aiPaperContext';
import {
  buildPdf2zhCommand,
  buildPdfTranslationOutputPaths,
  buildPdfTranslationSourceHash,
  findReusablePdfTranslationRecord,
  formatPdfTranslationProgressMessage,
  normalizePdfTranslationRecordFields,
  patchPdf2zhOpenAiTemperatureSource,
  sanitizePdfTranslationLog,
  type PdfTranslationInvocation,
  type PdfTranslationOutputMode
} from '../shared/pdfTranslation';

interface PdfFilePayload {
  filePath: string;
  fileName: string;
  base64: string;
}

interface TextFilePayload {
  filePath: string;
  fileName: string;
  content: string;
}

interface SaveTextRequest {
  filePath?: string;
  content: string;
  defaultFileName: string;
  extension: 'json' | 'md';
}

interface SaveBinaryRequest {
  filePath?: string;
  contentBase64: string;
  defaultFileName: string;
}

interface ResearchWorkbookExcelRequest {
  workbook: ResearchWorkbookExcelPayload;
}

interface ResearchWorkbookExcelResult {
  filePath: string;
  fileName: string;
}

interface ResearchWorkbookExcelPayload {
  id: string;
  sheetName: string;
  univerSnapshot?: Record<string, unknown>;
  freeze: {
    ySplit: number;
    xSplit: number;
  };
  columns: ResearchWorkbookExcelColumn[];
  rows: ResearchWorkbookExcelRow[];
}

interface ResearchWorkbookExcelColumn {
  key: string;
  label: string;
  width: number;
}

interface ResearchWorkbookExcelRow {
  id: string;
  height?: number;
  cells: ResearchWorkbookExcelCell[];
}

interface ResearchWorkbookExcelCell {
  value: string;
  style?: ResearchWorkbookExcelCellStyle;
}

interface ResearchWorkbookExcelCellStyle {
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  wrapText?: boolean;
  univerStyle?: unknown;
}

interface LoadProjectRequest {
  pdfPath?: string;
  translationPath?: string;
  aiCachePath?: string;
  translatedPdfPath?: string;
  translatedMonoPdfPath?: string;
}

interface AiSettingsRequest extends AiProviderSettings {
  apiKey?: string;
}

interface AiSettingsView extends AiProviderSettings {
  apiKeyConfigured: boolean;
}

interface AiConnectionTestResult {
  ok: boolean;
  message: string;
}

interface AiBalanceView {
  supported: boolean;
  provider: AiProviderId;
  message: string;
  checkedAt?: string;
}

interface AiModelsView {
  supported: boolean;
  provider: AiProviderId;
  options: AiModelOption[];
  message: string;
  checkedAt?: string;
}

interface AiCompleteRequest {
  systemPrompt: string;
  userPrompt: string;
}

interface AiFillSheetCellRequest extends AiCompleteRequest {
  paperId: string;
  pdfPath: string;
  fallbackContextText: string;
}

interface AiFillSheetCellsRequest extends AiCompleteRequest {
  paperId: string;
  pdfPath: string;
  fallbackContextText: string;
  cellCount: number;
}

interface AiAnalyzeLiteraturePaperRequest {
  paperId: string;
  pdfPath: string;
  fallbackContextText: string;
}

interface AiAnalyzeLiteratureRequest extends AiCompleteRequest {
  papers: AiAnalyzeLiteraturePaperRequest[];
}

interface AiFillSheetCellResult {
  text: string;
  provider: AiProviderId;
  model: string;
  mode: PaperContextStrategyMode;
  cached: boolean;
}

interface AiAnalyzeLiteratureResult {
  text: string;
  provider: AiProviderId;
  model: string;
  mode: PaperContextStrategyMode;
  cachedContextCount: number;
  webSearchUsed?: boolean;
}

interface StoredAiSettings extends AiProviderSettings {
  encryptedApiKey?: string;
}

interface PaperContextCacheEntry {
  key: string;
  provider: AiProviderId;
  pdfPath: string;
  fileSize: number;
  mtimeMs: number;
  fileId?: string;
  extractedText?: string;
  cachedAt: string;
}

interface PdfTranslationEngineView {
  available: boolean;
  executable?: string;
  invocation?: PdfTranslationInvocation;
  message: string;
  installCommand: string;
  autoInstall?: boolean;
}

interface PythonCommand {
  command: string;
  argsPrefix: string[];
  label: string;
}

interface PdfTranslationRuntime {
  executable: string;
  invocation?: PdfTranslationInvocation;
  message: string;
  installCommand: string;
}

const PDF2ZH_PROMPT_FILE_NAME = 'ftranslate-pdf2zh-prompt.txt';

interface PdfTranslationRequest {
  paperId: string;
  pdfPath: string;
  outputMode?: PdfTranslationOutputMode;
  force?: boolean;
}

interface PdfTranslationMetadata {
  translatedPdfPath: string;
  translatedPdfName: string;
  translatedMonoPdfPath?: string;
  translatedMonoPdfName?: string;
  translatedPdfMode: PdfTranslationOutputMode;
  translationEngine: 'pdfmathtranslate';
  translationSourceHash: string;
  translatedAt: string;
  translatedProvider: AiProviderId;
  translatedModel: string;
}

interface PdfTranslationResult extends PdfTranslationMetadata {
  status: 'cached' | 'completed';
  message: string;
  pdf: PdfFilePayload;
  monoPdf?: PdfFilePayload | null;
}

interface PdfTranslationProgress {
  paperId: string;
  status: 'running' | 'completed' | 'failed';
  message: string;
}

let mainWindow: BrowserWindow | null = null;

const userDataDirOverride = process.env.PDF_TRANSLATION_READER_USER_DATA_DIR;
if (userDataDirOverride) {
  // 自动视觉验收会启动真实安装版；这里允许测试进程使用隔离 userData，避免污染用户的论文库和 AI 设置。
  app.setPath('userData', userDataDirOverride);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  showMainWindow();
});

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'PDF Translation Reader',
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (!app.isPackaged) {
    await mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMainWindow(): void {
  if (!mainWindow) {
    void createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function registerGlobalShortcut(): void {
  const registered = globalShortcut.register('CommandOrControl+Alt+P', () => {
    showMainWindow();
  });

  if (!registered) {
    console.warn('Global shortcut Ctrl+Alt+P registration failed.');
  }
}

async function readPdfFile(filePath: string): Promise<PdfFilePayload> {
  const buffer = await fs.readFile(filePath);

  return {
    filePath,
    fileName: path.basename(filePath),
    // PDF.js 在渲染进程中读取 Uint8Array；主进程用 base64 传输，避免暴露 Node 文件系统能力。
    base64: buffer.toString('base64')
  };
}

async function readOptionalPdfFile(filePath?: string | null): Promise<PdfFilePayload | null> {
  if (!filePath || !(await pathExists(filePath))) {
    return null;
  }

  return readPdfFile(filePath);
}

async function resolveOptionalMonoPdfPath(
  preferredPath?: string,
  fallbackPath?: string
): Promise<string | undefined> {
  if (preferredPath && (await pathExists(preferredPath))) {
    return preferredPath;
  }

  if (fallbackPath && (await pathExists(fallbackPath))) {
    return fallbackPath;
  }

  return undefined;
}

async function translatePdfWithSidecar(request: PdfTranslationRequest): Promise<PdfTranslationResult> {
  if (!request.paperId.trim()) {
    throw new Error('缺少论文记录 ID，无法写入双语 PDF 缓存。');
  }

  if (!request.pdfPath.trim()) {
    throw new Error('缺少 PDF 路径。');
  }

  const settings = normalizeStoredAiSettings(await loadStoredAiSettings());
  const apiKey = decryptApiKey(settings.encryptedApiKey);
  if (!apiKey) {
    throw new Error('请先在 AI 设置中保存 API Key，再生成双语 PDF。');
  }

  const outputMode = request.outputMode ?? 'dual';
  const stats = await fs.stat(request.pdfPath);
  const sourceHash = buildPdfTranslationSourceHash({
    pdfPath: request.pdfPath,
    fileSize: stats.size,
    mtimeMs: stats.mtimeMs
  });
  const outputDir = getPdfTranslationOutputDir(request.paperId);
  const outputPaths = buildPdfTranslationOutputPaths({
    pdfPath: request.pdfPath,
    outputDir
  });
  const expectedOutputPath = outputMode === 'dual' ? outputPaths.dualPdfPath : outputPaths.monoPdfPath;
  const cachedMetadata = await readPdfTranslationMetadata(request.paperId);

  if (
    !request.force &&
    cachedMetadata?.translationSourceHash === sourceHash &&
    cachedMetadata.translatedPdfMode === outputMode &&
    cachedMetadata.translatedPdfPath &&
    (await pathExists(cachedMetadata.translatedPdfPath))
  ) {
    const cachedMonoPath = await resolveOptionalMonoPdfPath(
      cachedMetadata.translatedMonoPdfPath,
      outputPaths.monoPdfPath
    );
    return {
      ...cachedMetadata,
      translatedMonoPdfPath: cachedMonoPath,
      translatedMonoPdfName: cachedMonoPath ? path.basename(cachedMonoPath) : undefined,
      status: 'cached',
      message: '已复用本机缓存的双语 PDF。',
      pdf: await readPdfFile(cachedMetadata.translatedPdfPath),
      monoPdf: await readOptionalPdfFile(cachedMonoPath)
    };
  }

  if (!request.force) {
    const reusableMetadata = await findReusablePdfTranslationMetadata(request.paperId, sourceHash, outputMode);
    if (reusableMetadata) {
      await fs.mkdir(outputDir, { recursive: true });
      await writePdfTranslationMetadata(request.paperId, reusableMetadata);
      const reusableMonoPath = await resolveOptionalMonoPdfPath(
        reusableMetadata.translatedMonoPdfPath,
        outputPaths.monoPdfPath
      );
      return {
        ...reusableMetadata,
        translatedMonoPdfPath: reusableMonoPath,
        translatedMonoPdfName: reusableMonoPath ? path.basename(reusableMonoPath) : undefined,
        status: 'cached',
        message: `已复用同一 PDF 的本机双语缓存：${reusableMetadata.translatedPdfName}`,
        pdf: await readPdfFile(reusableMetadata.translatedPdfPath),
        monoPdf: await readOptionalPdfFile(reusableMonoPath)
      };
    }
  }

  await fs.mkdir(outputDir, { recursive: true });
  const promptPath = await writePdf2zhPromptFile(outputDir);
  const engine = await ensurePdfTranslationRuntime(request.paperId, settings);
  sendPdfTranslationProgress({
    paperId: request.paperId,
    status: 'running',
    message: '正在调用 PDFMathTranslate 生成双语 PDF...'
  });

  const command = buildPdf2zhCommand({
    executable: engine.executable,
    invocation: engine.invocation,
    pdfPath: request.pdfPath,
    outputDir,
    mode: outputMode,
    ignoreCache: request.force,
    promptPath,
    settings
  });

  await runPdfTranslationProcess(command.command, command.args, {
    cwd: outputDir,
    apiKey,
    env: {
      ...command.env,
      OPENAI_API_KEY: apiKey
    },
    paperId: request.paperId
  });

  const translatedPdfPath = await resolveTranslatedPdfPath(expectedOutputPath, outputDir, outputMode);
  if (!translatedPdfPath) {
    throw new Error(`PDFMathTranslate 已结束，但没有找到输出文件：${expectedOutputPath}`);
  }
  const translatedMonoPdfPath = await resolveTranslatedPdfPath(outputPaths.monoPdfPath, outputDir, 'mono');
  const translatedMonoPdfName = translatedMonoPdfPath ? path.basename(translatedMonoPdfPath) : undefined;

  const metadata: PdfTranslationMetadata = {
    translatedPdfPath,
    translatedPdfName: path.basename(translatedPdfPath),
    translatedMonoPdfPath: translatedMonoPdfPath ?? undefined,
    translatedMonoPdfName,
    translatedPdfMode: outputMode,
    translationEngine: 'pdfmathtranslate',
    translationSourceHash: sourceHash,
    translatedAt: new Date().toISOString(),
    translatedProvider: settings.provider,
    translatedModel: settings.model
  };

  await writePdfTranslationMetadata(request.paperId, metadata);
  sendPdfTranslationProgress({
    paperId: request.paperId,
    status: 'completed',
    message: `双语 PDF 已生成：${metadata.translatedPdfName}`
  });

  return {
    ...metadata,
    status: 'completed',
    message: `双语 PDF 已生成：${metadata.translatedPdfName}`,
    pdf: await readPdfFile(translatedPdfPath),
    monoPdf: await readOptionalPdfFile(translatedMonoPdfPath)
  };
}

function checkPdfTranslationEngine(): PdfTranslationEngineView {
  const installCommand = getPdfTranslationInstallCommand();
  const runtime = inspectPdfTranslationRuntime();

  if (runtime) {
    return {
      available: true,
      executable: runtime.executable,
      invocation: runtime.invocation,
      message: runtime.message,
      installCommand
    };
  }

  const python = findCompatiblePythonCommand();
  if (python) {
    return {
      available: true,
      message: `未检测到 PDFMathTranslate；生成时会使用 ${python.label} 自动创建私有翻译环境。`,
      installCommand,
      autoInstall: true
    };
  }

  const uvExecutable = findExecutableOnPath('uv');
  return {
    available: false,
    message: uvExecutable
      ? `未找到 PDFMathTranslate 命令。可以执行：${installCommand}`
      : `未找到 PDFMathTranslate，也未找到可用 Python 3.10/3.12。请安装 Python 3.12，或手动执行：${installCommand}`,
    installCommand
  };
}

async function ensurePdfTranslationRuntime(
  paperId: string,
  settings?: AiProviderSettings
): Promise<PdfTranslationRuntime> {
  const preferPrivateRuntime = settings?.provider === 'kimi';
  const existing = preferPrivateRuntime ? inspectPrivatePdfTranslationRuntime() : inspectPdfTranslationRuntime();
  if (existing) {
    await patchPrivatePdf2zhTemperatureOption(settings, paperId);
    return existing;
  }

  const python = findCompatiblePythonCommand();
  if (!python) {
    throw new Error(
      `未找到 PDFMathTranslate，也未找到可用于自动安装的 Python 3.10/3.12。请安装 Python 3.12 后重试，或手动执行：${getPdfTranslationInstallCommand()}`
    );
  }

  const venvDir = getPdf2zhVenvDir();
  const venvPython = getPdf2zhVenvPythonPath();
  const userDataDir = app.getPath('userData');

  await fs.mkdir(path.dirname(venvDir), { recursive: true });

  if (!fsSync.existsSync(venvPython)) {
    sendPdfTranslationProgress({
      paperId,
      status: 'running',
      message: `正在创建 PDFMathTranslate 私有 Python 环境：${venvDir}`
    });
    await runPdfTranslationProcess(python.command, [...python.argsPrefix, '-m', 'venv', venvDir], {
      cwd: userDataDir,
      env: {},
      apiKey: '',
      paperId
    });
  }

  sendPdfTranslationProgress({
    paperId,
    status: 'running',
    message: '正在安装或更新 PDFMathTranslate，这一步首次运行会较慢。'
  });
  await runPdfTranslationProcess(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
    cwd: userDataDir,
    env: {},
    apiKey: '',
    paperId
  });
  await runPdfTranslationProcess(venvPython, ['-m', 'pip', 'install', 'pdf2zh'], {
    cwd: userDataDir,
    env: {},
    apiKey: '',
    paperId
  });

  await patchPrivatePdf2zhTemperatureOption(settings, paperId);

  const installed = inspectPrivatePdfTranslationRuntime() ?? inspectPdfTranslationRuntime();
  if (!installed) {
    throw new Error('PDFMathTranslate 安装完成后仍无法启动，请查看安装日志。');
  }

  return installed;
}

function inspectPdfTranslationRuntime(): PdfTranslationRuntime | null {
  const installCommand = getPdfTranslationInstallCommand();
  const executable = findExecutableOnPath('pdf2zh') ?? findExecutableOnPath('pdf2zh_next');

  if (executable) {
    return {
      executable,
      invocation: 'cli',
      message: `已找到 PDFMathTranslate 命令：${executable}`,
      installCommand
    };
  }

  return inspectPrivatePdfTranslationRuntime();
}

function inspectPrivatePdfTranslationRuntime(): PdfTranslationRuntime | null {
  const installCommand = getPdfTranslationInstallCommand();
  const venvCli = getPdf2zhVenvCliPath();
  if (fsSync.existsSync(venvCli)) {
    return {
      executable: venvCli,
      invocation: 'cli',
      message: `已找到应用私有 PDFMathTranslate：${venvCli}`,
      installCommand
    };
  }

  const venvPython = getPdf2zhVenvPythonPath();
  if (fsSync.existsSync(venvPython) && isPdf2zhModuleAvailable(venvPython)) {
    return {
      executable: venvPython,
      invocation: 'python-module',
      message: `已找到应用私有 PDFMathTranslate Python 模块：${venvPython}`,
      installCommand
    };
  }

  return null;
}

async function patchPrivatePdf2zhTemperatureOption(
  settings: AiProviderSettings | undefined,
  paperId: string
): Promise<void> {
  if (!settings || !fsSync.existsSync(getPdf2zhVenvPythonPath())) {
    return;
  }

  const translatorPath = getPrivatePdf2zhTranslatorPath();
  if (!fsSync.existsSync(translatorPath)) {
    return;
  }

  const content = await fs.readFile(translatorPath, 'utf8');
  const patchResult = patchPdf2zhOpenAiTemperatureSource(content);
  if (!patchResult.changed) {
    return;
  }

  sendPdfTranslationProgress({
    paperId,
    status: 'running',
    message: '正在修正 PDFMathTranslate 的 OpenAI-compatible temperature 兼容性。'
  });
  await fs.writeFile(translatorPath, patchResult.source, 'utf8');
}

async function writePdf2zhPromptFile(outputDir: string): Promise<string> {
  const promptPath = path.join(outputDir, PDF2ZH_PROMPT_FILE_NAME);
  await fs.writeFile(promptPath, buildPdf2zhAcademicPrompt(), 'utf8');
  return promptPath;
}

function buildPdf2zhAcademicPrompt(): string {
  return [
    'You are a professional academic paper translation engine.',
    'Translate the following source text from $lang_in to $lang_out.',
    'Rules:',
    '1. Output only the translated text. Do not add explanations, Markdown fences, comments, or prefixes.',
    '2. Preserve all formula placeholders exactly, including {v1}, {{v1}}, <v1>, inline LaTeX, equation numbers, and symbols.',
    '3. Preserve citation markers exactly, including [1], [2, 3], [12-15], (Smith et al., 2023), DOI, arXiv IDs, URLs, and table/figure numbers.',
    '4. If the source text is a References/Bibliography section or a single bibliography entry, return the original text unchanged.',
    '5. Keep list numbers, bullet markers, line-break intent, section labels, Fig./Figure/Table captions, and punctuation structure as stable as possible.',
    '6. Prefer concise Chinese academic wording. Do not invent information that is not present in the source text.',
    '',
    'Source Text:',
    '$text',
    '',
    'Translated Text:'
  ].join('\n');
}

function getPdfTranslationInstallCommand(): string {
  return 'uv tool install pdf2zh 或 py -3.12 -m pip install pdf2zh';
}

function getPdf2zhVenvDir(): string {
  return path.join(app.getPath('userData'), 'sidecars', 'pdf2zh-venv');
}

function getPdf2zhVenvPythonPath(): string {
  return process.platform === 'win32'
    ? path.join(getPdf2zhVenvDir(), 'Scripts', 'python.exe')
    : path.join(getPdf2zhVenvDir(), 'bin', 'python');
}

function getPdf2zhVenvCliPath(): string {
  return process.platform === 'win32'
    ? path.join(getPdf2zhVenvDir(), 'Scripts', 'pdf2zh.exe')
    : path.join(getPdf2zhVenvDir(), 'bin', 'pdf2zh');
}

function getPrivatePdf2zhTranslatorPath(): string {
  return path.join(getPdf2zhVenvDir(), 'Lib', 'site-packages', 'pdf2zh', 'translator.py');
}

function isPdf2zhModuleAvailable(pythonPath: string): boolean {
  const result = spawnSync(
    pythonPath,
    ['-c', 'import importlib.util; raise SystemExit(0 if importlib.util.find_spec("pdf2zh") else 1)'],
    {
      encoding: 'utf8',
      windowsHide: true
    }
  );

  return result.status === 0;
}

function findCompatiblePythonCommand(): PythonCommand | null {
  const envPython = process.env.PDF_TRANSLATION_READER_PYTHON?.trim();
  const candidates: PythonCommand[] = [
    ...(envPython ? [{ command: envPython, argsPrefix: [], label: envPython }] : []),
    { command: 'py', argsPrefix: ['-3.12'], label: 'Python 3.12' },
    { command: 'py', argsPrefix: ['-3.10'], label: 'Python 3.10' },
    { command: 'python', argsPrefix: [], label: 'python' }
  ];

  for (const candidate of candidates) {
    const version = readPythonVersion(candidate);
    if (version && isSupportedPdfTranslationPython(version)) {
      return {
        ...candidate,
        label: `${candidate.label} (${version})`
      };
    }
  }

  return null;
}

function readPythonVersion(candidate: PythonCommand): string | null {
  const result = spawnSync(
    candidate.command,
    [...candidate.argsPrefix, '-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")'],
    {
      encoding: 'utf8',
      windowsHide: true
    }
  );

  if (result.status !== 0) {
    return null;
  }

  return (result.stdout || result.stderr).trim() || null;
}

function isSupportedPdfTranslationPython(version: string): boolean {
  const [major, minor] = version.split('.').map((part) => Number(part));
  return major === 3 && Number.isFinite(minor) && minor >= 10 && minor <= 12;
}

function findExecutableOnPath(command: string): string | null {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [command], {
    encoding: 'utf8',
    windowsHide: true
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean) ?? command;
}

async function runPdfTranslationProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    apiKey: string;
    paperId: string;
  }
): Promise<void> {
  const logs: string[] = [];
  const startedAt = Date.now();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONLEGACYWINDOWSSTDIO: '0',
        ...options.env
      },
      windowsHide: true
    });
    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const lastLog = logs.at(-1);
      sendPdfTranslationProgress({
        paperId: options.paperId,
        status: 'running',
        message: lastLog
          ? `PDFMathTranslate 仍在运行（${elapsedSeconds}s）：${lastLog}`
          : `PDFMathTranslate 仍在运行（${elapsedSeconds}s），正在等待翻译引擎输出进度。`
      });
    }, 30000);

    const finish = (callback: () => void): void => {
      clearInterval(heartbeat);
      callback();
    };

    const handleChunk = (chunk: Buffer): void => {
      const message = formatPdfTranslationProgressMessage(
        sanitizePdfTranslationLog(chunk.toString('utf8'), options.apiKey)
      ).trim();
      if (!message) {
        return;
      }

      logs.push(message);
      if (logs.length > 20) {
        logs.shift();
      }
      sendPdfTranslationProgress({
        paperId: options.paperId,
        status: 'running',
        message
      });
    };

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleChunk);
    child.on('error', (error) => {
      finish(() => reject(error));
    });
    child.on('close', (code) => {
      if (code === 0) {
        finish(resolve);
        return;
      }

      finish(() => reject(new Error(`PDFMathTranslate 退出码 ${code}：${logs.join('\n').slice(-4000)}`)));
    });
  });
}

async function resolveTranslatedPdfPath(
  expectedOutputPath: string,
  outputDir: string,
  mode: PdfTranslationOutputMode
): Promise<string | null> {
  if (await pathExists(expectedOutputPath)) {
    return expectedOutputPath;
  }

  try {
    const suffix = mode === 'dual' ? '-dual.pdf' : '-mono.pdf';
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(suffix))
        .map(async (entry) => {
          const filePath = path.join(outputDir, entry.name);
          const stats = await fs.stat(filePath);
          return { filePath, mtimeMs: stats.mtimeMs };
        })
    );
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.filePath ?? null;
  } catch {
    return null;
  }
}

function sendPdfTranslationProgress(progress: PdfTranslationProgress): void {
  mainWindow?.webContents.send('pdf-translation:progress', progress);
}

function getPdfTranslationOutputDir(paperId: string): string {
  return path.join(app.getPath('userData'), 'translations', sanitizeFileName(paperId));
}

function getPdfTranslationMetadataPath(paperId: string): string {
  return path.join(getPdfTranslationOutputDir(paperId), 'job.json');
}

async function readPdfTranslationMetadata(paperId: string): Promise<PdfTranslationMetadata | null> {
  try {
    const content = await fs.readFile(getPdfTranslationMetadataPath(paperId), 'utf8');
    const parsed = JSON.parse(content) as Partial<PdfTranslationMetadata>;
    if (!parsed.translatedPdfPath || !parsed.translationSourceHash) {
      return null;
    }

    const normalized = normalizePdfTranslationRecordFields({
      translatedPdfPath: parsed.translatedPdfPath,
      translatedPdfName: parsed.translatedPdfName,
      translatedMonoPdfPath: typeof parsed.translatedMonoPdfPath === 'string' ? parsed.translatedMonoPdfPath : undefined,
      translatedMonoPdfName:
        typeof parsed.translatedMonoPdfName === 'string' ? parsed.translatedMonoPdfName : undefined,
      translatedPdfMode: parsed.translatedPdfMode === 'mono' ? 'mono' : 'dual',
      translationEngine: 'pdfmathtranslate',
      translationSourceHash: parsed.translationSourceHash,
      translatedAt: parsed.translatedAt || new Date().toISOString(),
      translatedProvider: parseProvider(parsed.translatedProvider) ?? 'custom',
      translatedModel: parsed.translatedModel || ''
    });

    return {
      ...normalized,
      translatedPdfName: normalized.translatedPdfName || path.basename(parsed.translatedPdfPath)
    };
  } catch {
    return null;
  }
}

async function writePdfTranslationMetadata(
  paperId: string,
  metadata: PdfTranslationMetadata
): Promise<void> {
  await fs.mkdir(getPdfTranslationOutputDir(paperId), { recursive: true });
  await fs.writeFile(getPdfTranslationMetadataPath(paperId), JSON.stringify(metadata, null, 2), 'utf8');
}

async function findReusablePdfTranslationMetadata(
  currentPaperId: string,
  sourceHash: string,
  outputMode: PdfTranslationOutputMode
): Promise<PdfTranslationMetadata | null> {
  try {
    const translationRoot = path.join(app.getPath('userData'), 'translations');
    const entries = await fs.readdir(translationRoot, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name !== sanitizeFileName(currentPaperId))
        .map(async (entry) => readPdfTranslationMetadata(entry.name))
    );
    const reusable = findReusablePdfTranslationRecord(
      records.filter((record): record is PdfTranslationMetadata => Boolean(record)),
      { sourceHash, outputMode }
    );

    if (reusable?.translatedPdfPath && (await pathExists(reusable.translatedPdfPath))) {
      return reusable;
    }
  } catch {
    return null;
  }

  return null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '_').slice(0, 120) || 'paper';
}

async function exportResearchWorkbookToExcel(
  request: ResearchWorkbookExcelRequest
): Promise<ResearchWorkbookExcelResult | null> {
  const workbookPayload = normalizeResearchWorkbookExcelPayload(request.workbook);
  const result = await dialog.showSaveDialog({
    title: '导出研究表格 Excel',
    defaultPath: `${sanitizeFileName(workbookPayload.sheetName || 'research-workbook')}.xlsx`,
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PDF Translation Reader';
  workbook.created = new Date();

  if (isResearchWorkbookUniverSnapshot(workbookPayload.univerSnapshot)) {
    writeUniverSnapshotToExcelWorkbook(workbook, workbookPayload.univerSnapshot);
    await workbook.xlsx.writeFile(result.filePath);
    return {
      filePath: result.filePath,
      fileName: path.basename(result.filePath)
    };
  }

  const worksheet = workbook.addWorksheet(workbookPayload.sheetName || '论文研究表', {
    views: [{
      state: 'frozen',
      xSplit: workbookPayload.freeze.xSplit,
      ySplit: workbookPayload.freeze.ySplit
    }]
  });

  workbookPayload.columns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = Math.max(8, Math.round(column.width / 7));
  });

  workbookPayload.rows.forEach((sourceRow, rowIndex) => {
    const row = worksheet.getRow(rowIndex + 1);
    if (sourceRow.height) {
      row.height = pxToExcelRowHeight(sourceRow.height);
    }

    sourceRow.cells.forEach((sourceCell, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      const value = sourceCell.value ?? '';
      cell.value = value.trim().startsWith('=')
        ? { formula: value.trim().slice(1) }
        : value;
      applyExcelCellStyle(cell, sourceCell.style, rowIndex === 0);
    });
    row.commit();
  });

  await workbook.xlsx.writeFile(result.filePath);
  return {
    filePath: result.filePath,
    fileName: path.basename(result.filePath)
  };
}

async function importResearchWorkbookFromExcel(): Promise<{
  filePath: string;
  fileName: string;
  workbook: ResearchWorkbookExcelPayload;
} | null> {
  const result = await dialog.showOpenDialog({
    title: '导入外部 Excel 研究表格',
    properties: ['openFile'],
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Excel 文件中没有可导入的工作表。');
  }

  const freeze = readExcelWorksheetFreeze(worksheet);
  const columnCount = Math.max(1, worksheet.actualColumnCount || worksheet.columnCount || 1);
  const rowCount = Math.max(1, worksheet.actualRowCount || worksheet.rowCount || 1);
  const columns: ResearchWorkbookExcelColumn[] = Array.from({ length: columnCount }, (_, index) => {
    const header = readExcelCellText(worksheet.getRow(1).getCell(index + 1)) || `列 ${index + 1}`;
    return {
      key: getDefaultResearchColumnKey(index),
      label: header,
      width: Math.max(80, Math.round((worksheet.getColumn(index + 1).width || 16) * 7))
    };
  });
  const rows: ResearchWorkbookExcelRow[] = [];

  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    const sourceRow = worksheet.getRow(rowIndex);
    rows.push({
      id: rowIndex === 1 ? 'header' : `row-${rowIndex - 1}`,
      height: sourceRow.height ? excelRowHeightToPx(sourceRow.height) : undefined,
      cells: columns.map((_, columnIndex) => {
        const sourceCell = sourceRow.getCell(columnIndex + 1);
        return {
          value: readExcelCellText(sourceCell),
          style: readExcelCellStyle(sourceCell)
        };
      })
    });
  }

  return {
    filePath,
    fileName: path.basename(filePath),
    workbook: {
      id: 'research-workbook',
      sheetName: worksheet.name || '论文研究表',
      univerSnapshot: buildUniverSnapshotFromExcelWorkbook(workbook, filePath),
      freeze,
      columns,
      rows
    }
  };
}

function buildUniverSnapshotFromExcelWorkbook(
  workbook: ExcelJS.Workbook,
  sourcePath: string
): Record<string, unknown> {
  const sheetOrder: string[] = [];
  const sheets: Record<string, unknown> = {};
  const styles: Record<string, unknown> = {
    header: {
      bg: { rgb: '#111111' },
      cl: { rgb: '#ffffff' },
      bl: 1,
      ht: 2,
      vt: 2,
      fs: 13,
      tb: 3
    },
    normal: {
      fs: 12,
      vt: 2,
      tb: 3
    }
  };

  workbook.worksheets.forEach((worksheet, sheetIndex) => {
    const sheetId = `sheet-${sheetIndex + 1}`;
    sheetOrder.push(sheetId);
    sheets[sheetId] = buildUniverSheetFromExcelWorksheet(worksheet, sheetId);
  });

  return {
    id: 'research-workbook',
    name: path.basename(sourcePath, path.extname(sourcePath)) || '论文研究表',
    appVersion: '0.24.0',
    locale: 'zhCN',
    styles,
    sheetOrder,
    sheets
  };
}

function buildUniverSheetFromExcelWorksheet(
  worksheet: ExcelJS.Worksheet,
  sheetId: string
): Record<string, unknown> {
  const freeze = readExcelWorksheetFreeze(worksheet);
  const columnCount = Math.max(1, worksheet.actualColumnCount || worksheet.columnCount || 1);
  const rowCount = Math.max(1, worksheet.actualRowCount || worksheet.rowCount || 1);
  const cellData: Record<number, Record<number, Record<string, unknown>>> = {};
  const rowData: Record<number, { h: number }> = {};
  const columnData: Record<number, { w: number }> = {};

  for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
    const width = Math.max(70, Math.round((worksheet.getColumn(columnIndex).width || 16) * 7));
    columnData[columnIndex - 1] = { w: width };
  }

  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    const sourceRow = worksheet.getRow(rowIndex);
    if (sourceRow.height) {
      rowData[rowIndex - 1] = { h: excelRowHeightToPx(sourceRow.height) };
    }

    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const sourceCell = sourceRow.getCell(columnIndex);
      const value = readExcelCellText(sourceCell);
      const style = readExcelCellStyle(sourceCell);
      if (!value && !style?.univerStyle) {
        continue;
      }

      if (!cellData[rowIndex - 1]) {
        cellData[rowIndex - 1] = {};
      }

      const cellPayload: Record<string, unknown> = value.trim().startsWith('=')
        ? { f: value }
        : { v: value, t: 1 };
      if (style?.univerStyle) {
        cellPayload.s = style.univerStyle;
      }
      cellData[rowIndex - 1][columnIndex - 1] = cellPayload;
    }
  }

  return {
    id: sheetId,
    name: worksheet.name || '论文研究表',
    hidden: 0,
    freeze: {
      xSplit: freeze.xSplit,
      ySplit: freeze.ySplit,
      startColumn: freeze.xSplit > 0 ? freeze.xSplit : -1,
      startRow: freeze.ySplit > 0 ? freeze.ySplit : -1
    },
    rowCount: Math.max(rowCount, 20),
    columnCount: Math.max(columnCount, 10),
    zoomRatio: 1,
    scrollTop: 0,
    scrollLeft: 0,
    defaultColumnWidth: 120,
    defaultRowHeight: 28,
    mergeData: [],
    cellData,
    rowData,
    columnData,
    rowHeader: { width: 46 },
    columnHeader: { height: 26 },
    showGridlines: 1,
    rightToLeft: 0
  };
}

function writeUniverSnapshotToExcelWorkbook(
  workbook: ExcelJS.Workbook,
  snapshot: Record<string, unknown>
): void {
  const sheetOrder = Array.isArray(snapshot.sheetOrder) ? snapshot.sheetOrder.map(String) : [];
  const sheets = isRecord(snapshot.sheets) ? snapshot.sheets : {};
  const orderedSheetIds = sheetOrder.length > 0 ? sheetOrder : Object.keys(sheets);

  orderedSheetIds.forEach((sheetId, index) => {
    const sheet = isRecord(sheets[sheetId]) ? sheets[sheetId] : null;
    if (!sheet) {
      return;
    }

    const worksheet = workbook.addWorksheet(
      sanitizeExcelSheetName(String(sheet.name || `Sheet ${index + 1}`)),
      { views: [readUniverSheetFreeze(sheet)] }
    );
    writeUniverSheetToExcelWorksheet(worksheet, sheet, isRecord(snapshot.styles) ? snapshot.styles : {});
  });

  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet('论文研究表');
  }
}

function writeUniverSheetToExcelWorksheet(
  worksheet: ExcelJS.Worksheet,
  sheet: Record<string, unknown>,
  styles: Record<string, unknown>
): void {
  const rowCount = getUniverSheetUsedRowCount(sheet);
  const columnCount = getUniverSheetUsedColumnCount(sheet);
  const cellData = isRecord(sheet.cellData) ? sheet.cellData : {};
  const rowData = isRecord(sheet.rowData) ? sheet.rowData : {};
  const columnData = isRecord(sheet.columnData) ? sheet.columnData : {};

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const column = (isRecord(columnData[String(columnIndex)]) ? columnData[String(columnIndex)] : {}) as Record<string, unknown>;
    const widthPx = readNumberLike(column.w, 120);
    worksheet.getColumn(columnIndex + 1).width = Math.max(8, Math.round(widthPx / 7));
  }

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const excelRow = worksheet.getRow(rowIndex + 1);
    const rowMeta = (isRecord(rowData[String(rowIndex)]) ? rowData[String(rowIndex)] : {}) as Record<string, unknown>;
    if (typeof rowMeta.h === 'number') {
      excelRow.height = pxToExcelRowHeight(rowMeta.h);
    }

    const rowCells = (isRecord(cellData[String(rowIndex)]) ? cellData[String(rowIndex)] : {}) as Record<string, unknown>;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const sourceCell = (isRecord(rowCells[String(columnIndex)])
        ? rowCells[String(columnIndex)]
        : null) as Record<string, unknown> | null;
      const excelCell = excelRow.getCell(columnIndex + 1);
      if (!sourceCell) {
        continue;
      }

      const value = readUniverCellText(sourceCell);
      excelCell.value = value.trim().startsWith('=')
        ? { formula: value.trim().slice(1) }
        : value;
      applyExcelCellStyle(
        excelCell,
        {
          univerStyle: resolveUniverStyle(sourceCell.s, styles),
          wrapText: true
        },
        rowIndex === 0
      );
    }
    excelRow.commit();
  }
}

function normalizeResearchWorkbookExcelPayload(
  workbook: ResearchWorkbookExcelPayload
): ResearchWorkbookExcelPayload {
  const columns = Array.isArray(workbook.columns) && workbook.columns.length > 0
    ? workbook.columns
    : [{ key: 'paper', label: '论文', width: 180 }];
  const rows: ResearchWorkbookExcelRow[] = Array.isArray(workbook.rows) && workbook.rows.length > 0
    ? workbook.rows
    : [{ id: 'header', cells: columns.map((column) => ({ value: column.label })) }];

  return {
    id: workbook.id || 'research-workbook',
    sheetName: workbook.sheetName || '论文研究表',
    univerSnapshot: isRecord(workbook.univerSnapshot) ? workbook.univerSnapshot : undefined,
    freeze: {
      ySplit: Math.max(0, Number(workbook.freeze?.ySplit) || 0),
      xSplit: Math.max(0, Number(workbook.freeze?.xSplit) || 0)
    },
    columns: columns.map((column, index) => ({
      key: column.key || `custom-${index}`,
      label: column.label || `列 ${index + 1}`,
      width: Math.max(60, Number(column.width) || 140)
    })),
    rows: rows.map((row, index) => ({
      id: row.id || (index === 0 ? 'header' : `row-${index}`),
      height: typeof row.height === 'number' && Number.isFinite(row.height) ? row.height : undefined,
      cells: columns.map((_, columnIndex) => ({
        value: row.cells?.[columnIndex]?.value ?? '',
        style: row.cells?.[columnIndex]?.style
      }))
    }))
  };
}

function applyExcelCellStyle(
  cell: ExcelJS.Cell,
  style: ResearchWorkbookExcelCellStyle | undefined,
  isHeader: boolean
): void {
  const univerStyle = isRecord(style?.univerStyle) ? style.univerStyle : {};
  const fontSize = readNumberLike(style?.fontSize, readNumberLike(univerStyle.fs, isHeader ? 13 : 12));
  const fontColor = style?.color ?? readRgb(univerStyle.cl) ?? (isHeader ? '#ffffff' : '#111111');
  const fillColor = style?.backgroundColor ?? readRgb(univerStyle.bg) ?? (isHeader ? '#111111' : undefined);
  const bold = style?.bold ?? readBooleanNumber(univerStyle.bl) ?? isHeader;
  const italic = style?.italic ?? readBooleanNumber(univerStyle.it) ?? false;
  const align = style?.align ?? readHorizontalAlign(univerStyle.ht) ?? (isHeader ? 'center' : 'left');
  const wrapText = style?.wrapText ?? readUniverWrap(univerStyle.tb) ?? true;

  cell.font = {
    size: fontSize,
    bold,
    italic,
    color: { argb: toExcelArgb(fontColor) }
  };
  cell.alignment = {
    horizontal: align,
    vertical: 'middle',
    wrapText
  };
  if (fillColor) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: toExcelArgb(fillColor) }
    };
  }
}

function readExcelCellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (isRecord(value) && typeof value.formula === 'string') {
    return `=${value.formula}`;
  }
  if (isRecord(value) && Array.isArray(value.richText)) {
    return value.richText.map((part) => isRecord(part) ? String(part.text ?? '') : '').join('');
  }
  if (isRecord(value) && 'text' in value) {
    return String(value.text ?? '');
  }
  return String(value);
}

function readExcelCellStyle(cell: ExcelJS.Cell): ResearchWorkbookExcelCellStyle | undefined {
  const style: ResearchWorkbookExcelCellStyle = {};
  const univerStyle: Record<string, unknown> = {};
  if (typeof cell.font?.size === 'number') {
    style.fontSize = cell.font.size;
    univerStyle.fs = cell.font.size;
  }
  if (cell.font?.bold !== undefined) {
    style.bold = Boolean(cell.font.bold);
    univerStyle.bl = cell.font.bold ? 1 : 0;
  }
  if (cell.font?.italic !== undefined) {
    style.italic = Boolean(cell.font.italic);
    univerStyle.it = cell.font.italic ? 1 : 0;
  }
  const fontColor = fromExcelArgb(cell.font?.color?.argb);
  if (fontColor) {
    style.color = fontColor;
    univerStyle.cl = { rgb: fontColor };
  }
  const fill = cell.fill;
  if (fill && fill.type === 'pattern' && 'fgColor' in fill) {
    const fillColor = fromExcelArgb(fill.fgColor?.argb);
    if (fillColor) {
      style.backgroundColor = fillColor;
      univerStyle.bg = { rgb: fillColor };
    }
  }
  if (
    cell.alignment?.horizontal === 'left' ||
    cell.alignment?.horizontal === 'center' ||
    cell.alignment?.horizontal === 'right'
  ) {
    style.align = cell.alignment.horizontal;
    univerStyle.ht = cell.alignment.horizontal === 'left' ? 1 : cell.alignment.horizontal === 'center' ? 2 : 3;
  }
  if (cell.alignment?.vertical === 'top') {
    univerStyle.vt = 1;
  } else if (cell.alignment?.vertical === 'middle') {
    univerStyle.vt = 2;
  } else if (cell.alignment?.vertical === 'bottom') {
    univerStyle.vt = 3;
  }
  if (cell.alignment?.wrapText || readExcelCellText(cell).length > 24) {
    style.wrapText = true;
    // Univer 的 tb=3 对应 wrap，保证导入外部 Excel 后长文本默认自动换行。
    univerStyle.tb = 3;
  }
  if (Object.keys(univerStyle).length > 0) {
    style.univerStyle = univerStyle;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function getDefaultResearchColumnKey(index: number): string {
  return [
    'paper',
    'chineseTitle',
    'englishTitle',
    'innovation',
    'limitations',
    'method',
    'dataset',
    'metrics',
    'reproducePlan',
    'futureIdeas',
    'notes'
  ][index] ?? `custom-${index}`;
}

function readExcelWorksheetFreeze(worksheet: ExcelJS.Worksheet): { xSplit: number; ySplit: number } {
  const frozenView = worksheet.views?.find((view) => view.state === 'frozen') as Record<string, unknown> | undefined;
  return {
    xSplit: Math.max(0, Number(frozenView?.xSplit) || 0),
    ySplit: Math.max(0, Number(frozenView?.ySplit) || 0)
  };
}

function isResearchWorkbookUniverSnapshot(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isRecord(value.sheets) && Array.isArray(value.sheetOrder);
}

function readUniverSheetFreeze(sheet: Record<string, unknown>): ExcelJS.WorksheetView {
  const freeze = isRecord(sheet.freeze) ? sheet.freeze : {};
  return {
    state: 'frozen',
    xSplit: Math.max(0, Number(freeze.xSplit) || 0),
    ySplit: Math.max(0, Number(freeze.ySplit) || 0)
  } as ExcelJS.WorksheetView;
}

function getUniverSheetUsedRowCount(sheet: Record<string, unknown>): number {
  const indexes = new Set<number>([0]);
  const cellData = isRecord(sheet.cellData) ? sheet.cellData : {};
  const rowData = isRecord(sheet.rowData) ? sheet.rowData : {};

  Object.keys(cellData).forEach((key) => addNonNegativeInteger(indexes, key));
  Object.keys(rowData).forEach((key) => addNonNegativeInteger(indexes, key));
  return Math.max(...indexes) + 1;
}

function getUniverSheetUsedColumnCount(sheet: Record<string, unknown>): number {
  const indexes = new Set<number>([0]);
  const cellData = isRecord(sheet.cellData) ? sheet.cellData : {};
  const columnData = isRecord(sheet.columnData) ? sheet.columnData : {};

  Object.values(cellData).forEach((row) => {
    if (isRecord(row)) {
      Object.keys(row).forEach((key) => addNonNegativeInteger(indexes, key));
    }
  });
  Object.keys(columnData).forEach((key) => addNonNegativeInteger(indexes, key));
  return Math.max(...indexes) + 1;
}

function addNonNegativeInteger(indexes: Set<number>, value: string): void {
  const index = Number(value);
  if (Number.isInteger(index) && index >= 0) {
    indexes.add(index);
  }
}

function sanitizeExcelSheetName(value: string): string {
  const cleaned = value.replace(/[:\\/?*\[\]]/gu, ' ').trim() || 'Sheet';
  return cleaned.slice(0, 31);
}

function readUniverCellText(cell: Record<string, unknown>): string {
  if (typeof cell.f === 'string' && cell.f) {
    return cell.f.startsWith('=') ? cell.f : `=${cell.f}`;
  }
  if (typeof cell.v === 'string') {
    return cell.v;
  }
  if (typeof cell.v === 'number' || typeof cell.v === 'boolean') {
    return String(cell.v);
  }
  return '';
}

function resolveUniverStyle(styleRef: unknown, styles: Record<string, unknown>): unknown {
  if (typeof styleRef === 'string') {
    return styles[styleRef];
  }
  return isRecord(styleRef) ? styleRef : undefined;
}

function pxToExcelRowHeight(px: number): number {
  return Math.max(8, Math.round((px * 0.75) * 100) / 100);
}

function excelRowHeightToPx(height: number): number {
  return Math.max(12, Math.round(height / 0.75));
}

function toExcelArgb(color: string): string {
  return `FF${color.replace('#', '').padStart(6, '0').slice(0, 6).toUpperCase()}`;
}

function fromExcelArgb(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const hex = value.length === 8 ? value.slice(2) : value;
  return `#${hex.slice(0, 6).toLowerCase()}`;
}

function readRgb(value: unknown): string | undefined {
  return isRecord(value) && typeof value.rgb === 'string' ? value.rgb : undefined;
}

function readBooleanNumber(value: unknown): boolean | undefined {
  if (value === 1) {
    return true;
  }
  if (value === 0) {
    return false;
  }
  return undefined;
}

function readUniverWrap(value: unknown): boolean | undefined {
  if (value === 3 || value === 'wrap') {
    return true;
  }
  if (value === 1 || value === 2 || value === 'overflow' || value === 'clip') {
    return false;
  }
  return undefined;
}

function readNumberLike(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readHorizontalAlign(value: unknown): 'left' | 'center' | 'right' | undefined {
  if (value === 1) {
    return 'left';
  }
  if (value === 2) {
    return 'center';
  }
  if (value === 3) {
    return 'right';
  }
  return undefined;
}

async function readTextFile(filePath: string): Promise<TextFilePayload> {
  const content = await fs.readFile(filePath, 'utf8');

  return {
    filePath,
    fileName: path.basename(filePath),
    content
  };
}

function getTextFilters(extension: SaveTextRequest['extension']): Electron.FileFilter[] {
  if (extension === 'json') {
    return [{ name: 'JSON Translation', extensions: ['json'] }];
  }

  return [{ name: 'Markdown', extensions: ['md', 'markdown'] }];
}

function getDefaultAiSettings(): AiProviderSettings {
  return AI_PROVIDER_PRESETS.deepseek;
}

function getAiSettingsPath(): string {
  return path.join(app.getPath('userData'), 'ai-settings.json');
}

async function loadStoredAiSettings(): Promise<StoredAiSettings> {
  try {
    const content = await fs.readFile(getAiSettingsPath(), 'utf8');
    const parsed = JSON.parse(content) as Partial<StoredAiSettings>;
    const fallback = getDefaultAiSettings();
    return normalizeStoredAiSettings({
      provider: parseProvider(parsed.provider) ?? fallback.provider,
      baseURL: typeof parsed.baseURL === 'string' && parsed.baseURL ? parsed.baseURL : fallback.baseURL,
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : fallback.model,
      thinkingMode: typeof parsed.thinkingMode === 'string' ? parsed.thinkingMode : undefined,
      reasoningEffort: typeof parsed.reasoningEffort === 'string' ? parsed.reasoningEffort : undefined,
      temperature: readOptionalNumber(parsed.temperature),
      topP: readOptionalNumber(parsed.topP),
      maxTokens: readOptionalNumber(parsed.maxTokens),
      timeoutSeconds: readOptionalNumber(parsed.timeoutSeconds),
      maxRetries: readOptionalNumber(parsed.maxRetries),
      encryptedApiKey: typeof parsed.encryptedApiKey === 'string' ? parsed.encryptedApiKey : undefined
    });
  } catch {
    return getDefaultAiSettings();
  }
}

async function saveStoredAiSettings(request: AiSettingsRequest): Promise<StoredAiSettings> {
  const existing = await loadStoredAiSettings();
  const next: StoredAiSettings = {
    provider: parseProvider(request.provider) ?? existing.provider,
    baseURL: request.baseURL.trim() || existing.baseURL,
    model: request.model.trim() || existing.model,
    thinkingMode: request.thinkingMode ?? existing.thinkingMode,
    reasoningEffort: request.reasoningEffort ?? existing.reasoningEffort,
    temperature: request.temperature ?? existing.temperature,
    topP: request.topP ?? existing.topP,
    maxTokens: request.maxTokens ?? existing.maxTokens,
    timeoutSeconds: request.timeoutSeconds ?? existing.timeoutSeconds,
    maxRetries: request.maxRetries ?? existing.maxRetries,
    encryptedApiKey:
      request.apiKey && request.apiKey.trim()
        ? encryptApiKey(request.apiKey.trim())
        : existing.encryptedApiKey
  };
  const normalizedNext = normalizeStoredAiSettings(next);

  await fs.mkdir(path.dirname(getAiSettingsPath()), { recursive: true });
  await fs.writeFile(getAiSettingsPath(), JSON.stringify(normalizedNext, null, 2), 'utf8');
  return normalizedNext;
}

function normalizeStoredAiSettings(settings: StoredAiSettings): StoredAiSettings {
  const normalized = normalizeAiProviderSettings(settings);

  return {
    ...settings,
    ...normalized
  };
}

function toAiSettingsView(settings: StoredAiSettings): AiSettingsView {
  return {
    provider: settings.provider,
    baseURL: settings.baseURL,
    model: settings.model,
    thinkingMode: settings.thinkingMode,
    reasoningEffort: settings.reasoningEffort,
    temperature: settings.temperature,
    topP: settings.topP,
    maxTokens: settings.maxTokens,
    timeoutSeconds: settings.timeoutSeconds,
    maxRetries: settings.maxRetries,
    apiKeyConfigured: Boolean(settings.encryptedApiKey)
  };
}

function readOptionalNumber(value: unknown): number | undefined {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function parseProvider(value: unknown): AiProviderId | null {
  return value === 'openai' || value === 'deepseek' || value === 'kimi' || value === 'custom'
    ? value
    : null;
}

function encryptApiKey(apiKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return `plain:${Buffer.from(apiKey, 'utf8').toString('base64')}`;
  }

  return `safe:${safeStorage.encryptString(apiKey).toString('base64')}`;
}

function decryptApiKey(encryptedApiKey?: string): string {
  if (!encryptedApiKey) {
    return '';
  }

  if (encryptedApiKey.startsWith('plain:')) {
    return Buffer.from(encryptedApiKey.slice('plain:'.length), 'base64').toString('utf8');
  }

  if (encryptedApiKey.startsWith('safe:')) {
    return safeStorage.decryptString(Buffer.from(encryptedApiKey.slice('safe:'.length), 'base64'));
  }

  return '';
}

async function translateWithAi(request: AiTranslationItem & { force?: boolean }) {
  const settings = await loadStoredAiSettings();
  const apiKey = decryptApiKey(settings.encryptedApiKey);

  if (!apiKey) {
    throw new Error('请先在 AI 设置中保存 API Key。');
  }

  if (!shouldTranslateItem(request, request.force)) {
    return {
      translation: request.translation,
      translatedAt: request.translatedAt ?? '',
      provider: settings.provider,
      model: settings.model,
      skipped: true
    };
  }

  const chatRequest = buildChatCompletionRequest(settings, request);
  const aiTranslation = await executeChatCompletion(chatRequest.url, chatRequest.body, apiKey, settings);
  return {
    ...applyAiTranslationResult(request, aiTranslation, settings),
    skipped: false
  };
}

async function completeWithAi(request: AiCompleteRequest): Promise<string> {
  const settings = await loadStoredAiSettings();
  const apiKey = decryptApiKey(settings.encryptedApiKey);

  if (!apiKey) {
    throw new Error('请先在 AI 设置中保存 API Key。');
  }

  const chatRequest = buildGenericChatCompletionRequest(settings, request);
  return executeChatCompletion(chatRequest.url, chatRequest.body, apiKey, settings);
}

async function fillSheetCellWithAi(
  request: AiFillSheetCellRequest
): Promise<AiFillSheetCellResult> {
  return fillSheetCellsWithAi({ ...request, cellCount: 1 });
}

async function fillSheetCellsWithAi(
  request: AiFillSheetCellsRequest
): Promise<AiFillSheetCellResult> {
  const settings = await loadStoredAiSettings();
  const apiKey = decryptApiKey(settings.encryptedApiKey);

  if (!apiKey) {
    throw new Error('请先在 AI 设置中保存 API Key。');
  }

  const strategy = getPaperContextStrategy(settings);
  const normalizedSettings = normalizeAiProviderSettings(settings);

  if (strategy.mode === 'openai-pdf-input') {
    const contextResult = await getOpenAiPaperFileContext(normalizedSettings, apiKey, request.pdfPath);
    const prompt = mergeSheetCellPrompt(request, '');
    const responseRequest = buildOpenAiPdfResponseRequest(
      normalizedSettings,
      contextResult.fileId,
      prompt
    );
    const text = await executeOpenAiResponses(responseRequest.url, responseRequest.body, apiKey, normalizedSettings);

    return {
      text,
      provider: normalizedSettings.provider,
      model: normalizedSettings.model,
      mode: strategy.mode,
      cached: contextResult.cached
    };
  }

  let cached = false;
  let paperContext = request.fallbackContextText;

  if (strategy.mode === 'kimi-file-extract') {
    const contextResult = await getKimiPaperContext(normalizedSettings, apiKey, request.pdfPath);
    cached = contextResult.cached;
    paperContext = [contextResult.text, request.fallbackContextText].filter(Boolean).join('\n\n');
  } else {
    const contextResult = await getLocalPaperContext(request.pdfPath);
    cached = contextResult.cached;
    paperContext = [contextResult.text, request.fallbackContextText].filter(Boolean).join('\n\n');
  }

  const chatRequest = buildGenericChatCompletionRequest(normalizedSettings, {
    systemPrompt: request.systemPrompt,
    userPrompt: mergeSheetCellPrompt(request, paperContext)
  });
  const text = await executeChatCompletion(chatRequest.url, chatRequest.body, apiKey, normalizedSettings);

  return {
    text,
    provider: normalizedSettings.provider,
    model: normalizedSettings.model,
    mode: strategy.mode,
    cached
  };
}

async function analyzeLiteratureWithAi(
  request: AiAnalyzeLiteratureRequest
): Promise<AiAnalyzeLiteratureResult> {
  const settings = await loadStoredAiSettings();
  const apiKey = decryptApiKey(settings.encryptedApiKey);

  if (!apiKey) {
    throw new Error('请先在 AI 设置中保存 API Key。');
  }

  if (!request.papers.length) {
    throw new Error('请先在研究表格中选中至少一行已绑定论文的单元格。');
  }

  const strategy = getPaperContextStrategy(settings);
  const normalizedSettings = normalizeAiProviderSettings(settings);

  if (strategy.mode === 'openai-pdf-input') {
    const content: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_file'; file_id: string }
    > = [];
    let cachedContextCount = 0;

    for (const paper of request.papers) {
      if (!paper.pdfPath.trim()) {
        continue;
      }

      const contextResult = await getOpenAiPaperFileContext(normalizedSettings, apiKey, paper.pdfPath);
      if (contextResult.cached) {
        cachedContextCount += 1;
      }
      content.push({ type: 'input_file', file_id: contextResult.fileId });
    }

    content.push({
      type: 'input_text',
      text: mergeLiteratureInsightPrompt(request, await fetchAcademicWebContext(request))
    });

    const responseRequest = buildOpenAiResponsesRequest(normalizedSettings, content, {
      enableWebSearch: true
    });
    const text = await executeOpenAiResponses(
      responseRequest.url,
      responseRequest.body,
      apiKey,
      normalizedSettings
    );

    return {
      text,
      provider: normalizedSettings.provider,
      model: normalizedSettings.model,
      mode: strategy.mode,
      cachedContextCount,
      webSearchUsed: true
    };
  }

  let cachedContextCount = 0;
  const contexts: string[] = [];
  const webContext = await fetchAcademicWebContext(request);

  for (const paper of request.papers) {
    let extractedText = '';
    let cached = false;

    if (!paper.pdfPath.trim()) {
      extractedText = paper.fallbackContextText;
    } else if (strategy.mode === 'kimi-file-extract') {
      const contextResult = await getKimiPaperContext(normalizedSettings, apiKey, paper.pdfPath);
      extractedText = contextResult.text;
      cached = contextResult.cached;
    } else {
      const contextResult = await getLocalPaperContext(paper.pdfPath);
      extractedText = contextResult.text;
      cached = contextResult.cached;
    }

    if (cached) {
      cachedContextCount += 1;
    }

    contexts.push(
      [
        `【论文上下文 ${contexts.length + 1} / ${paper.paperId}】`,
        [extractedText, paper.fallbackContextText].filter(Boolean).join('\n\n').slice(0, 18000)
      ].join('\n')
    );
  }

  const chatRequest = buildGenericChatCompletionRequest(normalizedSettings, {
    systemPrompt: request.systemPrompt,
    userPrompt: mergeLiteratureInsightPrompt(request, [webContext, contexts.join('\n\n')].filter(Boolean).join('\n\n'))
  });
  const text = await executeChatCompletion(chatRequest.url, chatRequest.body, apiKey, normalizedSettings);

  return {
    text,
    provider: normalizedSettings.provider,
    model: normalizedSettings.model,
    mode: strategy.mode,
    cachedContextCount,
    webSearchUsed: Boolean(webContext)
  };
}

async function testAiConnection(): Promise<AiConnectionTestResult> {
  const settings = await loadStoredAiSettings();
  const apiKey = decryptApiKey(settings.encryptedApiKey);

  if (!apiKey) {
    throw new Error('请先在 AI 设置中保存 API Key。');
  }

  const chatRequest = buildChatCompletionRequest(settings, {
    section: 'Connection Test',
    original: 'Please reply with exactly: 连接成功',
    translation: '',
    type: 'paragraph'
  });
  const message = await executeChatCompletion(chatRequest.url, chatRequest.body, apiKey, settings);
  return {
    ok: true,
    message: message || '连接成功'
  };
}

async function getAiBalance(): Promise<AiBalanceView> {
  const settings = await loadStoredAiSettings();
  const balanceRequest = buildAiBalanceRequest(settings);

  if (!balanceRequest.supported || !balanceRequest.url) {
    return {
      supported: false,
      provider: settings.provider,
      message: balanceRequest.reason ?? '当前 Provider 不支持余额查询。'
    };
  }

  const apiKey = decryptApiKey(settings.encryptedApiKey);
  if (!apiKey) {
    throw new Error('请先在 AI 设置中保存 API Key。');
  }

  const response = await fetch(balanceRequest.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`余额查询失败：HTTP ${response.status} ${formatAiErrorBody(responseText)}`);
  }

  return {
    supported: true,
    provider: settings.provider,
    message: parseAiBalanceResponse(settings.provider, responseText),
    checkedAt: new Date().toISOString()
  };
}

async function getAiModels(): Promise<AiModelsView> {
  const settings = await loadStoredAiSettings();
  const modelsRequest = buildAiModelsRequest(settings);

  if (!modelsRequest.supported || !modelsRequest.url) {
    return {
      supported: false,
      provider: settings.provider,
      options: [],
      message: modelsRequest.reason ?? '当前 Provider 不支持模型列表刷新。'
    };
  }

  const apiKey = decryptApiKey(settings.encryptedApiKey);
  if (!apiKey) {
    throw new Error('请先在 AI 设置中保存 API Key。');
  }

  const response = await fetch(modelsRequest.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`模型列表刷新失败：HTTP ${response.status} ${formatAiErrorBody(responseText)}`);
  }

  const fallbackOptions = settings.provider === 'custom' ? [] : AI_PROVIDER_MODEL_OPTIONS[settings.provider];
  const options = mergeAiModelOptions(fallbackOptions, parseAiModelsResponse(responseText), settings.model);

  return {
    supported: true,
    provider: settings.provider,
    options,
    message: `已刷新 ${options.length} 个模型`,
    checkedAt: new Date().toISOString()
  };
}

async function executeChatCompletion(
  url: string,
  body: ReturnType<typeof buildChatCompletionRequest>['body'],
  apiKey: string,
  settings?: AiProviderSettings
): Promise<string> {
  const runtimeOptions = resolveAiRuntimeOptions(settings ?? {
    provider: 'custom',
    baseURL: url,
    model: body.model
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtimeOptions.timeoutSeconds * 1000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`AI 请求失败：HTTP ${response.status} ${formatAiErrorBody(responseText)}`);
  }

  const parsed = JSON.parse(responseText) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = parsed.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error('AI 响应中没有可用文本。');
  }

  return content;
}

async function executeOpenAiResponses(
  url: string,
  body: ReturnType<typeof buildOpenAiPdfDataResponseRequest>['body'],
  apiKey: string,
  settings?: AiProviderSettings
): Promise<string> {
  const runtimeOptions = resolveAiRuntimeOptions(settings ?? {
    provider: 'custom',
    baseURL: url,
    model: body.model
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtimeOptions.timeoutSeconds * 1000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`AI 请求失败：HTTP ${response.status} ${formatAiErrorBody(responseText)}`);
  }

  const parsed = JSON.parse(responseText) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };
  const directText = parsed.output_text?.trim();
  if (directText) {
    return directText;
  }

  const contentText = parsed.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? '')
    .join('')
    .trim();

  if (!contentText) {
    throw new Error('AI 响应中没有可用文本。');
  }

  return contentText;
}

function mergeSheetCellPrompt(request: AiFillSheetCellRequest, paperContext: string): string {
  if (!paperContext.trim()) {
    return request.userPrompt;
  }

  return [
    request.userPrompt,
    '',
    '补充论文全文/提取上下文：',
    paperContext.slice(0, 60000)
  ].join('\n');
}

function mergeLiteratureInsightPrompt(request: AiAnalyzeLiteratureRequest, paperContext: string): string {
  if (!paperContext.trim()) {
    return request.userPrompt;
  }

  return [
    request.userPrompt,
    '',
    '补充论文全文/提取上下文：',
    paperContext.slice(0, 90000)
  ].join('\n');
}

async function fetchAcademicWebContext(request: AiAnalyzeLiteratureRequest): Promise<string> {
  const queries = extractLiteratureSearchQueries(request.userPrompt);
  const results: string[] = [];

  for (const query of queries.slice(0, 3)) {
    try {
      const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
      url.searchParams.set('query', query);
      url.searchParams.set('limit', '4');
      url.searchParams.set('fields', 'title,year,abstract,url,authors');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'PDF Translation Reader literature insight' },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        continue;
      }

      const data = await response.json() as {
        data?: Array<{
          title?: string;
          year?: number;
          abstract?: string;
          url?: string;
          authors?: Array<{ name?: string }>;
        }>;
      };

      for (const item of data.data ?? []) {
        if (!item.title) {
          continue;
        }

        results.push([
          `Query: ${query}`,
          `Title: ${item.title}`,
          item.year ? `Year: ${item.year}` : '',
          item.authors?.length ? `Authors: ${item.authors.map((author) => author.name).filter(Boolean).slice(0, 6).join(', ')}` : '',
          item.url ? `URL: ${item.url}` : '',
          item.abstract ? `Abstract: ${item.abstract.slice(0, 900)}` : ''
        ].filter(Boolean).join('\n'));
      }
    } catch {
      // 联网查新是增强上下文，失败时保留本地论文分析流程，不阻断主任务。
    }
  }

  if (!results.length) {
    return '';
  }

  return [
    '公开网页/论文检索结果，用于排除重复 idea：',
    ...results.slice(0, 10)
  ].join('\n\n');
}

function extractLiteratureSearchQueries(prompt: string): string[] {
  const titleMatches = Array.from(prompt.matchAll(/英文标题[:：]\s*([^\n]+)/gu))
    .map((match) => match[1].trim())
    .filter((title) => title && !title.includes('未填写'));
  const asciiPhrases = Array.from(prompt.matchAll(/[A-Z][A-Za-z0-9:,\- ]{24,120}/gu))
    .map((match) => match[0].replace(/\s+/gu, ' ').trim())
    .filter((phrase) => phrase.split(/\s+/u).length >= 4);

  return Array.from(new Set([...titleMatches, ...asciiPhrases])).slice(0, 5);
}

async function getOpenAiPaperFileContext(
  settings: AiProviderSettings,
  apiKey: string,
  pdfPath: string
): Promise<{ fileId: string; cached: boolean }> {
  const stats = await fs.stat(pdfPath);
  const cacheKey = buildPaperContextCacheKey(settings.provider, pdfPath, stats);
  const cached = await readPaperContextCache(cacheKey);

  if (cached?.fileId) {
    return { fileId: cached.fileId, cached: true };
  }

  const fileId = await uploadOpenAiPdf(settings, apiKey, pdfPath);
  await writePaperContextCache({
    key: cacheKey,
    provider: settings.provider,
    pdfPath,
    fileSize: stats.size,
    mtimeMs: stats.mtimeMs,
    fileId,
    cachedAt: new Date().toISOString()
  });

  return { fileId, cached: false };
}

async function uploadOpenAiPdf(
  settings: AiProviderSettings,
  apiKey: string,
  pdfPath: string
): Promise<string> {
  const formData = new FormData();
  const buffer = await fs.readFile(pdfPath);

  formData.append('purpose', 'user_data');
  formData.append(
    'file',
    new Blob([buffer], { type: 'application/pdf' }),
    path.basename(pdfPath)
  );

  const response = await fetch(`${settings.baseURL.replace(/\/+$/u, '')}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`OpenAI PDF 上传失败：HTTP ${response.status} ${formatAiErrorBody(responseText)}`);
  }

  const parsed = JSON.parse(responseText) as { id?: string };
  if (!parsed.id) {
    throw new Error('OpenAI 文件上传响应中没有 file id。');
  }

  return parsed.id;
}

async function getKimiPaperContext(
  settings: AiProviderSettings,
  apiKey: string,
  pdfPath: string
): Promise<{ text: string; cached: boolean }> {
  const stats = await fs.stat(pdfPath);
  const cacheKey = buildPaperContextCacheKey(settings.provider, pdfPath, stats);
  const cached = await readPaperContextCache(cacheKey);

  if (cached?.extractedText) {
    return { text: cached.extractedText, cached: true };
  }

  const fileId = cached?.fileId ?? (await uploadKimiPdf(settings, apiKey, pdfPath));
  const extractRequest = buildKimiFileExtractRequest(settings, fileId);
  const response = await fetch(extractRequest.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Kimi 文件提取失败：HTTP ${response.status} ${formatAiErrorBody(responseText)}`);
  }

  const extractedText = parseProviderTextPayload(responseText);
  await writePaperContextCache({
    key: cacheKey,
    provider: settings.provider,
    pdfPath,
    fileSize: stats.size,
    mtimeMs: stats.mtimeMs,
    fileId,
    extractedText,
    cachedAt: new Date().toISOString()
  });

  return { text: extractedText, cached: false };
}

async function uploadKimiPdf(
  settings: AiProviderSettings,
  apiKey: string,
  pdfPath: string
): Promise<string> {
  const formData = new FormData();
  const buffer = await fs.readFile(pdfPath);

  formData.append('purpose', 'file-extract');
  formData.append(
    'file',
    new Blob([buffer], { type: 'application/pdf' }),
    path.basename(pdfPath)
  );

  const response = await fetch(`${settings.baseURL.replace(/\/+$/u, '')}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Kimi 文件上传失败：HTTP ${response.status} ${formatAiErrorBody(responseText)}`);
  }

  const parsed = JSON.parse(responseText) as {
    id?: string;
    data?: { id?: string };
  };
  const fileId = parsed.id ?? parsed.data?.id;

  if (!fileId) {
    throw new Error('Kimi 文件上传响应中没有 file id。');
  }

  return fileId;
}

async function getLocalPaperContext(pdfPath: string): Promise<{ text: string; cached: boolean }> {
  const stats = await fs.stat(pdfPath);
  const cacheKey = buildPaperContextCacheKey('custom', pdfPath, stats);
  const cached = await readPaperContextCache(cacheKey);

  if (cached?.extractedText) {
    return { text: cached.extractedText, cached: true };
  }

  const extractedText = await extractPdfTextLocally(pdfPath);
  await writePaperContextCache({
    key: cacheKey,
    provider: 'custom',
    pdfPath,
    fileSize: stats.size,
    mtimeMs: stats.mtimeMs,
    extractedText,
    cachedAt: new Date().toISOString()
  });

  return { text: extractedText, cached: false };
}

async function extractPdfTextLocally(pdfPath: string): Promise<string> {
  const pdfjs = (await Function('specifier', 'return import(specifier)')(
    'pdfjs-dist/legacy/build/pdf.mjs'
  )) as {
    getDocument: (options: { data: Uint8Array; disableWorker: boolean }) => {
      promise: Promise<{
        numPages: number;
        getPage: (pageNumber: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
        }>;
      }>;
    };
  };
  const buffer = await fs.readFile(pdfPath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => item.str ?? '')
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();

    if (pageText) {
      pages.push(`Page ${pageNumber}\n${pageText}`);
    }
  }

  return pages.join('\n\n');
}

function getPaperContextCachePath(): string {
  return path.join(app.getPath('userData'), 'paper-context-cache.json');
}

async function loadPaperContextCache(): Promise<Record<string, PaperContextCacheEntry>> {
  try {
    const content = await fs.readFile(getPaperContextCachePath(), 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? (parsed as Record<string, PaperContextCacheEntry>) : {};
  } catch {
    return {};
  }
}

async function readPaperContextCache(key: string): Promise<PaperContextCacheEntry | null> {
  const cache = await loadPaperContextCache();
  return cache[key] ?? null;
}

async function writePaperContextCache(entry: PaperContextCacheEntry): Promise<void> {
  const cache = await loadPaperContextCache();
  cache[entry.key] = entry;
  await fs.mkdir(path.dirname(getPaperContextCachePath()), { recursive: true });
  await fs.writeFile(getPaperContextCachePath(), JSON.stringify(cache, null, 2), 'utf8');
}

function buildPaperContextCacheKey(
  provider: AiProviderId,
  pdfPath: string,
  stats: { size: number; mtimeMs: number }
): string {
  return [
    provider,
    pdfPath,
    String(stats.size),
    String(Math.round(stats.mtimeMs))
  ].join('|');
}

function parseProviderTextPayload(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as unknown;
    if (!isRecord(parsed)) {
      return responseText;
    }

    const directText = readString(parsed.content) ?? readString(parsed.text);
    if (directText) {
      return directText;
    }

    if (isRecord(parsed.data)) {
      return readString(parsed.data.content) ?? readString(parsed.data.text) ?? responseText;
    }
  } catch {
    return responseText;
  }

  return responseText;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function formatAiErrorBody(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as {
      error?: {
        message?: string;
        type?: string;
        code?: string | number;
      };
    };
    const parts = [parsed.error?.message, parsed.error?.type, parsed.error?.code]
      .filter(Boolean)
      .map((part) => String(part));
    if (parts.length > 0) {
      return parts.join(' / ');
    }
  } catch {
    // 响应不是 JSON 时保留原始短文本，方便排查 provider 返回的错误。
  }

  return responseText.slice(0, 800);
}

function registerIpcHandlers(): void {
  ipcMain.handle('ai-settings:load', async () => {
    return toAiSettingsView(await loadStoredAiSettings());
  });

  ipcMain.handle('ai-settings:save', async (_event, request: AiSettingsRequest) => {
    return toAiSettingsView(await saveStoredAiSettings(request));
  });

  ipcMain.handle('ai:translate', async (_event, request: AiTranslationItem & { force?: boolean }) => {
    return translateWithAi(request);
  });

  ipcMain.handle('ai:complete', async (_event, request: AiCompleteRequest) => {
    return completeWithAi(request);
  });

  ipcMain.handle('ai:fill-sheet-cell', async (_event, request: AiFillSheetCellRequest) => {
    return fillSheetCellWithAi(request);
  });

  ipcMain.handle('ai:fill-sheet-cells', async (_event, request: AiFillSheetCellsRequest) => {
    return fillSheetCellsWithAi(request);
  });

  ipcMain.handle('ai:analyze-literature', async (_event, request: AiAnalyzeLiteratureRequest) => {
    return analyzeLiteratureWithAi(request);
  });

  ipcMain.handle('ai:test-connection', async () => {
    return testAiConnection();
  });

  ipcMain.handle('ai:balance', async () => {
    return getAiBalance();
  });

  ipcMain.handle('ai:models', async () => {
    return getAiModels();
  });

  ipcMain.handle('pdf-translation:check-engine', async () => {
    return checkPdfTranslationEngine();
  });

  ipcMain.handle('pdf-translation:translate', async (_event, request: PdfTranslationRequest) => {
    try {
      return await translatePdfWithSidecar(request);
    } catch (error) {
      sendPdfTranslationProgress({
        paperId: request.paperId,
        status: 'failed',
        message: formatPdfTranslationProgressMessage(
          sanitizePdfTranslationLog(error instanceof Error ? error.message : String(error), '')
        )
      });
      throw error;
    }
  });

  ipcMain.handle('dialog:open-pdf', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择英文原文 PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return readPdfFile(result.filePaths[0]);
  });

  ipcMain.handle('dialog:open-translation', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择翻译文件',
      properties: ['openFile'],
      filters: [
        { name: 'Translation Files', extensions: ['json', 'md', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return readTextFile(result.filePaths[0]);
  });

  ipcMain.handle('dialog:open-translated-pdf', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择已生成的中文/双语 PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return readPdfFile(result.filePaths[0]);
  });

  ipcMain.handle('project:load', async (_event, request: LoadProjectRequest) => {
    const errors: string[] = [];
    let pdf: PdfFilePayload | null = null;
    let translation: TextFilePayload | null = null;
    let aiCache: TextFilePayload | null = null;
    let translatedPdf: PdfFilePayload | null = null;
    let translatedMonoPdf: PdfFilePayload | null = null;

    if (request.pdfPath) {
      try {
        pdf = await readPdfFile(request.pdfPath);
      } catch (error) {
        errors.push(`无法读取 PDF：${request.pdfPath}，${String(error)}`);
      }
    }

    if (request.translationPath) {
      try {
        translation = await readTextFile(request.translationPath);
      } catch (error) {
        errors.push(`无法读取翻译文件：${request.translationPath}，${String(error)}`);
      }
    }

    if (request.aiCachePath) {
      try {
        aiCache = await readTextFile(request.aiCachePath);
      } catch (error) {
        errors.push(`无法读取 AI 缓存：${request.aiCachePath}，${String(error)}`);
      }
    }

    if (request.translatedPdfPath) {
      try {
        translatedPdf = await readPdfFile(request.translatedPdfPath);
      } catch (error) {
        errors.push(`无法读取双语 PDF：${request.translatedPdfPath}，${String(error)}`);
      }
    }

    if (request.translatedMonoPdfPath) {
      try {
        translatedMonoPdf = await readPdfFile(request.translatedMonoPdfPath);
      } catch (error) {
        errors.push(`无法读取中文 PDF：${request.translatedMonoPdfPath}，${String(error)}`);
      }
    }

    return { pdf, translation, aiCache, translatedPdf, translatedMonoPdf, errors };
  });

  ipcMain.handle('file:save-text', async (_event, request: SaveTextRequest) => {
    let targetPath = request.filePath;

    if (!targetPath) {
      const result = await dialog.showSaveDialog({
        title: '保存翻译文件',
        defaultPath: request.defaultFileName,
        filters: getTextFilters(request.extension)
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      targetPath = result.filePath;
    }

    await fs.writeFile(targetPath, request.content, 'utf8');
    return {
      filePath: targetPath,
      fileName: path.basename(targetPath)
    };
  });

  ipcMain.handle('file:save-translation-cache', async (_event, request: Omit<SaveTextRequest, 'extension'>) => {
    let targetPath = request.filePath;

    if (!targetPath) {
      const result = await dialog.showSaveDialog({
        title: '保存 AI 翻译缓存',
        defaultPath: request.defaultFileName,
        filters: [{ name: 'JSON Translation', extensions: ['json'] }]
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      targetPath = result.filePath;
    }

    await fs.writeFile(targetPath, request.content, 'utf8');
    return {
      filePath: targetPath,
      fileName: path.basename(targetPath)
    };
  });

  ipcMain.handle('file:export-markdown', async (_event, request: Omit<SaveTextRequest, 'extension'>) => {
    const result = await dialog.showSaveDialog({
      title: '导出双语 Markdown',
      defaultPath: request.filePath ?? request.defaultFileName,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    await fs.writeFile(result.filePath, request.content, 'utf8');
    return {
      filePath: result.filePath,
      fileName: path.basename(result.filePath)
    };
  });

  ipcMain.handle('file:export-pptx', async (_event, request: SaveBinaryRequest) => {
    const result = await dialog.showSaveDialog({
      title: '导出组会 PPT',
      defaultPath: request.filePath ?? request.defaultFileName,
      filters: [{ name: 'PowerPoint Presentation', extensions: ['pptx'] }]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const buffer = Buffer.from(request.contentBase64, 'base64');
    await fs.writeFile(result.filePath, buffer);
    return {
      filePath: result.filePath,
      fileName: path.basename(result.filePath)
    };
  });

  ipcMain.handle('file:export-pdf', async (_event, request: { sourcePath: string; defaultFileName: string }) => {
    if (!request.sourcePath || !(await pathExists(request.sourcePath))) {
      throw new Error('没有可导出的双语 PDF 文件。');
    }

    const result = await dialog.showSaveDialog({
      title: '导出双语 PDF',
      defaultPath: request.defaultFileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    await fs.copyFile(request.sourcePath, result.filePath);
    return {
      filePath: result.filePath,
      fileName: path.basename(result.filePath)
    };
  });

  ipcMain.handle('research-workbook:export-excel', async (_event, request: ResearchWorkbookExcelRequest) => {
    return exportResearchWorkbookToExcel(request);
  });

  ipcMain.handle('research-workbook:import-excel', async () => {
    return importResearchWorkbookFromExcel();
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  await createMainWindow();
  registerGlobalShortcut();
});

app.on('activate', () => {
  showMainWindow();
});

app.on('will-quit', () => {
  // 退出前释放全局快捷键，避免系统快捷键被残留占用。
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

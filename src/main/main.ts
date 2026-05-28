import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, safeStorage } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
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
  shouldTranslateItem,
  AI_PROVIDER_MODEL_OPTIONS,
  type AiProviderId,
  type AiProviderSettings,
  type AiModelOption,
  type AiTranslationItem
} from '../shared/aiTranslation';
import {
  buildKimiFileExtractRequest,
  buildOpenAiPdfDataResponseRequest,
  buildOpenAiPdfResponseRequest,
  getPaperContextStrategy,
  type PaperContextStrategyMode
} from '../shared/aiPaperContext';
import {
  buildPdf2zhCommand,
  buildPdfTranslationOutputPaths,
  buildPdfTranslationSourceHash,
  sanitizePdfTranslationLog,
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

interface LoadProjectRequest {
  pdfPath?: string;
  translationPath?: string;
  aiCachePath?: string;
  translatedPdfPath?: string;
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

interface AiFillSheetCellResult {
  text: string;
  provider: AiProviderId;
  model: string;
  mode: PaperContextStrategyMode;
  cached: boolean;
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
  message: string;
  installCommand: string;
}

interface PdfTranslationRequest {
  paperId: string;
  pdfPath: string;
  outputMode?: PdfTranslationOutputMode;
  force?: boolean;
}

interface PdfTranslationMetadata {
  translatedPdfPath: string;
  translatedPdfName: string;
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

async function translatePdfWithSidecar(request: PdfTranslationRequest): Promise<PdfTranslationResult> {
  if (!request.paperId.trim()) {
    throw new Error('缺少论文记录 ID，无法写入双语 PDF 缓存。');
  }

  if (!request.pdfPath.trim()) {
    throw new Error('缺少 PDF 路径。');
  }

  const engine = checkPdfTranslationEngine();
  if (!engine.available || !engine.executable) {
    throw new Error(engine.message);
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
    return {
      ...cachedMetadata,
      status: 'cached',
      message: '已复用本机缓存的双语 PDF。',
      pdf: await readPdfFile(cachedMetadata.translatedPdfPath)
    };
  }

  await fs.mkdir(outputDir, { recursive: true });
  sendPdfTranslationProgress({
    paperId: request.paperId,
    status: 'running',
    message: '正在调用 PDFMathTranslate 生成双语 PDF...'
  });

  const command = buildPdf2zhCommand({
    executable: engine.executable,
    pdfPath: request.pdfPath,
    outputDir,
    mode: outputMode,
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

  const metadata: PdfTranslationMetadata = {
    translatedPdfPath,
    translatedPdfName: path.basename(translatedPdfPath),
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
    pdf: await readPdfFile(translatedPdfPath)
  };
}

function checkPdfTranslationEngine(): PdfTranslationEngineView {
  const installCommand = 'uv tool install pdf2zh';
  const executable = findExecutableOnPath('pdf2zh') ?? findExecutableOnPath('pdf2zh_next');

  if (executable) {
    return {
      available: true,
      executable,
      message: `已找到 PDFMathTranslate 命令：${executable}`,
      installCommand
    };
  }

  const uvExecutable = findExecutableOnPath('uv');
  return {
    available: false,
    message: uvExecutable
      ? `未找到 PDFMathTranslate 命令。请先执行：${installCommand}`
      : `未找到 PDFMathTranslate 命令，也未找到 uv。请先安装 uv，再执行：${installCommand}`,
    installCommand
  };
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

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env
      },
      windowsHide: true
    });

    const handleChunk = (chunk: Buffer): void => {
      const message = sanitizePdfTranslationLog(chunk.toString('utf8'), options.apiKey).trim();
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
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`PDFMathTranslate 退出码 ${code}：${logs.join('\n').slice(-4000)}`));
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

    return {
      translatedPdfPath: parsed.translatedPdfPath,
      translatedPdfName: parsed.translatedPdfName || path.basename(parsed.translatedPdfPath),
      translatedPdfMode: parsed.translatedPdfMode === 'mono' ? 'mono' : 'dual',
      translationEngine: 'pdfmathtranslate',
      translationSourceHash: parsed.translationSourceHash,
      translatedAt: parsed.translatedAt || new Date().toISOString(),
      translatedProvider: parseProvider(parsed.translatedProvider) ?? 'custom',
      translatedModel: parsed.translatedModel || ''
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
    apiKeyConfigured: Boolean(settings.encryptedApiKey)
  };
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
  const aiTranslation = await executeChatCompletion(chatRequest.url, chatRequest.body, apiKey);
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
  return executeChatCompletion(chatRequest.url, chatRequest.body, apiKey);
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
    const text = await executeOpenAiResponses(responseRequest.url, responseRequest.body, apiKey);

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
  const text = await executeChatCompletion(chatRequest.url, chatRequest.body, apiKey);

  return {
    text,
    provider: normalizedSettings.provider,
    model: normalizedSettings.model,
    mode: strategy.mode,
    cached
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
  const message = await executeChatCompletion(chatRequest.url, chatRequest.body, apiKey);
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
  apiKey: string
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

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
  apiKey: string
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
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
        message: String(error)
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

    return { pdf, translation, aiCache, translatedPdf, errors };
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

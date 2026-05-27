import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AI_PROVIDER_PRESETS,
  applyAiTranslationResult,
  buildAiBalanceRequest,
  buildChatCompletionRequest,
  normalizeAiProviderSettings,
  parseAiBalanceResponse,
  shouldTranslateItem,
  type AiProviderId,
  type AiProviderSettings,
  type AiTranslationItem
} from '../shared/aiTranslation';

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

interface StoredAiSettings extends AiProviderSettings {
  encryptedApiKey?: string;
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

  ipcMain.handle('ai:test-connection', async () => {
    return testAiConnection();
  });

  ipcMain.handle('ai:balance', async () => {
    return getAiBalance();
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

  ipcMain.handle('project:load', async (_event, request: LoadProjectRequest) => {
    const errors: string[] = [];
    let pdf: PdfFilePayload | null = null;
    let translation: TextFilePayload | null = null;
    let aiCache: TextFilePayload | null = null;

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

    return { pdf, translation, aiCache, errors };
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

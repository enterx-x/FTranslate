import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

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
}

let mainWindow: BrowserWindow | null = null;

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

function registerIpcHandlers(): void {
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

    return { pdf, translation, errors };
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

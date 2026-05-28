import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const exe = path.join(root, 'dist', 'win-unpacked', 'PDF Translation Reader.exe');
const pdfPath =
  process.env.VISUAL_CHECK_PDF ??
  path.join('D:\\', 'GPT浏览器下载', '2604.15483v2.pdf');
const outputDir = path.join(root, '.tmp-visual-check');
const visualUserDataDir = path.join(outputDir, 'user-data');
const port = Number(process.env.VISUAL_CHECK_PORT ?? 9333);
const defaultPdfPath = path.join('D:\\', 'GPT浏览器下载', '2604.15483v2.pdf');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFallbackPdfBuffer() {
  return Buffer.from(
    `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 143 >>
stream
BT
/F1 24 Tf
72 760 Td
(PDF Translation Reader visual check fallback PDF) Tj
0 -36 Td
/F1 14 Tf
(This file is auto-generated when VISUAL_CHECK_PDF is not set and the default sample PDF is unavailable.) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000311 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
559
%%EOF
`,
    'ascii'
  );
}

async function resolveVisualCheckPdfPath() {
  const requestedPdfPath = process.env.VISUAL_CHECK_PDF?.trim();
  if (requestedPdfPath) {
    if (!existsSync(requestedPdfPath)) {
      throw new Error(`VISUAL_CHECK_PDF points to a missing file: ${requestedPdfPath}`);
    }
    return requestedPdfPath;
  }

  if (existsSync(defaultPdfPath)) {
    return defaultPdfPath;
  }

  const fallbackPdfPath = path.join(outputDir, 'visual-check-fallback.pdf');
  await writeFile(fallbackPdfPath, createFallbackPdfBuffer());
  return fallbackPdfPath;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
  }
  return response.json();
}

async function waitForWebSocketUrl() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const pages = await fetchJson(`http://127.0.0.1:${port}/json`);
      const page = pages.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (page) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      await wait(250);
    }
  }

  throw new Error('Timed out waiting for Electron debug endpoint.');
}

async function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const callbacks = new Map();
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && callbacks.has(payload.id)) {
      const { resolve, reject } = callbacks.get(payload.id);
      callbacks.delete(payload.id);
      payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result);
    }
  });

  return {
    send(method, params = {}) {
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => callbacks.set(id, { resolve, reject }));
    },
    close() {
      socket.close();
    }
  };
}

async function evaluateJson(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression: `JSON.stringify((${expression})())`,
    returnByValue: true
  });
  return JSON.parse(result.result.value);
}

async function waitForAppReady(client) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = await evaluateJson(client, `() => ({
      ready: Boolean(document.querySelector('.home-page, .split-layout, .research-sheet-page')),
      text: document.body.textContent ?? ''
    })`);
    if (snapshot.ready) {
      return;
    }
    await wait(250);
  }

  throw new Error('App did not render a known view.');
}

async function waitForResearchSheetCanvas(client) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = await evaluateJson(client, `() => {
      const canvases = [...document.querySelectorAll('.univer-container canvas')]
        .filter((canvas) => canvas.width > 0 && canvas.height > 0);
      const hasPaintedCanvas = canvases.some((canvas) => {
        const context = canvas.getContext('2d');
        if (!context) return false;

        const imageData = context.getImageData(
          0,
          0,
          Math.min(canvas.width, 700),
          Math.min(canvas.height, 260)
        ).data;
        let visiblePixelCount = 0;

        for (let index = 0; index < imageData.length; index += 4 * 37) {
          const red = imageData[index];
          const green = imageData[index + 1];
          const blue = imageData[index + 2];
          const alpha = imageData[index + 3];
          if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
            visiblePixelCount += 1;
          }
          if (visiblePixelCount > 30) {
            return true;
          }
        }

        return false;
      });

      return { canvasCount: canvases.length, hasPaintedCanvas };
    }`);

    if (snapshot.hasPaintedCanvas) {
      return snapshot;
    }

    await wait(250);
  }

  const snapshot = await evaluateJson(client, `() => ({
    hasResearchPage: Boolean(document.querySelector('.research-sheet-page')),
    hasContainer: Boolean(document.querySelector('.univer-container')),
    canvasCount: document.querySelectorAll('.univer-container canvas').length,
    text: document.body.textContent?.slice(0, 1000) ?? ''
  })`);
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'research-sheet-canvas-timeout.png'), Buffer.from(shot.data, 'base64'))
  );
  throw new Error(`Research sheet canvas did not paint visible grid content: ${JSON.stringify(snapshot)}`);
}

async function waitForPdfCanvas(client) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = await evaluateJson(client, `() => ({
      hasCanvas: [...document.querySelectorAll('.pdf-js-viewer-container canvas')]
        .some((canvas) => canvas.width > 0 && canvas.height > 0),
      canvasCount: document.querySelectorAll('.pdf-js-viewer-container canvas').length,
      text: document.querySelector('.whole-pdf-panel')?.textContent ?? ''
    })`);

    if (snapshot.hasCanvas) {
      return snapshot;
    }

    await wait(250);
  }

  const snapshot = await evaluateJson(client, `() => ({
    hasCanvas: Boolean(document.querySelector('.pdf-js-viewer-container canvas')),
    canvasCount: document.querySelectorAll('.pdf-js-viewer-container canvas').length,
    pdfText: document.querySelector('.pdf-pane')?.textContent?.slice(0, 500) ?? '',
    panelText: document.querySelector('.whole-pdf-panel')?.textContent ?? ''
  })`);
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-canvas-timeout.png'), Buffer.from(shot.data, 'base64'))
  );
  throw new Error(`wholePdf: PDF canvas did not render: ${JSON.stringify(snapshot)}`);
}

async function clickButtonByText(client, text) {
  const clicked = await evaluateJson(client, `() => {
    const needle = ${JSON.stringify(text)};
    const button = [...document.querySelectorAll('button')]
      .find((item) =>
        (item.textContent ?? '').trim() === needle ||
        item.getAttribute('aria-label') === needle ||
        item.getAttribute('title') === needle
      );
    button?.click();
    return Boolean(button);
  }`);
  if (!clicked) {
    throw new Error(`Button not found: ${text}`);
  }
  await wait(700);
}

async function rightClickResearchSheetCanvas(client) {
  const rect = await evaluateJson(client, `() => {
    const canvas = [...document.querySelectorAll('.univer-container canvas')]
      .find((item) => item.getBoundingClientRect().width > 200 && item.getBoundingClientRect().height > 120);
    const fallback = document.querySelector('.univer-container');
    const target = canvas ?? fallback;
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + Math.min(180, rect.width * 0.35),
      y: rect.top + Math.min(120, rect.height * 0.35)
    };
  }`);

  if (!rect) {
    throw new Error('researchSheet: cannot find Univer canvas for right click.');
  }

  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.x,
    y: rect.y,
    button: 'right',
    buttons: 2,
    clickCount: 1
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.x,
    y: rect.y,
    button: 'right',
    buttons: 0,
    clickCount: 1
  });
  await wait(500);
}

async function loadPaperRecord(client, translationPath, extraPaperFields = {}) {
  const paper = {
    id: 'visual-check-paper',
    pdfPath,
    pdfName: path.basename(pdfPath),
    translationPath,
    translationName: path.basename(translationPath),
    chineseTitle: '视觉检查论文',
    englishTitle: 'Visual Check Paper',
    journal: 'arXiv',
    authors: 'Visual Check',
    year: '2026',
    notes: '用于检查研究表格和透明图标。',
    lastOpenedAt: new Date().toISOString(),
    lastPage: 1,
    ...extraPaperFields
  };

  await client.send('Runtime.evaluate', {
    expression: `
      localStorage.setItem('pdfTranslationReader:paperLibrary', ${JSON.stringify(JSON.stringify([paper]))});
      localStorage.removeItem('pdfTranslationReader:researchWorkbook');
      localStorage.removeItem('pdfTranslationReader:researchSheetLinks');
      location.reload();
    `
  });
  await wait(1500);
}

async function runHomeScenario(client) {
  const hub = await evaluateJson(client, `() => ({
    hasHome: Boolean(document.querySelector('.home-page')),
    hasModuleGrid: Boolean(document.querySelector('.home-module-grid')),
    hasPaperTable: Boolean(document.querySelector('.paper-table')),
    moduleTitles: [...document.querySelectorAll('.home-module-card h2')].map((item) => item.textContent?.trim()),
    headerActions: [...document.querySelectorAll('.home-header-actions button')].map((button) => button.textContent?.trim()),
    markStyle: (() => {
      const mark = document.querySelector('.home-header-mark');
      if (!mark) return null;
      const style = getComputedStyle(mark);
      return { background: style.backgroundColor, border: style.borderTopWidth, boxShadow: style.boxShadow, borderRadius: style.borderRadius };
    })(),
    imageAlpha: (() => {
      const img = document.querySelector('.home-header-mark');
      if (!img || !img.complete) return null;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return [
        ctx.getImageData(0, 0, 1, 1).data[3],
        ctx.getImageData(canvas.width - 1, 0, 1, 1).data[3],
        ctx.getImageData(0, canvas.height - 1, 1, 1).data[3],
        ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data[3]
      ];
    })()
  })`);

  if (!hub.hasHome || !hub.hasModuleGrid || hub.hasPaperTable) {
    throw new Error(`home: expected module hub before entering a module, got ${JSON.stringify(hub)}`);
  }
  if (!hub.moduleTitles.includes('研究表格') || !hub.moduleTitles.includes('论文库')) {
    throw new Error(`home: expected peer module cards, got ${JSON.stringify(hub.moduleTitles)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'home.png'), Buffer.from(shot.data, 'base64'))
  );

  await clickButtonByText(client, '进入论文库');
  const library = await evaluateJson(client, `() => ({
    hasHome: Boolean(document.querySelector('.home-page')),
    hasAgGrid: Boolean(document.querySelector('.ag-root, .paper-grid')),
    hasPaperTable: Boolean(document.querySelector('.paper-table')),
    visibleInputs: document.querySelectorAll('.paper-table tbody input').length,
    headerText: document.querySelector('.paper-table thead')?.textContent ?? '',
    headerActions: [...document.querySelectorAll('.home-header-actions button')].map((button) => button.textContent?.trim()),
    markStyle: (() => {
      const mark = document.querySelector('.home-header-mark');
      if (!mark) return null;
      const style = getComputedStyle(mark);
      return { background: style.backgroundColor, border: style.borderTopWidth, boxShadow: style.boxShadow, borderRadius: style.borderRadius };
    })(),
    imageAlpha: (() => {
      const img = document.querySelector('.home-header-mark');
      if (!img || !img.complete) return null;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return [
        ctx.getImageData(0, 0, 1, 1).data[3],
        ctx.getImageData(canvas.width - 1, 0, 1, 1).data[3],
        ctx.getImageData(0, canvas.height - 1, 1, 1).data[3],
        ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data[3]
      ];
    })()
  })`);

  if (!library.hasHome || !library.hasPaperTable) {
    throw new Error(`home: expected lightweight paper table after entering paper library, got ${JSON.stringify(library)}`);
  }
  if (library.visibleInputs !== 0) {
    throw new Error(`home: expected read-only table outside edit mode, got ${library.visibleInputs} visible inputs`);
  }
  if (library.hasAgGrid || /创新点|局限点|复现计划|后续/.test(library.headerText)) {
    throw new Error(`home: paper library should not contain research spreadsheet columns, got ${library.headerText}`);
  }
  if (!library.headerActions.includes('研究表格') || !library.headerActions.includes('返回主页')) {
    throw new Error(`home: expected research sheet and home entries, got ${JSON.stringify(library.headerActions)}`);
  }
  if (!hub.imageAlpha || hub.imageAlpha.some((alpha) => alpha !== 0)) {
    throw new Error(`home: expected transparent icon corners, got ${JSON.stringify(hub.imageAlpha)}`);
  }
  if (
    hub.markStyle?.background !== 'rgba(0, 0, 0, 0)' ||
    hub.markStyle?.border !== '0px' ||
    hub.markStyle?.boxShadow !== 'none'
  ) {
    throw new Error(`home: expected no icon wrapper background/border/shadow, got ${JSON.stringify(hub.markStyle)}`);
  }

  await clickButtonByText(client, '返回主页');
  return { hub, library };
}

async function runResearchSheetScenario(client) {
  await clickButtonByText(client, '打开研究表格');
  await waitForAppReady(client);
  const canvasStatus = await waitForResearchSheetCanvas(client);
  await rightClickResearchSheetCanvas(client);

  const snapshot = await evaluateJson(client, `() => ({
    hasResearchSheet: Boolean(document.querySelector('.research-sheet-page')),
    hasUniver: Boolean(document.querySelector('.univer-container')),
    commandText: document.querySelector('.research-command-bar')?.textContent ?? '',
    hasAiButton: [...document.querySelectorAll('button')].some((button) => /AI 填(此单元格|选区)/.test(button.textContent ?? '')),
    hasBindingToggle: [...document.querySelectorAll('button')].some((button) => /绑定|解除绑定|更新绑定/.test(button.textContent ?? '')),
    formatToolbarText: document.querySelector('.research-format-toolbar')?.textContent ?? '',
    formatToolbarTitles: [...document.querySelectorAll('.research-format-toolbar button')]
      .map((button) => button.getAttribute('title') || button.getAttribute('aria-label') || (button.textContent ?? '').trim()),
    contextMenuText: document.body.textContent ?? '',
    titleText: document.querySelector('.research-sheet-header')?.textContent ?? '',
    headerActionTitles: [...document.querySelectorAll('.research-sheet-actions button')]
      .map((button) => button.getAttribute('title') || button.getAttribute('aria-label') || (button.textContent ?? '').trim()),
    markStyle: (() => {
      const mark = document.querySelector('.research-sheet-title img');
      if (!mark) return null;
      const style = getComputedStyle(mark);
      return { background: style.backgroundColor, border: style.borderTopWidth, boxShadow: style.boxShadow };
    })(),
    canvasStatus: ${JSON.stringify(canvasStatus)}
  })`);

  if (!snapshot.hasResearchSheet || !snapshot.hasUniver || !snapshot.hasAiButton) {
    throw new Error(`researchSheet: expected Univer surface and cell AI action, got ${JSON.stringify(snapshot)}`);
  }
  if (
    !snapshot.hasBindingToggle ||
    !/字号/.test(snapshot.formatToolbarText) ||
    !snapshot.formatToolbarTitles.includes('水平居中') ||
    !snapshot.formatToolbarTitles.includes('复制格式') ||
    !snapshot.formatToolbarTitles.some((title) => title === '加粗' || title === '取消加粗') ||
    !snapshot.formatToolbarTitles.some((title) => title === '斜体' || title === '取消斜体')
  ) {
    throw new Error(`researchSheet: expected binding and formatting toolbar controls, got ${JSON.stringify(snapshot)}`);
  }
  if (!/AI 填充选区/.test(snapshot.contextMenuText) || !/绑定\/解除当前行论文/.test(snapshot.contextMenuText) || !/粘贴格式到选区/.test(snapshot.contextMenuText)) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'research-sheet-menu-debug.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(
      `researchSheet: expected FTranslate actions inside native Univer context menu, got text: ${snapshot.contextMenuText.slice(0, 1000)}`
    );
  }
  if (
    !snapshot.commandText.includes('绑定论文到当前行') ||
    !snapshot.titleText.includes('研究表格') ||
    !snapshot.headerActionTitles.includes('导入 Excel') ||
    !snapshot.headerActionTitles.includes('导出 Excel')
  ) {
    throw new Error(`researchSheet: expected independent sheet controls, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.markStyle?.background !== 'rgba(0, 0, 0, 0)' || snapshot.markStyle?.border !== '0px') {
    throw new Error(`researchSheet: expected transparent icon without wrapper, got ${JSON.stringify(snapshot.markStyle)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'research-sheet.png'), Buffer.from(shot.data, 'base64'))
  );
  return snapshot;
}

async function runWholePdfReaderScenario(client) {
  await clickButtonByText(client, '返回主页');
  await waitForAppReady(client);
  await clickButtonByText(client, '进入论文库');
  await clickButtonByText(client, '打开阅读');
  await waitForAppReady(client);
  const pdfCanvasStatus = await waitForPdfCanvas(client);

  const wholePdf = await evaluateJson(client, `() => ({
    hasPanel: Boolean(document.querySelector('.whole-pdf-panel')),
    panelText: document.querySelector('.whole-pdf-panel')?.textContent ?? '',
    activeToggle: [...document.querySelectorAll('.pdf-view-toggle button')]
      .find((button) => button.classList.contains('active'))?.textContent?.trim() ?? '',
    hasPdfCanvas: ${JSON.stringify(pdfCanvasStatus.hasCanvas)},
    pdfCanvasCount: ${JSON.stringify(pdfCanvasStatus.canvasCount)},
    hasGenerateButton: [...document.querySelectorAll('.whole-pdf-panel button')]
      .some((button) => /生成双语 PDF/.test(button.textContent ?? '')),
    hasImportButton: [...document.querySelectorAll('.whole-pdf-panel button')]
      .some((button) => /导入中文\\/双语 PDF/.test(button.textContent ?? ''))
  })`);

  if (!wholePdf.hasPanel || wholePdf.activeToggle !== '双语 PDF' || !wholePdf.hasPdfCanvas || !wholePdf.hasGenerateButton || !wholePdf.hasImportButton) {
    throw new Error(`wholePdf: expected translated PDF as primary reading surface, got ${JSON.stringify(wholePdf)}`);
  }

  const legacyPanels = await evaluateJson(client, `() => ({
    hasModeTabs: Boolean(document.querySelector('.mode-tabs')),
    hasManualPanel: Boolean(document.querySelector('.translation-panel')),
    hasAiPanel: Boolean(document.querySelector('.ai-mode-panel')),
    hasSegmentCards: Boolean(document.querySelector('.ai-current-detail-card, .ai-translation-workbench, .original-card, .translation-card')),
    toolbarText: document.querySelector('.toolbar')?.textContent ?? ''
  })`);

  if (
    legacyPanels.hasModeTabs ||
    legacyPanels.hasManualPanel ||
    legacyPanels.hasAiPanel ||
    legacyPanels.hasSegmentCards ||
    /打开翻译文件|保存翻译|导出双语 Markdown/.test(legacyPanels.toolbarText)
  ) {
    throw new Error(`wholePdf: legacy segment translation UI should be hidden, got ${JSON.stringify(legacyPanels)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-reader.png'), Buffer.from(shot.data, 'base64'))
  );
  return { wholePdf, legacyPanels };
}

async function main() {
  if (!existsSync(exe)) {
    throw new Error(`Packaged executable not found. Run npm run dist first: ${exe}`);
  }

  await mkdir(outputDir, { recursive: true });
  await rm(visualUserDataDir, { recursive: true, force: true });
  await mkdir(visualUserDataDir, { recursive: true });
  const pdfPath = await resolveVisualCheckPdfPath();

  const translationPath = path.join(outputDir, 'visual-check.json');
  await writeFile(
    translationPath,
    `${JSON.stringify(
      [
        {
          section: 'Abstract',
          original: 'Foundation models work on the principle that generalist capabilities emerge from training on large and diverse datasets.',
          translation: ''
        }
      ],
      null,
      2
    )}\n`,
    'utf8'
  );

  const appProcess = spawn(exe, [`--remote-debugging-port=${port}`], {
    env: {
      ...process.env,
      PDF_TRANSLATION_READER_USER_DATA_DIR: visualUserDataDir
    },
    windowsHide: true,
    stdio: 'ignore'
  });

  try {
    const client = await createCdpClient(await waitForWebSocketUrl());
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await loadPaperRecord(client, translationPath, {
      translatedPdfPath: pdfPath,
      translatedPdfName: 'visual-check-dual.pdf',
      translatedPdfMode: 'dual',
      translationEngine: 'pdfmathtranslate',
      translationSourceHash: 'visual-check-source',
      translatedAt: new Date().toISOString(),
      translatedProvider: 'kimi',
      translatedModel: 'kimi-k2.5'
    });
    await waitForAppReady(client);

    const home = await runHomeScenario(client);
    const researchSheet = await runResearchSheetScenario(client);
    const wholePdfReader = await runWholePdfReaderScenario(client);
    client.close();
    console.log(JSON.stringify({ pdfPath, home, researchSheet, wholePdfReader, outputDir }, null, 2));
  } finally {
    appProcess.kill();
    await wait(500);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

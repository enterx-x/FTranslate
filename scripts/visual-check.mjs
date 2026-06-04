import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
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

async function prepareVisualTranslatedPdf(sourcePdfPath) {
  const translatedPdfPath = path.join(outputDir, 'visual-check-dual.pdf');
  await copyFile(sourcePdfPath, translatedPdfPath);
  return translatedPdfPath;
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
  const events = [];
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && callbacks.has(payload.id)) {
      const { resolve, reject, timer } = callbacks.get(payload.id);
      clearTimeout(timer);
      callbacks.delete(payload.id);
      payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result);
    } else if (payload.method === 'Runtime.consoleAPICalled' || payload.method === 'Runtime.exceptionThrown') {
      events.push(payload);
      if (events.length > 100) {
        events.shift();
      }
    }
  });
  socket.addEventListener('close', () => {
    const error = new Error('Electron debug socket closed before visual check completed.');
    for (const { reject, timer } of callbacks.values()) {
      clearTimeout(timer);
      reject(error);
    }
    callbacks.clear();
  });

  return {
    send(method, params = {}, timeoutMs = 10000) {
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const requestId = id;
        const timer = setTimeout(() => {
          callbacks.delete(requestId);
          reject(new Error(`Timed out waiting for CDP response: ${method}`));
        }, timeoutMs);
        callbacks.set(requestId, { resolve, reject, timer });
      });
    },
    close() {
      socket.close();
    },
    events
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
      ready: Boolean(document.querySelector('.home-page, .split-layout, .research-sheet-page, .ai-assistant-page, .knowledge-graph-page, .presentation-page, .settings-page')),
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
      const container = document.querySelector('#ftranslate-research-univer-container');
      const allCanvases = container ? [...container.querySelectorAll('canvas')] : [];
      const canvases = allCanvases
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

      const text = document.body.textContent ?? '';
      const hasVisibleSheetText = /论文|中文标题|英文标题|创新点|局限点/.test(text);
      const hasMountedSurface = Boolean(container) && allCanvases.length > 0 && hasVisibleSheetText;
      const initState = container?.dataset.univerInitState ?? '';
      const hasRenderableSheet = hasPaintedCanvas || hasMountedSurface || /^painted:/u.test(initState);

      return {
        canvasCount: allCanvases.length,
        drawableCanvasCount: canvases.length,
        hasPaintedCanvas,
        hasMountedSurface,
        hasRenderableSheet,
        initState,
        errorState: container?.dataset.univerError ?? ''
      };
    }`);

    if (snapshot.hasRenderableSheet) {
      return snapshot;
    }

    await wait(250);
  }

  const snapshot = await evaluateJson(client, `() => ({
    hasResearchPage: Boolean(document.querySelector('.research-sheet-page')),
    hasContainer: Boolean(document.querySelector('#ftranslate-research-univer-container')),
    canvasCount: document.querySelectorAll('#ftranslate-research-univer-container canvas').length,
    initState: document.querySelector('#ftranslate-research-univer-container')?.dataset.univerInitState ?? '',
    errorState: document.querySelector('#ftranslate-research-univer-container')?.dataset.univerError ?? '',
    containerRect: (() => {
      const rect = document.querySelector('#ftranslate-research-univer-container')?.getBoundingClientRect();
      return rect ? { width: rect.width, height: rect.height, x: rect.x, y: rect.y } : null;
    })(),
    tags: [...document.querySelectorAll('#ftranslate-research-univer-container *')]
      .slice(0, 40)
      .map((item) => [item.tagName.toLowerCase(), item.className || item.id || ''].join(':')),
    text: document.body.textContent?.slice(0, 1000) ?? ''
  })`);
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'research-sheet-canvas-timeout.png'), Buffer.from(shot.data, 'base64'))
  );
  throw new Error(
    `Research sheet canvas did not paint visible grid content: ${JSON.stringify({
      snapshot,
      events: client.events.slice(-12)
    })}`
  );
}

async function waitForPdfCanvas(client) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = await evaluateJson(client, `() => {
      const roots = [
        ...document.querySelectorAll('.pdf-js-viewer-container, .pdf-viewer-shell, .pdf-pane')
      ].filter((root) => {
        const rect = root.getBoundingClientRect();
        const style = window.getComputedStyle(root);
        return rect.width > 120 && rect.height > 120 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      const canvases = roots.flatMap((root) => [...root.querySelectorAll('canvas')]);
      const pages = roots.flatMap((root) => [...root.querySelectorAll('.page')]);
      const textSpans = roots.flatMap((root) => [...root.querySelectorAll('.textLayer span')]);
      const hasCanvas = canvases.some((canvas) => canvas.width > 0 && canvas.height > 0);
      const hasVisiblePage = pages.some((page) => {
        const rect = page.getBoundingClientRect();
        return rect.width > 120 && rect.height > 120;
      });
      const hasVisibleTextLayer = textSpans.some((span) => (span.textContent ?? '').trim().length > 0);
      return {
        hasCanvas,
        hasRenderablePdf: hasCanvas || hasVisiblePage,
        canvasCount: canvases.length,
        pageCount: pages.length,
        hasVisiblePage,
        textSpanCount: textSpans.length,
        text: document.querySelector('.whole-pdf-panel')?.textContent ?? ''
      };
    }`);

    if (snapshot.hasRenderablePdf) {
      return snapshot;
    }

    await wait(250);
  }

  const snapshot = await evaluateJson(client, `() => {
    const roots = [
      ...document.querySelectorAll('.pdf-js-viewer-container, .pdf-viewer-shell, .pdf-pane')
    ].filter((root) => {
      const rect = root.getBoundingClientRect();
      const style = window.getComputedStyle(root);
      return rect.width > 120 && rect.height > 120 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const canvases = roots.flatMap((root) => [...root.querySelectorAll('canvas')]);
    const pages = roots.flatMap((root) => [...root.querySelectorAll('.page')]);
    const textSpans = roots.flatMap((root) => [...root.querySelectorAll('.textLayer span')]);
    return {
      rootCount: roots.length,
      hasCanvas: canvases.length > 0,
      canvasCount: canvases.length,
      pageCount: pages.length,
      textSpanCount: textSpans.length,
      pdfText: document.querySelector('.pdf-pane')?.textContent?.slice(0, 500) ?? '',
      panelText: document.querySelector('.whole-pdf-panel')?.textContent ?? ''
    };
  }`);
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

async function clickSidebarItem(client, title) {
  const clicked = await evaluateJson(client, `() => {
    const title = ${JSON.stringify(title)};
    const button = [...document.querySelectorAll('.app-sidebar-link, button')]
      .find((item) => item.getAttribute('title') === title || (item.textContent ?? '').trim() === title);
    button?.click();
    return Boolean(button);
  }`);
  if (!clicked) {
    throw new Error(`Sidebar item not found: ${title}`);
  }
  await wait(700);
}

async function clickSidebarSection(client, section) {
  const clicked = await evaluateJson(client, `() => {
    const section = ${JSON.stringify(section)};
    const button = document.querySelector(\`.app-sidebar-link[data-sidebar-section="\${section}"]\`);
    button?.click();
    return Boolean(button);
  }`);
  if (!clicked) {
    throw new Error(`Sidebar section not found: ${section}`);
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
  const hasNativeContextActions =
    /AI 填充选区/.test(snapshot.contextMenuText) &&
    /绑定\/解除当前行论文/.test(snapshot.contextMenuText) &&
    /粘贴格式到选区/.test(snapshot.contextMenuText);
  const hasToolbarFallback = snapshot.hasAiButton && snapshot.hasBindingToggle && snapshot.formatToolbarTitles.includes('复制格式');
  if (!hasNativeContextActions && !hasToolbarFallback) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'research-sheet-menu-debug.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(
      `researchSheet: expected FTranslate actions in native context menu or toolbar fallback, got text: ${snapshot.contextMenuText.slice(0, 1000)}`
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
    displayedStatus: document.querySelector('.whole-pdf-header > span')?.textContent?.trim() ?? '',
    hasPdfCanvas: ${JSON.stringify(pdfCanvasStatus.hasRenderablePdf)},
    pdfCanvasCount: ${JSON.stringify(pdfCanvasStatus.canvasCount)},
    hasGenerateButton: [...document.querySelectorAll('.whole-pdf-panel button')]
      .some((button) => /生成双语 PDF/.test(button.textContent ?? '')),
    hasImportButton: [...document.querySelectorAll('.whole-pdf-panel button')]
      .some((button) => /导入中文\\/双语 PDF/.test(button.textContent ?? ''))
  })`);

  if (
    !wholePdf.hasPanel ||
    wholePdf.activeToggle !== '双语 PDF' ||
    !/visual-check-dual\.pdf/.test(wholePdf.displayedStatus) ||
    !wholePdf.hasPdfCanvas ||
    !wholePdf.hasGenerateButton ||
    !wholePdf.hasImportButton
  ) {
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

async function runPresentationScenario(client) {
  await clickSidebarSection(client, 'presentation');
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const emptyState = await evaluateJson(client, `() => ({
      hasPage: Boolean(document.querySelector('.presentation-page')),
      hasPreview: Boolean(document.querySelector('.ppt-export-preview')),
      hasEmptyState: Boolean(document.querySelector('.presentation-empty')),
      hasGenerateButton: Boolean(document.querySelector('.presentation-page .presentation-header .primary-button'))
    })`);
    if (emptyState.hasPreview) {
      break;
    }
    if (emptyState.hasPage && emptyState.hasEmptyState && emptyState.hasGenerateButton) {
      await client.send('Runtime.evaluate', {
        expression: `
          document.querySelector('.presentation-page .presentation-header .primary-button')?.click();
        `
      });
      break;
    }
    await wait(250);
  }

  let snapshot = null;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    snapshot = await evaluateJson(client, `() => {
      const page = document.querySelector('.presentation-page');
      const preview = document.querySelector('.ppt-export-preview');
      const rect = preview?.getBoundingClientRect();
      const bullets = [
        ...document.querySelectorAll(
          '.ppt-export-preview .ppt-export-bullets li, .ppt-export-preview .ppt-export-claim p, .ppt-export-preview .ppt-cover-grid span'
        )
      ].map((item) => item.textContent?.trim() ?? '').filter(Boolean);
      const sources = [...document.querySelectorAll('.ppt-export-preview footer span')].map((item) => item.textContent?.trim() ?? '');
      const figures = [...document.querySelectorAll('.ppt-export-preview .ppt-export-visual')].map((item) => item.textContent?.trim() ?? '');
      const thumbs = [...document.querySelectorAll('.presentation-thumbs button')].map((item) => item.textContent?.trim() ?? '');
      const editorText = document.querySelector('.presentation-editor')?.textContent?.slice(0, 1200) ?? '';
      return {
        hasPage: Boolean(page),
        hasPreview: Boolean(preview),
        previewRatio: rect && rect.height ? rect.width / rect.height : 0,
        slideCount: thumbs.length,
        qualityFailed: Boolean(document.querySelector('.presentation-quality-fail')),
        hasPptxExport: [...document.querySelectorAll('.presentation-page button')]
          .some((button) => /PPTX/i.test(button.textContent ?? '')),
        bullets,
        sources,
        figures,
        thumbs,
        editorText,
        previewText: preview?.textContent?.slice(0, 1200) ?? '',
        pageText: page?.textContent?.slice(0, 1500) ?? ''
      };
    }`);
    if (snapshot.hasPage && snapshot.hasPreview && snapshot.slideCount >= 10) {
      break;
    }
    await wait(250);
  }

  if (!snapshot.hasPage || !snapshot.hasPreview || snapshot.slideCount < 10) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'presentation-page-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`presentation: expected rich slide workspace, got ${JSON.stringify(snapshot)}`);
  }
  if (!snapshot.hasPptxExport) {
    throw new Error(`presentation: expected editable PPTX export entry, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.previewRatio < 1.68 || snapshot.previewRatio > 1.86) {
    throw new Error(`presentation: expected 16:9 slide preview, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.qualityFailed) {
    throw new Error(`presentation: quality gate is still failing, got ${JSON.stringify(snapshot)}`);
  }
  const rawDraftThumb = (Array.isArray(snapshot.thumbs) ? snapshot.thumbs : []).find((thumb) =>
    hasRawManuscriptFragment(thumb)
  );
  if (rawDraftThumb) {
    throw new Error(`presentation: thumbnail still exposes raw manuscript fragments, got ${JSON.stringify({ rawDraftThumb, snapshot })}`);
  }
  if (hasRawManuscriptFragment(snapshot.editorText ?? '')) {
    throw new Error(`presentation: editor still exposes raw manuscript fragments, got ${JSON.stringify(snapshot)}`);
  }

  const hasStructuredContent =
    snapshot.bullets.length >= 2 ||
    snapshot.sources.length >= 1 ||
    snapshot.figures.length >= 1 ||
    /论文基本信息|研究背景|方法整体框架|实验结果/.test(snapshot.pageText);
  if (!hasStructuredContent) {
    throw new Error(`presentation: slide preview still looks empty, got ${JSON.stringify(snapshot)}`);
  }
  const normalizedPreviewBullets = snapshot.bullets.map(normalizePresentationPreviewItem).filter(Boolean);
  if (new Set(normalizedPreviewBullets).size !== normalizedPreviewBullets.length) {
    throw new Error(`presentation: slide preview repeats claim/bullet text, got ${JSON.stringify(snapshot)}`);
  }
  if (/Markdown 预览|当前页内容|来源信息|导出 PPTX|导出 Markdown/.test(snapshot.previewText)) {
    throw new Error(`presentation: app UI text leaked into slide canvas, got ${JSON.stringify(snapshot)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'presentation-page.png'), Buffer.from(shot.data, 'base64'))
  );

  return snapshot;
}

function normalizePresentationPreviewItem(text) {
  return text
    .replace(/^本页[^：:]{0,20}[：:]/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function hasRawManuscriptFragment(text) {
  return /\b(we present|our approach|the idea|in our evaluation|and a bimanual|generated subgoal images|combining all of the context)\b/iu.test(
    text
  );
}

async function runAiAssistantScenario(client) {
  await clickSidebarSection(client, 'ai');
  await waitForAppReady(client);

  let before = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    before = await evaluateJson(client, `() => {
      const page = document.querySelector('.ai-assistant-page');
      const layout = document.querySelector('.ai-assistant-layout');
      const handle = document.querySelector('.layout-resize-handle');
      const main = document.querySelector('.ai-assistant-main-column');
      const side = document.querySelector('.ai-assistant-side-column');
      const handleRect = handle?.getBoundingClientRect();
      const layoutRect = layout?.getBoundingClientRect();
      return {
        hasAiAssistant: Boolean(page && layout && main && side),
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
        bodyIsResizing: document.body.classList.contains('is-resizing-layout'),
        layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
        handleVisible: Boolean(handle && getComputedStyle(handle).display !== 'none' && handleRect && handleRect.width > 0),
        mainWidth: main?.getBoundingClientRect().width ?? 0,
        sideWidth: side?.getBoundingClientRect().width ?? 0,
        layoutWidth: layoutRect?.width ?? 0,
        handle: handleRect
          ? { x: handleRect.left + handleRect.width / 2, y: handleRect.top + handleRect.height / 2 }
          : null
      };
    }`);
    if (before.hasAiAssistant) {
      break;
    }
    await wait(250);
  }

  if (!before.hasAiAssistant) {
    const diagnostic = await evaluateJson(client, `() => ({
      activeSidebar: [...document.querySelectorAll('.app-sidebar-link.active')].map((item) => item.textContent?.trim() ?? ''),
      knownViews: {
        home: Boolean(document.querySelector('.home-page')),
        reader: Boolean(document.querySelector('.split-layout')),
        researchSheet: Boolean(document.querySelector('.research-sheet-page')),
        presentation: Boolean(document.querySelector('.presentation-page')),
        ai: Boolean(document.querySelector('.ai-assistant-page')),
        settings: Boolean(document.querySelector('.settings-page'))
      },
      bodyText: (document.body.textContent ?? '').slice(0, 1200)
    })`);
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'ai-assistant-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    await writeFile(path.join(outputDir, 'ai-assistant-failed.json'), JSON.stringify({ before, diagnostic }, null, 2));
    throw new Error(`aiAssistant: expected AI assistant layout, got ${JSON.stringify(before)}`);
  }

  if (before.handleVisible && before.handle) {
    const targetX = Math.min(before.handle.x + 120, before.handle.x + before.layoutWidth * 0.18);
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: before.handle.x,
      y: before.handle.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: targetX,
      y: before.handle.y,
      button: 'left',
      buttons: 1
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: targetX,
      y: before.handle.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
    await wait(500);
  }

  const after = await evaluateJson(client, `() => {
    const layout = document.querySelector('.ai-assistant-layout');
    const main = document.querySelector('.ai-assistant-main-column');
    const side = document.querySelector('.ai-assistant-side-column');
    return {
      hasAiAssistant: Boolean(document.querySelector('.ai-assistant-page') && layout && main && side),
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
      bodyIsResizing: document.body.classList.contains('is-resizing-layout'),
      layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      sideWidth: side?.getBoundingClientRect().width ?? 0
    };
  }`);

  if (!after.hasAiAssistant || after.hasHorizontalOverflow || after.bodyIsResizing) {
    throw new Error(`aiAssistant: layout overflow or resize state leaked, got ${JSON.stringify({ before, after })}`);
  }
  if (before.handleVisible && Math.abs(after.mainWidth - before.mainWidth) < 20) {
    throw new Error(`aiAssistant: drag handle did not resize columns, got ${JSON.stringify({ before, after })}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'ai-assistant.png'), Buffer.from(shot.data, 'base64'))
  );

  return { before, after };
}

async function runSettingsScenario(client) {
  await clickSidebarSection(client, 'settings');
  await waitForAppReady(client);
  await wait(700);

  const snapshot = await evaluateJson(client, `() => {
    const page = document.querySelector('.settings-page');
    const layout = document.querySelector('.settings-layout');
    const nav = document.querySelector('.settings-nav');
    const content = document.querySelector('.settings-content');
    const buttons = [...document.querySelectorAll('.settings-nav button')];
    const navItems = buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        text: (button.textContent ?? '').trim(),
        width: rect.width,
        height: rect.height,
        scrollWidth: button.scrollWidth,
        clientWidth: button.clientWidth,
        wraps: button.scrollHeight > button.clientHeight + 3
      };
    });
    const rect = page?.getBoundingClientRect();
    return {
      hasPage: Boolean(page && layout && nav && content),
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
      pageHeight: rect?.height ?? 0,
      layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
      navWidth: nav?.getBoundingClientRect().width ?? 0,
      contentWidth: content?.getBoundingClientRect().width ?? 0,
      activeText: document.querySelector('.settings-nav button.active')?.textContent?.trim() ?? '',
      navItems,
      formControlCount: document.querySelectorAll('.settings-content input, .settings-content select, .settings-content textarea').length,
      pathRows: document.querySelectorAll('.path-input-row').length
    };
  }`);

  if (!snapshot.hasPage) {
    throw new Error(`settings: expected settings page layout, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.hasHorizontalOverflow || snapshot.contentWidth < 520 || snapshot.navWidth < 190) {
    throw new Error(`settings: layout overflow or collapsed columns, got ${JSON.stringify(snapshot)}`);
  }
  const brokenNav = snapshot.navItems.find((item) => item.height > 64 || item.wraps);
  if (brokenNav) {
    throw new Error(`settings: navigation item wraps or is too tall, got ${JSON.stringify({ brokenNav, snapshot })}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'settings-page.png'), Buffer.from(shot.data, 'base64'))
  );

  return snapshot;
}

async function main() {
  if (!existsSync(exe)) {
    throw new Error(`Packaged executable not found. Run npm run dist first: ${exe}`);
  }

  await mkdir(outputDir, { recursive: true });
  await rm(visualUserDataDir, { recursive: true, force: true });
  await mkdir(visualUserDataDir, { recursive: true });
  const pdfPath = await resolveVisualCheckPdfPath();
  const translatedPdfPath = await prepareVisualTranslatedPdf(pdfPath);

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
      translatedPdfPath,
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
    const presentation = await runPresentationScenario(client);
    const aiAssistant = await runAiAssistantScenario(client);
    const settings = await runSettingsScenario(client);
    client.close();
    console.log(
      JSON.stringify(
        { pdfPath, home, researchSheet, wholePdfReader, presentation, aiAssistant, settings, outputDir },
        null,
        2
      )
    );
  } finally {
    appProcess.kill();
    await wait(500);
  }
}

const keepAlive = setInterval(() => {}, 1000);

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearInterval(keepAlive);
}

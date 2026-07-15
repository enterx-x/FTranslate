import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const packageVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const packagedExe = path.join(root, 'dist', 'win-unpacked', 'PDF Translation Reader.exe');
const packagedInstaller = path.join(root, 'dist', `PDF Translation Reader Setup ${packageVersion}.exe`);
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const electronMainEntry = path.join(root, 'dist-electron', 'main', 'main.js');
const rendererIndex = path.join(root, 'dist-renderer', 'index.html');
const usePackagedApp = process.env.VISUAL_CHECK_PACKAGED === '1';
const visualScenario = process.env.VISUAL_CHECK_SCENARIO?.trim() ?? 'all';
const visualArxivMockMode = process.env.PDF_TRANSLATION_READER_VISUAL_MOCK_ARXIV ?? '1';
const requireNativeFigureExtraction = process.env.VISUAL_CHECK_REQUIRE_NATIVE_FIGURES === '1';
const pdfPath =
  process.env.VISUAL_CHECK_PDF ??
  path.join('D:\\', 'GPT浏览器下载', '2604.15483v2.pdf');
const outputDir = path.join(root, '.tmp-visual-check');
const visualUserDataDir = path.join(outputDir, 'user-data');
const port = Number(process.env.VISUAL_CHECK_PORT ?? 9333);
const disableGpu = process.env.VISUAL_CHECK_DISABLE_GPU === '1';
const pdfFirstRenderBudgetMs = Math.max(
  250,
  Number(process.env.VISUAL_CHECK_PDF_FIRST_RENDER_BUDGET_MS ?? 3000) || 3000
);
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
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    },
    events
  };
}

async function evaluateJson(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression: `(async () => { const value = await (${expression})(); return JSON.stringify(value === undefined ? null : value); })()`,
    awaitPromise: true,
    returnByValue: true
  });
  return JSON.parse(result.result.value);
}

async function waitForAppReady(client) {
  let lastSnapshot = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = await evaluateJson(client, `() => ({
      ready: Boolean(document.querySelector('.home-page, .split-layout, .experiment-matrix-page, .research-sheet-page, [data-scientific-plot-page], .ai-assistant-page, .paper-tutor-page, .knowledge-graph-page, .presentation-page, .arxiv-page, .settings-page')),
      activeSidebar: document.querySelector('.app-sidebar-link.active')?.getAttribute('data-sidebar-section') ?? '',
      knownViews: {
        home: Boolean(document.querySelector('.home-page')),
        reader: Boolean(document.querySelector('.split-layout')),
        experimentMatrix: Boolean(document.querySelector('.experiment-matrix-page')),
        researchSheet: Boolean(document.querySelector('.research-sheet-page')),
        scientificPlot: Boolean(document.querySelector('[data-scientific-plot-page]')),
        aiAssistant: Boolean(document.querySelector('.ai-assistant-page')),
        paperTutor: Boolean(document.querySelector('.paper-tutor-page')),
        knowledgeGraph: Boolean(document.querySelector('.knowledge-graph-page')),
        presentation: Boolean(document.querySelector('.presentation-page')),
        arxiv: Boolean(document.querySelector('.arxiv-page')),
        settings: Boolean(document.querySelector('.settings-page')),
        settingsLoading: Boolean(document.querySelector('.settings-loading'))
      },
      text: (document.body.textContent ?? '').slice(0, 1200)
    })`);
    lastSnapshot = snapshot;
    if (snapshot.ready) {
      return;
    }
    await wait(250);
  }

  throw new Error(`App did not render a known view: ${JSON.stringify(lastSnapshot)}`);
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
      const roots = [...document.querySelectorAll('.pdf-js-viewer-container')].filter((root) => {
        const rect = root.getBoundingClientRect();
        const style = window.getComputedStyle(root);
        return rect.width > 120 && rect.height > 120 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      const canvases = roots.flatMap((root) => [...root.querySelectorAll('canvas')]);
      const pages = roots.flatMap((root) => [...root.querySelectorAll('.page')]);
      const textSpans = roots.flatMap((root) => [...root.querySelectorAll('.textLayer span')]);
      const svgLayers = roots.flatMap((root) => [...root.querySelectorAll('.page svg')]);
      const imageLayers = roots.flatMap((root) => [...root.querySelectorAll('.page img')]);
      const hasCanvas = canvases.some((canvas) => canvas.width > 0 && canvas.height > 0);
      const hasVisiblePage = pages.some((page) => {
        const rect = page.getBoundingClientRect();
        return rect.width > 120 && rect.height > 120;
      });
      const hasLoadedPage = pages.some((page) => page.dataset.loaded === 'true');
      const hasVisibleTextLayer = textSpans.some((span) => (span.textContent ?? '').trim().length > 0);
      const hasVisibleSvgLayer = svgLayers.some((svg) => {
        const rect = svg.getBoundingClientRect();
        return rect.width > 120 && rect.height > 120;
      });
      const hasVisibleImageLayer = imageLayers.some((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width > 120 && rect.height > 120;
      });
      return {
        observedAt: performance.now(),
        hasCanvas,
        hasRenderablePdf: hasLoadedPage && (hasCanvas || hasVisibleTextLayer || hasVisibleSvgLayer || hasVisibleImageLayer),
        canvasCount: canvases.length,
        pageCount: pages.length,
        hasVisiblePage,
        hasLoadedPage,
        svgLayerCount: svgLayers.length,
        imageLayerCount: imageLayers.length,
        hasVisibleSvgLayer,
        hasVisibleImageLayer,
        hasVisibleTextLayer,
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
    const roots = [...document.querySelectorAll('.pdf-js-viewer-container')].filter((root) => {
      const rect = root.getBoundingClientRect();
      const style = window.getComputedStyle(root);
      return rect.width > 120 && rect.height > 120 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const canvases = roots.flatMap((root) => [...root.querySelectorAll('canvas')]);
    const pages = roots.flatMap((root) => [...root.querySelectorAll('.page')]);
    const textSpans = roots.flatMap((root) => [...root.querySelectorAll('.textLayer span')]);
    const svgLayers = roots.flatMap((root) => [...root.querySelectorAll('.page svg')]);
    const imageLayers = roots.flatMap((root) => [...root.querySelectorAll('.page img')]);
    return {
      rootCount: roots.length,
      hasCanvas: canvases.length > 0,
      canvasCount: canvases.length,
      pageCount: pages.length,
      svgLayerCount: svgLayers.length,
      imageLayerCount: imageLayers.length,
      textSpanCount: textSpans.length,
      firstPageHtml: pages[0]?.innerHTML?.slice(0, 1600) ?? '',
      pdfText: document.querySelector('.pdf-pane')?.textContent?.slice(0, 500) ?? '',
      panelText: document.querySelector('.whole-pdf-panel')?.textContent ?? ''
    };
  }`);
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-canvas-timeout.png'), Buffer.from(shot.data, 'base64'))
  );
  throw new Error(`wholePdf: PDF canvas did not render: ${JSON.stringify({ snapshot, events: client.events.slice(-12) })}`);
}

async function waitForExtractedPdfBlocks(client) {
  let snapshot = null;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    snapshot = await evaluateJson(client, `() => {
      const layout = document.querySelector('.split-layout');
      const blockCount = Number(layout?.getAttribute('data-extracted-pdf-block-count') ?? '0');
      return {
        blockCount,
        statusText: document.querySelector('.status-bar')?.textContent ?? '',
        pdfText: document.querySelector('.pdf-pane')?.textContent?.slice(0, 500) ?? ''
      };
    }`);
    if (snapshot.blockCount > 0) {
      return snapshot;
    }
    await wait(500);
  }
  return snapshot ?? { blockCount: 0, statusText: '', pdfText: '' };
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
  let result = await evaluateJson(client, `() => {
    const section = ${JSON.stringify(section)};
    const button = document.querySelector(\`.app-sidebar-link[data-sidebar-section="\${section}"]\`);
    if (button && button.getClientRects().length === 0) {
      const moreToggle = document.querySelector('[data-sidebar-more-toggle]');
      moreToggle?.click();
      return moreToggle ? 'opened-more' : 'hidden';
    }
    button?.click();
    return button ? 'clicked' : 'missing';
  }`);

  if (result === 'opened-more') {
    await wait(180);
    result = await evaluateJson(client, `() => {
      const section = ${JSON.stringify(section)};
      const button = document.querySelector(\`.app-sidebar-link[data-sidebar-section="\${section}"]\`);
      button?.click();
      return button && button.getClientRects().length > 0 ? 'clicked' : 'missing';
    }`);
  }

  if (result !== 'clicked') {
    throw new Error(`Sidebar section not found: ${section}`);
  }
  await wait(700);
}

async function clickArxivLayoutButton(client, label) {
  const clicked = await evaluateJson(client, `() => {
    const label = ${JSON.stringify(label)};
    const select = document.querySelector('[data-arxiv-layout-select]');
    const option = select
      ? [...select.options].find((item) => (item.textContent ?? '').trim() === label)
      : null;
    if (select && option) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const button = [...document.querySelectorAll('.arxiv-layout-switch button, .arxiv-view-switch button')]
      .find((item) => (item.textContent ?? '').trim() === label);
    button?.click();
    return Boolean(button);
  }`);
  if (!clicked) {
    throw new Error(`arxiv: layout button not found: ${label}`);
  }
  await wait(500);
}

async function readArxivResultLayout(client) {
  return evaluateJson(client, `() => {
    const cards = [...document.querySelectorAll('.arxiv-results-list > .arxiv-paper-card')];
    const cardRects = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        text: card.textContent?.slice(0, 500) ?? ''
      };
    });
    const firstTop = Math.min(...cardRects.map((rect) => rect.top));
    const firstRowCount = Number.isFinite(firstTop)
      ? cardRects.filter((rect) => Math.abs(rect.top - firstTop) <= 8).length
      : 0;
    const detail = document.querySelector('.arxiv-detail-panel');
    const detailRect = detail?.getBoundingClientRect();
    const detailStyle = detail ? getComputedStyle(detail) : null;
    const searchCard = document.querySelector('.arxiv-search-card');
    const searchRect = searchCard?.getBoundingClientRect();
    const pageHeader = document.querySelector('.arxiv-page-header');
    const pageHeaderRect = pageHeader?.getBoundingClientRect();
    const resultsPanel = document.querySelector('.arxiv-results-panel');
    const resultsPanelRect = resultsPanel?.getBoundingClientRect();
    const resultsToolbar = document.querySelector('.arxiv-results-toolbar');
    const resultsToolbarRect = resultsToolbar?.getBoundingClientRect();
    const pagination = document.querySelector('.arxiv-results-pagination');
    const paginationRect = pagination?.getBoundingClientRect();
    const readingQueue = document.querySelector('.arxiv-reading-queue-mini');
    const readingQueueRect = readingQueue?.getBoundingClientRect();
    const readingQueueButtons = [...document.querySelectorAll('.arxiv-reading-queue-list .arxiv-reading-queue-paper')];
    const readingQueueNativeTitleCount = readingQueueButtons.filter((button) => button.hasAttribute('title')).length;
    const readingQueueOcclusionCount = readingQueueButtons.reduce((count, button) => {
      const rect = button.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.bottom - 4);
      const topElement = document.elementFromPoint(x, y);
      return button.contains(topElement) || readingQueue?.contains(topElement) ? count : count + 1;
    }, 0);
    const pageFilterPanel = document.querySelector('.arxiv-filter-panel');
    const advancedFilters = document.querySelector('.arxiv-query-options');
    const searchButton = [...document.querySelectorAll('.arxiv-search-primary-row button')]
      .find((button) => /搜索/.test(button.textContent ?? ''));
    const searchButtonStyle = searchButton ? getComputedStyle(searchButton) : null;
    const resultsListStyle = getComputedStyle(document.querySelector('.arxiv-results-list') ?? document.body);
    const cardTitleRects = [...document.querySelectorAll('.arxiv-results-list > .arxiv-paper-card h3')].map((title) => {
      const rect = title.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        text: title.textContent?.slice(0, 160) ?? ''
      };
    });
    const rectHeight = (item) => item ? Math.round(item.getBoundingClientRect().height) : 0;
    const maxHeight = (items) => items.reduce((max, item) => Math.max(max, rectHeight(item)), 0);
    const primaryControls = [...document.querySelectorAll('.arxiv-search-primary-row input, .arxiv-search-primary-row button')];
    const filterControls = [...document.querySelectorAll('.arxiv-query-row select, .arxiv-query-row button')];
    const detailActionControls = [...document.querySelectorAll('.arxiv-detail-actions button, .arxiv-detail-actions a, .arxiv-detail-secondary-actions button, .arxiv-detail-secondary-actions a')];
    const topicTiles = [...document.querySelectorAll('.arxiv-topic-grid > div')];
    return {
      cardCount: cards.length,
      firstRowCount,
      cardRects,
      minCardWidth: cardRects.reduce((min, rect) => Math.min(min, rect.width), Number.POSITIVE_INFINITY),
      minCardHeight: cardRects.reduce((min, rect) => Math.min(min, rect.height), Number.POSITIVE_INFINITY),
      maxCardTitleHeight: cardTitleRects.reduce((max, rect) => Math.max(max, rect.height), 0),
      cardTitleRects,
      zhCount: cards.filter((card) => /强化学习|中文摘要/.test(card.textContent ?? '')).length,
      gridTemplateColumns: resultsListStyle.gridTemplateColumns,
      detailVisible: Boolean(
        detail &&
          detailRect &&
          detailRect.width > 160 &&
          detailRect.height > 180 &&
          detailStyle?.display !== 'none' &&
          detailStyle?.visibility !== 'hidden'
      ),
      detailRect: detailRect
        ? {
            left: Math.round(detailRect.left),
            top: Math.round(detailRect.top),
            width: Math.round(detailRect.width),
            height: Math.round(detailRect.height)
          }
        : null,
      searchRect: searchRect
        ? {
            left: Math.round(searchRect.left),
            top: Math.round(searchRect.top),
            right: Math.round(searchRect.right),
            width: Math.round(searchRect.width),
            height: Math.round(searchRect.height)
          }
        : null,
      pageHeaderHeight: pageHeaderRect ? Math.round(pageHeaderRect.height) : null,
      readingQueueRect: readingQueueRect
        ? {
            left: Math.round(readingQueueRect.left),
            top: Math.round(readingQueueRect.top),
            bottom: Math.round(readingQueueRect.bottom),
            width: Math.round(readingQueueRect.width),
            height: Math.round(readingQueueRect.height)
          }
        : null,
      readingQueueToFirstCardGap: readingQueueRect && Number.isFinite(firstTop)
        ? Math.round(firstTop - readingQueueRect.bottom)
        : null,
      readingQueuePosition: readingQueue ? getComputedStyle(readingQueue).position : null,
      readingQueueNativeTitleCount,
      readingQueueOcclusionCount,
      resultsPanelRect: resultsPanelRect
        ? {
            left: Math.round(resultsPanelRect.left),
            top: Math.round(resultsPanelRect.top),
            right: Math.round(resultsPanelRect.right),
            width: Math.round(resultsPanelRect.width),
            height: Math.round(resultsPanelRect.height)
          }
        : null,
      resultsToolbarHeight: resultsToolbarRect ? Math.round(resultsToolbarRect.height) : null,
      paginationHeight: paginationRect ? Math.round(paginationRect.height) : null,
      maxSearchPrimaryControlHeight: maxHeight(primaryControls),
      maxFilterControlHeight: maxHeight(filterControls),
      maxDetailActionHeight: maxHeight(detailActionControls),
      maxTopicTileHeight: maxHeight(topicTiles),
      searchResultsRightDelta:
        searchRect && resultsPanelRect ? Math.abs(Math.round(searchRect.right - resultsPanelRect.right)) : null,
      detailSearchTopDelta:
        detailRect && searchRect ? Math.round(detailRect.top - searchRect.top) : null,
      hasPageFilterPanel: Boolean(pageFilterPanel),
      hasLegacyFilterPanel: Boolean(document.querySelector('.arxiv-filter-panel-legacy')),
      hasTopPageFilters:
        Boolean(advancedFilters) &&
        advancedFilters.querySelectorAll('select').length >= 3 &&
        advancedFilters.querySelectorAll('input[type="checkbox"]').length >= 4,
      searchButtonBackground: searchButtonStyle?.backgroundColor ?? '',
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
    };
  }`);
}

async function waitForArxivResultLayout(client, expectedFirstRowCount, label) {
  let snapshot = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    snapshot = await readArxivResultLayout(client);
    if (
      snapshot.cardCount >= 6 &&
      snapshot.zhCount >= 1 &&
      snapshot.detailVisible &&
      snapshot.firstRowCount === expectedFirstRowCount &&
      !snapshot.hasHorizontalOverflow
    ) {
      return snapshot;
    }
    await wait(250);
  }
  throw new Error(`arxiv: ${label} layout did not match expected first row count ${expectedFirstRowCount}: ${JSON.stringify(snapshot)}`);
}

async function captureArxivResponsiveWidths(client) {
  const snapshots = {};
  try {
    for (const width of [1366, 1440, 1920]) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      });
      await wait(320);
      const snapshot = await evaluateJson(client, `() => {
        const rects = [...document.querySelectorAll('.arxiv-query-row select, .arxiv-query-row button')]
          .filter((item) => getComputedStyle(item).display !== 'none')
          .map((item) => {
            const rect = item.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          });
        const overlaps = rects.some((rect, index) => rects.slice(index + 1).some((other) =>
          rect.left < other.right - 2 && rect.right > other.left + 2 &&
          rect.top < other.bottom - 2 && rect.bottom > other.top + 2
        ));
        const cards = [...document.querySelectorAll('.arxiv-results-list > .arxiv-paper-card')];
        const firstTop = Math.min(...cards.map((card) => card.getBoundingClientRect().top));
        const firstRowCount = cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) <= 8).length;
        const clippedCardActionCount = [...document.querySelectorAll('.arxiv-card-actions--primary button')]
          .filter((button) => button.scrollWidth > button.clientWidth + 2).length;
        const runtimeStatus = document.querySelector('.arxiv-runtime-status');
        return {
          viewportWidth: window.innerWidth,
          firstRowCount,
          queryControlsOverlap: overlaps,
          clippedCardActionCount,
          runtimeStatusOverflow: Boolean(runtimeStatus && runtimeStatus.scrollWidth > runtimeStatus.clientWidth + 3),
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
        };
      }`);
      snapshots[width] = snapshot;
      if (
        snapshot.viewportWidth !== width ||
        snapshot.firstRowCount !== 3 ||
        snapshot.queryControlsOverlap ||
        snapshot.clippedCardActionCount > 0 ||
        snapshot.runtimeStatusOverflow ||
        snapshot.hasHorizontalOverflow
      ) {
        throw new Error(`arxiv: ${width}px responsive audit failed: ${JSON.stringify(snapshot)}`);
      }
      await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
        writeFile(path.join(outputDir, `arxiv-search-results-${width}.png`), Buffer.from(shot.data, 'base64'))
      );
    }
  } finally {
    await client.send('Emulation.clearDeviceMetricsOverride');
    await wait(320);
  }
  return snapshots;
}

async function assertArxivSearchingControlGuards(client, canDelaySearch) {
  if (!canDelaySearch) {
    const declarativeGuards = await evaluateJson(client, `() => {
      const selectors = [
        '.arxiv-search-primary-row .primary-button',
        '.arxiv-page-jump input',
        '.arxiv-translate-page-button',
        '.arxiv-card-actions--primary button[data-search-session-guard="true"]'
      ];
      return selectors.map((selector) => ({
        selector,
        exists: Boolean(document.querySelector(selector)),
        guarded: document.querySelector(selector)?.getAttribute('data-search-session-guard') === 'true'
      }));
    }`);
    if (declarativeGuards.some((guard) => !guard.exists || !guard.guarded)) {
      throw new Error(`arxiv: declarative search-session guards are incomplete: ${JSON.stringify(declarativeGuards)}`);
    }
    return { declarativeGuards };
  }
  await evaluateJson(client, `() => {
    document.querySelector('.arxiv-search-primary-row .primary-button')?.click();
    return true;
  }`);

  let snapshot = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    snapshot = await evaluateJson(client, `() => {
      const resultsPanel = document.querySelector('.arxiv-results-panel');
      const cardTranslate = [...document.querySelectorAll('.arxiv-card-actions--primary button')]
        .find((button) => /翻译/.test(button.textContent ?? ''));
      return {
        isBusy: resultsPanel?.getAttribute('aria-busy') === 'true',
        searchDisabled: Boolean(document.querySelector('.arxiv-search-primary-row .primary-button')?.disabled),
        pageJumpDisabled: Boolean(document.querySelector('.arxiv-page-jump input')?.disabled),
        translatePageDisabled: Boolean(document.querySelector('.arxiv-translate-page-button')?.disabled),
        cardTranslateDisabled: Boolean(cardTranslate?.disabled)
      };
    }`);
    if (snapshot.isBusy) break;
    await wait(20);
  }

  if (
    !snapshot?.isBusy ||
    !snapshot.searchDisabled ||
    !snapshot.pageJumpDisabled ||
    !snapshot.translatePageDisabled ||
    !snapshot.cardTranslateDisabled
  ) {
    throw new Error(`arxiv: search session controls were not guarded while busy: ${JSON.stringify(snapshot)}`);
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const isBusy = await evaluateJson(
      client,
      `() => document.querySelector('.arxiv-results-panel')?.getAttribute('aria-busy') === 'true'`
    );
    if (!isBusy) return snapshot;
    await wait(50);
  }
  throw new Error('arxiv: delayed visual search mock did not settle');
}

async function readArxivAdvancedFilterDensity(client) {
  return evaluateJson(client, `() => {
    const toggle = document.querySelector('.arxiv-advanced-toggle');
    const searchCard = document.querySelector('.arxiv-search-card');
    const advancedFilters = document.querySelector('.arxiv-query-options');
    const resultsPanel = document.querySelector('.arxiv-results-panel');
    const detailPanel = document.querySelector('.arxiv-detail-panel');
    const rect = (item) => {
      const box = item?.getBoundingClientRect();
      return box
        ? {
            top: Math.round(box.top),
            width: Math.round(box.width),
            height: Math.round(box.height)
          }
        : null;
    };
    toggle?.click();
    return new Promise((resolve) => {
      window.setTimeout(() => {
        const advancedBox = advancedFilters?.getBoundingClientRect();
        const probe = advancedBox
          ? document.elementFromPoint(
              Math.round(advancedBox.left + advancedBox.width / 2),
              Math.round(advancedBox.top + Math.min(18, advancedBox.height / 2))
            )
          : null;
        const snapshot = {
          searchRect: rect(searchCard),
          advancedRect: rect(advancedFilters),
          resultsRect: rect(resultsPanel),
          detailRect: rect(detailPanel),
          advancedVisible:
            Boolean(advancedFilters) &&
            getComputedStyle(advancedFilters).display !== 'none' &&
            (advancedFilters?.getBoundingClientRect().height ?? 0) > 20,
          advancedOccluded: Boolean(advancedFilters && probe && !advancedFilters.contains(probe)),
          advancedProbeClass: probe?.className ?? '',
          advancedProbeText: probe?.textContent?.trim().slice(0, 80) ?? '',
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
        };
        resolve(snapshot);
      }, 250);
    });
  }`);
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

async function readWholePdfSidebarLayout(client, label) {
  return evaluateJson(client, `() => {
    const rect = (item) => {
      const box = item?.getBoundingClientRect();
      return box
        ? {
            left: Math.round(box.left),
            right: Math.round(box.right),
            top: Math.round(box.top),
            width: Math.round(box.width),
            height: Math.round(box.height)
          }
        : null;
    };
    const splitLayout = document.querySelector('.split-layout');
    const translationPane = document.querySelector('.translation-pane');
    const sidePanel = document.querySelector('.translation-pane .side-panel');
    const panel = document.querySelector('.whole-pdf-panel');
    const actions = document.querySelector('.whole-pdf-actions');
    const figureGrid = document.querySelector('.pdf-figure-grid');
    const toggle = document.querySelector('.reader-side-panel-toggle');
    const panelRect = panel?.getBoundingClientRect();
    const buttons = [...document.querySelectorAll('.whole-pdf-actions button, .pdf-view-toggle button')];
    const overflowButtons = buttons
      .map((button) => {
        const box = button.getBoundingClientRect();
        const text = (button.textContent ?? button.getAttribute('aria-label') ?? '').trim();
        const visible = box.width > 0 && box.height > 0;
        const overflows =
          visible &&
          (button.scrollWidth > button.clientWidth + 3 ||
            (panelRect && box.left < panelRect.left - 2) ||
            (panelRect && box.right > panelRect.right + 2));
        return {
          text,
          width: Math.round(box.width),
          height: Math.round(box.height),
          scrollWidth: button.scrollWidth,
          clientWidth: button.clientWidth,
          overflows
        };
      })
      .filter((item) => item.overflows);
    return {
      label: ${JSON.stringify(label)},
      isCollapsed: Boolean(splitLayout?.classList.contains('is-reader-side-collapsed')),
      activeToggle: [...document.querySelectorAll('.pdf-view-toggle button')]
        .find((button) => button.classList.contains('active'))?.textContent?.trim() ?? '',
      paneRect: rect(translationPane),
      sidePanelRect: rect(sidePanel),
      panelRect: rect(panel),
      actionsRect: rect(actions),
      figureGridRect: rect(figureGrid),
      toggleRect: rect(toggle),
      visibleButtonCount: buttons.filter((button) => {
        const box = button.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      }).length,
      actionOverflowCount: overflowButtons.length,
      overflowButtons,
      panelOverflow: panel ? panel.scrollWidth > panel.clientWidth + 3 : false,
      actionsOverflow: actions ? actions.scrollWidth > actions.clientWidth + 3 : false,
      figureGridOverflow: figureGrid ? figureGrid.scrollWidth > figureGrid.clientWidth + 3 : false,
      sidePanelOverflow: sidePanel ? sidePanel.scrollWidth > sidePanel.clientWidth + 3 : false,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
    };
  }`);
}

async function readPdfInitialCenterLayout(client, label) {
  return evaluateJson(client, `() => {
    const container = document.querySelector('.pdf-js-viewer-container');
    const page = container?.querySelector('.page');
    const containerBox = container?.getBoundingClientRect();
    const pageBox = page?.getBoundingClientRect();
    if (!container || !page || !containerBox || !pageBox) {
      return { label: ${JSON.stringify(label)}, hasPage: false };
    }
    const leftHidden = Math.max(0, containerBox.left - pageBox.left);
    const rightHidden = Math.max(0, pageBox.right - containerBox.right);
    const visibleWidth = Math.max(0, Math.min(pageBox.right, containerBox.right) - Math.max(pageBox.left, containerBox.left));
    return {
      label: ${JSON.stringify(label)},
      hasPage: true,
      scrollLeft: Math.round(container.scrollLeft),
      scrollWidth: Math.round(container.scrollWidth),
      clientWidth: Math.round(container.clientWidth),
      pageWidth: Math.round(pageBox.width),
      containerWidth: Math.round(containerBox.width),
      leftHidden: Math.round(leftHidden),
      rightHidden: Math.round(rightHidden),
      hiddenDelta: Math.round(Math.abs(leftHidden - rightHidden)),
      visibleWidth: Math.round(visibleWidth),
      hasWidePage: pageBox.width > containerBox.width + 8,
      fitWidthGap: Math.round(Math.max(0, containerBox.width - pageBox.width)),
      fullyVisibleHorizontally: leftHidden <= 2 && rightHidden <= 2,
      isFitWidth: pageBox.width <= containerBox.width + 2 && containerBox.width - pageBox.width <= 80
    };
  }`);
}

async function dragReaderSidebarToRatio(client, ratio) {
  const handle = await evaluateJson(client, `() => {
    const split = document.querySelector('.split-layout');
    const item = document.querySelector('.reader-layout-resize-handle');
    const splitBox = split?.getBoundingClientRect();
    const handleBox = item?.getBoundingClientRect();
    if (!splitBox || !handleBox) {
      return null;
    }
    return {
      startX: handleBox.left + handleBox.width / 2,
      y: handleBox.top + handleBox.height / 2,
      targetX: splitBox.right - splitBox.width * ${JSON.stringify(ratio)}
    };
  }`);
  if (!handle) {
    return false;
  }

  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: handle.startX,
    y: handle.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: handle.targetX,
    y: handle.y,
    button: 'left',
    buttons: 1
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: handle.targetX,
    y: handle.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await wait(500);
  const changed = await evaluateJson(client, `() => {
    const pane = document.querySelector('.translation-pane');
    const width = pane?.getBoundingClientRect().width ?? 0;
    return width < 360;
  }`);
  if (changed) {
    return true;
  }

  return evaluateJson(client, `() => {
    const split = document.querySelector('.split-layout');
    const item = document.querySelector('.reader-layout-resize-handle');
    const splitBox = split?.getBoundingClientRect();
    const handleBox = item?.getBoundingClientRect();
    if (!splitBox || !handleBox || !(item instanceof HTMLElement)) {
      return false;
    }
    const pointerId = 91;
    const startX = handleBox.left + handleBox.width / 2;
    const y = handleBox.top + handleBox.height / 2;
    const targetX = splitBox.right - splitBox.width * ${JSON.stringify(ratio)};
    item.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'mouse',
      clientX: startX,
      clientY: y,
      button: 0,
      buttons: 1
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'mouse',
      clientX: targetX,
      clientY: y,
      button: 0,
      buttons: 1
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'mouse',
      clientX: targetX,
      clientY: y,
      button: 0,
      buttons: 0
    }));
    return true;
  }`);
}

async function loadPaperRecord(client, translationPath, extraPaperFields = {}) {
  const now = new Date().toISOString();
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
    lastOpenedAt: now,
    lastPage: 18,
    tags: ['CBF', 'Safe RL', '控制理论'],
    isPinned: true,
    importedAt: '2026-07-01T08:00:00.000Z',
    updatedAt: now,
    totalPages: 28,
    ...extraPaperFields
  };
  const makeVisualPaper = (id, overrides = {}) => ({
    ...paper,
    id,
    pdfName: `${id}.pdf`,
    chineseTitle: '',
    englishTitle: `Visual Paper ${id}`,
    authors: 'Visual Check Author',
    notes: '',
    tags: [],
    isPinned: false,
    lastPage: 1,
    importedAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
    totalPages: 24,
    ...overrides
  });
  const visualPapers = [
    {
      ...paper,
      chineseTitle: '控制屏障函数与安全强化学习：面向复杂动态障碍环境的移动机器人安全导航方法研究'
    },
    makeVisualPaper('visual-long-en', {
      englishTitle: 'A Very Long English Paper Title for Stress Testing Dense Scientific Library Layouts Across Desktop Window Sizes',
      authors: 'Author One, Author Two, Author Three, Author Four, Author Five',
      tags: ['Benchmark', 'Navigation', 'Robotics']
    }),
    makeVisualPaper('visual-pinn', {
      englishTitle: 'Physics-Informed Neural Networks for Partial Differential Equation Systems',
      tags: ['PINN'],
      lastPage: 7
    }),
    makeVisualPaper('visual-complete', {
      englishTitle: 'Model Predictive Path Integral Control',
      tags: ['MPC'],
      completedAt: '2026-07-08T00:00:00.000Z',
      lastPage: 24
    }),
    makeVisualPaper('visual-missing', {
      englishTitle: 'Missing Local PDF Recovery',
      pdfPath: 'Z:/missing/paper.pdf',
      tags: ['待修复']
    }),
    makeVisualPaper('visual-unknown-pages', {
      englishTitle: 'Unknown Page Count Paper',
      totalPages: undefined,
      lastPage: 11
    }),
    makeVisualPaper('visual-unread', {
      englishTitle: 'Unread Safe Reinforcement Learning',
      tags: ['Safe RL'],
      lastPage: 1
    }),
    makeVisualPaper('visual-planning', {
      englishTitle: 'Learning Sampling Distributions for Robot Motion Planning',
      tags: ['路径规划'],
      lastPage: 10
    })
  ];
  const visualProjects = [
    {
      id: 'local-ai-rd-workspace',
      name: '移动机器人安全导航',
      description: '视觉回归项目',
      status: 'active',
      paperIds: [paper.id, 'visual-complete', 'visual-planning'],
      codeRepositoryPaths: [],
      experimentIds: [],
      runtimeTaskIds: [],
      decisionLog: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: now
    }
  ];
  const experimentMatrixState = [
    {
      projectId: 'local-ai-rd-workspace',
      rows: [
        {
          id: 'visual-matrix-row',
          projectId: 'local-ai-rd-workspace',
          paperId: paper.id,
          methodCardId: 'visual-method-card',
          group: 'proposed',
          paper: paper.chineseTitle,
          hypothesis: '验证证据绑定的 proposed method 是否优于 baseline。',
          baseline: 'PPO baseline',
          proposed: 'CBF safety layer + physics-informed reward',
          ablation: 'without CBF safety layer',
          controlledVariables: '保持 dynamic obstacles、baseline、metrics 和 seeds 不变。',
          seeds: '1, 2, 3',
          metrics: 'success rate, collision rate, trajectory smoothness',
          expectedResult: '如果安全约束有效，应降低 collision rate 并保持 success rate。',
          status: 'planned',
          evidenceSourceIds: ['visual-evidence-method', 'visual-evidence-metric'],
          evidenceLocators: ['p. 4 Method', 'p. 7 Results']
        }
      ],
      selectedRowId: 'visual-matrix-row',
      updatedAt: new Date().toISOString(),
      version: 1
    }
  ];
  const methodCards = [
    {
      id: 'visual-method-card',
      projectId: 'local-ai-rd-workspace',
      paperId: paper.id,
      title: paper.chineseTitle,
      status: 'needs-review',
      fields: [
        {
          key: 'modelArchitecture',
          label: 'Model Architecture',
          value: 'CBF safety layer + physics-informed reward',
          confidence: 0.82,
          evidenceSourceIds: ['visual-evidence-method'],
          reviewState: 'unconfirmed'
        },
        {
          key: 'constraints',
          label: 'Constraints',
          value: 'CBF safety layer',
          confidence: 0.8,
          evidenceSourceIds: ['visual-evidence-method'],
          reviewState: 'unconfirmed'
        },
        {
          key: 'datasetOrEnvironment',
          label: 'Dataset / Environment',
          value: 'dynamic obstacles',
          confidence: 0.76,
          evidenceSourceIds: ['visual-evidence-method'],
          reviewState: 'unconfirmed'
        },
        {
          key: 'baseline',
          label: 'Baseline',
          value: 'PPO baseline',
          confidence: 0.78,
          evidenceSourceIds: ['visual-evidence-baseline'],
          reviewState: 'unconfirmed'
        },
        {
          key: 'metrics',
          label: 'Evaluation Metrics',
          value: 'success rate, collision rate, trajectory smoothness',
          confidence: 0.84,
          evidenceSourceIds: ['visual-evidence-metric'],
          reviewState: 'unconfirmed'
        },
        {
          key: 'claimedContribution',
          label: 'Claimed Contribution',
          value: '降低 collision rate 并保持 success rate。',
          confidence: 0.74,
          evidenceSourceIds: ['visual-evidence-method'],
          reviewState: 'unconfirmed'
        }
      ],
      evidenceSources: [
        {
          id: 'visual-evidence-method',
          paperId: paper.id,
          type: 'pdf-text',
          page: 4,
          section: 'Method',
          locator: 'p. 4 Method',
          text: 'The method uses a CBF safety layer and physics-informed reward.',
          score: 8
        },
        {
          id: 'visual-evidence-baseline',
          paperId: paper.id,
          type: 'pdf-text',
          page: 6,
          section: 'Experiments',
          locator: 'p. 6 Experiments',
          text: 'The baseline is PPO.',
          score: 8
        },
        {
          id: 'visual-evidence-metric',
          paperId: paper.id,
          type: 'table-caption',
          page: 7,
          section: 'Results',
          locator: 'p. 7 Results',
          text: 'Table 1 reports success rate, collision rate and trajectory smoothness.',
          score: 9
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    }
  ];

  await client.send('Runtime.evaluate', {
    expression: `
      localStorage.setItem('pdfTranslationReader:paperLibrary', ${JSON.stringify(JSON.stringify(visualPapers))});
      localStorage.setItem('pdfTranslationReader:researchProjects', ${JSON.stringify(JSON.stringify(visualProjects))});
      localStorage.setItem('pdfTranslationReader:paperLibraryView', ${JSON.stringify(JSON.stringify({
        sortKey: 'recentActivity',
        sortDirection: 'desc',
        density: 'compact',
        inspectorCollapsed: false
      }))});
      localStorage.setItem('pdfTranslationReader:methodCards', ${JSON.stringify(JSON.stringify(methodCards))});
      localStorage.setItem('pdfTranslationReader:experimentMatrices', ${JSON.stringify(JSON.stringify(experimentMatrixState))});
      localStorage.removeItem('pdfTranslationReader:researchWorkbook');
      localStorage.removeItem('pdfTranslationReader:researchSheetLinks');
      location.reload();
    `
  });
  await wait(1500);
}

async function capturePaperLibraryResponsiveWidths(client) {
  const snapshots = {};
  try {
    for (const width of [1366, 1440, 1920]) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      });
      await wait(300);
      const snapshot = await evaluateJson(client, `() => {
        const page = document.querySelector('[data-paper-library-page]');
        const navigator = document.querySelector('[data-paper-library-navigator]');
        const inspector = document.querySelector('[data-paper-library-inspector]');
        const libraryPane = page?.querySelector('[role="listbox"]')?.parentElement;
        const rows = [...document.querySelectorAll('[data-paper-library-row]')];
        const list = document.querySelector('[role="listbox"]');
        const resume = document.querySelector('[data-paper-library-resume]');
        const sort = document.querySelector('[data-paper-library-sort]');
        const criticalButtons = [...document.querySelectorAll(
          '[data-paper-library-page] > header button, [data-paper-library-resume], [data-paper-library-inspector] > div:last-child button'
        )].filter((button) => button.offsetParent !== null && button.getAttribute('title') !== '清除选择');
        const visibleRows = rows.filter((row) => {
          const rect = row.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight;
        });
        const tagDeltas = [...document.querySelectorAll('[data-paper-library-row] span')]
          .map((tag) => getComputedStyle(tag).backgroundColor.match(/\d+/g)?.map(Number))
          .filter((channels) => channels?.length >= 3)
          .map((channels) => Math.max(channels[0], channels[1], channels[2]) - Math.min(channels[0], channels[1], channels[2]));
        const rect = (item) => {
          const box = item?.getBoundingClientRect();
          return box ? { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), height: Math.round(box.height) } : null;
        };
        return {
          viewportWidth: window.innerWidth,
          hasPage: Boolean(page),
          hasNavigator: Boolean(navigator),
          hasInspector: Boolean(inspector),
          rowCount: rows.length,
          visibleRowCount: visibleRows.length,
          sortText: sort?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          resumeVisible: Boolean(resume && resume.getBoundingClientRect().height > 20),
          pageHorizontalOverflow: Boolean(page && page.scrollWidth > page.clientWidth + 3),
          listHorizontalOverflow: Boolean(list && list.scrollWidth > list.clientWidth + 3),
          documentHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
          clippedCriticalControls: criticalButtons.filter((button) => button.scrollWidth > button.clientWidth + 3).map((button) => button.textContent?.trim()),
          maxTagChannelDelta: tagDeltas.length ? Math.max(...tagDeltas) : 0,
          navigatorRect: rect(navigator),
          inspectorRect: rect(inspector),
          libraryRect: rect(libraryPane)
        };
      }`);

      snapshots[width] = snapshot;
      if (
        snapshot.viewportWidth !== width ||
        !snapshot.hasPage ||
        !snapshot.hasNavigator ||
        !snapshot.hasInspector ||
        snapshot.rowCount < 8 ||
        snapshot.visibleRowCount < 5 ||
        !/最近活动/.test(snapshot.sortText) ||
        !snapshot.resumeVisible ||
        snapshot.pageHorizontalOverflow ||
        snapshot.listHorizontalOverflow ||
        snapshot.documentHorizontalOverflow ||
        snapshot.clippedCriticalControls.length > 0 ||
        snapshot.maxTagChannelDelta > 36 ||
        (snapshot.navigatorRect?.width ?? 0) < 150 ||
        (snapshot.inspectorRect?.width ?? 0) < 270 ||
        (snapshot.libraryRect?.width ?? 0) < 400
      ) {
        throw new Error(`paperLibrary: ${width}px responsive audit failed: ${JSON.stringify(snapshot)}`);
      }

      await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
        writeFile(path.join(outputDir, `paper-library-${width}.png`), Buffer.from(shot.data, 'base64'))
      );
    }

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await wait(250);

    const shortcutFocusedSearch = await evaluateJson(client, `() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      return document.activeElement?.getAttribute('aria-keyshortcuts') === 'Control+K Meta+K';
    }`);
    if (!shortcutFocusedSearch) {
      throw new Error('paperLibrary: Ctrl+K did not focus the advertised library search');
    }

    const batchState = await evaluateJson(client, `() => {
      const checkboxes = [...document.querySelectorAll('[data-paper-library-row] input[type="checkbox"]')].slice(0, 2);
      checkboxes.forEach((checkbox) => checkbox.click());
      return checkboxes.length;
    }`);
    await wait(250);
    const batchSnapshot = await evaluateJson(client, `() => ({
      selectedCount: document.querySelectorAll('[data-paper-library-row] input[type="checkbox"]:checked').length,
      hasBulkBar: /已选择 2 篇/.test(document.body.textContent ?? ''),
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
    })`);
    if (batchState !== 2 || batchSnapshot.selectedCount !== 2 || !batchSnapshot.hasBulkBar || batchSnapshot.hasHorizontalOverflow) {
      throw new Error(`paperLibrary: batch selection state failed: ${JSON.stringify({ batchState, batchSnapshot })}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'paper-library-batch.png'), Buffer.from(shot.data, 'base64'))
    );
    await evaluateJson(client, `() => document.querySelector('button[title="清除选择"]')?.click()`);
    await wait(180);

    const tagDialogOpened = await evaluateJson(client, `() => {
      document.querySelector('[data-paper-library-tag-manage="cbf"]')?.click();
      return Boolean(document.querySelector('[data-paper-library-tag-manage="cbf"]'));
    }`);
    await wait(220);
    const tagDialog = await evaluateJson(client, `() => {
      const dialog = document.querySelector('[data-paper-library-tag-dialog]');
      const input = dialog?.querySelector('input');
      return {
        opened: Boolean(dialog),
        inputValue: input?.value ?? '',
        hasAffectedCount: /1 篇论文/.test(dialog?.textContent ?? ''),
        hasDeleteChoice: /删除这个标签/.test(dialog?.textContent ?? ''),
        hasHorizontalOverflow: dialog ? dialog.scrollWidth > dialog.clientWidth + 3 : false
      };
    }`);
    if (!tagDialogOpened || !tagDialog.opened || tagDialog.inputValue !== 'CBF' || !tagDialog.hasAffectedCount || !tagDialog.hasDeleteChoice || tagDialog.hasHorizontalOverflow) {
      throw new Error(`paperLibrary: tag management dialog failed: ${JSON.stringify(tagDialog)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'paper-library-tag-dialog.png'), Buffer.from(shot.data, 'base64'))
    );
    await evaluateJson(client, `() => document.querySelector('button[aria-label="关闭标签管理"]')?.click()`);
    await wait(180);

    const projectDialogOpened = await evaluateJson(client, `() => {
      document.querySelector('[data-paper-library-create-project]')?.click();
      return Boolean(document.querySelector('[data-paper-library-create-project]'));
    }`);
    await wait(220);
    const projectDialog = await evaluateJson(client, `() => {
      const dialog = document.querySelector('[data-paper-library-create-project-dialog]');
      const nameInput = dialog?.querySelector('#paper-project-name');
      const descriptionInput = dialog?.querySelector('#paper-project-description');
      const seedInput = dialog?.querySelector('input[type="checkbox"]');
      const rect = dialog?.getBoundingClientRect();
      return {
        opened: Boolean(dialog),
        hasNameInput: Boolean(nameInput),
        hasDescriptionInput: Boolean(descriptionInput),
        seedChecked: Boolean(seedInput?.checked),
        hasCreateAction: /创建项目/.test(dialog?.textContent ?? ''),
        withinViewport: Boolean(rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
        hasHorizontalOverflow: dialog ? dialog.scrollWidth > dialog.clientWidth + 3 : false
      };
    }`);
    if (!projectDialogOpened || !projectDialog.opened || !projectDialog.hasNameInput || !projectDialog.hasDescriptionInput || !projectDialog.seedChecked || !projectDialog.hasCreateAction || !projectDialog.withinViewport || projectDialog.hasHorizontalOverflow) {
      throw new Error(`paperLibrary: create-project dialog failed: ${JSON.stringify(projectDialog)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'paper-library-create-project-dialog.png'), Buffer.from(shot.data, 'base64'))
    );
    const submittedProject = await evaluateJson(client, `() => {
      const dialog = document.querySelector('[data-paper-library-create-project-dialog]');
      const nameInput = dialog?.querySelector('#paper-project-name');
      const descriptionInput = dialog?.querySelector('#paper-project-description');
      if (!dialog || !nameInput || !descriptionInput) return false;
      const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      inputSetter?.call(nameInput, '视觉回归新项目');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      textareaSetter?.call(descriptionInput, '验证新建、论文归档和本地持久化闭环。');
      descriptionInput.dispatchEvent(new Event('input', { bubbles: true }));
      dialog.querySelector('form')?.requestSubmit();
      return true;
    }`);
    await wait(350);
    const projectCreation = await evaluateJson(client, `() => {
      const projects = JSON.parse(localStorage.getItem('pdfTranslationReader:researchProjects') ?? '[]');
      const created = projects.find((project) => project.name === '视觉回归新项目');
      const projectButton = [...document.querySelectorAll('[data-paper-library-navigator] button')]
        .find((button) => (button.textContent ?? '').includes('视觉回归新项目'));
      return {
        submitted: ${submittedProject},
        dialogClosed: !document.querySelector('[data-paper-library-create-project-dialog]'),
        persisted: Boolean(created),
        linkedCurrentPaper: Boolean(created?.paperIds?.includes('visual-check-paper')),
        appearsInNavigator: Boolean(projectButton),
        selectedProjectRowCount: document.querySelectorAll('[data-paper-library-row]').length,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
      };
    }`);
    if (!projectCreation.submitted || !projectCreation.dialogClosed || !projectCreation.persisted || !projectCreation.linkedCurrentPaper || !projectCreation.appearsInNavigator || projectCreation.selectedProjectRowCount !== 1 || projectCreation.hasHorizontalOverflow) {
      throw new Error(`paperLibrary: project creation persistence failed: ${JSON.stringify(projectCreation)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'paper-library-project-created.png'), Buffer.from(shot.data, 'base64'))
    );
    await evaluateJson(client, `() => [...document.querySelectorAll('[data-paper-library-navigator] button')]
      .find((button) => (button.textContent ?? '').includes('视觉回归新项目'))?.click()`);
    await wait(220);

    await evaluateJson(client, `() => {
      const input = document.querySelector('input[placeholder^="搜索标题"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'definitely-no-paper-matches');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }`);
    await wait(350);
    const noResults = await evaluateJson(client, `() => ({
      rowCount: document.querySelectorAll('[data-paper-library-row]').length,
      hasEmptyMessage: /没有匹配的论文/.test(document.body.textContent ?? ''),
      hasClearAction: /清除全部筛选/.test(document.body.textContent ?? '')
    })`);
    if (noResults.rowCount !== 0 || !noResults.hasEmptyMessage || !noResults.hasClearAction) {
      throw new Error(`paperLibrary: no-results state failed: ${JSON.stringify(noResults)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'paper-library-no-results.png'), Buffer.from(shot.data, 'base64'))
    );
    await evaluateJson(client, `() => document.querySelector('button[aria-label="清空搜索"]')?.click()`);
    await wait(350);

    await evaluateJson(client, `() => {
      const row = [...document.querySelectorAll('[data-paper-library-row]')]
        .find((item) => /Missing Local PDF Recovery/.test(item.textContent ?? ''));
      row?.click();
      return Boolean(row);
    }`);
    await wait(350);
    const missingPath = await evaluateJson(client, `() => {
      const resume = document.querySelector('[data-paper-library-resume]');
      return {
        disabled: Boolean(resume?.disabled),
        text: resume?.textContent?.trim() ?? '',
        hasRecovery: /重新定位 \\/ 导入/.test(document.body.textContent ?? '')
      };
    }`);
    if (!missingPath.disabled || !/路径失效/.test(missingPath.text) || !missingPath.hasRecovery) {
      throw new Error(`paperLibrary: missing-path recovery failed: ${JSON.stringify(missingPath)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'paper-library-missing-path.png'), Buffer.from(shot.data, 'base64'))
    );

    const beforeCollapseWidth = snapshots[1440].libraryRect?.width ?? 0;
    await evaluateJson(client, `() => document.querySelector('button[title="折叠详情"]')?.click()`);
    await wait(250);
    const collapsed = await evaluateJson(client, `() => {
      const list = document.querySelector('[role="listbox"]')?.parentElement;
      return {
        hasInspector: Boolean(document.querySelector('[data-paper-library-inspector]')),
        libraryWidth: Math.round(list?.getBoundingClientRect().width ?? 0),
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
      };
    }`);
    if (collapsed.hasInspector || collapsed.libraryWidth <= beforeCollapseWidth || collapsed.hasHorizontalOverflow) {
      throw new Error(`paperLibrary: collapsed inspector should expand the list: ${JSON.stringify({ beforeCollapseWidth, collapsed })}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'paper-library-inspector-collapsed.png'), Buffer.from(shot.data, 'base64'))
    );

    const libraryStorage = await evaluateJson(client, `() => ({
      paperLibrary: localStorage.getItem('pdfTranslationReader:paperLibrary'),
      researchProjects: localStorage.getItem('pdfTranslationReader:researchProjects'),
      paperLibraryView: localStorage.getItem('pdfTranslationReader:paperLibraryView')
    })`);
    await client.send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('pdfTranslationReader:paperLibrary', '[]');
      `
    });
    await client.send('Page.reload', { ignoreCache: true });
    await wait(800);
    await waitForAppReady(client);
    await clickSidebarSection(client, 'library');
    await wait(450);
    const emptyLibrary = await evaluateJson(client, `() => {
      const page = document.querySelector('[data-paper-library-page]');
      const createProject = document.querySelector('[data-paper-library-empty-create-project]');
      const actions = createProject?.parentElement;
      const actionButtons = [...(actions?.querySelectorAll('button') ?? [])];
      const pageRect = page?.getBoundingClientRect();
      return {
        hasPage: Boolean(page),
        hasEmptyMessage: /还没有论文记录/.test(page?.textContent ?? ''),
        hasIndependentPathCopy: /两条路径互不依赖/.test(page?.textContent ?? ''),
        hasCreateProject: Boolean(createProject && createProject.getClientRects().length > 0),
        hasImportPaper: actionButtons.some((button) => /导入第一篇论文/.test(button.textContent ?? '')),
        actionsFit: actionButtons.every((button) => button.scrollWidth <= button.clientWidth + 3),
        pageWithinViewport: Boolean(pageRect && pageRect.left >= 0 && pageRect.right <= window.innerWidth),
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
      };
    }`);
    if (
      !emptyLibrary.hasPage ||
      !emptyLibrary.hasEmptyMessage ||
      !emptyLibrary.hasIndependentPathCopy ||
      !emptyLibrary.hasCreateProject ||
      !emptyLibrary.hasImportPaper ||
      !emptyLibrary.actionsFit ||
      !emptyLibrary.pageWithinViewport ||
      emptyLibrary.hasHorizontalOverflow
    ) {
      throw new Error(`paperLibrary: empty-state project entry failed: ${JSON.stringify(emptyLibrary)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'paper-library-empty.png'), Buffer.from(shot.data, 'base64'))
    );
    const emptyProjectDialogOpened = await evaluateJson(client, `() => {
      document.querySelector('[data-paper-library-empty-create-project]')?.click();
      return Boolean(document.querySelector('[data-paper-library-empty-create-project]'));
    }`);
    await wait(220);
    const emptyProjectDialog = await evaluateJson(client, `() => {
      const dialog = document.querySelector('[data-paper-library-create-project-dialog]');
      return {
        opened: Boolean(dialog),
        hasNoForcedPaperSelection: !dialog?.querySelector('input[type="checkbox"]'),
        hasProjectFields: Boolean(dialog?.querySelector('#paper-project-name') && dialog?.querySelector('#paper-project-description')),
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
      };
    }`);
    if (!emptyProjectDialogOpened || !emptyProjectDialog.opened || !emptyProjectDialog.hasNoForcedPaperSelection || !emptyProjectDialog.hasProjectFields || emptyProjectDialog.hasHorizontalOverflow) {
      throw new Error(`paperLibrary: empty-state create-project dialog failed: ${JSON.stringify(emptyProjectDialog)}`);
    }
    await evaluateJson(client, `() => document.querySelector('button[aria-label="关闭新建项目"]')?.click()`);

    await client.send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('pdfTranslationReader:paperLibrary', ${JSON.stringify(libraryStorage.paperLibrary)});
        localStorage.setItem('pdfTranslationReader:researchProjects', ${JSON.stringify(libraryStorage.researchProjects)});
        localStorage.setItem('pdfTranslationReader:paperLibraryView', ${JSON.stringify(libraryStorage.paperLibraryView)});
      `
    });
    await client.send('Page.reload', { ignoreCache: true });
    await wait(800);
    await waitForAppReady(client);
    await clickSidebarSection(client, 'library');
    await wait(350);

    return {
      snapshots,
      batchSnapshot,
      projectDialog,
      projectCreation,
      noResults,
      missingPath,
      collapsed,
      emptyLibrary,
      emptyProjectDialog
    };
  } finally {
    await client.send('Emulation.clearDeviceMetricsOverride');
  }
}

async function runHomeScenario(client) {
  const hub = await evaluateJson(client, `() => ({
    hasHome: Boolean(document.querySelector('.home-page')),
    hasResearchWorkbench: Boolean(document.querySelector('.research-workbench-page')),
    hasWorkbenchShell: Boolean(document.querySelector('.research-workbench-shell')),
    hasWorkflowBoard: Boolean(document.querySelector('.research-workflow-board')),
    hasWorkflowInspector: Boolean(document.querySelector('.research-workflow-inspector')),
    hasLegacyObjectPanel: Boolean(document.querySelector('.research-object-panel')),
    hasLegacyPipelinePanel: Boolean(document.querySelector('.research-pipeline-panel')),
    workflowColumns: [...document.querySelectorAll('.research-workflow-column')].map((item) => item.textContent?.trim()),
    workflowCards: [...document.querySelectorAll('.research-workflow-card')].map((item) => item.textContent?.trim()),
    workflowInspectorPanelCount: document.querySelectorAll('.research-workflow-inspector > .research-panel').length,
    hasInspectorShell: Boolean(document.querySelector('.research-inspector-shell')),
    nextActions: [...document.querySelectorAll('.research-next-action')].map((item) => item.textContent?.trim()),
    riskItems: [...document.querySelectorAll('.research-risk-list article')].map((item) => item.textContent?.trim()),
    commandTexts: [...document.querySelectorAll('.research-command-strip button')].map((button) => button.textContent?.trim()),
    sidebarDisclosure: {
      visibleSections: [...document.querySelectorAll('.app-sidebar-link[data-sidebar-section]')]
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => button.getAttribute('data-sidebar-section')),
      hiddenSections: [...document.querySelectorAll('.app-sidebar-link[data-sidebar-section]')]
        .filter((button) => button.getClientRects().length === 0)
        .map((button) => button.getAttribute('data-sidebar-section')),
      moreExpanded: document.querySelector('[data-sidebar-more-toggle]')?.getAttribute('aria-expanded') === 'true'
    },
    hasPaperTable: Boolean(document.querySelector('.paper-table')),
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
    adversarialLayout: (() => {
      const rect = (item) => {
        const box = item?.getBoundingClientRect();
        return box
          ? {
              left: Math.round(box.left),
              top: Math.round(box.top),
              right: Math.round(box.right),
              bottom: Math.round(box.bottom),
              width: Math.round(box.width),
              height: Math.round(box.height)
            }
          : null;
      };
      const isScrollable = (selector) => {
        const item = document.querySelector(selector);
        const style = item ? getComputedStyle(item) : null;
        return Boolean(
          item &&
            item.scrollHeight > item.clientHeight + 3 &&
            style &&
            !['visible', 'clip'].includes(style.overflowY)
        );
      };
      const overlaps = (left, right) =>
        Boolean(
          left &&
            right &&
            left.right > right.left + 2 &&
            left.left < right.right - 2 &&
            left.bottom > right.top + 2 &&
            left.top < right.bottom - 2
        );
      const nestedVerticalScrollers = [
        ['leftRail', '.research-workbench-rail'],
        ['mainColumn', '.research-workbench-main'],
        ['detailColumn', '.research-workbench-detail'],
        ['pipelineList', '.research-pipeline-list']
      ].filter(([, selector]) => isScrollable(selector)).map(([name]) => name);
      const cardLikeElements = [
        ...document.querySelectorAll(
          [
            '.research-kpi-list div',
            '.research-recent-paper',
            '.research-workflow-card',
            '.research-next-action',
            '.research-risk-list article'
          ].join(',')
        )
      ]
        .map((item) => {
          const style = getComputedStyle(item);
          const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
          const borderWidth = Number.parseFloat(style.borderTopWidth) || 0;
          const background = style.backgroundColor;
          const box = item.getBoundingClientRect();
          return {
            className: String(item.className),
            radius,
            borderWidth,
            background,
            width: Math.round(box.width),
            height: Math.round(box.height),
            text: (item.textContent ?? '').trim().slice(0, 80)
          };
        })
        .filter(
          (item) =>
            item.radius > 4 &&
            item.borderWidth > 0 &&
            !['rgba(0, 0, 0, 0)', 'transparent'].includes(item.background)
        );
      const workflowBoard = document.querySelector('.research-workflow-board');
      const workflowCardRects = [...document.querySelectorAll('.research-workflow-card')].map((item) => {
        const box = item.getBoundingClientRect();
        return {
          text: (item.textContent ?? '').trim().slice(0, 100),
          width: Math.round(box.width),
          height: Math.round(box.height),
          scrollWidth: item.scrollWidth,
          clientWidth: item.clientWidth,
          scrollHeight: item.scrollHeight,
          clientHeight: item.clientHeight
        };
      });
      const workflowCardTextOverlaps = [...document.querySelectorAll('.research-workflow-card')]
        .map((card) => ({
          text: (card.textContent ?? '').trim().slice(0, 100),
          title: rect(card.querySelector(':scope > strong')),
          detail: rect(card.querySelector(':scope > p')),
          foot: rect(card.querySelector('.research-workflow-card-foot'))
        }))
        .filter((item) => overlaps(item.title, item.detail) || overlaps(item.detail, item.foot));
      const nextActionOverlaps = [...document.querySelectorAll('.research-next-action')]
        .map((button) => ({
          text: (button.textContent ?? '').trim(),
          copy: rect(button.querySelector('span')),
          action: rect(button.querySelector('em'))
        }))
        .filter((item) => overlaps(item.copy, item.action));
      const clippedNextActions = (() => {
        const panel = document.querySelector('.research-next-actions');
        const panelBox = panel?.getBoundingClientRect();
        if (!panelBox) {
          return [];
        }
        return [...document.querySelectorAll('.research-next-action')]
          .map((item) => {
            const itemBox = item.getBoundingClientRect();
            return {
              text: (item.textContent ?? '').trim().slice(0, 100),
              top: Math.round(itemBox.top),
              bottom: Math.round(itemBox.bottom),
              height: Math.round(itemBox.height),
              panelTop: Math.round(panelBox.top),
              panelBottom: Math.round(panelBox.bottom)
            };
          })
          .filter((item) => item.top < item.panelTop - 2 || item.bottom > item.panelBottom + 2 || item.height < 30);
      })();
      const recentTextOverlaps = [...document.querySelectorAll('.research-recent-paper')]
        .map((button) => ({
          text: (button.textContent ?? '').trim(),
          title: rect(button.querySelector('span')),
          meta: rect(button.querySelector('small'))
        }))
        .filter((item) => overlaps(item.title, item.meta));
      const clippedRiskItems = (() => {
        const panel = document.querySelector('.research-risk-panel');
        const panelBox = panel?.getBoundingClientRect();
        if (!panelBox) {
          return [];
        }
        return [...document.querySelectorAll('.research-risk-list article')]
          .map((item) => {
            const itemBox = item.getBoundingClientRect();
            return {
              text: (item.textContent ?? '').trim().slice(0, 100),
              top: Math.round(itemBox.top),
              bottom: Math.round(itemBox.bottom),
              height: Math.round(itemBox.height),
              panelTop: Math.round(panelBox.top),
              panelBottom: Math.round(panelBox.bottom)
            };
          })
          .filter((item) => item.top < item.panelTop - 2 || item.bottom > item.panelBottom + 2 || item.height < 34);
      })();
      const recentPanelExcessHeight = (() => {
        const panel = document.querySelector('.research-workbench-rail .research-panel:nth-of-type(2)');
        const rows = [...document.querySelectorAll('.research-recent-paper')];
        if (!panel || rows.length === 0) {
          return 0;
        }
        const panelBox = panel.getBoundingClientRect();
        const contentBottom = Math.max(...rows.map((row) => row.getBoundingClientRect().bottom));
        return Math.round(panelBox.bottom - contentBottom);
      })();
      const channelDelta = (value) => {
        const matches = [...String(value).matchAll(/rgba?\\(([^)]+)\\)/g)];
        const deltas = matches.map((match) => {
          const channels = match[1].match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
          return Math.max(...channels) - Math.min(...channels);
        });
        return deltas.length > 0 ? Math.max(...deltas) : 0;
      };
      const sidebarActiveStyles = (() => {
        const item = document.querySelector('.app-sidebar-link.active');
        const style = item ? getComputedStyle(item) : null;
        const values = style
          ? [style.backgroundColor, style.borderTopColor, style.borderLeftColor, style.boxShadow]
          : [];
        return {
          background: style?.backgroundColor ?? '',
          borderTopColor: style?.borderTopColor ?? '',
          borderLeftColor: style?.borderLeftColor ?? '',
          boxShadow: style?.boxShadow ?? '',
          maxChannelDelta: values.reduce((max, value) => Math.max(max, channelDelta(value)), 0)
        };
      })();
      return {
        nestedVerticalScrollers,
        pageVerticalOverflow: (() => {
          const page = document.querySelector('.home-page.research-workbench-page');
          return page ? page.scrollHeight > page.clientHeight + 3 : false;
        })(),
        pageScroll: (() => {
          const page = document.querySelector('.home-page.research-workbench-page');
          return page
            ? {
                scrollHeight: page.scrollHeight,
                clientHeight: page.clientHeight,
                offsetHeight: page.offsetHeight
              }
            : null;
        })(),
        cardLikeCount: cardLikeElements.length,
        cardLikeElements: cardLikeElements.slice(0, 12),
        workflowBoardHorizontalOverflow: workflowBoard ? workflowBoard.scrollWidth > workflowBoard.clientWidth + 3 : true,
        workflowMinCardWidth: workflowCardRects.reduce((min, item) => Math.min(min, item.width), Number.POSITIVE_INFINITY),
        workflowCardOverflowCount: workflowCardRects.filter(
          (item) => item.scrollWidth > item.clientWidth + 3 || item.scrollHeight > item.clientHeight + 3
        ).length,
        workflowCardRects,
        workflowCardTextOverlapCount: workflowCardTextOverlaps.length,
        workflowCardTextOverlaps,
        nextActionOverlapCount: nextActionOverlaps.length,
        nextActionOverlaps,
        clippedNextActionCount: clippedNextActions.length,
        clippedNextActions,
        recentTextOverlapCount: recentTextOverlaps.length,
        recentTextOverlaps,
        clippedRiskCount: clippedRiskItems.length,
        clippedRiskItems,
        statusBadgeBackgrounds: [
          ...document.querySelectorAll(
            [
              '.research-workflow-column-head em',
              '.research-workflow-card-state',
              '.research-inspector-status'
            ].join(',')
          )
        ].map((item) => {
          const background = getComputedStyle(item).backgroundColor;
          const channels = background.match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
          return {
            text: (item.textContent ?? '').trim(),
            background,
            channelDelta: Math.max(...channels) - Math.min(...channels)
          };
        }),
        recentPanelExcessHeight,
        sidebarActiveStyles,
        eyebrowColor: getComputedStyle(document.querySelector('.research-workbench-title .eyebrow') ?? document.body)
          .color,
        shellRect: rect(document.querySelector('.research-workbench-shell')),
        detailRect: rect(document.querySelector('.research-workbench-detail')),
        detailEscapesShell: (() => {
          const shell = document.querySelector('.research-workbench-shell');
          const detail = document.querySelector('.research-workbench-detail');
          const shellBox = shell?.getBoundingClientRect();
          const detailBox = detail?.getBoundingClientRect();
          return Boolean(shellBox && detailBox && detailBox.right > shellBox.right + 3);
        })(),
        detailFoldedBelowMain: (() => {
          const main = document.querySelector('.research-workbench-main');
          const detail = document.querySelector('.research-workbench-detail');
          const mainBox = main?.getBoundingClientRect();
          const detailBox = detail?.getBoundingClientRect();
          return Boolean(mainBox && detailBox && detailBox.top > mainBox.top + 24);
        })(),
        pipelineRect: rect(document.querySelector('.research-pipeline-list')),
        motionAudit: (() => {
          const maxDurationSeconds = (value) =>
            String(value)
              .split(',')
              .reduce((max, part) => {
                const text = part.trim();
                if (!text) return max;
                if (text.endsWith('ms')) return Math.max(max, Number.parseFloat(text) / 1000);
                if (text.endsWith('s')) return Math.max(max, Number.parseFloat(text));
                return max;
              }, 0);
          const stylesheetContains = (needle) =>
            [...document.styleSheets].some((sheet) => {
              try {
                return [...sheet.cssRules].some((rule) => String(rule.cssText).includes(needle));
              } catch {
                return false;
              }
            });
          const appMain = document.querySelector('.app-main');
          const appMainStyle = appMain ? getComputedStyle(appMain) : null;
          const hoverTargets = [
            ...document.querySelectorAll(
              [
                '.research-workflow-card',
                '.research-next-action',
                '.app-sidebar-link',
                '.primary-button',
                '.secondary-button'
              ].join(',')
            )
          ].filter((item) => maxDurationSeconds(getComputedStyle(item).transitionDuration) >= 0.12);
          return {
            prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            hasReducedMotionRule: stylesheetContains('prefers-reduced-motion: reduce'),
            hasViewKeyframe: stylesheetContains('ft-view-enter'),
            hasPanelKeyframe: stylesheetContains('ft-panel-enter'),
            hasStatusSheenRule: stylesheetContains('ft-status-sheen'),
            appMainTransitionSeconds: appMainStyle ? maxDurationSeconds(appMainStyle.transitionDuration) : 0,
            hoverMotionTargetCount: hoverTargets.length
          };
        })()
      };
    })(),
    headerActions: [...document.querySelectorAll('.research-workbench-actions button')].map((button) => button.textContent?.trim()),
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

  if (
    !hub.hasHome ||
    !hub.hasResearchWorkbench ||
    !hub.hasWorkbenchShell ||
    !hub.hasWorkflowBoard ||
    !hub.hasWorkflowInspector ||
    hub.hasLegacyObjectPanel ||
    hub.hasLegacyPipelinePanel ||
    hub.hasPaperTable ||
    hub.sidebarDisclosure.moreExpanded ||
    hub.sidebarDisclosure.visibleSections.join(',') !==
      'workspace,arxiv,library,reader,experimentMatrix,researchSheet,plot,settings' ||
    hub.sidebarDisclosure.hiddenSections.join(',') !== 'knowledgeGraph,presentation,paperTutor,ai' ||
    hub.hasHorizontalOverflow
  ) {
    throw new Error(`home: expected workflow board workbench before entering a module, got ${JSON.stringify(hub)}`);
  }
  if (
    hub.adversarialLayout.nestedVerticalScrollers.length > 0 ||
    hub.adversarialLayout.pageVerticalOverflow ||
    hub.adversarialLayout.cardLikeCount > 24 ||
    hub.adversarialLayout.workflowBoardHorizontalOverflow ||
    hub.adversarialLayout.workflowMinCardWidth < 180 ||
    hub.adversarialLayout.workflowCardOverflowCount > 0 ||
    hub.adversarialLayout.workflowCardTextOverlapCount > 0 ||
    hub.adversarialLayout.nextActionOverlapCount > 0 ||
    hub.adversarialLayout.clippedNextActionCount > 0 ||
    hub.adversarialLayout.recentTextOverlapCount > 0 ||
    hub.adversarialLayout.clippedRiskCount > 0 ||
    hub.adversarialLayout.detailEscapesShell ||
    hub.adversarialLayout.detailFoldedBelowMain ||
    hub.adversarialLayout.recentPanelExcessHeight > 160 ||
    hub.adversarialLayout.sidebarActiveStyles.maxChannelDelta > 80 ||
    hub.workflowInspectorPanelCount !== 1 ||
    !hub.hasInspectorShell ||
    !hub.adversarialLayout.motionAudit.hasReducedMotionRule ||
    !hub.adversarialLayout.motionAudit.hasViewKeyframe ||
    !hub.adversarialLayout.motionAudit.hasPanelKeyframe ||
    !hub.adversarialLayout.motionAudit.hasStatusSheenRule ||
    (!hub.adversarialLayout.motionAudit.prefersReducedMotion &&
      (hub.adversarialLayout.motionAudit.appMainTransitionSeconds < 0.18 ||
        hub.adversarialLayout.motionAudit.appMainTransitionSeconds > 0.35 ||
        hub.adversarialLayout.motionAudit.hoverMotionTargetCount < 4)) ||
    hub.adversarialLayout.statusBadgeBackgrounds.some((item) => item.channelDelta > 24) ||
    /128,\s*118,\s*255|99,\s*91,\s*255|purple/i.test(hub.adversarialLayout.eyebrowColor)
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'home-adversarial-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`home: adversarial visual review failed, got ${JSON.stringify(hub.adversarialLayout)}`);
  }
  if (
    hub.workflowColumns.length < 4 ||
    hub.workflowCards.length < 4 ||
    hub.nextActions.length < 2 ||
    hub.riskItems.length < 3 ||
    !hub.commandTexts.includes('实验矩阵') ||
    !hub.commandTexts.includes('证据图谱')
  ) {
    throw new Error(`home: expected workflow cards, inspector risks and commands, got ${JSON.stringify(hub)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'home.png'), Buffer.from(shot.data, 'base64'))
  );

  await clickSidebarSection(client, 'library');
  const library = await capturePaperLibraryResponsiveWidths(client);
  if (!hub.imageAlpha || hub.imageAlpha.some((alpha) => alpha !== 0)) {
    throw new Error(`home: expected transparent icon corners, got ${JSON.stringify(hub.imageAlpha)}`);
  }
  if (
    !['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'].includes(hub.markStyle?.background) ||
    !/^(0px|0\.8px|1px)$/u.test(hub.markStyle?.border ?? '') ||
    hub.markStyle?.boxShadow !== 'none' ||
    Number.parseFloat(hub.markStyle?.borderRadius ?? '99') > 12
  ) {
    throw new Error(`home: expected restrained icon wrapper without shadow, got ${JSON.stringify(hub.markStyle)}`);
  }

  await clickSidebarSection(client, 'workspace');
  return { hub, library };
}

async function runExperimentMatrixScenario(client) {
  await clickSidebarSection(client, 'experimentMatrix');
  await waitForAppReady(client);
  await wait(700);

  const snapshot = await evaluateJson(client, `() => {
    const page = document.querySelector('.experiment-matrix-page');
    const header = document.querySelector('.experiment-matrix-header');
    const summary = document.querySelector('.experiment-matrix-summary');
    const sourceStrip = document.querySelector('.experiment-matrix-source-strip');
    const toolbar = document.querySelector('.experiment-matrix-toolbar');
    const tableWrap = document.querySelector('.experiment-matrix-table-wrap');
    const table = document.querySelector('.experiment-matrix-table');
    const detail = document.querySelector('.experiment-matrix-detail');
    const activeSidebar = document.querySelector('.app-sidebar-link.active');
    const pageRect = page?.getBoundingClientRect();
    const tableWrapRect = tableWrap?.getBoundingClientRect();
    const detailRect = detail?.getBoundingClientRect();
    const channelDelta = (background) => {
      const channels = background.match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      return Math.max(...channels) - Math.min(...channels);
    };
    const actionButtons = [...document.querySelectorAll('.experiment-matrix-actions button')].map((button) => {
      const rect = button.getBoundingClientRect();
      const background = window.getComputedStyle(button).backgroundColor;
      return {
        text: (button.textContent ?? '').trim(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scrollWidth: button.scrollWidth,
        clientWidth: button.clientWidth,
        wraps: button.scrollHeight > button.clientHeight + 3,
        background,
        channelDelta: channelDelta(background),
        isPrimary: button.classList.contains('primary-button')
      };
    });
    const experimentBadgeBackgrounds = [...document.querySelectorAll('.experiment-badge')].map((badge) => {
      const background = window.getComputedStyle(badge).backgroundColor;
      return {
        text: (badge.textContent ?? '').trim(),
        background,
        channelDelta: channelDelta(background)
      };
    });
    return {
      hasPage: Boolean(page && header && summary && sourceStrip && toolbar && tableWrap && table && detail),
      activeSidebar: activeSidebar?.getAttribute('data-sidebar-section') ?? '',
      titleText: document.querySelector('.experiment-matrix-title')?.textContent ?? '',
      sourceStripText: sourceStrip?.textContent ?? '',
      summaryText: summary?.textContent ?? '',
      rowCount: document.querySelectorAll('.experiment-matrix-table tbody tr').length,
      detailText: detail?.textContent ?? '',
      hasStatusActions: document.querySelectorAll('.experiment-detail-status button').length >= 4,
      hasEvidencePanel: Boolean(document.querySelector('.experiment-evidence-panel')),
      hasResearchSheetButton: actionButtons.some((button) => /研究表格/.test(button.text)),
      hasMarkdownButton: actionButtons.some((button) => /Markdown/.test(button.text)),
      hasMethodCardMergeButton: Boolean(sourceStrip?.textContent?.includes('从方法卡合并')),
      actionButtons,
      experimentBadgeBackgrounds,
      tableWrapScrollbarColor: tableWrap ? window.getComputedStyle(tableWrap).scrollbarColor : '',
      hasDocumentHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
      hasPageHorizontalOverflow: page ? page.scrollWidth > page.clientWidth + 3 : true,
      tableOverflowScoped: tableWrap ? tableWrap.scrollWidth >= tableWrap.clientWidth : false,
      tableWrapRect: tableWrapRect
        ? {
            left: Math.round(tableWrapRect.left),
            right: Math.round(tableWrapRect.right),
            width: Math.round(tableWrapRect.width),
            height: Math.round(tableWrapRect.height)
          }
        : null,
      detailRect: detailRect
        ? {
            left: Math.round(detailRect.left),
            right: Math.round(detailRect.right),
            width: Math.round(detailRect.width),
            height: Math.round(detailRect.height)
          }
        : null,
      pageRect: pageRect
        ? {
            left: Math.round(pageRect.left),
            right: Math.round(pageRect.right),
            width: Math.round(pageRect.width),
            height: Math.round(pageRect.height)
          }
        : null
    };
  }`);

  if (
    !snapshot.hasPage ||
    snapshot.activeSidebar !== 'experimentMatrix' ||
    snapshot.rowCount < 1 ||
    !/独立于研究表格/.test(snapshot.titleText) ||
    !/1 张方法卡/.test(snapshot.sourceStripText) ||
    !/可合并 3 行实验/.test(snapshot.sourceStripText) ||
    !/证据覆盖/.test(snapshot.summaryText) ||
    !/CBF safety layer/.test(snapshot.detailText) ||
    !snapshot.hasStatusActions ||
    !snapshot.hasEvidencePanel ||
    !snapshot.hasResearchSheetButton ||
    !snapshot.hasMarkdownButton ||
    !snapshot.hasMethodCardMergeButton ||
    snapshot.hasDocumentHorizontalOverflow ||
    snapshot.hasPageHorizontalOverflow
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'experiment-matrix-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`experimentMatrix: expected independent dense matrix view, got ${JSON.stringify(snapshot)}`);
  }

  const brokenButton = snapshot.actionButtons.find((button) => button.wraps || button.scrollWidth > button.clientWidth + 3);
  if (brokenButton) {
    throw new Error(`experimentMatrix: header action text wraps or clips, got ${JSON.stringify({ brokenButton, snapshot })}`);
  }

  const plasticButton = snapshot.actionButtons.find((button) => button.isPrimary && button.channelDelta > 40);
  const plasticBadge = snapshot.experimentBadgeBackgrounds.find((badge) => badge.channelDelta > 24);
  if (plasticButton || plasticBadge) {
    throw new Error(
      `experimentMatrix: high-saturation button or badge found, got ${JSON.stringify({
        plasticButton,
        plasticBadge,
        actionButtons: snapshot.actionButtons,
        experimentBadgeBackgrounds: snapshot.experimentBadgeBackgrounds
      })}`
    );
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'experiment-matrix.png'), Buffer.from(shot.data, 'base64'))
  );

  return snapshot;
}

async function runResearchSheetScenario(client) {
  await clickSidebarSection(client, 'researchSheet');
  await waitForAppReady(client);
  const canvasStatus = await waitForResearchSheetCanvas(client);
  await rightClickResearchSheetCanvas(client);

  const snapshot = await evaluateJson(client, `() => {
    const rect = (item) => {
      const box = item?.getBoundingClientRect();
      return box
        ? {
            left: Math.round(box.left),
            top: Math.round(box.top),
            right: Math.round(box.right),
            width: Math.round(box.width),
            height: Math.round(box.height)
          }
        : null;
    };
    const page = document.querySelector('.research-sheet-page');
    const header = document.querySelector('.research-sheet-header');
    const commandBar = document.querySelector('.research-command-bar');
    const commandActions = document.querySelector('.research-command-actions');
    const contextStrip = document.querySelector('.research-context-strip');
    const formatToolbar = document.querySelector('.research-format-toolbar');
    const sheetSurface = document.querySelector('.research-sheet-surface');
    const univerContainer = document.querySelector('#ftranslate-research-univer-container');
    const pageRect = page?.getBoundingClientRect();
    const univerRect = univerContainer?.getBoundingClientRect();
    return {
      hasResearchSheet: Boolean(page),
      hasUniver: Boolean(document.querySelector('.univer-container')),
      commandText: commandBar?.textContent ?? '',
      hasAiButton: [...document.querySelectorAll('button')].some((button) => /AI 填(此单元格|选区)/.test(button.textContent ?? '')),
      hasBindingToggle: [...document.querySelectorAll('button')].some((button) => /绑定|解除绑定|更新绑定/.test(button.textContent ?? '')),
      formatToolbarText: formatToolbar?.textContent ?? '',
      formatToolbarTitles: [...document.querySelectorAll('.research-format-toolbar button')]
        .map((button) => button.getAttribute('title') || button.getAttribute('aria-label') || (button.textContent ?? '').trim()),
      contextMenuText: document.body.textContent ?? '',
      titleText: header?.textContent ?? '',
      headerActionTitles: [...document.querySelectorAll('.research-sheet-actions button')]
        .map((button) => button.getAttribute('title') || button.getAttribute('aria-label') || (button.textContent ?? '').trim()),
      layoutMetrics: {
        pageRect: rect(page),
        headerRect: rect(header),
        commandRect: rect(commandBar),
        commandActionsRect: rect(commandActions),
        contextRect: rect(contextStrip),
        formatRect: rect(formatToolbar),
        sheetSurfaceRect: rect(sheetSurface),
        univerRect: rect(univerContainer),
        chromeHeight: pageRect && univerRect ? Math.round(univerRect.top - pageRect.top) : null,
        commandActionsOverflow: commandActions ? commandActions.scrollWidth > commandActions.clientWidth + 3 : false,
        formatToolbarOverflow: formatToolbar ? formatToolbar.scrollWidth > formatToolbar.clientWidth + 3 : false,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
      },
      markStyle: (() => {
        const mark = document.querySelector('.research-sheet-title img');
        if (!mark) return null;
        const style = getComputedStyle(mark);
        return { background: style.backgroundColor, border: style.borderTopWidth, boxShadow: style.boxShadow };
      })(),
      canvasStatus: ${JSON.stringify(canvasStatus)}
    };
  }`);

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
  if (
    (snapshot.layoutMetrics.chromeHeight ?? 999) > 205 ||
    snapshot.layoutMetrics.commandActionsOverflow ||
    snapshot.layoutMetrics.formatToolbarOverflow ||
    snapshot.layoutMetrics.hasHorizontalOverflow
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'research-sheet-density-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`researchSheet: toolbar area is too dense or clipped, got ${JSON.stringify(snapshot.layoutMetrics)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'research-sheet.png'), Buffer.from(shot.data, 'base64'))
  );
  return snapshot;
}

async function runWholePdfReaderScenario(client) {
  await clickSidebarSection(client, 'library');
  await wait(350);
  const preparedLibrarySelection = await evaluateJson(client, `() => {
    document.querySelector('[data-paper-library-row]')?.click();
    const expandInspector = document.querySelector('button[title="展开详情"]');
    expandInspector?.click();
    return Boolean(document.querySelector('[data-paper-library-row]'));
  }`);
  if (!preparedLibrarySelection) {
    throw new Error('wholePdf: paper library row not found');
  }
  await wait(350);
  const openedFromLibrary = await evaluateJson(client, `() => {
    const resume = document.querySelector('[data-paper-library-resume]');
    const opened = Boolean(resume && !resume.disabled);
    const startedAt = performance.now();
    if (opened) resume.click();
    return { opened, startedAt };
  }`);
  if (!openedFromLibrary.opened) {
    throw new Error('wholePdf: paper library resume action not found');
  }
  await waitForAppReady(client);
  const pdfCanvasStatus = await waitForPdfCanvas(client);
  const firstRenderMs = Math.max(0, Math.round(pdfCanvasStatus.observedAt - openedFromLibrary.startedAt));
  if (firstRenderMs > pdfFirstRenderBudgetMs) {
    throw new Error(`wholePdf: first PDF render exceeded ${pdfFirstRenderBudgetMs} ms budget, got ${firstRenderMs} ms`);
  }
  const initialPdfCenter = await readPdfInitialCenterLayout(client, 'initial-reader');
  if (
    !initialPdfCenter.hasPage ||
    !initialPdfCenter.fullyVisibleHorizontally ||
    !initialPdfCenter.isFitWidth ||
    initialPdfCenter.hiddenDelta > 4
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'whole-pdf-initial-center-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`wholePdf: initial PDF page should be horizontally centered, got ${JSON.stringify(initialPdfCenter)}`);
  }

  const wholePdf = await evaluateJson(client, `() => ({
    hasPanel: Boolean(document.querySelector('.whole-pdf-panel')),
    panelText: document.querySelector('.whole-pdf-panel')?.textContent ?? '',
    activeToggle: [...document.querySelectorAll('.pdf-view-toggle button')]
      .find((button) => button.classList.contains('active'))?.textContent?.trim() ?? '',
    displayedStatus: document.querySelector('.whole-pdf-header > span')?.textContent?.trim() ?? '',
    hasPdfCanvas: ${JSON.stringify(pdfCanvasStatus.hasRenderablePdf)},
    hasDualToggle: [...document.querySelectorAll('.pdf-view-toggle button')]
      .some((button) => /双语 PDF/.test(button.textContent ?? '')),
    pdfCanvasCount: ${JSON.stringify(pdfCanvasStatus.canvasCount)},
    secondaryActionsCollapsed: !document.querySelector('[data-testid="pdf-secondary-actions"]')?.open,
    visibleActionButtonCount: [...document.querySelectorAll('.whole-pdf-actions button')]
      .filter((button) => button.getClientRects().length > 0).length,
    hasGenerateButton: [...document.querySelectorAll('.whole-pdf-panel button')]
      .some((button) => /生成双语 PDF/.test(button.textContent ?? '')),
    hasImportButton: [...document.querySelectorAll('.whole-pdf-panel button')]
      .some((button) => /导入中文\\/双语 PDF/.test(button.textContent ?? ''))
  })`);

  if (
    !wholePdf.hasPanel ||
    wholePdf.activeToggle !== '原文 PDF' ||
    !wholePdf.displayedStatus.includes(path.basename(pdfPath)) ||
    !wholePdf.hasPdfCanvas ||
    !wholePdf.hasDualToggle ||
    !wholePdf.hasGenerateButton ||
    !wholePdf.hasImportButton ||
    !wholePdf.secondaryActionsCollapsed ||
    wholePdf.visibleActionButtonCount !== 5
  ) {
    throw new Error(`wholePdf: expected source-first PDF reading surface, got ${JSON.stringify(wholePdf)}`);
  }

  let dualReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    dualReady = await evaluateJson(client, `() => {
      const button = [...document.querySelectorAll('.pdf-view-toggle button')]
        .find((item) => /双语 PDF/.test(item.textContent ?? ''));
      if (!button || button.disabled) return false;
      button.click();
      return true;
    }`);
    if (dualReady) break;
    await wait(100);
  }
  if (!dualReady) throw new Error('wholePdf: background bilingual PDF resource did not become available');
  await waitForPdfCanvas(client);
  const dualSnapshot = await evaluateJson(client, `() => ({
    activeToggle: [...document.querySelectorAll('.pdf-view-toggle button')]
      .find((button) => button.classList.contains('active'))?.textContent?.trim() ?? '',
    displayedStatus: document.querySelector('.whole-pdf-header > span')?.textContent?.trim() ?? ''
  })`);
  if (dualSnapshot.activeToggle !== '双语 PDF' || !/visual-check-dual\.pdf/.test(dualSnapshot.displayedStatus)) {
    throw new Error(`wholePdf: bilingual PDF did not switch after background load, got ${JSON.stringify(dualSnapshot)}`);
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

  await clickButtonByText(client, '左右双语');
  await waitForPdfCanvas(client);
  const parallelSidebar = await readWholePdfSidebarLayout(client, 'parallel-expanded');
  if (
    parallelSidebar.activeToggle !== '左右双语' ||
    parallelSidebar.actionOverflowCount > 0 ||
    parallelSidebar.panelOverflow ||
    parallelSidebar.actionsOverflow ||
    parallelSidebar.figureGridOverflow ||
    parallelSidebar.sidePanelOverflow ||
    parallelSidebar.hasHorizontalOverflow ||
    (parallelSidebar.paneRect?.width ?? 0) < 260
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'whole-pdf-parallel-sidebar-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`wholePdf: parallel sidebar is clipped or too narrow, got ${JSON.stringify(parallelSidebar)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-parallel-reader.png'), Buffer.from(shot.data, 'base64'))
  );

  await dragReaderSidebarToRatio(client, 0.2);
  const narrowSidebar = await readWholePdfSidebarLayout(client, 'parallel-narrow');
  if (
    narrowSidebar.activeToggle !== '左右双语' ||
    narrowSidebar.actionOverflowCount > 0 ||
    narrowSidebar.panelOverflow ||
    narrowSidebar.actionsOverflow ||
    narrowSidebar.figureGridOverflow ||
    narrowSidebar.sidePanelOverflow ||
    narrowSidebar.hasHorizontalOverflow ||
    (narrowSidebar.paneRect?.width ?? 0) < 260 ||
    (narrowSidebar.paneRect?.width ?? 999) > 360
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'whole-pdf-narrow-sidebar-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`wholePdf: resized narrow sidebar should reflow without clipping, got ${JSON.stringify(narrowSidebar)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-narrow-sidebar.png'), Buffer.from(shot.data, 'base64'))
  );

  await dragReaderSidebarToRatio(client, 0.42);
  const wideSidebar = await readWholePdfSidebarLayout(client, 'parallel-wide');
  if (
    wideSidebar.activeToggle !== '左右双语' ||
    wideSidebar.actionOverflowCount > 0 ||
    wideSidebar.panelOverflow ||
    wideSidebar.actionsOverflow ||
    wideSidebar.figureGridOverflow ||
    wideSidebar.sidePanelOverflow ||
    wideSidebar.hasHorizontalOverflow ||
    (wideSidebar.paneRect?.width ?? 0) < 440
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'whole-pdf-wide-sidebar-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`wholePdf: resized wide sidebar should expand its contents without clipping, got ${JSON.stringify(wideSidebar)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-wide-sidebar.png'), Buffer.from(shot.data, 'base64'))
  );

  await clickButtonByText(client, '收起侧栏');
  await wait(350);
  const collapsedSidebar = await readWholePdfSidebarLayout(client, 'parallel-collapsed');
  if (
    !collapsedSidebar.isCollapsed ||
    (collapsedSidebar.paneRect?.width ?? 999) > 48 ||
    (collapsedSidebar.toggleRect?.width ?? 999) > 38 ||
    (collapsedSidebar.toggleRect?.height ?? 999) > 112 ||
    collapsedSidebar.hasHorizontalOverflow
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'whole-pdf-collapsed-sidebar-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`wholePdf: collapsed sidebar rail is too large, got ${JSON.stringify(collapsedSidebar)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-collapsed-sidebar.png'), Buffer.from(shot.data, 'base64'))
  );

  await clickButtonByText(client, '展开侧栏');
  await wait(350);

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-reader.png'), Buffer.from(shot.data, 'base64'))
  );

  await waitForExtractedPdfBlocks(client);
  await clickButtonByText(client, '提取 PDF 图表');
  let figureExtraction = null;
  const figureExtractionAttempts = requireNativeFigureExtraction ? 240 : 90;
  for (let attempt = 0; attempt < figureExtractionAttempts; attempt += 1) {
    figureExtraction = await evaluateJson(client, `() => {
      const workspace = document.querySelector('[data-testid="pdf-figure-workspace"]');
      const assets = [...document.querySelectorAll('[data-figure-card]')];
      const readyAssets = assets.filter((asset) => Boolean(asset.querySelector('.figure-assets-thumbnail img')));
      const panelText = workspace?.textContent ?? '';
      const workspaceRect = workspace?.getBoundingClientRect();
      const layoutRect = workspace?.querySelector('.figure-assets-layout')?.getBoundingClientRect();
      const firstCardRect = assets[0]?.getBoundingClientRect();
      const inspectorPreviewRect = workspace?.querySelector('.figure-assets-preview')?.getBoundingClientRect();
      return {
        hasPanel: Boolean(workspace),
        assetCount: assets.length,
        readyCount: readyAssets.length,
        nativeCount: panelText.includes('PDF 内嵌图像') ? 1 : 0,
        compositeCount: panelText.includes('PDF 内嵌图像组合') ? 1 : 0,
        cropCount: panelText.includes('完整页面渲染裁剪') ? 1 : 0,
        panelText,
        statusText: document.body.textContent ?? '',
        workspaceWithinViewport: Boolean(workspaceRect && workspaceRect.left >= 0 && workspaceRect.right <= window.innerWidth && workspaceRect.top >= 0 && workspaceRect.bottom <= window.innerHeight),
        contentVisible: Boolean(
          workspaceRect &&
          layoutRect &&
          firstCardRect &&
          inspectorPreviewRect &&
          layoutRect.height >= Math.min(320, workspaceRect.height * 0.5) &&
          firstCardRect.height >= 120 &&
          inspectorPreviewRect.height >= 160
        ),
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3 || Boolean(workspace && workspace.scrollWidth > workspace.clientWidth + 3)
      };
    }`);
    const hasFigurePanelLayout = figureExtraction.hasPanel && figureExtraction.assetCount >= 1 && figureExtraction.workspaceWithinViewport && figureExtraction.contentVisible && !figureExtraction.hasHorizontalOverflow;
    const hasReadyFigure = figureExtraction.readyCount >= Math.min(3, figureExtraction.assetCount);
    if (hasFigurePanelLayout && hasReadyFigure) {
      break;
    }
    await wait(500);
  }

  if (
    !figureExtraction?.hasPanel ||
    figureExtraction.assetCount < 1 ||
    figureExtraction.readyCount < Math.min(3, figureExtraction.assetCount) ||
    !figureExtraction.workspaceWithinViewport ||
    !figureExtraction.contentVisible ||
    figureExtraction.hasHorizontalOverflow ||
    (requireNativeFigureExtraction && figureExtraction.readyCount < 1)
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'whole-pdf-figures-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`wholePdf: expected PDF figure panel without layout overflow, got ${JSON.stringify(figureExtraction)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-figures.png'), Buffer.from(shot.data, 'base64'))
  );
  const extractedFigureDataUrls = await evaluateJson(client, `() => [...document.querySelectorAll('[data-figure-card] .figure-assets-thumbnail img')]
    .slice(0, 3)
    .map((image) => image.getAttribute('src') ?? '')`);
  for (let index = 0; index < extractedFigureDataUrls.length; index += 1) {
    const dataUrl = extractedFigureDataUrls[index];
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) continue;
    await writeFile(
      path.join(outputDir, `pdf-figure-extracted-${index + 1}.png`),
      Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
    );
  }

  let completedFigureExtraction = null;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    completedFigureExtraction = await evaluateJson(client, `() => {
      const workspace = document.querySelector('[data-testid="pdf-figure-workspace"]');
      const actions = [...(workspace?.querySelectorAll('.figure-assets-header-actions button') ?? [])];
      const isExtracting = actions.some((button) => (button.textContent ?? '').trim() === '取消');
      const cards = [...(workspace?.querySelectorAll('[data-figure-card]') ?? [])];
      const readyCount = cards.filter((card) => card.querySelector('.figure-assets-thumbnail img')).length;
      const workspaceRect = workspace?.getBoundingClientRect();
      const layoutRect = workspace?.querySelector('.figure-assets-layout')?.getBoundingClientRect();
      return {
        isExtracting,
        cardCount: cards.length,
        readyCount,
        progressText: workspace?.querySelector('.figure-assets-header > div:first-child span')?.textContent ?? '',
        contentVisible: Boolean(workspaceRect && layoutRect && workspaceRect.height > 400 && layoutRect.height > 300),
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3 || Boolean(workspace && workspace.scrollWidth > workspace.clientWidth + 3)
      };
    }`);
    if (!completedFigureExtraction.isExtracting) break;
    await wait(500);
  }
  if (
    !completedFigureExtraction ||
    completedFigureExtraction.isExtracting ||
    !completedFigureExtraction.contentVisible ||
    completedFigureExtraction.hasHorizontalOverflow
  ) {
    throw new Error(`wholePdf: completed figure extraction did not keep the workspace usable, got ${JSON.stringify(completedFigureExtraction)}`);
  }

  await evaluateJson(client, `() => {
    const cancel = [...document.querySelectorAll('.figure-assets-header-actions button')]
      .find((button) => (button.textContent ?? '').trim() === '取消');
    cancel?.click();
    return Boolean(cancel);
  }`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const isIdle = await evaluateJson(client, `() => document.querySelector('.figure-assets-progress')?.classList.contains('idle') ?? false`);
    if (isIdle) break;
    await wait(150);
  }
  const idleFigureLayout = await evaluateJson(client, `() => {
    const workspace = document.querySelector('[data-testid="pdf-figure-workspace"]');
    const workspaceRect = workspace?.getBoundingClientRect();
    const layoutRect = workspace?.querySelector('.figure-assets-layout')?.getBoundingClientRect();
    const firstCardRect = workspace?.querySelector('[data-figure-card]')?.getBoundingClientRect();
    const inspectorPreviewRect = workspace?.querySelector('.figure-assets-preview')?.getBoundingClientRect();
    return {
      isIdle: workspace?.querySelector('.figure-assets-progress')?.classList.contains('idle') ?? false,
      contentVisible: Boolean(
        workspaceRect &&
        layoutRect &&
        firstCardRect &&
        inspectorPreviewRect &&
        layoutRect.height >= Math.min(320, workspaceRect.height * 0.5) &&
        firstCardRect.height >= 120 &&
        inspectorPreviewRect.height >= 160
      ),
      layoutHeight: layoutRect?.height ?? 0,
      firstCardHeight: firstCardRect?.height ?? 0,
      inspectorPreviewHeight: inspectorPreviewRect?.height ?? 0
    };
  }`);
  if (!idleFigureLayout.isIdle || !idleFigureLayout.contentVisible) {
    throw new Error(`wholePdf: idle figure workspace collapsed, got ${JSON.stringify(idleFigureLayout)}`);
  }
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-figures-idle.png'), Buffer.from(shot.data, 'base64'))
  );

  const cropEditorOpened = await evaluateJson(client, `() => {
    const readyCard = [...document.querySelectorAll('[data-figure-card]')]
      .find((card) => card.querySelector('.figure-assets-thumbnail img'));
    readyCard?.querySelector('.figure-assets-thumbnail')?.click();
    const adjust = [...document.querySelectorAll('.figure-assets-inspector button')]
      .find((button) => (button.textContent ?? '').includes('调整裁剪'));
    if (!adjust || adjust.disabled) return false;
    adjust.click();
    return true;
  }`);
  if (cropEditorOpened) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const cropReady = await evaluateJson(client, `() => Boolean(document.querySelector('[data-crop-editor] .figure-crop-selection'))`);
      if (cropReady) break;
      await wait(250);
    }
    const cropLayout = await evaluateJson(client, `() => {
      const editor = document.querySelector('[data-crop-editor] .figure-crop-editor');
      const selection = document.querySelector('[data-crop-editor] .figure-crop-selection');
      const rect = editor?.getBoundingClientRect();
      return {
        visible: Boolean(editor && selection),
        withinViewport: Boolean(rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
      };
    }`);
    if (!cropLayout.visible || !cropLayout.withinViewport || cropLayout.hasHorizontalOverflow) {
      throw new Error(`wholePdf: manual crop editor is clipped, got ${JSON.stringify(cropLayout)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'whole-pdf-figure-crop-editor.png'), Buffer.from(shot.data, 'base64'))
    );
    await evaluateJson(client, `() => document.querySelector('button[aria-label="关闭裁剪编辑器"]')?.click()`);
  }
  await evaluateJson(client, `() => document.querySelector('button[aria-label="关闭图表素材工作台"]')?.click()`);
  await wait(500);
  const postExtractionPdf = await evaluateJson(client, `() => {
    const root = document.querySelector('.pdf-js-viewer-container');
    const canvases = [...(root?.querySelectorAll('.page canvas') ?? [])]
      .filter((canvas) => canvas.width > 0 && canvas.height > 0);
    const canvas = canvases.find((item) => item.closest('.page')?.dataset.loaded === 'true') ?? canvases[0];
    if (!root || !canvas) {
      return {
        hasRoot: Boolean(root),
        canvasCount: canvases.length,
        paintedPixelCount: 0,
        renderPhase: root?.dataset.pdfRenderPhase ?? ''
      };
    }
    const sample = document.createElement('canvas');
    sample.width = 64;
    sample.height = 64;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context?.drawImage(canvas, 0, 0, 64, 64);
    const pixels = context?.getImageData(0, 0, 64, 64).data ?? new Uint8ClampedArray();
    let paintedPixelCount = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 0 && (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)) {
        paintedPixelCount += 1;
      }
    }
    return {
      hasRoot: true,
      canvasCount: canvases.length,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      paintedPixelCount,
      renderPhase: root.dataset.pdfRenderPhase ?? ''
    };
  }`);
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-after-figure-extraction.png'), Buffer.from(shot.data, 'base64'))
  );
  if (!postExtractionPdf.hasRoot || postExtractionPdf.canvasCount < 1 || postExtractionPdf.paintedPixelCount < 8) {
    throw new Error(`wholePdf: figure extraction left the PDF page blank, got ${JSON.stringify(postExtractionPdf)}`);
  }
  return {
    wholePdf,
    firstRenderMs,
    firstRenderBudgetMs: pdfFirstRenderBudgetMs,
    initialPdfCenter,
    legacyPanels,
    parallelSidebar,
    narrowSidebar,
    wideSidebar,
    collapsedSidebar,
    figureExtraction,
    completedFigureExtraction,
    postExtractionPdf,
    requireNativeFigureExtraction
  };
}

function terminateAppProcessTree(appProcess) {
  if (!appProcess?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(appProcess.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    return;
  }
  appProcess.kill('SIGTERM');
}

async function runEarlyFigureExtractionScenario(client) {
  await clickSidebarSection(client, 'library');
  await wait(350);
  const preparedLibrarySelection = await evaluateJson(client, `() => {
    document.querySelector('[data-paper-library-row]')?.click();
    document.querySelector('button[title="展开详情"]')?.click();
    return Boolean(document.querySelector('[data-paper-library-row]'));
  }`);
  if (!preparedLibrarySelection) throw new Error('earlyFigureExtraction: paper library row not found');
  await wait(350);
  const openedFromLibrary = await evaluateJson(client, `() => {
    const resume = document.querySelector('[data-paper-library-resume]');
    if (resume && !resume.disabled) resume.click();
    return Boolean(resume && !resume.disabled);
  }`);
  if (!openedFromLibrary) throw new Error('earlyFigureExtraction: paper library resume action not found');
  await waitForAppReady(client);
  await waitForPdfCanvas(client);

  const extractionOpened = await evaluateJson(client, `() => {
    const button = [...document.querySelectorAll('.whole-pdf-panel button')]
      .find((item) => (item.textContent ?? '').includes('提取 PDF 图表'));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }`);
  if (!extractionOpened) throw new Error('earlyFigureExtraction: extraction action not found');

  let firstFrame = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    firstFrame = await evaluateJson(client, `() => {
      const workspace = document.querySelector('[data-testid="pdf-figure-workspace"]');
      const workspaceRect = workspace?.getBoundingClientRect();
      const loadingRect = workspace?.querySelector('[data-testid="pdf-figure-loading"]')?.getBoundingClientRect();
      const layoutRect = workspace?.querySelector('.figure-assets-layout')?.getBoundingClientRect();
      const filtersRect = workspace?.querySelector('.figure-assets-filters')?.getBoundingClientRect();
      const resultsRect = workspace?.querySelector('.figure-assets-results')?.getBoundingClientRect();
      const inspectorRect = workspace?.querySelector('.figure-assets-inspector')?.getBoundingClientRect();
      return {
        hasWorkspace: Boolean(workspace),
        hasLoadingState: Boolean(workspace?.querySelector('[data-testid="pdf-figure-loading"]')),
        loadingHeight: loadingRect?.height ?? 0,
        loadingText: workspace?.querySelector('[data-testid="pdf-figure-loading"]')?.textContent?.trim() ?? '',
        isExtracting: [...(workspace?.querySelectorAll('.figure-assets-header-actions button') ?? [])]
          .some((button) => (button.textContent ?? '').trim() === '取消'),
        workspaceHeight: workspaceRect?.height ?? 0,
        layoutHeight: layoutRect?.height ?? 0,
        filtersHeight: filtersRect?.height ?? 0,
        resultsHeight: resultsRect?.height ?? 0,
        inspectorHeight: inspectorRect?.height ?? 0,
        resultsText: workspace?.querySelector('.figure-assets-results')?.textContent?.trim() ?? '',
        inspectorText: workspace?.querySelector('.figure-assets-inspector')?.textContent?.trim() ?? '',
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3 || Boolean(workspace && workspace.scrollWidth > workspace.clientWidth + 3)
      };
    }`);
    if (firstFrame.hasWorkspace && (firstFrame.loadingHeight > 300 || firstFrame.layoutHeight > 300)) break;
    await wait(50);
  }
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-figures-early-frame.png'), Buffer.from(shot.data, 'base64'))
  );
  if (
    !firstFrame?.hasWorkspace ||
    !firstFrame.hasLoadingState ||
    firstFrame.workspaceHeight < 400 ||
    firstFrame.loadingHeight < 300 ||
    !/正在|扫描|解析/.test(firstFrame.loadingText) ||
    firstFrame.hasHorizontalOverflow
  ) {
    throw new Error(`earlyFigureExtraction: first frame is blank or collapsed, got ${JSON.stringify(firstFrame)}`);
  }

  let completion = null;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    completion = await evaluateJson(client, `() => {
      const workspace = document.querySelector('[data-testid="pdf-figure-workspace"]');
      const cards = [...(workspace?.querySelectorAll('[data-figure-card]') ?? [])];
      return {
        hasWorkspace: Boolean(workspace),
        isExtracting: [...(workspace?.querySelectorAll('.figure-assets-header-actions button') ?? [])]
          .some((button) => (button.textContent ?? '').trim() === '取消'),
        cardCount: cards.length,
        readyCount: cards.filter((card) => card.querySelector('.figure-assets-thumbnail img')).length,
        bodyText: workspace?.textContent?.trim() ?? ''
      };
    }`);
    if (completion.hasWorkspace && !completion.isExtracting) break;
    await wait(500);
  }
  if (!completion?.hasWorkspace || completion.isExtracting || !completion.bodyText) {
    throw new Error(`earlyFigureExtraction: extraction did not finish in a usable workspace, got ${JSON.stringify(completion)}`);
  }

  await evaluateJson(client, `() => document.querySelector('button[aria-label="关闭图表素材工作台"]')?.click()`);
  await wait(500);
  const postExtractionPdf = await evaluateJson(client, `() => {
    const root = document.querySelector('.pdf-js-viewer-container');
    const canvases = [...(root?.querySelectorAll('.page canvas') ?? [])]
      .filter((canvas) => canvas.width > 0 && canvas.height > 0);
    const canvas = canvases.find((item) => item.closest('.page')?.dataset.loaded === 'true') ?? canvases[0];
    if (!root || !canvas) return { hasRoot: Boolean(root), canvasCount: canvases.length, paintedPixelCount: 0 };
    const sample = document.createElement('canvas');
    sample.width = 64;
    sample.height = 64;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context?.drawImage(canvas, 0, 0, 64, 64);
    const pixels = context?.getImageData(0, 0, 64, 64).data ?? new Uint8ClampedArray();
    let paintedPixelCount = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 0 && (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)) paintedPixelCount += 1;
    }
    return { hasRoot: true, canvasCount: canvases.length, paintedPixelCount };
  }`);
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'whole-pdf-after-early-figure-extraction.png'), Buffer.from(shot.data, 'base64'))
  );
  if (!postExtractionPdf.hasRoot || postExtractionPdf.canvasCount < 1 || postExtractionPdf.paintedPixelCount < 8) {
    throw new Error(`earlyFigureExtraction: extraction left the PDF page blank, got ${JSON.stringify(postExtractionPdf)}`);
  }

  return { firstFrame, completion, postExtractionPdf };
}

async function runPdfSelectionTranslationScenario(client) {
  await clickSidebarSection(client, 'library');
  await wait(350);
  const preparedLibrarySelection = await evaluateJson(client, `() => {
    document.querySelector('[data-paper-library-row]')?.click();
    document.querySelector('button[title="展开详情"]')?.click();
    return Boolean(document.querySelector('[data-paper-library-row]'));
  }`);
  if (!preparedLibrarySelection) throw new Error('pdfSelection: paper library row not found');
  await wait(350);
  const openedFromLibrary = await evaluateJson(client, `() => {
    const resume = document.querySelector('[data-paper-library-resume]');
    const opened = Boolean(resume && !resume.disabled);
    const startedAt = performance.now();
    if (opened) resume.click();
    return { opened, startedAt };
  }`);
  if (!openedFromLibrary.opened) throw new Error('pdfSelection: paper library resume action not found');
  await waitForAppReady(client);
  const pdfCanvasStatus = await waitForPdfCanvas(client);
  const firstRenderMs = Math.max(0, Math.round(pdfCanvasStatus.observedAt - openedFromLibrary.startedAt));
  if (firstRenderMs > pdfFirstRenderBudgetMs) {
    throw new Error(`pdfSelection: first PDF render exceeded ${pdfFirstRenderBudgetMs} ms budget, got ${firstRenderMs} ms`);
  }
  const initialFit = await readPdfInitialCenterLayout(client, 'pdf-selection-reader');
  if (!initialFit.hasPage || !initialFit.fullyVisibleHorizontally || !initialFit.isFitWidth || initialFit.hiddenDelta > 4) {
    throw new Error(`pdfSelection: initial PDF should fit width and remain centered, got ${JSON.stringify(initialFit)}`);
  }

  let hasSelectablePdfText = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const hasText = await evaluateJson(client, `() => [...document.querySelectorAll('.pdf-viewer-shell')]
      .some((shell) => {
        const shellRect = shell.getBoundingClientRect();
        return [...shell.querySelectorAll('.textLayer span')].some((item) => {
          const rect = item.getBoundingClientRect();
          const text = (item.textContent ?? '').trim();
          return text.length >= 2 && rect.width > 1 && rect.height > 1 &&
            rect.bottom > shellRect.top + 40 && rect.top < shellRect.bottom - 40;
        });
      })`);
    if (hasText) {
      hasSelectablePdfText = true;
      break;
    }
    await wait(100);
  }
  if (!hasSelectablePdfText) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'pdf-selection-text-layer-timeout.png'), Buffer.from(shot.data, 'base64'))
    );
  }

  const selected = await evaluateJson(client, `() => {
    const shells = [...document.querySelectorAll('.pdf-viewer-shell')];
    let shell = null;
    let visibleSpans = [];
    for (const candidate of shells) {
      const candidateRect = candidate.getBoundingClientRect();
      const spans = [...candidate.querySelectorAll('.textLayer span')].filter((span) => {
        const rect = span.getBoundingClientRect();
        const text = (span.textContent ?? '').trim();
        return text.length >= 2 && rect.width > 1 && rect.height > 1 &&
          rect.bottom > candidateRect.top + 40 && rect.top < candidateRect.bottom - 40;
      });
      if (spans.length > visibleSpans.length) {
        shell = candidate;
        visibleSpans = spans;
      }
    }
    if (!shell || visibleSpans.length === 0) return { ok: false };
    const shellRect = shell.getBoundingClientRect();
    const phraseSpan = visibleSpans.find((item) => /\s/.test((item.textContent ?? '').trim()));
    const firstSpan = phraseSpan ?? visibleSpans[0];
    const lastSpan = phraseSpan ?? visibleSpans[Math.min(2, visibleSpans.length - 1)];
    const container = firstSpan?.closest('.pdf-js-viewer-container');
    if (!firstSpan || !lastSpan || !container) return { ok: false };
    firstSpan.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse'
    }));
    const range = document.createRange();
    if (phraseSpan) {
      range.selectNodeContents(phraseSpan);
    } else {
      range.setStartBefore(firstSpan);
      range.setEndAfter(lastSpan);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    const rect = range.getBoundingClientRect();
    return {
      ok: true,
      text: selection?.toString().slice(0, 120) ?? '',
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      shell: shellRect ? { left: shellRect.left, top: shellRect.top, width: shellRect.width, height: shellRect.height } : null
    };
  }`);
  if (!selected?.ok) throw new Error('pdfSelection: selectable PDF text was not found');
  await wait(220);
  const openedDuringDrag = await evaluateJson(client, `() => Boolean(document.querySelector('[data-testid="pdf-selection-translation"]'))`);
  if (openedDuringDrag) {
    throw new Error('pdfSelection: translation card opened before the pointer selection finished');
  }
  await evaluateJson(client, `() => {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const ancestor = range?.commonAncestorContainer;
    const target = ancestor?.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor?.parentElement;
    target?.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse'
    }));
    return Boolean(target);
  }`);

  let snapshot = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    snapshot = await evaluateJson(client, `() => {
      const card = document.querySelector('[data-testid="pdf-selection-translation"]');
      const shell = card?.closest('.pdf-viewer-shell');
      const cardRect = card?.getBoundingClientRect();
      const shellRect = shell?.getBoundingClientRect();
      const selection = window.getSelection();
      const selectionRect = selection && selection.rangeCount > 0
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null;
      return {
        visible: Boolean(card),
        mode: card?.getAttribute('data-selection-mode') ?? '',
        status: card?.getAttribute('data-selection-status') ?? '',
        hasSource: Boolean(document.querySelector('.pdf-selection-source')?.textContent?.trim()),
        hasManualPrimaryAction: Boolean(card?.querySelector('button.primary-button')),
        hasAutoState: ['translating', 'success', 'error'].includes(card?.getAttribute('data-selection-status') ?? ''),
        hasDirection: Boolean(card?.querySelector('header span')?.textContent?.trim()),
        withinViewport: Boolean(cardRect && cardRect.left >= 0 && cardRect.right <= window.innerWidth && cardRect.top >= 0 && cardRect.bottom <= window.innerHeight),
        withinPdfShell: Boolean(cardRect && shellRect && cardRect.left >= shellRect.left && cardRect.right <= shellRect.right + 1 && cardRect.top >= shellRect.top && cardRect.bottom <= shellRect.bottom + 1),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
        cardOverflow: Boolean(card && card.scrollWidth > card.clientWidth + 3),
        cardRect: cardRect ? { left: Math.round(cardRect.left), top: Math.round(cardRect.top), width: Math.round(cardRect.width), height: Math.round(cardRect.height) } : null,
        selectionRect: selectionRect ? { left: Math.round(selectionRect.left), top: Math.round(selectionRect.top), width: Math.round(selectionRect.width), height: Math.round(selectionRect.height) } : null
      };
    }`);
    if (snapshot.visible) break;
    await wait(100);
  }
  if (!snapshot?.visible || snapshot.mode !== 'text' || !snapshot.hasSource || snapshot.hasManualPrimaryAction || !snapshot.hasAutoState || !snapshot.hasDirection || !snapshot.withinViewport || !snapshot.withinPdfShell || snapshot.horizontalOverflow || snapshot.cardOverflow) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'pdf-selection-translation-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`pdfSelection: selected-text translation card is clipped or incomplete, got ${JSON.stringify({ selected, snapshot })}`);
  }
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'pdf-selection-translation.png'), Buffer.from(shot.data, 'base64'))
  );

  const beforeScroll = await evaluateJson(client, `() => {
    const card = document.querySelector('[data-testid="pdf-selection-translation"]');
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const cardRect = card?.getBoundingClientRect();
    const rangeRect = range?.getBoundingClientRect();
    return cardRect && rangeRect ? { cardTop: cardRect.top, rangeTop: rangeRect.top } : null;
  }`);
  await evaluateJson(client, `() => {
    const container = document.querySelector('.pdf-js-viewer-container');
    if (!container) return false;
    container.scrollTop += 32;
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
    return true;
  }`);
  await wait(220);
  const afterScroll = await evaluateJson(client, `() => {
    const card = document.querySelector('[data-testid="pdf-selection-translation"]');
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const cardRect = card?.getBoundingClientRect();
    const rangeRect = range?.getBoundingClientRect();
    return cardRect && rangeRect ? { cardTop: cardRect.top, rangeTop: rangeRect.top } : null;
  }`);
  const relativeAnchorDrift = beforeScroll && afterScroll
    ? Math.abs((afterScroll.cardTop - afterScroll.rangeTop) - (beforeScroll.cardTop - beforeScroll.rangeTop))
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(relativeAnchorDrift) || relativeAnchorDrift > 14) {
    throw new Error(`pdfSelection: translation card did not follow the selected text, got ${JSON.stringify({ beforeScroll, afterScroll, relativeAnchorDrift })}`);
  }

  await evaluateJson(client, `() => {
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return true;
  }`);
  await wait(120);
  const dismissed = await evaluateJson(client, `() => !document.querySelector('[data-testid="pdf-selection-translation"]')`);
  if (!dismissed) throw new Error('pdfSelection: clicking outside should dismiss the translation card');

  const selectedWord = await evaluateJson(client, `() => {
    const candidates = [...document.querySelectorAll('.pdf-viewer-shell .textLayer span')].filter((span) => {
      const rect = span.getBoundingClientRect();
      const shellRect = span.closest('.pdf-viewer-shell')?.getBoundingClientRect();
      return shellRect && rect.width > 1 && rect.height > 1 &&
        rect.bottom > shellRect.top + 40 && rect.top < shellRect.bottom - 40;
    });
    for (const pattern of [/\b(?:model|learning|robot|control|policy|navigation)\b/i, /[A-Za-z]{4,}/]) {
      for (const span of candidates) {
        const textNode = [...span.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
        const text = textNode?.textContent ?? '';
        const match = pattern.exec(text);
        const container = span.closest('.pdf-js-viewer-container');
        if (!textNode || !match || !container || typeof match.index !== 'number') continue;
        span.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          buttons: 1,
          isPrimary: true,
          pointerId: 2,
          pointerType: 'mouse'
        }));
        const range = document.createRange();
        range.setStart(textNode, match.index);
        range.setEnd(textNode, match.index + match[0].length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        span.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          button: 0,
          buttons: 0,
          isPrimary: true,
          pointerId: 2,
          pointerType: 'mouse'
        }));
        span.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true,
          button: 0,
          detail: 2,
          clientX: range.getBoundingClientRect().left + 2,
          clientY: range.getBoundingClientRect().top + 2
        }));
        return match[0];
      }
    }
    return '';
  }`);
  if (!selectedWord) throw new Error('pdfSelection: selectable English word was not found');

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const enabled = await evaluateJson(client, `() => {
      const button = document.querySelector('[data-enable-online-dictionary]');
      if (!button) return false;
      button.click();
      return true;
    }`);
    if (enabled) break;
    await wait(100);
  }

  let wordSnapshot = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    wordSnapshot = await evaluateJson(client, `() => {
      const card = document.querySelector('[data-testid="pdf-selection-translation"]');
      const rect = card?.getBoundingClientRect();
      return {
        visible: Boolean(card),
        mode: card?.getAttribute('data-selection-mode') ?? '',
        status: card?.getAttribute('data-selection-status') ?? '',
        hasHeading: Boolean(card?.querySelector('.pdf-word-heading strong')?.textContent?.trim()),
        hasMeaning: Boolean(card?.querySelector('.pdf-word-meaning')),
        dictionarySettled: Boolean(card?.querySelector('.pdf-word-meaning, .pdf-word-dictionary-status')),
        withinViewport: Boolean(rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
        cardOverflow: Boolean(card && card.scrollWidth > card.clientWidth + 3)
      };
    }`);
    if (wordSnapshot.visible && wordSnapshot.dictionarySettled) break;
    await wait(100);
  }
  if (!wordSnapshot?.visible || wordSnapshot.mode !== 'word' || !wordSnapshot.hasHeading || !wordSnapshot.hasMeaning || !wordSnapshot.dictionarySettled || !wordSnapshot.withinViewport || wordSnapshot.horizontalOverflow || wordSnapshot.cardOverflow) {
    throw new Error(`pdfSelection: word dictionary card is clipped or incomplete, got ${JSON.stringify(wordSnapshot)}`);
  }
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'pdf-word-dictionary.png'), Buffer.from(shot.data, 'base64'))
  );
  return {
    ...snapshot,
    firstRenderMs,
    firstRenderBudgetMs: pdfFirstRenderBudgetMs,
    initialFit,
    followedSelection: true,
    dismissed,
    selectedWord,
    wordSnapshot
  };
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
      const channelDelta = (value) => {
        const matches = [...String(value).matchAll(/rgba?\\(([^)]+)\\)/g)];
        const deltas = matches.map((match) => {
          const channels = match[1].match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
          return Math.max(...channels) - Math.min(...channels);
        });
        return deltas.length > 0 ? Math.max(...deltas) : 0;
      };
      const legacyAccentValues = [
        getComputedStyle(document.querySelector('.presentation-quality-pass') ?? document.body).backgroundColor,
        getComputedStyle(document.querySelector('.presentation-quality-pass') ?? document.body).color,
        getComputedStyle(document.querySelector('.presentation-stage') ?? document.body).backgroundImage,
        getComputedStyle(document.querySelector('.presentation-thumbs span') ?? document.body).backgroundColor,
        getComputedStyle(document.querySelector('.presentation-thumbs span') ?? document.body).color,
        getComputedStyle(document.querySelector('.ppt-slide-kicker') ?? document.body).backgroundColor,
        getComputedStyle(document.querySelector('.ppt-slide-kicker') ?? document.body).color,
        getComputedStyle(document.querySelector('.ppt-export-claim') ?? document.body).borderLeftColor,
        getComputedStyle(document.querySelector('.ppt-export-card-label') ?? document.body).backgroundColor,
        getComputedStyle(document.querySelector('.ppt-export-card-label') ?? document.body).color,
        getComputedStyle(preview ?? document.body, '::before').backgroundImage
      ];
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
        pageText: page?.textContent?.slice(0, 1500) ?? '',
        legacyAccentValues,
        legacyAccentMaxChannelDelta: legacyAccentValues.reduce(
          (max, value) => Math.max(max, channelDelta(value)),
          0
        )
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
  if (snapshot.legacyAccentMaxChannelDelta > 80) {
    throw new Error(`presentation: high-saturation legacy accent found, got ${JSON.stringify(snapshot)}`);
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
    const channelDelta = (value) => {
      const matches = [...String(value).matchAll(/rgba?\\(([^)]+)\\)/g)];
      const deltas = matches.map((match) => {
        const channels = match[1].match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        return Math.max(...channels) - Math.min(...channels);
      });
      return deltas.length > 0 ? Math.max(...deltas) : 0;
    };
    const oldAccentValues = [
      getComputedStyle(document.querySelector('.ai-assistant-page .eyebrow') ?? document.body).color,
      getComputedStyle(document.querySelector('.ai-assistant-page .toggle-switch.is-on') ?? document.body).backgroundColor,
      getComputedStyle(document.querySelector('.ai-assistant-page .toggle-switch.is-on') ?? document.body).borderColor
    ];
    return {
      hasAiAssistant: Boolean(document.querySelector('.ai-assistant-page') && layout && main && side),
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
      bodyIsResizing: document.body.classList.contains('is-resizing-layout'),
      layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      sideWidth: side?.getBoundingClientRect().width ?? 0,
      oldAccentValues,
      oldAccentMaxChannelDelta: oldAccentValues.reduce((max, value) => Math.max(max, channelDelta(value)), 0)
    };
  }`);

  if (!after.hasAiAssistant || after.hasHorizontalOverflow || after.bodyIsResizing || after.oldAccentMaxChannelDelta > 80) {
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

async function runPaperTutorScenario(client) {
  await clickSidebarSection(client, 'paperTutor');
  await waitForAppReady(client);
  await wait(500);

  const before = await evaluateJson(client, `() => {
    const page = document.querySelector('.paper-tutor-page');
    const layout = document.querySelector('.paper-tutor-layout');
    const paperRail = document.querySelector('.paper-tutor-paper-rail');
    const chatShell = document.querySelector('.paper-tutor-chat-shell');
    const evidenceRail = document.querySelector('.paper-tutor-evidence-rail');
    const composer = document.querySelector('.paper-tutor-composer textarea');
    const selectedPapers = [...document.querySelectorAll('.paper-tutor-paper-item input:checked')].length;
    const activeSidebar = document.querySelector('.app-sidebar-link.active')?.getAttribute('data-sidebar-section') ?? '';
    const layoutRect = layout?.getBoundingClientRect();
    const paperRect = paperRail?.getBoundingClientRect();
    const chatRect = chatShell?.getBoundingClientRect();
    const evidenceRect = evidenceRail?.getBoundingClientRect();
    const figurePreviewRects = [...document.querySelectorAll('.paper-tutor-figure-preview')]
      .map((item) => {
        const rect = item.getBoundingClientRect();
        const image = item.querySelector('img');
        const imageRect = image?.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          imageWidth: imageRect ? Math.round(imageRect.width) : 0,
          imageHeight: imageRect ? Math.round(imageRect.height) : 0
        };
      });
    const figureCaptionRects = [...document.querySelectorAll('.paper-tutor-figure-strip article > small')]
      .map((item) => {
        const rect = item.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          text: item.textContent?.slice(0, 160) ?? ''
        };
      });
    const evidenceScrollItems = [
      ...document.querySelectorAll(
        '.paper-tutor-evidence-scroll, .paper-tutor-figure-strip, .paper-tutor-text-snippets'
      )
    ].map((item) => {
      const rect = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return {
        className: item.className,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scrollHeight: Math.round(item.scrollHeight),
        clientHeight: Math.round(item.clientHeight),
        overflowY: style.overflowY,
        isScrollable:
          item.scrollHeight > item.clientHeight + 4 &&
          style.overflowY !== 'visible' &&
          style.overflowY !== 'clip'
      };
    });
    const nestedEvidenceScrollCount = evidenceScrollItems.filter((item) =>
      !String(item.className).includes('paper-tutor-evidence-scroll') && item.isScrollable
    ).length;
    const figureArticleRects = [...document.querySelectorAll('.paper-tutor-figure-strip article')].map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom)
      };
    });
    const textSnippetsRect = document.querySelector('.paper-tutor-text-snippets')?.getBoundingClientRect();
    const maxFigureArticleBottom = figureArticleRects.reduce(
      (max, rect) => Math.max(max, rect.bottom),
      Number.NEGATIVE_INFINITY
    );
    const evidenceSectionOverlap = Boolean(
      textSnippetsRect &&
        Number.isFinite(maxFigureArticleBottom) &&
        Math.round(textSnippetsRect.top) < maxFigureArticleBottom - 4
    );
    const channelDelta = (value) => {
      const matches = [...String(value).matchAll(/rgba?\\(([^)]+)\\)/g)];
      const deltas = matches.map((match) => {
        const channels = match[1].match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        return Math.max(...channels) - Math.min(...channels);
      });
      return deltas.length > 0 ? Math.max(...deltas) : 0;
    };
    const evidenceLabelStyles = [...document.querySelectorAll('.paper-tutor-figure-strip article > span')]
      .slice(0, 10)
      .map((item) => {
        const style = getComputedStyle(item);
        return {
          text: item.textContent?.trim() ?? '',
          background: style.backgroundColor,
          color: style.color,
          maxChannelDelta: Math.max(channelDelta(style.backgroundColor), channelDelta(style.color))
        };
      });
    return {
      hasPage: Boolean(page),
      activeSidebar,
      isIndependentView: Boolean(page) && !document.querySelector('.ai-assistant-page'),
      hasLayout: Boolean(layout && paperRail && chatShell && evidenceRail),
      hasComposer: Boolean(composer),
      hasSessionList: document.querySelectorAll('.paper-tutor-session-item').length >= 1,
      hasNewWindowAction: [...document.querySelectorAll('.paper-tutor-session-list button')]
        .some((button) => /新窗口/.test(button.textContent ?? '')),
      hasSuggestions: document.querySelectorAll('.paper-tutor-suggestions button').length >= 3,
      selectedPapers,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
      layoutRect: layoutRect ? { width: Math.round(layoutRect.width), height: Math.round(layoutRect.height) } : null,
      paperRect: paperRect ? { width: Math.round(paperRect.width), height: Math.round(paperRect.height) } : null,
      chatRect: chatRect ? { width: Math.round(chatRect.width), height: Math.round(chatRect.height) } : null,
      evidenceRect: evidenceRect ? { width: Math.round(evidenceRect.width), height: Math.round(evidenceRect.height) } : null,
      figurePreviewRects,
      minFigurePreviewHeight: figurePreviewRects.reduce((min, rect) => Math.min(min, rect.height), Number.POSITIVE_INFINITY),
      minFigureImageHeight: figurePreviewRects.reduce((min, rect) => Math.min(min, rect.imageHeight), Number.POSITIVE_INFINITY),
      figureCaptionRects,
      evidenceScrollItems,
      nestedEvidenceScrollCount,
      evidenceSectionOverlap,
      evidenceLabelStyles,
      evidenceLabelMaxChannelDelta: evidenceLabelStyles.reduce(
        (max, item) => Math.max(max, item.maxChannelDelta),
        0
      ),
      bodyText: (document.body.textContent ?? '').slice(0, 1200)
    };
  }`);

  if (
    !before.hasPage ||
    before.activeSidebar !== 'paperTutor' ||
    !before.isIndependentView ||
    !before.hasLayout ||
    !before.hasComposer ||
    !before.hasSessionList ||
    !before.hasNewWindowAction ||
    !before.hasSuggestions ||
    before.selectedPapers < 1 ||
    before.hasHorizontalOverflow ||
    (before.chatRect?.width ?? 0) < 420 ||
    (before.paperRect?.width ?? 0) < 180 ||
    (requireNativeFigureExtraction
      ? before.figurePreviewRects.length < 1 ||
        before.minFigurePreviewHeight < 168 ||
        before.minFigureImageHeight < 132 ||
        before.figurePreviewRects[0]?.height < 210
      : before.figurePreviewRects.length < 1 && before.figureCaptionRects.length < 1) ||
    before.figureCaptionRects.some((rect) => rect.height > 58) ||
    before.nestedEvidenceScrollCount > 0 ||
    before.evidenceSectionOverlap ||
    before.evidenceLabelMaxChannelDelta > 80
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'paper-tutor-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`paperTutor: expected standalone ChatGPT-like tutor page, got ${JSON.stringify(before)}`);
  }

  await evaluateJson(client, `() => {
    [...document.querySelectorAll('.paper-tutor-suggestions button')]
      .find((button) => /方法主线/.test(button.textContent ?? ''))?.click();
    return null;
  }`);
  const afterSuggestion = await evaluateJson(client, `() => ({
    inputValue: document.querySelector('.paper-tutor-composer textarea')?.value ?? '',
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
  })`);
  if (!/方法输入|模型变换/u.test(afterSuggestion.inputValue) || afterSuggestion.hasHorizontalOverflow) {
    throw new Error(`paperTutor: suggestion did not populate composer correctly, got ${JSON.stringify(afterSuggestion)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'paper-tutor-page.png'), Buffer.from(shot.data, 'base64'))
  );

  return { before, afterSuggestion };
}

async function runKnowledgeGraphScenario(client) {
  await clickSidebarSection(client, 'knowledgeGraph');
  await waitForAppReady(client);

  let snapshot = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    snapshot = await evaluateJson(client, `() => {
      const page = document.querySelector('.knowledge-graph-page');
      const layout = document.querySelector('.knowledge-graph-layout');
      const filterPanel = document.querySelector('.knowledge-filter-panel');
      const canvas = document.querySelector('.knowledge-canvas-card');
      const detailPanel = document.querySelector('.knowledge-detail-panel');
      const svg = document.querySelector('.knowledge-graph-svg');
      const nodes = [...document.querySelectorAll('.knowledge-node')];
      const mainNodeCircles = nodes
        .map((node) => [...node.querySelectorAll('circle')][1])
        .filter(Boolean);
      const channelDelta = (value) => {
        const matches = [...String(value).matchAll(/rgba?\\(([^)]+)\\)/g)];
        const deltas = matches.map((match) => {
          const channels = match[1].match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
          return Math.max(...channels) - Math.min(...channels);
        });
        if (deltas.length > 0) return Math.max(...deltas);

        const hex = String(value).trim();
        if (/^#[0-9a-f]{6}$/i.test(hex)) {
          const red = Number.parseInt(hex.slice(1, 3), 16);
          const green = Number.parseInt(hex.slice(3, 5), 16);
          const blue = Number.parseInt(hex.slice(5, 7), 16);
          return Math.max(red, green, blue) - Math.min(red, green, blue);
        }

        return 0;
      };
      const accentValues = [
        ...mainNodeCircles.map((circle) => circle.getAttribute('fill') ?? ''),
        ...[...document.querySelectorAll('.graph-legend i')].map((item) => getComputedStyle(item).backgroundColor),
        getComputedStyle(document.querySelector('.node-type-filter button.active') ?? document.body).backgroundColor,
        getComputedStyle(document.querySelector('.node-type-filter button.active') ?? document.body).color,
        getComputedStyle(document.querySelector('.graph-edge') ?? document.body).stroke,
        getComputedStyle(document.querySelector('.graph-cluster-label') ?? document.body).fill
      ];
      const rect = (item) => {
        const box = item?.getBoundingClientRect();
        return box
          ? {
              width: Math.round(box.width),
              height: Math.round(box.height),
              left: Math.round(box.left),
              right: Math.round(box.right),
              top: Math.round(box.top),
              bottom: Math.round(box.bottom)
            }
          : null;
      };
      const maxDurationSeconds = (value) =>
        String(value)
          .split(',')
          .reduce((max, part) => {
            const text = part.trim();
            if (!text) return max;
            if (text.endsWith('ms')) return Math.max(max, Number.parseFloat(text) / 1000);
            if (text.endsWith('s')) return Math.max(max, Number.parseFloat(text));
            return max;
          }, 0);
      const stylesheetContains = (needle) =>
        [...document.styleSheets].some((sheet) => {
          try {
            return [...sheet.cssRules].some((rule) => String(rule.cssText).includes(needle));
          } catch {
            return false;
          }
        });
      const firstNode = document.querySelector('.knowledge-node');
      const firstNodeCircle = document.querySelector('.knowledge-node circle');
      const firstEdge = document.querySelector('.graph-edge');
      return {
        hasPage: Boolean(page),
        activeSidebar: document.querySelector('.app-sidebar-link.active')?.getAttribute('data-sidebar-section') ?? '',
        hasLayout: Boolean(layout && filterPanel && canvas && detailPanel),
        hasSvg: Boolean(svg),
        nodeCount: nodes.length,
        edgeCount: document.querySelectorAll('.graph-edge').length,
        clusterCount: document.querySelectorAll('.graph-cluster').length,
        legendCount: document.querySelectorAll('.graph-legend span').length,
        detailHasNode: Boolean(document.querySelector('.knowledge-node-detail')),
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
        layoutRect: rect(layout),
        filterRect: rect(filterPanel),
        canvasRect: rect(canvas),
        detailRect: rect(detailPanel),
        accentMaxChannelDelta: accentValues.reduce((max, value) => Math.max(max, channelDelta(value)), 0),
        accentValues,
        motionAudit: {
          prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          hasReducedMotionRule: stylesheetContains('prefers-reduced-motion: reduce'),
          hasNodePopKeyframe: stylesheetContains('ft-node-pop'),
          hasGraphHaloKeyframe: stylesheetContains('ft-graph-halo'),
          nodeTransitionSeconds: firstNode ? maxDurationSeconds(getComputedStyle(firstNode).transitionDuration) : 0,
          circleTransitionSeconds: firstNodeCircle
            ? maxDurationSeconds(getComputedStyle(firstNodeCircle).transitionDuration)
            : 0,
          edgeTransitionSeconds: firstEdge ? maxDurationSeconds(getComputedStyle(firstEdge).transitionDuration) : 0
        }
      };
    }`);

    if (snapshot.hasPage && snapshot.hasSvg && snapshot.nodeCount > 0) {
      break;
    }
    await wait(250);
  }

  if (
    !snapshot.hasPage ||
    snapshot.activeSidebar !== 'knowledgeGraph' ||
    !snapshot.hasLayout ||
    !snapshot.hasSvg ||
    snapshot.nodeCount < 3 ||
    snapshot.edgeCount < 2 ||
    snapshot.legendCount < 4 ||
    !snapshot.detailHasNode ||
    snapshot.hasHorizontalOverflow ||
    (snapshot.canvasRect?.width ?? 0) < 420
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'knowledge-graph-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`knowledgeGraph: expected scan-ready graph workspace, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.accentMaxChannelDelta > 80) {
    throw new Error(`knowledgeGraph: high-saturation legacy graph accent found, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.accentMaxChannelDelta < 35) {
    throw new Error(`knowledgeGraph: graph accents have collapsed back to grayscale, got ${JSON.stringify(snapshot)}`);
  }
  if (
    !snapshot.motionAudit.hasReducedMotionRule ||
    !snapshot.motionAudit.hasNodePopKeyframe ||
    !snapshot.motionAudit.hasGraphHaloKeyframe ||
    (!snapshot.motionAudit.prefersReducedMotion &&
      (snapshot.motionAudit.circleTransitionSeconds < 0.12 || snapshot.motionAudit.edgeTransitionSeconds < 0.12))
  ) {
    throw new Error(`knowledgeGraph: motion rules are missing or inert, got ${JSON.stringify(snapshot.motionAudit)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'knowledge-graph.png'), Buffer.from(shot.data, 'base64'))
  );

  return snapshot;
}

async function runArxivSearchScenario(client) {
  await client.send('Runtime.evaluate', {
    expression: `
      localStorage.setItem('pdfTranslationReader:arxivReadingQueue', JSON.stringify([
        { stableId: 'queue-1', title: 'FTP-1: General Technical Fund Tactile Control', titleZh: 'FTP-1：通用技术基金会触觉控制', addedAt: '2026-06-20T00:00:00.000Z' },
        { stableId: 'queue-2', title: 'WT-UMI: Tactile-based Whole-Body Manipulation', titleZh: 'WT-UMI：触觉全身操控', addedAt: '2026-06-20T00:00:01.000Z' },
        { stableId: 'queue-3', title: 'HT-Bench: Egocentral Vision for Dexterous Full-arm Manipulation', titleZh: 'HT-Bench：灵巧操作基准', addedAt: '2026-06-20T00:00:02.000Z' },
        { stableId: 'queue-4', title: 'Long queued paper title used to verify compact ellipsis behavior in empty arXiv state', titleZh: '用于检查空结果紧凑省略的超长备选论文标题', addedAt: '2026-06-20T00:00:03.000Z' }
      ]));
      localStorage.setItem('pdfTranslationReader:arxivDetailPanelCollapsed', '0');
    `
  });
  await clickSidebarSection(client, 'arxiv');
  await waitForAppReady(client);
  await wait(700);

  const snapshot = await evaluateJson(client, `() => {
    const page = document.querySelector('.arxiv-page');
    const searchCard = document.querySelector('.arxiv-search-card');
    const inputs = [...document.querySelectorAll('.arxiv-search-card input')].map((input) => ({
      placeholder: input.getAttribute('placeholder') ?? '',
      value: input.value ?? ''
    }));
    const selects = [...document.querySelectorAll('.arxiv-search-card select')].map((select) => ({
      value: select.value,
      options: [...select.options].map((option) => option.value)
    }));
    const text = page?.textContent ?? '';
    const queue = document.querySelector('.arxiv-reading-queue-mini');
    const queueRect = queue?.getBoundingClientRect();
    const queueTrigger = document.querySelector('.arxiv-reading-queue-toolbar-button');
    const queueTriggerRect = queueTrigger?.getBoundingClientRect();
    const queueButtons = [
      ...document.querySelectorAll('.arxiv-reading-queue-list .arxiv-reading-queue-paper, .arxiv-reading-queue-items .arxiv-reading-queue-paper')
    ];
    const queueOverflow = document.querySelector('.arxiv-reading-queue-overflow');
    const channelDelta = (value) => {
      const matches = [...String(value).matchAll(/rgba?\\(([^)]+)\\)/g)];
      const deltas = matches.map((match) => {
        const channels = match[1].match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        return Math.max(...channels) - Math.min(...channels);
      });
      return deltas.length > 0 ? Math.max(...deltas) : 0;
    };
    const emptyCard = document.querySelector('.arxiv-empty-card');
    const emptyCardStyle = getComputedStyle(emptyCard ?? document.body);
    const emptyCardBeforeStyle = getComputedStyle(emptyCard ?? document.body, '::before');
    const emptyCardAccentValues = [
      emptyCardStyle.backgroundColor,
      emptyCardStyle.backgroundImage,
      emptyCardStyle.borderTopColor,
      emptyCardBeforeStyle.backgroundColor,
      emptyCardBeforeStyle.backgroundImage,
      emptyCardBeforeStyle.borderTopColor,
      emptyCardBeforeStyle.color,
      emptyCardBeforeStyle.boxShadow
    ];
    const queueButtonRects = queueButtons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        text: button.textContent?.trim() ?? ''
      };
    });
    const firstQueueTop = Math.min(...queueButtonRects.map((rect) => rect.top));
    const queueFirstRowCount = Number.isFinite(firstQueueTop)
      ? queueButtonRects.filter((rect) => Math.abs(rect.top - firstQueueTop) <= 4).length
      : 0;
    const activeSidebar = document.querySelector('.app-sidebar-link.active');
    const queryModeSelect = [...document.querySelectorAll('.arxiv-search-card select')]
      .find((select) => [...select.options].some((option) => option.value === 'explore'));
    const advancedToggle = document.querySelector('.arxiv-advanced-toggle');
    const advancedFilters = document.querySelector('.arxiv-query-options');
    const runtimeDetails = document.querySelector('[data-arxiv-runtime-details]');
    const runtimeStatus = document.querySelector('.arxiv-runtime-status');
    return {
      hasPage: Boolean(page),
      hasSearchCard: Boolean(searchCard),
      hasYearInputs: /起始年份/.test(text) && /结束年份/.test(text),
      hasTitleAbstractHint: /title 和 abstract|标题和摘要|标题\\/摘要/.test(text),
      hasPageSize200: selects.some((select) => select.options.includes('200')),
      hasEmptyState: Boolean(document.querySelector('.arxiv-empty-card')),
      startsWithGenericEmptyQuery: (inputs[0]?.value ?? '') === '',
      activeSidebar: activeSidebar?.getAttribute('data-sidebar-section') ?? '',
      queueMounted: Boolean(queue),
      queueHeight: queueRect ? Math.round(queueRect.height) : 0,
      queueTriggerVisible: Boolean(queueTriggerRect && queueTriggerRect.width > 0 && queueTriggerRect.height > 0),
      queueTriggerText: queueTrigger?.textContent?.trim() ?? '',
      queueTriggerExpanded: queueTrigger?.getAttribute('aria-expanded') ?? '',
      queueButtonCount: queueButtons.length,
      queueFirstRowCount,
      queueButtonRects,
      queueOverflowText: queueOverflow?.textContent?.trim() ?? '',
      emptyCardAccentValues,
      emptyCardAccentMaxChannelDelta: emptyCardAccentValues.reduce((max, value) => Math.max(max, channelDelta(value)), 0),
      queueUsesLegacyPills: document.querySelectorAll('.arxiv-reading-queue-items .pill-button').length > 0,
      hasRankingScopeLabel: /本页相关排序/.test(text),
      queryModeLabels: queryModeSelect ? [...queryModeSelect.options].map((option) => option.textContent?.trim() ?? '') : [],
      advancedCollapsed:
        advancedToggle?.getAttribute('aria-expanded') === 'false' &&
        Boolean(advancedFilters) &&
        getComputedStyle(advancedFilters).display === 'none',
      advancedControlsLinked: advancedToggle?.getAttribute('aria-controls') === advancedFilters?.id,
      hasRuntimeStatus: Boolean(runtimeStatus),
      runtimeDetailsCollapsed:
        Boolean(runtimeDetails) &&
        !runtimeDetails.hasAttribute('open') &&
        Boolean(runtimeStatus) &&
        getComputedStyle(runtimeStatus).display === 'none',
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
      inputs,
      searchText: text.slice(0, 1200)
    };
  }`);

  if (
    !snapshot.hasPage ||
    !snapshot.hasSearchCard ||
    !snapshot.hasYearInputs ||
    !snapshot.hasTitleAbstractHint ||
    !snapshot.hasPageSize200 ||
    !snapshot.startsWithGenericEmptyQuery ||
    snapshot.activeSidebar !== 'arxiv' ||
    !snapshot.queueMounted ||
    snapshot.queueHeight > 2 ||
    !snapshot.queueTriggerVisible ||
    !/备选\s*4/.test(snapshot.queueTriggerText) ||
    snapshot.queueTriggerExpanded !== 'false' ||
    snapshot.queueButtonCount !== 0 ||
    snapshot.queueOverflowText !== '' ||
    snapshot.emptyCardAccentMaxChannelDelta > 80 ||
    snapshot.emptyCardAccentMaxChannelDelta < 35 ||
    snapshot.queueFirstRowCount !== 0 ||
    snapshot.queueUsesLegacyPills ||
    !snapshot.hasRankingScopeLabel ||
    !['严格', '均衡', '探索'].every((label) => snapshot.queryModeLabels.includes(label)) ||
    !snapshot.advancedCollapsed ||
    !snapshot.advancedControlsLinked ||
    !snapshot.hasRuntimeStatus ||
    !snapshot.runtimeDetailsCollapsed ||
    snapshot.hasHorizontalOverflow
  ) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'arxiv-search-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`arxiv: expected generic title/abstract search UI with year range and page-size controls, got ${JSON.stringify(snapshot)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'arxiv-search-empty.png'), Buffer.from(shot.data, 'base64'))
  );

  const mockInstalled = await evaluateJson(client, `() => {
    const papers = Array.from({ length: 6 }, (_, index) => ({
      id: 'http://arxiv.org/abs/2601.1744' + index + 'v1',
      stableId: '2601.1744' + index,
      title: index === 0
        ? 'Reinforcement Learning for Active Perception in Autonomous Navigation'
        : 'Robot Navigation with Reinforcement Learning and Dynamic Obstacle Avoidance ' + index,
      authors: ['Grzegorz Malczyk', 'Mihir Kulkarni', 'Kostas Alexis'],
      summary: 'This paper studies reinforcement learning for robot navigation with active perception, dynamic obstacle avoidance, local planning, and real robot evaluation. The abstract is intentionally long enough to verify result-card layout and wrapping in the arXiv search page.',
      published: '2026-02-01T00:00:00Z',
      publishedAt: '2026-02-01T00:00:00Z',
      updated: '2026-02-01T00:00:00Z',
      categories: ['cs.RO', 'cs.LG'],
      primaryCategory: 'cs.RO',
      abstractUrl: 'https://arxiv.org/abs/2601.1744' + index,
      pdfUrl: 'https://arxiv.org/pdf/2601.1744' + index + '.pdf'
    }));
    const searchMock = async (request) => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
      const originalSearchQuery = request?.searchQuery ?? '';
      const normalizedSearchQuery = originalSearchQuery.trim().replace(/\s+/g, ' ');
      const effectiveSearchQuery = [
        'all:(reinforcement learning robot navigation autonomous mobile robot active perception)',
        'OR all:(safe navigation dynamic obstacle avoidance local planning embodied intelligence)',
        'OR all:(policy optimization world model control barrier function model predictive control)',
        'OR all:(sim-to-real generalization robustness sample efficiency long-horizon evaluation)'
      ].join(' ');
      return {
        papers,
        totalResults: 38019,
        startIndex: 0,
        itemsPerPage: papers.length,
        cacheHit: true,
        cacheStale: false,
        queueSize: 0,
        lastRequestGapMs: -1,
        originalSearchQuery,
        effectiveSearchQuery,
        normalizedSearchQuery,
        queryMode: request?.queryMode ?? 'balanced',
      };
    };
    const translateMock = async (request) => ({
      stableId: request.stableId,
      titleZh: '强化学习机器人导航：' + request.stableId,
      abstractZh: '本文研究强化学习在机器人导航、主动感知、动态避障和真实机器人评估中的应用，用于检查中文摘要在检索列表中直接显示。',
      engine: 'cache',
      status: 'cached',
      cacheHit: true,
      message: 'visual mock cached',
      translatedAt: '2026-05-30T00:00:00.000Z'
    });
    const translateMockClean = async (request) => ({
      stableId: request.stableId,
      titleZh: '\\u5f3a\\u5316\\u5b66\\u4e60\\u673a\\u5668\\u4eba\\u5bfc\\u822a\\uff1a' + request.stableId,
      abstractZh:
        '\\u672c\\u6587\\u7814\\u7a76\\u5f3a\\u5316\\u5b66\\u4e60\\u5728\\u673a\\u5668\\u4eba\\u5bfc\\u822a\\u3001\\u4e3b\\u52a8\\u611f\\u77e5\\u3001\\u52a8\\u6001\\u907f\\u969c\\u548c\\u771f\\u5b9e\\u673a\\u5668\\u4eba\\u8bc4\\u4f30\\u4e2d\\u7684\\u5e94\\u7528\\uff0c\\u7528\\u4e8e\\u68c0\\u67e5\\u4e2d\\u6587\\u6458\\u8981\\u5728\\u68c0\\u7d22\\u5217\\u8868\\u4e2d\\u76f4\\u63a5\\u663e\\u793a\\u3002',
      engine: 'cache',
      status: 'cached',
      cacheHit: true,
      message: 'visual mock cached',
      translatedAt: '2026-05-30T00:00:00.000Z'
    });
    const translateBatchMock = async (request) =>
      Promise.all((request?.papers || request || []).map((paper) => translateMockClean(paper)));
    try {
      window.electronAPI.searchArxiv = searchMock;
      window.electronAPI.translateArxivTitleAbstract = translateMockClean;
      window.electronAPI.translateArxivTitleAbstractBatch = translateBatchMock;
      if (
        window.electronAPI.searchArxiv === searchMock &&
        window.electronAPI.translateArxivTitleAbstract === translateMockClean &&
        window.electronAPI.translateArxivTitleAbstractBatch === translateBatchMock
      ) {
        return true;
      }
    } catch {
      // contextBridge 暴露对象在部分 Electron 版本中会静默拒绝赋值，下面再尝试 defineProperty。
    }
    try {
      Object.defineProperty(window.electronAPI, 'searchArxiv', { configurable: true, value: searchMock });
      Object.defineProperty(window.electronAPI, 'translateArxivTitleAbstract', { configurable: true, value: translateMockClean });
      Object.defineProperty(window.electronAPI, 'translateArxivTitleAbstractBatch', {
        configurable: true,
        value: translateBatchMock
      });
      return (
        window.electronAPI.searchArxiv === searchMock &&
        window.electronAPI.translateArxivTitleAbstract === translateMockClean &&
        window.electronAPI.translateArxivTitleAbstractBatch === translateBatchMock
      );
    } catch {
      try {
        window.__ftranslateVisualArxivSearchMock = searchMock;
        window.__ftranslateVisualArxivTranslateMock = translateMockClean;
        window.__ftranslateVisualArxivTranslateBatchMock = translateBatchMock;
      } catch {
        // ignore
      }
      return false;
    }
  }`);

  let resultsSnapshot = null;
  let translationTriggerSnapshot = null;
  let translationProgressSnapshot = null;
  let preTranslationZhCount = null;
  let threeColumnLayout = null;
  let twoColumnLayout = null;
  let oneColumnLayout = null;

  if (mockInstalled || visualArxivMockMode === '1') {
    await client.send('Runtime.evaluate', {
      expression: `
        (() => {
          const input = document.querySelector('.arxiv-query-input input');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, 'reinforcement learning robot navigation');
          input?.dispatchEvent(new Event('input', { bubbles: true }));
          [...document.querySelectorAll('.arxiv-search-card button')]
            .find((button) => /搜索/.test(button.textContent ?? ''))?.click();
        })();
      `
    });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      resultsSnapshot = await evaluateJson(client, `() => {
        const cards = [...document.querySelectorAll('.arxiv-results-list > .arxiv-paper-card')];
        const cardRects = cards.map((card) => {
          const rect = card.getBoundingClientRect();
          return { width: rect.width, height: rect.height, text: card.textContent?.slice(0, 500) ?? '' };
        });
        const channelDelta = (value) => {
          const matches = [...String(value).matchAll(/rgba?\\(([^)]+)\\)/g)];
          const deltas = matches.map((match) => {
            const channels = match[1].match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
            return Math.max(...channels) - Math.min(...channels);
          });
          return deltas.length > 0 ? Math.max(...deltas) : 0;
        };
        const readStyles = (selector) => {
          const item = document.querySelector(selector);
          const style = getComputedStyle(item ?? document.body);
          return [style.backgroundColor, style.color, style.borderTopColor, style.borderLeftColor, style.boxShadow];
        };
        const pageText = document.querySelector('.arxiv-page')?.textContent ?? '';
        const cardActionGroups = [...document.querySelectorAll('.arxiv-card-actions--primary')];
        const cardActionTexts = cardActionGroups.map((group) => group.textContent?.trim() ?? '');
        const detailActionText = [
          ...document.querySelectorAll('.arxiv-detail-actions, .arxiv-detail-secondary-actions')
        ].map((group) => group.textContent ?? '').join(' ');
        const runtimeStatus = document.querySelector('.arxiv-runtime-status');
        const runtimeDetails = document.querySelector('[data-arxiv-runtime-details]');
        const legacyAccentValues = [
          ...readStyles('.arxiv-search-primary-row .primary-button'),
          ...readStyles('.arxiv-detail-panel .panel-title-row .eyebrow'),
          ...readStyles('.arxiv-reading-queue-overflow'),
          ...readStyles('.arxiv-paper-card.is-selected'),
          ...readStyles('.arxiv-page .priority-pill'),
          ...readStyles('.arxiv-page .accent-badge'),
          ...readStyles('.arxiv-page .success-badge'),
          ...readStyles('.arxiv-page .pill-tag'),
          ...readStyles('.arxiv-page .accent-pill-tag'),
          ...readStyles('.arxiv-page-chip'),
          ...readStyles('.arxiv-favorite-button')
        ];
        return {
          hasResultsList: Boolean(document.querySelector('.arxiv-results-list')),
          cardCount: cards.length,
          cardRects,
          zhCount: cards.filter((card) => /强化学习|中文摘要/.test(card.textContent ?? '')).length,
          hasCompletedTranslationFeedback: Boolean(
            document.querySelector('.arxiv-translation-feedback.is-done')
          ),
          hasPageFilterPanel: Boolean(document.querySelector('.arxiv-filter-panel')),
          hasTopPageFilters: (() => {
            const advancedFilters = document.querySelector('.arxiv-query-options');
            return Boolean(advancedFilters) &&
              advancedFilters.querySelectorAll('select').length >= 3 &&
              advancedFilters.querySelectorAll('input[type="checkbox"]').length >= 4;
          })(),
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
          hasRankingScopeLabel: /本页相关排序/.test(pageText),
          hasTranslatePage: /翻译本页/.test(document.querySelector('.arxiv-translate-page-button')?.textContent ?? ''),
          hasSinglePaperTranslate: cardActionTexts.some((text) => /翻译/.test(text)),
          cardActionCounts: cardActionGroups.map((group) => group.querySelectorAll('button').length),
          cardHasSecondaryLeak: cardActionTexts.some((text) => /加入\s*PPT|更多|导出/.test(text)),
          detailHasPpt: /PPT/.test(detailActionText),
          detailHasExport: /导出/.test(detailActionText),
          hasRuntimeStatus: Boolean(runtimeStatus),
          runtimeDetailsCollapsed:
            Boolean(runtimeDetails) &&
            !runtimeDetails.hasAttribute('open') &&
            Boolean(runtimeStatus) &&
            getComputedStyle(runtimeStatus).display === 'none',
          legacyAccentValues,
          legacyAccentMaxChannelDelta: legacyAccentValues.reduce(
            (max, value) => Math.max(max, channelDelta(value)),
            0
          )
        };
      }`);
      if (resultsSnapshot.cardCount >= 3 && !translationTriggerSnapshot) {
        preTranslationZhCount = resultsSnapshot.zhCount;
        translationTriggerSnapshot = await evaluateJson(client, `() => {
          const card = document.querySelector('.arxiv-results-list > .arxiv-paper-card');
          const button = card?.querySelector('.arxiv-translation-trigger');
          const disabledBeforeClick = button?.disabled ?? null;
          button?.click();
          return {
            found: Boolean(button),
            disabledBeforeClick,
            immediateBusy: button?.getAttribute('aria-busy') === 'true',
            immediateClass: button?.classList.contains('is-translation-starting') ?? false,
            immediateLabel: button?.getAttribute('data-immediate-label') ?? ''
          };
        }`);
        await wait(110);
        translationProgressSnapshot = await evaluateJson(client, `() => {
          const feedback = document.querySelector('.arxiv-translation-feedback');
          const rect = feedback?.getBoundingClientRect();
          return {
            found: Boolean(feedback),
            active: Boolean(feedback?.matches('.is-warming, .is-title, .is-abstract')),
            label: feedback?.querySelector('.arxiv-translation-feedback-label')?.textContent?.trim() ?? '',
            width: rect ? Math.round(rect.width) : 0,
            height: rect ? Math.round(rect.height) : 0,
            hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
          };
        }`);
        await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
          writeFile(path.join(outputDir, 'arxiv-translation-progress.png'), Buffer.from(shot.data, 'base64'))
        );
      }
      if (
        resultsSnapshot.cardCount >= 3 &&
        resultsSnapshot.zhCount >= 1 &&
        resultsSnapshot.hasCompletedTranslationFeedback
      ) {
        break;
      }
      await wait(250);
    }

    const compressedCard = resultsSnapshot.cardRects.find((card) => card.height < 150);
    if (
      !resultsSnapshot.hasResultsList ||
      resultsSnapshot.cardCount < 3 ||
      resultsSnapshot.zhCount < 1 ||
      !resultsSnapshot.hasCompletedTranslationFeedback ||
      preTranslationZhCount !== 0 ||
      !translationTriggerSnapshot?.found ||
      translationTriggerSnapshot.disabledBeforeClick !== false ||
      !translationTriggerSnapshot.immediateBusy ||
      !translationTriggerSnapshot.immediateClass ||
      translationTriggerSnapshot.immediateLabel !== '翻译中' ||
      !translationProgressSnapshot?.found ||
      !translationProgressSnapshot.active ||
      !/标题|加载/.test(translationProgressSnapshot.label) ||
      translationProgressSnapshot.width < 120 ||
      translationProgressSnapshot.height < 20 ||
      translationProgressSnapshot.hasHorizontalOverflow ||
      resultsSnapshot.hasPageFilterPanel ||
      !resultsSnapshot.hasTopPageFilters ||
      compressedCard ||
      resultsSnapshot.hasHorizontalOverflow ||
      !resultsSnapshot.hasRankingScopeLabel ||
      !resultsSnapshot.hasTranslatePage ||
      !resultsSnapshot.hasSinglePaperTranslate ||
      resultsSnapshot.cardActionCounts.some((count) => count !== 3) ||
      resultsSnapshot.cardHasSecondaryLeak ||
      !resultsSnapshot.detailHasPpt ||
      !resultsSnapshot.detailHasExport ||
      !resultsSnapshot.hasRuntimeStatus ||
      !resultsSnapshot.runtimeDetailsCollapsed ||
      resultsSnapshot.legacyAccentMaxChannelDelta > 80 ||
      resultsSnapshot.legacyAccentMaxChannelDelta < 35
    ) {
      await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
        writeFile(path.join(outputDir, 'arxiv-search-results-failed.png'), Buffer.from(shot.data, 'base64'))
      );
      throw new Error(
        `arxiv: expected explicit progressive translation and readable result cards, got ${JSON.stringify({
          resultsSnapshot,
          preTranslationZhCount,
          translationTriggerSnapshot,
          translationProgressSnapshot
        })}`
      );
    }

    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'arxiv-search-results.png'), Buffer.from(shot.data, 'base64'))
    );

    await assertArxivSearchingControlGuards(client, mockInstalled);
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'arxiv-search-results-after-guard.png'), Buffer.from(shot.data, 'base64'))
    );

    threeColumnLayout = await waitForArxivResultLayout(client, 3, 'default three-column');
    if (
      threeColumnLayout.minCardWidth < 250 ||
      threeColumnLayout.minCardHeight < 120 ||
      threeColumnLayout.hasPageFilterPanel ||
      threeColumnLayout.hasLegacyFilterPanel ||
      !threeColumnLayout.hasTopPageFilters ||
      threeColumnLayout.searchButtonBackground === 'rgb(0, 0, 0)' ||
      threeColumnLayout.minCardWidth < 265 ||
      !threeColumnLayout.searchRect ||
      !threeColumnLayout.resultsPanelRect ||
      !threeColumnLayout.detailRect ||
      threeColumnLayout.searchResultsRightDelta > 8 ||
      threeColumnLayout.resultsPanelRect.width < 850 ||
      threeColumnLayout.detailRect.width < 260 ||
      threeColumnLayout.detailRect.width > 300 ||
      (threeColumnLayout.pageHeaderHeight ?? 0) > 78 ||
      (threeColumnLayout.searchRect?.height ?? 0) > 142 ||
      threeColumnLayout.maxSearchPrimaryControlHeight > 38 ||
      threeColumnLayout.maxFilterControlHeight > 38 ||
      (threeColumnLayout.resultsToolbarHeight ?? 0) > 42 ||
      (threeColumnLayout.paginationHeight ?? 0) > 46 ||
      threeColumnLayout.maxDetailActionHeight > 38 ||
      threeColumnLayout.maxTopicTileHeight > 58 ||
      threeColumnLayout.maxCardTitleHeight > 44 ||
      (threeColumnLayout.readingQueuePosition !== 'absolute' &&
        (threeColumnLayout.readingQueueToFirstCardGap ?? 8) < 8) ||
      threeColumnLayout.readingQueueNativeTitleCount > 0 ||
      threeColumnLayout.readingQueueOcclusionCount > 0 ||
      Math.abs(threeColumnLayout.detailSearchTopDelta ?? Number.POSITIVE_INFINITY) > 16
    ) {
      await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
        writeFile(path.join(outputDir, 'arxiv-search-results-three-failed.png'), Buffer.from(shot.data, 'base64'))
      );
      throw new Error(`arxiv: three-column cards are sparse, compressed, or misaligned, got ${JSON.stringify(threeColumnLayout)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'arxiv-search-results-three.png'), Buffer.from(shot.data, 'base64'))
    );
    await evaluateJson(client, `() => document.querySelector('.arxiv-reading-queue-toolbar-button')?.click()`);
    await wait(280);
    const shortlistOverlay = await evaluateJson(client, `() => {
      const overlay = document.querySelector('.arxiv-reading-queue-mini.is-open');
      const rect = overlay?.getBoundingClientRect();
      return {
        visible: Boolean(rect && rect.width > 0 && rect.height > 0),
        position: overlay ? getComputedStyle(overlay).position : '',
        paperCount: overlay?.querySelectorAll('.arxiv-reading-queue-paper').length ?? 0,
        width: rect?.width ?? 0,
        right: rect?.right ?? 0,
        viewportWidth: window.innerWidth,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3
      };
    }`);
    if (
      !shortlistOverlay.visible ||
      shortlistOverlay.position !== 'absolute' ||
      shortlistOverlay.paperCount !== 4 ||
      shortlistOverlay.width < 420 ||
      shortlistOverlay.right > shortlistOverlay.viewportWidth + 2 ||
      shortlistOverlay.hasHorizontalOverflow
    ) {
      throw new Error(`arxiv: shortlist popover should expand without resizing results, got ${JSON.stringify(shortlistOverlay)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'arxiv-shortlist-popover.png'), Buffer.from(shot.data, 'base64'))
    );
    await evaluateJson(client, `() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    await wait(180);
    const shortlistDismissed = await evaluateJson(client, `() => {
      const overlay = document.querySelector('.arxiv-reading-queue-mini');
      const rect = overlay?.getBoundingClientRect();
      return Boolean(overlay && (!rect || rect.height <= 2));
    }`);
    if (!shortlistDismissed) throw new Error('arxiv: shortlist popover did not close after outside click');
    await captureArxivResponsiveWidths(client);

    await evaluateJson(client, `() => document.querySelector('.arxiv-detail-panel-toggle')?.click()`);
    await wait(420);
    const collapsedDetailLayout = await readArxivResultLayout(client);
    if (
      collapsedDetailLayout.detailVisible ||
      !collapsedDetailLayout.detailRect ||
      collapsedDetailLayout.detailRect.width > 72 ||
      !collapsedDetailLayout.resultsPanelRect ||
      collapsedDetailLayout.resultsPanelRect.width <= threeColumnLayout.resultsPanelRect.width
    ) {
      await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
        writeFile(path.join(outputDir, 'arxiv-search-detail-collapsed-failed.png'), Buffer.from(shot.data, 'base64'))
      );
      throw new Error(`arxiv: collapsed detail panel should be a narrow rail and expand results, got ${JSON.stringify(collapsedDetailLayout)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'arxiv-search-detail-collapsed.png'), Buffer.from(shot.data, 'base64'))
    );
    await evaluateJson(client, `() => document.querySelector('.arxiv-detail-panel-toggle')?.click()`);
    await wait(320);

    const advancedFilterDensity = await readArxivAdvancedFilterDensity(client);
    if (
      !advancedFilterDensity.advancedVisible ||
      advancedFilterDensity.advancedOccluded ||
      advancedFilterDensity.hasHorizontalOverflow ||
      (advancedFilterDensity.advancedRect?.top ?? 0) + (advancedFilterDensity.advancedRect?.height ?? 0) >
        (advancedFilterDensity.resultsRect?.top ?? Number.POSITIVE_INFINITY) + 2 ||
      (advancedFilterDensity.searchRect?.height ?? 0) > 264 ||
      (advancedFilterDensity.advancedRect?.height ?? 0) > 116 ||
      (advancedFilterDensity.resultsRect?.top ?? Number.POSITIVE_INFINITY) -
        (advancedFilterDensity.searchRect?.top ?? 0) >
        274 ||
      Math.abs((advancedFilterDensity.detailRect?.top ?? 0) - (advancedFilterDensity.searchRect?.top ?? 0)) > 16
    ) {
      await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
        writeFile(path.join(outputDir, 'arxiv-search-advanced-failed.png'), Buffer.from(shot.data, 'base64'))
      );
      throw new Error(`arxiv: advanced filters are too tall or misaligned, got ${JSON.stringify(advancedFilterDensity)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'arxiv-search-advanced.png'), Buffer.from(shot.data, 'base64'))
    );
    await evaluateJson(client, `() => document.querySelector('.arxiv-advanced-toggle')?.click()`);
    await wait(250);

    await clickArxivLayoutButton(client, '双列');
    twoColumnLayout = await waitForArxivResultLayout(client, 2, 'two-column');
    if (twoColumnLayout.minCardWidth < 240 || twoColumnLayout.minCardHeight < 140) {
      await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
        writeFile(path.join(outputDir, 'arxiv-search-results-two-failed.png'), Buffer.from(shot.data, 'base64'))
      );
      throw new Error(`arxiv: two-column cards are too compressed, got ${JSON.stringify(twoColumnLayout)}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'arxiv-search-results-two.png'), Buffer.from(shot.data, 'base64'))
    );

    await clickArxivLayoutButton(client, '单列');
    oneColumnLayout = await waitForArxivResultLayout(client, 1, 'one-column');
    if (oneColumnLayout.minCardWidth < 360 || oneColumnLayout.minCardHeight < 150) {
      await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
        writeFile(path.join(outputDir, 'arxiv-search-results-one-failed.png'), Buffer.from(shot.data, 'base64'))
      );
      throw new Error(`arxiv: one-column cards are too compressed, got ${JSON.stringify(oneColumnLayout)}`);
    }
    const storedColumnMode = await evaluateJson(
      client,
      `() => window.localStorage.getItem('pdfTranslationReader:arxivResultColumnMode')`
    );
    if (storedColumnMode !== 'one') {
      throw new Error(`arxiv: expected persisted one-column mode, got ${storedColumnMode}`);
    }
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'arxiv-search-results-one.png'), Buffer.from(shot.data, 'base64'))
    );
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'arxiv-search-page.png'), Buffer.from(shot.data, 'base64'))
  );

  return { ...snapshot, resultsSnapshot, threeColumnLayout, twoColumnLayout, oneColumnLayout };
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
    const channelDelta = (value) => {
      const matches = [...String(value).matchAll(/rgba?\\(([^)]+)\\)/g)];
      const deltas = matches.map((match) => {
        const channels = match[1].match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        return Math.max(...channels) - Math.min(...channels);
      });
      return deltas.length > 0 ? Math.max(...deltas) : 0;
    };
    const colorTuples = (value) =>
      [...String(value).matchAll(/rgba?\\(([^)]+)\\)/g)].map((match) => {
        const channels = match[1].match(/\\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        return { value, r: channels[0], g: channels[1], b: channels[2] };
      });
    const readsAsBrown = ({ r, g, b }) =>
      r > b + 18 && g > b + 8 && r >= g - 4 && r - g < 72;
    const oldAccentValues = [
      getComputedStyle(document.querySelector('.settings-page .eyebrow') ?? document.body).color,
      getComputedStyle(document.querySelector('.settings-page input[type="checkbox"]:checked') ?? document.body).accentColor,
      getComputedStyle(document.querySelector('.settings-page .settings-header') ?? document.body).backgroundColor,
      getComputedStyle(document.querySelector('.settings-page .settings-header') ?? document.body).backgroundImage
    ];
    const activeNavBackground = getComputedStyle(
      document.querySelector('.settings-nav button.active') ?? document.body
    ).backgroundColor;
    const warmBrownAccentValues = [...oldAccentValues, activeNavBackground]
      .flatMap(colorTuples)
      .filter(readsAsBrown);
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
      pathRows: document.querySelectorAll('.path-input-row').length,
      disabledTodoDirectoryButtons: [...document.querySelectorAll('.path-input-row button')]
        .filter((button) => button.disabled || /TODO/.test(button.getAttribute('title') ?? '')).length,
      oldAccentValues,
      warmBrownAccentValues,
      oldAccentMaxChannelDelta: oldAccentValues.reduce((max, value) => Math.max(max, channelDelta(value)), 0),
      activeNavBackground,
      activeNavMaxChannelDelta: channelDelta(activeNavBackground),
      headerBackgroundImage: getComputedStyle(document.querySelector('.settings-page .settings-header') ?? document.body)
        .backgroundImage,
      headerIconFilter: getComputedStyle(
        document.querySelector('.settings-page .settings-header .panel-title-icon') ?? document.body
      ).filter
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
  if (snapshot.disabledTodoDirectoryButtons > 0) {
    throw new Error(`settings: directory picker buttons should be enabled and not TODO, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.oldAccentMaxChannelDelta > 80) {
    throw new Error(`settings: high-saturation legacy accent found, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.oldAccentMaxChannelDelta < 35) {
    throw new Error(`settings: page accents have collapsed back to grayscale, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.warmBrownAccentValues.length > 0) {
    throw new Error(`settings: warm brown accent has returned, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.activeNavMaxChannelDelta < 25 || snapshot.activeNavMaxChannelDelta > 80) {
    throw new Error(`settings: active nav still reads as grayscale or high-saturation accent, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.headerBackgroundImage !== 'none' || snapshot.headerIconFilter === 'none') {
    throw new Error(`settings: legacy header gradient or unfiltered icon found, got ${JSON.stringify(snapshot)}`);
  }
  if (!/通用设置/.test(snapshot.activeText) || snapshot.formControlCount < 3) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'settings-page-controls-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`settings: general settings should expose direct controls, got ${JSON.stringify(snapshot)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'settings-page.png'), Buffer.from(shot.data, 'base64'))
  );

  return snapshot;
}

async function runScientificPlotScenario(client) {
  await clickSidebarSection(client, 'plot');
  await waitForAppReady(client);
  await clickButtonByText(client, '＋ 导入数据');
  const selectedPaste = await evaluateJson(client, `() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => (item.textContent ?? '').includes('粘贴表格'));
    button?.click();
    return Boolean(button);
  }`);
  if (!selectedPaste) throw new Error('scientificPlot: paste import source was not found');
  const seeded = await evaluateJson(client, `() => {
    const textarea = document.querySelector('textarea');
    if (!textarea) return false;
    const value = [
      'algorithm\\tsteps\\tsuccess_rate\\tci_low\\tci_high',
      'PPO\\t50000\\t0.43\\t0.40\\t0.46',
      'PPO\\t100000\\t0.52\\t0.49\\t0.55',
      'PPO\\t150000\\t0.61\\t0.58\\t0.64',
      'SAC\\t50000\\t0.40\\t0.37\\t0.43',
      'SAC\\t100000\\t0.48\\t0.45\\t0.51',
      'SAC\\t150000\\t0.57\\t0.54\\t0.60',
      'CBF-RL\\t50000\\t0.46\\t0.43\\t0.49',
      'CBF-RL\\t100000\\t0.58\\t0.55\\t0.61',
      'CBF-RL\\t150000\\t0.69\\t0.66\\t0.72'
    ].join('\\n');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }`);
  if (!seeded) throw new Error('scientificPlot: paste editor was not found');
  await clickButtonByText(client, '导入并创建数据快照');
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await evaluateJson(client, `() => Boolean(document.querySelector('[data-plot-canvas] canvas'))`);
    if (ready) break;
    await wait(150);
  }
  const snapshot = await evaluateJson(client, `() => {
    const page = document.querySelector('[data-scientific-plot-page]');
    const canvas = document.querySelector('[data-plot-canvas] canvas');
    const workspace = page?.children[1];
    const workspaceRect = workspace?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const activeSidebar = document.querySelector('.app-sidebar-link.active')?.getAttribute('data-sidebar-section') ?? '';
    const buttons = [...document.querySelectorAll('button')].map((item) => (item.textContent ?? '').trim());
    return {
      hasPage: Boolean(page),
      hasCanvas: Boolean(canvas),
      activeSidebar,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 3,
      workspaceWidth: Math.round(workspaceRect?.width ?? 0),
      canvasWidth: Math.round(canvasRect?.width ?? 0),
      canvasHeight: Math.round(canvasRect?.height ?? 0),
      hasRuntimeAction: buttons.includes('管理环境'),
      hasExportAction: buttons.includes('导出结果'),
      dialogCount: document.querySelectorAll('[role="dialog"]').length,
      bodyText: (document.body.textContent ?? '').slice(0, 1200)
    };
  }`);
  if (!snapshot.hasPage || !snapshot.hasCanvas || snapshot.activeSidebar !== 'plot' || snapshot.hasHorizontalOverflow || snapshot.canvasWidth < 480 || snapshot.canvasHeight < 330 || !snapshot.hasRuntimeAction || !snapshot.hasExportAction || snapshot.dialogCount !== 0) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'scientific-plot-page-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`scientificPlot: layout or real canvas validation failed, got ${JSON.stringify(snapshot)}`);
  }
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'scientific-plot-page.png'), Buffer.from(shot.data, 'base64'))
  );
  await clickButtonByText(client, '样式');
  await wait(200);
  const styleInspector = await evaluateJson(client, `() => {
    const sections = [...document.querySelectorAll('section')];
    const inspector = sections
      .find((section) => (section.textContent ?? '').includes('字体、线条与配色'))?.parentElement;
    const legendSection = sections.find((section) => section.querySelector('h3')?.textContent?.trim() === '图例');
    const labels = [...(inspector?.querySelectorAll('label') ?? [])].map((item) => (item.textContent ?? '').trim());
    const fontLabel = [...(inspector?.querySelectorAll('label') ?? [])]
      .find((item) => (item.textContent ?? '').trim().startsWith('字体'));
    const fontSelect = fontLabel?.querySelector('select');
    legendSection?.scrollIntoView({ block: 'start', inline: 'nearest' });
    return {
      hasFontSelector: Boolean(fontSelect && fontSelect.options.length >= 5),
      hasLegendPosition: labels.some((label) => label.startsWith('位置')),
      hasLegendOrientation: labels.some((label) => label.startsWith('排列')),
      hasCustomLegendCoordinates: labels.some((label) => label.startsWith('自定义 X')) && labels.some((label) => label.startsWith('自定义 Y')),
      hasLegendAppearance: labels.some((label) => label.startsWith('项目间距')) && labels.some((label) => label.startsWith('边框宽度')),
      horizontalOverflow: Boolean(inspector && inspector.scrollWidth > inspector.clientWidth + 3)
    };
  }`);
  if (!styleInspector.hasFontSelector || !styleInspector.hasLegendPosition || !styleInspector.hasLegendOrientation || !styleInspector.hasCustomLegendCoordinates || !styleInspector.hasLegendAppearance || styleInspector.horizontalOverflow) {
    throw new Error(`scientificPlot: font or legend controls are incomplete, got ${JSON.stringify(styleInspector)}`);
  }
  await wait(150);
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'scientific-plot-style-editor.png'), Buffer.from(shot.data, 'base64'))
  );
  const axisEditor = await evaluateJson(client, `() => {
    const sections = [...document.querySelectorAll('section')];
    const xSection = sections.find((section) => section.querySelector('h3')?.textContent?.trim() === '横轴 X');
    const ySection = sections.find((section) => section.querySelector('h3')?.textContent?.trim() === '纵轴 Y');
    const setNumber = (section, labelText, value) => {
      const label = [...(section?.querySelectorAll('label') ?? [])]
        .find((item) => (item.textContent ?? '').trim().startsWith(labelText));
      const input = label?.querySelector('input[type="number"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const changedMin = setNumber(xSection, '最小值', 40000);
    const changedMax = setNumber(xSection, '最大值', 160000);
    xSection?.scrollIntoView({ block: 'start', inline: 'nearest' });
    const inspector = xSection?.closest('[class*="inspector"]') ?? xSection?.parentElement;
    return {
      hasX: Boolean(xSection),
      hasY: Boolean(ySection),
      hasScale: Boolean(xSection && (xSection.textContent ?? '').includes('尺度')),
      hasTickFormat: Boolean(xSection && (xSection.textContent ?? '').includes('数字格式')),
      hasGridControls: Boolean(xSection && (xSection.textContent ?? '').includes('网格与标题')),
      changedMin,
      changedMax,
      horizontalOverflow: Boolean(inspector && inspector.scrollWidth > inspector.clientWidth + 3)
    };
  }`);
  if (!axisEditor.hasX || !axisEditor.hasY || !axisEditor.hasScale || !axisEditor.hasTickFormat || !axisEditor.hasGridControls || !axisEditor.changedMin || !axisEditor.changedMax || axisEditor.horizontalOverflow) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'scientific-plot-axis-editor-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`scientificPlot: axis editor validation failed, got ${JSON.stringify(axisEditor)}`);
  }
  await wait(200);
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'scientific-plot-axis-editor.png'), Buffer.from(shot.data, 'base64'))
  );
  await clickButtonByText(client, '管理环境');
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await evaluateJson(client, `() => Boolean(document.querySelector('[role="dialog"]'))`);
    if (ready) break;
    await wait(250);
  }
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const detected = await evaluateJson(client, `() => {
      const renderer = document.querySelector('select[aria-label="选择绘图语言"]');
      const options = renderer ? [...renderer.options].slice(1).map((option) => option.textContent ?? '') : [];
      return options.length === 3 && options.every((option) => !option.includes('检测中') && !option.includes('未检测'));
    }`);
    if (detected) break;
    await wait(250);
  }
  const runtimeDialog = await evaluateJson(client, `() => {
    const dialog = document.querySelector('[role="dialog"]');
    const renderer = document.querySelector('select[aria-label="选择绘图语言"]');
    const optionTexts = renderer ? [...renderer.options].map((option) => option.textContent ?? '') : [];
    const rect = dialog?.getBoundingClientRect();
    const text = dialog?.textContent ?? '';
    return {
      visible: Boolean(dialog),
      width: Math.round(rect?.width ?? 0),
      withinViewport: Boolean(rect && rect.left >= 0 && rect.right <= window.innerWidth),
      hasGlobalFirstCopy: text.includes('优先使用系统已有环境'),
      hasMatlabChoice: optionTexts.some((option) => option.includes('MATLAB（')),
      hasMatlabGuidance: text.includes('可在顶部“绘图语言”中选择') || text.includes('仅检测，不安装'),
      hasRepairOrFallback: text.includes('修复现有环境') || text.includes('安装私有环境'),
      horizontalOverflow: Boolean(dialog && dialog.scrollWidth > dialog.clientWidth + 3),
      optionTexts
    };
  }`);
  if (!runtimeDialog.visible || runtimeDialog.width < 640 || !runtimeDialog.withinViewport || !runtimeDialog.hasGlobalFirstCopy || !runtimeDialog.hasMatlabChoice || !runtimeDialog.hasMatlabGuidance || runtimeDialog.horizontalOverflow) {
    await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
      writeFile(path.join(outputDir, 'scientific-plot-runtime-dialog-failed.png'), Buffer.from(shot.data, 'base64'))
    );
    throw new Error(`scientificPlot: runtime dialog validation failed, got ${JSON.stringify(runtimeDialog)}`);
  }
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'scientific-plot-runtime-dialog.png'), Buffer.from(shot.data, 'base64'))
  );
  await clickButtonByText(client, '关闭');
  const matlabSelected = await evaluateJson(client, `() => {
    const renderer = document.querySelector('select[aria-label="选择绘图语言"]');
    if (!renderer) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(renderer, 'matlab');
    renderer.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }`);
  if (!matlabSelected) throw new Error('scientificPlot: MATLAB renderer selector was not found');
  await wait(300);
  const matlabState = await evaluateJson(client, `() => {
    const renderer = document.querySelector('select[aria-label="选择绘图语言"]');
    return { value: renderer?.value ?? '', text: renderer?.selectedOptions[0]?.textContent ?? '' };
  }`);
  if (matlabState.value !== 'matlab' || !matlabState.text.includes('MATLAB（已检测）')) {
    throw new Error(`scientificPlot: MATLAB could not be selected from the renderer dropdown, got ${JSON.stringify(matlabState)}`);
  }
  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'scientific-plot-matlab-selected.png'), Buffer.from(shot.data, 'base64'))
  );
  await clickSidebarSection(client, 'researchSheet');
  return { ...snapshot, styleInspector, axisEditor, runtimeDialog, matlabState };
}

async function main() {
  if (usePackagedApp) {
    if (!existsSync(packagedExe)) {
      throw new Error(`Packaged executable not found. Run npm run dist first: ${packagedExe}`);
    }
    if (!existsSync(packagedInstaller)) {
      throw new Error(`Versioned installer not found. Run npm run dist first: ${packagedInstaller}`);
    }
  } else {
    if (!existsSync(electronExe)) {
      throw new Error(`Electron runtime not found. Run npm install first: ${electronExe}`);
    }
    if (!existsSync(electronMainEntry) || !existsSync(rendererIndex)) {
      throw new Error(
        `Built app files not found. Run npm run build first: ${electronMainEntry}, ${rendererIndex}`
      );
    }
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

  const appCommand = usePackagedApp ? packagedExe : electronExe;
  const debugFlags = [`--remote-debugging-port=${port}`, ...(disableGpu ? ['--disable-gpu'] : [])];
  const appArgs = usePackagedApp
    ? debugFlags
    : [...debugFlags, electronMainEntry];

  const appProcess = spawn(appCommand, appArgs, {
    env: {
      ...process.env,
      PDF_TRANSLATION_READER_USER_DATA_DIR: visualUserDataDir,
      PDF_TRANSLATION_READER_VISUAL_MOCK_ARXIV: visualArxivMockMode,
      PDF_TRANSLATION_READER_VISUAL_MOCK_DICTIONARY: '1',
      ...(!usePackagedApp ? { PDF_TRANSLATION_READER_LOAD_BUILT_RENDERER: '1' } : {})
    },
    windowsHide: true,
    stdio: 'ignore'
  });

  let client = null;
  try {
    client = await createCdpClient(await waitForWebSocketUrl());
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

    if (visualScenario === 'paper-library') {
      const home = await runHomeScenario(client);
      client.close();
      console.log(JSON.stringify({ pdfPath, home, outputDir }, null, 2));
      return;
    }

    if (visualScenario === 'scientific-plot') {
      const scientificPlot = await runScientificPlotScenario(client);
      client.close();
      console.log(JSON.stringify({ pdfPath, scientificPlot, outputDir }, null, 2));
      return;
    }

    if (visualScenario === 'pdf-selection') {
      const pdfSelection = await runPdfSelectionTranslationScenario(client);
      client.close();
      console.log(JSON.stringify({ pdfPath, pdfSelection, outputDir }, null, 2));
      return;
    }

    if (visualScenario === 'arxiv') {
      const arxivSearch = await runArxivSearchScenario(client);
      client.close();
      console.log(JSON.stringify({ pdfPath, arxivSearch, outputDir }, null, 2));
      return;
    }

    if (visualScenario === 'figure-assets') {
      const wholePdfReader = await runWholePdfReaderScenario(client);
      client.close();
      console.log(JSON.stringify({ pdfPath, wholePdfReader, outputDir }, null, 2));
      return;
    }

    if (visualScenario === 'figure-assets-early') {
      const earlyFigureExtraction = await runEarlyFigureExtractionScenario(client);
      client.close();
      console.log(JSON.stringify({ pdfPath, earlyFigureExtraction, outputDir }, null, 2));
      return;
    }

    const home = await runHomeScenario(client);
    const experimentMatrix = await runExperimentMatrixScenario(client);
    const researchSheet = await runResearchSheetScenario(client);
    const scientificPlot = await runScientificPlotScenario(client);
    const wholePdfReader = await runWholePdfReaderScenario(client);
    const presentation = await runPresentationScenario(client);
    const aiAssistant = await runAiAssistantScenario(client);
    const paperTutor = await runPaperTutorScenario(client);
    const knowledgeGraph = await runKnowledgeGraphScenario(client);
    const arxivSearch = await runArxivSearchScenario(client);
    const settings = await runSettingsScenario(client);
    client.close();
    console.log(
      JSON.stringify(
        { pdfPath, home, experimentMatrix, researchSheet, scientificPlot, wholePdfReader, presentation, aiAssistant, paperTutor, knowledgeGraph, arxivSearch, settings, outputDir },
        null,
        2
      )
    );
  } finally {
    client?.close();
    terminateAppProcessTree(appProcess);
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

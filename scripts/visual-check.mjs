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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  throw new Error('Research sheet canvas did not paint visible grid content.');
}

async function clickSelector(client, selector) {
  await client.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})?.click()`,
    returnByValue: true
  });
  await wait(600);
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
  const snapshot = await evaluateJson(client, `() => ({
    hasHome: Boolean(document.querySelector('.home-page')),
    hasAgGrid: Boolean(document.querySelector('.ag-root, .paper-grid')),
    hasPaperTable: Boolean(document.querySelector('.paper-table')),
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

  if (!snapshot.hasHome || !snapshot.hasPaperTable) {
    throw new Error(`home: expected lightweight paper table, got ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.hasAgGrid || /创新点|局限点|复现计划|后续/.test(snapshot.headerText)) {
    throw new Error(`home: paper library should not contain research spreadsheet columns, got ${snapshot.headerText}`);
  }
  if (!snapshot.headerActions.includes('研究表格')) {
    throw new Error(`home: expected research sheet entry, got ${JSON.stringify(snapshot.headerActions)}`);
  }
  if (!snapshot.imageAlpha || snapshot.imageAlpha.some((alpha) => alpha !== 0)) {
    throw new Error(`home: expected transparent icon corners, got ${JSON.stringify(snapshot.imageAlpha)}`);
  }
  if (
    snapshot.markStyle?.background !== 'rgba(0, 0, 0, 0)' ||
    snapshot.markStyle?.border !== '0px' ||
    snapshot.markStyle?.boxShadow !== 'none'
  ) {
    throw new Error(`home: expected no icon wrapper background/border/shadow, got ${JSON.stringify(snapshot.markStyle)}`);
  }

  await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((shot) =>
    writeFile(path.join(outputDir, 'home.png'), Buffer.from(shot.data, 'base64'))
  );
  return snapshot;
}

async function runResearchSheetScenario(client) {
  await clickSelector(client, '.home-header-actions button:first-child');
  await waitForAppReady(client);
  const canvasStatus = await waitForResearchSheetCanvas(client);

  const snapshot = await evaluateJson(client, `() => ({
    hasResearchSheet: Boolean(document.querySelector('.research-sheet-page')),
    hasUniver: Boolean(document.querySelector('.univer-container')),
    commandText: document.querySelector('.research-command-bar')?.textContent ?? '',
    hasAiButton: [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('AI 填此单元格')),
    titleText: document.querySelector('.research-sheet-header')?.textContent ?? '',
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
  if (!snapshot.commandText.includes('绑定论文到当前行') || !snapshot.titleText.includes('研究表格')) {
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

async function main() {
  if (!existsSync(exe)) {
    throw new Error(`Packaged executable not found. Run npm run dist first: ${exe}`);
  }
  if (!existsSync(pdfPath)) {
    throw new Error(`Visual check PDF not found: ${pdfPath}`);
  }

  await mkdir(outputDir, { recursive: true });
  await rm(visualUserDataDir, { recursive: true, force: true });
  await mkdir(visualUserDataDir, { recursive: true });

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
    await loadPaperRecord(client, translationPath);
    await waitForAppReady(client);

    const home = await runHomeScenario(client);
    const researchSheet = await runResearchSheetScenario(client);
    client.close();
    console.log(JSON.stringify({ pdfPath, home, researchSheet, outputDir }, null, 2));
  } finally {
    appProcess.kill();
    await wait(500);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

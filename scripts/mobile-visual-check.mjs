import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const runner = path.join(root, 'scripts', 'mobile-visual-runner.cjs');
const outputDir = path.join(root, '.tmp-mobile-visual-check');
const userDataDir = path.join(outputDir, 'user-data');
const debugPort = 9443;
const mockPort = 9444;
const translationMockState = { imageRequestCount: 0, textRequestCount: 0 };

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
(Safe Policy Optimization with Control Barrier Functions) Tj
0 -36 Td
/F1 14 Tf
(The policy update preserves forward invariance under bounded disturbances.) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f${' '}
0000000009 00000 n${' '}
0000000058 00000 n${' '}
0000000115 00000 n${' '}
0000000241 00000 n${' '}
0000000311 00000 n${' '}
trailer
<< /Size 6 /Root 1 0 R >>
startxref
559
%%EOF
`,
    'ascii'
  );
}

function createScannedFallbackPdfBuffer(pageCount = 3) {
  const content = `q
0.94 g
54 96 487 650 re f
0.12 g
76 700 410 22 re f
0.45 g
76 660 360 8 re f
76 638 420 8 re f
76 616 390 8 re f
76 570 420 8 re f
76 548 410 8 re f
Q`;
  const pageObjectNumbers = Array.from({ length: pageCount }, (_, index) => 3 + index * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectNumbers.map(number => `${number} 0 R`).join(' ')}] >>`
  ];
  for (let index = 0; index < pageCount; index += 1) {
    const contentObjectNumber = 4 + index * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`
    );
  }
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(source, 'ascii'));
    source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source, 'ascii');
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, 'ascii');
}

async function waitForWebSocketUrl() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      const pages = await response.json();
      const page = pages.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (page) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      // Electron may still be starting.
    }
    await wait(250);
  }
  throw new Error('Timed out waiting for the mobile visual-check debug endpoint.');
}

async function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const callbacks = new Map();
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (!payload.id || !callbacks.has(payload.id)) {
      return;
    }
    const callback = callbacks.get(payload.id);
    callbacks.delete(payload.id);
    payload.error ? callback.reject(new Error(payload.error.message)) : callback.resolve(payload.result);
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          callbacks.delete(id);
          reject(new Error(`Timed out waiting for CDP command: ${method}`));
        }, 15000);
        callbacks.set(id, {
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timer);
            reject(error);
          }
        });
      });
    },
    close() {
      socket.close();
    }
  };
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression: `(async () => (${expression}))()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitForSelector(client, selector, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)) {
      return;
    }
    await wait(200);
  }
  throw new Error(`Timed out waiting for selector: ${selector}`);
}

async function waitForExpression(client, expression, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await evaluate(client, expression);
    if (value) {
      return value;
    }
    await wait(200);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function waitForSelectorToDisappear(client, selector, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await evaluate(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`))) {
      return;
    }
    await wait(200);
  }
  throw new Error(`Timed out waiting for selector to disappear: ${selector}`);
}

async function capture(client, name) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  });
  await writeFile(path.join(outputDir, name), Buffer.from(result.data, 'base64'));
}

function startTranslationMock() {
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      const source = parsed.messages?.at(-1)?.content ?? '';
      if (Array.isArray(source)) {
        translationMockState.imageRequestCount += 1;
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'DeepSeek mock does not accept image input.' } }));
        return;
      }
      translationMockState.textRequestCount += 1;
      const system = parsed.messages?.[0]?.content ?? '';
      let translation;
      if (typeof system === 'string' && system.includes('OCR 校对、版面重排和翻译助手')) {
        const pageBlocks = JSON.parse(source).blocks ?? [];
        translation = JSON.stringify({ paragraphs: pageBlocks.map((block) => ({
          original: block.text,
          translation: block.text.includes('Vision Safety Policy')
            ? '视觉安全策略'
            : '策略更新在有界扰动下保持前向不变性，从而使安全约束在执行过程中持续成立。',
          type: block.type
        })) });
      } else {
        translation = source.includes('Vision Safety Policy')
        ? '视觉安全策略'
        : source.includes('shifting liquid continuously')
          ? '现在，往杯中注水并倾倒：流动的液体会持续重新分配抓取器指尖上的重力载荷，这要求实时调整抓取力，而固定抓取力或开环抓取无法实现这一点。核心难点在于抓取稳定性与物体安全性紧密耦合：抓取力不足会导致微小滑移和掉落，而稍大的力则会造成不可逆变形。因此，实用的抓取控制器必须实时检测并抑制初始滑移，在承载物载荷减小时降低抓取力以防止过度抓取，并强制执行接触力的硬性安全上限。'
          : source.length < 40
          ? '前向不变性'
          : '策略更新在有界扰动下保持前向不变性，从而使安全约束在执行过程中持续成立。';
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: translation } }] }));
    });
  });
  return new Promise((resolve) => server.listen(mockPort, '127.0.0.1', () => resolve(server)));
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(userDataDir, { recursive: true });
const mockServer = await startTranslationMock();
const processHandle = spawn(electron, [`--remote-debugging-port=${debugPort}`, runner], {
  cwd: root,
  env: { ...process.env, FTRANSLATE_MOBILE_VISUAL_USER_DATA: userDataDir },
  windowsHide: true,
  stdio: 'ignore'
});

let client;
try {
  client = await createCdpClient(await waitForWebSocketUrl());
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Page.bringToFront');
  const localOcrTestSource = `globalThis.__FTRANSLATE_MOBILE_OCR_TEST__ = async (_image, page) => {
    await new Promise(resolve => setTimeout(resolve, page === 2 ? 800 : 80));
    const heading = 'Vision Safety Policy Page ' + page;
    const body = 'Page ' + page + '. Now fill it with water and pour: the shifting liquid continuously redistributes the gravitational load along the gripper fingers, demanding real-time effort modulation that fixed-effort or open-loop grasping cannot achieve. The core difficulty is that grasp stability and object safety are tightly coupled: insufficient effort leads to micro-slip and drop, while only slightly more force causes irreversible deformation. A practical grasp controller must therefore detect and suppress incipient slip in real time, reduce effort when the carried load decreases to prevent over-gripping, and enforce a hard safety limit on contact force.';
    const fragmentedParagraphs = (heading + ' ' + body).split(/\\s+/).map(word => ({ text: word }));
    return {
      text: heading + '\\n\\n' + body,
      blocks: page === 1 ? [{ paragraphs: fragmentedParagraphs }] : page === 2 ? [
        { paragraphs: [{ text: heading }] },
        { paragraphs: [{ text: 'EE' }] },
        { paragraphs: [{ text: body }] },
        { paragraphs: [{ text: '4' }] },
        { paragraphs: [{ text: 'age manipulation of' }] }
      ] : [
        { paragraphs: [{ text: heading }] },
        { paragraphs: [{ text: body }] }
      ]
    };
  };`;
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: localOcrTestSource });
  await client.send('Runtime.evaluate', { expression: localOcrTestSource });
  console.log('Mobile visual check connected to Electron.');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844
  });
  await waitForSelector(client, '.mobile-library-screen');
  await evaluate(client, `(() => {
    localStorage.setItem('CapacitorStorage.pdfTranslationReader:mobileLibrary:v1', JSON.stringify([{
      id: 'legacy-mobile-record',
      title: 'Legacy mobile paper',
      lastPage: 3,
      sourcePdf: { path: 'papers/legacy/source/paper.pdf', fileName: 'paper.pdf', byteLength: 120 }
    }]));
    return true;
  })()`);
  await client.send('Page.reload', { ignoreCache: true });
  await waitForSelector(client, '.mobile-library-screen');
  await waitForSelector(client, '.mobile-paper-row');
  const recoveredLegacyRecord = await evaluate(client, `(() => ({
    title: document.querySelector('.mobile-paper-row strong')?.textContent ?? '',
    bodyText: document.body.textContent ?? ''
  }))()`);
  if (recoveredLegacyRecord.title !== 'Legacy mobile paper' || recoveredLegacyRecord.bodyText.includes('手机阅读器遇到异常')) {
    throw new Error(`Mobile legacy record recovery failed: ${JSON.stringify(recoveredLegacyRecord)}`);
  }
  await evaluate(client, `localStorage.removeItem('CapacitorStorage.pdfTranslationReader:mobileLibrary:v1')`);
  await client.send('Page.reload', { ignoreCache: true });
  await waitForSelector(client, '.mobile-library-screen');
  await waitForSelectorToDisappear(client, '.mobile-paper-row');
  console.log('Recovered a legacy mobile library record without a white screen.');
  await wait(350);
  await capture(client, '01-library-empty-390x844.png');
  console.log('Captured empty library.');

  await evaluate(client, `document.querySelectorAll('.mobile-bottom-nav button')[1].click()`);
  await waitForSelector(client, '.mobile-arxiv-screen');
  await wait(350);
  await capture(client, '02-arxiv-idle-390x844.png');
  console.log('Captured arXiv search.');
  if (process.env.FTRANSLATE_MOBILE_VISUAL_URL) {
    await evaluate(client, `(() => {
      const input = document.querySelector('.mobile-arxiv-search-form input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'safe reinforcement learning');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const sort = document.querySelector('.mobile-arxiv-filters select');
      const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      selectSetter.call(sort, 'relevance');
      sort.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('.mobile-arxiv-search-form').requestSubmit();
      return true;
    })()`);
    await waitForSelector(client, '.mobile-arxiv-result', 45000);
    const successfulResultCount = await evaluate(client, `document.querySelectorAll('.mobile-arxiv-result').length`);
    await evaluate(client, `document.querySelector('.mobile-arxiv-translate-title').click()`);
    await waitForSelector(client, '.mobile-translation-dialog');
    await evaluate(client, `(() => {
      const values = ['http://127.0.0.1:${mockPort}/v1', 'visual-model', 'visual-key'];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      document.querySelectorAll('.mobile-translation-dialog input').forEach((input, index) => {
        setter.call(input, values[index]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      document.querySelector('.mobile-dialog-primary').click();
      return true;
    })()`);
    await waitForSelector(client, '.mobile-arxiv-title-zh', 20000);
    await capture(client, '02a-arxiv-title-translation-390x844.png');
    console.log('Captured an arXiv title translated directly below the English title.');
    const searchStateBeforeNavigation = await evaluate(client, `(() => ({
      query: document.querySelector('.mobile-arxiv-search-form input')?.value ?? '',
      resultCount: document.querySelectorAll('.mobile-arxiv-result').length,
      translatedTitle: document.querySelector('.mobile-arxiv-title-zh')?.textContent ?? ''
    }))()`);
    await evaluate(client, `document.querySelectorAll('.mobile-bottom-nav button')[0].click()`);
    await waitForSelector(client, '.mobile-library-screen');
    await evaluate(client, `document.querySelectorAll('.mobile-bottom-nav button')[1].click()`);
    await waitForSelector(client, '.mobile-arxiv-screen');
    const searchStateAfterNavigation = await evaluate(client, `(() => ({
      query: document.querySelector('.mobile-arxiv-search-form input')?.value ?? '',
      resultCount: document.querySelectorAll('.mobile-arxiv-result').length,
      translatedTitle: document.querySelector('.mobile-arxiv-title-zh')?.textContent ?? ''
    }))()`);
    if (
      searchStateAfterNavigation.query !== searchStateBeforeNavigation.query ||
      searchStateAfterNavigation.resultCount !== searchStateBeforeNavigation.resultCount ||
      searchStateAfterNavigation.translatedTitle !== searchStateBeforeNavigation.translatedTitle
    ) {
      throw new Error(`Mobile arXiv navigation lost search state: ${JSON.stringify({ searchStateBeforeNavigation, searchStateAfterNavigation })}`);
    }
    console.log(`Preserved ${searchStateAfterNavigation.resultCount} arXiv results and translated title across tab navigation.`);
    await evaluate(client, `(() => {
      window.__mobileVisualFetches = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        const request = args[0];
        window.__mobileVisualFetches.push(typeof request === 'string' ? request : request?.url ?? String(request));
        return originalFetch(...args);
      };
      return true;
    })()`);
    const livePdfSaveTarget = await evaluate(client, `(() => {
      const results = Array.from(document.querySelectorAll('.mobile-arxiv-result'));
      const target = results.find((result) => result.querySelector('h2')?.textContent?.includes('Integrating Physics-Informed Neural Networks')) ?? results[0];
      const button = target?.querySelector('.mobile-arxiv-result-actions button');
      button?.click();
      return target?.querySelector('h2')?.textContent ?? '';
    })()`);
    if (!livePdfSaveTarget) {
      throw new Error('No live arXiv result was available for the PDF save check.');
    }
    try {
      const saveOutcome = await waitForExpression(
        client,
        `document.querySelector('.mobile-reader-screen')
          ? 'reader'
          : (document.querySelector('.mobile-global-notice')?.textContent?.includes('失败') ? 'error' : '')`,
        60000
      );
      if (saveOutcome !== 'reader') {
        throw new Error('The application reported an error while saving the live arXiv PDF.');
      }
    } catch (error) {
      await capture(client, '02b-arxiv-live-pdf-failed-390x844.png');
      const saveFailureState = await evaluate(client, `(() => ({
        notice: document.querySelector('.mobile-global-notice')?.textContent ?? '',
        action: document.querySelector('.mobile-arxiv-result-actions button')?.textContent ?? '',
        libraryCards: document.querySelectorAll('.mobile-paper-card').length,
        readerVisible: Boolean(document.querySelector('.mobile-reader-screen')),
        fetches: window.__mobileVisualFetches ?? []
      }))()`);
      throw new Error(`Live arXiv PDF save did not open the reader: ${JSON.stringify(saveFailureState)}; ${error.message}`);
    }
    await capture(client, '02b-arxiv-live-pdf-opened-390x844.png');
    console.log(`Downloaded a live arXiv PDF through the same-origin proxy, stored it, and opened the reader: ${livePdfSaveTarget}`);
    await evaluate(client, `document.querySelector('.mobile-reader-back').click()`);
    await waitForSelector(client, '.mobile-library-screen');
    await evaluate(client, `document.querySelectorAll('.mobile-bottom-nav button')[1].click()`);
    await waitForSelector(client, '.mobile-arxiv-title-zh');
    await client.send('Network.enable');
    await client.send('Network.setBlockedURLs', { urls: ['*://*/api/arxiv*'] });
    await evaluate(client, `(() => {
      const input = document.querySelector('.mobile-arxiv-search-form input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'forced network failure');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('.mobile-arxiv-search-form').requestSubmit();
      return true;
    })()`);
    await waitForSelector(client, '.mobile-arxiv-status.is-error', 20000);
    const failedSearchState = await evaluate(client, `(() => ({
      resultCount: document.querySelectorAll('.mobile-arxiv-result').length,
      status: document.querySelector('.mobile-arxiv-status')?.textContent ?? ''
    }))()`);
    await client.send('Network.setBlockedURLs', { urls: [] });
    if (successfulResultCount < 1 || failedSearchState.resultCount !== 0) {
      throw new Error(`Mobile arXiv failed-search cleanup failed: ${JSON.stringify({ successfulResultCount, failedSearchState })}`);
    }
    await capture(client, '02c-arxiv-error-cleared-390x844.png');
    console.log(`Verified failed arXiv search clears ${successfulResultCount} stale results.`);
  }
  await evaluate(client, `document.querySelectorAll('.mobile-bottom-nav button')[0].click()`);
  await waitForSelector(client, '.mobile-library-screen');

  const pdfBase64 = createFallbackPdfBuffer().toString('base64');
  await evaluate(client, `(() => {
    const binary = atob(${JSON.stringify(pdfBase64)});
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const file = new File([bytes], 'safe-policy-optimization.pdf', { type: 'application/pdf', lastModified: 1 });
    const input = document.querySelector('.mobile-library-screen input[type=file]');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitForExpression(client, `document.querySelector('.mobile-view-layer:not([hidden]) .mobile-reader-header strong')?.textContent.includes('safe-policy-optimization') ? 'active-fallback-reader' : ''`, 20000);
  await waitForSelector(client, '.mobile-view-layer:not([hidden]) .mobile-bilingual-block');
  await evaluate(client, `document.querySelectorAll('.mobile-view-layer:not([hidden]) .mobile-reader-mode-bar button')[1].click()`);
  await waitForSelector(client, '.mobile-view-layer:not([hidden]) .mobile-pdf-reader');
  await waitForSelector(client, '.mobile-view-layer:not([hidden]) .mobile-pdf-reader .pdfViewer .page canvas', 20000);
  await wait(350);
  const zoomChange = await evaluate(client, `(() => {
    const toolbar = document.querySelector('.mobile-pdf-toolbar');
    const before = toolbar?.querySelector('span')?.textContent ?? '';
    toolbar?.querySelector('button[aria-label="放大 PDF"]')?.click();
    return { before, hint: toolbar?.querySelector('em')?.textContent ?? '' };
  })()`);
  await wait(250);
  const zoomAfter = await evaluate(client, `document.querySelector('.mobile-pdf-toolbar span')?.textContent ?? ''`);
  if (!zoomChange.before || zoomChange.before === zoomAfter || !zoomChange.hint.includes('双指缩放')) {
    throw new Error(`Mobile PDF zoom controls did not change the scale: ${JSON.stringify({ ...zoomChange, zoomAfter })}`);
  }
  const pdfContainerLayout = await evaluate(client, `(() => {
    const shell = document.querySelector('.mobile-pdf-reader .pdf-viewer-shell');
    const container = document.querySelector('.mobile-pdf-reader .pdf-js-viewer-container');
    return {
      shellPosition: shell ? getComputedStyle(shell).position : '',
      containerPosition: container ? getComputedStyle(container).position : '',
      touchZoomEnabled: container?.classList.contains('is-touch-zoom-enabled') ?? false,
      touchAction: container ? getComputedStyle(container).touchAction : '',
      containerInset: container ? [
        getComputedStyle(container).top,
        getComputedStyle(container).right,
        getComputedStyle(container).bottom,
        getComputedStyle(container).left
      ] : []
    };
  })()`);
  if (
    pdfContainerLayout.shellPosition !== 'relative' ||
    pdfContainerLayout.containerPosition !== 'absolute' ||
    !pdfContainerLayout.touchZoomEnabled ||
    pdfContainerLayout.touchAction !== 'pan-x pan-y' ||
    pdfContainerLayout.containerInset.some(value => value !== '0px')
  ) {
    throw new Error(`Mobile PDF.js container is not safely positioned: ${JSON.stringify(pdfContainerLayout)}`);
  }
  await capture(client, '03a-reader-original-pdf-390x844.png');
  await evaluate(client, `document.querySelectorAll('.mobile-reader-mode-bar button')[0].click()`);
  await waitForSelector(client, '.mobile-bilingual-reader');
  console.log('Imported fallback PDF and opened reader.');

  await waitForSelector(client, '.mobile-bilingual-intro button', 20000);
  await evaluate(client, `document.querySelector('.mobile-bilingual-intro button').click()`);
  const translationStartState = await waitForExpression(
    client,
    `document.querySelector('.mobile-translation-dialog')
      ? 'settings'
      : (document.querySelector('.mobile-block-translation') ? 'translated' : '')`,
    20000
  );
  if (translationStartState === 'settings') {
    await evaluate(client, `(() => {
      const values = ['http://127.0.0.1:${mockPort}/v1', 'visual-model', 'visual-key'];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      document.querySelectorAll('.mobile-translation-dialog input').forEach((input, index) => {
        setter.call(input, values[index]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      document.querySelector('.mobile-dialog-primary').click();
      return true;
    })()`);
  }
  await waitForSelector(client, '.mobile-block-translation');
  await wait(400);
  const inlineTranslationLayout = await evaluate(client, `(() => {
    const block = document.querySelector('.mobile-bilingual-block');
    const original = block?.querySelector('.mobile-block-original');
    const translation = block?.querySelector('.mobile-block-translation');
    return {
      modeCount: document.querySelectorAll('.mobile-reader-mode-bar button').length,
      originalBottom: original?.getBoundingClientRect().bottom ?? 0,
      translationTop: translation?.getBoundingClientRect().top ?? 0,
      toolbar: document.querySelector('.mobile-bilingual-toolbar')?.textContent ?? ''
    };
  })()`);
  if (
    inlineTranslationLayout.modeCount !== 2 ||
    inlineTranslationLayout.translationTop < inlineTranslationLayout.originalBottom ||
    !inlineTranslationLayout.toolbar.includes('段已译')
  ) {
    throw new Error(`Inline continuous bilingual layout is invalid: ${JSON.stringify(inlineTranslationLayout)}`);
  }
  await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  });
  await wait(120);
  await capture(client, '03-reader-inline-translation-390x844.png');
  console.log('Captured inline paragraph translation.');

  await evaluate(client, `document.querySelector('.mobile-reader-more').click()`);
  await waitForSelector(client, '.mobile-translation-dialog');
  await evaluate(client, `(() => {
    const modelInput = document.querySelectorAll('.mobile-translation-dialog input')[1];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(modelInput, 'visual-model-v2');
    modelInput.dispatchEvent(new Event('input', { bubbles: true }));
    modelInput.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.mobile-dialog-primary').click();
    return true;
  })()`);
  await wait(350);
  const staleTranslationState = await evaluate(client, `(() => ({
    paragraphActionCount: document.querySelectorAll('.mobile-block-original button').length,
    toolbar: document.querySelector('.mobile-bilingual-toolbar span')?.textContent ?? ''
  }))()`);
  if (staleTranslationState.paragraphActionCount !== 0 || !staleTranslationState.toolbar.includes('待更新')) {
    throw new Error(`Mobile stale translation state was not exposed: ${JSON.stringify(staleTranslationState)}`);
  }
  await capture(client, '03b-reader-stale-translation-390x844.png');
  console.log('Captured stale translation state after changing the model.');

  await evaluate(client, `(() => {
    const paragraph = document.querySelector('.mobile-block-original p, .mobile-block-original h2');
    const node = paragraph.firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(18, node.textContent.length));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return true;
  })()`);
  await waitForSelector(client, '.mobile-selection-popover');
  await capture(client, '04-reader-selection-popover-390x844.png');

  const audit = await evaluate(client, `(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    bodyScrollWidth: document.body.scrollWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
    clipped: Array.from(document.querySelectorAll('.mobile-app *')).filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
    }).slice(0, 12).map(element => ({ className: element.className, rect: element.getBoundingClientRect().toJSON() }))
  }))()`);
  await writeFile(path.join(outputDir, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  if (audit.bodyScrollWidth > audit.viewport.width + 1 || audit.rootScrollWidth > audit.viewport.width + 1) {
    throw new Error(`Mobile layout has horizontal overflow: ${JSON.stringify(audit)}`);
  }

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 430,
    height: 932,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 430,
    screenHeight: 932
  });
  await capture(client, '05-reader-selection-popover-430x932.png');

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844
  });
  await evaluate(client, `(() => {
    window.getSelection()?.removeAllRanges();
    document.querySelector('.mobile-reader-back').click();
    return true;
  })()`);
  await waitForSelector(client, '.mobile-library-screen');
  await evaluate(client, `(() => {
    const row = Array.from(document.querySelectorAll('.mobile-paper-row'))
      .find(candidate => candidate.textContent.includes('safe-policy-optimization'));
    row.querySelector('.mobile-paper-manage').click();
    return true;
  })()`);
  await waitForSelector(client, '.mobile-paper-editor-dialog');
  const editorActionState = await evaluate(client, `(() => ({
    saveDisabled: document.querySelector('.mobile-paper-editor-dialog .mobile-dialog-primary').disabled,
    deleteDisabled: document.querySelector('.mobile-paper-editor-delete').disabled,
    saveBackground: getComputedStyle(document.querySelector('.mobile-paper-editor-dialog .mobile-dialog-primary')).backgroundColor
  }))()`);
  if (editorActionState.saveDisabled || editorActionState.deleteDisabled || editorActionState.saveBackground !== 'rgb(24, 33, 54)') {
    throw new Error(`Mobile paper editor actions unexpectedly disabled: ${JSON.stringify(editorActionState)}`);
  }
  await capture(client, '06a-library-paper-editor-390x844.png');
  await evaluate(client, `(() => {
    const [titleInput, tagsInput] = document.querySelectorAll('.mobile-paper-editor-dialog input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(titleInput, '安全策略优化论文');
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(tagsInput, '强化学习，CBF，待读');
    tagsInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.mobile-paper-editor-dialog .mobile-dialog-primary').click();
    return true;
  })()`);
  await waitForSelectorToDisappear(client, '.mobile-paper-editor-dialog');
  await waitForSelector(client, '.mobile-paper-tags');
  const managedPaperState = await evaluate(client, `(() => ({
    title: document.querySelector('.mobile-paper-row strong')?.textContent ?? '',
    tags: Array.from(document.querySelectorAll('.mobile-paper-row .mobile-paper-tags i')).map(tag => tag.textContent)
  }))()`);
  if (managedPaperState.title !== '安全策略优化论文' || managedPaperState.tags.join(',') !== '强化学习,CBF,待读') {
    throw new Error(`Mobile paper metadata editor failed: ${JSON.stringify(managedPaperState)}`);
  }
  await capture(client, '06-library-paper-managed-390x844.png');
  console.log('Renamed a paper and saved searchable local tags.');

  await evaluate(client, `(() => {
    window.confirm = () => true;
    document.querySelector('.mobile-paper-row .mobile-paper-manage').click();
    return true;
  })()`);
  await waitForSelector(client, '.mobile-paper-editor-dialog');
  await evaluate(client, `document.querySelector('.mobile-paper-editor-delete').click()`);
  await waitForSelectorToDisappear(client, '.mobile-paper-editor-dialog');
  const deletionState = await evaluate(client, `(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('pdfTranslationReader:mobilePdfFiles:v1', 1);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('pdfFiles', 'readonly');
      const keysRequest = transaction.objectStore('pdfFiles').getAllKeys();
      keysRequest.onsuccess = () => resolve({
        paperVisible: document.body.textContent.includes('安全策略优化论文'),
        storedKeys: keysRequest.result.map(String)
      });
      keysRequest.onerror = () => reject(keysRequest.error);
    };
    request.onerror = () => reject(request.error);
  }))()`);
  if (deletionState.paperVisible || deletionState.storedKeys.some(key => key.includes('safe-policy-optimization'))) {
    throw new Error(`Mobile paper deletion left visible or stored data: ${JSON.stringify(deletionState)}`);
  }
  await capture(client, '07-library-paper-deleted-390x844.png');
  console.log('Deleted the paper without an IndexedDB cursor transaction failure.');

  const translationRequestsBeforeScannedOcr = translationMockState.textRequestCount;
  const scannedPdfBase64 = createScannedFallbackPdfBuffer().toString('base64');
  await evaluate(client, `(() => {
    const binary = atob(${JSON.stringify(scannedPdfBase64)});
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const file = new File([bytes], 'scanned-safety-paper.pdf', { type: 'application/pdf', lastModified: 2 });
    const input = document.querySelector('.mobile-library-screen input[type=file]');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitForSelector(client, '.mobile-reader-screen', 20000);
  await waitForExpression(client, `document.querySelectorAll('.mobile-bilingual-block').length >= 2 ? 'page-one' : ''`, 20000);
  const pageOneOcrOnlyState = await evaluate(client, `(() => ({
    blockCount: document.querySelectorAll('.mobile-bilingual-block').length,
    translationCount: document.querySelectorAll('.mobile-block-translation').length,
    toolbar: document.querySelector('.mobile-bilingual-toolbar')?.textContent ?? ''
  }))()`);
  if (pageOneOcrOnlyState.translationCount !== 0 || translationMockState.textRequestCount !== translationRequestsBeforeScannedOcr) {
    throw new Error(`Import OCR triggered translation before user confirmation: ${JSON.stringify({ pageOneOcrOnlyState, translationMockState, translationRequestsBeforeScannedOcr })}`);
  }
  await capture(client, '08a-reader-scanned-ocr-running-390x844.png');
  await evaluate(client, `document.querySelectorAll('.mobile-reader-mode-bar button')[1].click()`);
  await waitForSelector(client, '.mobile-pdf-reader');
  await evaluate(client, `document.querySelectorAll('.mobile-reader-mode-bar button')[0].click()`);
  await waitForExpression(client, `document.body.textContent.includes('Vision Safety Policy Page 1') ? 'page-one-preserved-after-mode-switch' : ''`);
  await evaluate(client, `document.querySelector('.mobile-reader-back').click()`);
  await waitForSelector(client, '.mobile-library-screen');
  await evaluate(client, `document.querySelectorAll('.mobile-bottom-nav button')[2].click()`);
  await waitForSelector(client, '.mobile-reader-screen');
  await waitForExpression(client, `document.body.textContent.includes('Vision Safety Policy Page 1') ? 'page-one-preserved-after-reader-exit' : ''`);
  await waitForExpression(client, `document.querySelectorAll('.mobile-bilingual-block').length === 6 ? 'all-pages' : ''`, 20000);
  await waitForSelector(client, '.mobile-bilingual-intro', 20000);
  const completedOcrOnlyState = await evaluate(client, `(() => ({
    originals: Array.from(document.querySelectorAll('.mobile-block-original p, .mobile-block-original h2')).map(node => node.textContent),
    translationCount: document.querySelectorAll('.mobile-block-translation').length,
    toolbar: document.querySelector('.mobile-bilingual-toolbar')?.textContent ?? '',
    intro: document.querySelector('.mobile-bilingual-intro')?.textContent ?? ''
  }))()`);
  if (
    completedOcrOnlyState.translationCount !== 0 ||
    translationMockState.textRequestCount !== translationRequestsBeforeScannedOcr ||
    completedOcrOnlyState.originals.some(original => ['EE', '4', 'age manipulation of'].includes(original.trim())) ||
    !completedOcrOnlyState.intro.includes('点击“翻译全文”后才生成中文')
  ) {
    throw new Error(`Completed import OCR was not clean and translation-free: ${JSON.stringify({ completedOcrOnlyState, translationMockState, translationRequestsBeforeScannedOcr })}`);
  }
  await capture(client, '08b-reader-scanned-ocr-only-390x844.png');
  await evaluate(client, `document.querySelector('.mobile-bilingual-toolbar button').click()`);
  await waitForExpression(client, `document.querySelectorAll('.mobile-block-translation').length === 6 ? 'all-pages-translated' : ''`, 20000);
  await waitForExpression(client, `document.querySelector('.mobile-reader-status')?.textContent.includes('全文翻译完成') ? 'translation-finished' : ''`, 20000);
  if (translationMockState.textRequestCount - translationRequestsBeforeScannedOcr < 3) {
    throw new Error(`Full translation did not start after the explicit user click: ${JSON.stringify({ translationMockState, translationRequestsBeforeScannedOcr })}`);
  }
  await capture(client, '08b-reader-scanned-bilingual-390x844.png');
  const novelReadingTypography = await evaluate(client, `(() => {
    const original = document.querySelector('.mobile-bilingual-block.is-paragraph .mobile-block-original p');
    const translation = document.querySelector('.mobile-bilingual-block.is-paragraph .mobile-block-translation p');
    const translationBox = document.querySelector('.mobile-bilingual-block.is-paragraph .mobile-block-translation');
    const block = document.querySelector('.mobile-bilingual-block.is-paragraph');
    const pageBreak = document.querySelector('.mobile-bilingual-page-break');
    return {
      originalFontSize: Number.parseFloat(getComputedStyle(original).fontSize),
      originalTextAlign: getComputedStyle(original).textAlign,
      translationFontSize: Number.parseFloat(getComputedStyle(translation).fontSize),
      translationTextAlign: getComputedStyle(translation).textAlign,
      translationBorderLeft: getComputedStyle(translationBox).borderLeftWidth,
      blockBorderBottom: getComputedStyle(block).borderBottomWidth,
      pageBreakDisplay: getComputedStyle(pageBreak).display,
      translationLabelCount: document.querySelectorAll('.mobile-block-translation > span').length,
      paragraphActionCount: document.querySelectorAll('.mobile-bilingual-block.is-paragraph .mobile-block-original > button').length
    };
  })()`);
  if (
    novelReadingTypography.originalFontSize < 16.5 ||
    novelReadingTypography.originalFontSize > 20 ||
    novelReadingTypography.translationFontSize < 16.5 ||
    novelReadingTypography.translationFontSize > 20 ||
    novelReadingTypography.originalTextAlign === 'justify' ||
    novelReadingTypography.translationTextAlign === 'justify' ||
    novelReadingTypography.translationBorderLeft !== '0px' ||
    novelReadingTypography.blockBorderBottom !== '0px' ||
    novelReadingTypography.pageBreakDisplay !== 'none' ||
    novelReadingTypography.translationLabelCount !== 0 ||
    novelReadingTypography.paragraphActionCount !== 0
  ) {
    throw new Error(`Novel-style bilingual typography is invalid: ${JSON.stringify(novelReadingTypography)}`);
  }
  await evaluate(client, `(() => {
    const page = document.querySelector('.mobile-bilingual-page');
    page.scrollTop = 320;
    page.dispatchEvent(new Event('scroll', { bubbles: true }));
    return page.scrollTop;
  })()`);
  await waitForExpression(client, `document.querySelector('.mobile-reader-screen')?.classList.contains('is-reading-immersive') ? 'immersive' : ''`);
  const immersiveChrome = await evaluate(client, `(() => ({
    header: getComputedStyle(document.querySelector('.mobile-reader-header')).display,
    modes: getComputedStyle(document.querySelector('.mobile-reader-mode-bar')).display,
    toolbar: getComputedStyle(document.querySelector('.mobile-bilingual-toolbar')).display,
    status: getComputedStyle(document.querySelector('.mobile-reader-status')).display
  }))()`);
  if (Object.values(immersiveChrome).some(display => display !== 'none')) {
    throw new Error(`Reader chrome did not collapse during immersive scrolling: ${JSON.stringify(immersiveChrome)}`);
  }
  await capture(client, '08c-reader-scanned-immersive-390x844.png');
  await evaluate(client, `(() => {
    const page = document.querySelector('.mobile-bilingual-page');
    page.scrollTop = 0;
    page.dispatchEvent(new Event('scroll', { bubbles: true }));
    return page.scrollTop;
  })()`);
  await waitForExpression(client, `document.querySelector('.mobile-reader-screen')?.classList.contains('is-reading-immersive') ? '' : 'restored'`);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 430,
    height: 932,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 430,
    screenHeight: 932
  });
  await evaluate(client, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.body.offsetHeight))))`);
  await wait(200);
  const novelReaderWidthAudit = await evaluate(client, `(() => ({
    viewportWidth: innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rootScrollWidth: document.documentElement.scrollWidth
  }))()`);
  if (
    novelReaderWidthAudit.bodyScrollWidth > novelReaderWidthAudit.viewportWidth + 1 ||
    novelReaderWidthAudit.rootScrollWidth > novelReaderWidthAudit.viewportWidth + 1
  ) {
    throw new Error(`Novel-style reader overflows at 430px: ${JSON.stringify(novelReaderWidthAudit)}`);
  }
  await capture(client, '08d-reader-scanned-novel-430x932.png');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844
  });
  console.log('Started full local OCR immediately after PDF import without sending a translation request.');
  console.log('Preserved earlier OCR pages across PDF mode switching and a reader exit, then translated only after the explicit Full translation click.');
  console.log('Verified compact novel-style paragraph typography and reversible immersive scrolling without inline action chrome.');
  await evaluate(client, `document.querySelector('.mobile-reader-back').click()`);
  await waitForSelector(client, '.mobile-library-screen');
  await evaluate(client, `(() => {
    const row = Array.from(document.querySelectorAll('.mobile-paper-row'))
      .find(candidate => candidate.textContent.includes('scanned-safety-paper'));
    row?.querySelector('.mobile-paper-main')?.click();
    return Boolean(row);
  })()`);
  await waitForExpression(client, `document.querySelectorAll('.mobile-bilingual-block').length === 6 ? 'ready' : ''`, 20000);
  await client.send('Page.reload', { ignoreCache: true });
  await waitForSelector(client, '.mobile-library-screen', 20000);
  await waitForExpression(client, `Array.from(document.querySelectorAll('.mobile-paper-row')).some(candidate => candidate.textContent.includes('scanned-safety-paper')) ? 'scanned-paper-loaded' : ''`, 20000);
  await evaluate(client, `(() => {
    const row = Array.from(document.querySelectorAll('.mobile-paper-row'))
      .find(candidate => candidate.textContent.includes('scanned-safety-paper'));
    row?.querySelector('.mobile-paper-main')?.click();
    return Boolean(row);
  })()`);
  await waitForExpression(client, `document.querySelector('.mobile-view-layer:not([hidden]) .mobile-reader-screen') ? 'reader-reloaded' : ''`, 20000);
  await wait(2000);
  const reloadedCacheState = await evaluate(client, `(() => ({
    blockCount: document.querySelectorAll('.mobile-bilingual-block').length,
    translationCount: document.querySelectorAll('.mobile-block-translation').length,
    status: document.querySelector('.mobile-reader-status')?.textContent ?? '',
    ocrPromptVisible: Boolean(document.querySelector('.mobile-ocr-empty')),
    title: document.querySelector('.mobile-reader-header strong')?.textContent ?? ''
  }))()`);
  if (reloadedCacheState.blockCount !== 6 || reloadedCacheState.translationCount !== 6) {
    throw new Error(`Reloaded OCR cache is incomplete: ${JSON.stringify(reloadedCacheState)}`);
  }
  await evaluate(client, `document.querySelector('.mobile-reader-more').click()`);
  await waitForSelector(client, '.mobile-translation-dialog');
  const cachedTranslationSettings = await evaluate(client, `(() => {
    const inputs = Array.from(document.querySelectorAll('.mobile-translation-dialog input'));
    return { baseURL: inputs[0]?.value ?? '', model: inputs[1]?.value ?? '', apiKey: inputs[2]?.value ?? '' };
  })()`);
  if (cachedTranslationSettings.apiKey !== 'visual-key') {
    throw new Error(`Reloaded API key was not restored from local preferences: ${JSON.stringify(cachedTranslationSettings)}`);
  }
  await evaluate(client, `document.querySelector('.mobile-translation-dialog header button').click()`);
  const restoredVisionState = await evaluate(client, `(() => ({
    originals: Array.from(document.querySelectorAll('.mobile-block-original p, .mobile-block-original h2')).map(node => node.textContent),
    translations: Array.from(document.querySelectorAll('.mobile-block-translation p')).map(node => node.textContent),
    ocrPromptVisible: Boolean(document.querySelector('.mobile-ocr-empty'))
  }))()`);
  if (
    restoredVisionState.originals.length !== 6 ||
    restoredVisionState.translations.length !== 6 ||
    !restoredVisionState.originals.some(original => original.includes('Page 1')) ||
    !restoredVisionState.originals.some(original => original.includes('Page 3')) ||
    restoredVisionState.originals.some(original => ['EE', '4', 'age manipulation of'].includes(original.trim())) ||
    restoredVisionState.ocrPromptVisible ||
    translationMockState.imageRequestCount !== 0 ||
    translationMockState.textRequestCount < translationRequestsBeforeScannedOcr + 3
  ) {
    throw new Error(`Scanned PDF local OCR / DeepSeek text flow failed: ${JSON.stringify({ restoredVisionState, translationMockState })}`);
  }
  console.log('Reloaded the web app and restored the imported PDF, all six bilingual blocks, and the locally cached API key.');
  console.log('Rejected one-word OCR layout fragments, page numbers, and cropped lowercase fragments while restoring two coherent paragraphs per page.');
  console.log(`Mobile visual check passed. Screenshots: ${outputDir}`);
} finally {
  client?.close();
  processHandle.kill();
  await new Promise((resolve) => mockServer.close(resolve));
}

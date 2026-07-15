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
      const translation = source.length < 40
        ? '前向不变性'
        : '策略更新在有界扰动下保持前向不变性，从而使安全约束在执行过程中持续成立。';
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
  await waitForSelector(client, '.mobile-reader-screen');
  await waitForSelector(client, '.mobile-bilingual-block');
  console.log('Imported fallback PDF and opened reader.');

  await evaluate(client, `document.querySelector('.mobile-reader-more').click()`);
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
  await wait(300);
  await evaluate(client, `document.querySelector('.mobile-block-original button').click()`);
  await waitForSelector(client, '.mobile-block-translation');
  await wait(400);
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
    button: document.querySelector('.mobile-block-original button')?.textContent ?? '',
    toolbar: document.querySelector('.mobile-bilingual-toolbar span')?.textContent ?? ''
  }))()`);
  if (!staleTranslationState.button.includes('当前配置重译') || !staleTranslationState.toolbar.includes('待更新')) {
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
  console.log(`Mobile visual check passed. Screenshots: ${outputDir}`);
} finally {
  client?.close();
  processHandle.kill();
  await new Promise((resolve) => mockServer.close(resolve));
}

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
  path.join('D:\\', 'GPT\u6d4f\u89c8\u5668\u4e0b\u8f7d', '2604.15483v2.pdf');
const outputDir = path.join(root, '.tmp-visual-check');
const visualUserDataDir = path.join(outputDir, 'user-data');
const port = Number(process.env.VISUAL_CHECK_PORT ?? 9333);

const scenarios = [
  {
    name: 'intro-body-match',
    section: 'I. INTRODUCTION',
    original: [
      'Foundation models work on the principle that generalist capabilities emerge from training on large and diverse datasets.',
      'For example, large language models can not only recall facts and semantic knowledge, but they can also compose that knowledge in new ways, solving problems that require unlikely connections, applying user-defined formats (e.g., JSON), and performing chain-of-thought reasoning.',
      'This kind of compositional generalization is arguably the cornerstone of generalist capabilities, but it has proven elusive in the domain of physical intelligence.'
    ].join(' '),
    expectUnderlines: 'positive'
  },
  {
    name: 'intro-full-paragraph-match',
    section: 'I. INTRODUCTION',
    original: [
      'Foundation models work on the principle that generalist capabilities emerge from training on large and diverse datasets.',
      'For example, large language models can not only recall facts and semantic knowledge, but they can also compose that knowledge in new ways, solving problems that require unlikely connections, applying user-defined formats (e.g., JSON), and performing chain-of-thought reasoning.',
      'This kind of compositional generalization is arguably the cornerstone of generalist capabilities, but it has proven elusive in the domain of physical intelligence.',
      'While robotic foundation models such as vision-language-action models (VLAs) have advanced significantly in size and capability, their ability to generalize to new tasks or recombine skills in new ways has so far been limited.',
      'Unlike language models, which can compose different capabilities from their training data to solve new problems, prior VLAs not only lack the ability to solve new tasks, but often struggle to fluently perform all of the instructions they were trained on without task-specific fine-tuning.'
    ].join(' '),
    expectUnderlines: 'positive',
    minOverlayLines: 14
  },
  {
    name: 'title-high-confidence',
    section: 'Title',
    original: '\u03c00.7: a Steerable Generalist Robotic Foundation Model with Emergent Capabilities',
    expectUnderlines: 'positive',
    expectStatus: 'full'
  }
];

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
      if (payload.error) {
        reject(new Error(payload.error.message));
      } else {
        resolve(payload.result);
      }
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

async function waitForButtonBox(client, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = await evaluateJson(client, `() => {
      const button = [...document.querySelectorAll('button')]
        .find((entry) => entry.textContent.includes(${JSON.stringify(label)}));
      if (!button) {
        return { found: false };
      }
      const rect = button.getBoundingClientRect();
      return { found: true, x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }`);

    if (snapshot.found) {
      return snapshot;
    }
    await wait(250);
  }

  throw new Error(`Button not found: ${label}`);
}

async function waitForButtonEnabled(client, label) {
  let snapshot = null;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    snapshot = await evaluateJson(client, `() => {
      const button = [...document.querySelectorAll('button')]
        .find((entry) => entry.textContent.includes(${JSON.stringify(label)}));
      if (!button) {
        return { found: false, enabled: false };
      }
      return { found: true, enabled: !button.disabled, text: button.textContent };
    }`);

    if (snapshot.found && snapshot.enabled) {
      return snapshot;
    }
    await wait(500);
  }

  throw new Error(`Button not enabled: ${label}; last=${JSON.stringify(snapshot)}`);
}

async function clickButton(client, label) {
  await waitForButtonBox(client, label);
  await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        const button = [...document.querySelectorAll('button')]
          .find((entry) => entry.textContent.includes(${JSON.stringify(label)}));
        button?.click();
      })()
    `,
    returnByValue: true
  });
}

async function waitForReaderSettled(client) {
  let snapshot = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    snapshot = await evaluateJson(client, `() => ({
      hasReader: Boolean(document.querySelector('.split-layout')),
      rendering: [...document.querySelectorAll('.subtle')].some((node) => node.textContent.includes('\u6b63\u5728\u6e32\u67d3')),
      status: document.querySelector('.status-bar')?.textContent ?? ''
    })`);

    if (snapshot.hasReader && !snapshot.rendering && !snapshot.status.includes('\u6587\u672c\u5c42\u4ecd\u5728\u6e32\u67d3')) {
      return snapshot;
    }
    await wait(500);
  }

  throw new Error(`Reader did not settle: ${JSON.stringify(snapshot)}`);
}

async function getHighlightSnapshot(client) {
  return evaluateJson(client, `() => ({
    officialHighlights: document.querySelectorAll('.pdf-viewer-shell .textLayer .highlight').length,
    overlayLines: document.querySelectorAll('.pdf-highlight-overlay-line').length,
    legacyUnderlines: document.querySelectorAll('.pdf-highlight-underline').length,
    redTextMatches: document.querySelectorAll('.pdf-highlight-match').length,
    status: document.querySelector('.status-bar')?.textContent ?? '',
    overlayDetail: [...document.querySelectorAll('.pdf-highlight-overlay-line')].map((node) => {
      const rect = node.getBoundingClientRect();
      const page = node.closest('.page')?.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        width: rect.width,
        height: rect.height,
        backgroundColor: style.backgroundColor,
        outOfPage: page ? rect.left < page.left || rect.right > page.right || rect.top < page.top || rect.bottom > page.bottom : true,
        outOfViewport: rect.right < 0 || rect.left > window.innerWidth || rect.bottom < 0 || rect.top > window.innerHeight
      };
    })
  })`);
}

async function waitForHighlightSnapshot(client, scenario) {
  let snapshot = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    snapshot = await getHighlightSnapshot(client);

    if (snapshot.legacyUnderlines > 0) {
      return snapshot;
    }

    const hasEnoughOverlayLines =
      snapshot.overlayLines >= (scenario.minOverlayLines ?? (scenario.expectUnderlines === 'positive' ? 1 : 0));

    if (
      scenario.expectUnderlines !== 'positive' ||
      (snapshot.officialHighlights > 0 && hasEnoughOverlayLines)
    ) {
      return snapshot;
    }

    await wait(250);
  }

  return snapshot;
}

async function runScenario(scenario) {
  const translationPath = path.join(outputDir, `${scenario.name}.json`);
  const outputPath = path.join(outputDir, `${scenario.name}.png`);
  await writeFile(
    translationPath,
    `${JSON.stringify([{ section: scenario.section, original: scenario.original, translation: '' }], null, 2)}\n`,
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
    await loadPaperRecord(client, translationPath, `${scenario.name}.json`);
    await clickButton(client, '\u6253\u5f00\u9605\u8bfb');
    await waitForReaderSettled(client);

    const snapshot = await waitForHighlightSnapshot(client, scenario);
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
    validateHighlightScenario(scenario, snapshot);

    client.close();
    return {
      name: scenario.name,
      screenshot: outputPath,
      officialHighlights: snapshot.officialHighlights,
      overlayLines: snapshot.overlayLines,
      status: snapshot.status
    };
  } finally {
    appProcess.kill();
    await wait(500);
  }
}

async function runAiQueueScenario() {
  const scenarioName = 'ai-queue';
  const translationPath = path.join(outputDir, `${scenarioName}.json`);
  const outputPath = path.join(outputDir, `${scenarioName}.png`);
  await writeFile(translationPath, '[]\n', 'utf8');

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
    await loadPaperRecord(client, translationPath, `${scenarioName}.json`);
    await clickButton(client, '\u6253\u5f00\u9605\u8bfb');
    await waitForReaderSettled(client);
    await clickButton(client, 'AI \u6a21\u5f0f');
    await waitForButtonEnabled(client, '\u751f\u6210/\u5237\u65b0 JSON \u7f13\u5b58');
    await clickButton(client, '\u751f\u6210/\u5237\u65b0 JSON \u7f13\u5b58');
    await wait(1000);

    const snapshot = await evaluateJson(client, `() => ({
      rows: [...document.querySelectorAll('.ai-item-row')].map((row) => row.textContent ?? ''),
      summary: document.querySelector('.ai-summary')?.textContent ?? '',
      summaryStats: [...document.querySelectorAll('.ai-summary-stat')].map((node) => node.textContent ?? ''),
      settingsText: document.querySelector('.ai-settings-card')?.textContent ?? '',
      listHasOwnScrollbar: (() => {
        const list = document.querySelector('.ai-item-list');
        return list ? list.scrollHeight > list.clientHeight : false;
      })(),
      officialHighlights: document.querySelectorAll('.pdf-viewer-shell .textLayer .highlight').length,
      overlayLines: document.querySelectorAll('.pdf-highlight-overlay-line').length,
      legacyUnderlines: document.querySelectorAll('.pdf-highlight-underline').length,
      redTextMatches: document.querySelectorAll('.pdf-highlight-match').length,
      status: document.querySelector('.status-bar')?.textContent ?? ''
    })`);
    validateAiQueueScenario(snapshot);

    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
    client.close();
    return { name: scenarioName, screenshot: outputPath, rowCount: snapshot.rows.length, summary: snapshot.summary };
  } finally {
    appProcess.kill();
    await wait(500);
  }
}

async function runAiTranslatedDetailScenario() {
  const scenarioName = 'ai-translated-detail';
  const translationPath = path.join(outputDir, `${scenarioName}.json`);
  const outputPath = path.join(outputDir, `${scenarioName}.png`);
  const translatedText = '基础模型来自大规模且多样化的数据集。';
  await writeFile(
    translationPath,
    `${JSON.stringify(
      [
        {
          section: 'Abstract',
          original: 'Foundation models emerge from large and diverse datasets.',
          translation: translatedText,
          translatedAt: '2026-05-27T08:00:00.000Z',
          provider: 'kimi',
          model: 'kimi-k2.6'
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
    await loadPaperRecord(client, translationPath, `${scenarioName}.json`);
    await clickButton(client, '\u6253\u5f00\u9605\u8bfb');
    await waitForReaderSettled(client);
    await clickButton(client, 'AI \u6a21\u5f0f');
    await wait(600);

    const snapshot = await evaluateJson(client, `() => ({
      detailText: document.querySelector('.ai-current-detail')?.textContent ?? '',
      translationText: [...document.querySelectorAll('.ai-current-block.translated p')]
        .map((node) => node.textContent ?? '')
        .join('\\n')
    })`);
    if (!snapshot.translationText.includes(translatedText)) {
      throw new Error(`ai-translated-detail: expected AI translation detail, got ${JSON.stringify(snapshot)}`);
    }
    if (!snapshot.detailText.includes('kimi-k2.6')) {
      throw new Error(`ai-translated-detail: expected model metadata in detail, got ${snapshot.detailText}`);
    }

    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
    client.close();
    return { name: scenarioName, screenshot: outputPath, detailText: snapshot.detailText };
  } finally {
    appProcess.kill();
    await wait(500);
  }
}

async function loadPaperRecord(client, translationPath, translationName) {
  const paper = {
    id: `visual-check-${Date.now()}`,
    pdfPath,
    pdfName: path.basename(pdfPath),
    translationPath,
    translationName,
    chineseTitle: 'visual check',
    englishTitle: 'Visual Check',
    journal: '',
    authors: '',
    year: '',
    lastOpenedAt: new Date().toISOString(),
    lastPage: 1
  };

  await client.send('Runtime.evaluate', {
    expression: `
      localStorage.setItem('pdfTranslationReader:paperLibrary', ${JSON.stringify(JSON.stringify([paper]))});
      location.reload();
    `
  });
  await wait(1500);
}

function validateHighlightScenario(scenario, snapshot) {
  if (snapshot.redTextMatches !== 0) {
    throw new Error(`${scenario.name}: expected no red text overlay, got ${snapshot.redTextMatches}`);
  }

  if (snapshot.legacyUnderlines !== 0) {
    throw new Error(`${scenario.name}: expected no legacy custom underlines, got ${snapshot.legacyUnderlines}`);
  }

  if (snapshot.overlayDetail.some((line) => line.outOfPage)) {
    throw new Error(`${scenario.name}: overlay highlight escaped page bounds`);
  }

  if (snapshot.overlayDetail.some((line) => line.height > 1.5)) {
    throw new Error(`${scenario.name}: overlay highlight line should be 1px`);
  }

  if (scenario.expectUnderlines === 0 && snapshot.officialHighlights !== 0) {
    throw new Error(`${scenario.name}: expected zero official highlights, got ${snapshot.officialHighlights}`);
  }

  if (scenario.expectUnderlines === 'positive' && snapshot.officialHighlights <= 0) {
    throw new Error(
      `${scenario.name}: expected visible PDF.js highlights; snapshot=${JSON.stringify(snapshot)}`
    );
  }

  if (scenario.expectUnderlines === 'positive' && snapshot.overlayLines <= 0) {
    throw new Error(`${scenario.name}: expected visible merged overlay lines`);
  }

  if (
    scenario.name === 'title-high-confidence' &&
    snapshot.overlayLines >= snapshot.officialHighlights
  ) {
    throw new Error(
      `${scenario.name}: expected merged overlay lines, got ${snapshot.overlayLines} overlay lines for ${snapshot.officialHighlights} PDF.js spans`
    );
  }

  if (scenario.minOverlayLines && snapshot.overlayLines < scenario.minOverlayLines) {
    throw new Error(
      `${scenario.name}: expected at least ${scenario.minOverlayLines} merged overlay lines for a full paragraph, got ${snapshot.overlayLines}`
    );
  }

  if (
    scenario.expectUnderlines === 'positive' &&
    !snapshot.overlayDetail.some((line) => !line.outOfViewport)
  ) {
    throw new Error(`${scenario.name}: expected at least one merged overlay line inside the viewport`);
  }

  if (scenario.expectStatus === 'full' && !snapshot.status.includes('PDF.js \u5b98\u65b9\u641c\u7d22')) {
    throw new Error(`${scenario.name}: expected a full-highlight status, got "${snapshot.status}"`);
  }
}

function validateAiQueueScenario(snapshot) {
  if (snapshot.rows.length === 0) {
    throw new Error('ai-queue: expected extracted paragraph rows');
  }

  if (snapshot.summaryStats.length !== 4) {
    throw new Error(`ai-queue: expected 4 structured summary stats, got ${snapshot.summaryStats.length}`);
  }

  if (snapshot.listHasOwnScrollbar) {
    throw new Error('ai-queue: expected the right pane to own vertical scrolling, not the candidate list');
  }

  if (snapshot.settingsText.includes('API Key \u5df2\u4fdd\u5b58')) {
    throw new Error('ai-queue: visual check leaked real AI settings instead of isolated test user data');
  }

  const joinedRows = snapshot.rows.join('\n');
  const forbiddenSnippets = [
    'World Model',
    'Demonstration Data',
    'Autonomous Data',
    'Non-Robot Data',
    'Multimodal Web Data',
    'Language Instructions',
    'Subgoal Images',
    'Robot Data',
    'Episode Metadata',
    'Physical Intelligence',
    'I am a part of all that I have met',
    'Alfred, Lord Tennyson',
    'Bo Ai',
    'Ali Amin',
    'Ashwin Balakrishna'
  ];
  const leakedSnippet = forbiddenSnippets.find((snippet) => joinedRows.includes(snippet));
  if (leakedSnippet) {
    const leakedRow = snapshot.rows.find((row) => row.includes(leakedSnippet)) ?? '';
    throw new Error(`ai-queue: leaked diagram label "${leakedSnippet}" into translation queue: ${leakedRow}`);
  }

  if (/[�\u25a0\u25a1]/u.test(joinedRows)) {
    throw new Error('ai-queue: leaked unreadable glyph noise into translation queue');
  }

  if (/π\s+0\s+\.\s+7/u.test(joinedRows)) {
    throw new Error('ai-queue: leaked spaced model token "π 0 . 7" into translation queue');
  }

  const firstRow = snapshot.rows[0] ?? '';
  if (!firstRow.includes('Abstract') || !firstRow.includes('including demonstrations')) {
    throw new Error(
      `ai-queue: expected the cross-page Abstract continuation to stay in the first paragraph row: ${firstRow}`
    );
  }

  const detachedAbstractContinuation = snapshot.rows
    .slice(1)
    .find((row) => /including demonstrations, potentially suboptimal/iu.test(row));
  if (detachedAbstractContinuation) {
    throw new Error(`ai-queue: detached Abstract continuation into a separate row: ${detachedAbstractContinuation}`);
  }

  const introRow = snapshot.rows.find((row) => row.includes('I. INTRODUCTION') && row.includes('Foundation models'));
  if (!introRow || !introRow.includes('capabilities emerge from training')) {
    throw new Error(
      `ai-queue: expected first Introduction body row to contain the left-column paragraph continuation: ${snapshot.rows
        .slice(0, 5)
        .join(' | ')}`
    );
  }
  if (introRow.includes('express with language alone')) {
    throw new Error(`ai-queue: merged right-column text into first Introduction body row: ${introRow}`);
  }

  if (
    snapshot.officialHighlights !== 0 ||
    snapshot.overlayLines !== 0 ||
    snapshot.legacyUnderlines !== 0 ||
    snapshot.redTextMatches !== 0
  ) {
    throw new Error(
      `ai-queue: AI mode should not draw PDF highlights while reviewing extracted candidates, got ${snapshot.officialHighlights} official highlights, ${snapshot.overlayLines} overlay lines, ${snapshot.legacyUnderlines} legacy underlines and ${snapshot.redTextMatches} red text overlays`
    );
  }

  if (snapshot.status.includes('\u9ad8\u4eae')) {
    throw new Error(`ai-queue: AI mode leaked a highlight status message: ${snapshot.status}`);
  }
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
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }
  results.push(await runAiTranslatedDetailScenario());
  results.push(await runAiQueueScenario());
  console.log(JSON.stringify({ pdfPath, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

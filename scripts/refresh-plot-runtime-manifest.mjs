import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const projectRoot = path.resolve(import.meta.dirname, '..');
const outputPath = path.join(projectRoot, 'assets', 'plot-runtimes', 'manifest.json');
const sources = {
  python: {
    version: '3.12.10',
    fileName: 'python-3.12.10-amd64.exe',
    url: 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe',
    license: 'Python-2.0'
  },
  r: {
    version: '4.5.1',
    fileName: 'R-4.5.1-win.exe',
    url: 'https://cran.r-project.org/bin/windows/base/old/4.5.1/R-4.5.1-win.exe',
    license: 'GPL-2.0-or-later'
  }
};

const temporaryRoot = path.join(tmpdir(), `ftranslate-plot-runtime-${process.pid}`);
await mkdir(temporaryRoot, { recursive: true });

try {
  const runtimes = {};
  for (const [language, source] of Object.entries(sources)) {
    const target = path.join(temporaryRoot, source.fileName);
    const response = await fetch(source.url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`${source.url} returned HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
    const bytes = await readFile(target);
    runtimes[language] = {
      ...source,
      sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      size: bytes.byteLength
    };
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ schemaVersion: '1.0', generatedAt: new Date().toISOString(), runtimes }, null, 2)}\n`);
  console.log(`Updated ${outputPath}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

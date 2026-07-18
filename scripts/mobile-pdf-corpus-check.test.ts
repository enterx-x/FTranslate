import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  recognizePdfPagesLocally,
  type LocalOcrPageResult
} from '../src/renderer/mobile/mobileLocalOcr';
import {
  buildMobilePdfCaptionLookupKeys,
  resolveMobilePdfFigureOrder
} from '../src/renderer/mobile/mobilePdfFigures';

// Vite turns `?url` worker imports into a browser-root URL. The application
// resolves that URL correctly, while this Node-only corpus runner needs an
// explicit file URL to exercise the same PDF.js code path.
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
).href;

const corpusDirectory = process.env.FTRANSLATE_PDF_CORPUS_DIR?.trim() ?? '';
const requestedFiles = (process.env.FTRANSLATE_PDF_CORPUS_FILES ?? '')
  .split('|')
  .map((entry) => entry.trim())
  .filter(Boolean);

const corpusFiles = corpusDirectory && fs.existsSync(corpusDirectory)
  ? (requestedFiles.length > 0 ? requestedFiles : fs.readdirSync(corpusDirectory))
    .filter((fileName) => fileName.toLowerCase().endsWith('.pdf'))
    .map((fileName) => path.join(corpusDirectory, fileName))
    .filter((filePath) => fs.existsSync(filePath))
  : [];

interface CorpusPageReport {
  page: number;
  source: LocalOcrPageResult['source'];
  mode: LocalOcrPageResult['extractionMode'];
  blockCount: number;
  figureCount: number;
  structuredTableCount: number;
  captionedFigureCount: number;
  unmatchedCaptionFigureCount: number;
  maxBlockLength: number;
  shortParagraphCount: number;
  lowercaseStartCount: number;
  danglingHyphenCount: number;
  repairableDanglingHyphenCount: number;
  danglingHyphenSamples: string[];
  danglingHyphenContexts: string[];
  lowercaseStartSamples: string[];
  longestBlockSample: string;
  longestBlockText: string;
  blocks: Array<{ type: string; text: string }>;
  structuredTables: Array<{ caption: string; headers: string[]; rows: string[][] }>;
}

interface CorpusPaperReport {
  fileName: string;
  byteLength: number;
  pageCount: number;
  lastProcessedPage: number;
  totalBlocks: number;
  textPages: number;
  ocrPages: number;
  compatibilityPages: number;
  totalFigures: number;
  structuredTables: number;
  captionedFigures: number;
  unmatchedCaptionFigures: number;
  maxBlockLength: number;
  suspiciousShortParagraphs: number;
  suspiciousLowercaseStarts: number;
  danglingHyphens: number;
  repairableDanglingHyphens: number;
  pages: CorpusPageReport[];
}

const reports: CorpusPaperReport[] = [];

function summarizePage(result: LocalOcrPageResult): CorpusPageReport {
  const paragraphs = result.blocks.filter(({ block }) => block.type === 'paragraph');
  const captionOrders = new Map(result.blocks.map(({ block, order }) => [block.sourceHash, order] as const));
  const captionTextOrders = new Map(result.blocks.flatMap(({ block, order }) => (
    block.type === 'caption'
      ? buildMobilePdfCaptionLookupKeys(block.original).map((key) => [key, order] as const)
      : []
  )));
  const unmatchedCaptionFigures = result.figures.filter((region) => {
    if (!region.hasTextCaption) {
      return false;
    }
    const textOrder = buildMobilePdfCaptionLookupKeys(region.caption)
      .map((key) => captionTextOrders.get(key))
      .find((order) => order !== undefined);
    const captionOrder = captionOrders.get(region.captionHash) ?? textOrder;
    const resolvedOrder = resolveMobilePdfFigureOrder(region, captionOrders, captionTextOrders, region.caption);
    return captionOrder === undefined || Math.abs(Math.abs(resolvedOrder - captionOrder) - 0.25) > 0.001;
  });
  const longestBlock = [...result.blocks]
    .sort((left, right) => right.block.original.length - left.block.original.length)[0]?.block.original ?? '';
  const danglingIndices = result.blocks
    .map(({ block }, index) => /[A-Za-z]-$/u.test(block.original.trim()) ? index : -1)
    .filter((index) => index >= 0);
  const repairableDanglingIndices = danglingIndices.filter((index) => {
    const next = result.blocks[index + 1]?.block.original.trim() ?? '';
    const firstLetter = next.match(/\p{L}/u)?.[0] ?? '';
    return Boolean(firstLetter && firstLetter === firstLetter.toLowerCase() && firstLetter !== firstLetter.toUpperCase());
  });
  return {
    page: result.page,
    source: result.source,
    mode: result.extractionMode,
    blockCount: result.blocks.length,
    figureCount: result.figures.length,
    structuredTableCount: result.figures.filter((region) => Boolean(region.table)).length,
    captionedFigureCount: result.figures.filter((region) => region.hasTextCaption).length,
    unmatchedCaptionFigureCount: unmatchedCaptionFigures.length,
    maxBlockLength: Math.max(0, ...result.blocks.map(({ block }) => block.original.length)),
    shortParagraphCount: paragraphs.filter(({ block }) => block.original.trim().length < 24).length,
    lowercaseStartCount: paragraphs.filter(({ block }) => /^[a-z][a-z\s-]{2}/u.test(block.original.trim())).length,
    danglingHyphenCount: result.blocks.filter(({ block }) => /[A-Za-z]-$/u.test(block.original.trim())).length,
    repairableDanglingHyphenCount: repairableDanglingIndices.length,
    danglingHyphenSamples: result.blocks
      .filter(({ block }) => /[A-Za-z]-$/u.test(block.original.trim()))
      .map(({ block }) => `${block.type}: ${block.original.slice(-180)}`),
    danglingHyphenContexts: danglingIndices.map((index) => result.blocks
      .slice(Math.max(0, index - 1), index + 2)
      .map(({ block }) => `[${block.type}] ${block.original}`)
      .join('\n')),
    lowercaseStartSamples: paragraphs
      .filter(({ block }) => /^[a-z][a-z\s-]{2}/u.test(block.original.trim()))
      .slice(0, 4)
      .map(({ block }) => block.original.slice(0, 220)),
    longestBlockSample: longestBlock.slice(0, 300),
    longestBlockText: longestBlock,
    blocks: result.blocks.map(({ block }) => ({ type: block.type, text: block.original })),
    structuredTables: result.figures.flatMap((region) => region.table
      ? [{ caption: region.caption, headers: region.table.headers, rows: region.table.rows }]
      : [])
  };
}

const corpusDescribe = corpusFiles.length > 0 ? describe : describe.skip;

corpusDescribe('mobile real-PDF corpus regression', () => {
  for (const filePath of corpusFiles) {
    it(path.basename(filePath), async () => {
      const bytes = new Uint8Array(fs.readFileSync(filePath));
      const pages: CorpusPageReport[] = [];
      const result = await recognizePdfPagesLocally(bytes, {
        pageTimeoutMs: 60_000,
        saveTimeoutMs: 10_000,
        cleanupTimeoutMs: 5_000,
        recognizeImage: async () => {
          throw new Error('Corpus regression unexpectedly requested OCR.');
        },
        onPageRecognized: (pageResult) => {
          pages.push(summarizePage(pageResult));
        }
      });
      const report: CorpusPaperReport = {
        fileName: path.basename(filePath),
        byteLength: bytes.byteLength,
        pageCount: result.pageCount,
        lastProcessedPage: result.lastProcessedPage,
        totalBlocks: pages.reduce((sum, page) => sum + page.blockCount, 0),
        textPages: pages.filter((page) => page.source === 'text').length,
        ocrPages: pages.filter((page) => page.source === 'ocr').length,
        compatibilityPages: pages.filter((page) => page.mode === 'compatibility').length,
        totalFigures: pages.reduce((sum, page) => sum + page.figureCount, 0),
        structuredTables: pages.reduce((sum, page) => sum + page.structuredTableCount, 0),
        captionedFigures: pages.reduce((sum, page) => sum + page.captionedFigureCount, 0),
        unmatchedCaptionFigures: pages.reduce((sum, page) => sum + page.unmatchedCaptionFigureCount, 0),
        maxBlockLength: Math.max(0, ...pages.map((page) => page.maxBlockLength)),
        suspiciousShortParagraphs: pages.reduce((sum, page) => sum + page.shortParagraphCount, 0),
        suspiciousLowercaseStarts: pages.reduce((sum, page) => sum + page.lowercaseStartCount, 0),
        danglingHyphens: pages.reduce((sum, page) => sum + page.danglingHyphenCount, 0),
        repairableDanglingHyphens: pages.reduce((sum, page) => sum + page.repairableDanglingHyphenCount, 0),
        pages
      };
      reports.push(report);
      console.info(
        `[mobile-pdf-corpus] ${report.fileName}: ${report.pageCount} pages, ` +
        `${report.totalBlocks} blocks, ${report.ocrPages} OCR, ` +
        `${report.structuredTables} rebuilt tables, ` +
        `${report.unmatchedCaptionFigures} unmatched figures, ` +
        `${report.repairableDanglingHyphens} repairable hyphens, max block ${report.maxBlockLength}`
      );

      expect(result.cancelled).toBe(false);
      expect(result.lastProcessedPage).toBe(result.pageCount);
      expect(pages).toHaveLength(result.pageCount);
      expect(report.ocrPages).toBe(0);
      expect(report.textPages).toBe(result.pageCount);
      expect(pages.every((page) => page.blockCount > 0)).toBe(true);
      expect(report.repairableDanglingHyphens).toBe(0);
      expect(report.maxBlockLength).toBeLessThan(2_500);
      expect(report.unmatchedCaptionFigures).toBe(0);
    }, 180_000);
  }

  it('writes the aggregate diagnostic report', () => {
    const outputPath = path.resolve('.tmp-mobile-pdf-corpus-report.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(reports, null, 2)}\n`, 'utf8');
    expect(reports).toHaveLength(corpusFiles.length);
  });
});

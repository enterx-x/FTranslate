import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  recognizePdfPagesLocally,
  stitchMobileCrossPageParagraphs,
  type LocalOcrPageResult
} from '../src/renderer/mobile/mobileLocalOcr';
import type { MobileTranslationEntry } from '../src/renderer/mobile/mobileTypes';
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
const standardFontDataUrl = `${path.resolve('node_modules/pdfjs-dist/standard_fonts').replace(/\\/gu, '/')}/`;

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
  missingCaptionRegionCount: number;
  invalidStructuredTableCount: number;
  unstructuredTableRegionCount: number;
  maxBlockLength: number;
  shortParagraphCount: number;
  lowercaseStartCount: number;
  embeddedMetadataArtifactCount: number;
  publisherBrandArtifactCount: number;
  referenceFragmentCount: number;
  adjacentDuplicateBlockCount: number;
  captionCollisionCount: number;
  embeddedCaptionInParagraphCount: number;
  embeddedSectionHeadingCount: number;
  numericTablePrefixInParagraphCount: number;
  embeddedLetteredRunInCount: number;
  captionContinuationFragmentCount: number;
  footerPageNumberPollutionCount: number;
  edgeFigureTextLeakCount: number;
  interruptedParagraphCount: number;
  malformedSpacingCount: number;
  figureTextLeakCandidateCount: number;
  containedFigureTextBlockCount: number;
  danglingHyphenCount: number;
  repairableDanglingHyphenCount: number;
  danglingHyphenSamples: string[];
  danglingHyphenContexts: string[];
  lowercaseStartSamples: string[];
  embeddedMetadataArtifactSamples: string[];
  publisherBrandArtifactSamples: string[];
  referenceFragmentSamples: string[];
  figureTextLeakCandidateSamples: string[];
  containedFigureTextBlockSamples: string[];
  missingCaptionRegionSamples: string[];
  unstructuredTableRegionSamples: string[];
  longestBlockSample: string;
  longestBlockText: string;
  blocks: Array<{
    type: string;
    text: string;
    section?: string;
    bounds?: { x: number; y: number; width: number; height: number; pageWidth?: number; pageHeight?: number };
  }>;
  figures: Array<{
    caption: string;
    bounds: { x: number; y: number; width: number; height: number };
    captionBounds?: { x: number; y: number; width: number; height: number };
  }>;
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
  missingCaptionRegions: number;
  invalidStructuredTables: number;
  unstructuredTableRegions: number;
  maxBlockLength: number;
  suspiciousShortParagraphs: number;
  suspiciousLowercaseStarts: number;
  embeddedMetadataArtifacts: number;
  publisherBrandArtifacts: number;
  referenceFragments: number;
  adjacentDuplicateBlocks: number;
  captionCollisions: number;
  embeddedCaptionsInParagraphs: number;
  embeddedSectionHeadings: number;
  numericTablePrefixesInParagraphs: number;
  embeddedLetteredRunIns: number;
  captionContinuationFragments: number;
  footerPageNumberPollution: number;
  edgeFigureTextLeaks: number;
  interruptedParagraphs: number;
  malformedSpacing: number;
  figureTextLeakCandidates: number;
  containedFigureTextBlocks: number;
  danglingHyphens: number;
  repairableDanglingHyphens: number;
  crossPageParagraphStitches: number;
  pages: CorpusPageReport[];
}

const reports: CorpusPaperReport[] = [];

function summarizePage(result: LocalOcrPageResult): CorpusPageReport {
  const paragraphs = result.blocks.filter(({ block }) => block.type === 'paragraph');
  const blockTexts = result.blocks.map(({ block }) => block.original.trim());
  const hasReferenceEntries = paragraphs.some(({ block }) => /^\[\d{1,4}\]\s/u.test(block.original.trim()));
  const embeddedMetadataArtifacts = result.blocks.filter(({ block }) => (
    /<latexit\b|sha1_base64\s*=|[A-Za-z0-9+/]{160,}={0,2}/iu.test(block.original)
  ));
  const publisherBrandArtifacts = result.page === 1
    ? result.blocks.filter(({ block }) => {
        const text = block.original.trim();
        const pageHeight = block.bounds?.pageHeight ?? 0;
        const nearTop = Boolean(block.bounds && pageHeight > 0 && block.bounds.y <= pageHeight * 0.08);
        return nearTop && (
          /^(?:∝\s*)?(?:BeingBeyond|智在[无⽆]界)$/iu.test(text) ||
          /^∝.*[\u3400-\u9fff]/u.test(text)
        );
      })
    : [];
  const referenceFragments = hasReferenceEntries
    ? result.blocks.filter(({ block }) => {
        const text = block.original.trim();
        return /^(?:\[\d{1,4}\]\s*)?(?:\p{Lu}\.\s*){1,4}$/u.test(text) ||
          /^\p{Lu}[\p{L}'-]+,\s*(?:\p{Lu}\.\s*){1,4}$/u.test(text) ||
          /^\d{4}\.$/u.test(text) ||
          (
            block.type === 'heading' &&
            /^(?:19|20)\d{2}\s+(?:IEEE|ACM|International|Conference|Transactions|Proceedings)\b/iu.test(text)
          ) ||
          /^\[\d{1,4}\]\s+.*\b(?:19|20)\d{2}\.\s*\d+(?:\s*,\s*\d+)*\s*$/u.test(text);
      })
    : [];
  const adjacentDuplicateBlockCount = blockTexts.slice(1).filter((text, index) => (
    text.length >= 12 &&
    text.toLocaleLowerCase().replace(/\s+/gu, ' ') === blockTexts[index].toLocaleLowerCase().replace(/\s+/gu, ' ')
  )).length;
  const captionCollisionCount = result.blocks.filter(({ block }) => (
    block.type === 'caption' &&
    (block.original.match(/\b(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+/giu) ?? []).length > 1
  )).length;
  const embeddedCaptionInParagraphCount = paragraphs.filter(({ block }) => (
    /(?:^|\s)(?:fig(?:ure)?\.?)\s*[\divxlcdm]+\s*:\s+/iu.test(block.original)
  )).length;
  const embeddedSectionHeadingCount = paragraphs.filter(({ block }) => {
    const text = block.original.trim();
    const normalizedSmallCaps = text.replace(/\b(\p{Lu})\s+(?=\p{Lu}{2,}\b)/gu, '$1');
    const embeddedMajorHeadingIndex = normalizedSmallCaps.search(
      /\b(?:[IVX]{1,6}\.\s*(?:CONCLUSION|REFERENCES)|ACKNOWLEDGMENTS?|REFERENCES)\b/u
    );
    return /^(?:[A-Z]\.\d+(?:\.\d+)*|\d+(?:\.\d+)+)\.?\s+\p{Lu}[\p{L}\p{N} ,:;()/-]{3,}\s+(?:Figure|Table|The|We|This)\b/u.test(text) ||
      embeddedMajorHeadingIndex > 12;
  }).length;
  const numericTablePrefixInParagraphCount = paragraphs.filter(({ block }) => (
    /^\d+\.\d+\s+\p{Ll}[\p{L}\p{N}-]*\s+/u.test(block.original.trim())
  )).length;
  const embeddedLetteredRunInCount = paragraphs.filter(({ block }) => (
    /:\s+[a-z]\)\s+\p{Lu}[\p{L}\p{N}\s-]{2,40}:/u.test(block.original)
  )).length;
  const captionContinuationFragmentCount = result.blocks.slice(0, -1).filter(({ block }, index) => {
    const next = result.blocks[index + 1]?.block;
    return block.type === 'caption' &&
      next?.type === 'paragraph' &&
      !/[.!?。！？][)\]"']*$/u.test(block.original.trim()) &&
      /^\p{Ll}/u.test(next.original.trim());
  }).length;
  const footerPageNumberPollutionCount = paragraphs.filter(({ block }) => {
    const pageHeight = block.bounds?.pageHeight ?? 0;
    return Boolean(
      block.bounds &&
      pageHeight > 0 &&
      block.original.length >= 80 &&
      block.bounds.y + block.bounds.height >= pageHeight * 0.9 &&
      new RegExp(`(?:^|\\s)${result.page}$`, 'u').test(block.original.trim())
    );
  }).length;
  const edgeFigureTextLeakCount = result.blocks.filter(({ block }) => {
    if (block.type === 'caption' || !block.bounds || block.original.length > 100) {
      return false;
    }
    const centerX = block.bounds.x + block.bounds.width / 2;
    const centerY = block.bounds.y + block.bounds.height / 2;
    return result.figures.some((region) => {
      const fullWidthFigure = region.bounds.pageWidth > 0 &&
        region.bounds.width >= region.bounds.pageWidth * 0.7;
      const horizontalOverlap = Math.max(
        0,
        Math.min(block.bounds!.x + block.bounds!.width, region.bounds.x + region.bounds.width) -
          Math.max(block.bounds!.x, region.bounds.x)
      );
      return fullWidthFigure &&
        centerY >= region.bounds.y &&
        centerY <= region.bounds.y + region.bounds.height &&
        (centerX < region.bounds.x || centerX > region.bounds.x + region.bounds.width) &&
        horizontalOverlap > 0;
    });
  }).length;
  const interruptedParagraphCount = result.blocks.slice(0, -2).filter(({ block }, index) => {
    const caption = result.blocks[index + 1]?.block;
    const continuation = result.blocks[index + 2]?.block;
    return block.type === 'paragraph' &&
      caption?.type === 'caption' &&
      continuation?.type === 'paragraph' &&
      !/[.!?。！？][)\]"']*$/u.test(block.original.trim()) &&
      /^[a-z][a-z-]*/u.test(continuation.original.trim());
  }).length;
  const malformedSpacingCount = result.blocks.filter(({ block }) => (
    /\d\.\s+\d|\p{L}-\s+\p{Ll}|\p{L}\s+[’']s\b/gu.test(block.original)
  )).length;
  const figureTextLeakCandidates = result.figures.length > 0
    ? paragraphs.filter(({ block }) => {
        const text = block.original.trim();
        return text.length >= 3 && text.length <= 80 && !/[.!?。！？:]$/u.test(text);
      })
    : [];
  const containedFigureTextBlocks = result.blocks.filter(({ block }) => (
    block.type !== 'caption' &&
    Boolean(block.bounds) &&
    result.figures.some((region) => {
      if (region.page !== block.page || !block.bounds) {
        return false;
      }
      const tolerance = 3;
      return block.bounds.x >= region.bounds.x - tolerance &&
        block.bounds.x + block.bounds.width <= region.bounds.x + region.bounds.width + tolerance &&
        block.bounds.y >= region.bounds.y - tolerance &&
        block.bounds.y + block.bounds.height <= region.bounds.y + region.bounds.height + tolerance;
    })
  ));
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
  const figureCaptionKeys = new Set(result.figures.flatMap((region) =>
    buildMobilePdfCaptionLookupKeys(region.caption)
  ));
  const missingCaptionRegions = result.blocks.filter(({ block }) => (
    block.type === 'caption' &&
    /^(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+\s*[:.]/iu.test(block.original.trim()) &&
    !buildMobilePdfCaptionLookupKeys(block.original).some((key) => figureCaptionKeys.has(key))
  ));
  const structuredTables = result.figures.filter((region) => Boolean(region.table));
  const invalidStructuredTables = structuredTables.filter((region) => {
    const table = region.table!;
    const populatedCells = table.rows.flat().filter((cell) => cell.trim()).length;
    const populatedRatio = populatedCells / Math.max(1, table.rows.length * table.headers.length);
    const maximumCellLength = Math.max(0, ...table.rows.flat().map((cell) => cell.length));
    return table.headers.length < 2 ||
      table.rows.length < 2 ||
      (table.headers.length >= 3 && table.headers.some((header) => !header.trim())) ||
      table.rows.some((row) => row.length !== table.headers.length) ||
      populatedRatio < 0.55 ||
      maximumCellLength > 260 ||
      (table.rows.length <= 3 && maximumCellLength > 180);
  });
  const unstructuredTableRegions = result.figures.filter((region) => (
    region.kind === 'table' && !region.table
  ));
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
    missingCaptionRegionCount: missingCaptionRegions.length,
    invalidStructuredTableCount: invalidStructuredTables.length,
    unstructuredTableRegionCount: unstructuredTableRegions.length,
    maxBlockLength: Math.max(0, ...result.blocks.map(({ block }) => block.original.length)),
    shortParagraphCount: paragraphs.filter(({ block }) => block.original.trim().length < 24).length,
    lowercaseStartCount: paragraphs.filter(({ block }) => /^[a-z][a-z\s-]{2}/u.test(block.original.trim())).length,
    embeddedMetadataArtifactCount: embeddedMetadataArtifacts.length,
    publisherBrandArtifactCount: publisherBrandArtifacts.length,
    referenceFragmentCount: referenceFragments.length,
    adjacentDuplicateBlockCount,
    captionCollisionCount,
    embeddedCaptionInParagraphCount,
    embeddedSectionHeadingCount,
    numericTablePrefixInParagraphCount,
    embeddedLetteredRunInCount,
    captionContinuationFragmentCount,
    footerPageNumberPollutionCount,
    edgeFigureTextLeakCount,
    interruptedParagraphCount,
    malformedSpacingCount,
    figureTextLeakCandidateCount: figureTextLeakCandidates.length,
    containedFigureTextBlockCount: containedFigureTextBlocks.length,
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
    embeddedMetadataArtifactSamples: embeddedMetadataArtifacts
      .slice(0, 4)
      .map(({ block }) => block.original.slice(0, 220)),
    publisherBrandArtifactSamples: publisherBrandArtifacts
      .slice(0, 4)
      .map(({ block }) => block.original.slice(0, 220)),
    referenceFragmentSamples: referenceFragments
      .slice(0, 8)
      .map(({ block }) => block.original.slice(0, 220)),
    figureTextLeakCandidateSamples: figureTextLeakCandidates
      .slice(0, 8)
      .map(({ block }) => block.original.slice(0, 220)),
    containedFigureTextBlockSamples: containedFigureTextBlocks
      .slice(0, 8)
      .map(({ block }) => block.original.slice(0, 220)),
    missingCaptionRegionSamples: missingCaptionRegions
      .slice(0, 8)
      .map(({ block }) => block.original.slice(0, 220)),
    unstructuredTableRegionSamples: unstructuredTableRegions
      .slice(0, 8)
      .map((region) => region.caption.slice(0, 220)),
    longestBlockSample: longestBlock.slice(0, 300),
    longestBlockText: longestBlock,
    blocks: result.blocks.map(({ block }) => ({
      type: block.type,
      text: block.original,
      ...(block.section ? { section: block.section } : {}),
      ...(block.bounds ? { bounds: block.bounds } : {})
    })),
    figures: result.figures.map((region) => ({
      caption: region.caption,
      bounds: region.bounds,
      ...(region.captionBounds ? { captionBounds: region.captionBounds } : {})
    })),
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
      const extractedEntries: MobileTranslationEntry[] = [];
      const result = await recognizePdfPagesLocally(bytes, {
        pageTimeoutMs: 60_000,
        saveTimeoutMs: 10_000,
        cleanupTimeoutMs: 5_000,
        standardFontDataUrl,
        recognizeImage: async () => {
          throw new Error('Corpus regression unexpectedly requested OCR.');
        },
        onPageRecognized: (pageResult) => {
          pages.push(summarizePage(pageResult));
          extractedEntries.push(...pageResult.blocks.map(({ block, order }) => ({
            sourceHash: block.sourceHash,
            page: block.page,
            original: block.original,
            translation: '',
            translatedAt: '1970-01-01T00:00:00.000Z',
            model: '',
            origin: pageResult.source,
            extractionMode: pageResult.extractionMode,
            ...(pageResult.extractionWarning ? { extractionWarning: pageResult.extractionWarning } : {}),
            order,
            blockType: block.type
          })));
        }
      });
      const stitchedEntries = stitchMobileCrossPageParagraphs(extractedEntries);
      const crossPageParagraphStitches = extractedEntries.length - stitchedEntries.length;
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
        missingCaptionRegions: pages.reduce((sum, page) => sum + page.missingCaptionRegionCount, 0),
        invalidStructuredTables: pages.reduce((sum, page) => sum + page.invalidStructuredTableCount, 0),
        unstructuredTableRegions: pages.reduce((sum, page) => sum + page.unstructuredTableRegionCount, 0),
        maxBlockLength: Math.max(0, ...pages.map((page) => page.maxBlockLength)),
        suspiciousShortParagraphs: pages.reduce((sum, page) => sum + page.shortParagraphCount, 0),
        suspiciousLowercaseStarts: pages.reduce((sum, page) => sum + page.lowercaseStartCount, 0),
        embeddedMetadataArtifacts: pages.reduce((sum, page) => sum + page.embeddedMetadataArtifactCount, 0),
        publisherBrandArtifacts: pages.reduce((sum, page) => sum + page.publisherBrandArtifactCount, 0),
        referenceFragments: pages.reduce((sum, page) => sum + page.referenceFragmentCount, 0),
        adjacentDuplicateBlocks: pages.reduce((sum, page) => sum + page.adjacentDuplicateBlockCount, 0),
        captionCollisions: pages.reduce((sum, page) => sum + page.captionCollisionCount, 0),
        embeddedCaptionsInParagraphs: pages.reduce((sum, page) => sum + page.embeddedCaptionInParagraphCount, 0),
        embeddedSectionHeadings: pages.reduce((sum, page) => sum + page.embeddedSectionHeadingCount, 0),
        numericTablePrefixesInParagraphs: pages.reduce((sum, page) => sum + page.numericTablePrefixInParagraphCount, 0),
        embeddedLetteredRunIns: pages.reduce((sum, page) => sum + page.embeddedLetteredRunInCount, 0),
        captionContinuationFragments: pages.reduce((sum, page) => sum + page.captionContinuationFragmentCount, 0),
        footerPageNumberPollution: pages.reduce((sum, page) => sum + page.footerPageNumberPollutionCount, 0),
        edgeFigureTextLeaks: pages.reduce((sum, page) => sum + page.edgeFigureTextLeakCount, 0),
        interruptedParagraphs: pages.reduce((sum, page) => sum + page.interruptedParagraphCount, 0),
        malformedSpacing: pages.reduce((sum, page) => sum + page.malformedSpacingCount, 0),
        figureTextLeakCandidates: pages.reduce((sum, page) => sum + page.figureTextLeakCandidateCount, 0),
        containedFigureTextBlocks: pages.reduce((sum, page) => sum + page.containedFigureTextBlockCount, 0),
        danglingHyphens: pages.reduce((sum, page) => sum + page.danglingHyphenCount, 0),
        repairableDanglingHyphens: pages.reduce((sum, page) => sum + page.repairableDanglingHyphenCount, 0),
        crossPageParagraphStitches,
        pages
      };
      reports.push(report);
      console.info(
        `[mobile-pdf-corpus] ${report.fileName}: ${report.pageCount} pages, ` +
        `${report.totalBlocks} blocks, ${report.ocrPages} OCR, ` +
        `${report.structuredTables} rebuilt tables, ` +
        `${report.unstructuredTableRegions} table crops, ` +
        `${report.unmatchedCaptionFigures} unmatched figures, ` +
        `${report.missingCaptionRegions} captions without regions, ` +
        `${report.embeddedMetadataArtifacts} metadata artifacts, ` +
        `${report.publisherBrandArtifacts} publisher-brand artifacts, ` +
        `${report.referenceFragments} reference fragments, ` +
        `${report.captionCollisions} caption collisions, ` +
        `${report.embeddedCaptionsInParagraphs} embedded captions, ` +
        `${report.numericTablePrefixesInParagraphs} numeric table prefixes, ` +
        `${report.embeddedLetteredRunIns} embedded lettered run-ins, ` +
        `${report.captionContinuationFragments} caption tails, ` +
        `${report.footerPageNumberPollution} footer-number pollution, ` +
        `${report.edgeFigureTextLeaks} edge figure-text leaks, ` +
        `${report.interruptedParagraphs} interrupted paragraphs, ` +
        `${report.containedFigureTextBlocks} contained figure-text blocks, ` +
        `${report.malformedSpacing} malformed spacing, ` +
        `${report.crossPageParagraphStitches} cross-page stitches, ` +
        `${report.repairableDanglingHyphens} repairable hyphens, max block ${report.maxBlockLength}`
      );

      expect(result.cancelled).toBe(false);
      expect(result.lastProcessedPage).toBe(result.pageCount);
      expect(pages).toHaveLength(result.pageCount);
      expect(report.ocrPages).toBe(0);
      expect(report.textPages).toBe(result.pageCount);
      expect(pages.every((page) => page.blockCount > 0)).toBe(true);
      expect(report.repairableDanglingHyphens).toBe(0);
      expect(report.embeddedMetadataArtifacts).toBe(0);
      expect(report.publisherBrandArtifacts).toBe(0);
      expect(report.referenceFragments).toBe(0);
      expect(report.captionCollisions).toBe(0);
      expect(report.embeddedCaptionsInParagraphs).toBe(0);
      expect(report.embeddedSectionHeadings).toBe(0);
      expect(report.numericTablePrefixesInParagraphs).toBe(0);
      expect(report.embeddedLetteredRunIns).toBe(0);
      expect(report.captionContinuationFragments).toBe(0);
      expect(report.footerPageNumberPollution).toBe(0);
      expect(report.edgeFigureTextLeaks).toBe(0);
      expect(report.interruptedParagraphs).toBe(0);
      expect(report.containedFigureTextBlocks).toBe(0);
      expect(report.malformedSpacing).toBe(0);
      expect(report.maxBlockLength).toBeLessThan(2_500);
      expect(report.unmatchedCaptionFigures).toBe(0);
      expect(report.missingCaptionRegions).toBe(0);
      expect(report.invalidStructuredTables).toBe(0);
      expect(stitchMobileCrossPageParagraphs(stitchedEntries)).toEqual(stitchedEntries);
    }, 180_000);
  }

  it('writes the aggregate diagnostic report', () => {
    const outputPath = path.resolve('.tmp-mobile-pdf-corpus-report.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(reports, null, 2)}\n`, 'utf8');
    expect(reports).toHaveLength(corpusFiles.length);
  });
});

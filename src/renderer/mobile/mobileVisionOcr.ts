import { CapacitorHttp } from '@capacitor/core';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {
  hashText,
  type ExtractedBlockType,
  type ExtractedPdfBlock
} from '../lib/pdfTextStructure';
import { buildTranslationEndpoint } from './mobileTranslation';
import type { MobileTranslationEntry, MobileTranslationSession } from './mobileTypes';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface VisionOcrParagraph {
  original: string;
  translation: string;
  type: ExtractedBlockType;
}

export interface VisionOcrBlock {
  block: ExtractedPdfBlock;
  translation: string;
  order: number;
}

export interface VisionOcrPageResult {
  page: number;
  pageCount: number;
  blocks: VisionOcrBlock[];
}

export interface VisionOcrRunResult {
  pageCount: number;
  lastProcessedPage: number;
  recognizedBlockCount: number;
  cancelled: boolean;
}

interface VisionOcrPayload {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export async function recognizePdfPagesWithVision(
  pdfData: Uint8Array,
  session: MobileTranslationSession,
  options: {
    startPage?: number;
    isCancelled?: () => boolean;
    onDocumentReady?: (pageCount: number) => void;
    onPageRecognized?: (result: VisionOcrPageResult) => Promise<void> | void;
  } = {}
): Promise<VisionOcrRunResult> {
  if (!session.apiKey.trim()) {
    throw new Error('请先填写支持图片输入的翻译接口 API Key。');
  }

  const loadingTask = pdfjsLib.getDocument({ data: pdfData.slice() });
  let pdfDocument: PDFDocumentProxy | null = null;
  let lastProcessedPage = Math.max(0, (options.startPage ?? 1) - 1);
  let recognizedBlockCount = 0;
  try {
    pdfDocument = await loadingTask.promise;
    const pageCount = pdfDocument.numPages;
    const startPage = Math.min(pageCount, Math.max(1, options.startPage ?? 1));
    options.onDocumentReady?.(pageCount);

    for (let pageNumber = startPage; pageNumber <= pageCount; pageNumber += 1) {
      if (options.isCancelled?.()) {
        return { pageCount, lastProcessedPage, recognizedBlockCount, cancelled: true };
      }
      const page = await pdfDocument.getPage(pageNumber);
      const imageDataUrl = await renderPdfPageForVision(page);
      const paragraphs = await recognizePageImage(imageDataUrl, pageNumber, session);
      const blocks = buildVisionOcrBlocks(pageNumber, paragraphs);
      await options.onPageRecognized?.({ page: pageNumber, pageCount, blocks });
      lastProcessedPage = pageNumber;
      recognizedBlockCount += blocks.length;
      page.cleanup();
    }

    return { pageCount, lastProcessedPage, recognizedBlockCount, cancelled: false };
  } finally {
    if (pdfDocument) {
      await pdfDocument.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

export function calculateVisionRenderScale(
  pageWidth: number,
  pageHeight: number,
  maxLongEdge = 1600
): number {
  const longEdge = Math.max(pageWidth, pageHeight);
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    return 1;
  }
  return Math.min(2, Math.max(0.6, maxLongEdge / longEdge));
}

export function parseVisionOcrResponse(content: string): VisionOcrParagraph[] {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '');
  const objectStart = normalized.indexOf('{');
  const objectEnd = normalized.lastIndexOf('}');
  const arrayStart = normalized.indexOf('[');
  const arrayEnd = normalized.lastIndexOf(']');
  const candidate = arrayStart >= 0 && arrayEnd > arrayStart && (objectStart < 0 || arrayStart < objectStart)
    ? normalized.slice(arrayStart, arrayEnd + 1)
    : objectStart >= 0 && objectEnd > objectStart
      ? normalized.slice(objectStart, objectEnd + 1)
      : normalized;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate) as unknown;
  } catch {
    throw new Error('图片识别接口没有返回可解析的段落 JSON；当前模型可能不支持图片输入。');
  }
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { paragraphs?: unknown }).paragraphs)
      ? (parsed as { paragraphs: unknown[] }).paragraphs
      : [];

  return records
    .map((value): VisionOcrParagraph | null => {
      if (!value || typeof value !== 'object') {
        return null;
      }
      const record = value as Record<string, unknown>;
      const original = typeof record.original === 'string' ? record.original.trim() : '';
      const translation = typeof record.translation === 'string'
        ? record.translation.trim()
        : typeof record.translationZh === 'string'
          ? record.translationZh.trim()
          : '';
      if (!original || !translation) {
        return null;
      }
      return {
        original,
        translation,
        type: isExtractedBlockType(record.type) ? record.type : 'paragraph'
      };
    })
    .filter((value): value is VisionOcrParagraph => value !== null)
    .slice(0, 80);
}

export function buildVisionOcrBlocks(page: number, paragraphs: VisionOcrParagraph[]): VisionOcrBlock[] {
  return paragraphs.map((paragraph, index) => {
    const section = `OCR Page ${page}`;
    const sourceHash = hashText(`${page}|${index}|${paragraph.type}|${section}|${paragraph.original}`);
    return {
      order: (page - 1) * 1000 + index,
      translation: paragraph.translation,
      block: {
        id: `vision-${page}-${index}-${sourceHash}`,
        section,
        original: paragraph.original,
        translation: paragraph.translation,
        type: paragraph.type,
        page,
        sourceHash
      }
    };
  });
}

export function buildCachedVisionBlocks(entries: MobileTranslationEntry[]): ExtractedPdfBlock[] {
  return entries
    .filter((entry) => entry.origin === 'vision')
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftOrder = Number.isFinite(left.entry.order) ? Number(left.entry.order) : left.entry.page * 1000 + left.index;
      const rightOrder = Number.isFinite(right.entry.order) ? Number(right.entry.order) : right.entry.page * 1000 + right.index;
      return leftOrder - rightOrder;
    })
    .map(({ entry }) => ({
      id: `vision-cache-${entry.sourceHash}`,
      section: `OCR Page ${entry.page}`,
      original: entry.original,
      translation: entry.translation,
      type: isExtractedBlockType(entry.blockType) ? entry.blockType : 'paragraph',
      page: entry.page,
      sourceHash: entry.sourceHash
    }));
}

async function renderPdfPageForVision(page: PDFPageProxy): Promise<string> {
  const baseViewport = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: calculateVisionRenderScale(baseViewport.width, baseViewport.height)
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('当前浏览器无法创建扫描页识别画布。');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  canvas.width = 1;
  canvas.height = 1;
  return dataUrl;
}

async function recognizePageImage(
  imageDataUrl: string,
  pageNumber: number,
  session: MobileTranslationSession
): Promise<VisionOcrParagraph[]> {
  const response = await CapacitorHttp.post({
    url: buildTranslationEndpoint(session.baseURL),
    headers: {
      Authorization: `Bearer ${session.apiKey.trim()}`,
      'Content-Type': 'application/json'
    },
    data: {
      model: session.model.trim(),
      messages: [
        {
          role: 'system',
          content:
            '你是科研 PDF 的视觉 OCR 与翻译助手。按自然阅读顺序识别页面中的标题和正文，忽略纯页码、重复页眉页脚与装饰。保留公式、变量、引用编号、Figure/Table 编号和专有名词。original 必须忠实保留识别出的原文；translation 必须是简体中文，若原文已经是中文则保持原意并规范断行。只输出严格 JSON：{"paragraphs":[{"type":"heading|paragraph|caption|formula","original":"...","translation":"..."}]}。不要输出 Markdown。'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `识别并翻译这份 PDF 的第 ${pageNumber} 页。` },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 6000
    },
    connectTimeout: 20_000,
    readTimeout: 120_000
  });
  const payload = normalizePayload(response.data);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(payload.error?.message || `扫描页识别失败：HTTP ${response.status}`);
  }
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('扫描页识别接口没有返回内容。');
  }
  return parseVisionOcrResponse(content);
}

function normalizePayload(value: unknown): VisionOcrPayload {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as VisionOcrPayload;
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? (value as VisionOcrPayload) : {};
}

function isExtractedBlockType(value: unknown): value is ExtractedBlockType {
  return value === 'heading' || value === 'paragraph' || value === 'caption' || value === 'formula';
}

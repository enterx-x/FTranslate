import type { PaperRecord } from './papers';
import type { ExtractedPdfBlock } from './pdfTextStructure';

export const METHOD_CARDS_KEY = 'pdfTranslationReader:methodCards';

export type MethodCardStatus = 'draft' | 'needs-review' | 'verified';
export type MethodCardReviewState = 'unconfirmed' | 'accepted' | 'rejected';
export type EvidenceSourceType = 'pdf-text' | 'figure-caption' | 'table-caption' | 'note';

export type MethodCardFieldKey =
  | 'problem'
  | 'inputOutput'
  | 'modelArchitecture'
  | 'trainingObjective'
  | 'lossFunction'
  | 'constraints'
  | 'datasetOrEnvironment'
  | 'baseline'
  | 'metrics'
  | 'claimedContribution'
  | 'limitations'
  | 'reproductionRisk';

export interface MethodCardFieldDefinition {
  key: MethodCardFieldKey;
  label: string;
}

export interface MethodCard {
  id: string;
  projectId: string;
  paperId: string;
  title: string;
  status: MethodCardStatus;
  fields: MethodCardField[];
  evidenceSources: EvidenceSource[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MethodCardField {
  key: MethodCardFieldKey;
  label: string;
  value: string;
  confidence: number;
  evidenceSourceIds: string[];
  reviewState: MethodCardReviewState;
}

export interface EvidenceSource {
  id: string;
  paperId: string;
  type: EvidenceSourceType;
  page?: number;
  section?: string;
  locator: string;
  text: string;
  score: number;
}

export interface BuildMethodCardInput {
  projectId: string;
  paper: PaperRecord;
  blocks: ExtractedPdfBlock[];
  now?: string;
}

interface FieldConfig {
  key: MethodCardFieldKey;
  sectionPatterns: RegExp[];
  textPatterns: RegExp[];
  preferredTypes?: EvidenceSourceType[];
  minimumScore?: number;
}

interface FieldEvidenceCandidate {
  source: EvidenceSource;
  score: number;
}

export const METHOD_CARD_FIELD_DEFINITIONS: MethodCardFieldDefinition[] = [
  { key: 'problem', label: 'Problem' },
  { key: 'inputOutput', label: 'Input / Output' },
  { key: 'modelArchitecture', label: 'Model Architecture' },
  { key: 'trainingObjective', label: 'Training Objective' },
  { key: 'lossFunction', label: 'Loss Function' },
  { key: 'constraints', label: 'Constraints' },
  { key: 'datasetOrEnvironment', label: 'Dataset / Environment' },
  { key: 'baseline', label: 'Baseline' },
  { key: 'metrics', label: 'Evaluation Metrics' },
  { key: 'claimedContribution', label: 'Claimed Contribution' },
  { key: 'limitations', label: 'Limitations' },
  { key: 'reproductionRisk', label: 'Reproduction Risk' }
];

const FIELD_CONFIGS: FieldConfig[] = [
  {
    key: 'problem',
    sectionPatterns: [/abstract|intro|background|problem|motivation|摘要|引言|背景|问题/iu],
    textPatterns: [/address|challenge|problem|difficult|bottleneck|safe|navigation|clutter|解决|挑战|瓶颈|问题|困难/iu]
  },
  {
    key: 'inputOutput',
    sectionPatterns: [/method|approach|model|framework|方法|模型|框架/iu],
    textPatterns: [/input|output|takes?|outputs?|observations?|state|commands?|actions?|输入|输出|观测|状态|动作|指令/iu],
    preferredTypes: ['pdf-text']
  },
  {
    key: 'modelArchitecture',
    sectionPatterns: [/method|approach|model|framework|architecture|algorithm|方法|模型|架构|算法/iu],
    textPatterns: [/network|architecture|framework|controller|policy|model|module|pipeline|overview|graph neural|模型|网络|框架|模块/iu],
    preferredTypes: ['figure-caption', 'pdf-text']
  },
  {
    key: 'trainingObjective',
    sectionPatterns: [/method|training|objective|optimization|方法|训练|目标|优化/iu],
    textPatterns: [/training|optimizes?|objective|loss|reward|ppo|gradient|train|训练|优化|目标|损失|奖励/iu]
  },
  {
    key: 'lossFunction',
    sectionPatterns: [/method|objective|loss|formula|方法|目标|损失|公式/iu],
    textPatterns: [/loss|objective|penalt(?:y|ies)|reward|regulari[sz]ation|J\(|R_|L_|损失|目标函数|惩罚|奖励/iu]
  },
  {
    key: 'constraints',
    sectionPatterns: [/method|constraint|safety|方法|约束|安全/iu],
    textPatterns: [/constraints?|control barrier|cbf|safety|collision|violation|mpc|约束|安全|碰撞|违反/iu],
    preferredTypes: ['pdf-text']
  },
  {
    key: 'datasetOrEnvironment',
    sectionPatterns: [/experiment|evaluation|dataset|benchmark|setting|实验|评估|数据集|基准|设置/iu],
    textPatterns: [/dataset|environment|task|benchmark|robot|navigation|clutter|platform|场景|任务|环境|数据集|平台/iu]
  },
  {
    key: 'baseline',
    sectionPatterns: [/experiment|evaluation|result|comparison|实验|评估|结果|对比/iu],
    textPatterns: [/baseline|compare|against|comparison|mpc|ppo|sota|state-of-the-art|对比|基线|比较/iu],
    preferredTypes: ['table-caption', 'pdf-text']
  },
  {
    key: 'metrics',
    sectionPatterns: [/experiment|evaluation|result|metric|实验|评估|结果|指标/iu],
    textPatterns: [/metrics?|success rate|collision rate|path length|accuracy|return|score|指标|成功率|碰撞率|路径长度/iu],
    preferredTypes: ['table-caption', 'pdf-text']
  },
  {
    key: 'claimedContribution',
    sectionPatterns: [/abstract|intro|conclusion|contribution|摘要|引言|结论|贡献/iu],
    textPatterns: [/propose|present|introduce|contribution|novel|improve|提出|贡献|创新|改进/iu]
  },
  {
    key: 'limitations',
    sectionPatterns: [/limitation|discussion|conclusion|future|局限|讨论|结论|未来/iu],
    textPatterns: [/limitation|failure|weakness|future work|discussion|局限|不足|失败|未来/iu],
    preferredTypes: ['note', 'pdf-text']
  },
  {
    key: 'reproductionRisk',
    sectionPatterns: [/limitation|discussion|experiment|note|局限|讨论|实验|笔记/iu],
    textPatterns: [/risk|reproduc|confirm|solver|dependency|environment|qp|复现|风险|需要确认|求解器|依赖|环境/iu],
    preferredTypes: ['note', 'pdf-text'],
    minimumScore: 4
  }
];

const REFERENCE_SECTION_PATTERN = /^(references?|bibliography|参考文献)\b/iu;
const FIGURE_CAPTION_PATTERN = /^(fig\.?|figure)\s*\d+/iu;
const TABLE_CAPTION_PATTERN = /^(tab\.?|table)\s*\d+/iu;

export function buildMethodCardFromEvidence(input: BuildMethodCardInput): MethodCard {
  const now = input.now ?? new Date().toISOString();
  const evidenceSources = collectMethodCardEvidence(input.paper, input.blocks);
  const fields = METHOD_CARD_FIELD_DEFINITIONS.map((definition) =>
    buildMethodCardField(definition, evidenceSources)
  );
  const hasGroundedField = fields.some((field) => Boolean(field.value));

  return {
    id: createMethodCardId(input.projectId, input.paper.id),
    projectId: input.projectId,
    paperId: input.paper.id,
    title: getPaperTitle(input.paper),
    status: hasGroundedField ? 'needs-review' : 'draft',
    fields,
    evidenceSources,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
}

export function collectMethodCardEvidence(
  paper: Pick<PaperRecord, 'id' | 'notes'>,
  blocks: ExtractedPdfBlock[]
): EvidenceSource[] {
  const blockSources = blocks
    .map((block) => toEvidenceSource(paper.id, block))
    .filter((source): source is EvidenceSource => Boolean(source));
  const noteSource = toNoteEvidenceSource(paper);

  return dedupeEvidenceSources(noteSource ? [...blockSources, noteSource] : blockSources);
}

export function upsertMethodCard(cards: MethodCard[], incoming: MethodCard): MethodCard[] {
  const existingIndex = cards.findIndex(
    (card) => card.projectId === incoming.projectId && card.paperId === incoming.paperId
  );

  if (existingIndex < 0) {
    return [incoming, ...cards];
  }

  const existing = cards[existingIndex];
  const nextCard: MethodCard = {
    ...incoming,
    id: existing.id,
    createdAt: existing.createdAt,
    version: Math.max(1, existing.version) + 1
  };

  return [nextCard, ...cards.filter((_, index) => index !== existingIndex)];
}

export function parseMethodCards(value: string | null): MethodCard[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeMethodCard).filter((card): card is MethodCard => Boolean(card));
  } catch {
    return [];
  }
}

export function serializeMethodCards(cards: MethodCard[]): string {
  return JSON.stringify(cards, null, 2);
}

function buildMethodCardField(
  definition: MethodCardFieldDefinition,
  evidenceSources: EvidenceSource[]
): MethodCardField {
  const config = FIELD_CONFIGS.find((item) => item.key === definition.key);
  const candidate = config ? pickEvidenceForField(config, evidenceSources) : null;

  if (!candidate || candidate.score < (config?.minimumScore ?? 3)) {
    return {
      key: definition.key,
      label: definition.label,
      value: '',
      confidence: 0,
      evidenceSourceIds: [],
      reviewState: 'unconfirmed'
    };
  }

  return {
    key: definition.key,
    label: definition.label,
    value: normalizeInlineText(candidate.source.text, 260),
    confidence: toConfidence(candidate.score),
    evidenceSourceIds: [candidate.source.id],
    reviewState: 'unconfirmed'
  };
}

function pickEvidenceForField(config: FieldConfig, evidenceSources: EvidenceSource[]): FieldEvidenceCandidate | null {
  const candidates = evidenceSources
    .map((source) => ({
      source,
      score: scoreEvidenceForField(source, config)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.source.score - left.source.score);

  return candidates[0] ?? null;
}

function scoreEvidenceForField(source: EvidenceSource, config: FieldConfig): number {
  const section = source.section ?? '';
  const text = source.text;
  let score = Math.min(4, source.score);

  if (config.sectionPatterns.some((pattern) => pattern.test(section))) {
    score += 2;
  }
  if (config.textPatterns.some((pattern) => pattern.test(text))) {
    score += 3;
  }
  if (config.preferredTypes?.includes(source.type)) {
    score += 1.5;
  }
  if (source.type === 'note' && config.key === 'reproductionRisk') {
    score += 3;
  }
  if (source.type === 'note' && (config.key === 'limitations' || config.key === 'claimedContribution')) {
    score += 1;
  }

  return score;
}

function toEvidenceSource(paperId: string, block: ExtractedPdfBlock): EvidenceSource | null {
  const text = normalizeInlineText(block.original, 700);
  const section = block.section?.trim() ?? '';

  if (!text || text.length < 18 || REFERENCE_SECTION_PATTERN.test(section)) {
    return null;
  }

  if (block.type === 'caption') {
    if (FIGURE_CAPTION_PATTERN.test(text)) {
      return createBlockEvidenceSource(paperId, block, 'figure-caption', text, 'Figure');
    }
    if (TABLE_CAPTION_PATTERN.test(text)) {
      return createBlockEvidenceSource(paperId, block, 'table-caption', text, 'Table');
    }
    return null;
  }

  if (block.type !== 'paragraph' && block.type !== 'formula') {
    return null;
  }

  return createBlockEvidenceSource(paperId, block, 'pdf-text', text);
}

function createBlockEvidenceSource(
  paperId: string,
  block: ExtractedPdfBlock,
  type: EvidenceSourceType,
  text: string,
  locatorSuffix?: string
): EvidenceSource {
  const page = Math.max(1, Number(block.page) || 1);
  const section = block.section?.trim() || `Page ${page}`;
  const locator = [`p. ${page}`, section, locatorSuffix].filter(Boolean).join(' · ');

  return {
    id: createEvidenceId(paperId, type, locator, text),
    paperId,
    type,
    page,
    section,
    locator,
    text,
    score: scoreEvidenceText(text, type)
  };
}

function toNoteEvidenceSource(paper: Pick<PaperRecord, 'id' | 'notes'>): EvidenceSource | null {
  const text = normalizeInlineText(paper.notes, 700);
  if (text.length < 8) {
    return null;
  }

  return {
    id: createEvidenceId(paper.id, 'note', '阅读笔记', text),
    paperId: paper.id,
    type: 'note',
    section: '阅读笔记',
    locator: '阅读笔记',
    text,
    score: scoreEvidenceText(text, 'note')
  };
}

function scoreEvidenceText(text: string, type: EvidenceSourceType): number {
  let score = type === 'note' ? 2 : 1;
  if (type === 'figure-caption' || type === 'table-caption') {
    score += 2;
  }
  if (text.length >= 80 && text.length <= 360) {
    score += 2;
  }
  if (
    /\b(propose|present|introduce|address|method|model|framework|training|objective|baseline|metric|result|constraint|safety|dataset|task)\b/iu.test(
      text
    )
  ) {
    score += 2;
  }
  if (/[。！？.!?]/u.test(text)) {
    score += 1;
  }
  return score;
}

function dedupeEvidenceSources(sources: EvidenceSource[]): EvidenceSource[] {
  const seen = new Set<string>();
  const result: EvidenceSource[] = [];

  sources.forEach((source) => {
    const key = `${source.type}|${source.locator}|${source.text.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(source);
  });

  return result;
}

function normalizeMethodCard(value: unknown): MethodCard | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNonEmptyString(value.id);
  const projectId = readNonEmptyString(value.projectId);
  const paperId = readNonEmptyString(value.paperId);
  const title = readNonEmptyString(value.title);

  if (!id || !projectId || !paperId) {
    return null;
  }

  return {
    id,
    projectId,
    paperId,
    title,
    status: normalizeStatus(value.status),
    fields: normalizeFields(value.fields),
    evidenceSources: normalizeEvidenceSources(value.evidenceSources),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    version: Math.max(1, Number(value.version) || 1)
  };
}

function normalizeFields(value: unknown): MethodCardField[] {
  const parsedFields = Array.isArray(value)
    ? value.map(normalizeField).filter((field): field is MethodCardField => Boolean(field))
    : [];
  const byKey = new Map(parsedFields.map((field) => [field.key, field]));

  return METHOD_CARD_FIELD_DEFINITIONS.map(
    (definition) =>
      byKey.get(definition.key) ?? {
        key: definition.key,
        label: definition.label,
        value: '',
        confidence: 0,
        evidenceSourceIds: [],
        reviewState: 'unconfirmed'
      }
  );
}

function normalizeField(value: unknown): MethodCardField | null {
  if (!isRecord(value) || !isFieldKey(value.key)) {
    return null;
  }

  const definition = METHOD_CARD_FIELD_DEFINITIONS.find((item) => item.key === value.key);
  return {
    key: value.key,
    label: typeof value.label === 'string' && value.label.trim() ? value.label : definition?.label ?? value.key,
    value: typeof value.value === 'string' ? value.value : '',
    confidence: clamp(Number(value.confidence) || 0, 0, 1),
    evidenceSourceIds: readStringArray(value.evidenceSourceIds),
    reviewState: normalizeReviewState(value.reviewState)
  };
}

function normalizeEvidenceSources(value: unknown): EvidenceSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): EvidenceSource | null => {
      if (!isRecord(item)) {
        return null;
      }
      const id = readNonEmptyString(item.id);
      const paperId = readNonEmptyString(item.paperId);
      const type = normalizeEvidenceSourceType(item.type);
      const text = readNonEmptyString(item.text);
      const locator = readNonEmptyString(item.locator);
      if (!id || !paperId || !type || !text || !locator) {
        return null;
      }
      return {
        id,
        paperId,
        type,
        page: typeof item.page === 'number' ? item.page : undefined,
        section: typeof item.section === 'string' ? item.section : undefined,
        locator,
        text,
        score: Math.max(0, Number(item.score) || 0)
      };
    })
    .filter((source): source is EvidenceSource => Boolean(source));
}

function normalizeStatus(value: unknown): MethodCardStatus {
  if (value === 'needs-review' || value === 'verified') {
    return value;
  }
  return 'draft';
}

function normalizeReviewState(value: unknown): MethodCardReviewState {
  if (value === 'accepted' || value === 'rejected') {
    return value;
  }
  return 'unconfirmed';
}

function normalizeEvidenceSourceType(value: unknown): EvidenceSourceType | null {
  if (value === 'pdf-text' || value === 'figure-caption' || value === 'table-caption' || value === 'note') {
    return value;
  }
  return null;
}

function isFieldKey(value: unknown): value is MethodCardFieldKey {
  return METHOD_CARD_FIELD_DEFINITIONS.some((definition) => definition.key === value);
}

function createMethodCardId(projectId: string, paperId: string): string {
  return `method-card-${hashString(`${projectId}|${paperId}`)}`;
}

function createEvidenceId(paperId: string, type: EvidenceSourceType, locator: string, text: string): string {
  return `method-evidence-${hashString(`${paperId}|${type}|${locator}|${text}`)}`;
}

function getPaperTitle(paper: PaperRecord): string {
  return paper.chineseTitle || paper.englishTitle || paper.pdfName.replace(/\.[^.]+$/u, '') || paper.id;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    )
  ];
}

function normalizeInlineText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function toConfidence(score: number): number {
  return clamp(Math.round((score / 10) * 100) / 100, 0.1, 0.98);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

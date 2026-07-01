import type { CodeRepositoryRecord } from './codeRepositories';
import type { MethodCard, MethodCardField } from './methodCards';

export interface PaperToCodeMappingRow {
  id: string;
  concept: string;
  methodFieldKey: string;
  codeEvidencePath: string;
  evidenceType: 'entry' | 'config' | 'manifest';
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PaperToCodeMappingResult {
  methodCardId: string;
  repositoryId: string;
  rows: PaperToCodeMappingRow[];
  coverage: {
    methodConceptCount: number;
    mappedConceptCount: number;
  };
  risks: string[];
}

interface CandidateMatch {
  path: string;
  type: PaperToCodeMappingRow['evidenceType'];
  haystack: string;
  reason: string;
  priority: number;
}

export function buildPaperToCodeMapping(input: {
  methodCard: MethodCard;
  repository: CodeRepositoryRecord;
}): PaperToCodeMappingResult {
  const fields = input.methodCard.fields.filter(isGroundedField);
  const candidates = buildCandidates(input.repository);
  const rows = fields
    .map((field) => mapFieldToCode(input.methodCard.id, field, candidates))
    .filter((row): row is PaperToCodeMappingRow => Boolean(row));

  return {
    methodCardId: input.methodCard.id,
    repositoryId: input.repository.id,
    rows,
    coverage: {
      methodConceptCount: fields.length,
      mappedConceptCount: rows.length
    },
    risks: input.repository.risks
  };
}

function isGroundedField(field: MethodCardField): boolean {
  return Boolean(field.value.trim()) && field.evidenceSourceIds.length > 0;
}

function mapFieldToCode(
  methodCardId: string,
  field: MethodCardField,
  candidates: CandidateMatch[]
): PaperToCodeMappingRow | null {
  const tokens = tokenize(field.value);
  if (tokens.length === 0) return null;
  const winner = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(tokens, candidate)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.candidate.priority - left.candidate.priority)[0];

  if (!winner) return null;
  return {
    id: `code-map-${hashString(`${methodCardId}|${field.key}|${winner.candidate.path}`)}`,
    concept: field.value,
    methodFieldKey: field.key,
    codeEvidencePath: winner.candidate.path,
    evidenceType: winner.candidate.type,
    reason: winner.candidate.reason,
    confidence: winner.score >= 4 ? 'high' : winner.score >= 2 ? 'medium' : 'low'
  };
}

function buildCandidates(repository: CodeRepositoryRecord): CandidateMatch[] {
  return [
    ...repository.entryPoints.map((entry): CandidateMatch => ({
      path: entry.filePath,
      type: 'entry',
      haystack: `${entry.filePath} ${entry.commandCandidate} ${entry.reason}`,
      reason: entry.reason,
      priority: 3
    })),
    ...repository.configFiles.map((file): CandidateMatch => ({
      path: file.filePath,
      type: 'config',
      haystack: `${file.filePath} ${file.excerpt}`,
      reason: `${file.filePath} contains config text related to the method concept.`,
      priority: 2
    })),
    ...repository.manifests.map((manifest): CandidateMatch => ({
      path: manifest.filePath,
      type: 'manifest',
      haystack: `${manifest.filePath} ${manifest.fileName} ${manifest.kind} ${manifest.dependencies.join(' ')}`,
      reason: `${manifest.fileName} declares dependencies related to the method concept.`,
      priority: 1
    }))
  ];
}

function scoreCandidate(tokens: string[], candidate: CandidateMatch): number {
  const haystack = candidate.haystack.toLowerCase();
  const pathTokens = tokenize(candidate.path);
  return tokens.reduce((score, token) => {
    const textScore = haystack.includes(token) ? (token.length <= 2 ? 1 : 2) : 0;
    const pathScore = pathTokens.includes(token) ? 1 : 0;
    return score + textScore + pathScore;
  }, candidate.priority * 0.1);
}

function tokenize(value: string): string[] {
  const matches = value.match(/[A-Z]{2,}|[A-Za-z0-9]+|[\p{Script=Han}]{2,}/gu) ?? [];
  const stopWords = new Set(['the', 'and', 'with', 'from', 'true', 'method', 'model', 'baseline']);
  return [
    ...new Set(
      matches
        .map((match) => match.toLowerCase())
        .filter((token) => token.length >= 2 && !stopWords.has(token))
    )
  ];
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

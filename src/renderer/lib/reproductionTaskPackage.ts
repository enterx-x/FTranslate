import type { ExperimentMatrixGroup, ExperimentMatrixRow, ExperimentMatrixStatus } from './experimentMatrix';
import type { MethodCard, MethodCardField } from './methodCards';
import type { PaperToCodeMappingResult } from './paperToCodeMapping';
import type { ReproductionLogDiagnosis } from './reproductionLogDiagnostics';
import type { ReproductionRunPlan, ReproductionRunPlanStep } from './reproductionRunPlan';

export interface ReproductionTaskPackage {
  id: string;
  projectId: string;
  repositoryId: string;
  methodCardId: string;
  diagnosisId: string;
  runPlanId: string;
  createdAt: string;
  status: ReproductionRunPlan['status'];
  executionPolicy: ReproductionRunPlan['executionPolicy'];
  timeboxMinutes: number;
  summary: string;
  qualityGate: ReproductionTaskQualityGate;
  handoffChecklist: ReproductionTaskChecklistItem[];
  nextAction: ReproductionTaskNextAction;
  linkedExperimentRows: ReproductionTaskExperimentRow[];
}

export interface ReproductionTaskQualityGate {
  passed: boolean;
  requiredEvidence: ReproductionTaskEvidenceKey[];
  missingEvidence: ReproductionTaskEvidenceKey[];
}

export interface ReproductionTaskChecklistItem {
  id: ReproductionTaskEvidenceKey;
  label: string;
  status: 'done' | 'blocked' | 'todo';
  evidence: string[];
}

export interface ReproductionTaskNextAction {
  label: string;
  stepId: string;
  command: string;
  commandKind: ReproductionRunPlanStep['commandKind'];
  requiresUserConfirmation: boolean;
  blockedByIssueIds: string[];
  evidence: string[];
}

export interface ReproductionTaskExperimentRow {
  experimentRowId: string;
  group: ExperimentMatrixGroup;
  status: ExperimentMatrixStatus;
  reason: string;
  evidence: string[];
}

type ReproductionTaskEvidenceKey =
  | 'method-card'
  | 'paper-to-code-mapping'
  | 'reproduction-diagnosis'
  | 'manual-run-plan'
  | 'experiment-matrix';

const REQUIRED_EVIDENCE: ReproductionTaskEvidenceKey[] = [
  'method-card',
  'paper-to-code-mapping',
  'reproduction-diagnosis',
  'manual-run-plan',
  'experiment-matrix'
];

const DEFAULT_TIMEBOX_MINUTES = 15;

export function buildReproductionTaskPackage(input: {
  projectId: string;
  methodCard: MethodCard;
  experimentRows: ExperimentMatrixRow[];
  mapping: PaperToCodeMappingResult;
  diagnosis: ReproductionLogDiagnosis;
  runPlan: ReproductionRunPlan;
  now: string;
  timeboxMinutes?: number;
}): ReproductionTaskPackage {
  const qualityGate = buildQualityGate(input);
  const linkedExperimentRows = buildLinkedExperimentRows(input);

  return {
    id: `${input.projectId}:reproduction-task:${hashString(
      `${input.methodCard.id}|${input.mapping.repositoryId}|${input.runPlan.id}|${input.now}`
    )}`,
    projectId: input.projectId,
    repositoryId: input.mapping.repositoryId,
    methodCardId: input.methodCard.id,
    diagnosisId: input.diagnosis.id,
    runPlanId: input.runPlan.id,
    createdAt: input.now,
    status: input.runPlan.status,
    executionPolicy: input.runPlan.executionPolicy,
    timeboxMinutes: input.timeboxMinutes ?? DEFAULT_TIMEBOX_MINUTES,
    summary: buildSummary(input.runPlan, qualityGate),
    qualityGate,
    handoffChecklist: buildChecklist(input),
    nextAction: buildNextAction(input.runPlan),
    linkedExperimentRows
  };
}

export function renderReproductionTaskPackageMarkdown(taskPackage: ReproductionTaskPackage): string {
  return [
    `# ${taskPackage.timeboxMinutes}-minute reproduction task package`,
    '',
    `- Status: ${taskPackage.status}`,
    '- Execution policy: Manual only',
    `- Quality gate: ${taskPackage.qualityGate.passed ? 'passed' : 'failed'}`,
    `- Repository ID: ${taskPackage.repositoryId}`,
    `- Method card ID: ${taskPackage.methodCardId}`,
    '',
    taskPackage.summary,
    '',
    '## Next Action',
    '',
    `- Label: ${taskPackage.nextAction.label}`,
    `- Command kind: ${taskPackage.nextAction.commandKind}`,
    `- Requires confirmation: ${taskPackage.nextAction.requiresUserConfirmation ? 'yes' : 'no'}`,
    `- Blocked by: ${taskPackage.nextAction.blockedByIssueIds.join(', ') || 'none'}`,
    `- Evidence: ${taskPackage.nextAction.evidence.join(', ') || 'none'}`,
    '',
    taskPackage.nextAction.command ? '```bash' : '',
    taskPackage.nextAction.command,
    taskPackage.nextAction.command ? '```' : '',
    '',
    '## Paper-to-Code',
    '',
    ...taskPackage.handoffChecklist.map(
      (item) => `- ${item.id}: ${item.status}; evidence ${item.evidence.join(', ') || 'none'}`
    ),
    '',
    '## Experiment Matrix',
    '',
    ...taskPackage.linkedExperimentRows.map(
      (row) =>
        `- ${row.experimentRowId}: ${row.group}; status ${row.status}; ${row.reason}; evidence ${row.evidence.join(', ') || 'none'}`
    ),
    '',
    '## Quality Gate',
    '',
    `- Required evidence: ${taskPackage.qualityGate.requiredEvidence.join(', ')}`,
    `- Missing evidence: ${taskPackage.qualityGate.missingEvidence.join(', ') || 'none'}`,
    '',
    '## Safety',
    '',
    '- FTranslate does not run repository code or package managers from this package.',
    '- Commands are generated for manual review, copy, and execution only.',
    '- Resolve blocked checklist items before treating any experiment row as runnable.',
    ''
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

function buildQualityGate(input: {
  methodCard: MethodCard;
  experimentRows: ExperimentMatrixRow[];
  mapping: PaperToCodeMappingResult;
  diagnosis: ReproductionLogDiagnosis;
  runPlan: ReproductionRunPlan;
}): ReproductionTaskQualityGate {
  const evidenceState: Record<ReproductionTaskEvidenceKey, boolean> = {
    'method-card': hasGroundedMethodFields(input.methodCard.fields),
    'paper-to-code-mapping':
      input.mapping.methodCardId === input.methodCard.id &&
      input.mapping.rows.length > 0 &&
      input.mapping.coverage.mappedConceptCount > 0,
    'reproduction-diagnosis': Boolean(input.diagnosis.id) && input.diagnosis.repositoryId === input.mapping.repositoryId,
    'manual-run-plan':
      input.runPlan.repositoryId === input.mapping.repositoryId &&
      input.runPlan.executionPolicy === 'manual-only' &&
      input.runPlan.steps.length > 0,
    'experiment-matrix': input.experimentRows.some((row) => row.methodCardId === input.methodCard.id)
  };
  const missingEvidence = REQUIRED_EVIDENCE.filter((key) => !evidenceState[key]);

  return {
    passed: missingEvidence.length === 0,
    requiredEvidence: REQUIRED_EVIDENCE,
    missingEvidence
  };
}

function buildChecklist(input: {
  methodCard: MethodCard;
  experimentRows: ExperimentMatrixRow[];
  mapping: PaperToCodeMappingResult;
  diagnosis: ReproductionLogDiagnosis;
  runPlan: ReproductionRunPlan;
}): ReproductionTaskChecklistItem[] {
  const linkedRows = input.experimentRows.filter((row) => row.methodCardId === input.methodCard.id);

  const items: ReproductionTaskChecklistItem[] = [
    {
      id: 'method-card',
      label: 'Grounded method card fields',
      status: hasGroundedMethodFields(input.methodCard.fields) ? 'done' : 'todo',
      evidence: input.methodCard.fields
        .filter(isGroundedField)
        .map((field) => `${field.key}:${field.evidenceSourceIds.join('|')}`)
    },
    {
      id: 'paper-to-code-mapping',
      label: 'Paper method fields mapped to code evidence',
      status: input.mapping.rows.length > 0 ? 'done' : 'todo',
      evidence: input.mapping.rows.map((row) => row.codeEvidencePath)
    },
    {
      id: 'reproduction-diagnosis',
      label: 'Latest reproduction log diagnosis',
      status: input.diagnosis.id ? 'done' : 'todo',
      evidence: input.diagnosis.issues.flatMap((issue) => [
        issue.id,
        ...issue.relatedFiles,
        ...issue.relatedManifests,
        ...issue.evidenceLines.map((line) => `log:${line.lineNumber}`)
      ])
    },
    {
      id: 'manual-run-plan',
      label: 'Manual-only run plan',
      status: input.runPlan.status === 'blocked' ? 'blocked' : input.runPlan.steps.length > 0 ? 'done' : 'todo',
      evidence: input.runPlan.steps.flatMap((step) => step.evidence)
    },
    {
      id: 'experiment-matrix',
      label: 'Experiment rows linked to the method card',
      status: linkedRows.length > 0 ? 'done' : 'todo',
      evidence: linkedRows.flatMap((row) => [row.id, ...row.evidenceLocators])
    }
  ];

  return items.map((item) => ({ ...item, evidence: uniqueStrings(item.evidence) }));
}

function buildNextAction(runPlan: ReproductionRunPlan): ReproductionTaskNextAction {
  const firstBlockedStep =
    runPlan.steps.find((step) => step.blockedByIssueIds.length > 0 && step.commandKind !== 'repo-execution') ??
    runPlan.steps.find((step) => step.blockedByIssueIds.length > 0) ??
    runPlan.steps[0];

  if (!firstBlockedStep) {
    return {
      label: 'Review repository README and create a manual smoke-test command',
      stepId: '',
      command: '',
      commandKind: 'none',
      requiresUserConfirmation: true,
      blockedByIssueIds: [],
      evidence: []
    };
  }

  return {
    label: firstBlockedStep.title,
    stepId: firstBlockedStep.id,
    command: firstBlockedStep.command,
    commandKind: firstBlockedStep.commandKind,
    requiresUserConfirmation: firstBlockedStep.requiresUserConfirmation,
    blockedByIssueIds: firstBlockedStep.blockedByIssueIds,
    evidence: firstBlockedStep.evidence
  };
}

function buildLinkedExperimentRows(input: {
  methodCard: MethodCard;
  experimentRows: ExperimentMatrixRow[];
  mapping: PaperToCodeMappingResult;
  diagnosis: ReproductionLogDiagnosis;
  runPlan: ReproductionRunPlan;
}): ReproductionTaskExperimentRow[] {
  const blocker = input.diagnosis.issues.find((issue) => issue.severity === 'blocked');
  const sharedEvidence = uniqueStrings([
    ...input.mapping.rows.map((row) => row.codeEvidencePath),
    ...input.runPlan.steps.flatMap((step) => step.evidence)
  ]);

  return input.experimentRows
    .filter((row) => row.methodCardId === input.methodCard.id)
    .map((row) => ({
      experimentRowId: row.id,
      group: row.group,
      status: input.runPlan.status === 'blocked' ? 'blocked' : row.status,
      reason:
        input.runPlan.status === 'blocked'
          ? `Blocked until ${blocker?.title ?? 'the reproduction blocker'} is resolved.`
          : 'Ready for manual smoke-test review before full experiment execution.',
      evidence: uniqueStrings([...row.evidenceLocators, ...sharedEvidence])
    }));
}

function buildSummary(runPlan: ReproductionRunPlan, qualityGate: ReproductionTaskQualityGate): string {
  if (!qualityGate.passed) {
    return `The task package is incomplete. Missing evidence: ${qualityGate.missingEvidence.join(', ')}.`;
  }
  if (runPlan.status === 'blocked') {
    return 'The reproduction path is assembled, but the first runnable experiment is blocked by a diagnosed issue.';
  }
  if (runPlan.status === 'needs-review') {
    return 'The reproduction path needs manual review before it can become a smoke-test task.';
  }
  return 'The reproduction path is ready for a manually confirmed smoke-test.';
}

function hasGroundedMethodFields(fields: MethodCardField[]): boolean {
  return fields.some(isGroundedField);
}

function isGroundedField(field: MethodCardField): boolean {
  return Boolean(field.value.trim()) && field.evidenceSourceIds.length > 0;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

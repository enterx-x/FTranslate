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
  readinessAudit: ReproductionTaskReadinessAudit;
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

export interface ReproductionTaskReadinessAudit {
  overall: 'ready' | 'blocked' | 'incomplete' | 'needs-review';
  manualBurden: {
    confirmationCount: number;
    environmentMutatingCommandCount: number;
    repoExecutionCommandCount: number;
    readOnlyCommandCount: number;
    blockedStepCount: number;
    estimatedMinutes: number;
  };
  stages: ReproductionTaskAuditStage[];
  assumptions: string[];
  failureModes: ReproductionTaskFailureMode[];
  acceptanceCriteria: string[];
}

export interface ReproductionTaskAuditStage {
  id: ReproductionTaskEvidenceKey;
  label: string;
  status: 'verified' | 'assumption' | 'blocked' | 'missing';
  reason: string;
  evidence: string[];
  requiredAction: string;
}

export interface ReproductionTaskFailureMode {
  id: string;
  severity: 'blocking' | 'warning';
  description: string;
  evidence: string[];
  mitigation: string;
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
  const readinessAudit = buildReadinessAudit(input, qualityGate);

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
    linkedExperimentRows,
    readinessAudit
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
    '## Readiness Audit',
    '',
    `- Overall: ${taskPackage.readinessAudit.overall}`,
    `- Manual confirmations: ${taskPackage.readinessAudit.manualBurden.confirmationCount}`,
    `- Environment-mutating commands: ${taskPackage.readinessAudit.manualBurden.environmentMutatingCommandCount}`,
    `- Repository execution commands: ${taskPackage.readinessAudit.manualBurden.repoExecutionCommandCount}`,
    `- Blocked steps: ${taskPackage.readinessAudit.manualBurden.blockedStepCount}`,
    `- Estimated manual minutes: ${taskPackage.readinessAudit.manualBurden.estimatedMinutes}`,
    '',
    ...taskPackage.readinessAudit.stages.map(
      (stage) => `- ${stage.id}: ${stage.status}; ${stage.reason}; action ${stage.requiredAction}; evidence ${stage.evidence.join(', ') || 'none'}`
    ),
    '',
    '## Assumptions',
    '',
    ...(taskPackage.readinessAudit.assumptions.length > 0
      ? taskPackage.readinessAudit.assumptions.map((assumption) => `- ${assumption}`)
      : ['- none']),
    '',
    '## Failure Modes',
    '',
    ...(taskPackage.readinessAudit.failureModes.length > 0
      ? taskPackage.readinessAudit.failureModes.map(
          (failure) =>
            `- ${failure.id}: ${failure.severity}; ${failure.description}; mitigation ${failure.mitigation}; evidence ${failure.evidence.join(', ') || 'none'}`
        )
      : ['- none']),
    '',
    '## Acceptance Criteria',
    '',
    ...taskPackage.readinessAudit.acceptanceCriteria.map((criterion) => `- ${criterion}`),
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

function buildReadinessAudit(
  input: {
    methodCard: MethodCard;
    experimentRows: ExperimentMatrixRow[];
    mapping: PaperToCodeMappingResult;
    diagnosis: ReproductionLogDiagnosis;
    runPlan: ReproductionRunPlan;
  },
  qualityGate: ReproductionTaskQualityGate
): ReproductionTaskReadinessAudit {
  const stages = buildAuditStages(input, qualityGate);
  const failureModes = input.diagnosis.issues.map((issue): ReproductionTaskFailureMode => ({
    id: issue.id,
    severity: issue.severity === 'blocked' ? 'blocking' : 'warning',
    description: issue.summary,
    evidence: uniqueStrings([
      ...issue.relatedFiles,
      ...issue.relatedManifests,
      ...issue.evidenceLines.map((line) => `log:${line.lineNumber}`)
    ]),
    mitigation: issue.commandCandidates[0] || issue.nextActions[0] || 'Review the issue evidence before running the next step.'
  }));
  const manualBurden = buildManualBurden(input.runPlan);
  const assumptions = stages
    .filter((stage) => stage.status === 'assumption')
    .map((stage) => `${stage.label}: ${stage.reason}`);
  const overall = readAuditOverall(qualityGate, stages, failureModes);

  return {
    overall,
    manualBurden,
    stages,
    assumptions,
    failureModes,
    acceptanceCriteria: buildAcceptanceCriteria(input.runPlan, qualityGate)
  };
}

function buildAuditStages(
  input: {
    methodCard: MethodCard;
    experimentRows: ExperimentMatrixRow[];
    mapping: PaperToCodeMappingResult;
    diagnosis: ReproductionLogDiagnosis;
    runPlan: ReproductionRunPlan;
  },
  qualityGate: ReproductionTaskQualityGate
): ReproductionTaskAuditStage[] {
  const groundedFields = input.methodCard.fields.filter(isGroundedField);
  const unconfirmedFields = groundedFields.filter((field) => field.reviewState !== 'accepted');
  const linkedRows = input.experimentRows.filter((row) => row.methodCardId === input.methodCard.id);
  const blockedSteps = input.runPlan.steps.filter((step) => step.blockedByIssueIds.length > 0);

  const stages = [
    {
      id: 'method-card',
      label: 'Method card',
      status: readMethodCardAuditStatus(input.methodCard, groundedFields, unconfirmedFields),
      reason:
        groundedFields.length === 0
          ? 'No grounded method-card fields were found.'
          : unconfirmedFields.length > 0 || input.methodCard.status !== 'verified'
            ? `${unconfirmedFields.length || groundedFields.length} grounded field(s) remain unconfirmed.`
            : 'Grounded method-card fields have been accepted.',
      evidence: groundedFields.map((field) => `${field.key}:${field.evidenceSourceIds.join('|')}`),
      requiredAction:
        unconfirmedFields.length > 0 || input.methodCard.status !== 'verified'
          ? 'Review and accept the method-card fields before treating claims as final.'
          : 'No action required.'
    },
    {
      id: 'paper-to-code-mapping',
      label: 'Paper-to-Code mapping',
      status: readMappingAuditStatus(input.mapping, qualityGate),
      reason:
        input.mapping.rows.length === 0
          ? 'No method concepts were mapped to code evidence.'
          : input.mapping.coverage.mappedConceptCount < input.mapping.coverage.methodConceptCount
            ? `${input.mapping.coverage.mappedConceptCount}/${input.mapping.coverage.methodConceptCount} method concept(s) mapped.`
            : 'All grounded method concepts are mapped to code evidence.',
      evidence: input.mapping.rows.map((row) => row.codeEvidencePath),
      requiredAction:
        input.mapping.coverage.mappedConceptCount < input.mapping.coverage.methodConceptCount
          ? 'Inspect unmapped method fields and add code evidence before running full experiments.'
          : 'No action required.'
    },
    {
      id: 'reproduction-diagnosis',
      label: 'Reproduction diagnosis',
      status: input.diagnosis.id ? 'verified' : 'missing',
      reason:
        input.diagnosis.issues.length > 0
          ? `${input.diagnosis.issues.length} issue(s) were diagnosed from the latest log.`
          : 'No blocker was detected in the latest log.',
      evidence: input.diagnosis.issues.flatMap((issue) => issue.evidenceLines.map((line) => `log:${line.lineNumber}`)),
      requiredAction:
        input.diagnosis.issues.length > 0
          ? 'Resolve diagnosed issues before marking the reproduction task runnable.'
          : 'Keep the clean log with the task package as evidence.'
    },
    {
      id: 'manual-run-plan',
      label: 'Manual run plan',
      status:
        input.runPlan.steps.length === 0
          ? 'missing'
          : blockedSteps.length > 0
            ? 'blocked'
            : input.runPlan.executionPolicy === 'manual-only'
              ? 'verified'
              : 'assumption',
      reason:
        blockedSteps.length > 0
          ? `${blockedSteps.length} step(s) are tied to a blocked issue.`
          : input.runPlan.steps.length > 0
            ? 'Run-plan steps are generated with manual confirmation requirements.'
            : 'No run-plan steps were generated.',
      evidence: uniqueStrings(input.runPlan.steps.flatMap((step) => step.evidence)),
      requiredAction:
        blockedSteps.length > 0
          ? 'Resolve blocked issue(s) before running repository execution commands.'
          : 'Review command flags and environment before manual execution.'
    },
    {
      id: 'experiment-matrix',
      label: 'Experiment matrix',
      status:
        linkedRows.length === 0
          ? 'missing'
          : input.runPlan.status === 'blocked' || linkedRows.some((row) => row.status === 'planned')
            ? 'assumption'
            : 'verified',
      reason:
        linkedRows.length === 0
          ? 'No experiment rows are linked to this method card.'
          : input.runPlan.status === 'blocked'
            ? 'Experiment rows exist but are not runnable until the reproduction blocker is resolved.'
            : 'Experiment rows are linked and can be reviewed for execution.',
      evidence: linkedRows.flatMap((row) => [row.id, ...row.evidenceLocators]),
      requiredAction:
        linkedRows.length === 0
          ? 'Generate or attach experiment rows before running the task.'
          : 'Keep rows blocked until the smoke-test evidence is collected.'
    }
  ] satisfies ReproductionTaskAuditStage[];

  return stages.map((stage) => ({ ...stage, evidence: uniqueStrings(stage.evidence) }));
}

function buildManualBurden(runPlan: ReproductionRunPlan): ReproductionTaskReadinessAudit['manualBurden'] {
  const confirmationCount = runPlan.steps.filter((step) => step.requiresUserConfirmation).length;
  const environmentMutatingCommandCount = runPlan.steps.filter((step) => step.commandKind === 'environment-mutating').length;
  const repoExecutionCommandCount = runPlan.steps.filter((step) => step.commandKind === 'repo-execution').length;
  const readOnlyCommandCount = runPlan.steps.filter((step) => step.commandKind === 'read-only').length;
  const blockedStepCount = runPlan.steps.filter((step) => step.blockedByIssueIds.length > 0).length;

  return {
    confirmationCount,
    environmentMutatingCommandCount,
    repoExecutionCommandCount,
    readOnlyCommandCount,
    blockedStepCount,
    estimatedMinutes: 5 + confirmationCount * 3 + environmentMutatingCommandCount * 4 + repoExecutionCommandCount * 6
  };
}

function readAuditOverall(
  qualityGate: ReproductionTaskQualityGate,
  stages: ReproductionTaskAuditStage[],
  failureModes: ReproductionTaskFailureMode[]
): ReproductionTaskReadinessAudit['overall'] {
  if (!qualityGate.passed || stages.some((stage) => stage.status === 'missing')) {
    return 'incomplete';
  }
  if (stages.some((stage) => stage.status === 'blocked') || failureModes.some((failure) => failure.severity === 'blocking')) {
    return 'blocked';
  }
  if (stages.some((stage) => stage.status === 'assumption')) {
    return 'needs-review';
  }
  return 'ready';
}

function readMethodCardAuditStatus(
  methodCard: MethodCard,
  groundedFields: MethodCardField[],
  unconfirmedFields: MethodCardField[]
): ReproductionTaskAuditStage['status'] {
  if (groundedFields.length === 0) {
    return 'missing';
  }
  if (unconfirmedFields.length > 0 || methodCard.status !== 'verified') {
    return 'assumption';
  }
  return 'verified';
}

function readMappingAuditStatus(
  mapping: PaperToCodeMappingResult,
  qualityGate: ReproductionTaskQualityGate
): ReproductionTaskAuditStage['status'] {
  if (qualityGate.missingEvidence.includes('paper-to-code-mapping')) {
    return 'missing';
  }
  return mapping.coverage.mappedConceptCount >= mapping.coverage.methodConceptCount ? 'verified' : 'assumption';
}

function buildAcceptanceCriteria(
  runPlan: ReproductionRunPlan,
  qualityGate: ReproductionTaskQualityGate
): string[] {
  const criteria = [
    'Resolve all blocked run-plan steps before treating linked experiment rows as runnable.',
    'Run the smoke-test command manually only after environment-mutating steps are reviewed.',
    'Attach the resulting command output or failure log back to the task package.'
  ];

  if (!qualityGate.passed) {
    criteria.unshift(`Fill missing evidence before execution: ${qualityGate.missingEvidence.join(', ')}.`);
  }
  if (runPlan.executionPolicy !== 'manual-only') {
    criteria.unshift('Reset execution policy to manual-only before exposing commands to users.');
  }

  return criteria;
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

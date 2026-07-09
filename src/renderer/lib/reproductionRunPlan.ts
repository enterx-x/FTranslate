import type { CodeRepositoryRecord } from './codeRepositories';
import type { ReproductionLogDiagnosis, ReproductionLogIssue } from './reproductionLogDiagnostics';

export interface ReproductionRunPlan {
  id: string;
  repositoryId: string;
  diagnosisId: string;
  createdAt: string;
  status: 'ready' | 'blocked' | 'needs-review';
  executionPolicy: 'manual-only';
  summary: string;
  steps: ReproductionRunPlanStep[];
}

export interface ReproductionRunPlanStep {
  id: string;
  order: number;
  phase: 'prepare-environment' | 'inspect-repository' | 'run-smoke-test';
  title: string;
  rationale: string;
  command: string;
  commandKind: 'read-only' | 'environment-mutating' | 'repo-execution' | 'none';
  requiresUserConfirmation: boolean;
  evidence: string[];
  blockedByIssueIds: string[];
}

export function buildReproductionRunPlan(input: {
  repository: CodeRepositoryRecord;
  diagnosis: ReproductionLogDiagnosis;
  now: string;
}): ReproductionRunPlan {
  const blockingIssueIds = input.diagnosis.issues
    .filter((issue) => issue.severity === 'blocked')
    .map((issue) => issue.id);
  const repairSteps = buildRepairSteps(input.diagnosis.issues);
  const smokeStep = buildSmokeStep(input.repository, repairSteps.length + 1, blockingIssueIds);
  const steps = [...repairSteps, ...(smokeStep ? [smokeStep] : [])];

  return {
    id: `${input.repository.id}:run-plan:${hashString(`${input.diagnosis.id}|${input.now}`)}`,
    repositoryId: input.repository.id,
    diagnosisId: input.diagnosis.id,
    createdAt: input.now,
    status: readPlanStatus(input.diagnosis, smokeStep),
    executionPolicy: 'manual-only',
    summary: buildSummary(input.diagnosis, smokeStep),
    steps
  };
}

export function renderReproductionRunPlanMarkdown(plan: ReproductionRunPlan): string {
  return [
    '# Reproduction Run Plan',
    '',
    `- Status: ${plan.status}`,
    `- Execution policy: Manual only`,
    `- Repository ID: ${plan.repositoryId}`,
    `- Diagnosis ID: ${plan.diagnosisId}`,
    '',
    plan.summary,
    '',
    '## Steps',
    '',
    ...plan.steps.flatMap((step) => [
      `### ${step.order}. ${step.title}`,
      '',
      `- Phase: ${step.phase}`,
      `- Command kind: ${step.commandKind}`,
      `- Requires confirmation: ${step.requiresUserConfirmation ? 'yes' : 'no'}`,
      `- Blocked by: ${step.blockedByIssueIds.join(', ') || 'none'}`,
      `- Evidence: ${step.evidence.join(', ') || 'none'}`,
      '',
      step.command ? '```bash' : '',
      step.command,
      step.command ? '```' : '',
      '',
      step.rationale,
      ''
    ]),
    '## Safety',
    '',
    '- This plan is generated for review and copy/paste execution only.',
    '- FTranslate does not run repository code, package managers, shells, or notebooks from this plan.',
    '- Verify the active Python/conda environment and command-line flags before running any command.',
    ''
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

function buildRepairSteps(issues: ReproductionLogIssue[]): ReproductionRunPlanStep[] {
  return issues
    .flatMap((issue) =>
      issue.commandCandidates.map((command): Omit<ReproductionRunPlanStep, 'order'> => ({
        id: `repair:${issue.id}:${hashString(command)}`,
        phase: command.includes('pip install') || command.includes('conda env')
          ? 'prepare-environment'
          : 'inspect-repository',
        title: `Resolve blocker: ${issue.title}`,
        rationale: issue.nextActions.join(' '),
        command,
        commandKind: readCommandKind(command),
        requiresUserConfirmation: true,
        evidence: uniqueStrings([
          ...issue.relatedManifests,
          ...issue.relatedFiles,
          ...issue.evidenceLines.map((line) => `log:${line.lineNumber}`)
        ]),
        blockedByIssueIds: [issue.id]
      }))
    )
    .map((step, index) => ({ ...step, order: index + 1 }));
}

function buildSmokeStep(
  repository: CodeRepositoryRecord,
  order: number,
  blockedByIssueIds: string[]
): ReproductionRunPlanStep | null {
  const entryPoint = selectEntryPoint(repository.entryPoints);
  if (!entryPoint) return null;
  const configFile = repository.configFiles[0]?.filePath ?? '';
  const command = withConfigCandidate(entryPoint.commandCandidate, configFile);

  return {
    id: `smoke:${hashString(`${entryPoint.filePath}|${command}`)}`,
    order,
    phase: 'run-smoke-test',
    title: `Run smoke-test candidate: ${entryPoint.filePath}`,
    rationale:
      blockedByIssueIds.length > 0
        ? 'Run this only after the listed blockers are resolved and the command-line flags are confirmed.'
        : 'Use this as the first small reproduction command before attempting full training or evaluation.',
    command,
    commandKind: 'repo-execution',
    requiresUserConfirmation: true,
    evidence: uniqueStrings([entryPoint.filePath, configFile]),
    blockedByIssueIds
  };
}

function selectEntryPoint(entryPoints: CodeRepositoryRecord['entryPoints']): CodeRepositoryRecord['entryPoints'][number] | null {
  const priority = new Map([
    ['test', 5],
    ['eval', 4],
    ['main', 3],
    ['train', 2],
    ['script', 1],
    ['notebook', 0]
  ]);
  return [...entryPoints].sort((left, right) => (priority.get(right.kind) ?? 0) - (priority.get(left.kind) ?? 0))[0] ?? null;
}

function withConfigCandidate(command: string, configFile: string): string {
  if (!configFile || /\s--config(?:\s|=)/u.test(command)) return command;
  if (!/^python\s+/u.test(command)) return command;
  return `${command} --config ${configFile}`;
}

function readCommandKind(command: string): ReproductionRunPlanStep['commandKind'] {
  if (!command) return 'none';
  if (/pip\s+install|conda\s+env\s+(?:update|create|install)|npm\s+install/u.test(command)) {
    return 'environment-mutating';
  }
  if (/^(?:python|node|npx|jupyter|bash|sh|powershell)\s+/u.test(command)) {
    return 'repo-execution';
  }
  return 'read-only';
}

function readPlanStatus(
  diagnosis: ReproductionLogDiagnosis,
  smokeStep: ReproductionRunPlanStep | null
): ReproductionRunPlan['status'] {
  if (diagnosis.status === 'blocked') return 'blocked';
  return smokeStep ? 'ready' : 'needs-review';
}

function buildSummary(diagnosis: ReproductionLogDiagnosis, smokeStep: ReproductionRunPlanStep | null): string {
  if (diagnosis.status === 'blocked') {
    return `Diagnosis contains ${diagnosis.issues.length} issue(s). Resolve blockers before running the smoke-test candidate.`;
  }
  if (!smokeStep) {
    return 'No runnable entry point was detected. Review README and scripts before creating a manual smoke-test command.';
  }
  return 'No blocker was found in the latest diagnosis. Review the generated smoke-test candidate before running it manually.';
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

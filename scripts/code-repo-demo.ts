import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { scanCodeRepository } from '../src/main/codeRepositoryScanner';
import { buildCodeRepositoryRecord } from '../src/renderer/lib/codeRepositories';
import { buildExperimentMatrixRowsFromMethodCard } from '../src/renderer/lib/experimentMatrix';
import { buildPaperToCodeMapping } from '../src/renderer/lib/paperToCodeMapping';
import { diagnoseReproductionLog } from '../src/renderer/lib/reproductionLogDiagnostics';
import { buildReproductionRunPlan, renderReproductionRunPlanMarkdown } from '../src/renderer/lib/reproductionRunPlan';
import { buildReproductionTaskPackage, renderReproductionTaskPackageMarkdown } from '../src/renderer/lib/reproductionTaskPackage';
import type { MethodCard } from '../src/renderer/lib/methodCards';
import { buildDefaultResearchProject, linkCodeRepositoryPath } from '../src/renderer/lib/researchProjects';

const repoRoot = path.resolve(__dirname, '..', '..');
const fixtureDir = path.resolve(repoRoot, '.tmp-code-repo-demo', 'fixture');
const outputDir = path.resolve(repoRoot, 'demo-output', 'code-repository');
const now = '2026-07-01T00:00:00.000Z';
const projectId = 'local-ai-rd-workspace';

async function main(): Promise<void> {
  assertPathInsideRepo(fixtureDir);
  assertPathInsideRepo(outputDir);

  await createFixtureRepository();
  const scan = await scanCodeRepository({ rootPath: fixtureDir, now });
  const repository = buildCodeRepositoryRecord({ projectId, scan });
  const project = linkCodeRepositoryPath(buildDefaultResearchProject([], Date.parse(now)), scan.rootPath, now);
  const methodCard = createDemoMethodCard();
  const experimentRows = buildExperimentMatrixRowsFromMethodCard(methodCard);
  const mapping = buildPaperToCodeMapping({
    methodCard,
    repository
  });
  const reproductionDiagnosis = diagnoseReproductionLog({
    repository,
    now,
    logText: createDemoFailureLog()
  });
  const reproductionRunPlan = buildReproductionRunPlan({
    repository,
    diagnosis: reproductionDiagnosis,
    now
  });
  const reproductionTaskPackage = buildReproductionTaskPackage({
    projectId,
    methodCard,
    experimentRows,
    mapping,
    diagnosis: reproductionDiagnosis,
    runPlan: reproductionRunPlan,
    now
  });

  const artifacts = {
    'repository-scan.json': `${JSON.stringify(scan, null, 2)}\n`,
    'repository-summary.md': `${buildRepositorySummary({
      project,
      repository,
      scan,
      mapping,
      reproductionDiagnosis,
      reproductionRunPlan,
      reproductionTaskPackage
    })}\n`,
    'paper-to-code-mapping.json': `${JSON.stringify(mapping, null, 2)}\n`,
    'reproduction-diagnosis.json': `${JSON.stringify(reproductionDiagnosis, null, 2)}\n`,
    'reproduction-run-plan.json': `${JSON.stringify(reproductionRunPlan, null, 2)}\n`,
    'reproduction-run-plan.md': `${renderReproductionRunPlanMarkdown(reproductionRunPlan)}\n`,
    'reproduction-task-package.json': `${JSON.stringify(reproductionTaskPackage, null, 2)}\n`,
    'reproduction-task-package.md': `${renderReproductionTaskPackageMarkdown(reproductionTaskPackage)}\n`
  };

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all(
    Object.entries(artifacts).map(([fileName, content]) =>
      fs.writeFile(path.join(outputDir, fileName), content, 'utf8')
    )
  );

  console.log(`FTranslate code repository demo wrote ${Object.keys(artifacts).length} files to ${path.relative(repoRoot, outputDir)}`);
  console.log(
    JSON.stringify(
      {
        repositoryId: repository.id,
        manifestCount: repository.manifests.length,
        entryPointCount: repository.entryPoints.length,
        configFileCount: repository.configFiles.length,
        mappedConceptCount: mapping.coverage.mappedConceptCount,
        diagnosisIssueCount: reproductionDiagnosis.issues.length,
        diagnosisStatus: reproductionDiagnosis.status,
        runPlanStepCount: reproductionRunPlan.steps.length,
        runPlanStatus: reproductionRunPlan.status,
        taskPackageStatus: reproductionTaskPackage.status,
        taskPackageQualityPassed: reproductionTaskPackage.qualityGate.passed,
        taskPackageChecklistCount: reproductionTaskPackage.handoffChecklist.length,
        qualityPassed: evaluateDemo(repository, mapping, reproductionDiagnosis, reproductionRunPlan, reproductionTaskPackage)
      },
      null,
      2
    )
  );

  if (!evaluateDemo(repository, mapping, reproductionDiagnosis, reproductionRunPlan, reproductionTaskPackage)) {
    process.exitCode = 1;
  }
}

async function createFixtureRepository(): Promise<void> {
  await fs.rm(fixtureDir, { recursive: true, force: true });
  await fs.mkdir(path.join(fixtureDir, 'configs'), { recursive: true });
  await fs.mkdir(path.join(fixtureDir, 'src'), { recursive: true });
  await fs.mkdir(path.join(fixtureDir, 'node_modules'), { recursive: true });

  await fs.writeFile(
    path.join(fixtureDir, 'README.md'),
    [
      '# Safe RL Navigation',
      '',
      'Smoke test candidate:',
      '',
      '```bash',
      'python train_ppo.py --config configs/cbf_navigation.yaml --steps 1000',
      '```',
      ''
    ].join('\n'),
    'utf8'
  );
  await fs.writeFile(
    path.join(fixtureDir, 'requirements.txt'),
    ['torch==2.2.0', 'gymnasium==0.29.1', 'numpy==1.26.4', 'osqp==0.6.5', ''].join('\n'),
    'utf8'
  );
  await fs.writeFile(
    path.join(fixtureDir, 'train_ppo.py'),
    [
      'import argparse',
      '',
      'def main():',
      '    parser = argparse.ArgumentParser()',
      '    parser.add_argument("--config")',
      '    parser.add_argument("--steps", type=int, default=1000)',
      '    parser.parse_args()',
      '    print("train PPO with CBF safety filter")',
      '',
      'if __name__ == "__main__":',
      '    main()',
      ''
    ].join('\n'),
    'utf8'
  );
  await fs.writeFile(
    path.join(fixtureDir, 'configs', 'cbf_navigation.yaml'),
    ['algorithm: PPO', 'safety_layer: CBF', 'metric: collision_rate', ''].join('\n'),
    'utf8'
  );
  await fs.writeFile(path.join(fixtureDir, 'node_modules', 'ignored.js'), 'ignored', 'utf8');
}

function createDemoFailureLog(): string {
  return [
    'Traceback (most recent call last):',
    '  File "D:/demo/safe-rl/train_ppo.py", line 1, in <module>',
    '    import gymnasium',
    "ModuleNotFoundError: No module named 'gymnasium'"
  ].join('\n');
}

function createDemoMethodCard(): MethodCard {
  return {
    id: 'method-card-safe-rl-demo',
    projectId,
    paperId: 'demo-paper-safe-rl-navigation',
    title: 'Safe RL Navigation Demo',
    status: 'needs-review',
    createdAt: now,
    updatedAt: now,
    version: 1,
    evidenceSources: [],
    fields: [
      {
        key: 'baseline',
        label: 'Baseline',
        value: 'PPO baseline',
        confidence: 0.82,
        evidenceSourceIds: ['evidence-baseline'],
        reviewState: 'unconfirmed'
      },
      {
        key: 'constraints',
        label: 'Constraints',
        value: 'CBF safety constraints',
        confidence: 0.84,
        evidenceSourceIds: ['evidence-constraints'],
        reviewState: 'unconfirmed'
      },
      {
        key: 'metrics',
        label: 'Evaluation Metrics',
        value: 'collision rate and success rate',
        confidence: 0.76,
        evidenceSourceIds: ['evidence-metrics'],
        reviewState: 'unconfirmed'
      }
    ]
  };
}

function buildRepositorySummary(input: {
  project: ReturnType<typeof buildDefaultResearchProject>;
  repository: ReturnType<typeof buildCodeRepositoryRecord>;
  scan: Awaited<ReturnType<typeof scanCodeRepository>>;
  mapping: ReturnType<typeof buildPaperToCodeMapping>;
  reproductionDiagnosis: ReturnType<typeof diagnoseReproductionLog>;
  reproductionRunPlan: ReturnType<typeof buildReproductionRunPlan>;
  reproductionTaskPackage: ReturnType<typeof buildReproductionTaskPackage>;
}): string {
  return [
    '# FTranslate Paper-to-Code Demo',
    '',
    'Run this demo from the repository root:',
    '',
    '```bash',
    'npm run demo:code-repo',
    '```',
    '',
    '## Repository Scan',
    '',
    `- Repository: ${input.repository.rootPath}`,
    `- Files scanned: ${input.scan.files.length}`,
    `- Manifests: ${input.repository.manifests.map((item) => item.fileName).join(', ') || 'none'}`,
    `- Entry points: ${input.repository.entryPoints.map((item) => item.commandCandidate).join(', ') || 'none'}`,
    `- Config files: ${input.repository.configFiles.map((item) => item.filePath).join(', ') || 'none'}`,
    `- Tech stack: ${input.repository.techStack.join(', ') || 'unknown'}`,
    `- Linked project paths: ${input.project.codeRepositoryPaths.length}`,
    '',
    '## Paper-to-Code Mapping',
    '',
    ...input.mapping.rows.map(
      (row) => `- ${row.methodFieldKey}: ${row.concept} -> ${row.codeEvidencePath} (${row.evidenceType}, ${row.confidence})`
    ),
    '',
    '## Reproduction Failure Diagnosis',
    '',
    `- Status: ${input.reproductionDiagnosis.status}`,
    `- Issues: ${input.reproductionDiagnosis.issues.length}`,
    ...input.reproductionDiagnosis.issues.map(
      (issue) =>
        `- ${issue.kind}: ${issue.title}; evidence line ${issue.evidenceLines
          .map((line) => line.lineNumber)
          .join(', ')}; files ${issue.relatedFiles.join(', ') || 'none'}`
    ),
    '',
    '## Reproduction Run Plan',
    '',
    `- Status: ${input.reproductionRunPlan.status}`,
    `- Execution policy: ${input.reproductionRunPlan.executionPolicy}`,
    `- Steps: ${input.reproductionRunPlan.steps.length}`,
    ...input.reproductionRunPlan.steps.map(
      (step) =>
        `- ${step.order}. ${step.phase}: ${step.command || 'no command'}; blocked by ${
          step.blockedByIssueIds.join(', ') || 'none'
        }`
    ),
    '',
    '## Reproduction Task Package',
    '',
    `- Status: ${input.reproductionTaskPackage.status}`,
    `- Timebox: ${input.reproductionTaskPackage.timeboxMinutes} minutes`,
    `- Quality gate: ${input.reproductionTaskPackage.qualityGate.passed ? 'passed' : 'failed'}`,
    `- Next action: ${input.reproductionTaskPackage.nextAction.label}`,
    `- Next command kind: ${input.reproductionTaskPackage.nextAction.commandKind}`,
    `- Linked experiment rows: ${input.reproductionTaskPackage.linkedExperimentRows.length}`,
    ...input.reproductionTaskPackage.linkedExperimentRows.map(
      (row) => `- ${row.experimentRowId}: ${row.group}; status ${row.status}; evidence ${row.evidence.join(', ')}`
    ),
    '',
    '## Safety',
    '',
    '- The demo only reads text files from a generated fixture repository.',
    '- The diagnosis consumes a static sample log and only returns structured suggestions.',
    '- The run plan is manual-only and never executes generated commands.',
    '- The task package is a handoff object; it does not run commands or mutate the fixture repository.',
    '- It does not run python, pip, conda, npm, shell scripts or notebooks.',
    ''
  ].join('\n');
}

function evaluateDemo(
  repository: ReturnType<typeof buildCodeRepositoryRecord>,
  mapping: ReturnType<typeof buildPaperToCodeMapping>,
  reproductionDiagnosis: ReturnType<typeof diagnoseReproductionLog>,
  reproductionRunPlan: ReturnType<typeof buildReproductionRunPlan>,
  reproductionTaskPackage: ReturnType<typeof buildReproductionTaskPackage>
): boolean {
  return (
    repository.manifests.length >= 1 &&
    repository.entryPoints.length >= 1 &&
    repository.configFiles.length >= 1 &&
    mapping.coverage.mappedConceptCount >= 2 &&
    reproductionDiagnosis.status === 'blocked' &&
    reproductionDiagnosis.issues.length >= 1 &&
    reproductionRunPlan.status === 'blocked' &&
    reproductionRunPlan.executionPolicy === 'manual-only' &&
    reproductionRunPlan.steps.length >= 2 &&
    reproductionTaskPackage.status === 'blocked' &&
    reproductionTaskPackage.executionPolicy === 'manual-only' &&
    reproductionTaskPackage.qualityGate.passed &&
    reproductionTaskPackage.linkedExperimentRows.length >= 2 &&
    reproductionTaskPackage.nextAction.requiresUserConfirmation
  );
}

function assertPathInsideRepo(targetPath: string): void {
  const relative = path.relative(repoRoot, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write demo output outside repository root: ${targetPath}`);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

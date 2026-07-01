import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  buildResearchLoopDemo,
  buildResearchLoopDemoArtifacts,
  buildResearchLoopDemoSummary,
  createDefaultResearchLoopDemoInput
} from '../src/renderer/lib/researchLoopDemo';

const repoRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.resolve(repoRoot, 'demo-output', 'research-loop');

async function main(): Promise<void> {
  assertPathInsideRepo(outputDir);

  const result = buildResearchLoopDemo(createDefaultResearchLoopDemoInput());
  const artifacts = buildResearchLoopDemoArtifacts(result);
  await fs.mkdir(outputDir, { recursive: true });

  await Promise.all(
    Object.entries(artifacts).map(([fileName, content]) =>
      fs.writeFile(path.join(outputDir, fileName), content, 'utf8')
    )
  );

  const summary = buildResearchLoopDemoSummary(result);
  const relativeOutputDir = path.relative(repoRoot, outputDir);
  console.log(`FTranslate research loop demo wrote ${Object.keys(artifacts).length} files to ${relativeOutputDir}`);
  console.log(
    JSON.stringify(
      {
        projectId: summary.projectId,
        paperId: summary.paperId,
        groundedFieldCount: summary.groundedFieldCount,
        evidenceSourceCount: summary.evidenceSourceCount,
        experimentRowCount: summary.experimentRowCount,
        experimentGroups: summary.experimentGroups,
        qualityPassed: summary.qualityPassed
      },
      null,
      2
    )
  );

  if (!result.qualityGate.passed) {
    process.exitCode = 1;
  }
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

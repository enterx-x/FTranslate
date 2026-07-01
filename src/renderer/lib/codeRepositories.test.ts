import { describe, expect, it } from 'vitest';
import { parseCodeRepositories, serializeCodeRepositories } from './codeRepositories';

describe('codeRepositories storage', () => {
  it('round-trips repository records and drops invalid entries', () => {
    const serialized = serializeCodeRepositories([
      {
        id: 'repo-1',
        projectId: 'local-ai-rd-workspace',
        rootPath: 'D:\\repo',
        scannedAt: '2026-07-01T00:00:00.000Z',
        techStack: ['python', 'pytorch'],
        manifests: [],
        entryPoints: [],
        configFiles: [],
        risks: []
      }
    ]);

    expect(parseCodeRepositories(serialized)).toHaveLength(1);
    expect(parseCodeRepositories('[{"id":""}]')).toEqual([]);
  });

  it('normalizes optional arrays to safe defaults', () => {
    expect(
      parseCodeRepositories(
        JSON.stringify([
          {
            id: 'repo-1',
            projectId: 'project-1',
            rootPath: 'D:\\repo',
            scannedAt: '2026-07-01T00:00:00.000Z',
            techStack: 'python',
            risks: ['large checkpoint ignored']
          }
        ])
      )
    ).toEqual([
      {
        id: 'repo-1',
        projectId: 'project-1',
        rootPath: 'D:\\repo',
        scannedAt: '2026-07-01T00:00:00.000Z',
        techStack: [],
        manifests: [],
        entryPoints: [],
        configFiles: [],
        risks: ['large checkpoint ignored']
      }
    ]);
  });
});

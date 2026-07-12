import { describe, expect, it } from 'vitest';
import { createDefaultScientificPlotSpec } from '../../../shared/scientificPlot';
import { registerScientificPlotIpcHandlers } from './scientificPlot';

describe('scientific plot IPC boundary', () => {
  it('rejects traversal ids and invalid plot tables before calling services', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    let calls = 0;
    const noop = () => { calls += 1; return null; };
    registerScientificPlotIpcHandlers({ handle: (channel, listener) => listeners.set(channel, listener) }, {
      listProjects: noop, createProject: noop, loadProject: noop, saveSpec: noop,
      selectDataFile: noop, readDataFile: noop, detectRuntimes: noop, readInstallerIntent: noop,
      startRuntimeInstall: noop, getRuntimeInstallJob: noop, cancelRuntimeInstall: noop,
      removeManagedRuntime: noop, submitRender: noop, getRenderJob: noop, cancelRender: noop,
      exportFplot: noop, importFplot: noop, exportArtifact: noop
    });
    await expect(listeners.get('scientific-plot:load-project')?.({}, { projectId: '../escape' })).rejects.toThrow(/project id/i);
    const spec = createDefaultScientificPlotSpec('safe');
    await expect(listeners.get('scientific-plot:submit-render')?.({}, { projectId: 'safe', spec, data: { columns: [], rows: [] } })).rejects.toThrow(/column/i);
    expect(calls).toBe(0);
  });
});

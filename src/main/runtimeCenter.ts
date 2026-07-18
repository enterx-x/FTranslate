import type { LocalTranslationStatus } from './localTranslationService';
import type { CometMbrRuntimeSnapshot } from './cometMbrRuntime';

export type RuntimeCapabilityStatus = 'ready' | 'degraded' | 'unavailable' | 'unknown';

export interface RuntimeCapability {
  id: 'hy-mt2' | 'comet-mbr' | 'nllb' | 'argos' | 'pdf2zh' | 'ai-provider';
  label: string;
  status: RuntimeCapabilityStatus;
  message: string;
  details: Record<string, unknown>;
}

export interface RuntimeQueueItem {
  id: string;
  kind: string;
  status: string;
  label: string;
}

export interface RuntimeCenterSnapshot {
  generatedAt: string;
  overallStatus: RuntimeCapabilityStatus;
  capabilities: RuntimeCapability[];
  queue: {
    items: RuntimeQueueItem[];
    pendingCount: number;
    runningCount: number;
    failedCount: number;
  };
  actions: string[];
}

export interface BuildRuntimeCenterSnapshotInput {
  now?: string;
  localTranslationStatus: LocalTranslationStatus;
  cometMbr: CometMbrRuntimeSnapshot;
  pdfTranslationEngine: {
    available?: boolean;
    status?: string;
    command?: string;
    executable?: string;
    message: string;
    installCommand?: string;
  };
  aiProvider: {
    provider: string;
    baseURL: string;
    model: string;
    hasApiKey: boolean;
  };
  queue?: RuntimeQueueItem[];
}

export function buildRuntimeCenterSnapshot(input: BuildRuntimeCenterSnapshotInput): RuntimeCenterSnapshot {
  const queueItems = input.queue ?? [];
  const capabilities = [
    buildHyMt2Capability(input.localTranslationStatus),
    buildCometMbrCapability(input.cometMbr),
    buildNllbCapability(input.localTranslationStatus),
    buildArgosCapability(input.localTranslationStatus),
    buildPdfCapability(input.pdfTranslationEngine),
    buildAiProviderCapability(input.aiProvider)
  ];
  const queue = summarizeQueue(
    queueItems,
    input.localTranslationStatus.worker.pending + input.cometMbr.pending
  );
  const actions = buildRuntimeActions(capabilities, input.localTranslationStatus, input.aiProvider);

  return {
    generatedAt: input.now ?? new Date().toISOString(),
    overallStatus: selectOverallStatus(capabilities),
    capabilities,
    queue,
    actions
  };
}

function buildCometMbrCapability(snapshot: CometMbrRuntimeSnapshot): RuntimeCapability {
  const status: RuntimeCapabilityStatus = !snapshot.configured
    ? 'unavailable'
    : snapshot.available || snapshot.state === 'ready'
      ? 'ready'
      : snapshot.state === 'failed'
        ? 'degraded'
        : 'unknown';
  const message = snapshot.lastError || (
    status === 'ready'
      ? `${snapshot.modelId} 已就绪`
      : status === 'unavailable'
        ? 'COMET-MBR 独立质量评估环境尚未安装。'
        : snapshot.state === 'loading'
          ? '正在加载 COMET-MBR 质量评估模型。'
          : 'COMET-MBR 已安装，等待首次质量评估或手动检测。'
  );
  return {
    id: 'comet-mbr',
    label: 'COMET-MBR',
    status,
    message,
    details: {
      runtimeDevice: snapshot.device,
      runtimeState: snapshot.state,
      modelId: snapshot.modelId,
      modelRevision: snapshot.modelRevision,
      modelPath: snapshot.modelPath,
      pythonPath: snapshot.pythonPath,
      pendingCount: snapshot.pending
    }
  };
}

function buildHyMt2Capability(status: LocalTranslationStatus): RuntimeCapability {
  const runtimeState = status.hymt.runtimeState;
  const capabilityStatus: RuntimeCapabilityStatus = !status.hymt.configured
    ? status.nllb.configured
      ? 'degraded'
      : 'unavailable'
    : status.hymt.available || runtimeState === 'ready'
      ? 'ready'
      : runtimeState === 'failed'
        ? 'degraded'
        : 'unknown';
  return {
    id: 'hy-mt2',
    label: 'HY-MT2',
    status: capabilityStatus,
    message: status.hymt.message || status.hymt.lastRuntimeError,
    details: {
      runtimeDevice: status.hymt.runtimeDevice,
      runtimeState,
      modelPath: status.hymt.modelPath,
      serverPath: status.hymt.serverPath,
      warmupMs: status.hymt.warmupMs,
      lastCheckedAt: status.hymt.lastCheckedAt
    }
  };
}

function buildNllbCapability(status: LocalTranslationStatus): RuntimeCapability {
  const runtimeState = status.nllb.runtimeState;
  const isCpuFallback = status.nllb.runtimeDevice === 'cpu' || runtimeState === 'cpu_fallback';
  const capabilityStatus: RuntimeCapabilityStatus = !status.nllb.configured
    ? 'unavailable'
    : isCpuFallback
      ? 'degraded'
      : status.nllb.available || runtimeState === 'ready'
        ? 'ready'
        : 'unknown';

  return {
    id: 'nllb',
    label: 'NLLB',
    status: capabilityStatus,
    message: status.nllb.message || status.nllb.lastFallbackReason || status.nllb.lastRuntimeError,
    details: {
      runtimeDevice: status.nllb.runtimeDevice,
      runtimeState,
      cudaDllDirs: status.nllb.cudaDllDirs,
      warmupMs: status.nllb.warmupMs,
      lastCheckedAt: status.nllb.lastCheckedAt
    }
  };
}

function buildArgosCapability(status: LocalTranslationStatus): RuntimeCapability {
  return {
    id: 'argos',
    label: 'Argos',
    status: 'ready',
    message: status.fallback.message,
    details: { engine: status.fallback.engine }
  };
}

function buildPdfCapability(input: BuildRuntimeCenterSnapshotInput['pdfTranslationEngine']): RuntimeCapability {
  const available = input.available === true || input.status === 'available';
  return {
    id: 'pdf2zh',
    label: 'pdf2zh',
    status: available ? 'ready' : 'unavailable',
    message: input.message,
    details: {
      command: input.command ?? input.executable ?? '',
      installCommand: input.installCommand ?? ''
    }
  };
}

function buildAiProviderCapability(input: BuildRuntimeCenterSnapshotInput['aiProvider']): RuntimeCapability {
  return {
    id: 'ai-provider',
    label: 'AI provider',
    status: input.hasApiKey ? 'ready' : 'unavailable',
    message: input.hasApiKey ? `${input.provider} / ${input.model}` : 'API key is not configured',
    details: {
      provider: input.provider,
      baseURL: input.baseURL,
      model: input.model,
      hasApiKey: input.hasApiKey
    }
  };
}

function summarizeQueue(items: RuntimeQueueItem[], workerPending: number): RuntimeCenterSnapshot['queue'] {
  const pendingFromItems = items.filter((item) => item.status === 'pending' || item.status === 'queued').length;
  const runningCount = items.filter((item) => item.status === 'running').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;

  return {
    items,
    pendingCount: Math.max(pendingFromItems, Math.max(0, workerPending)),
    runningCount,
    failedCount
  };
}

function selectOverallStatus(capabilities: RuntimeCapability[]): RuntimeCapabilityStatus {
  if (capabilities.some((capability) => capability.status === 'unavailable')) {
    return 'unavailable';
  }
  if (capabilities.some((capability) => capability.status === 'degraded')) {
    return 'degraded';
  }
  if (capabilities.every((capability) => capability.status === 'ready')) {
    return 'ready';
  }
  return 'unknown';
}

function buildRuntimeActions(
  capabilities: RuntimeCapability[],
  localTranslationStatus: LocalTranslationStatus,
  aiProvider: BuildRuntimeCenterSnapshotInput['aiProvider']
): string[] {
  const actions: string[] = [];
  if (!aiProvider.hasApiKey) {
    actions.push('Configure an AI API key before using cloud-backed analysis.');
  }
  if (capabilities.find((capability) => capability.id === 'hy-mt2')?.status !== 'ready') {
    actions.push('Install HY-MT2 for the highest-quality local academic translation.');
  }
  if (capabilities.find((capability) => capability.id === 'comet-mbr')?.status === 'unavailable') {
    actions.push(
      'Run the bundled resources/runtime-installers/install-comet-mbr.ps1 (source: scripts/install-comet-mbr.ps1) to install independent translation quality evaluation.'
    );
  }
  if (capabilities.find((capability) => capability.id === 'nllb')?.status === 'degraded') {
    const reason = localTranslationStatus.nllb.lastFallbackReason || localTranslationStatus.nllb.lastRuntimeError;
    actions.push(reason ? `Check CUDA DLL paths. ${reason}` : 'Check CUDA DLL paths.');
  }
  if (capabilities.find((capability) => capability.id === 'pdf2zh')?.status === 'unavailable') {
    actions.push('Install pdf2zh before rebuilding bilingual PDF assets.');
  }

  return actions;
}

export type RuntimeCapabilityStatus = 'ready' | 'degraded' | 'unavailable' | 'unknown';
export type RuntimeCapabilityId = 'hy-mt2' | 'comet-mbr' | 'nllb' | 'argos' | 'pdf2zh' | 'ai-provider';

export interface RuntimeCenterCapability {
  id: RuntimeCapabilityId;
  label: string;
  status: RuntimeCapabilityStatus;
  message: string;
  details: Record<string, unknown>;
}

export interface RuntimeCenterSnapshot {
  generatedAt: string;
  overallStatus: RuntimeCapabilityStatus;
  capabilities: RuntimeCenterCapability[];
  queue: {
    items: unknown[];
    pendingCount: number;
    runningCount: number;
    failedCount: number;
  };
  actions: string[];
}

export type RuntimeCenterSnapshotLike = RuntimeCenterSnapshot;

export interface RuntimeCenterSummary {
  readyCount: number;
  degradedCount: number;
  unavailableCount: number;
  unknownCount: number;
  nextActions: string[];
}

export function summarizeRuntimeCenter(snapshot: RuntimeCenterSnapshot): RuntimeCenterSummary {
  return {
    readyCount: countByStatus(snapshot.capabilities, 'ready'),
    degradedCount: countByStatus(snapshot.capabilities, 'degraded'),
    unavailableCount: countByStatus(snapshot.capabilities, 'unavailable'),
    unknownCount: countByStatus(snapshot.capabilities, 'unknown'),
    nextActions: snapshot.actions
  };
}

export function selectRuntimeActionLabel(summary: RuntimeCenterSummary): string {
  return summary.nextActions[0] ?? 'Refresh runtime status';
}

function countByStatus(capabilities: RuntimeCenterCapability[], status: RuntimeCapabilityStatus): number {
  return capabilities.filter((capability) => capability.status === status).length;
}

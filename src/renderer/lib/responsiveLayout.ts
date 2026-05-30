export interface PointerRatioInput {
  clientX: number;
  left: number;
  width: number;
}

export function clampPanelRatio(
  value: number,
  min = 0.42,
  max = 0.8,
  fallback = 0.68
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Number(Number(Math.min(max, Math.max(min, value))).toFixed(3));
}

export function getPanelRatioFromPointer(
  input: PointerRatioInput,
  min = 0.42,
  max = 0.8,
  fallback = 0.68
): number {
  if (!Number.isFinite(input.width) || input.width <= 0) {
    return fallback;
  }

  return clampPanelRatio((input.clientX - input.left) / input.width, min, max, fallback);
}

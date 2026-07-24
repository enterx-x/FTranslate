export interface MobileSelectionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

export interface MobileVisualViewport {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

export interface MobileSelectionPopoverPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

const POPOVER_MARGIN = 12;
const POPOVER_MAX_WIDTH = 280;
const POPOVER_PREFERRED_HEIGHT = 168;

export function normalizeMobileSelectionText(value: string, maxLength = 1600): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : '';
}

export function isEnglishAcademicSelection(value: string): boolean {
  return /\p{Script=Latin}/u.test(value);
}

export function calculateMobileSelectionPopoverPosition(
  rect: MobileSelectionRect,
  viewport: MobileVisualViewport
): MobileSelectionPopoverPosition {
  const viewportLeft = viewport.offsetLeft;
  const viewportTop = viewport.offsetTop;
  const viewportRight = viewportLeft + viewport.width;
  const viewportBottom = viewportTop + viewport.height;
  const width = Math.max(180, Math.min(POPOVER_MAX_WIDTH, viewport.width - POPOVER_MARGIN * 2));
  const centeredLeft = rect.left + rect.width / 2 - width / 2;
  const left = clamp(centeredLeft, viewportLeft + POPOVER_MARGIN, viewportRight - width - POPOVER_MARGIN);
  const belowTop = rect.bottom + 8;
  const roomBelow = viewportBottom - POPOVER_MARGIN - belowTop;
  const top = roomBelow >= POPOVER_PREFERRED_HEIGHT
    ? belowTop
    : Math.max(viewportTop + POPOVER_MARGIN, rect.top - POPOVER_PREFERRED_HEIGHT - 8);
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    maxHeight: Math.max(120, Math.round(viewportBottom - POPOVER_MARGIN - top))
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

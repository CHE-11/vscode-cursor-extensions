const CENT = 100;
const SYSTEM_ZOOM_RATE = 1.2;
const ZOOM_LOG = Math.log(SYSTEM_ZOOM_RATE);

export const MIN_ZOOM_PERCENT = 25;
export const MAX_ZOOM_PERCENT = 400;
// Same bounds as workbench.action.zoomIn / zoomOut.
export const MIN_WORKBENCH_ZOOM_LEVEL = -8;
export const MAX_WORKBENCH_ZOOM_LEVEL = 8;

export type ZoomDirection = 'in' | 'out';
export type ZoomUnitType = 'multiplicative' | 'additive';

export function levelToPercent(level: number): number {
  return SYSTEM_ZOOM_RATE ** level * CENT;
}

export function percentToLevel(percent: number): number {
  return Math.log(percent / CENT) / ZOOM_LOG;
}

export function roundZoom(value: number): number {
  return Math.round(value * CENT) / CENT;
}

export function percentToDisplayString(percent: number, locales?: string | string[]): string {
  return roundZoom(percent / CENT).toLocaleString(locales, { style: 'percent' });
}

// Ctrl+/- steps by one rounded level and ignores fractional window.zoomLevel values.
export function workbenchZoomLevel(currentLevel: number, direction: ZoomDirection): number | undefined {
  if (!Number.isFinite(currentLevel)) {
    return undefined;
  }
  const next = Math.round(currentLevel) + (direction === 'in' ? 1 : -1);
  if (next > MAX_WORKBENCH_ZOOM_LEVEL || next < MIN_WORKBENCH_ZOOM_LEVEL) {
    return undefined;
  }
  return next;
}

export function nextZoomLevel(
  currentLevel: number,
  unit: number,
  direction: ZoomDirection,
  unitType: ZoomUnitType,
): number | undefined {
  if (!Number.isFinite(currentLevel) || !Number.isFinite(unit)) {
    return undefined;
  }
  if (unitType === 'multiplicative') {
    const step = percentToLevel(CENT + unit);
    return direction === 'in' ? currentLevel + step : currentLevel - step;
  }
  const currentPercent = levelToPercent(currentLevel);
  if (direction === 'out' && unit * 1.5 > currentPercent) {
    return undefined;
  }
  const nextPercent = direction === 'in' ? currentPercent + unit : currentPercent - unit;
  if (nextPercent <= 0) {
    return undefined;
  }
  return percentToLevel(nextPercent);
}

export function normalizePresets(values: readonly number[]): number[] {
  const unique = new Set<number>();
  for (const value of values) {
    if (Number.isFinite(value)) {
      unique.add(value);
    }
  }
  return [...unique].sort((left, right) => right - left);
}

const ORDER_TOKENS = new Set(['@', '%', '+', '-']);

export function parseDisplayOrder(order: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of order) {
    if (!ORDER_TOKENS.has(token) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

export function zoomInputError(raw: string, mustBeNumber: string, rangeLabel: string): string | undefined {
  const trimmed = raw.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    return mustBeNumber;
  }
  const value = Number(trimmed);
  if (value < MIN_ZOOM_PERCENT || value > MAX_ZOOM_PERCENT) {
    return `${rangeLabel}: ${MIN_ZOOM_PERCENT} - ${MAX_ZOOM_PERCENT}`;
  }
  return undefined;
}

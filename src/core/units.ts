/**
 * Unit conversions. Everything physical in this app is stored in **centimetres**.
 * Pixels only ever appear at the boundaries: the source image, and the exported
 * raster (whose density is the user's chosen DPI).
 */

export const CM_PER_INCH = 2.54;
export const PT_PER_INCH = 72; // PDF user-space unit

/** Device pixels per centimetre at a given DPI. */
export const pxPerCm = (dpi: number) => dpi / CM_PER_INCH;

/** PDF points per centimetre (always 72dpi user space, independent of raster DPI). */
export const ptPerCm = PT_PER_INCH / CM_PER_INCH;

export const cmToPx = (cm: number, dpi: number) => cm * pxPerCm(dpi);
export const cmToPt = (cm: number) => cm * ptPerCm;
export const cmToIn = (cm: number) => cm / CM_PER_INCH;
export const inToCm = (inch: number) => inch * CM_PER_INCH;

/** PNG `pHYs` uses pixels per metre. */
export const dpiToPixelsPerMetre = (dpi: number) => Math.round(dpi / 0.0254);

export interface Size {
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Paper stocks, always stored portrait (w < h) in cm. */
export const SHEETS = {
  A4: { label: 'A4', w: 21.0, h: 29.7 },
  A3: { label: 'A3', w: 29.7, h: 42.0 },
  A5: { label: 'A5', w: 14.8, h: 21.0 },
  Letter: { label: 'US Letter', w: 21.59, h: 27.94 },
  Legal: { label: 'US Legal', w: 21.59, h: 35.56 },
} as const;

export type SheetId = keyof typeof SHEETS;
export type Orientation = 'portrait' | 'landscape';

export function sheetSizeCm(sheet: SheetId, orientation: Orientation): Size {
  const { w, h } = SHEETS[sheet];
  return orientation === 'portrait' ? { w, h } : { w: h, h: w };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Intersection of two rects; zero-sized result means "no overlap". */
export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

export const fmtCm = (cm: number, digits = 1) => `${cm.toFixed(digits)} cm`;

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Greatest-common-divisor aspect label, e.g. "16 : 9". Falls back to a decimal ratio. */
export function aspectLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  const aw = w / g;
  const ah = h / g;
  if (aw <= 64 && ah <= 64) return `${aw} : ${ah}`;
  return `${(w / h).toFixed(3)} : 1`;
}

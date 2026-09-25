/**
 * Tiling geometry.
 *
 * ── The model ────────────────────────────────────────────────────────────────
 * Poster coordinates are centimetres, origin at the top-left of the *printed
 * image*. The image occupies [0, imageCm.w] × [0, imageCm.h].
 *
 * Each sheet can carry image content only inside its printable box:
 *     printable = sheet − 2 × margin
 *
 * When overlap (bleed) is on, neighbouring sheets duplicate a strip of width
 * `overlap` so a trimming error of less than `overlap` still leaves no white
 * gap. That makes the *net* contribution of each sheet — the step from one
 * sheet's origin to the next — smaller than its printable box:
 *     step = printable − overlap
 *
 * So a cols × rows grid spans:
 *     gridCm.w = cols × step.w + overlap        (cols = 1 → exactly printable.w)
 *     gridCm.h = rows × step.h + overlap
 *
 * Tile (r, c) puts poster-x [c·step.w, c·step.w + printable.w] on paper, offset
 * by `margin` from the paper edge. Where that box runs past the image (last row
 * or column, or a deliberately over-sized grid) the tile is *partial*: it holds
 * less content and its trim box shrinks to match. Tiles with no content at all
 * are dropped from the export.
 */

import {
  CM_PER_INCH,
  clamp,
  intersect,
  pxPerCm,
  sheetSizeCm,
  type Orientation,
  type Rect,
  type SheetId,
  type Size,
} from './units.ts';

const EPS = 1e-7;

export type SizingMode = 'grid' | 'target';
export type TargetAxis = 'width' | 'height';

export interface MarkOptions {
  cornerMarks: boolean;
  edgeTicks: boolean;
  trimLines: boolean;
  tileId: boolean;
  orientation: boolean;
  overlapGuides: boolean;
  color: MarkColor;
}

export type MarkColor = 'magenta' | 'gray' | 'cyan' | 'black';

export const MARK_COLORS: Record<MarkColor, string> = {
  magenta: '#ff00a8',
  gray: '#9a9a9a',
  cyan: '#00b3d6',
  black: '#1a1a1a',
};

export interface Settings {
  sheet: SheetId;
  orientation: Orientation;
  dpi: number;
  marginCm: number;
  overlapEnabled: boolean;
  overlapCm: number;

  mode: SizingMode;
  /** Grid mode */
  cols: number;
  rows: number;
  autoRows: boolean;
  /** Target-size mode */
  targetAxis: TargetAxis;
  targetCm: number;

  marks: MarkOptions;
}

export const DEFAULT_SETTINGS: Settings = {
  sheet: 'A4',
  orientation: 'portrait',
  dpi: 300,
  marginCm: 0.5,
  overlapEnabled: true,
  overlapCm: 0.4,

  mode: 'target',
  cols: 3,
  rows: 4,
  autoRows: true,
  targetAxis: 'height',
  targetCm: 100,

  marks: {
    cornerMarks: true,
    edgeTicks: true,
    trimLines: true,
    tileId: true,
    orientation: true,
    overlapGuides: true,
    color: 'magenta',
  },
};

export interface Tile {
  row: number; // 0-based
  col: number;
  id: string; // "R2-C3"
  /** Content rect in poster cm (the slice of the image this sheet carries). */
  contentCm: Rect;
  /** Source crop in image pixels. */
  srcPx: Rect;
  /** Where the content lands on the sheet, in cm from the sheet's top-left. */
  placeCm: Rect;
  /** True when the sheet is not filled edge-to-edge of its printable box. */
  partial: boolean;
  neighbors: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

export interface Layout {
  settings: Settings;
  imagePx: Size;
  /** Physical size of the printed image. */
  imageCm: Size;
  /** Physical span of the whole sheet grid (≥ imageCm). */
  gridCm: Size;
  sheetCm: Size;
  printableCm: Size;
  /** Net per-sheet contribution = printable − overlap. */
  stepCm: Size;
  /** Effective overlap after clamping (0 when disabled). */
  overlapCm: number;
  marginCm: number;
  cols: number;
  rows: number;
  tiles: Tile[];
  /** Grid cells that hold no image content and are therefore not exported. */
  emptyCells: number;
  /** Sheet raster size at the chosen DPI. */
  sheetPx: Size;
  /** Source image pixels per output centimetre. */
  srcPxPerCm: number;
  /** True resolution of the print: how many source pixels land per printed inch. */
  effectiveDpi: number;
  /** Largest print size (cm) that still hits the requested DPI natively. */
  nativeMaxCm: Size;
  /** Fraction of the grid's printable area actually covered by image. */
  coverage: number;
  /** Total pixels across all exported tiles. */
  totalTilePx: number;
  notices: Notice[];
}

export interface Notice {
  level: 'error' | 'warn' | 'info';
  title: string;
  body: string;
}

/** Ceil that ignores floating-point fuzz just below an integer. */
const ceilFuzzy = (v: number) => Math.ceil(v - 1e-9);

export const MAX_COLS = 200;
export const MAX_ROWS = 200;
export const MAX_TILES = 2000;

export interface GridBasics {
  sheetCm: Size;
  printableCm: Size;
  stepCm: Size;
  overlapCm: number;
  marginCm: number;
  valid: boolean;
}

/** Sheet-level geometry that does not depend on the image. */
export function gridBasics(s: Settings): GridBasics {
  const sheetCm = sheetSizeCm(s.sheet, s.orientation);
  const margin = clamp(s.marginCm, 0, Math.min(sheetCm.w, sheetCm.h) / 2 - 0.2);
  const printableCm: Size = { w: sheetCm.w - 2 * margin, h: sheetCm.h - 2 * margin };
  const valid = printableCm.w > 0.5 && printableCm.h > 0.5;
  // An overlap can never eat more than 40% of the smaller printable dimension,
  // otherwise sheets contribute almost nothing and the grid explodes.
  const maxOverlap = Math.max(0, Math.min(printableCm.w, printableCm.h) * 0.4);
  const overlapCm = s.overlapEnabled ? clamp(s.overlapCm, 0, maxOverlap) : 0;
  const stepCm: Size = { w: printableCm.w - overlapCm, h: printableCm.h - overlapCm };
  return { sheetCm, printableCm, stepCm, overlapCm, marginCm: margin, valid };
}

/** Physical span of a cols × rows grid. */
export const gridSpan = (b: GridBasics, cols: number, rows: number): Size => ({
  w: cols * b.stepCm.w + b.overlapCm,
  h: rows * b.stepCm.h + b.overlapCm,
});

/** Sheets needed to cover `cm` along an axis whose net step is `step`. */
export const sheetsFor = (cm: number, step: number, overlap: number) =>
  Math.max(1, ceilFuzzy((cm - overlap) / step));

/**
 * Suggest a cols × rows grid using about `count` sheets whose proportions are
 * as close as possible to the image's aspect ratio.
 */
export function suggestGrid(
  b: GridBasics,
  imagePx: Size,
  count: number,
): { cols: number; rows: number } {
  const target = imagePx.w / imagePx.h;
  const n = clamp(Math.round(count), 1, MAX_TILES);
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    if (cols > MAX_COLS || rows > MAX_ROWS) continue;
    const span = gridSpan(b, cols, rows);
    // Penalise aspect error, then wasted sheets.
    const aspectErr = Math.abs(Math.log(span.w / span.h) - Math.log(target));
    const waste = (cols * rows - n) / n;
    const score = aspectErr + waste * 0.25;
    if (score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

export interface CleanFit {
  cols: number;
  rows: number;
  imageCm: Size;
  sheets: number;
  coverage: number;
  /** Value to write into `targetCm` for the user's current axis. */
  targetCm: number;
}

/**
 * Sizes near the current one where the image fills the grid width *exactly*, so
 * there is no sliver column. Asking for, say, 60 cm wide on A4 can land 1.2 cm
 * into a fourth column and cost a whole extra stack of sheets for almost no
 * extra picture; these are the nearby sizes that do not.
 */
export function cleanFits(
  b: GridBasics,
  imagePx: Size,
  cols: number,
  targetAxis: TargetAxis,
): CleanFit[] {
  const aspect = imagePx.w / imagePx.h;
  const out: CleanFit[] = [];
  const seen = new Set<string>();
  for (const c of [Math.max(1, cols - 1), cols, cols + 1]) {
    if (c > MAX_COLS) continue;
    const w = gridSpan(b, c, 1).w;
    const h = w / aspect;
    const r = clamp(sheetsFor(h, b.stepCm.h, b.overlapCm), 1, MAX_ROWS);
    const key = `${c}x${r}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const span = gridSpan(b, c, r);
    out.push({
      cols: c,
      rows: r,
      imageCm: { w, h },
      sheets: c * r,
      coverage: (w * h) / (span.w * span.h),
      targetCm: Number((targetAxis === 'width' ? w : h).toFixed(2)),
    });
  }
  return out;
}

/** The print size the user asked for, before it is snapped to whole sheets. */
export function requestedImageCm(s: Settings, b: GridBasics, imagePx: Size): Size {
  const aspect = imagePx.w / imagePx.h;
  if (s.mode === 'target') {
    const v = Math.max(1, s.targetCm);
    return s.targetAxis === 'width' ? { w: v, h: v / aspect } : { w: v * aspect, h: v };
  }
  // Grid mode.
  const cols = clamp(Math.round(s.cols), 1, MAX_COLS);
  if (s.autoRows) {
    // Fill the grid width exactly; rows follow from the aspect ratio.
    const w = gridSpan(b, cols, 1).w;
    return { w, h: w / aspect };
  }
  // Both axes pinned: fit the image inside the grid without distortion.
  const rows = clamp(Math.round(s.rows), 1, MAX_ROWS);
  const span = gridSpan(b, cols, rows);
  const scale = Math.min(span.w / imagePx.w, span.h / imagePx.h);
  return { w: imagePx.w * scale, h: imagePx.h * scale };
}

export function computeLayout(imagePx: Size, s: Settings): Layout {
  const b = gridBasics(s);
  const notices: Notice[] = [];

  if (!b.valid) {
    notices.push({
      level: 'error',
      title: 'Margin too large',
      body: `A ${s.marginCm.toFixed(2)} cm margin leaves no usable area on a ${s.sheet} sheet. Reduce it.`,
    });
  }
  if (s.overlapEnabled && b.overlapCm < s.overlapCm - 1e-6) {
    notices.push({
      level: 'warn',
      title: 'Overlap clamped',
      body: `Overlap reduced to ${b.overlapCm.toFixed(2)} cm — it may not exceed 40% of the printable area.`,
    });
  }

  const imageCm = requestedImageCm(s, b, imagePx);

  let cols: number;
  let rows: number;
  if (s.mode === 'grid') {
    cols = clamp(Math.round(s.cols), 1, MAX_COLS);
    rows = s.autoRows
      ? clamp(sheetsFor(imageCm.h, b.stepCm.h, b.overlapCm), 1, MAX_ROWS)
      : clamp(Math.round(s.rows), 1, MAX_ROWS);
  } else {
    cols = clamp(sheetsFor(imageCm.w, b.stepCm.w, b.overlapCm), 1, MAX_COLS);
    rows = clamp(sheetsFor(imageCm.h, b.stepCm.h, b.overlapCm), 1, MAX_ROWS);
  }

  const gridCm = gridSpan(b, cols, rows);
  const srcPxPerCm = imagePx.w / imageCm.w;
  const devicePxPerCm = pxPerCm(s.dpi);
  const sheetPx: Size = {
    w: Math.round(b.sheetCm.w * devicePxPerCm),
    h: Math.round(b.sheetCm.h * devicePxPerCm),
  };

  const imageRect: Rect = { x: 0, y: 0, w: imageCm.w, h: imageCm.h };
  const tiles: Tile[] = [];
  let emptyCells = 0;

  const digits = Math.max(String(rows).length, String(cols).length) > 1 ? 2 : 1;
  const pad = (n: number) => String(n).padStart(digits, '0');

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const box: Rect = {
        x: c * b.stepCm.w,
        y: r * b.stepCm.h,
        w: b.printableCm.w,
        h: b.printableCm.h,
      };
      const contentCm = intersect(box, imageRect);
      if (contentCm.w <= EPS || contentCm.h <= EPS) {
        emptyCells++;
        continue;
      }
      const srcPx: Rect = {
        x: contentCm.x * srcPxPerCm,
        y: contentCm.y * srcPxPerCm,
        w: contentCm.w * srcPxPerCm,
        h: contentCm.h * srcPxPerCm,
      };
      // Guard against sub-pixel overshoot from accumulated rounding.
      srcPx.w = Math.min(srcPx.w, imagePx.w - srcPx.x);
      srcPx.h = Math.min(srcPx.h, imagePx.h - srcPx.y);

      tiles.push({
        row: r,
        col: c,
        id: `R${pad(r + 1)}-C${pad(c + 1)}`,
        contentCm,
        srcPx,
        // Content always starts at the printable box's top-left corner, so the
        // on-sheet offset is just the margin; only the extent can be clipped.
        placeCm: { x: b.marginCm, y: b.marginCm, w: contentCm.w, h: contentCm.h },
        partial: contentCm.w < b.printableCm.w - EPS || contentCm.h < b.printableCm.h - EPS,
        neighbors: {
          left: c > 0,
          top: r > 0,
          right: imageCm.w > (c + 1) * b.stepCm.w + EPS,
          bottom: imageCm.h > (r + 1) * b.stepCm.h + EPS,
        },
      });
    }
  }

  const effectiveDpi = srcPxPerCm * CM_PER_INCH;
  const nativeMaxCm: Size = {
    w: (imagePx.w / s.dpi) * CM_PER_INCH,
    h: (imagePx.h / s.dpi) * CM_PER_INCH,
  };
  const coverage = (imageCm.w * imageCm.h) / (gridCm.w * gridCm.h);

  let totalTilePx = 0;
  for (const t of tiles) {
    totalTilePx += Math.round(t.contentCm.w * devicePxPerCm) * Math.round(t.contentCm.h * devicePxPerCm);
  }

  if (tiles.length >= MAX_TILES) {
    notices.push({
      level: 'error',
      title: 'Grid too large',
      body: `Capped at ${MAX_TILES} sheets. Pick a smaller print size, a bigger sheet, or a smaller margin.`,
    });
  }

  if (effectiveDpi < s.dpi - 1) {
    const severe = effectiveDpi < s.dpi * 0.5;
    notices.push({
      level: severe ? 'warn' : 'info',
      title: severe ? 'Upscaling well past the source' : 'Slight upscaling',
      body:
        `${imageCm.w.toFixed(0)} × ${imageCm.h.toFixed(0)} cm at ${s.dpi} DPI wants ${Math.round(
          imageCm.w * devicePxPerCm,
        )} × ${Math.round(imageCm.h * devicePxPerCm)} px; the source has ${imagePx.w} × ${
          imagePx.h
        }, so real detail is ${Math.round(effectiveDpi)} DPI. ` +
        `At full ${s.dpi} DPI this file covers ${nativeMaxCm.w.toFixed(1)} × ${nativeMaxCm.h.toFixed(
          1,
        )} cm. ` +
        (effectiveDpi < 100
          ? 'Below roughly 100 DPI the pixels are visible at arm\'s length — fine for a wall-sized piece seen from a distance, soft up close. Upscale the source first if it will be viewed near.'
          : 'Upscale the source first for a crisper print.'),
    });
  }
  if (coverage < 0.92) {
    notices.push({
      level: 'info',
      title: 'Ragged grid edge',
      body: `The image fills ${(coverage * 100).toFixed(0)}% of the sheet grid; the last ${
        imageCm.w < gridCm.w - EPS && imageCm.h < gridCm.h - EPS
          ? 'row and column'
          : imageCm.w < gridCm.w - EPS
            ? 'column'
            : 'row'
      } is partly blank. That is normal — those sheets carry less image and their trim lines sit inside the printable box.`,
    });
  }
  if (s.dpi >= 600 && tiles.length > 12) {
    notices.push({
      level: 'warn',
      title: 'Large export ahead',
      body: `${tiles.length} sheets at 600 DPI is ${(totalTilePx / 1e6).toFixed(
        0,
      )} megapixels of output. Expect a slow export and a big file; 300 DPI is indistinguishable on most home printers.`,
    });
  }
  if (!s.overlapEnabled) {
    notices.push({
      level: 'info',
      title: 'Butt-joint assembly',
      body: 'With no overlap every seam must be trimmed on both sheets and joined edge-to-edge. Any trimming error shows as a white hairline. An overlap of 3–5 mm makes assembly much more forgiving.',
    });
  }

  return {
    settings: s,
    imagePx,
    imageCm,
    gridCm,
    sheetCm: b.sheetCm,
    printableCm: b.printableCm,
    stepCm: b.stepCm,
    overlapCm: b.overlapCm,
    marginCm: b.marginCm,
    cols,
    rows,
    tiles,
    emptyCells,
    sheetPx,
    srcPxPerCm,
    effectiveDpi,
    nativeMaxCm,
    coverage,
    totalTilePx,
    notices,
  };
}

/** File-safe tile name, e.g. `tile_R01C02`. */
export const tileFileName = (t: Tile) => `tile_${t.id.replace('-', '')}`;

export function tileAt(layout: Layout, row: number, col: number): Tile | undefined {
  return layout.tiles.find((t) => t.row === row && t.col === col);
}

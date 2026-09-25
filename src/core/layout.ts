/**
 * Tiling geometry.
 *
 * ── One formula, three ways to join sheets ───────────────────────────────────
 * Poster coordinates are centimetres, origin at the top-left of the *printed
 * image*. Per axis, with sheet size S and unprintable margin m:
 *
 *     printable P = S − 2m          the band of paper that can carry ink
 *     step        = (see below)     distance from one sheet's window to the next
 *     hidden      = (see below)     strip of this sheet's ink the next one covers
 *     span(n)     = (n−1)·step + P
 *     gutter      = step − (P − hidden)    unprinted gap left between sheets
 *
 *   trim        step = P − overlap      gutter 0      needs scissors
 *   nocut/butt  step = S                gutter 2m     paper edges touch
 *   nocut/tight step = S − m − cover    gutter m      next sheet laid on the ink
 *   borderless  step = S, m = 0         gutter 0      needs borderless paper
 *
 * The important consequence, and the reason `nocut` exists at all: a printer
 * that cannot print its outer 3 mm leaves that band at the extreme edge of the
 * sheet, where it is always the topmost layer at a seam. No overlap can hide
 * it. So without cutting, a gutter is unavoidable — the honest thing to do is
 * make it uniform, put it exactly where the geometry says, and drop the sliver
 * of picture that falls inside it so everything still lines up across the gap.
 *
 * `tight` halves that gutter: lay each new sheet so its edge lands on the ink of
 * the one before it instead of against its paper edge. Overshooting is safe —
 * the gutter stays m either way — which makes it forgiving to do by hand.
 */

import {
  CM_PER_INCH,
  clamp,
  expand,
  intersect,
  isBorderlessCapable,
  pxPerCm,
  SHEETS,
  sheetSizeCm,
  type Orientation,
  type Rect,
  type SheetId,
  type Size,
} from './units.ts';

const EPS = 1e-7;

export type SizingMode = 'grid' | 'target';
export type TargetAxis = 'width' | 'height';

/** How the printed sheets are joined into a poster. */
export type JoinStyle = 'trim' | 'nocut' | 'borderless';
/** Only meaningful for `nocut`. */
export type Placement = 'butt' | 'tight';

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
  /** Unprintable margin per edge. Ignored when joining borderless. */
  marginCm: number;

  join: JoinStyle;
  /** `trim` only: seams share a strip so a wandering cut leaves no gap. */
  overlapEnabled: boolean;
  overlapCm: number;
  /** `nocut` only. */
  placement: Placement;
  /** `nocut`/`tight` only: ink deliberately sacrificed under the next sheet. */
  coverCm: number;
  /** `borderless` only: compensation for the driver's edge-to-edge expansion. */
  bleedCm: number;

  mode: SizingMode;
  cols: number;
  rows: number;
  autoRows: boolean;
  targetAxis: TargetAxis;
  targetCm: number;

  marks: MarkOptions;
}

/**
 * Defaults aimed at the common case: a home EcoTank that cannot print to the
 * edge of A4, in the hands of someone who does not want to trim 20 sheets.
 */
export const DEFAULT_SETTINGS: Settings = {
  sheet: 'A4',
  orientation: 'portrait',
  dpi: 300,
  marginCm: 0.3,

  join: 'nocut',
  overlapEnabled: true,
  overlapCm: 0.4,
  placement: 'tight',
  coverCm: 0.4,
  bleedCm: 0.3,

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
  /** True slice of the poster this sheet carries, in poster cm. */
  contentCm: Rect;
  /** Source crop in image pixels (includes bleed when printing borderless). */
  srcPx: Rect;
  /** Where that crop lands on the sheet, in cm from the sheet's top-left. */
  placeCm: Rect;
  /** The content rect on the sheet — what marks are drawn around. */
  trimCm: Rect;
  partial: boolean;
  neighbors: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

export interface Layout {
  settings: Settings;
  imagePx: Size;
  imageCm: Size;
  gridCm: Size;
  sheetCm: Size;
  printableCm: Size;
  stepCm: Size;
  /** Strip of each sheet's ink that the next sheet covers (0 when nothing does). */
  hiddenCm: number;
  /** Unprinted gap left between neighbouring sheets (0 for seamless joins). */
  gutterCm: number;
  /** Effective margin: 0 when joining borderless. */
  marginCm: number;
  bleedCm: number;
  /** True when assembly needs no scissors. */
  noCut: boolean;
  cols: number;
  rows: number;
  tiles: Tile[];
  emptyCells: number;
  sheetPx: Size;
  srcPxPerCm: number;
  effectiveDpi: number;
  nativeMaxCm: Size;
  /** Fraction of the grid's span actually covered by image. */
  coverage: number;
  /** Fraction of the poster that ends up carrying ink (gutters excluded). */
  inkedFraction: number;
  totalTilePx: number;
  notices: Notice[];
}

export interface Notice {
  level: 'error' | 'warn' | 'info';
  title: string;
  body: string;
}

const ceilFuzzy = (v: number) => Math.ceil(v - 1e-9);

export const MAX_COLS = 200;
export const MAX_ROWS = 200;
export const MAX_TILES = 2000;

export interface GridBasics {
  sheetCm: Size;
  printableCm: Size;
  stepCm: Size;
  hiddenCm: number;
  gutterCm: number;
  marginCm: number;
  bleedCm: number;
  noCut: boolean;
  valid: boolean;
}

/** Sheet-level geometry, independent of the image. */
export function gridBasics(s: Settings): GridBasics {
  const sheetCm = sheetSizeCm(s.sheet, s.orientation);
  const borderless = s.join === 'borderless';
  const margin = borderless ? 0 : clamp(s.marginCm, 0, Math.min(sheetCm.w, sheetCm.h) / 2 - 0.2);
  const printableCm: Size = { w: sheetCm.w - 2 * margin, h: sheetCm.h - 2 * margin };
  const valid = printableCm.w > 0.5 && printableCm.h > 0.5;
  const maxStrip = Math.max(0, Math.min(printableCm.w, printableCm.h) * 0.4);

  let stepCm: Size;
  let hiddenCm: number;

  if (s.join === 'trim') {
    hiddenCm = s.overlapEnabled ? clamp(s.overlapCm, 0, maxStrip) : 0;
    stepCm = { w: printableCm.w - hiddenCm, h: printableCm.h - hiddenCm };
  } else if (s.join === 'borderless') {
    hiddenCm = 0;
    stepCm = { w: sheetCm.w, h: sheetCm.h };
  } else if (s.placement === 'tight') {
    hiddenCm = clamp(s.coverCm, 0, maxStrip);
    stepCm = { w: sheetCm.w - margin - hiddenCm, h: sheetCm.h - margin - hiddenCm };
  } else {
    hiddenCm = 0;
    stepCm = { w: sheetCm.w, h: sheetCm.h };
  }

  // Same on both axes by construction; computed from the width for clarity.
  const gutterCm = Math.max(0, stepCm.w - (printableCm.w - hiddenCm));

  return {
    sheetCm,
    printableCm,
    stepCm,
    hiddenCm,
    gutterCm,
    marginCm: margin,
    bleedCm: borderless ? clamp(s.bleedCm, 0, Math.min(sheetCm.w, sheetCm.h) * 0.1) : 0,
    noCut: s.join !== 'trim',
    valid,
  };
}

/** Physical span of a cols × rows grid: the last sheet contributes its full window. */
export const gridSpan = (b: GridBasics, cols: number, rows: number): Size => ({
  w: (cols - 1) * b.stepCm.w + b.printableCm.w,
  h: (rows - 1) * b.stepCm.h + b.printableCm.h,
});

/** Sheets needed to cover `cm` along an axis. */
export const sheetsFor = (cm: number, step: number, printable: number) =>
  Math.max(1, ceilFuzzy((cm - printable) / step) + 1);

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
  targetCm: number;
}

/** Nearby sizes where the image fills the grid width exactly — no sliver column. */
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
    const r = clamp(sheetsFor(h, b.stepCm.h, b.printableCm.h), 1, MAX_ROWS);
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
  const cols = clamp(Math.round(s.cols), 1, MAX_COLS);
  if (s.autoRows) {
    const w = gridSpan(b, cols, 1).w;
    return { w, h: w / aspect };
  }
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
      body: `A ${s.marginCm.toFixed(2)} cm margin leaves no usable area on a ${SHEETS[s.sheet].label} sheet. Reduce it.`,
    });
  }
  if (s.join === 'borderless' && !isBorderlessCapable(s.sheet)) {
    notices.push({
      level: 'error',
      title: 'This paper size cannot print borderless',
      body: `${SHEETS[s.sheet].label} has no borderless mode on a typical EcoTank — the L3200 series stops at 13 × 18 cm. Pick 10 × 15 or 13 × 18 cm, or switch to a no-cut join on ${SHEETS[s.sheet].label}.`,
    });
  }

  const imageCm = requestedImageCm(s, b, imagePx);

  let cols: number;
  let rows: number;
  if (s.mode === 'grid') {
    cols = clamp(Math.round(s.cols), 1, MAX_COLS);
    rows = s.autoRows
      ? clamp(sheetsFor(imageCm.h, b.stepCm.h, b.printableCm.h), 1, MAX_ROWS)
      : clamp(Math.round(s.rows), 1, MAX_ROWS);
  } else {
    cols = clamp(sheetsFor(imageCm.w, b.stepCm.w, b.printableCm.w), 1, MAX_COLS);
    rows = clamp(sheetsFor(imageCm.h, b.stepCm.h, b.printableCm.h), 1, MAX_ROWS);
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

  // Where the sheet's raster carries image, and how much poster it represents.
  const destCm: Rect =
    s.join === 'borderless'
      ? { x: 0, y: 0, w: b.sheetCm.w, h: b.sheetCm.h }
      : { x: b.marginCm, y: b.marginCm, w: b.printableCm.w, h: b.printableCm.h };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const window: Rect = {
        x: c * b.stepCm.w,
        y: r * b.stepCm.h,
        w: b.printableCm.w,
        h: b.printableCm.h,
      };
      const contentCm = intersect(window, imageRect);
      if (contentCm.w <= EPS || contentCm.h <= EPS) {
        emptyCells++;
        continue;
      }

      // Borderless drivers enlarge the page and spray the excess off the paper,
      // so hand them extra picture on every edge and the crop lands on the
      // boundary we designed for.
      const regionCm = b.bleedCm > 0 ? expand(window, b.bleedCm) : window;
      const sx = destCm.w / regionCm.w;
      const sy = destCm.h / regionCm.h;
      const renderCm = intersect(regionCm, imageRect);

      const srcPx: Rect = {
        x: renderCm.x * srcPxPerCm,
        y: renderCm.y * srcPxPerCm,
        w: renderCm.w * srcPxPerCm,
        h: renderCm.h * srcPxPerCm,
      };
      srcPx.w = Math.min(srcPx.w, imagePx.w - srcPx.x);
      srcPx.h = Math.min(srcPx.h, imagePx.h - srcPx.y);

      const onSheet = (rect: Rect): Rect => ({
        x: destCm.x + (rect.x - regionCm.x) * sx,
        y: destCm.y + (rect.y - regionCm.y) * sy,
        w: rect.w * sx,
        h: rect.h * sy,
      });

      tiles.push({
        row: r,
        col: c,
        id: `R${pad(r + 1)}-C${pad(c + 1)}`,
        contentCm,
        srcPx,
        placeCm: onSheet(renderCm),
        trimCm: onSheet(contentCm),
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

  // Gutters eat this much of the picture.
  const inkedFraction =
    b.gutterCm > 0
      ? ((imageCm.w - Math.max(0, cols - 1) * b.gutterCm) / imageCm.w) *
        ((imageCm.h - Math.max(0, rows - 1) * b.gutterCm) / imageCm.h)
      : 1;

  let totalTilePx = 0;
  for (const t of tiles) {
    totalTilePx +=
      Math.round(t.placeCm.w * devicePxPerCm) * Math.round(t.placeCm.h * devicePxPerCm);
  }

  if (tiles.length >= MAX_TILES) {
    notices.push({
      level: 'error',
      title: 'Grid too large',
      body: `Capped at ${MAX_TILES} sheets. Pick a smaller print size, a bigger sheet, or a smaller margin.`,
    });
  }

  /* ── Style-specific guidance ─────────────────────────────────────────────── */
  if (s.join === 'nocut') {
    const lines = Math.max(0, cols - 1) + Math.max(0, rows - 1);
    notices.push({
      level: 'info',
      title: 'No cutting — white grid lines instead',
      body:
        `Your printer leaves ${(b.marginCm * 10).toFixed(1)} mm unprinted at each paper edge, and that band sits on top at every seam, so it cannot be hidden without trimming. ` +
        `Assembled as-is you get ${lines} white line${lines === 1 ? '' : 's'} of ${(
          b.gutterCm * 10
        ).toFixed(1)} mm, evenly spaced — a panel/mosaic look. ` +
        `${((1 - inkedFraction) * 100).toFixed(1)}% of the picture falls in those lines and is dropped, so everything still lines up across them.` +
        (s.placement === 'butt'
          ? ' Switching to "on the printed edge" halves the lines.'
          : ''),
    });
  }
  if (s.join === 'borderless') {
    notices.push({
      level: 'warn',
      title: 'Borderless: set Expansion, and watch the waste pad',
      body:
        `In the Epson driver tick Borderless and set Expansion to Standard — the driver enlarges the page and sprays the excess off the paper, which is what the ${(
          b.bleedCm * 10
        ).toFixed(1)} mm bleed here compensates for. ` +
        `Borderless usually needs a photo paper type, and every borderless page feeds ink into the borderless waste pad, which only a service centre can replace. ` +
        `${tiles.length} sheets of ${SHEETS[s.sheet].label} is a real amount of that pad's life.`,
    });
  }
  if (s.join === 'trim' && !s.overlapEnabled) {
    notices.push({
      level: 'info',
      title: 'Butt-joint assembly',
      body: 'Every seam must be trimmed on both sheets and joined edge to edge. Any trimming error shows as a white hairline; an overlap of 3–5 mm makes it forgiving.',
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
          ? "Below roughly 100 DPI the pixels are visible at arm's length — fine for a wall-sized piece seen from a distance, soft up close. Upscale the source first if it will be viewed near."
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
      } is partly blank. That is normal — those sheets simply carry less picture.`,
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

  return {
    settings: s,
    imagePx,
    imageCm,
    gridCm,
    sheetCm: b.sheetCm,
    printableCm: b.printableCm,
    stepCm: b.stepCm,
    hiddenCm: b.hiddenCm,
    gutterCm: b.gutterCm,
    marginCm: b.marginCm,
    bleedCm: b.bleedCm,
    noCut: b.noCut,
    cols,
    rows,
    tiles,
    emptyCells,
    sheetPx,
    srcPxPerCm,
    effectiveDpi,
    nativeMaxCm,
    coverage,
    inkedFraction,
    totalTilePx,
    notices,
  };
}

/** Which marks make sense for a given join style. */
export function marksAvailable(s: Settings): Record<keyof Omit<MarkOptions, 'color'>, boolean> {
  const trim = s.join === 'trim';
  const hasHidden = trim ? s.overlapEnabled : s.join === 'nocut' && s.placement === 'tight';
  return {
    trimLines: trim,
    cornerMarks: trim,
    edgeTicks: trim,
    overlapGuides: hasHidden,
    // With nothing to cut and nothing to hide it under, an id is permanent ink.
    tileId: true,
    orientation: trim,
  };
}

/** True when a printed mark would survive on the finished poster. */
export const idIsPermanent = (s: Settings) =>
  s.join === 'borderless' || (s.join === 'nocut' && s.placement === 'butt');

export const tileFileName = (t: Tile) => `tile_${t.id.replace('-', '')}`;

export function tileAt(layout: Layout, row: number, col: number): Tile | undefined {
  return layout.tiles.find((t) => t.row === row && t.col === col);
}

/**
 * Printable assembly marks.
 *
 * Hard rule: **no mark may sit on image area that survives assembly.** Every
 * mark lives in one of two safe zones:
 *
 *   1. the paper margin, which is cut away (or hidden under the next sheet);
 *   2. the overlap strip on a tile's *right / bottom* edge — that strip is the
 *      one the neighbouring sheet is laid on top of, so anything drawn there
 *      disappears when the poster is assembled. That is where the alignment
 *      guide lines go: you slide the next sheet until its cut edge sits on the
 *      line, then the picture is registered to within a fraction of a mm.
 *
 * The left/top overlap strips are the ones that end up on top, so they stay
 * clean — they only ever get a trim line out in the margin.
 */

import { MARK_COLORS, type MarkOptions, type Tile } from './layout.ts';
import { pxPerCm, type Size } from './units.ts';

export interface MarkInput {
  g: CanvasRenderingContext2D;
  dpi: number;
  sheetCm: Size;
  marginCm: number;
  overlapCm: number;
  tile: Tile;
  cols: number;
  rows: number;
  marks: MarkOptions;
  /** Ids of the sheets that will be laid over this one's right / bottom strips. */
  neighborIds: { right?: string; bottom?: string };
  /** Short spec string printed next to the tile id, e.g. "A4 · 300 DPI · trim 5 mm". */
  info?: string;
}

/** Mark metrics, in centimetres. */
const STROKE = 0.02; // 0.2 mm hairline
const CORNER_ARM = 0.5;
const TICK = 0.32;

export function drawMarks(input: MarkInput): void {
  const { g, dpi, marginCm: m, overlapCm, tile, marks } = input;
  const k = pxPerCm(dpi);
  const color = MARK_COLORS[marks.color];

  // Content box on the sheet, in cm.
  const c = tile.placeCm;
  const L = c.x;
  const T = c.y;
  const R = c.x + c.w;
  const B = c.y + c.h;

  const stroke = Math.max(1 / k, STROKE);
  const halfStroke = stroke / 2;
  const arm = Math.min(CORNER_ARM, m * 0.85);
  const tick = Math.min(TICK, m * 0.62);

  const n = tile.neighbors;

  g.save();
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = stroke * k;

  /* Keep-out clip. Everything below draws right up against the content edge, so
     antialiasing alone could tint the outermost row of surviving artwork. Punch
     a hole over the area that survives assembly — content minus the right and
     bottom overlap strips — rounded outward to whole device pixels, and clip it
     away. After this, "no mark can land on the finished poster" is enforced by
     the rasteriser rather than by careful arithmetic. */
  const keepOut = {
    x0: Math.floor(L * k),
    y0: Math.floor(T * k),
    x1: Math.ceil((R - (n.right ? overlapCm : 0)) * k),
    y1: Math.ceil((B - (n.bottom ? overlapCm : 0)) * k),
  };
  g.beginPath();
  g.rect(0, 0, g.canvas.width, g.canvas.height);
  g.rect(keepOut.x0, keepOut.y0, keepOut.x1 - keepOut.x0, keepOut.y1 - keepOut.y0);
  g.clip('evenodd');

  const line = (x1: number, y1: number, x2: number, y2: number) => {
    g.beginPath();
    g.moveTo(x1 * k, y1 * k);
    g.lineTo(x2 * k, y2 * k);
    g.stroke();
  };
  const dash = (pattern: number[]) => g.setLineDash(pattern.map((d) => d * k));
  const noDash = () => g.setLineDash([]);

  // Which edges must be cut: with an overlap you only trim the sheet that goes
  // on top (left + top edges); butt-jointed sheets are trimmed on every seam.
  const mustCut = overlapCm > 0
    ? { left: n.left, top: n.top, right: false, bottom: false }
    : { left: n.left, top: n.top, right: n.right, bottom: n.bottom };

  /* ── 1. Trim / cut lines ─────────────────────────────────────────────────
     Drawn in the margin, offset outward by half the stroke width, so the
     line's inner edge is exactly on the content boundary: cut along the inside
     of the line and the crop is dead on. */
  if (marks.trimLines && m > stroke * 2) {
    const cut = [0.2, 0.13];
    const opt = [0.07, 0.11];
    const edge = (must: boolean, x1: number, y1: number, x2: number, y2: number) => {
      g.globalAlpha = must ? 1 : 0.45;
      g.lineWidth = (must ? stroke : stroke * 0.8) * k;
      dash(must ? cut : opt);
      line(x1, y1, x2, y2);
    };
    // Extend each trim line a little past the corners so adjacent sheets can
    // be sighted for skew along a continuous line.
    const over = Math.min(arm, m * 0.85);
    edge(mustCut.left, L - halfStroke, T - over, L - halfStroke, B + over);
    edge(mustCut.right, R + halfStroke, T - over, R + halfStroke, B + over);
    edge(mustCut.top, L - over, T - halfStroke, R + over, T - halfStroke);
    edge(mustCut.bottom, L - over, B + halfStroke, R + over, B + halfStroke);
    g.globalAlpha = 1;
    noDash();
    g.lineWidth = stroke * k;
  }

  /* ── 2. Corner registration marks ────────────────────────────────────────
     An L at each corner of the content box, arms pointing outward into the
     margin and meeting exactly at the corner. Matching two sheets means
     making the two L's collinear across the seam. */
  if (marks.cornerMarks && arm > 0.05) {
    g.lineWidth = stroke * 1.6 * k;
    noDash();
    const corner = (x: number, y: number, sx: number, sy: number) => {
      line(x, y, x + arm * sx, y);
      line(x, y, x, y + arm * sy);
    };
    corner(L, T, -1, -1);
    corner(R, T, 1, -1);
    corner(L, B, -1, 1);
    corner(R, B, 1, 1);
    g.lineWidth = stroke * k;
  }

  /* ── 3. Edge ticks at the midpoint of every seam ─────────────────────── */
  if (marks.edgeTicks && tick > 0.05) {
    g.lineWidth = stroke * 1.6 * k;
    noDash();
    const midX = (L + R) / 2;
    const midY = (T + B) / 2;
    if (n.left) line(L, midY, L - tick, midY);
    if (n.right) line(R, midY, R + tick, midY);
    if (n.top) line(midX, T, midX, T - tick);
    if (n.bottom) line(midX, B, midX, B + tick);
    g.lineWidth = stroke * k;
  }

  /* ── 4. Overlap alignment guides (hidden under the next sheet) ─────────── */
  if (marks.overlapGuides && overlapCm > 0.02) {
    g.globalAlpha = 0.7;
    dash([0.14, 0.1]);
    // Nudged a hairline inside the strip so the keep-out clip cannot swallow it.
    if (n.right) line(R - overlapCm + stroke, T, R - overlapCm + stroke, B);
    if (n.bottom) line(L, B - overlapCm + stroke, R, B - overlapCm + stroke);
    noDash();
    g.globalAlpha = 1;

    // The strip is covered after assembly, so labelling it is free.
    const fs = Math.min(overlapCm * 0.55, 0.26);
    if (fs > 0.08) {
      g.globalAlpha = 0.75;
      g.font = `${fs * k}px Arial, Helvetica, sans-serif`;
      if (n.right && input.neighborIds.right) {
        g.save();
        g.translate((R - overlapCm / 2) * k, (T + 1.2) * k);
        g.rotate(Math.PI / 2);
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(`lay ${input.neighborIds.right} over this strip`, 0, 0);
        g.restore();
      }
      if (n.bottom && input.neighborIds.bottom) {
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(`lay ${input.neighborIds.bottom} over this strip`, (L + 1.2) * k, (B - overlapCm / 2) * k);
      }
      g.globalAlpha = 1;
    }
  }

  /* ── 5. Tile id, in a margin that will be trimmed away ─────────────────── */
  if (marks.tileId && m > 0.2) {
    const onTop = n.top; // top margin is cut in both assembly modes when it has a neighbour
    const fs = Math.min(m * 0.46, 0.34);
    g.font = `${fs * k}px Arial, Helvetica, sans-serif`;
    g.textAlign = 'left';
    const label = `${tile.id}  of ${input.rows}×${input.cols}${tile.partial ? '  (partial)' : ''}`;
    const y = onTop ? (T - m / 2) * k : (B + m / 2) * k;
    g.textBaseline = 'middle';
    g.fillText(label, L * k, y);
    if (input.info) {
      g.globalAlpha = 0.65;
      g.textAlign = 'right';
      g.fillText(input.info, R * k, y);
      g.globalAlpha = 1;
    }
  }

  /* ── 6. Orientation indicator ─────────────────────────────────────────── */
  if (marks.orientation && m > 0.25) {
    const fs = Math.min(m * 0.44, 0.32);
    const cx = L + (R - L) * 0.78;
    const cy = T - m / 2;
    const a = Math.min(fs * 0.8, m * 0.34); // arrow height
    g.beginPath();
    g.moveTo(cx * k, (cy - a / 2) * k);
    g.lineTo((cx - a * 0.42) * k, (cy + a / 2) * k);
    g.lineTo((cx + a * 0.42) * k, (cy + a / 2) * k);
    g.closePath();
    g.fill();
    g.font = `${fs * k}px Arial, Helvetica, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('TOP', (cx + a * 0.62) * k, cy * k);
  }

  g.restore();
}

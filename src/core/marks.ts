/**
 * Printable assembly marks.
 *
 * Hard rule: **no mark may sit on ink that survives assembly.** Where marks can
 * legally live depends entirely on how the sheets will be joined:
 *
 *   trim        the paper margin (cut off) and the shared overlap strip (covered
 *               by the neighbour) — the full set of marks.
 *   nocut/tight the cover strip only. The margin is *unprintable* here, so there
 *               is no room for crop marks; instead the strip that the next sheet
 *               is laid over carries a "cover up to this line" guide, which is
 *               also the alignment target. Overshoot is harmless.
 *   nocut/butt  nothing is cut and nothing is covered, so any mark is permanent.
 *               Only the sheet id is offered, and only if the user opts in.
 *   borderless  same: every dot of ink shows. Id only, opt-in.
 *
 * In the first two cases the guarantee is enforced by a keep-out clip rather
 * than by careful arithmetic — the rasteriser cannot put ink on the finished
 * poster even if a mark is nudged.
 */

import { idIsPermanent, MARK_COLORS, type Layout, type Tile } from './layout.ts';
import { pxPerCm, type Rect } from './units.ts';

/** Mark metrics, in centimetres. */
const STROKE = 0.02; // 0.2 mm hairline
const CORNER_ARM = 0.5;
const TICK = 0.32;

export interface MarkNeighbours {
  right?: string;
  bottom?: string;
}

export function drawMarks(
  g: CanvasRenderingContext2D,
  L: Layout,
  tile: Tile,
  dpi: number,
  neighborIds: MarkNeighbours,
  info?: string,
): void {
  const s = L.settings;
  const k = pxPerCm(dpi);
  const marks = s.marks;
  const color = MARK_COLORS[marks.color];
  const n = tile.neighbors;
  const hidden = L.hiddenCm;

  const c = tile.trimCm;
  const Lx = c.x;
  const Ty = c.y;
  const Rx = c.x + c.w;
  const By = c.y + c.h;

  const stroke = Math.max(1 / k, STROKE);
  const halfStroke = stroke / 2;

  /* ── Permanent-ink styles: the id or nothing ─────────────────────────────── */
  if (idIsPermanent(s)) {
    if (!marks.tileId) return;
    g.save();
    const fs = 0.28;
    g.fillStyle = color;
    g.globalAlpha = 0.5;
    g.font = `${fs * k}px Arial, Helvetica, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(`${tile.id}`, (Lx + 0.18) * k, (Ty + 0.14) * k);
    g.restore();
    return;
  }

  const trim = s.join === 'trim';
  // Ink is possible anywhere on the sheet only when the margin gets cut away.
  const paintable: Rect = trim
    ? { x: 0, y: 0, w: L.sheetCm.w, h: L.sheetCm.h }
    : { x: c.x, y: c.y, w: c.w, h: c.h };
  const surviving: Rect = {
    x: Lx,
    y: Ty,
    w: c.w - (n.right ? hidden : 0),
    h: c.h - (n.bottom ? hidden : 0),
  };

  g.save();
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = stroke * k;

  /* Keep-out clip: paintable area minus the region that survives assembly,
     rounded outward to whole device pixels so antialiasing cannot tint the
     outermost row of surviving ink. */
  g.beginPath();
  g.rect(
    Math.floor(paintable.x * k),
    Math.floor(paintable.y * k),
    Math.ceil(paintable.w * k),
    Math.ceil(paintable.h * k),
  );
  g.rect(
    Math.floor(surviving.x * k),
    Math.floor(surviving.y * k),
    Math.ceil(surviving.w * k),
    Math.ceil(surviving.h * k),
  );
  g.clip('evenodd');

  const line = (x1: number, y1: number, x2: number, y2: number) => {
    g.beginPath();
    g.moveTo(x1 * k, y1 * k);
    g.lineTo(x2 * k, y2 * k);
    g.stroke();
  };
  const dash = (pattern: number[]) => g.setLineDash(pattern.map((d) => d * k));
  const noDash = () => g.setLineDash([]);

  if (trim) {
    const m = L.marginCm;
    const arm = Math.min(CORNER_ARM, m * 0.85);
    const tick = Math.min(TICK, m * 0.62);
    // With an overlap you only trim the sheet that goes on top; butt-jointed
    // sheets are trimmed on every seam.
    const mustCut =
      hidden > 0
        ? { left: n.left, top: n.top, right: false, bottom: false }
        : { left: n.left, top: n.top, right: n.right, bottom: n.bottom };

    /* Trim lines, offset outward by half a stroke so the line's inner edge is
       exactly on the picture boundary: cut along the inside and the crop is
       dead on. */
    if (marks.trimLines && m > stroke * 2) {
      const cut = [0.2, 0.13];
      const opt = [0.07, 0.11];
      const over = Math.min(arm, m * 0.85);
      const edge = (must: boolean, x1: number, y1: number, x2: number, y2: number) => {
        g.globalAlpha = must ? 1 : 0.45;
        g.lineWidth = (must ? stroke : stroke * 0.8) * k;
        dash(must ? cut : opt);
        line(x1, y1, x2, y2);
      };
      edge(mustCut.left, Lx - halfStroke, Ty - over, Lx - halfStroke, By + over);
      edge(mustCut.right, Rx + halfStroke, Ty - over, Rx + halfStroke, By + over);
      edge(mustCut.top, Lx - over, Ty - halfStroke, Rx + over, Ty - halfStroke);
      edge(mustCut.bottom, Lx - over, By + halfStroke, Rx + over, By + halfStroke);
      g.globalAlpha = 1;
      noDash();
      g.lineWidth = stroke * k;
    }

    /* Corner registration marks: an L at each corner, arms pointing out into
       the margin and meeting exactly at the corner. Line two sheets up by
       making their L's collinear across the seam. */
    if (marks.cornerMarks && arm > 0.05) {
      g.lineWidth = stroke * 1.6 * k;
      noDash();
      const corner = (x: number, y: number, dx: number, dy: number) => {
        line(x, y, x + arm * dx, y);
        line(x, y, x, y + arm * dy);
      };
      corner(Lx, Ty, -1, -1);
      corner(Rx, Ty, 1, -1);
      corner(Lx, By, -1, 1);
      corner(Rx, By, 1, 1);
      g.lineWidth = stroke * k;
    }

    /* Mid-edge ticks: a skew check halfway along each seam. */
    if (marks.edgeTicks && tick > 0.05) {
      g.lineWidth = stroke * 1.6 * k;
      noDash();
      const midX = (Lx + Rx) / 2;
      const midY = (Ty + By) / 2;
      if (n.left) line(Lx, midY, Lx - tick, midY);
      if (n.right) line(Rx, midY, Rx + tick, midY);
      if (n.top) line(midX, Ty, midX, Ty - tick);
      if (n.bottom) line(midX, By, midX, By + tick);
      g.lineWidth = stroke * k;
    }

    /* Orientation arrow, in the top margin. */
    if (marks.orientation && m > 0.25) {
      const fs = Math.min(m * 0.44, 0.32);
      const cx = Lx + (Rx - Lx) * 0.78;
      const cy = Ty - m / 2;
      const a = Math.min(fs * 0.8, m * 0.34);
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

    /* Sheet id, in a margin that gets trimmed. */
    if (marks.tileId && m > 0.2) {
      const fs = Math.min(m * 0.46, 0.34);
      g.font = `${fs * k}px Arial, Helvetica, sans-serif`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      const y = (n.top ? Ty - m / 2 : By + m / 2) * k;
      g.fillText(`${tile.id}  of ${L.rows}×${L.cols}${tile.partial ? '  (partial)' : ''}`, Lx * k, y);
      if (info) {
        g.globalAlpha = 0.65;
        g.textAlign = 'right';
        g.fillText(info, Rx * k, y);
        g.globalAlpha = 1;
      }
    }
  }

  /* ── The hidden strip: alignment guide + id, on ink that gets covered ────── */
  if (hidden > 0.02 && (n.right || n.bottom)) {
    const guides = marks.overlapGuides;
    const fs = Math.min(hidden * 0.5, 0.26);
    const labelTarget = trim ? 'lay' : 'cover to here —';

    if (guides) {
      g.globalAlpha = 0.72;
      dash([0.14, 0.1]);
      // Nudged a hairline inside the strip so the keep-out clip cannot eat it.
      if (n.right) line(Rx - hidden + stroke, Ty, Rx - hidden + stroke, By);
      if (n.bottom) line(Lx, By - hidden + stroke, Rx, By - hidden + stroke);
      noDash();
      g.globalAlpha = 1;
    }

    if (fs > 0.08) {
      g.globalAlpha = 0.8;
      g.font = `${fs * k}px Arial, Helvetica, sans-serif`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      if (n.right) {
        g.save();
        g.translate((Rx - hidden / 2) * k, (Ty + Math.min(1.2, c.h * 0.1)) * k);
        g.rotate(Math.PI / 2);
        g.fillText(`${labelTarget} ${neighborIds.right ?? ''}`.trim(), 0, 0);
        g.restore();
      }
      if (n.bottom) {
        g.fillText(
          `${labelTarget} ${neighborIds.bottom ?? ''}`.trim(),
          (Lx + Math.min(1.2, c.w * 0.1)) * k,
          (By - hidden / 2) * k,
        );
      }
      /* In no-cut mode this strip is the only safe place for the id. */
      if (!trim && marks.tileId) {
        const label = `${tile.id} of ${L.rows}×${L.cols}`;
        if (n.bottom) {
          g.textAlign = 'right';
          g.fillText(label, (Rx - 0.3) * k, (By - hidden / 2) * k);
        } else if (n.right) {
          g.save();
          g.translate((Rx - hidden / 2) * k, (By - 0.3) * k);
          g.rotate(Math.PI / 2);
          g.textAlign = 'right';
          g.fillText(label, 0, 0);
          g.restore();
        }
      }
      g.globalAlpha = 1;
    }
  }

  g.restore();
}

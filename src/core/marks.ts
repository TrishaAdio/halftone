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
    const cutAtLogical = s.seam === 'cut' && hidden > 0;

    /* Where the scissors go.
       'cut'  — on the logical boundary, i.e. *inside* the duplicated strip. Cut
                there on both sheets and the two cut edges land on identical
                image content, so the seam closes with no white gap and no
                misalignment. The overlap is the error budget: the cut can
                wander by up to its width and still land on real picture.
       'lap'  — only the leading edges are cut, and each sheet is laid over its
                neighbour's strip. */
    const cutBox = cutAtLogical ? tile.logicalCm : tile.trimCm;
    const cx0 = cutBox.x;
    const cy0 = cutBox.y;
    const cx1 = cutBox.x + cutBox.w;
    const cy1 = cutBox.y + cutBox.h;

    const mustCut =
      s.seam === 'cut'
        ? // Every seam is cut on both sheets; the leading edges only shed blank margin.
          { left: n.left, top: n.top, right: n.right, bottom: n.bottom }
        : hidden > 0
          ? { left: n.left, top: n.top, right: false, bottom: false }
          : { left: n.left, top: n.top, right: n.right, bottom: n.bottom };

    /* Cut lines. Each is offset outward by half a stroke so the line's inner
       edge sits exactly on the boundary: cut along the inside of the line and
       the crop is dead on. */
    if (marks.trimLines) {
      const cut = [0.2, 0.13];
      const opt = [0.07, 0.11];
      const over = Math.min(arm, m * 0.85);
      const edge = (must: boolean, x1: number, y1: number, x2: number, y2: number) => {
        g.globalAlpha = must ? 1 : 0.4;
        g.lineWidth = (must ? stroke : stroke * 0.8) * k;
        dash(must ? cut : opt);
        line(x1, y1, x2, y2);
      };
      // Leading edges are always at the content boundary; trailing edges move
      // in to the logical boundary when the strip is being discarded.
      edge(mustCut.left, Lx - halfStroke, cy0 - over, Lx - halfStroke, cy1 + over);
      edge(mustCut.top, cx0 - over, Ty - halfStroke, cx1 + over, Ty - halfStroke);
      const rx = cutAtLogical && n.right ? cx1 - halfStroke : Rx + halfStroke;
      const by = cutAtLogical && n.bottom ? cy1 - halfStroke : By + halfStroke;
      edge(mustCut.right, rx, cy0 - over, rx, cy1 + over);
      edge(mustCut.bottom, cx0 - over, by, cx1 + over, by);
      g.globalAlpha = 1;
      noDash();
      g.lineWidth = stroke * k;
    }

    /* Corner crosshairs on the rect that will be left after cutting. A full
       crosshair is drawn at each corner and the keep-out clip trims whichever
       arms would fall on surviving picture — which degrades them to clean
       L-brackets on the leading corners and leaves full crosses inside the
       discarded strip. Matching them across a seam registers the two sheets. */
    if (marks.cornerMarks && arm > 0.05) {
      g.lineWidth = stroke * 1.6 * k;
      noDash();
      const cross = (x: number, y: number) => {
        line(x - arm, y, x + arm, y);
        line(x, y - arm, x, y + arm);
      };
      const rxc = cutAtLogical && n.right ? cx1 : Rx;
      const byc = cutAtLogical && n.bottom ? cy1 : By;
      cross(Lx, Ty);
      cross(rxc, Ty);
      cross(Lx, byc);
      cross(rxc, byc);
      g.lineWidth = stroke * k;
    }

    /* Mid-edge ticks: a skew check halfway along each seam, on the same
       boundary as the cut lines. */
    if (marks.edgeTicks && tick > 0.05) {
      g.lineWidth = stroke * 1.6 * k;
      noDash();
      const midX = (cx0 + cx1) / 2;
      const midY = (cy0 + cy1) / 2;
      const rxt = cutAtLogical && n.right ? cx1 : Rx;
      const byt = cutAtLogical && n.bottom ? cy1 : By;
      if (n.left) line(Lx, midY, Lx - tick, midY);
      if (n.right) line(rxt, midY, rxt + tick, midY);
      if (n.top) line(midX, Ty, midX, Ty - tick);
      if (n.bottom) line(midX, byt, midX, byt + tick);
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
    const cutSeam = trim && s.seam === 'cut';
    // In cut mode the logical boundary is already drawn as the cut line, so a
    // second dashed line on top of it would just be noise.
    const guides = marks.overlapGuides && !cutSeam;
    const fs = Math.min(hidden * 0.5, 0.26);
    const labelTarget = cutSeam ? 'cut & discard — duplicates' : trim ? 'lay' : 'cover to here —';

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
      /* With no printable margin, this strip is the only safe place for the id. */
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

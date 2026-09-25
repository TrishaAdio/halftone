/**
 * The assembly map: one extra sheet that goes first in every export. It carries
 * the labelled grid, the exact print specification, and the order of operations
 * for gluing the poster up. Printed or kept on screen, it is the index that
 * tells you which sheet goes where.
 */

import { MARK_COLORS, type Layout } from './layout.ts';
import { drawOverlay, PRINT_THEME } from './overlay.ts';
import { createCanvas, drawResampled } from './resample.ts';
import { pxPerCm, SHEETS } from './units.ts';

const INK = '#111111';
const MUTED = '#5c5c5c';
const RULE = '#c8c8c8';

export interface MapMeta {
  fileName: string;
}

export function renderAssemblyMap(
  layout: Layout,
  image: CanvasImageSource,
  meta: MapMeta,
  mapDpi = 200,
): HTMLCanvasElement {
  const k = pxPerCm(mapDpi);
  const L = layout;
  const s = L.settings;
  const { canvas, g } = createCanvas(L.sheetCm.w * k, L.sheetCm.h * k);

  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);

  const pad = Math.max(1.0, L.marginCm + 0.5);
  const innerW = L.sheetCm.w - pad * 2;
  let y = pad;

  const font = (sizeCm: number, weight = '400') =>
    (g.font = `${weight} ${sizeCm * k}px Arial, Helvetica, sans-serif`);
  const text = (str: string, xCm: number, yCm: number, align: CanvasTextAlign = 'left') => {
    g.textAlign = align;
    g.textBaseline = 'alphabetic';
    g.fillText(str, xCm * k, yCm * k);
  };
  const rule = (yCm: number) => {
    g.strokeStyle = RULE;
    g.lineWidth = Math.max(1, 0.015 * k);
    g.beginPath();
    g.moveTo(pad * k, yCm * k);
    g.lineTo((pad + innerW) * k, yCm * k);
    g.stroke();
  };

  /* ── Header ─────────────────────────────────────────────────────────────── */
  g.fillStyle = INK;
  font(0.62, '700');
  y += 0.5;
  text('TileCraft — Assembly Map', pad, y);
  font(0.3);
  g.fillStyle = MUTED;
  text(
    `${L.cols} × ${L.rows} grid · ${L.tiles.length} sheet${L.tiles.length === 1 ? '' : 's'} of ${
      SHEETS[s.sheet].label
    }`,
    pad + innerW,
    y,
    'right',
  );
  y += 0.42;
  g.fillStyle = MUTED;
  font(0.28);
  const src = meta.fileName ? `${meta.fileName} · ` : '';
  text(
    `${src}${L.imagePx.w} × ${L.imagePx.h} px  ·  final print ${L.imageCm.w.toFixed(1)} × ${L.imageCm.h.toFixed(
      1,
    )} cm`,
    pad,
    y,
  );
  y += 0.3;
  rule(y);
  y += 0.55;

  /* ── The map itself ─────────────────────────────────────────────────────── */
  const budgetH = L.sheetCm.h * 0.44;
  const mapScale = Math.min(innerW / L.gridCm.w, budgetH / L.gridCm.h);
  const mapW = L.gridCm.w * mapScale;
  const mapH = L.gridCm.h * mapScale;
  const mapX = pad + (innerW - mapW) / 2;

  g.save();
  g.translate(mapX * k, y * k);
  const scalePx = mapScale * k; // px per poster-cm

  // Faded thumbnail: light enough that the ids and seams stay legible, and it
  // keeps the reference page cheap to print.
  g.save();
  g.globalAlpha = 0.5;
  drawResampled(
    g,
    image,
    { x: 0, y: 0, w: L.imagePx.w, h: L.imagePx.h },
    { x: 0, y: 0, w: L.imageCm.w * scalePx, h: L.imageCm.h * scalePx },
  );
  g.restore();

  drawOverlay(g, L, {
    scale: scalePx,
    theme: PRINT_THEME,
    showIds: true,
    showOverlap: L.overlapCm > 0,
    idFontPx: Math.max(0.16 * k, Math.min(L.stepCm.w * scalePx * 0.24, 0.42 * k)),
  });
  g.restore();

  // Physical size callouts along the map edges.
  g.fillStyle = MUTED;
  font(0.26);
  text(`${L.imageCm.w.toFixed(1)} cm`, mapX + (L.imageCm.w * mapScale) / 2, y + mapH + 0.4, 'center');
  g.save();
  g.translate((mapX - 0.18) * k, (y + (L.imageCm.h * mapScale) / 2) * k);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillText(`${L.imageCm.h.toFixed(1)} cm`, 0, 0);
  g.restore();

  y += mapH + 0.85;
  rule(y);
  y += 0.5;

  /* ── Two columns: specification and procedure ──────────────────────────── */
  const colGap = 0.8;
  const colW = (innerW - colGap) / 2;
  const leftX = pad;
  const rightX = pad + colW + colGap;
  const lh = 0.4;

  const specs: Array<[string, string]> = [
    ['Final print size', `${L.imageCm.w.toFixed(1)} × ${L.imageCm.h.toFixed(1)} cm`],
    ['Sheets', `${L.cols} cols × ${L.rows} rows = ${L.tiles.length}`],
    ['Paper', `${SHEETS[s.sheet].label} ${s.orientation}, ${L.sheetCm.w} × ${L.sheetCm.h} cm`],
    ['Print scale', '100% / "Actual size" — do not fit to page'],
    ['Export density', `${s.dpi} DPI (${L.sheetPx.w} × ${L.sheetPx.h} px per sheet)`],
    ['Effective detail', `${Math.round(L.effectiveDpi)} DPI from source`],
    ['Margin trimmed', `${(L.marginCm * 10).toFixed(0)} mm each edge`],
    [
      'Overlap',
      L.overlapCm > 0 ? `${(L.overlapCm * 10).toFixed(1)} mm shared per seam` : 'none — butt joint',
    ],
    ['Image per sheet', `${L.printableCm.w.toFixed(1)} × ${L.printableCm.h.toFixed(1)} cm`],
    ['Net gain per sheet', `${L.stepCm.w.toFixed(1)} × ${L.stepCm.h.toFixed(1)} cm`],
  ];

  g.fillStyle = INK;
  font(0.32, '700');
  text('SPECIFICATION', leftX, y);
  text('ASSEMBLY', rightX, y);
  let ly = y + 0.55;
  font(0.27);
  for (const [key, val] of specs) {
    g.fillStyle = MUTED;
    text(key, leftX, ly);
    g.fillStyle = INK;
    text(val, leftX + colW, ly, 'right');
    ly += lh;
  }

  const steps = L.overlapCm > 0
    ? [
        `Print every sheet at 100% scale. Turn off "fit to page" / "shrink to fit".`,
        `Sort the sheets by the ${L.cols}×${L.rows} map above, row by row.`,
        `Trim only the LEFT and TOP margin of each sheet, cutting along the inside of the bold dashed line.`,
        `Start with R1-C1 at the top-left. Leave its right and bottom margins on.`,
        `Lay the next sheet over the previous one so its cut edge lands exactly on the dashed guide line inside the tinted strip.`,
        `Check the corner marks: the L-shapes of both sheets must line up and the mid-edge ticks must stay in line.`,
        `Tape the seam on the back, or glue the strip. Work left to right, then down.`,
        `The last column and row may be narrower — that is expected, the map shows it.`,
      ]
    : [
        `Print every sheet at 100% scale. Turn off "fit to page" / "shrink to fit".`,
        `Sort the sheets by the ${L.cols}×${L.rows} map above, row by row.`,
        `Trim EVERY edge that meets another sheet, cutting along the inside of the bold dashed line.`,
        `Butt the cut edges together — no overlap. Match the corner L-marks across each seam.`,
        `Tape the seam on the back so the join stays flat.`,
        `Work left to right, then down, keeping the corner marks aligned.`,
        `Any cutting error shows as a white hairline; an overlap of 3–5 mm avoids that.`,
      ];

  let ry = y + 0.55;
  font(0.27);
  let n = 1;
  for (const step of steps) {
    const lines = wrap(g, step, (colW - 0.55) * k);
    g.fillStyle = MUTED;
    text(`${n}.`, rightX, ry);
    g.fillStyle = INK;
    for (const ln of lines) {
      text(ln, rightX + 0.55, ry);
      ry += lh;
    }
    ry += 0.08;
    n++;
  }

  y = Math.max(ly, ry) + 0.4;

  /* ── Legend ─────────────────────────────────────────────────────────────── */
  rule(y);
  y += 0.5;
  const mark = MARK_COLORS[s.marks.color];
  g.fillStyle = INK;
  font(0.3, '700');
  text('MARKS ON EACH SHEET', leftX, y);
  y += 0.5;
  font(0.26);

  const legend: Array<[string, (x: number, yy: number) => void]> = [
    [
      'Bold dashed line — cut here (inside edge of the line)',
      (x, yy) => {
        g.strokeStyle = mark;
        g.lineWidth = Math.max(1, 0.02 * k);
        g.setLineDash([0.2 * k, 0.13 * k]);
        g.beginPath();
        g.moveTo(x * k, yy * k);
        g.lineTo((x + 0.9) * k, yy * k);
        g.stroke();
        g.setLineDash([]);
      },
    ],
    [
      'Corner L-marks — make them collinear across each seam',
      (x, yy) => {
        g.strokeStyle = mark;
        g.lineWidth = Math.max(1, 0.03 * k);
        g.beginPath();
        g.moveTo(x * k, (yy - 0.18) * k);
        g.lineTo(x * k, yy * k);
        g.lineTo((x + 0.32) * k, yy * k);
        g.stroke();
      },
    ],
    [
      'Mid-edge tick — a skew check halfway along each seam',
      (x, yy) => {
        g.strokeStyle = mark;
        g.lineWidth = Math.max(1, 0.03 * k);
        g.beginPath();
        g.moveTo((x + 0.45) * k, (yy - 0.2) * k);
        g.lineTo((x + 0.45) * k, yy * k);
        g.stroke();
      },
    ],
    [
      'Sheet id and the TOP arrow sit in the margin and are cut away',
      (x, yy) => {
        g.fillStyle = mark;
        g.beginPath();
        g.moveTo((x + 0.45) * k, (yy - 0.22) * k);
        g.lineTo((x + 0.28) * k, yy * k);
        g.lineTo((x + 0.62) * k, yy * k);
        g.closePath();
        g.fill();
      },
    ],
  ];
  if (L.overlapCm > 0) {
    legend.splice(1, 0, [
      'Tinted strip — shared picture, hidden under the next sheet',
      (x, yy) => {
        g.fillStyle = 'rgba(255,0,168,0.18)';
        g.fillRect(x * k, (yy - 0.26) * k, 0.9 * k, 0.3 * k);
        g.strokeStyle = mark;
        g.lineWidth = Math.max(1, 0.015 * k);
        g.setLineDash([0.12 * k, 0.09 * k]);
        g.beginPath();
        g.moveTo(x * k, (yy - 0.26) * k);
        g.lineTo(x * k, (yy + 0.04) * k);
        g.stroke();
        g.setLineDash([]);
      },
    ]);
  }

  for (const [label, swatch] of legend) {
    swatch(leftX, y);
    g.fillStyle = INK;
    font(0.26);
    text(label, leftX + 1.15, y);
    y += 0.42;
  }

  /* ── Footer ─────────────────────────────────────────────────────────────── */
  const footY = L.sheetCm.h - pad + 0.2;
  rule(footY - 0.45);
  g.fillStyle = MUTED;
  font(0.23);
  text(
    'Colours assume sRGB. Printer, paper and driver calibration will shift the result — print one sheet as a test before committing to the full run.',
    pad,
    footY - 0.12,
  );
  text(`Generated ${new Date().toLocaleString()} · TileCraft`, pad, footY + 0.24);

  return canvas;
}

function wrap(g: CanvasRenderingContext2D, str: string, maxPx: number): string[] {
  const words = str.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (g.measureText(probe).width > maxPx && line) {
      lines.push(line);
      line = w;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Small on-screen thumbnail of the map, for the UI panel. */
export function renderMapThumb(
  layout: Layout,
  image: CanvasImageSource,
  widthPx: number,
): HTMLCanvasElement {
  const L = layout;
  const scale = widthPx / L.gridCm.w;
  const { canvas, g } = createCanvas(widthPx, L.gridCm.h * scale);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.save();
  g.globalAlpha = 0.55;
  drawResampled(
    g,
    image,
    { x: 0, y: 0, w: L.imagePx.w, h: L.imagePx.h },
    { x: 0, y: 0, w: L.imageCm.w * scale, h: L.imageCm.h * scale },
  );
  g.restore();
  drawOverlay(g, L, {
    scale,
    theme: PRINT_THEME,
    showIds: true,
    showOverlap: L.overlapCm > 0,
  });
  return canvas;
}

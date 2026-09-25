/**
 * The assembly map: one extra sheet that goes first in every export. It carries
 * the labelled grid, the exact print specification, and the order of operations
 * for putting the poster up.
 */

import { MARK_COLORS, type Layout } from './layout.ts';
import { drawGutters, drawOverlay, PRINT_THEME } from './overlay.ts';
import { createCanvas, drawResampled } from './resample.ts';
import { fmtMm, pxPerCm, SHEETS } from './units.ts';

const INK = '#111111';
const MUTED = '#5c5c5c';
const RULE = '#c8c8c8';

export interface MapMeta {
  fileName: string;
}

/** What to do at the printer, before any assembly. */
export function printSteps(L: Layout): string[] {
  const steps: string[] = [];
  if (L.settings.join === 'borderless') {
    steps.push(
      'In the Epson driver: tick Borderless, set Expansion to Standard, and choose the photo paper type you are using.',
    );
  }
  steps.push(
    'Print every sheet at 100% scale. In the print dialog choose "Actual size" and turn OFF "Fit to page" / "Shrink oversized pages".',
  );
  steps.push(
    `Before printing the rest, check sheet 1 with a ruler: the printed block should measure ${L.printableCm.w.toFixed(
      1,
    )} × ${L.printableCm.h.toFixed(1)} cm. Keep every sheet the same way up.`,
  );
  return steps;
}

/** Numbered procedure, tailored to how these sheets will actually be joined. */
export function assemblySteps(L: Layout): string[] {
  const s = L.settings;
  const sort = `Lay the sheets out using the ${L.cols}×${L.rows} map above, row by row.`;
  const gutter = fmtMm(L.gutterCm);

  if (s.join === 'borderless') {
    return [
      sort,
      `Nothing to cut. The ink runs to all four edges, so simply butt the paper edges together — they touch, and the picture continues across the join.`,
      'Tape each seam on the back so the join stays flat. Work left to right, then downward.',
      `If a thin white edge appears at a seam, raise Expansion in the driver. If the picture is losing more than it should at the joins, lower the bleed setting (currently ${fmtMm(
        L.bleedCm,
      )}) and re-export.`,
    ];
  }

  if (s.join === 'nocut' && s.placement === 'tight') {
    return [
      sort,
      'Nothing needs cutting. Start with the top-left sheet, face up.',
      `Lay the next sheet to its right so the next sheet's left paper edge just covers the thin dashed line near the right of the printed area. Covering slightly more is harmless — the white line stays ${gutter} either way.`,
      `Do the same downward: the sheet below covers the dashed line along the bottom edge.`,
      `Each seam shows a ${gutter} white line, because your printer cannot print its own paper edge. Those lines are even across the whole poster, which is what makes it read as a panel grid rather than a mistake.`,
      'Tape or glue each seam on the back. Work left to right, then downward.',
      'The dashed guides and sheet ids sit inside the covered strip, so they disappear as you go. Only the very last sheet has no id — it is the one left over.',
    ];
  }

  if (s.join === 'nocut') {
    return [
      sort,
      'Nothing needs cutting. Butt the paper edges together so they just touch — no overlap, no measuring.',
      `Each seam shows a ${gutter} white line: two unprinted paper edges of ${fmtMm(
        L.marginCm,
      )} side by side. They are even across the poster.`,
      'Tape each seam on the back. Work left to right, then downward.',
      `To halve those lines to ${fmtMm(
        L.marginCm,
      )}, re-export with the "on the printed edge" placement, which laps each sheet onto its neighbour's ink instead.`,
    ];
  }

  if (L.hiddenCm > 0 && s.seam === 'cut') {
    return [
      sort,
      `Cut every sheet along the bold dashed lines, on the inside edge of the line. Those lines are set in from the paper edge: on a shared edge they sit ${fmtMm(
        L.hiddenCm,
      )} inside the printed picture, because that strip is a duplicate of the neighbouring sheet.`,
      `Discard the duplicated strips. What is left on each sheet is its own ${L.stepCm.w.toFixed(
        1,
      )} × ${L.stepCm.h.toFixed(1)} cm of picture, and nothing else.`,
      'Butt two cut edges together. They were cut on the same image content, so the picture runs straight through the join with no gap and no step.',
      'Line the corner crosshairs up across each seam, and check the mid-edge ticks stay in line — that catches skew the corners hide.',
      `The ${fmtMm(
        L.hiddenCm,
      )} of duplicate is the error budget: a cut that wanders by less than that still lands on real picture, never on blank paper.`,
      'Tape each seam on the back. Work left to right, then downward.',
      'The last column and row may be narrower — that is expected, the map shows it.',
    ];
  }

  if (L.hiddenCm > 0) {
    return [
      sort,
      'Trim ONLY the left and top margin of each sheet, cutting along the inside edge of the bold dashed line.',
      'Place the top-left sheet first. Leave its right and bottom margins on.',
      'Lay each following sheet over the previous one so its cut edge lands exactly on the dashed guide line inside the tinted strip.',
      'Check the corner marks: the L-shapes of both sheets must line up and the mid-edge ticks must stay in line.',
      'Tape the seam on the back, or glue the strip. Work left to right, then down.',
      'The last column and row may be narrower — that is expected, the map shows it.',
    ];
  }

  return [
    sort,
    'Trim EVERY edge that meets another sheet, cutting along the inside edge of the bold dashed line.',
    'Butt the cut edges together — no overlap. Match the corner L-marks across each seam.',
    'Tape the seam on the back so the join stays flat.',
    'Any cutting error shows as a white hairline; a 3–5 mm overlap avoids that.',
  ];
}

export function joinLabel(L: Layout): string {
  const s = L.settings;
  if (s.join === 'borderless') return `borderless, ${fmtMm(L.bleedCm)} bleed`;
  if (s.join === 'nocut')
    return s.placement === 'tight' ? 'no cutting, lapped onto the ink' : 'no cutting, edges butted';
  if (L.hiddenCm === 0) return 'trimmed, butt joint, no overlap';
  return s.seam === 'cut'
    ? `cut & butt, ${fmtMm(L.hiddenCm)} duplicated strip discarded`
    : `lap & glue, ${fmtMm(L.hiddenCm)} overlap`;
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
  font(0.28);
  const src = meta.fileName ? `${meta.fileName} · ` : '';
  text(
    `${src}${L.imagePx.w} × ${L.imagePx.h} px  ·  final print ${L.imageCm.w.toFixed(
      1,
    )} × ${L.imageCm.h.toFixed(1)} cm  ·  ${joinLabel(L)}`,
    pad,
    y,
  );
  y += 0.3;
  rule(y);
  y += 0.55;

  /* ── The map itself ─────────────────────────────────────────────────────── */
  const budgetH = L.sheetCm.h * 0.42;
  const mapScale = Math.min(innerW / L.gridCm.w, budgetH / L.gridCm.h);
  const mapW = L.gridCm.w * mapScale;
  const mapH = L.gridCm.h * mapScale;
  const mapX = pad + (innerW - mapW) / 2;

  g.save();
  g.translate(mapX * k, y * k);
  const scalePx = mapScale * k;

  // Faded thumbnail: light enough that ids and seams stay legible, and cheap to
  // print on a reference page.
  g.save();
  g.globalAlpha = 0.5;
  drawResampled(
    g,
    image,
    { x: 0, y: 0, w: L.imagePx.w, h: L.imagePx.h },
    { x: 0, y: 0, w: L.imageCm.w * scalePx, h: L.imageCm.h * scalePx },
  );
  g.restore();

  drawGutters(g, L, scalePx, '#ffffff');
  drawOverlay(g, L, {
    scale: scalePx,
    theme: PRINT_THEME,
    showIds: true,
    showOverlap: L.hiddenCm > 0,
    idFontPx: Math.max(0.16 * k, Math.min(L.stepCm.w * scalePx * 0.24, 0.42 * k)),
  });
  g.restore();

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
    ['Join', joinLabel(L)],
    ['Print scale', '100% / "Actual size" — do not fit to page'],
    ['Export density', `${s.dpi} DPI (${L.sheetPx.w} × ${L.sheetPx.h} px per sheet)`],
    ['Effective detail', `${Math.round(L.effectiveDpi)} DPI from source`],
  ];
  if (s.join === 'borderless') {
    specs.push(['Bleed per edge', `${fmtMm(L.bleedCm)} (driver Expansion: Standard)`]);
    specs.push(['Unprinted margin', 'none — edge to edge']);
  } else {
    specs.push(['Unprintable margin', `${fmtMm(L.marginCm)} each edge`]);
  }
  if (L.gutterCm > 0) {
    specs.push(['White line per seam', fmtMm(L.gutterCm)]);
    specs.push(['Picture inked', `${(L.inkedFraction * 100).toFixed(1)}%`]);
  }
  if (L.hiddenCm > 0) {
    specs.push([
      s.join === 'trim' ? 'Overlap per seam' : 'Covered strip',
      fmtMm(L.hiddenCm),
    ]);
  }
  specs.push(['Image per sheet', `${L.printableCm.w.toFixed(1)} × ${L.printableCm.h.toFixed(1)} cm`]);
  specs.push(['Gain per sheet', `${L.stepCm.w.toFixed(1)} × ${L.stepCm.h.toFixed(1)} cm`]);

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

  let ry = y + 0.55;
  font(0.27);
  let n = 1;
  for (const step of [...printSteps(L), ...assemblySteps(L)]) {
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
  const mark = MARK_COLORS[s.marks.color];
  const legend: Array<[string, (x: number, yy: number) => void]> = [];

  if (s.join === 'trim') {
    legend.push([
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
    ]);
    legend.push([
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
    ]);
    legend.push([
      'Mid-edge tick — a skew check halfway along each seam',
      (x, yy) => {
        g.strokeStyle = mark;
        g.lineWidth = Math.max(1, 0.03 * k);
        g.beginPath();
        g.moveTo((x + 0.45) * k, (yy - 0.2) * k);
        g.lineTo((x + 0.45) * k, yy * k);
        g.stroke();
      },
    ]);
  }
  if (L.hiddenCm > 0) {
    legend.push([
      s.join === 'trim'
        ? 'Tinted strip — shared picture, hidden under the next sheet'
        : 'Dashed line near the edge — cover it with the next sheet',
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
  if (L.gutterCm > 0) {
    legend.push([
      `White line of ${fmtMm(L.gutterCm)} at every seam — the paper edge your printer cannot reach`,
      (x, yy) => {
        g.fillStyle = '#e8e8e8';
        g.fillRect(x * k, (yy - 0.26) * k, 0.9 * k, 0.3 * k);
        g.fillStyle = '#b8b8b8';
        g.fillRect((x + 0.4) * k, (yy - 0.26) * k, 0.1 * k, 0.3 * k);
      },
    ]);
  }

  if (legend.length) {
    rule(y);
    y += 0.5;
    g.fillStyle = INK;
    font(0.3, '700');
    text('ON EACH SHEET', leftX, y);
    y += 0.5;
    for (const [label, swatch] of legend) {
      swatch(leftX, y);
      g.fillStyle = INK;
      font(0.26);
      const lines = wrap(g, label, (innerW - 1.2) * k);
      for (const ln of lines) {
        text(ln, leftX + 1.15, y);
        y += 0.38;
      }
      y += 0.06;
    }
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
  drawGutters(g, L, scale, '#ffffff');
  drawOverlay(g, L, {
    scale,
    theme: PRINT_THEME,
    showIds: true,
    showOverlap: L.hiddenCm > 0,
  });
  return canvas;
}

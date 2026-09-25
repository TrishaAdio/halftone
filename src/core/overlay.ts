/**
 * The grid overlay. One renderer, two consumers: the live on-screen preview and
 * the printed assembly map. Coordinates are poster centimetres with the origin
 * at the image's top-left corner; `scale` converts cm → px.
 */

import type { Layout } from './layout.ts';

export interface OverlayTheme {
  seam: string;
  seamShadow: string;
  overlapFill: string;
  blankFill: string;
  blankLine: string;
  bounds: string;
  idFill: string;
  idBg: string;
  selection: string;
  selectionFill: string;
}

export const SCREEN_THEME: OverlayTheme = {
  seam: 'rgba(255,255,255,0.92)',
  seamShadow: 'rgba(0,0,0,0.5)',
  overlapFill: 'rgba(255,0,168,0.22)',
  blankFill: 'rgba(10,12,16,0.55)',
  blankLine: 'rgba(255,255,255,0.16)',
  bounds: 'rgba(255,255,255,0.5)',
  idFill: 'rgba(255,255,255,0.95)',
  idBg: 'rgba(0,0,0,0.45)',
  selection: '#38e08c',
  selectionFill: 'rgba(56,224,140,0.16)',
};

export const PRINT_THEME: OverlayTheme = {
  seam: 'rgba(40,40,40,0.9)',
  seamShadow: 'rgba(255,255,255,0.85)',
  overlapFill: 'rgba(255,0,168,0.16)',
  blankFill: 'rgba(0,0,0,0.06)',
  blankLine: 'rgba(0,0,0,0.18)',
  bounds: 'rgba(0,0,0,0.45)',
  idFill: '#111111',
  idBg: 'rgba(255,255,255,0.8)',
  selection: '#0a7d4f',
  selectionFill: 'rgba(10,125,79,0.12)',
};

export interface OverlayOptions {
  scale: number; // px per cm
  theme: OverlayTheme;
  showIds: boolean;
  showOverlap: boolean;
  selected?: { row: number; col: number } | null;
  /** Font size for tile ids, in px (auto when omitted). */
  idFontPx?: number;
}

export function drawOverlay(g: CanvasRenderingContext2D, L: Layout, o: OverlayOptions): void {
  const s = o.scale;
  const t = o.theme;
  const hair = Math.max(1, s * 0.02);

  g.save();
  g.lineCap = 'butt';

  /* Blank paper: grid cells (or parts of cells) with no image on them. */
  if (L.gridCm.w > L.imageCm.w + 1e-6 || L.gridCm.h > L.imageCm.h + 1e-6) {
    g.fillStyle = t.blankFill;
    if (L.gridCm.w > L.imageCm.w + 1e-6) {
      g.fillRect(L.imageCm.w * s, 0, (L.gridCm.w - L.imageCm.w) * s, L.gridCm.h * s);
    }
    if (L.gridCm.h > L.imageCm.h + 1e-6) {
      g.fillRect(0, L.imageCm.h * s, L.imageCm.w * s, (L.gridCm.h - L.imageCm.h) * s);
    }
    // Diagonal hatching over the blank region so it reads as "no image here".
    g.save();
    g.beginPath();
    g.rect(L.imageCm.w * s, 0, (L.gridCm.w - L.imageCm.w) * s, L.gridCm.h * s);
    g.rect(0, L.imageCm.h * s, L.imageCm.w * s, (L.gridCm.h - L.imageCm.h) * s);
    g.clip();
    g.strokeStyle = t.blankLine;
    g.lineWidth = hair;
    const pitch = Math.max(6, s * 0.5);
    const span = (L.gridCm.w + L.gridCm.h) * s;
    g.beginPath();
    for (let x = -L.gridCm.h * s; x < span; x += pitch) {
      g.moveTo(x, 0);
      g.lineTo(x + L.gridCm.h * s, L.gridCm.h * s);
    }
    g.stroke();
    g.restore();
  }

  /* Overlap bands: the strip of picture that two sheets share. */
  if (o.showOverlap && L.overlapCm > 0) {
    g.fillStyle = t.overlapFill;
    for (let c = 1; c < L.cols; c++) {
      const x = c * L.stepCm.w;
      if (x >= L.imageCm.w) break;
      const w = Math.min(L.overlapCm, L.imageCm.w - x);
      g.fillRect(x * s, 0, w * s, Math.min(L.imageCm.h, L.gridCm.h) * s);
    }
    for (let r = 1; r < L.rows; r++) {
      const y = r * L.stepCm.h;
      if (y >= L.imageCm.h) break;
      const h = Math.min(L.overlapCm, L.imageCm.h - y);
      g.fillRect(0, y * s, Math.min(L.imageCm.w, L.gridCm.w) * s, h * s);
    }
  }

  /* Selected sheet: highlight its whole printable box. */
  if (o.selected) {
    const x = o.selected.col * L.stepCm.w;
    const y = o.selected.row * L.stepCm.h;
    const w = Math.min(L.printableCm.w, L.imageCm.w - x);
    const h = Math.min(L.printableCm.h, L.imageCm.h - y);
    if (w > 0 && h > 0) {
      g.fillStyle = t.selectionFill;
      g.fillRect(x * s, y * s, w * s, h * s);
      g.strokeStyle = t.selection;
      g.lineWidth = hair * 3;
      g.strokeRect(x * s, y * s, w * s, h * s);
    }
  }

  /* Seam lines: where the overlying sheet's cut edge falls. */
  const seams: Array<[number, number, number, number]> = [];
  for (let c = 1; c < L.cols; c++) {
    const x = c * L.stepCm.w;
    if (x >= L.imageCm.w - 1e-9) break;
    seams.push([x, 0, x, Math.min(L.imageCm.h, L.gridCm.h)]);
  }
  for (let r = 1; r < L.rows; r++) {
    const y = r * L.stepCm.h;
    if (y >= L.imageCm.h - 1e-9) break;
    seams.push([0, y, Math.min(L.imageCm.w, L.gridCm.w), y]);
  }
  for (const pass of [0, 1]) {
    g.strokeStyle = pass === 0 ? t.seamShadow : t.seam;
    g.lineWidth = pass === 0 ? hair * 3 : hair * 1.2;
    g.beginPath();
    for (const [x1, y1, x2, y2] of seams) {
      g.moveTo(x1 * s, y1 * s);
      g.lineTo(x2 * s, y2 * s);
    }
    g.stroke();
  }

  /* Image bounds. */
  g.strokeStyle = t.bounds;
  g.lineWidth = hair * 1.5;
  g.strokeRect(0, 0, L.imageCm.w * s, L.imageCm.h * s);

  /* Tile ids, centred on each sheet's unique (non-overlapped) area. A sliver of
     a last column has very little room, so the label shrinks, then falls back
     to its short form, and is dropped only if even that cannot fit. */
  if (o.showIds) {
    const cellW = L.stepCm.w * s;
    const cellH = L.stepCm.h * s;
    const base = o.idFontPx ?? Math.max(7, Math.min(cellW * 0.26, cellH * 0.26, 28));
    if (base >= 6) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const tile of L.tiles) {
        const availW = Math.min(L.stepCm.w, tile.contentCm.w) * s;
        const availH = Math.min(L.stepCm.h, tile.contentCm.h) * s;
        const x = tile.col * L.stepCm.w * s + availW / 2;
        const y = tile.row * L.stepCm.h * s + availH / 2;

        let label = tile.id;
        let fs = Math.min(base, availH * 0.7);
        const fits = () => {
          g.font = `600 ${fs}px Arial, Helvetica, sans-serif`;
          return g.measureText(label).width + fs * 0.68 <= availW;
        };
        if (!fits()) {
          fs = Math.max(base * 0.6, 6);
          if (!fits()) {
            label = `C${tile.col + 1}`;
            if (!fits()) continue;
          }
        }

        const w = g.measureText(label).width;
        const padX = fs * 0.34;
        const padY = fs * 0.22;
        g.fillStyle = t.idBg;
        roundRect(g, x - w / 2 - padX, y - fs / 2 - padY, w + padX * 2, fs + padY * 2, fs * 0.28);
        g.fill();
        g.fillStyle = tile.partial ? t.selection : t.idFill;
        g.fillText(label, x, y + fs * 0.06);
      }
    }
  }

  g.restore();
}

export function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
